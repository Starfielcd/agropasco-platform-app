/**
 * AgroPasco Digital — Servicio de Evaluación de Relevancia Fitosanitaria por Parcela
 * ==============================================================================
 * FASE 9-L08: Vigilancia Fitosanitaria Oficial, Relevancia Agronómica y Trazabilidad
 *
 * Responsabilidades:
 *  - Evaluar la pertinencia de un aviso oficial respecto a una parcela específica (Secciones 8 y 9).
 *  - Diferenciar taxativamente los 4 estados canónicos de relevancia:
 *      * applicable_scope_confirmed
 *      * potentially_relevant
 *      * insufficient_geographic_information
 *      * not_applicable
 *  - Normalización de cultivos con sinónimos canónicos de la Región Pasco (Papa Canchán, Café arábica, Palta Hass, etc.).
 *  - Restricción geográfica estricta para las 3 provincias de Pasco (Pasco, Daniel Alcides Carrión, Oxapampa).
 *  - Cero afirmaciones de infección, cero diagnósticos automáticos y cero prescripciones químicas (Sección 10).
 *  - Preparación desacoplada de notificaciones sin envío real (Sección 14).
 */

const {
  NOTICE_STATUSES,
  SCOPE_TYPES,
  normalizeCrop
} = require('./phytosanitaryNoticeClassifier');

// Provincias y distritos oficiales del Departamento de Pasco
const PASCO_PROVINCES = {
  pasco: {
    canonical_name: 'Pasco',
    aliases: ['provincia de pasco', 'pasco', 'cerro de pasco'],
    districts: [
      'chaupimarca', 'yanacancha', 'tinyahuarco', 'huariaca', 'huachon', 'huachón',
      'huayllay', 'ninacaca', 'pallanchacra', 'paucartambo', 'san francisco de asis de yarusyacan',
      'simon bolivar', 'simón bolívar', 'ticlacayan', 'ticlacayán', 'vicco'
    ]
  },
  daniel_alcides_carrion: {
    canonical_name: 'Daniel Alcides Carrión',
    aliases: ['daniel alcides carrión', 'daniel alcides carrion', 'carrion', 'carrión', 'dac'],
    districts: [
      'yanahuanca', 'chacayan', 'chacayán', 'goyllarisquizga', 'paucar', 'páucar',
      'san pedro de pillao', 'santa ana de tusi', 'tusi', 'tapuc', 'tápuc', 'vilcabamba'
    ]
  },
  oxapampa: {
    canonical_name: 'Oxapampa',
    aliases: ['provincia de oxapampa', 'oxapampa'],
    districts: [
      'oxapampa', 'chontabamba', 'huancabamba', 'palcazu', 'palcazú', 'pozuzo',
      'puerto bermudez', 'puerto bermúdez', 'villa rica', 'constitucion', 'constitución'
    ]
  }
};

const RELEVANCE_STATES = {
  APPLICABLE_SCOPE_CONFIRMED: 'applicable_scope_confirmed',
  POTENTIALLY_RELEVANT: 'potentially_relevant',
  INSUFFICIENT_GEOGRAPHIC_INFORMATION: 'insufficient_geographic_information',
  NOT_APPLICABLE: 'not_applicable'
};

class ParcelNoticeRelevanceService {
  /**
   * Identifica la provincia y distrito de una parcela a partir de sus metadatos y localización
   */
  resolveParcelLocation(parcel) {
    if (!parcel || typeof parcel !== 'object') {
      return { department: null, province: null, district: null, is_pasco: false, is_reliable: false };
    }

    // 1. Extraer exclusivamente campos estructurados administrativos (sin nombres, notas ni descripciones libres)
    const rawDept = parcel.department || parcel.departamento || null;
    const rawProv = parcel.province || parcel.provincia || null;
    const rawDist = parcel.district || parcel.distrito || null;

    let matchedProvince = null;
    let matchedDistrict = null;
    let isPasco = false;

    // 2. Normalización de distrito estructurado si está presente
    if (rawDist && typeof rawDist === 'string' && rawDist.trim().length > 0) {
      const cleanDist = rawDist.trim().toLowerCase();
      for (const [key, provData] of Object.entries(PASCO_PROVINCES)) {
        for (const dist of provData.districts) {
          if (cleanDist === dist || cleanDist === `distrito de ${dist}`) {
            matchedDistrict = dist;
            matchedProvince = provData.canonical_name;
            isPasco = true;
            break;
          }
        }
        if (matchedDistrict) break;
      }
    }

    // 3. Normalización de provincia estructurada si no se determinó por distrito
    if (!matchedProvince && rawProv && typeof rawProv === 'string' && rawProv.trim().length > 0) {
      const cleanProv = rawProv.trim().toLowerCase();
      for (const [key, provData] of Object.entries(PASCO_PROVINCES)) {
        if (provData.aliases.some(alias => cleanProv === alias || cleanProv === `provincia de ${alias}`)) {
          matchedProvince = provData.canonical_name;
          isPasco = true;
          break;
        }
      }
    }

    // 4. Verificación de departamento estructurado
    if (rawDept && typeof rawDept === 'string') {
      const cleanDept = rawDept.trim().toLowerCase();
      if (cleanDept.includes('pasco')) {
        isPasco = true;
      }
    }

    const isReliable = Boolean(matchedProvince || matchedDistrict || (isPasco && rawDept));

    return {
      department: isPasco ? 'Pasco' : (rawDept ? String(rawDept).trim() : null),
      province: matchedProvince,
      district: matchedDistrict,
      is_pasco: isPasco,
      is_reliable: isReliable
    };
  }

  /**
   * Resuelve el cultivo normalizado canónico de la parcela
   */
  resolveParcelCrop(parcel) {
    if (!parcel) return null;
    const rawCrop = parcel.crop_name || parcel.crop_type || parcel.crop || parcel.cultivo;
    return normalizeCrop(rawCrop);
  }

  /**
   * Evalúa la coincidencia geográfica entre un aviso y una parcela
   */
  evaluateGeographicMatch(notice, parcelLocation) {
    const scopeType = notice.geographical_scope_type || SCOPE_TYPES.INDETERMINADO;
    const scope = notice.geographical_scope || {};

    // Caso 1: Alcance Distrital
    if (scopeType === SCOPE_TYPES.DISTRITAL || (scope.districts && scope.districts.length > 0)) {
      const noticeDistricts = (scope.districts || []).map(d => String(d).toLowerCase());
      if (!parcelLocation.district) {
        return {
          match_type: 'distrital_unresolved_parcel',
          is_covered: null,
          is_local_specific: false,
          detail: 'Aviso delimitado a nivel distrital pero la parcela no tiene distrito identificado.'
        };
      }

      const distMatches = noticeDistricts.some(nd => nd.includes(parcelLocation.district.toLowerCase()));
      if (distMatches) {
        return {
          match_type: 'distrital_match',
          is_covered: true,
          is_local_specific: true,
          detail: `Ámbito oficial coincide con el distrito de ${parcelLocation.district}.`
        };
      } else {
        return {
          match_type: 'distrital_mismatch',
          is_covered: false,
          is_local_specific: false,
          detail: `Aviso oficial delimitado a distritos que no incluyen ${parcelLocation.district}.`
        };
      }
    }

    // Caso 2: Alcance Provincial
    if (scopeType === SCOPE_TYPES.PROVINCIAL || (scope.provinces && scope.provinces.length > 0)) {
      const noticeProvs = (scope.provinces || []).map(p => String(p).toLowerCase());
      if (!parcelLocation.province) {
        return {
          match_type: 'provincial_unresolved_parcel',
          is_covered: null,
          is_local_specific: false,
          detail: 'Aviso delimitado a nivel provincial pero la parcela no tiene provincia verificada.'
        };
      }

      const provMatches = noticeProvs.some(np => {
        const pNorm = parcelLocation.province.toLowerCase();
        return np.includes(pNorm) || pNorm.includes(np);
      });

      if (provMatches) {
        return {
          match_type: 'provincial_match',
          is_covered: true,
          is_local_specific: true,
          detail: `Ámbito oficial coincide con la provincia de ${parcelLocation.province}.`
        };
      } else {
        return {
          match_type: 'provincial_mismatch',
          is_covered: false,
          is_local_specific: false,
          detail: `Aviso oficial delimitado a provincias que no incluyen ${parcelLocation.province}.`
        };
      }
    }

    // Caso 3: Alcance Departamental
    if (scopeType === SCOPE_TYPES.DEPARTAMENTAL || scope.department) {
      const noticeDept = (scope.department || '').toLowerCase();
      if (noticeDept.includes('pasco')) {
        return {
          match_type: 'departmental',
          is_covered: parcelLocation.is_pasco,
          is_local_specific: true,
          detail: 'Ámbito oficial coincide con el departamento de Pasco.'
        };
      } else {
        // Ámbito departamental fuera de Pasco (ej: Junín, Huánuco, Lima)
        return {
          match_type: 'departmental_other',
          is_covered: false,
          is_local_specific: false,
          detail: `Aviso circunscrito a otro departamento (${scope.department}); no aplicable a Pasco.`
        };
      }
    }

    // Caso 4: Alcance Nacional
    if (scopeType === SCOPE_TYPES.NACIONAL || (scopeType !== SCOPE_TYPES.INDETERMINADO && scope.country && !scope.department && !scope.provinces?.length && !scope.districts?.length)) {
      return {
        match_type: 'national',
        is_covered: true,
        is_local_specific: false,
        detail: 'Aviso de alcance nacional; no implica foco de infección local en la parcela.'
      };
    }

    // Ámbito indeterminado o sin datos
    return {
      match_type: 'indeterminate',
      is_covered: null,
      is_local_specific: false,
      detail: 'El aviso no cuenta con delimitación geográfica oficial suficiente.'
    };
  }

  /**
   * Evalúa la coincidencia de cultivo entre el aviso y la parcela
   */
  evaluateCropMatch(notice, parcelCrop) {
    if (!parcelCrop) {
      return {
        match: null,
        detail: 'La parcela no tiene un cultivo principal asignado o normalizado.'
      };
    }

    const affected = notice.affected_crops || [];

    // Si el aviso no enumera cultivos afectados, no inventamos una lista
    if (affected.length === 0) {
      return {
        match: null,
        detail: 'El aviso oficial no especifica cultivos hospedantes particulares.'
      };
    }

    const matches = affected.includes(parcelCrop);
    return {
      match: matches,
      parcel_crop: parcelCrop,
      affected_crops: affected,
      detail: matches
        ? `Cultivo de la parcela (${parcelCrop}) explícitamente afectado por el aviso.`
        : `Cultivo de la parcela (${parcelCrop}) no coincide con los cultivos afectados (${affected.join(', ')}).`
    };
  }

  /**
   * Evalúa la relevancia integral de un aviso para una parcela (Sección 8 y 9)
   *
   * @param {Object} notice Aviso fitosanitario canónico
   * @param {Object} parcel Parcela con sus metadatos
   * @returns {Object} Evaluación estructurada
   */
  evaluateNoticeRelevanceForParcel(notice, parcel) {
    if (!notice || !parcel) {
      return {
        relevance_status: RELEVANCE_STATES.NOT_APPLICABLE,
        reason: 'Aviso o parcela no definidos.'
      };
    }

    const parcelLocation = this.resolveParcelLocation(parcel);
    const parcelCrop = this.resolveParcelCrop(parcel);

    const geoEval = this.evaluateGeographicMatch(notice, parcelLocation);
    const cropEval = this.evaluateCropMatch(notice, parcelCrop);

    let relevanceStatus = RELEVANCE_STATES.NOT_APPLICABLE;
    let rationale = '';

    // REGLA 1: Si el cultivo NO coincide de forma confirmada, es NOT_APPLICABLE
    if (cropEval.match === false) {
      relevanceStatus = RELEVANCE_STATES.NOT_APPLICABLE;
      rationale = `No aplicable: el aviso está dirigido a [${cropEval.affected_crops.join(', ')}] y la parcela cultiva [${parcelCrop}].`;
    }
    // REGLA 2: Si la geografía está confirmada fuera de Pasco o de la provincia de la parcela, es NOT_APPLICABLE
    else if (geoEval.is_covered === false) {
      relevanceStatus = RELEVANCE_STATES.NOT_APPLICABLE;
      rationale = `No aplicable: la zona geográfica del aviso no incluye la ubicación de la parcela (${geoEval.detail}).`;
    }
    // REGLA 3: Si falta información geográfica en el aviso o en la parcela
    else if (geoEval.is_covered === null || !parcelLocation.is_pasco || !parcelLocation.is_reliable) {
      relevanceStatus = RELEVANCE_STATES.INSUFFICIENT_GEOGRAPHIC_INFORMATION;
      rationale = `Información geográfica insuficiente: ${geoEval.detail}`;
    }
    // REGLA 4: Alcance nacional con cultivo coincidente
    else if (geoEval.match_type === 'national') {
      relevanceStatus = RELEVANCE_STATES.POTENTIALLY_RELEVANT;
      rationale = `Potencialmente relevante: Alerta o disposición nacional que involucra el cultivo ${parcelCrop}. No constituye foco ni diagnóstico en la parcela.`;
    }
    // REGLA 5: Ámbito geográfico local/departamental/provincial confirmado y cultivo coincidente
    else if (geoEval.is_covered === true && cropEval.match === true) {
      relevanceStatus = RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED;
      rationale = `Ámbito oficial confirmado: El aviso oficial cubre la zona de la parcela (${parcelLocation.province || 'Pasco'}) y el cultivo (${parcelCrop}).`;
    }
    // REGLA 6: Ámbito local confirmado pero el aviso no especifica cultivos
    else if (geoEval.is_covered === true && cropEval.match === null) {
      relevanceStatus = RELEVANCE_STATES.POTENTIALLY_RELEVANT;
      rationale = `Potencialmente relevante: El aviso cubre la zona (${parcelLocation.province || 'Pasco'}), pero no restringe cultivos hospedantes.`;
    }
    else {
      relevanceStatus = RELEVANCE_STATES.INSUFFICIENT_GEOGRAPHIC_INFORMATION;
      rationale = 'Evaluación indeterminada por ausencia de parámetros coincidentes.';
    }

    return {
      notice_id: notice.notice_id,
      official_title: notice.official_title,
      notice_type: notice.notice_type,
      parcel_id: parcel.id,
      parcel_name: parcel.name,
      relevance_status: relevanceStatus,
      rationale: rationale,
      crop_evaluation: cropEval,
      geographic_evaluation: {
        parcel_location: parcelLocation,
        notice_scope: notice.geographical_scope,
        scope_type: notice.geographical_scope_type,
        match: geoEval
      },
      recommended_public_action: notice.recommended_public_action || null,
      safety_disclaimer: 'Este aviso es exclusivamente informativo y preventivo emitido por la autoridad oficial. NO constituye un diagnóstico de infección de la parcela ni una prescripción química automática.',
      evaluated_at: new Date().toISOString()
    };
  }

  /**
   * Preparación desacoplada de notificación fitosanitaria (Sección 14).
   * EN L08 ESTÁ ESTRICTAMENTE PROHIBIDO ENVIAR NOTIFICACIONES REALES.
   *
   * @param {Object} notice
   * @param {Object} parcel
   * @param {Object} options
   * @returns {Object} Candidato estructurado con should_notify=false
   */
  prepareNotificationCandidate(notice, parcel, options = {}) {
    const relevance = this.evaluateNoticeRelevanceForParcel(notice, parcel);

    const isActionableRelevance =
      relevance.relevance_status === RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED ||
      relevance.relevance_status === RELEVANCE_STATES.POTENTIALLY_RELEVANT;

    const deduplicationKey = `phytosanitary_notice_${notice.notice_id}_parcel_${parcel.id}`;

    // Validación de vigencia
    const isVigente = notice.verification_status === NOTICE_STATUSES.ACTIVE &&
      notice.publication_status !== 'derogado' &&
      notice.publication_status !== 'sustituido';

    const candidatePayload = {
      type: 'phytosanitary_alert',
      deduplication_key: deduplicationKey,
      user_id: parcel.user_id,
      parcel_id: parcel.id,
      notice_id: notice.notice_id,
      title: `[Aviso Fitosanitario] ${notice.official_title}`,
      message: `${relevance.rationale} Medida preventiva recomendada: ${notice.recommended_public_action}`,
      severity: notice.severity_official || 'vigilancia',
      priority: notice.priority_internal || 'media',
      relevance_status: relevance.relevance_status,
      prepared_at: new Date().toISOString()
    };

    // La política de L08 exige que should_notify sea siempre false (despacho desactivado)
    const notificationsGloballyEnabled = process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED === 'true';

    return {
      should_notify: false, // Bloqueo absoluto de envío en L08
      is_eligible_candidate: isActionableRelevance && isVigente,
      suppression_reason: !isActionableRelevance
        ? `Aviso no aplicable o irrelevante para la parcela (${relevance.relevance_status})`
        : !isVigente
        ? `Aviso no vigente o inactivo (${notice.verification_status})`
        : 'Despacho de notificaciones fitosanitarias deshabilitado por política de fase 9-L08 (PHYTOSANITARY_NOTIFICATIONS_ENABLED=false)',
      candidate_payload: candidatePayload,
      evaluated_relevance: relevance
    };
  }
}

module.exports = {
  ParcelNoticeRelevanceService,
  RELEVANCE_STATES,
  PASCO_PROVINCES
};
