/**
 * AgroPasco Digital — Contrato de Recuperación de Evidencia Agrícola (Retriever)
 * ==============================================================================
 * FASE 9-L06: Especificación de contrato desacoplado para la futura FASE 9-L07
 *
 * Principios rectores:
 *  - Cero invención de fuentes: si no hay evidencia auténtica, informa 'insufficient_evidence'
 *  - Exclusión estricta de documentos 'candidate', 'rejected', 'superseded' o 'archived'
 *  - Aislamiento absoluto: no accede ni expone datos privados de agricultores o parcelas
 *  - Entrega de fragmentos acotados (excerpts) con citación de página, institución y URL
 *  - Distinción entre evidencia encontrada, insuficiente, obsoleta o en revisión
 */

const fs = require('fs');
const path = require('path');
const { KnowledgeCatalogService } = require('./knowledgeCatalogService');

const INSUFFICIENT_EVIDENCE_MESSAGE = 'No encontré documentación técnica suficiente en la biblioteca de AgroPasco para fundamentar esta recomendación.';

// Palabras clave y patrones de seguridad agronómica
const CHEMICAL_SUBSTANCE_REGEX = /\b(?:clorpirifos|metamidofos|carbofuran|glifosato|mancozeb|paration|paratión|cipermetrina|imidacloprid|abamectina|deltametrina|malation|malatión|endosulfan|endosulfán|dithiocarbamatos|ditiocarbamatos|plaguicida|insecticida\s+qu[ií]mico|fungicida\s+qu[ií]mico|agroqu[ií]mico|herbicida|nematicida|acaricida|paraquat|aldicarb|metomilo|procloraz|benomilo)\b/i;
const NUMERIC_DOSAGE_REGEX = /\b(?:\d+(?:[.,]\d+)?\s*(?:ml\/l|ml\/litro|cc\/l|cc\/litro|cc\/mochila|litros\/mochila|gramos\/mochila|g\/l|gramos\/l|ppm))\b|\b(?:dosis\s+(?:de\s+)?\d+(?:[.,]\d+)?\s*(?:l\/ha|litros\/ha|kg\/ha|kilos\/ha|%|por\s+ciento))\b|\b(?:aplicar\s+\d+(?:[.,]\d+)?\s*(?:l\/ha|litros\/ha|kg\/ha|kilos\/ha|%))\b|\b(?:concentraci[oó]n\s+(?:al?\s+)?\d+(?:[.,]\d+)?\s*(?:%|por\s+ciento))\b/i;
const CHEMICAL_MIXTURE_REGEX = /\b(?:mezclar\s+(?:con\s+)?(?:plaguicida|fungicida|insecticida|agroqu[ií]mico)|mezcla\s+(?:de\s+tanque|qu[ií]mica)|combinar\s+(?:con\s+)?(?:qu[ií]mico|veneno)|caldo\s+qu[ií]mico)\b/i;
const APPLICATION_FREQUENCY_REGEX = /\b(?:aplicar\s+cada\s+\d+|repetir\s+(?:la\s+aplicaci[oó]n\s+)?a\s+los\s+\d+|frecuencia\s+de\s+(?:aplicaci[oó]n\s+de\s+)?\d+\s+d[ií]as|intervalo\s+de\s+(?:aplicaci[oó]n\s+de\s+)?\d+\s+d[ií]as|cada\s+\d+\s+d[ií]as(?:\s+durante)?)\b/i;
const WITHDRAWAL_PERIOD_REGEX = /\b(?:periodo\s+de\s+carencia|tiempo\s+de\s+espera\s+antes\s+de\s+cosecha|intervalo\s+de\s+seguridad|plazo\s+de\s+seguridad|d[ií]as\s+antes\s+de\s+(?:la\s+)?cosecha|periodo\s+de\s+reingreso)\b/i;
const QUARANTINE_PEST_REGEX = /\b(?:cuarentenari[ao]|tecia\s+solanivora|polilla\s+guatemalteca|moniliophthora|fusarium\s+oxysporum|raza\s+4\s+tropical|plaga\s+reglamentada)\b/i;

// Patrones de inyección de instrucciones en fragmentos no confiables (Prompt Injection Defense Multilingüe - H-01)
const PROMPT_INJECTION_PATTERNS = [
  // Inglés
  /ignore\s+(?:previous|all|the\s+above)\s+instructions/i,
  /system\s*prompt/i,
  /you\s+are\s+now\s+(?:an?|in)\b/i,
  /act\s+as\s+(?:an?|the)\b/i,
  /system\s*:\s*/i,
  /\[instruction\]/i,
  /\[\/context/i,
  /assistant\s*:\s*/i,
  /admin(?:istrator)?\s+override/i,
  /developer\s+mode/i,
  /<script\b/i,
  /drop\s+table/i,
  /eval\s*\(/i,

  // Español (H-01) - variaciones con y sin tildes, mayúsculas, directivas del sistema
  /ignora\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas|directivas|advertencias)(?:\s+(?:anteriores|previas|del\s+sistema))?/i,
  /olvida\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas|directivas|todo)(?:\s+(?:anteriores|previas|del\s+sistema))?/i,
  /act[uú]a\s+como\s+(?:un\s+|el\s+)?(?:administrador|admin|sistema|root|superusuario|desarrollador|modelo\s+sin\s+restricciones)/i,
  /eres\s+(?:el\s+)?(?:nuevo\s+sistema|administrador|asistente\s+sin\s+filtros)/i,
  /ahora\s+eres\s+(?:un\s+|el\s+)?(?:asistente|administrador|sistema)/i,
  /revela\s+(?:todas\s+las\s+)?(?:claves|contrase[ñn]as|credenciales|tokens?)(?:\s+(?:secretas|de\s+acceso))?/i,
  /muestra\s+(?:el\s+)?(?:token\s+jwt|las?\s+contrase[ñn]as?|las?\s+claves?|credenciales)/i,
  /desactiva\s+(?:las\s+)?(?:restricciones|reglas|seguridad|filtros|limitaciones)/i,
  /cambia\s+(?:tu\s+|de\s+)?rol(?:\s+a)?/i,
  /asume\s+el\s+rol/i,
  /ejecuta\s+(?:esta\s+instrucci[oó]n|el\s+comando)/i,
  /haz\s+caso\s+omiso\s+(?:a\s+las\s+instrucciones|a\s+las\s+reglas|al\s+sistema)/i,
  /modo\s+(?:desarrollador|administrador|developer|debug|sin\s+censura)/i,
  /anula\s+(?:la\s+configuraci[oó]n|las\s+reglas|el\s+control)/i,
  /prompt\s+(?:del\s+sistema|de\s+sistema)/i,
  /instrucci[oó]n\s+(?:del\s+sistema|oculta|secreta)/i
];

// Stop-words en español: se omiten artículos y preposiciones vacías pero se PRESERVAN estrictamente negaciones y directivas restrictivas
const SPANISH_STOP_WORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para',
  'con', 'una', 'su', 'al', 'lo', 'como', 'más', 'mas', 'pero', 'sus', 'le', 'ya', 'o', 'este',
  'esta', 'son', 'entre', 'está', 'cuando', 'muy', 'sobre', 'mi', 'mis', 'cómo', 'cual',
  'cuáles', 'cuales', 'debo', 'puedo', 'hacer', 'tengo', 'dar', 'decirme', 'favor', 'puedes', 'usted'
]);

// Negaciones y directivas restrictivas críticas que NUNCA deben descartarse
const PRESERVED_NEGATIONS = new Set([
  'no', 'sin', 'nunca', 'evitar', 'tampoco', 'jamas', 'jamás', 'prohibido', 'peligro'
]);

// Palabras agronómicas genéricas que por sí solas NO demuestran evidencia temática suficiente (FASE 9-L07C)
const GENERIC_AGRONOMIC_STOPWORDS = new Set([
  'cultivo', 'cultivos', 'planta', 'plantas', 'campo', 'campos',
  'chacra', 'chacras', 'tierra', 'tierras', 'produccion', 'producción',
  'manejo', 'agricultura', 'agricola', 'agrícola', 'parcela', 'parcelas',
  'sembrar', 'siembra', 'cosechar', 'cosecha'
]);

// Patrón de intención documental histórica, retrospectiva o no autorizada (FASE 9-L07C)
const HISTORICAL_OR_UNAPPROVED_INTENT_REGEX = /\b(?:hist[oó]ric[ao]s?|obsolet[ao]s?|antigu[ao]s?|descontinuad[ao]s?|derogad[ao]s?|no\s+oficial(?:es)?|piratas?|no\s+autorizad[ao]s?|sin\s+autorizaci[oó]n|bolet[ií]n\s+(?:de\s+)?(?:19|20[01])\d\d)\b/i;

function redactChemicalPrescriptions(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text;
  cleaned = cleaned.replace(NUMERIC_DOSAGE_REGEX, '[DOSIS_NO_VALIDADA_BLOQUEADA]');
  cleaned = cleaned.replace(APPLICATION_FREQUENCY_REGEX, '[FRECUENCIA_NO_VALIDADA_BLOQUEADA]');
  cleaned = cleaned.replace(CHEMICAL_MIXTURE_REGEX, '[MEZCLA_NO_VALIDADA_BLOQUEADA]');
  cleaned = cleaned.replace(WITHDRAWAL_PERIOD_REGEX, '[PERIODO_CARENCIA_BLOQUEADO]');
  return cleaned;
}

function sanitizeExcerpt(rawExcerpt) {
  if (typeof rawExcerpt !== 'string') return { cleanExcerpt: '', hasInjectionAttempt: false };
  let sanitized = rawExcerpt;
  let injectionDetected = false;

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      injectionDetected = true;
      sanitized = sanitized.replace(pattern, '[DIRECTIVA_NO_CONFIABLE_NEUTRALIZADA]');
    }
  }

  // Neutralizar delimitadores de prompt que intenten romper contexto
  sanitized = sanitized.replace(/\[\/?(?:CONTEXTO|INSTRUCTION|SYSTEM)[^\]]*\]/gi, '[MARCADOR_NEUTRALIZADO]');

  if (injectionDetected) {
    try {
      console.warn('[SECURITY_EVENT] Intento de inyección de instrucciones detectado en fragmento documental. Contenido neutralizado y auditado.');
    } catch (_) {}
  }

  return {
    cleanExcerpt: sanitized.trim(),
    hasInjectionAttempt: injectionDetected
  };
}

function assessAgronomicSafety(text) {
  const flags = [];
  let hasUnvalidatedChemical = false;

  if (CHEMICAL_SUBSTANCE_REGEX.test(text)) {
    flags.push('mencion_sustancia_quimica_o_plaguicida');
    hasUnvalidatedChemical = true;
  }
  if (NUMERIC_DOSAGE_REGEX.test(text)) {
    flags.push('presencia_de_dosis_numerica');
    hasUnvalidatedChemical = true;
  }
  if (CHEMICAL_MIXTURE_REGEX.test(text)) {
    flags.push('presencia_de_mezcla_quimica');
    hasUnvalidatedChemical = true;
  }
  if (APPLICATION_FREQUENCY_REGEX.test(text)) {
    flags.push('frecuencia_de_aplicacion_especificada');
    hasUnvalidatedChemical = true;
  }
  if (WITHDRAWAL_PERIOD_REGEX.test(text)) {
    flags.push('periodo_de_carencia_mencionado');
    hasUnvalidatedChemical = true;
  }
  if (QUARANTINE_PEST_REGEX.test(text)) {
    flags.push('alerta_organismo_o_plaga_cuarentenaria');
  }

  return {
    requiresReview: flags.length > 0,
    hasUnvalidatedChemical,
    flags
  };
}

function inferCropFromQuestion(cleanQuestion, catalogService) {
  const cropList = ['papa', 'maca', 'cafe', 'palto', 'olluco', 'oca', 'habas', 'quinua', 'maiz', 'granadilla'];
  for (const c of cropList) {
    const norm = catalogService.normalizeCropName(c);
    const regex = new RegExp(`\\b${c}\\b`, 'i');
    if (regex.test(cleanQuestion)) return norm;
  }
  if (/\b(?:patata|papa\s+huayro|papa\s+canchan|papa\s+canchán)\b/i.test(cleanQuestion)) return 'papa';
  if (/\b(?:maca\s+amarilla|lepidium)\b/i.test(cleanQuestion)) return 'maca';
  if (/\b(?:café|cafe\s+arabica|café\s+arábica)\b/i.test(cleanQuestion)) return 'cafe';
  if (/\b(?:palta|aguacate|palta\s+hass)\b/i.test(cleanQuestion)) return 'palto';
  if (/\b(?:quinua\s+pasankalla)\b/i.test(cleanQuestion)) return 'quinua';
  return null;
}

function inferCategoryFromQuestion(cleanQuestion) {
  if (/\b(?:helada|heladas|frio|frío|bajo\s+cero|congelamiento|friaje)\b/i.test(cleanQuestion)) return 'heladas';
  if (/\b(?:granizo|granizada|granizos)\b/i.test(cleanQuestion)) return 'granizadas';
  if (/\b(?:lluvia|lluvias|encharcamiento|inundaci[oó]n)\b/i.test(cleanQuestion)) return 'lluvias_intensas';
  if (/\b(?:gorgojo|polilla|broca|pulg[oó]n|gusano|mosca|trips|plaga|plagas)\b/i.test(cleanQuestion)) return 'plagas';
  if (/\b(?:roya|rancha|hongo|bacteria|virus|marchitez|pudrici[oó]n|enfermedad|enfermedades)\b/i.test(cleanQuestion)) return 'enfermedades';
  if (/\b(?:riego|aspersi[oó]n|goteo|sequ[ií]a|d[eé]ficit\s+h[ií]drico|humedad|agua)\b/i.test(cleanQuestion)) return 'riego';
  if (/\b(?:suelo|suelos|descanso|rotaci[oó]n|purum|acidez|encalado|materia\s+org[aá]nica)\b/i.test(cleanQuestion)) return 'suelo';
  if (/\b(?:fertilizaci[oó]n|abono|compost|guano|biol|nutrici[oó]n)\b/i.test(cleanQuestion)) return 'nutricion';
  if (/\b(?:prevenci[oó]n|limpieza|semilla\s+certificada)\b/i.test(cleanQuestion)) return 'prevencion';
  if (/\b(?:cosecha|poscosecha|secado|almacenamiento)\b/i.test(cleanQuestion)) return 'poscosecha';
  return null;
}

function inferZoneFromQuestion(cleanQuestion) {
  if (/\b(?:puna|altoandin[ao]|meseta\s+del\s+bomb[oó]n|cerro\s+de\s+pasco|huayllay|vicco)\b/i.test(cleanQuestion)) {
    return 'zona_altoandina';
  }
  if (/\b(?:yanahuanca|valle|quechua|carri[oó]n|paucartambo|huariaca)\b/i.test(cleanQuestion)) {
    return 'valles_interandinos';
  }
  if (/\b(?:oxapampa|villa\s+rica|selva\s+alta|pozuzo|chontabamba)\b/i.test(cleanQuestion)) {
    return 'selva_alta';
  }
  return null;
}

class AgriculturalRetrieverService {
  constructor(options = {}) {
    this.knowledgeBaseDir = options.knowledgeBaseDir
      ? path.resolve(options.knowledgeBaseDir)
      : path.resolve(__dirname, '..', 'knowledge');

    this.catalogService = options.catalogService || new KnowledgeCatalogService();
    this.chunksPath = options.chunksPath || path.join(this.knowledgeBaseDir, 'chunks', 'active_knowledge_chunks.json');
    this.allowTestFixtures = options.allowTestFixtures === true;
  }

  /**
   * Carga los fragmentos activos disponibles para búsqueda
   * FILTRO DEFENSIVO: En modo oficial (por defecto), rechaza cualquier fragmento
   * sintético, no verificado, con licencia pendiente o sin procedencia oficial.
   */
  loadActiveChunks() {
    if (!fs.existsSync(this.chunksPath)) {
      return [];
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.chunksPath, 'utf8'));
      if (!Array.isArray(data)) return [];

      const activeDocIds = new Set(this.catalogService.getActiveDocuments().map(d => d.id));

      return data.filter(c => {
        // En modo oficial estricto (allowTestFixtures === false):
        if (!this.allowTestFixtures) {
          // 1. Debe pertenecer a un documento activo y elegible
          if (!activeDocIds.has(c.source_id)) return false;
          if (!this.catalogService.isEligibleForAdvisory(c.source_id)) return false;

          const docMeta = this.catalogService.getDocument(c.source_id);
          if (!docMeta) return false;

          // 2. Solo official_original o verified_extraction
          const nature = c.content_nature;
          if (nature !== 'official_original' && nature !== 'verified_extraction') return false;

          // 3. No puede ser sintético ni tener licencia pendiente o review_required
          if (c.is_synthetic || c.unverified_test_stub) return false;
          if (c.license_status === 'licencia_pendiente_revision' || c.license_status === 'review_required') return false;
          if (docMeta.license_status === 'licencia_pendiente_revision' || docMeta.license_status === 'review_required') return false;

          // 4. Verificación de identidad cruzada y anti-tampering general (L06D)
          if (docMeta.title && c.title && docMeta.title.trim().toLowerCase() !== c.title.trim().toLowerCase()) return false;
          if (docMeta.year && c.publication_year && Number(docMeta.year) !== Number(c.publication_year)) return false;
          if (docMeta.official_url && c.source_url && docMeta.official_url.trim().toLowerCase() !== c.source_url.trim().toLowerCase()) return false;
          if (docMeta.origin_file_sha256 && c.origin_file_sha256 && docMeta.origin_file_sha256 !== c.origin_file_sha256) return false;

          // 5. Rechazo estricto de discrepancias bibliográficas conocidas (Auditoría L06C)
          const urlStr = (docMeta.official_url || c.source_url || '').toLowerCase();
          if ((c.source_id === 'DOC-INIA-PAPA-001' || (c.crops && c.crops.includes('papa'))) && urlStr.includes('/1043')) return false;
          if ((c.source_id === 'DOC-INIA-MACA-002' || (c.crops && c.crops.includes('maca'))) && urlStr.includes('/263')) return false;
          if ((c.source_id === 'DOC-INIA-CAFE-003' || (c.crops && c.crops.includes('cafe'))) && urlStr.includes('/442')) return false;
          if ((c.source_id === 'DOC-INIA-OLLUCO-007' || (c.crops && c.crops.includes('olluco'))) && urlStr.includes('/691')) return false;
          if ((c.source_id === 'DOC-INIA-GRANADILLA-008' || (c.crops && c.crops.includes('granadilla'))) && urlStr.includes('/921')) return false;
          if ((c.source_id === 'DOC-INIA-PALTO-009' || (c.crops && c.crops.includes('palto'))) && urlStr.includes('/1280')) return false;
        } else {
          // En modo test de componentes / fixtures aislados:
          const docMeta = this.catalogService.getDocument(c.source_id);
          // Rechazar documentos obsoletos, rechazados o archivados incluso en pruebas
          if (docMeta && (docMeta.status === 'superseded' || docMeta.status === 'rejected' || docMeta.status === 'archived')) {
            return false;
          }
          if (c.status === 'superseded' || c.status === 'rejected' || c.status === 'archived') {
            return false;
          }
          const testEligibleDocIds = new Set(
            this.catalogService.getAllDocuments()
              .filter(d => d.status === 'active' || d.status === 'approved')
              .map(d => d.id)
          );
          if (!testEligibleDocIds.has(c.source_id) && c.status !== 'approved' && c.status !== 'active') {
            return false;
          }
        }

        return true;
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Formatea la referencia de citación distinguiendo página digital y página impresa
   */
  formatCitationReference(chunk) {
    let pageCitation = chunk.section_title || 'Sección técnica';
    const pdfPage = chunk.pdf_page_number || chunk.page_number;
    const printedPage = chunk.printed_page_number;
    const printedVerified = chunk.printed_page_verified === true;

    if (printedVerified && printedPage) {
      pageCitation = `Página digital ${pdfPage} (Pág. impresa ${printedPage})`;
    } else if (chunk.source_page_verified && pdfPage) {
      pageCitation = `Página digital ${pdfPage}`;
    } else if (pdfPage) {
      pageCitation = `Página digital ${pdfPage}`;
    }

    return {
      page_or_section: pageCitation,
      pdf_page_index: typeof chunk.pdf_page_index === 'number' ? chunk.pdf_page_index : (pdfPage ? pdfPage - 1 : null),
      pdf_page_number: pdfPage || null,
      printed_page_number: (printedVerified && printedPage) ? printedPage : null,
      printed_page_verified: printedVerified
    };
  }

  /**
   * Interfaz oficial de recuperación documental para RAG (L07)
   *
   * @param {Object} queryParams
   * @param {string} queryParams.question Pregunta agronómica del productor
   * @param {string} [queryParams.crop] Cultivo consultado (e.g. 'papa', 'maca')
   * @param {string} [queryParams.problemCategory] Categoría (e.g. 'plagas', 'heladas')
   * @param {string} [queryParams.ecologicalContext] Zona (e.g. 'zona_altoandina', 'selva_alta')
   * @param {number} [queryParams.maxResults=3] Número máximo de fragmentos a recuperar
   * @param {number} [queryParams.minScoreThreshold=0.2] Umbral mínimo de relevancia
   */
  async retrieveAgriculturalEvidence(queryParams = {}) {
    const {
      question,
      crop,
      problemCategory,
      ecologicalContext,
      maxResults = 3,
      minScoreThreshold = 0.2
    } = queryParams;

    // 1. Validación de entrada
    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return {
        evidence_status: 'insufficient_evidence',
        message: 'Pregunta agronómica no especificada o demasiado corta para realizar búsqueda documental.',
        total_found: 0,
        results: [],
        audit: { query: question, crop, problemCategory, timestamp: new Date().toISOString() }
      };
    }

    const cleanQuestion = question.trim().toLowerCase();
    const cleanCrop = crop ? this.catalogService.normalizeCropName(crop) : inferCropFromQuestion(cleanQuestion, this.catalogService);
    const cleanCategory = problemCategory ? String(problemCategory).trim().toLowerCase() : inferCategoryFromQuestion(cleanQuestion);
    const cleanContext = ecologicalContext ? String(ecologicalContext).trim().toLowerCase() : inferZoneFromQuestion(cleanQuestion);

    // 2. Obtener fragmentos activos garantizados
    const candidateChunks = this.loadActiveChunks();
    if (candidateChunks.length === 0) {
      return {
        evidence_status: 'insufficient_evidence',
        message: INSUFFICIENT_EVIDENCE_MESSAGE,
        total_found: 0,
        results: [],
        audit: { query: cleanQuestion, chunks_in_index: 0, timestamp: new Date().toISOString() }
      };
    }

    // 2.1. Detección de intención bibliográfica sobre documentos históricos u obsoletos (FASE 9-L07C)
    // Si la consulta solicita antecedentes históricos, boletines antiguos o normativas derogadas,
    // se abstiene si no hay una fuente técnica oficial y vigente que cubra explícitamente dicha consulta.
    if (HISTORICAL_OR_UNAPPROVED_INTENT_REGEX.test(cleanQuestion)) {
      const hasExplicitHistoricalDoc = candidateChunks.some(c =>
        c.status === 'approved' && (c.excerpt.toLowerCase().includes('histórico') || (c.title && c.title.toLowerCase().includes('histórico')))
      );
      if (!hasExplicitHistoricalDoc) {
        return {
          evidence_status: 'insufficient_evidence',
          message: 'La consulta hace referencia a normativas, boletines históricos o documentos no vigentes que no forman parte de la biblioteca técnica activa de AgroPasco.',
          total_found: 0,
          results: [],
          audit: { query: cleanQuestion, intent: 'historical_or_unapproved_bibliographic_request', timestamp: new Date().toISOString() }
        };
      }
    }

    // 3. Extracción de términos significativos preservando negaciones y separando términos agronómicos genéricos
    const allTerms = cleanQuestion
      .replace(/[¿?¡!.,;:()\[\]"'/\\_-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && (!SPANISH_STOP_WORDS.has(t) || PRESERVED_NEGATIONS.has(t)));

    const terms = allTerms;
    const thematicTerms = allTerms.filter(t => !GENERIC_AGRONOMIC_STOPWORDS.has(t));
    const effectiveTerms = thematicTerms.length > 0 ? thematicTerms : allTerms;

    const scored = [];
    const seenHashes = new Set();

    for (const chunk of candidateChunks) {
      // Exclusión estricta de documentos no aprobados, obsoletos o archivados
      if (chunk.status === 'superseded' || chunk.status === 'rejected' || chunk.status === 'archived') {
        continue;
      }

      const excerptLower = chunk.excerpt.toLowerCase();
      const titleLower = (chunk.title || '').toLowerCase();
      const sectionLower = (chunk.section_title || '').toLowerCase();
      let score = 0;

      // Deduplicación preventiva por hash o excerpt
      const dedupeKey = chunk.chunk_id || chunk.excerpt;
      if (seenHashes.has(dedupeKey)) continue;

      // 1. Coincidencia y penalización de cultivo
      const chunkCrops = Array.isArray(chunk.crops) ? chunk.crops.map(c => String(c).toLowerCase()) : [];
      const isGeneralDoc = chunkCrops.includes('general') || chunkCrops.length === 0;

      if (cleanCrop) {
        if (chunkCrops.includes(cleanCrop)) {
          score += 0.35;
        } else if (excerptLower.includes(cleanCrop) || titleLower.includes(cleanCrop)) {
          score += 0.25;
        } else if (!isGeneralDoc) {
          // Penalización severa ante conflicto de cultivo específico (evita priorizar papa en cafe)
          score -= 0.60;
        }
      }

      // 2. Coincidencia de categoría de problema (verificada en fragmento o sección, no solo título global)
      if (cleanCategory) {
        if (chunk.problem_category === cleanCategory) {
          score += 0.25;
        } else if (excerptLower.includes(cleanCategory) || sectionLower.includes(cleanCategory)) {
          score += 0.15;
        }
      }

      // 3. Coincidencia de piso ecológico
      if (cleanContext) {
        const zones = Array.isArray(chunk.application_zones) ? chunk.application_zones : [];
        if (zones.includes(cleanContext)) {
          score += 0.15;
        } else if (zones.some(z => cleanContext.includes(z) || z.includes(cleanContext))) {
          score += 0.10;
        }
      }

      // 4. Coincidencia léxica temática (BM25 simplificado determinista sin inflación de palabras genéricas)
      let matchedThematicCount = 0;
      let titleThematicMatches = 0;

      if (effectiveTerms.length > 0) {
        for (const term of effectiveTerms) {
          const regex = new RegExp(`\\b${term}\\b`, 'i');
          if (regex.test(excerptLower)) {
            matchedThematicCount++;
          } else if (excerptLower.includes(term)) {
            matchedThematicCount += 0.7;
          }
          if (regex.test(titleLower) || regex.test(sectionLower)) {
            titleThematicMatches++;
          }
        }
        const termRatio = matchedThematicCount / effectiveTerms.length;
        score += Math.min(0.40, termRatio * 0.35 + (titleThematicMatches > 0 ? 0.05 : 0));
      }

      // Regla de Relevancia Defendible para Documentos Generales (FASE 9-L07C):
      // Un documento general (e.g. acidez de suelo, encalado) puede aplicarse a otros cultivos o cultivos nuevos,
      // pero requiere que exista una afinidad temática real (categoría agronómica específica o coincidencia temática sustantiva).
      // Palabras genéricas como "cultivo" o "manejo" no justifican por sí solas su recuperación.
      if (isGeneralDoc && cleanCrop && !chunkCrops.includes(cleanCrop)) {
        const hasSpecificCategoryMatch = cleanCategory && cleanCategory !== 'manejo' && chunk.problem_category === cleanCategory;
        const hasSubstantiveThematicMatch = matchedThematicCount >= 1;

        if (!hasSpecificCategoryMatch && !hasSubstantiveThematicMatch) {
          score = 0;
        }
      }

      // 5. Bonificación por documento oficial con página verificada (solo si hay evidencia temática base > 0)
      if (chunk.source_page_verified && score > 0) {
        score += 0.05;
      }

      const finalScore = parseFloat(Math.max(0.0, Math.min(1.0, score)).toFixed(3));

      if (finalScore >= minScoreThreshold) {
        seenHashes.add(dedupeKey);

        // Sanitización contra inyección de prompts y evaluación agronómica
        const sanitized = sanitizeExcerpt(chunk.excerpt);
        const safetyAssessment = assessAgronomicSafety(sanitized.cleanExcerpt);

        const combinedSafetyFlags = Array.from(new Set([
          ...(chunk.safety_flags || []),
          ...safetyAssessment.flags,
          ...(sanitized.hasInjectionAttempt ? ['prompt_injection_attempt_detected'] : [])
        ]));

        const requiresHumanReview = Boolean(
          chunk.mandatory_human_review ||
          safetyAssessment.requiresReview ||
          sanitized.hasInjectionAttempt
        );

        let safetyNotice = chunk.safety_notice || null;
        if (requiresHumanReview) {
          safetyNotice = (safetyNotice ? safetyNotice + ' ' : '') + 
            '[CONTROL AGRONÓMICO]: Toda aplicación fitosanitaria o dosis química debe ser refrendada por la Dirección de Sanidad Vegetal de SENASA.';
        }

        const citation = this.formatCitationReference(chunk);
        const docMeta = this.catalogService.getDocument(chunk.source_id);
        const lastVerified = docMeta?.verification_date || docMeta?.last_verified_at || chunk.created_at || new Date().toISOString();

        // FAIL-CLOSED H-02: Censura determinista de prescripciones químicas no validadas
        const finalExcerpt = safetyAssessment.hasUnvalidatedChemical
          ? redactChemicalPrescriptions(sanitized.cleanExcerpt)
          : sanitized.cleanExcerpt;

        scored.push({
          source_id: chunk.source_id,
          institution: chunk.institution || docMeta?.institution || 'INIA - Perú',
          title: chunk.title || docMeta?.title || 'Documento Técnico Oficial',
          authors: docMeta?.authors || chunk.authors || null,
          publication_year: chunk.publication_year || docMeta?.year || null,
          source_url: chunk.source_url || docMeta?.official_url || null,
          page_or_section: citation.page_or_section,
          pdf_page_index: citation.pdf_page_index,
          pdf_page_number: citation.pdf_page_number,
          printed_page_number: citation.printed_page_number,
          printed_page_verified: citation.printed_page_verified,
          is_double_page_spread: Boolean(chunk.is_double_page_spread),
          excerpt: finalExcerpt,
          status: chunk.status,
          content_nature: chunk.content_nature,
          source_page_verified: Boolean(chunk.source_page_verified),
          relevance: finalScore,
          relevance_score: finalScore,
          source_file_sha256: chunk.origin_file_sha256 || chunk.source_file_sha256 || docMeta?.origin_file_sha256 || null,
          license_status: chunk.license_status || docMeta?.license_status || 'licencia_pendiente_revision',
          verification_status: chunk.status || docMeta?.status || 'verified',
          last_verified_at: lastVerified,
          crops: chunk.crops || [],
          problem_category: chunk.problem_category || 'manejo_cultivo',
          application_zones: chunk.application_zones || [],
          mandatory_human_review: requiresHumanReview,
          requires_human_review: requiresHumanReview,
          has_unvalidated_chemical_prescription: safetyAssessment.hasUnvalidatedChemical,
          operative_prescription_blocked: safetyAssessment.hasUnvalidatedChemical,
          has_injection_attempt: sanitized.hasInjectionAttempt,
          safety_flags: combinedSafetyFlags,
          safety_notice: safetyNotice,
          chunk_id: chunk.chunk_id
        });
      }
    }

    // 4. Ordenar por relevancia descendente
    scored.sort((a, b) => b.relevance_score - a.relevance_score);

    const results = scored.slice(0, maxResults);

    // 5. Determinar estado de la evidencia
    if (results.length === 0) {
      return {
        evidence_status: 'insufficient_evidence',
        message: INSUFFICIENT_EVIDENCE_MESSAGE,
        total_found: 0,
        results: [],
        audit: { query: cleanQuestion, terms_searched: terms, timestamp: new Date().toISOString() }
      };
    }

    return {
      evidence_status: 'evidence_found',
      message: `Se encontraron ${results.length} fragmento(s) técnico(s) verificados en la biblioteca oficial de AgroPasco.`,
      total_found: results.length,
      results,
      audit: {
        query: cleanQuestion,
        crop: cleanCrop,
        problem_category: cleanCategory,
        ecological_context: cleanContext,
        top_score: results[0].relevance_score,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = {
  AgriculturalRetrieverService,
  INSUFFICIENT_EVIDENCE_MESSAGE
};
