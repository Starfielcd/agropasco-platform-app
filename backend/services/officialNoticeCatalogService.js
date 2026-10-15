/**
 * AgroPasco Digital — Servicio de Catálogo y Ciclo de Vida de Avisos Fitosanitarios Oficiales
 * ==============================================================================
 * FASE 9-L08: Vigilancia Fitosanitaria Oficial, Trazabilidad e Ingesta Controlada
 *
 * Responsabilidades:
 *  - Implementar el modelo de datos estructurado del aviso fitosanitario oficial (Sección 5).
 *  - Administrar el ciclo de vida documental y transiciones válidas de estado (Sección 7).
 *  - Distinguir estrictamente entre datos extraídos literalmente, normalizados, inferidos y desconocidos.
 *  - Bloquear categóricamente el paso de avisos sintéticos a ACTIVE operativo.
 *  - Exigir identidad autenticada y autorizada para revisiones y aprobaciones.
 */

const crypto = require('crypto');
const {
  NOTICE_TYPES,
  NOTICE_STATUSES,
  OFFICIAL_SEVERITIES,
  INTERNAL_PRIORITIES,
  SCOPE_TYPES,
  normalizeCrop,
  classifyNoticeType,
  inferPriority,
  buildPublicPreventiveAction
} = require('./phytosanitaryNoticeClassifier');

// Instituciones oficiales de sanidad vegetal autorizadas en Perú
const AUTHORIZED_INSTITUTIONS = new Set([
  'SENASA',
  'MIDAGRI',
  'MINAGRI',
  'INIA',
  'SENAMHI'
]);

// Transiciones de estado permitidas en el ciclo de vida (Sección 7 y 9)
const VALID_TRANSITIONS = {
  [NOTICE_STATUSES.DISCOVERED]: [
    NOTICE_STATUSES.PENDING_VERIFICATION,
    NOTICE_STATUSES.REJECTED
  ],
  [NOTICE_STATUSES.PENDING_VERIFICATION]: [
    NOTICE_STATUSES.VERIFIED,
    NOTICE_STATUSES.REVIEW_REQUIRED,
    NOTICE_STATUSES.REJECTED
  ],
  [NOTICE_STATUSES.VERIFIED]: [
    NOTICE_STATUSES.REVIEW_REQUIRED,
    NOTICE_STATUSES.APPROVED,
    NOTICE_STATUSES.REJECTED
  ],
  [NOTICE_STATUSES.REVIEW_REQUIRED]: [
    NOTICE_STATUSES.APPROVED,
    NOTICE_STATUSES.VERIFIED,
    NOTICE_STATUSES.REJECTED
  ],
  [NOTICE_STATUSES.APPROVED]: [
    NOTICE_STATUSES.ACTIVE,
    NOTICE_STATUSES.SUPERSEDED,
    NOTICE_STATUSES.EXPIRED,
    NOTICE_STATUSES.WITHDRAWN,
    NOTICE_STATUSES.REVIEW_REQUIRED,
    NOTICE_STATUSES.REJECTED
  ],
  [NOTICE_STATUSES.ACTIVE]: [
    NOTICE_STATUSES.SUPERSEDED,
    NOTICE_STATUSES.EXPIRED,
    NOTICE_STATUSES.WITHDRAWN,
    NOTICE_STATUSES.REVIEW_REQUIRED
  ],
  [NOTICE_STATUSES.REJECTED]: [],
  [NOTICE_STATUSES.SUPERSEDED]: [],
  [NOTICE_STATUSES.EXPIRED]: [],
  [NOTICE_STATUSES.WITHDRAWN]: [],
  [NOTICE_STATUSES.UNKNOWN_VALIDITY]: [
    NOTICE_STATUSES.PENDING_VERIFICATION,
    NOTICE_STATUSES.REJECTED
  ]
};

/**
 * Validador de procedencia y URL institucional oficial (Sección 7)
 * Bloquea SSRF, URLs malformadas, credenciales incrustadas, hostnames no gubernamentales y páginas principales genéricas.
 */
function validateInstitutionalSource(urlStr, sourceInstitution) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, reason: 'URL no especificada o de tipo inválido.' };
  }

  const cleanUrl = urlStr.trim();
  if (cleanUrl.length < 10) {
    return { valid: false, reason: 'URL demasiado corta para constituir un enlace documental institucional.' };
  }

  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch (err) {
    return { valid: false, reason: `URL malformada o sintaxis inválida: "${cleanUrl}".` };
  }

  // Rechazo explícito de credenciales incrustadas (user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URL rechazada por contener credenciales de autenticación incrustadas.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Validación estructurada de formato de hostname
  if (!/^[a-z0-9.-]+$/.test(hostname)) {
    return { valid: false, reason: `Hostname con formato inválido o caracteres sospechosos: "${hostname}".` };
  }

  // Prevención de SSRF / dominios locales y redes privadas
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.16.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, reason: `URL no autorizada por apuntar a host local o red privada: "${hostname}".` };
  }

  // Exigencia estricta de HTTPS para fuentes institucionales oficiales
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: `Protocolo no permitido: "${parsed.protocol}". Solo se admite HTTPS seguro para fuentes institucionales oficiales.` };
  }

  // Verificación estricta del dominio institucional gubernamental (.gob.pe)
  if (!hostname.endsWith('.gob.pe') && hostname !== 'gob.pe') {
    return { valid: false, reason: `Dominio no oficial "${hostname}". Debe pertenecer a la jerarquía gubernamental del Perú (.gob.pe).` };
  }

  // Correspondencia estructurada con la institución emisora
  const instNorm = sourceInstitution ? String(sourceInstitution).trim().toUpperCase() : '';
  const institutionDomainMap = {
    'SENASA': 'senasa.gob.pe',
    'MIDAGRI': 'midagri.gob.pe',
    'MINAGRI': 'minagri.gob.pe',
    'INIA': 'inia.gob.pe',
    'SENAMHI': 'senamhi.gob.pe'
  };

  const expectedDomain = institutionDomainMap[instNorm];
  if (expectedDomain) {
    const isExact = hostname === expectedDomain;
    const isSubdomain = hostname.endsWith('.' + expectedDomain);
    const isPortalGobPe = hostname === 'www.gob.pe' || hostname === 'gob.pe';

    if (!isExact && !isSubdomain && !isPortalGobPe) {
      return {
        valid: false,
        reason: `Inconsistencia institucional: El dominio "${hostname}" no corresponde a la institución emisora "${instNorm}". Se esperaba "${expectedDomain}" o portal gob.pe.`
      };
    }

    // Portal compartido gob.pe: verificación de correspondencia institucional en ruta
    if (isPortalGobPe) {
      const pathLower = parsed.pathname.toLowerCase();
      const otherInstitutions = Object.keys(institutionDomainMap).filter(k => k !== instNorm && k !== 'MINAGRI');
      for (const other of otherInstitutions) {
        const otherSlug = other.toLowerCase();
        if (pathLower.includes(`/institucion/${otherSlug}`) || pathLower.includes(`/${otherSlug}/`)) {
          return {
            valid: false,
            reason: `Inconsistencia institucional en gob.pe: La URL apunta al espacio de "${other}" pero la institución declarada es "${instNorm}".`
          };
        }
      }
    }
  }

  // Exigir que apunte a un documento o publicación específica, no a la raíz
  if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
    return { valid: false, reason: 'La URL debe apuntar a una publicación o documento específico, no a la página principal del portal.' };
  }

  return { valid: true, sanitizedUrl: parsed.href };
}

/**
 * Función de clonado profundo para evitar contaminación de referencias compartidas (Sección 4 L09B).
 */
function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Detecta si una modificación contiene cambios sobre atributos sustantivos críticos (Sección 8 L09B).
 */
function isSubstantiveChange(existingNotice, updates) {
  if (!updates || typeof updates !== 'object') return false;

  const substantiveKeys = [
    'official_url',
    'notice_type',
    'pest_scientific_name',
    'issue_date',
    'effective_from',
    'effective_until',
    'source_institution',
    'official_document_number',
    'original_document_hash',
    'severity_official'
  ];

  for (const key of substantiveKeys) {
    if (updates[key] !== undefined) {
      const oldVal = existingNotice[key] !== undefined && existingNotice[key] !== null ? String(existingNotice[key]).trim() : '';
      const newVal = updates[key] !== undefined && updates[key] !== null ? String(updates[key]).trim() : '';
      if (oldVal !== newVal) {
        return true;
      }
    }
  }

  // Comparación de verificación de evidencia
  if (updates.verification_evidence !== undefined) {
    const oldEv = JSON.stringify(existingNotice.verification_evidence || null);
    const newEv = JSON.stringify(updates.verification_evidence || null);
    if (oldEv !== newEv) {
      return true;
    }
  }

  // Comparación de cultivos afectados
  if (updates.affected_crops !== undefined) {
    const oldCrops = Array.isArray(existingNotice.affected_crops)
      ? [...existingNotice.affected_crops].map(c => normalizeCrop(c)).filter(Boolean).sort()
      : [];
    const newCrops = Array.isArray(updates.affected_crops)
      ? [...updates.affected_crops].map(c => normalizeCrop(c)).filter(Boolean).sort()
      : [];
    if (JSON.stringify(oldCrops) !== JSON.stringify(newCrops)) {
      return true;
    }
  }

  // Comparación de ámbito geográfico
  if (updates.geographical_scope !== undefined) {
    if (JSON.stringify(existingNotice.geographical_scope) !== JSON.stringify(updates.geographical_scope)) {
      return true;
    }
  }

  return false;
}

class OfficialNoticeCatalogService {
  /**
   * @param {Object} options
   * @param {boolean} [options.allowTestFixtures=false] Permite cargar stubs sintéticos para evaluación de pruebas
   * @param {Array} [options.initialNotices=[]] Colección inicial de avisos inyectados
   */
  constructor(options = {}) {
    this.allowTestFixtures = options.allowTestFixtures === true;
    this.notices = new Map();

    if (Array.isArray(options.initialNotices)) {
      for (const raw of options.initialNotices) {
        this.registerNotice(raw, { skipValidation: false });
      }
    }
  }

  /**
   * Valida y registra un aviso fitosanitario conforme al modelo estructurado de la Sección 5 y 6.
   */
  registerNotice(rawNotice, options = {}) {
    if (!rawNotice || typeof rawNotice !== 'object') {
      throw new Error('El objeto del aviso fitosanitario es inválido o no fue especificado.');
    }

    const {
      notice_id,
      source_institution,
      official_title,
      official_document_number = null,
      official_url = null,
      notice_type = null,
      pest_scientific_name = null,
      pest_common_name = null,
      affected_crops = [],
      geographical_scope = null,
      geographical_scope_type = null,
      issue_date,
      effective_from = null,
      effective_until = null,
      publication_status = 'vigente',
      verification_status = NOTICE_STATUSES.DISCOVERED,
      original_document_hash = null,
      severity_official = OFFICIAL_SEVERITIES.NO_ESPECIFICADA,
      is_official = true,
      is_synthetic = false,
      supersedes_notice_id = null,
      requires_human_review = false,
      provenance = null,
      safety_flags = [],
      verification_evidence = null,
      created_by = null
    } = rawNotice;

    // 1. Validaciones mínimas obligatorias
    if (!notice_id || typeof notice_id !== 'string' || notice_id.trim().length < 3) {
      throw new Error('notice_id es obligatorio y debe tener al menos 3 caracteres.');
    }

    const cleanId = notice_id.trim();
    if (this.notices.has(cleanId)) {
      throw new Error(`Número oficial o identificador de aviso duplicado: "${cleanId}".`);
    }

    if (!source_institution || typeof source_institution !== 'string') {
      throw new Error('source_institution es obligatorio.');
    }

    const normalizedInstitution = source_institution.trim().toUpperCase();
    if (!AUTHORIZED_INSTITUTIONS.has(normalizedInstitution)) {
      throw new Error(`Institución emisora "${source_institution}" desconocida o no autorizada.`);
    }

    if (!official_title || typeof official_title !== 'string' || official_title.trim().length < 5) {
      throw new Error('official_title es obligatorio y debe tener al menos 5 caracteres descriptivos.');
    }

    // 2. Validación de fechas (Sección 6 y 15 Check 4)
    if (issue_date) {
      const issueTime = Date.parse(issue_date);
      if (isNaN(issueTime)) {
        throw new Error(`Fecha de emisión inválida: "${issue_date}".`);
      }
      if (effective_until) {
        const untilTime = Date.parse(effective_until);
        if (isNaN(untilTime)) {
          throw new Error(`Fecha de fin de vigencia inválida: "${effective_until}".`);
        }
        if (untilTime < issueTime) {
          throw new Error('Fechas inconsistentes: la fecha de fin de vigencia no puede ser anterior a la fecha de emisión.');
        }
      }
    }
    if (effective_from && effective_until) {
      const fromTime = Date.parse(effective_from);
      const untilTime = Date.parse(effective_until);
      if (!isNaN(fromTime) && !isNaN(untilTime) && untilTime < fromTime) {
        throw new Error('Fechas inconsistentes: la fecha de fin de vigencia no puede ser anterior a la fecha de inicio de vigencia.');
      }
    }

    // 3. Validación de cultivos afectados (Sección 6 y 15 Check 5)
    if (affected_crops !== undefined) {
      if (!Array.isArray(affected_crops)) {
        throw new Error('affected_crops debe ser un arreglo de nombres de cultivo.');
      }
      for (const cropItem of affected_crops) {
        if (!cropItem || typeof cropItem !== 'string' || cropItem.trim().length === 0) {
          throw new Error('affected_crops contiene valores vacíos o no válidos.');
        }
      }
    }
    const normalizedCrops = Array.isArray(affected_crops)
      ? affected_crops.map(c => normalizeCrop(c)).filter(Boolean)
      : [];

    // 4. Validación de URL oficial institucional (Sección 7 y 15 Check 2, 6)
    if (official_url) {
      const sourceRes = validateInstitutionalSource(official_url, normalizedInstitution);
      if (!sourceRes.valid) {
        throw new Error(`URL oficial inválida o no verificable: "${official_url}". ${sourceRes.reason}`);
      }
    }

    // 5. Clasificación determinista de tipo si no fue explicitado
    const resolvedNoticeType = notice_type || classifyNoticeType({
      title: official_title,
      excerpt: rawNotice.excerpt || '',
      documentNumber: official_document_number || '',
      isOfficial: is_official
    });

    // 6. Prioridad interna calculada
    const resolvedPriority = inferPriority(resolvedNoticeType, severity_official);

    // 7. Ámbito geográfico normalizado
    const resolvedScopeType = geographical_scope_type || (
      geographical_scope?.provinces?.length > 0 ? SCOPE_TYPES.PROVINCIAL :
      geographical_scope?.department ? SCOPE_TYPES.DEPARTAMENTAL :
      geographical_scope?.country ? SCOPE_TYPES.NACIONAL :
      SCOPE_TYPES.INDETERMINADO
    );

    // 8. Acción preventiva pública (sin prescripciones químicas)
    const recommendedAction = rawNotice.recommended_public_action || buildPublicPreventiveAction({
      pestCommonName: pest_common_name,
      affectedCrops: normalizedCrops,
      isQuarantine: Boolean(rawNotice.is_quarantine)
    });

    // 9. Estado inicial seguro: NUNCA ACTIVE al registrar (Sección 6 y 15 Check 1)
    let resolvedVerificationStatus = verification_status;
    if (resolvedVerificationStatus === NOTICE_STATUSES.ACTIVE) {
      resolvedVerificationStatus = NOTICE_STATUSES.DISCOVERED;
    }
    if (is_synthetic && resolvedVerificationStatus === NOTICE_STATUSES.ACTIVE) {
      resolvedVerificationStatus = NOTICE_STATUSES.DISCOVERED;
    }
    if (
      resolvedVerificationStatus !== NOTICE_STATUSES.DISCOVERED &&
      resolvedVerificationStatus !== NOTICE_STATUSES.PENDING_VERIFICATION &&
      resolvedVerificationStatus !== NOTICE_STATUSES.APPROVED &&
      !options.allowInitialStatus
    ) {
      resolvedVerificationStatus = NOTICE_STATUSES.DISCOVERED;
    }

    const createdByInfo = created_by && typeof created_by === 'object'
      ? { id: created_by.id, name: created_by.name, role: created_by.role }
      : { id: null, name: String(created_by || 'system'), role: 'system' };

    const nowIso = new Date().toISOString();

    // 10. Construcción del contrato canónico con control de versiones (Sección 5, 6, 10)
    const canonicalNotice = {
      notice_id: cleanId,
      source_institution: normalizedInstitution,
      official_title: official_title.trim(),
      official_document_number: official_document_number ? String(official_document_number).trim() : null,
      official_url: official_url ? official_url.trim() : null,
      notice_type: resolvedNoticeType,
      pest_scientific_name: pest_scientific_name ? String(pest_scientific_name).trim() : null,
      pest_common_name: pest_common_name ? String(pest_common_name).trim() : null,
      affected_crops: normalizedCrops,
      geographical_scope: geographical_scope || {
        country: 'Perú',
        department: null,
        provinces: [],
        districts: []
      },
      geographical_scope_type: resolvedScopeType,
      issue_date: issue_date || null,
      effective_from: effective_from || issue_date || null,
      effective_until: effective_until || null,
      publication_status: publication_status || 'vigente',
      verification_status: resolvedVerificationStatus,
      source_verified_at: rawNotice.source_verified_at || nowIso,
      ingestion_timestamp: rawNotice.ingestion_timestamp || nowIso,
      original_document_hash: original_document_hash || null,
      severity_official: severity_official,
      priority_internal: resolvedPriority,
      recommended_public_action: recommendedAction,
      requires_human_review: Boolean(requires_human_review),
      is_official: Boolean(is_official),
      is_synthetic: Boolean(is_synthetic),
      supersedes_notice_id: supersedes_notice_id ? String(supersedes_notice_id).trim() : null,
      safety_flags: Array.isArray(safety_flags) ? [...safety_flags] : [],
      provenance: provenance || {
        captured_by: createdByInfo.name || 'agropasco_automated_ingestion',
        verification_method: is_synthetic ? 'synthetic_fixture' : 'manual_institutional_review',
        timestamp: nowIso
      },
      verification_evidence: verification_evidence || null,
      created_by: createdByInfo,
      created_by_user_id: createdByInfo.id || null,
      created_at: rawNotice.created_at || nowIso,
      updated_at: rawNotice.updated_at || nowIso,
      version: 1,
      technical_reviews: [],
      audit_history: [
        {
          event_id: crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}-1`,
          notice_id: cleanId,
          from_status: null,
          to_status: resolvedVerificationStatus,
          previous_status: null,
          new_status: resolvedVerificationStatus,
          actor_user_id: createdByInfo.id || null,
          actor_role: createdByInfo.role || 'system',
          action: 'NOTICE_REGISTERED',
          reason: 'Registro inicial de aviso fitosanitario',
          evidence_reference: verification_evidence || null,
          event_timestamp: nowIso,
          record_version: 1,
          correlation_id: `CORR-${Date.now()}`
        }
      ]
    };

    this.notices.set(cleanId, canonicalNotice);
    return deepClone(canonicalNotice);
  }

  /**
   * Transición controlada del ciclo de vida (Sección 7, 9)
   */
  transitionStatus(noticeId, targetStatus, { reviewer, reason, evidenceReference } = {}) {
    const notice = this.notices.get(noticeId);
    if (!notice) {
      throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
    }

    const currentStatus = notice.verification_status;
    const allowed = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(targetStatus)) {
      throw new Error(
        `Transición inválida de "${currentStatus}" a "${targetStatus}" para el aviso "${noticeId}". ` +
        `Transiciones permitidas: [${allowed.join(', ')}]`
      );
    }

    // Aprobación o activación exige revisor autenticado con rol admin (Sección 5 y 15 Check 10, 11, 12, 13)
    if (targetStatus === NOTICE_STATUSES.APPROVED || targetStatus === NOTICE_STATUSES.ACTIVE) {
      if (!reviewer || typeof reviewer !== 'object' || !reviewer.id) {
        throw new Error('Se requiere un revisor autenticado para aprobar o activar un aviso fitosanitario.');
      }
      if (reviewer.role === 'advisor') {
        throw new Error('El rol "advisor" no tiene privilegios para la aprobación final de avisos fitosanitarios (se requiere rol "admin").');
      }
      if (reviewer.role !== 'admin') {
        throw new Error(`El rol "${reviewer.role}" no tiene privilegios para aprobar avisos fitosanitarios.`);
      }
      // Rechazo estricto de identidad simulada o incompleta
      if (!reviewer.name || typeof reviewer.name !== 'string' || reviewer.name.trim().length < 3) {
        throw new Error('Identidad de revisor no válida o incompleta.');
      }

      const isHighImpact = notice.severity_official === 'emergencia' ||
        notice.severity_official === 'alerta_roja' ||
        notice.priority_internal === 'alta' ||
        notice.requires_human_review;

      // Prevención de autoaprobación unilateral de alto impacto (Sección 5 y 15 Check 19)
      if (
        notice.created_by_user_id &&
        reviewer.id &&
        Number(reviewer.id) === Number(notice.created_by_user_id) &&
        isHighImpact
      ) {
        throw new Error(
          'Bloqueo de autoaprobación: No se permite que el mismo usuario que registró un aviso de alto impacto lo apruebe unilateralmente sin revisión técnica independiente.'
        );
      }

      // Verificación de evidencia y revisión técnica obligatoria para aprobación formal (Sección 3 L09B)
      if (targetStatus === NOTICE_STATUSES.APPROVED) {
        if (currentStatus === NOTICE_STATUSES.VERIFIED) {
          throw new Error(
            'Aprobación denegada: No se permite la aprobación basada exclusivamente en estado VERIFIED. Se requiere revisión técnica previa en estado REVIEW_REQUIRED.'
          );
        }
        if (currentStatus !== NOTICE_STATUSES.REVIEW_REQUIRED) {
          throw new Error(
            `Transición inválida: No se puede aprobar un aviso en estado "${currentStatus}". Debe encontrarse en estado REVIEW_REQUIRED.`
          );
        }

        const evidence = evidenceReference || notice.verification_evidence;
        if (!evidence || (typeof evidence === 'object' && Object.keys(evidence).length === 0)) {
          throw new Error('Se requiere evidencia verificable de procedencia institucional para aprobar el aviso fitosanitario.');
        }
        if (evidenceReference) {
          notice.verification_evidence = evidenceReference;
        }

        // Exigir revisión técnica agronómica completada en avisos que lo requieren
        const mustCheckTechReview = isHighImpact || Boolean(notice.requires_human_review);
        if (mustCheckTechReview) {
          if (!Array.isArray(notice.technical_reviews) || notice.technical_reviews.length === 0) {
            throw new Error('Se requiere al menos una revisión técnica previa completada para aprobar este aviso fitosanitario.');
          }
          const validReview = notice.technical_reviews.find(r => Number(r.review_version) === Number(notice.version));
          if (!validReview) {
            throw new Error(`La revisión técnica existente corresponde a una versión anterior y no a la versión actual (${notice.version}) del aviso.`);
          }
        }
      }
    }

    // Un aviso sintético NUNCA puede ser activado en modo operativo
    if (targetStatus === NOTICE_STATUSES.ACTIVE && notice.is_synthetic && !this.allowTestFixtures) {
      throw new Error('Bloqueo de seguridad: No se permite activar avisos sintéticos en modo operativo.');
    }

    notice.verification_status = targetStatus;
    notice.updated_at = new Date().toISOString();

    notice.audit_history.push({
      event_id: crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      notice_id: noticeId,
      from_status: currentStatus,
      to_status: targetStatus,
      previous_status: currentStatus,
      new_status: targetStatus,
      actor_user_id: reviewer?.id || null,
      actor_role: reviewer?.role || 'system',
      action: `TRANSITION_TO_${targetStatus.toUpperCase()}`,
      reason: reason || `Transición a ${targetStatus}`,
      evidence_reference: evidenceReference || notice.verification_evidence || null,
      event_timestamp: new Date().toISOString(),
      record_version: notice.version,
      correlation_id: `CORR-${Date.now()}`
    });

    return notice;
  }

  /**
   * Registro de revisión técnica agronómica por Asesor o Administrador (Sección 8 y 15 Check 12)
   */
  recordTechnicalReview(noticeId, reviewer, { technicalObservations, recommendedStatus, evidenceReference } = {}) {
    const notice = this.notices.get(noticeId);
    if (!notice) {
      throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
    }

    if (!reviewer || typeof reviewer !== 'object' || !reviewer.id) {
      throw new Error('Se requiere un revisor técnico autenticado.');
    }

    if (reviewer.role !== 'advisor' && reviewer.role !== 'admin') {
      throw new Error(`Acceso denegado: El rol "${reviewer.role}" no tiene permisos para registrar revisiones técnicas.`);
    }

    const reviewEntry = {
      reviewer_id: reviewer.id,
      reviewer_name: reviewer.name,
      reviewer_role: reviewer.role,
      reviewed_at: new Date().toISOString(),
      observations: technicalObservations || 'Revisión agronómica completada sin observaciones críticas.',
      recommended_status: recommendedStatus || NOTICE_STATUSES.REVIEW_REQUIRED,
      evidence_reference: evidenceReference || null,
      review_version: notice.version
    };

    if (!Array.isArray(notice.technical_reviews)) {
      notice.technical_reviews = [];
    }
    notice.technical_reviews.push(reviewEntry);
    if (evidenceReference) {
      notice.verification_evidence = evidenceReference;
    }

    const target = recommendedStatus || NOTICE_STATUSES.REVIEW_REQUIRED;
    if (notice.verification_status !== target) {
      const allowed = VALID_TRANSITIONS[notice.verification_status] || [];
      if (allowed.includes(target)) {
        this.transitionStatus(noticeId, target, {
          reviewer,
          reason: technicalObservations || `Revisión técnica agronómica completada (${target})`,
          evidenceReference
        });
      }
    }

    notice.updated_at = new Date().toISOString();
    return deepClone(notice);
  }

  /**
   * Modificación de metadatos con detección de cambios sustantivos,
   * invalidación de aprobaciones previas y control de concurrencia optimista (Sección 10).
   */
  updateNotice(noticeId, updates, actor, { expectedVersion } = {}) {
    const notice = this.notices.get(noticeId);
    if (!notice) {
      throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
    }

    if (!actor || actor.role !== 'admin') {
      throw new Error('Acceso denegado: Se requiere rol "admin" para modificar metadatos de avisos fitosanitarios.');
    }

    // Control de concurrencia optimista (Sección 10 y 15 Check 27)
    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (Number(expectedVersion) !== Number(notice.version)) {
        throw new Error(
          `Conflicto de concurrencia: la versión esperada (${expectedVersion}) no coincide con la versión actual (${notice.version}).`
        );
      }
    }

    const currentStatus = notice.verification_status;
    const isSubstantive = isSubstantiveChange(notice, updates);

    // Si hubo cambio sustantivo y el aviso ya estaba aprobado o activo, invalidar aprobación (Sección 10 y 15 Check 22, 23, 24, 25, 26)
    let statusInvalidated = false;
    if (isSubstantive && (currentStatus === NOTICE_STATUSES.APPROVED || currentStatus === NOTICE_STATUSES.ACTIVE)) {
      notice.verification_status = NOTICE_STATUSES.REVIEW_REQUIRED;
      if (notice.approved_by) {
        notice.previous_approval = {
          ...notice.approved_by,
          invalidated_at: new Date().toISOString(),
          invalidated_at_version: notice.version
        };
        notice.approved_by = null;
      }
      if (notice.publication_status === 'vigente' && currentStatus === NOTICE_STATUSES.ACTIVE) {
        notice.publication_status = 'en_revision';
      }
      statusInvalidated = true;

      notice.audit_history.push({
        event_id: crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        notice_id: noticeId,
        from_status: currentStatus,
        to_status: NOTICE_STATUSES.REVIEW_REQUIRED,
        previous_status: currentStatus,
        new_status: NOTICE_STATUSES.REVIEW_REQUIRED,
        actor_user_id: actor.id || null,
        actor_role: actor.role || 'admin',
        action: 'APPROVAL_INVALIDATED',
        reason: updates.reason || 'Invalidación automática de aprobación por modificación sustantiva de metadatos críticos',
        evidence_reference: updates.evidence_reference || null,
        event_timestamp: new Date().toISOString(),
        record_version: notice.version + 1,
        correlation_id: `CORR-${Date.now()}`
      });
    }

    // Validar y aplicar actualizaciones
    if (updates.official_title !== undefined) {
      if (typeof updates.official_title !== 'string' || updates.official_title.trim().length < 5) {
        throw new Error('official_title debe tener al menos 5 caracteres descriptivos.');
      }
      notice.official_title = updates.official_title.trim();
    }

    if (updates.official_url !== undefined) {
      const v = validateInstitutionalSource(updates.official_url, updates.source_institution || notice.source_institution);
      if (!v.valid) {
        throw new Error(`URL oficial inválida o no verificable: "${updates.official_url}". ${v.reason}`);
      }
      notice.official_url = updates.official_url.trim();
    }

    if (updates.affected_crops !== undefined) {
      if (!Array.isArray(updates.affected_crops)) {
        throw new Error('affected_crops debe ser un arreglo de cultivos.');
      }
      notice.affected_crops = updates.affected_crops.map(c => normalizeCrop(c)).filter(Boolean);
    }

    if (updates.geographical_scope !== undefined) {
      notice.geographical_scope = updates.geographical_scope;
    }

    if (updates.notice_type !== undefined) {
      notice.notice_type = updates.notice_type;
    }

    if (updates.severity_official !== undefined) {
      notice.severity_official = updates.severity_official;
      notice.priority_internal = inferPriority(notice.notice_type, updates.severity_official);
    }

    if (updates.pest_scientific_name !== undefined) {
      notice.pest_scientific_name = updates.pest_scientific_name ? String(updates.pest_scientific_name).trim() : null;
    }

    if (updates.effective_until !== undefined) {
      if (updates.effective_until) {
        const untilTime = Date.parse(updates.effective_until);
        if (isNaN(untilTime)) throw new Error(`Fecha de fin de vigencia inválida: "${updates.effective_until}".`);
        if (notice.issue_date && untilTime < Date.parse(notice.issue_date)) {
          throw new Error('Fechas inconsistentes: la fecha de fin de vigencia no puede ser anterior a la de emisión.');
        }
      }
      notice.effective_until = updates.effective_until;
    }

    if (updates.verification_evidence !== undefined) {
      notice.verification_evidence = updates.verification_evidence;
    }

    notice.version += 1;
    notice.updated_at = new Date().toISOString();

    if (!statusInvalidated) {
      notice.audit_history.push({
        event_id: crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        notice_id: noticeId,
        from_status: currentStatus,
        to_status: notice.verification_status,
        previous_status: currentStatus,
        new_status: notice.verification_status,
        actor_user_id: actor.id || null,
        actor_role: actor.role || 'admin',
        action: isSubstantive ? 'NOTICE_SUBSTANTIVE_UPDATE' : 'NOTICE_METADATA_UPDATE',
        reason: updates.reason || 'Actualización de metadatos administrativos',
        evidence_reference: updates.evidence_reference || null,
        event_timestamp: new Date().toISOString(),
        record_version: notice.version,
        correlation_id: `CORR-${Date.now()}`
      });
    }

    return deepClone(notice);
  }

  approveNotice(noticeId, reviewer, options = {}) {
    const reason = typeof options === 'string' ? options : (options.reason || 'Aprobación técnica formal');
    const evidenceReference = typeof options === 'object' ? options.evidenceReference : null;

    const notice = this.transitionStatus(noticeId, NOTICE_STATUSES.APPROVED, {
      reviewer,
      reason,
      evidenceReference
    });

    notice.approved_by = {
      id: reviewer.id,
      name: reviewer.name,
      role: reviewer.role,
      approved_at: new Date().toISOString()
    };
    return deepClone(notice);
  }

  activateNotice(noticeId, reviewer, reason = 'Activación para difusión pública') {
    // Si estaba en VERIFIED o REVIEW_REQUIRED, primero debe ser APPROVED
    if (this.notices.get(noticeId)?.verification_status !== NOTICE_STATUSES.APPROVED) {
      this.approveNotice(noticeId, reviewer, reason);
    }
    return this.transitionStatus(noticeId, NOTICE_STATUSES.ACTIVE, { reviewer, reason });
  }

  rejectNotice(noticeId, reviewer, reason = 'Rechazado por inconsistencia documental') {
    return this.transitionStatus(noticeId, NOTICE_STATUSES.REJECTED, { reviewer, reason });
  }

  withdrawNotice(noticeId, reviewer, reason = 'Aviso retirado de circulación') {
    const notice = this.notices.get(noticeId);
    if (!notice) {
      throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
    }

    if (!reviewer || reviewer.role !== 'admin') {
      throw new Error('Solo un administrador autenticado puede retirar un aviso fitosanitario.');
    }

    this.transitionStatus(noticeId, NOTICE_STATUSES.WITHDRAWN, {
      reviewer,
      reason
    });
    notice.publication_status = 'retirado';
    notice.withdrawn_at = new Date().toISOString();
    notice.withdrawn_by = { id: reviewer.id, name: reviewer.name, role: reviewer.role };

    return deepClone(notice);
  }

  supersedeNotice(oldNoticeId, newNoticeId, reviewer, reason = 'Sustituido por nueva resolución') {
    const oldNotice = this.notices.get(oldNoticeId);
    if (!oldNotice) {
      throw new Error(`Aviso original "${oldNoticeId}" no existe.`);
    }
    if (!this.notices.has(newNoticeId)) {
      throw new Error(`Aviso sustituto "${newNoticeId}" no existe en el catálogo.`);
    }

    this.transitionStatus(oldNoticeId, NOTICE_STATUSES.SUPERSEDED, { reviewer, reason });
    oldNotice.publication_status = 'sustituido';
    oldNotice.superseded_by = newNoticeId;

    const newNotice = this.notices.get(newNoticeId);
    newNotice.supersedes_notice_id = oldNoticeId;

    return deepClone(oldNotice);
  }

  getNoticeHistory(noticeId) {
    const notice = this.notices.get(noticeId);
    if (!notice) {
      throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
    }

    // Retorno defensivo e inmutable con clonado profundo (Sección 4 y 11 L09B)
    const historyCopy = deepClone(notice.audit_history);
    return Object.freeze(historyCopy.map(event => Object.freeze({
      ...event,
      details: event.details ? Object.freeze({ ...event.details }) : null
    })));
  }

  getNotice(noticeId) {
    const n = this.notices.get(noticeId);
    if (!n) return null;

    // En modo operativo estricto, ocultar avisos sintéticos
    if (!this.allowTestFixtures && n.is_synthetic) {
      return null;
    }
    return deepClone(n);
  }

  /**
   * Consulta pública o filtrada de avisos oficiales
   */
  listNotices(filters = {}) {
    const {
      crop,
      noticeType,
      verificationStatus,
      severity,
      province,
      activeOnly = false
    } = filters;

    const cleanCrop = crop ? normalizeCrop(crop) : null;
    const cleanProvince = province ? String(province).trim().toLowerCase() : null;

    const results = [];
    for (const notice of this.notices.values()) {
      // Filtrar fixtures sintéticos en modo operativo
      if (!this.allowTestFixtures && notice.is_synthetic) {
        continue;
      }

      // Filtro de solo activos
      if (activeOnly && notice.verification_status !== NOTICE_STATUSES.ACTIVE) {
        continue;
      }

      // Exclusión categórica de superseded, rejected y expired para avisos activos
      if (activeOnly && (notice.publication_status === 'derogado' || notice.publication_status === 'sustituido' || notice.publication_status === 'expirado')) {
        continue;
      }

      // Filtro de estado
      if (verificationStatus && notice.verification_status !== verificationStatus) {
        continue;
      }

      // Filtro de tipo
      if (noticeType && notice.notice_type !== noticeType) {
        continue;
      }

      // Filtro de severidad
      if (severity && notice.severity_official !== severity) {
        continue;
      }

      // Filtro de cultivo
      if (cleanCrop && notice.affected_crops && notice.affected_crops.length > 0) {
        if (!notice.affected_crops.includes(cleanCrop)) {
          continue;
        }
      }

      // Filtro provincial
      if (cleanProvince && notice.geographical_scope?.provinces?.length > 0) {
        const matchesProv = notice.geographical_scope.provinces.some(p => p.toLowerCase().includes(cleanProvince));
        if (!matchesProv && notice.geographical_scope_type !== SCOPE_TYPES.NACIONAL) {
          continue;
        }
      }

      results.push(deepClone(notice));
    }

    return results;
  }

  getTotalCount() {
    return this.notices.size;
  }
}

module.exports = {
  OfficialNoticeCatalogService,
  AUTHORIZED_INSTITUTIONS,
  VALID_TRANSITIONS,
  validateInstitutionalSource,
  isSubstantiveChange
};
