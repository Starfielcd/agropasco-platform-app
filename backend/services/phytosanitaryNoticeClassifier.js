/**
 * AgroPasco Digital — Clasificador y Vocabulario Fitosanitario Oficial
 * ==============================================================================
 * FASE 9-L08: Vigilancia Fitosanitaria Oficial y Trazabilidad Documental
 *
 * Funcionalidades:
 *  - Categorización determinista de publicaciones fitosanitarias (Sección 6).
 *  - Normalización taxonómica de plagas y sinónimos comunes en la Región Pasco.
 *  - Normalización de cultivos afectados y compatibilidad agronómica.
 *  - Cero prescripciones químicas automáticas; generación de advertencias preventivas.
 */

// 1. Categorías oficiales de publicaciones fitosanitarias (Sección 6)
const NOTICE_TYPES = {
  ALERTA_FITOSANITARIA: 'alerta_fitosanitaria_declarada',
  EMERGENCIA_FITOSANITARIA: 'emergencia_fitosanitaria_declarada',
  RESOLUCION_CONTROL_OFICIAL: 'resolucion_control_oficial',
  AVISO_VIGILANCIA: 'aviso_vigilancia',
  COMUNICADO_INFORMATIVO: 'comunicado_informativo',
  RECOMENDACION_GENERAL: 'recomendacion_general',
  REPORTE_HISTORICO: 'reporte_historico',
  NO_CLASIFICADO: 'publicacion_sin_clasificacion_confirmada'
};

// 2. Estados de ciclo de vida del aviso (Sección 7)
const NOTICE_STATUSES = {
  DISCOVERED: 'discovered',
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
  REVIEW_REQUIRED: 'review_required',
  APPROVED: 'approved',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded',
  EXPIRED: 'expired',
  WITHDRAWN: 'withdrawn',
  UNKNOWN_VALIDITY: 'unknown_validity'
};

// 3. Niveles de severidad oficial y prioridad interna
const OFFICIAL_SEVERITIES = {
  EMERGENCIA: 'emergencia',
  ALERTA_ROJA: 'alerta_roja',
  ALERTA_AMARILLA: 'alerta_amarilla',
  CONTROL_OFICIAL: 'control_oficial',
  VIGILANCIA: 'vigilancia',
  INFORMATIVO: 'informativo',
  NO_ESPECIFICADA: 'no_especificada'
};

const INTERNAL_PRIORITIES = {
  CRITICA: 'critica',
  ALTA: 'alta',
  MEDIA: 'media',
  BAJA: 'baja'
};

// 4. Ámbitos geográficos oficiales permitidos
const SCOPE_TYPES = {
  NACIONAL: 'nacional',
  DEPARTAMENTAL: 'departamental',
  PROVINCIAL: 'provincial',
  DISTRITAL: 'distrital',
  INDETERMINADO: 'indeterminado'
};

// 5. Diccionario de plagas cuarentenarias y de control oficial en Perú (SENASA / Pasco)
const KNOWN_PESTS = [
  {
    scientific_name: 'Phytophthora infestans',
    common_names: ['rancha', 'tizón tardío', 'tizon tardio', 'hielo'],
    primary_crops: ['papa'],
    type: 'hongo'
  },
  {
    scientific_name: 'Premnotrypes vorax',
    common_names: ['gorgojo de los andes', 'gusano blanco de la papa', 'gorgojo'],
    primary_crops: ['papa'],
    type: 'insecto'
  },
  {
    scientific_name: 'Tecia solanivora',
    common_names: ['polilla guatemalteca de la papa', 'polilla guatemalteca'],
    primary_crops: ['papa'],
    type: 'insecto',
    quarantine: true
  },
  {
    scientific_name: 'Hemileia vastatrix',
    common_names: ['roya del café', 'roya del cafeto', 'roya'],
    primary_crops: ['cafe'],
    type: 'hongo'
  },
  {
    scientific_name: 'Hypothenemus hampei',
    common_names: ['broca del café', 'broca del fruto del cafeto', 'broca'],
    primary_crops: ['cafe'],
    type: 'insecto'
  },
  {
    scientific_name: 'Fusarium oxysporum f. sp. cubense Raza 4 Tropical',
    common_names: ['fusarium r4t', 'mal de panamá r4t', 'fusariosis del banano'],
    primary_crops: ['platano', 'banano'],
    type: 'hongo',
    quarantine: true
  },
  {
    scientific_name: 'Phthorimaea operculella',
    common_names: ['polilla común de la papa', 'polilla de la papa'],
    primary_crops: ['papa'],
    type: 'insecto'
  },
  {
    scientific_name: 'Eurysacca melanocampta',
    common_names: ['kcona kcona', 'polilla de la quinua'],
    primary_crops: ['quinua'],
    type: 'insecto'
  },
  {
    scientific_name: 'Phytophthora cinnamomi',
    common_names: ['pudrición radicular del palto', 'tristeza del palto', 'asfixia radicular'],
    primary_crops: ['palto'],
    type: 'pseudohongo'
  }
];

// 6. Sinónimos y normalización canónica de cultivos en Pasco
const CROP_CANONICAL_MAP = {
  papa: 'papa',
  patata: 'papa',
  'papa canchán': 'papa',
  'papa canchan': 'papa',
  'papa amarilla': 'papa',
  'papa nativa': 'papa',
  cafe: 'cafe',
  café: 'cafe',
  'café arábica': 'cafe',
  'cafe arabica': 'cafe',
  'café catimor': 'cafe',
  maca: 'maca',
  maka: 'maca',
  quinua: 'quinua',
  quinoa: 'quinua',
  palto: 'palto',
  aguacate: 'palto',
  palta: 'palto',
  'palta hass': 'palto',
  'palto hass': 'palto',
  platano: 'platano',
  plátano: 'platano',
  banano: 'platano',
  granadilla: 'granadilla',
  olluco: 'olluco',
  ulluco: 'olluco',
  general: 'general'
};

/**
 * Normaliza el nombre de un cultivo a su forma canónica
 */
function normalizeCrop(cropName) {
  if (!cropName || typeof cropName !== 'string') return null;
  const clean = cropName.trim().toLowerCase();
  return CROP_CANONICAL_MAP[clean] || clean;
}

/**
 * Clasifica de forma determinista el tipo de publicación fitosanitaria (Sección 6)
 */
function classifyNoticeType({ title = '', excerpt = '', documentNumber = '', isOfficial = false }) {
  const text = `${title} ${excerpt} ${documentNumber}`.toLowerCase();

  // B. Emergencia Fitosanitaria declarada
  if (/\b(?:emergencia\s+fitosanitaria|declara(?:se)?\s+en\s+emergencia\s+sanitaria|zona\s+de\s+emergencia\s+fitosanitaria)\b/i.test(text)) {
    return NOTICE_TYPES.EMERGENCIA_FITOSANITARIA;
  }

  // A. Alerta Fitosanitaria formal declarada
  if (/\b(?:alerta\s+fitosanitaria(?:\s+nacional|\s+regional)?|declaratoria\s+de\s+alerta\s+fitosanitaria)\b/i.test(text)) {
    return NOTICE_TYPES.ALERTA_FITOSANITARIA;
  }

  // C. Resolución de Control Oficial
  if (/\b(?:resoluci[oó]n\s+(?:directoral|jefatural|ministerial)|establecen\s+medidas\s+cuarentenarias|reglamentaci[oó]n\s+cuarentenaria|control\s+oficial\s+de\s+la\s+plaga)\b/i.test(text) ||
      /\b(?:r\.?d\.?|r\.?j\.?)\s*n[°o]?\s*\d+/i.test(text)) {
    return NOTICE_TYPES.RESOLUCION_CONTROL_OFICIAL;
  }

  // G. Reporte Histórico / Derogado
  if (/\b(?:hist[oó]ric[ao]|campa[ñn]a\s+20(?:0\d|1\d)\b|bolet[ií]n\s+(?:de\s+)?19\d\d|norma\s+derogada|vigencia\s+concluida)\b/i.test(text)) {
    return NOTICE_TYPES.REPORTE_HISTORICO;
  }

  // D. Aviso de Vigilancia
  if (/\b(?:aviso\s+de\s+vigilancia|bolet[ií]n\s+de\s+vigilancia|monitoreo\s+estacional|trampeo\s+y\s+detecci[oó]n|alerta\s+temprana\s+de\s+monitoreo)\b/i.test(text)) {
    return NOTICE_TYPES.AVISO_VIGILANCIA;
  }

  // E. Comunicado Informativo
  if (/\b(?:comunicado(?:\s+oficial|\s+institucional)?|nota\s+de\s+prensa|noticia\s+institucional|senasa\s+informa|visita\s+de\s+inspecci[oó]n)\b/i.test(text)) {
    return NOTICE_TYPES.COMUNICADO_INFORMATIVO;
  }

  // F. Recomendación General
  if (/\b(?:gu[ií]a\s+técnica|recomendaciones\s+preventivas|buenas\s+pr[aá]cticas\s+agr[ií]colas|manual\s+de\s+manejo)\b/i.test(text)) {
    return NOTICE_TYPES.RECOMENDACION_GENERAL;
  }

  // H. Publicación sin clasificación confirmada
  return NOTICE_TYPES.NO_CLASIFICADO;
}

/**
 * Infiere o extrae plagas conocidas mencionadas en el texto
 */
function extractPests(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.toLowerCase();
  const matched = [];

  for (const pest of KNOWN_PESTS) {
    const sciMatch = clean.includes(pest.scientific_name.toLowerCase());
    const commonMatch = pest.common_names.some(cn => {
      const rx = new RegExp(`\\b${cn}\\b`, 'i');
      return rx.test(clean);
    });

    if (sciMatch || commonMatch) {
      matched.push({
        scientific_name: pest.scientific_name,
        common_name: pest.common_names[0],
        crops: pest.primary_crops,
        is_quarantine: Boolean(pest.quarantine)
      });
    }
  }

  return matched;
}

/**
 * Infiere la prioridad interna a partir de la severidad oficial y el tipo de publicación
 */
function inferPriority(noticeType, officialSeverity) {
  if (noticeType === NOTICE_TYPES.EMERGENCIA_FITOSANITARIA || officialSeverity === OFFICIAL_SEVERITIES.EMERGENCIA) {
    return INTERNAL_PRIORITIES.CRITICA;
  }
  if (noticeType === NOTICE_TYPES.ALERTA_FITOSANITARIA || officialSeverity === OFFICIAL_SEVERITIES.ALERTA_ROJA) {
    return INTERNAL_PRIORITIES.ALTA;
  }
  if (noticeType === NOTICE_TYPES.RESOLUCION_CONTROL_OFICIAL || officialSeverity === OFFICIAL_SEVERITIES.CONTROL_OFICIAL || officialSeverity === OFFICIAL_SEVERITIES.ALERTA_AMARILLA) {
    return INTERNAL_PRIORITIES.MEDIA;
  }
  return INTERNAL_PRIORITIES.BAJA;
}

/**
 * Genera una recomendación pública preventiva estrictamente informativa (Sección 10).
 * CERO DOSIS, CERO QUÍMICOS Y CERO PRESCRIPCIONES.
 */
function buildPublicPreventiveAction({ pestCommonName = '', affectedCrops = [], isQuarantine = false }) {
  const cropStr = affectedCrops.length > 0 ? ` en parcelas de ${affectedCrops.join(', ')}` : '';
  const quarantineWarning = isQuarantine ? ' Al ser una plaga cuarentenaria reglamentada, su reporte a las autoridades es de carácter obligatorio.' : '';

  return (
    `Inspeccione visualmente el follaje, brotes y frutos${cropStr} para detectar signos o síntomas sospechosos.` +
    ` En caso de sospecha de ${pestCommonName || 'la plaga'}, no aplique sustancias químicas sin indicación oficial y comuníquese inmediatamente con el asesor técnico de su cooperativa o con la Oficina Zonal de SENASA Pasco.` +
    quarantineWarning
  );
}

module.exports = {
  NOTICE_TYPES,
  NOTICE_STATUSES,
  OFFICIAL_SEVERITIES,
  INTERNAL_PRIORITIES,
  SCOPE_TYPES,
  KNOWN_PESTS,
  CROP_CANONICAL_MAP,
  normalizeCrop,
  classifyNoticeType,
  extractPests,
  inferPriority,
  buildPublicPreventiveAction
};
