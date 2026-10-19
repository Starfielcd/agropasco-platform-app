/**
 * AgroPasco Digital — Servicio de Fragmentación Documental (Chunking) y Metadatos
 * ==============================================================================
 * FASE 9-L06: Chunking reproducible, preservación de advertencias y seguridad agronómica
 *
 * Características clave:
 *  - Fragmentación semántica basada en párrafos y oraciones
 *  - Preservación íntegra de advertencias ("⚠️ ALERTA", "ATENCIÓN", "PRECAUCIÓN")
 *  - Metadatos agronómicos normalizados (cultivo, problema, piso ecológico, aplicabilidad)
 *  - Marcado de seguridad agronómica obligatoria (mandatory_human_review) ante:
 *      * Sustancias químicas / plaguicidas de síntesis
 *      * Dosis numéricas por hectárea o por litro
 *      * Frecuencias de aplicación
 *      * Organismos cuarentenarios
 *  - Hash SHA-256 de integridad por cada fragmento
 *  - Trazabilidad y auditoría exacta de página de origen
 */

const crypto = require('crypto');

// Palabras clave y patrones de seguridad agronómica
const CHEMICAL_SUBSTANCE_REGEX = /\b(?:clorpirifos|metamidofos|carbofuran|glifosato|mancozeb|paration|cipermetrina|imidacloprid|abamectina|deltametrina|malation|endosulfan|dithiocarbamatos|plaguicida|insecticida\s+quimico|agroquimico)\b/i;
const NUMERIC_DOSAGE_REGEX = /\b(?:\d+(?:[.,]\d+)?\s*(?:ml\/l|cc\/l|l\/ha|kg\/ha|g\/l|cc\/mochila|litros\/ha|gramos\/ha|ppm|%))\b/i;
const APPLICATION_FREQUENCY_REGEX = /\b(?:aplicar\s+cada\s+\d+|repetir\s+a\s+los\s+\d+|frecuencia\s+de\s+\d+\s+d[ií]as|intervalo\s+de\s+\d+)\b/i;
const QUARANTINE_PEST_REGEX = /\b(?:cuarentenari[ao]|tecia\s+solanivora|polilla\s+guatemalteca|moniliophthora|fusarium\s+oxysporum|raza\s+4\s+tropical|plaga\s+reglamentada)\b/i;

const PROBLEM_CATEGORIES = new Set([
  'plagas',
  'enfermedades',
  'heladas',
  'granizadas',
  'lluvias_intensas',
  'riego',
  'suelo',
  'nutricion',
  'manejo_cultivo',
  'prevencion',
  'poscosecha'
]);

class DocumentChunkerService {
  constructor(options = {}) {
    this.targetChunkChars = options.targetChunkChars || 500;
    this.minChunkChars = options.minChunkChars || 120;
    this.maxChunkChars = options.maxChunkChars || 1000;
    this.overlapChars = options.overlapChars || 60;
  }

  /**
   * Calcula el hash SHA-256 de un fragmento de texto
   */
  computeHash(text) {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  /**
   * Analiza un fragmento en busca de directivas químicas o agronómicamente peligrosas
   */
  assessAgronomicSafety(text) {
    const flags = [];

    if (CHEMICAL_SUBSTANCE_REGEX.test(text)) {
      flags.push('mencion_sustancia_quimica_o_plaguicida');
    }
    if (NUMERIC_DOSAGE_REGEX.test(text)) {
      flags.push('presencia_de_dosis_numerica');
    }
    if (APPLICATION_FREQUENCY_REGEX.test(text)) {
      flags.push('frecuencia_de_aplicacion_especificada');
    }
    if (QUARANTINE_PEST_REGEX.test(text)) {
      flags.push('alerta_organismo_o_plaga_cuarentenaria');
    }

    const mandatoryReview = flags.length > 0;

    return {
      mandatory_human_review: mandatoryReview,
      safety_flags: flags,
      safety_notice: mandatoryReview
        ? 'Este fragmento contiene menciones a dosis, agroquímicos o medidas sanitarias. Requiere contrastación obligatoria con el registro vigente de SENASA antes de cualquier recomendación al agricultor.'
        : null
    };
  }

  /**
   * Identifica la categoría de problema agrícola predominante en el texto
   */
  inferProblemCategory(text, defaultCategory = 'manejo_cultivo') {
    const lower = text.toLowerCase();
    if (/\b(?:helada|heladas|temperatura\s+bajo\s+cero|congelamiento|friaje)\b/.test(lower)) {
      return 'heladas';
    }
    if (/\b(?:granizo|granizada|granizos)\b/.test(lower)) {
      return 'granizadas';
    }
    if (/\b(?:lluvia\s+intensa|inundaci[oó]n|encharcamiento|exceso\s+h[ií]drico)\b/.test(lower)) {
      return 'lluvias_intensas';
    }
    if (/\b(?:gorgojo|polilla|broca|pulg[oó]n|gusano|mosca|trips|insecto|plaga|plagas)\b/.test(lower)) {
      return 'plagas';
    }
    if (/\b(?:roya|rancha|hongo|bacteria|virus|marchitez|pudrici[oó]n|enfermedad|enfermedades)\b/.test(lower)) {
      return 'enfermedades';
    }
    if (/\b(?:riego|aspersi[oó]n|goteo|sequ[ií]a|d[eé]ficit\s+h[ií]drico|humedad\s+del\s+suelo)\b/.test(lower)) {
      return 'riego';
    }
    if (/\b(?:fertilizaci[oó]n|abono|compost|guano|biol|nitr[oó]geno|f[oó]sforo|potasio|nutrici[oó]n)\b/.test(lower)) {
      return 'nutricion';
    }
    if (/\b(?:suelo|preparaci[oó]n|mullido|arado|acidez|encalado|materia\s+org[aá]nica)\b/.test(lower)) {
      return 'suelo';
    }
    if (/\b(?:cosecha|poscosecha|secado|almacenamiento|selecci[oó]n|calidad|trilla)\b/.test(lower)) {
      return 'poscosecha';
    }
    if (/\b(?:prevenci[oó]n|rotaci[oó]n|semilla\s+certificada|limpieza)\b/.test(lower)) {
      return 'prevencion';
    }
    return defaultCategory;
  }

  /**
   * Determina la aplicabilidad del fragmento
   */
  inferApplicability(text, docZones = []) {
    const lower = text.toLowerCase();
    if (/\b(?:floraci[oó]n|tuberizaci[oó]n|siembra|emergencia|maduraci[oó]n|cosecha)\b/.test(lower)) {
      return 'dependiente_etapa_fenologica';
    }
    if (/\b(?:lluvia|noche\s+despejada|humedad\s+alta|sequ[ií]a|viento)\b/.test(lower)) {
      return 'dependiente_condiciones_ambientales';
    }
    if (docZones.length > 0 && (docZones.includes('meseta_del_bombon') || docZones.includes('oxapampa_villa_rica'))) {
      return 'especifica_zona';
    }
    return 'especifica_cultivo';
  }

  /**
   * Fragmenta el texto de una página respetando párrafos y fronteras de oraciones
   */
  chunkPageText(pageText) {
    if (!pageText || pageText.trim().length === 0) return [];

    // Dividir en párrafos naturales
    const rawParagraphs = pageText.split(/\r?\n\s*\r?\n/);
    const paragraphs = [];

    // Normalizar párrafos y unir advertencias cortas con el párrafo subsiguiente
    for (let i = 0; i < rawParagraphs.length; i++) {
      let p = rawParagraphs[i].trim().replace(/\s+/g, ' ');
      if (p.length === 0) continue;

      // Si el párrafo es una alerta o advertencia pura (p. ej. "⚠️ ALERTA:")
      // se enlaza con el párrafo que explica la directiva para no mutilar el aviso
      if (/^(?:⚠️|¡|ALERTA|ATENCIÓN|IMPORTANTE|PRECAUCIÓN)\b/i.test(p) && i + 1 < rawParagraphs.length && p.length < 100) {
        p = p + ' ' + rawParagraphs[i + 1].trim().replace(/\s+/g, ' ');
        i++; // saltar el siguiente
      }
      paragraphs.push(p);
    }

    const chunks = [];
    let currentBuffer = '';

    for (const paragraph of paragraphs) {
      if (currentBuffer.length === 0) {
        currentBuffer = paragraph;
      } else if (currentBuffer.length + paragraph.length + 1 <= this.targetChunkChars) {
        currentBuffer += '\n\n' + paragraph;
      } else {
        // El búfer actual alcanzó el tamaño objetivo
        if (currentBuffer.length >= this.minChunkChars) {
          chunks.push(currentBuffer.trim());
          // Calcular solapamiento si es posible
          const sentences = currentBuffer.split(/(?<=[.!?])\s+/);
          const lastSentence = sentences[sentences.length - 1] || '';
          if (lastSentence.length <= this.overlapChars && lastSentence.length > 20) {
            currentBuffer = lastSentence + '\n\n' + paragraph;
          } else {
            currentBuffer = paragraph;
          }
        } else {
          currentBuffer += '\n\n' + paragraph;
        }
      }

      // Si un solo párrafo excede el tamaño máximo, se divide por oraciones
      if (currentBuffer.length > this.maxChunkChars) {
        const sentences = currentBuffer.split(/(?<=[.!?])\s+/);
        let subBuffer = '';
        for (const s of sentences) {
          if (subBuffer.length + s.length + 1 <= this.targetChunkChars) {
            subBuffer += (subBuffer.length > 0 ? ' ' : '') + s;
          } else {
            if (subBuffer.length >= this.minChunkChars) {
              chunks.push(subBuffer.trim());
            }
            subBuffer = s;
          }
        }
        currentBuffer = subBuffer;
      }
    }

    if (currentBuffer.trim().length >= this.minChunkChars) {
      chunks.push(currentBuffer.trim());
    } else if (chunks.length > 0 && currentBuffer.trim().length > 0) {
      // Unir el resto con el último fragmento para evitar fragmentos huérfanos minúsculos
      chunks[chunks.length - 1] += '\n\n' + currentBuffer.trim();
    } else if (currentBuffer.trim().length > 0) {
      chunks.push(currentBuffer.trim());
    }

    return chunks;
  }

  /**
   * Procesa la extracción de un documento y genera la lista completa de fragmentos estructurados
   */
  generateChunks(extractionResult, docMetadata) {
    if (!extractionResult || !extractionResult.success) {
      throw new Error('No se pueden generar fragmentos de una extracción fallida.');
    }
    if (!docMetadata || typeof docMetadata !== 'object') {
      throw new Error('Metadatos de documento requeridos para generar fragmentos.');
    }

    const allChunks = [];
    const seenHashes = new Set();
    let globalSequence = 1;

    for (const page of extractionResult.pages) {
      // Omitir páginas ilegibles
      if (page.is_unreadable) {
        continue;
      }

      const textChunks = this.chunkPageText(page.raw_text);

      for (let seq = 0; seq < textChunks.length; seq++) {
        const text = textChunks[seq];
        const hash = this.computeHash(text);

        // Deduplicación exacta de fragmentos idénticos
        if (seenHashes.has(hash)) {
          continue;
        }
        seenHashes.add(hash);

        const safety = this.assessAgronomicSafety(text);
        const problemCategory = this.inferProblemCategory(
          text,
          Array.isArray(docMetadata.problems_addressed) && docMetadata.problems_addressed[0]
            ? docMetadata.problems_addressed[0]
            : 'manejo_cultivo'
        );
        const applicability = this.inferApplicability(text, docMetadata.application_zones || []);

        const chunkId = `CHK-${docMetadata.id}-P${String(page.page_number).padStart(2, '0')}-${String(globalSequence).padStart(3, '0')}`;
        const isPdf = extractionResult.file_type === 'pdf';
        const isSynthetic = docMetadata.content_nature === 'synthetic_fixture' || 
                            docMetadata.content_nature === 'unverified_test_stub' ||
                            docMetadata.id.includes('TEST') ||
                            (extractionResult.file_name && (extractionResult.file_name.endsWith('.md') || extractionResult.file_name.endsWith('.txt')));

        allChunks.push({
          chunk_id: chunkId,
          source_id: docMetadata.id,
          institution: docMetadata.institution,
          title: docMetadata.title,
          publication_year: docMetadata.year,
          source_url: docMetadata.official_url,
          page_number: page.page_number,
          pdf_page_index: page.page_number - 1,
          pdf_page_number: page.page_number,
          printed_page_number: (typeof page.printed_page_number === 'number' && page.printed_page_number > 0)
            ? page.printed_page_number
            : ((typeof docMetadata.printed_page_offset === 'number' && page.page_number + docMetadata.printed_page_offset > 0)
              ? page.page_number + docMetadata.printed_page_offset
              : null),
          printed_page_verified: Boolean(page.printed_page_verified || (typeof docMetadata.printed_page_offset === 'number' && page.page_number + docMetadata.printed_page_offset > 0)),
          is_double_page_spread: Boolean(docMetadata.is_double_page_spread),
          section_title: page.section_title || `Página digital ${page.page_number}`,
          excerpt: text,
          character_count: text.length,
          crops: docMetadata.related_crops || [],
          problem_category: problemCategory,
          application_zones: docMetadata.application_zones || [],
          applicability,
          status: docMetadata.status || 'candidate',
          content_nature: docMetadata.content_nature || (isSynthetic ? 'synthetic_fixture' : 'unverified_content'),
          origin_file_sha256: extractionResult.file_hash_sha256,
          extraction_method: extractionResult.extraction_engine || extractionResult.file_type || 'unknown',
          source_page_verified: isPdf && !isSynthetic && (docMetadata.content_nature === 'official_original' || docMetadata.content_nature === 'verified_extraction'),
          license_status: docMetadata.license_status || 'licencia_pendiente_revision',
          agronomic_safety_cleared: false,
          version: docMetadata.version || '1.0',
          has_table: Boolean(page.has_table),
          table_fallback: Boolean(page.table_fallback),
          has_unextracted_images: Boolean(page.has_unextracted_images),
          mandatory_human_review: safety.mandatory_human_review,
          safety_flags: safety.safety_flags,
          safety_notice: safety.safety_notice,
          integrity_hash: hash,
          created_at: new Date().toISOString()
        });

        globalSequence++;
      }
    }

    return allChunks;
  }
}

module.exports = {
  DocumentChunkerService,
  PROBLEM_CATEGORIES
};
