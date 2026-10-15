/**
 * AgroPasco Digital — Controlador de Vigilancia Fitosanitaria Oficial
 * ==============================================================================
 * FASE 9-L11: Integración Backend HTTP con PostgreSQL, Autorización Vigente y Persistencia End-to-End
 *
 * Responsabilidades:
 *  - Selección explícita de almacenamiento: disabled | memory_test | postgres
 *  - Verificación en tiempo real del estado de cuenta de usuarios en PostgreSQL (activo, no bloqueado, rol coincidente)
 *  - Gobernanza administrativa transaccional ACID completa
 *  - Protección contra autoaprobación y separación de funciones
 *  - Control de concurrencia optimista y auditoría append-only
 *  - Cero prescripciones químicas automáticas (Sección 10).
 */

const { dbGet, getDb } = require('../config/database');
const { OfficialNoticeCatalogService } = require('../services/officialNoticeCatalogService');
const { ParcelNoticeRelevanceService, RELEVANCE_STATES } = require('../services/parcelNoticeRelevanceService');
const { NOTICE_STATUSES } = require('../services/phytosanitaryNoticeClassifier');
const { PhytosanitaryNoticeRepository } = require('../repositories/phytosanitaryNoticeRepository');
const { verifyActiveUserStatus } = require('../services/userStatusService');

// Instancia singleton en memoria para pruebas aisladas (memory_test)
let defaultCatalogService = new OfficialNoticeCatalogService({
  allowTestFixtures: process.env.NODE_ENV === 'test'
});

const defaultRelevanceService = new ParcelNoticeRelevanceService();

// Proveedor de parcelas inyectable para pruebas o desacoplamiento de BD
let parcelResolverOverride = null;

// Repositorio PostgreSQL inyectable o generado bajo demanda
let noticeRepository = null;

function setParcelResolverOverride(resolver) {
  parcelResolverOverride = resolver;
}

function getCatalogService() {
  return defaultCatalogService;
}

function setCatalogService(service) {
  defaultCatalogService = service;
}

/**
 * Obtiene el modo de almacenamiento configurado
 * - disabled: Persistencia deshabilitada
 * - memory_test: Exclusivo para suites de prueba con NODE_ENV === 'test'
 * - postgres: Repositorio relacional PostgreSQL
 */
function getStorageBackendMode() {
  const raw = (process.env.PHYTOSANITARY_STORAGE_BACKEND || '').toLowerCase().trim();
  if (raw === 'postgres') {
    return 'postgres';
  }
  if (raw === 'memory_test') {
    if (process.env.NODE_ENV !== 'test') {
      return 'disabled'; // No permitir memory_test en entornos productivos
    }
    return 'memory_test';
  }
  if (raw === 'disabled') {
    return 'disabled';
  }
  // En entorno de prueba, si no se especifica, por defecto es memory_test para no alterar suites preexistentes
  if (!raw && process.env.NODE_ENV === 'test') {
    return 'memory_test';
  }
  return 'disabled';
}

function getNoticeRepository() {
  if (!noticeRepository && getStorageBackendMode() === 'postgres') {
    noticeRepository = new PhytosanitaryNoticeRepository({
      db: getDb(),
      verifyUserActive: true,
      allowTestFixtures: process.env.NODE_ENV === 'test'
    });
  }
  return noticeRepository;
}

function setNoticeRepository(repo) {
  noticeRepository = repo;
}

/**
 * Middleware para verificar si el módulo de avisos fitosanitarios está habilitado (H-MED-02).
 */
function requirePhytosanitaryEnabled(req, res, next) {
  if (process.env.PHYTOSANITARY_NOTICES_ENABLED !== 'true') {
    return res.status(503).json({
      success: false,
      code: 'PHYTOSANITARY_MODULE_DISABLED',
      message: 'El módulo de vigilancia fitosanitaria todavía no está habilitado.'
    });
  }
  const mode = getStorageBackendMode();
  if (mode === 'disabled') {
    return res.status(503).json({
      success: false,
      code: 'PHYTOSANITARY_STORAGE_DISABLED',
      message: 'El almacenamiento fitosanitario está deshabilitado.'
    });
  }
  if (typeof next === 'function') {
    next();
  }
}

/**
 * Middleware para verificar si el módulo administrativo de revisión y gobernanza está habilitado.
 */
function requireAdminReviewEnabled(req, res, next) {
  if (process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED !== 'true') {
    return res.status(503).json({
      success: false,
      code: 'PHYTOSANITARY_ADMIN_DISABLED',
      message: 'El módulo administrativo de revisión y gobernanza fitosanitaria no está habilitado.'
    });
  }
  const mode = getStorageBackendMode();
  if (mode === 'disabled') {
    return res.status(503).json({
      success: false,
      code: 'PHYTOSANITARY_STORAGE_DISABLED',
      message: 'El almacenamiento fitosanitario está deshabilitado.'
    });
  }
  if (typeof next === 'function') {
    next();
  }
}

/**
 * Extrae la identidad del actor EXCLUSIVAMENTE del middleware de autenticación (req.user).
 * Ignora cualquier parámetro client-side manipulable.
 */
function getAuthenticatedActor(req) {
  if (!req.user || !req.user.id || !req.user.role) {
    return null;
  }
  return {
    id: req.user.id,
    name: req.user.name || `Usuario_${req.user.id}`,
    role: req.user.role
  };
}

/**
 * Verifica la identidad y vigencia del actor en PostgreSQL o en memoria
 */
async function verifyAndAuthorizeActor(req, requiredRole = null) {
  const actor = getAuthenticatedActor(req);
  if (!actor) {
    return {
      authorized: false,
      status: 401,
      error: 'Autenticación requerida para realizar esta operación administrativa.'
    };
  }

  const mode = getStorageBackendMode();
  if (mode === 'postgres') {
    const repo = getNoticeRepository();
    const executor = repo ? repo.getExecutor() : null;
    const verification = await verifyActiveUserStatus(actor.id, {
      expectedRole: requiredRole,
      tokenRole: actor.role,
      client: executor
    });

    if (!verification.valid) {
      return {
        authorized: false,
        status: 403,
        error: `Acceso denegado: ${verification.reason}`
      };
    }

    return {
      authorized: true,
      actor: {
        id: verification.user.id,
        name: verification.user.name,
        role: verification.user.role
      }
    };
  }

  // En modo memory_test: validar rol del token
  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowed.includes(actor.role)) {
      return {
        authorized: false,
        status: 403,
        error: `Acceso denegado: El rol "${actor.role}" no tiene permisos para realizar esta operación. Se requiere rol ${allowed.join(' o ')}.`
      };
    }
  }

  return { authorized: true, actor };
}

/**
 * GET /api/phytosanitary/notices
 * Lista de avisos oficiales vigentes y aprobados con paginación defensiva.
 */
async function listNotices(req, res) {
  try {
    if (process.env.PHYTOSANITARY_NOTICES_ENABLED !== 'true') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_MODULE_DISABLED',
        message: 'El módulo de vigilancia fitosanitaria todavía no está habilitado.'
      });
    }

    const mode = getStorageBackendMode();
    if (mode === 'disabled') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_STORAGE_DISABLED',
        message: 'El almacenamiento fitosanitario está deshabilitado.'
      });
    }

    const {
      crop,
      noticeType,
      severity,
      province,
      activeOnly = 'true'
    } = req.query;

    let limit = 20;
    let offset = 0;

    if (req.query.limit !== undefined) {
      const parsedLimit = Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > 50) {
        return res.status(400).json({
          success: false,
          error: 'El parámetro limit debe ser un entero positivo entre 1 y 50.'
        });
      }
      limit = parsedLimit;
    }

    if (req.query.offset !== undefined) {
      const parsedOffset = Number(req.query.offset);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 1000000) {
        return res.status(400).json({
          success: false,
          error: 'El parámetro offset debe ser un entero no negativo.'
        });
      }
      offset = parsedOffset;
    }

    let notices = [];
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      if (!repo) {
        return res.status(500).json({
          success: false,
          error: 'Error interno: Repositorio PostgreSQL no inicializado.'
        });
      }
      notices = await repo.listNotices({
        crop,
        noticeType,
        severity,
        province,
        activeOnly: activeOnly !== 'false'
      });
    } else {
      const catalog = getCatalogService();
      notices = catalog.listNotices({
        crop,
        noticeType,
        severity,
        province,
        activeOnly: activeOnly !== 'false'
      });
    }

    // Orden determinista para resultados repetibles: issue_date DESC, luego notice_id/id ASC
    notices.sort((a, b) => {
      const dateA = a.issue_date || '';
      const dateB = b.issue_date || '';
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      const idA = a.id || a.notice_id || '';
      const idB = b.id || b.notice_id || '';
      return idA.localeCompare(idB);
    });

    const total = notices.length;

    if (total === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        limit,
        offset,
        has_more: false,
        message: 'No se registran avisos fitosanitarios oficiales activos para los criterios especificados en la región Pasco.'
      });
    }

    const paginatedItems = notices.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return res.json({
      success: true,
      data: paginatedItems,
      total,
      limit,
      offset,
      has_more: hasMore
    });
  } catch (err) {
    console.error('Error al listar avisos fitosanitarios:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno al consultar el catálogo oficial de avisos fitosanitarios.'
    });
  }
}

/**
 * GET /api/phytosanitary/notices/:id
 * Detalle completo y verificable de un aviso oficial
 */
async function getNoticeById(req, res) {
  try {
    if (process.env.PHYTOSANITARY_NOTICES_ENABLED !== 'true') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_MODULE_DISABLED',
        message: 'El módulo de vigilancia fitosanitaria todavía no está habilitado.'
      });
    }

    const mode = getStorageBackendMode();
    if (mode === 'disabled') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_STORAGE_DISABLED',
        message: 'El almacenamiento fitosanitario está deshabilitado.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El identificador del aviso es requerido.'
      });
    }

    let notice = null;
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      if (!repo) {
        return res.status(500).json({
          success: false,
          error: 'Error interno: Repositorio PostgreSQL no inicializado.'
        });
      }
      notice = await repo.getNoticeById(id.trim());
    } else {
      const catalog = getCatalogService();
      notice = catalog.getNotice(id.trim());
    }

    if (!notice) {
      return res.status(404).json({
        success: false,
        error: `Aviso fitosanitario "${id}" no encontrado o no disponible públicamente.`
      });
    }

    return res.json({
      success: true,
      data: notice
    });
  } catch (err) {
    console.error('Error al consultar detalle del aviso fitosanitario:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno al obtener el aviso fitosanitario.'
    });
  }
}

/**
 * GET /api/phytosanitary/parcels/:parcelId/relevance
 * Evaluación de relevancia fitosanitaria para una parcela específica.
 */
async function evaluateParcelRelevance(req, res) {
  try {
    if (process.env.PHYTOSANITARY_NOTICES_ENABLED !== 'true') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_MODULE_DISABLED',
        message: 'El módulo de vigilancia fitosanitaria todavía no está habilitado.'
      });
    }

    const mode = getStorageBackendMode();
    if (mode === 'disabled') {
      return res.status(503).json({
        success: false,
        code: 'PHYTOSANITARY_STORAGE_DISABLED',
        message: 'El almacenamiento fitosanitario está deshabilitado.'
      });
    }

    const { parcelId } = req.params;
    const { noticeId } = req.query;

    const cleanParcelId = Number(parcelId);
    if (!Number.isInteger(cleanParcelId) || cleanParcelId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Identificador de parcela inválido. Debe ser un número entero positivo.'
      });
    }

    let parcel = null;
    if (typeof parcelResolverOverride === 'function') {
      parcel = await parcelResolverOverride(cleanParcelId);
    } else {
      try {
        parcel = await dbGet(
          `SELECT p.*, c.name as crop_name, u.name as farmer_name, u.location as farmer_location
           FROM parcels p
           LEFT JOIN crops c ON p.crop_id = c.id
           LEFT JOIN users u ON p.user_id = u.id
           WHERE p.id = ?`,
          [cleanParcelId]
        );
      } catch (dbErr) {
        // En ausencia de DB activa, parcelResolverOverride debe ser usado
      }
    }

    if (!parcel) {
      return res.status(404).json({
        success: false,
        error: `Parcela con ID ${parcelId} no encontrada.`
      });
    }

    const userRole = req.user?.role;
    const userId = req.user?.id;

    const ALLOWED_RELEVANCE_ROLES = ['farmer', 'advisor', 'admin'];
    if (!userRole || !ALLOWED_RELEVANCE_ROLES.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Acceso denegado: El rol "${userRole || 'no_autenticado'}" no tiene permisos para consultar la condición fitosanitaria de parcelas.`
      });
    }

    if (userRole === 'farmer' && Number(parcel.user_id) !== Number(userId)) {
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado: No tiene permisos para consultar la condición fitosanitaria de parcelas de otros agricultores.'
      });
    }

    const relevanceService = defaultRelevanceService;

    if (noticeId) {
      let notice = null;
      if (mode === 'postgres') {
        const repo = getNoticeRepository();
        notice = await repo.getNoticeById(String(noticeId).trim());
      } else {
        const catalog = getCatalogService();
        notice = catalog.getNotice(String(noticeId).trim());
      }

      if (!notice) {
        return res.status(404).json({
          success: false,
          error: `Aviso oficial "${noticeId}" no encontrado en el catálogo.`
        });
      }

      const evaluation = relevanceService.evaluateNoticeRelevanceForParcel(notice, parcel);
      const notificationCandidate = relevanceService.prepareNotificationCandidate(notice, parcel);

      return res.json({
        success: true,
        data: {
          evaluation,
          notification_candidate: notificationCandidate
        }
      });
    }

    let activeNotices = [];
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      activeNotices = await repo.listNotices({ activeOnly: true });
    } else {
      const catalog = getCatalogService();
      activeNotices = catalog.listNotices({ activeOnly: true });
    }

    if (activeNotices.length === 0) {
      return res.json({
        success: true,
        data: {
          parcel_id: parcel.id,
          parcel_name: parcel.name,
          relevance_summary: {
            applicable_scope_confirmed_count: 0,
            potentially_relevant_count: 0,
            total_active_notices_evaluated: 0
          },
          evaluations: [],
          message: 'No existen avisos fitosanitarios oficiales activos para evaluar contra esta parcela.'
        }
      });
    }

    const evaluations = [];
    let confirmedCount = 0;
    let potentialCount = 0;

    for (const notice of activeNotices) {
      const evalResult = relevanceService.evaluateNoticeRelevanceForParcel(notice, parcel);
      if (evalResult.relevance_status === RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED) {
        confirmedCount++;
      } else if (evalResult.relevance_status === RELEVANCE_STATES.POTENTIALLY_RELEVANT) {
        potentialCount++;
      }
      evaluations.push(evalResult);
    }

    return res.json({
      success: true,
      data: {
        parcel_id: parcel.id,
        parcel_name: parcel.name,
        relevance_summary: {
          applicable_scope_confirmed_count: confirmedCount,
          potentially_relevant_count: potentialCount,
          total_active_notices_evaluated: activeNotices.length
        },
        evaluations
      }
    });
  } catch (err) {
    console.error('Error al evaluar relevancia fitosanitaria de la parcela:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno al evaluar la relevancia fitosanitaria.'
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices
 * Registra un nuevo aviso en estado de borrador o pendiente de verificación.
 */
async function adminRegisterNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, 'admin');
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const payload = {
      ...req.body,
      created_by: actor,
      verification_status: req.body.verification_status === NOTICE_STATUSES.PENDING_VERIFICATION
        ? NOTICE_STATUSES.PENDING_VERIFICATION
        : NOTICE_STATUSES.DISCOVERED
    };

    delete payload.approved_by;
    delete payload.is_authenticated;
    delete payload.isAuthenticated;

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const notice = await repo.registerNotice(payload, actor);
      return res.status(201).json({
        success: true,
        message: 'Aviso fitosanitario registrado exitosamente en estado de verificación.',
        data: notice
      });
    }

    const catalog = getCatalogService();
    const notice = catalog.registerNotice(payload);

    return res.status(201).json({
      success: true,
      message: 'Aviso fitosanitario registrado exitosamente en estado de verificación.',
      data: notice
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * GET /api/phytosanitary/admin/notices/pending
 * Lista avisos en estados pendientes de revisión técnica o aprobación.
 */
async function adminListPendingNotices(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, ['admin', 'advisor']);
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const pending = await repo.listNotices({ pendingOnly: true });
      return res.json({
        success: true,
        count: pending.length,
        data: pending
      });
    }

    const catalog = getCatalogService();
    const all = catalog.listNotices({ activeOnly: false });
    const pending = all.filter(n =>
      n.verification_status === NOTICE_STATUSES.DISCOVERED ||
      n.verification_status === NOTICE_STATUSES.PENDING_VERIFICATION ||
      n.verification_status === NOTICE_STATUSES.REVIEW_REQUIRED ||
      n.verification_status === NOTICE_STATUSES.VERIFIED
    );

    return res.json({
      success: true,
      count: pending.length,
      data: pending
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Error al listar avisos pendientes.'
    });
  }
}

/**
 * GET /api/phytosanitary/admin/notices/:id/history
 * Obtiene el historial de auditoría inmutable del aviso.
 */
async function adminGetNoticeHistory(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, ['admin', 'advisor']);
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const { id } = req.params;
    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const notice = await repo.getNoticeById(id);
      if (!notice) {
        return res.status(404).json({
          success: false,
          error: `Aviso fitosanitario "${id}" no encontrado.`
        });
      }
      const history = await repo.getNoticeHistory(id);
      return res.json({
        success: true,
        notice_id: id,
        count: history.length,
        data: history
      });
    }

    const catalog = getCatalogService();
    const history = catalog.getNoticeHistory(id);

    return res.json({
      success: true,
      notice_id: id,
      count: history.length,
      data: history
    });
  } catch (err) {
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices/:id/review
 * Registra observaciones técnicas y avanza a revisión técnica requerida.
 */
async function adminReviewNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, ['admin', 'advisor']);
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const updated = await repo.recordTechnicalReview(req.params.id, {
        observations: req.body.technical_observations || req.body.observations || req.body.reason,
        recommendedStatus: req.body.recommended_status,
        evidenceReference: req.body.evidence_reference || req.body.verification_evidence
      }, actor);
      return res.json({
        success: true,
        message: 'Revisión técnica registrada exitosamente.',
        data: updated
      });
    }

    const catalog = getCatalogService();
    const updated = catalog.recordTechnicalReview(req.params.id, actor, {
      technicalObservations: req.body.technical_observations || req.body.observations || req.body.reason,
      recommendedStatus: req.body.recommended_status,
      evidenceReference: req.body.evidence_reference || req.body.verification_evidence
    });

    return res.json({
      success: true,
      message: 'Revisión técnica registrada exitosamente.',
      data: updated
    });
  } catch (err) {
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices/:id/approve
 * Aprobación administrativa formal con permisos comprobables de admin.
 */
async function adminApproveNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, 'admin');
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const expectedVersion = req.body.expected_version !== undefined
      ? req.body.expected_version
      : (req.headers['if-match'] ? parseInt(req.headers['if-match'], 10) : undefined);

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const approved = await repo.approveNotice(req.params.id, actor, {
        reason: req.body.reason || 'Aprobación administrativa formal',
        evidenceReference: req.body.evidence_reference || req.body.verification_evidence,
        expectedVersion
      });
      return res.json({
        success: true,
        message: 'Aviso fitosanitario aprobado formalmente.',
        data: approved
      });
    }

    const catalog = getCatalogService();
    const approved = catalog.approveNotice(req.params.id, actor, {
      reason: req.body.reason || 'Aprobación administrativa formal',
      evidenceReference: req.body.evidence_reference || req.body.verification_evidence
    });

    return res.json({
      success: true,
      message: 'Aviso fitosanitario aprobado formalmente.',
      data: approved
    });
  } catch (err) {
    if (err.message && err.message.includes('Conflicto de concurrencia')) {
      return res.status(409).json({
        success: false,
        error: err.message,
        code: 'CONCURRENCY_CONFLICT'
      });
    }
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices/:id/reject
 * Rechaza un aviso fitosanitario con motivo documentado.
 */
async function adminRejectNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, ['admin', 'advisor']);
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const reason = req.body.reason || 'Rechazado por inconsistencia documental';

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const rejected = await repo.rejectNotice(req.params.id, actor, reason);
      return res.json({
        success: true,
        message: 'Aviso fitosanitario rechazado.',
        data: rejected
      });
    }

    const catalog = getCatalogService();
    const rejected = catalog.rejectNotice(req.params.id, actor, reason);

    return res.json({
      success: true,
      message: 'Aviso fitosanitario rechazado.',
      data: rejected
    });
  } catch (err) {
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices/:id/withdraw
 * Retira un aviso de circulación pública.
 */
async function adminWithdrawNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, 'admin');
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const reason = req.body.reason || 'Retirado formalmente de circulación';

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const withdrawn = await repo.withdrawNotice(req.params.id, actor, reason);
      return res.json({
        success: true,
        message: 'Aviso fitosanitario retirado de circulación.',
        data: withdrawn
      });
    }

    const catalog = getCatalogService();
    const withdrawn = catalog.withdrawNotice(req.params.id, actor, reason);

    return res.json({
      success: true,
      message: 'Aviso fitosanitario retirado de circulación.',
      data: withdrawn
    });
  } catch (err) {
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * POST /api/phytosanitary/admin/notices/:id/supersede
 * Sustituye un aviso de circulación pública por uno nuevo.
 */
async function adminSupersedeNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, 'admin');
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const { id } = req.params;
    const { replacement_notice_id, replacementNoticeId, reason = 'Sustituido por nueva resolución' } = req.body;
    const newId = replacement_notice_id || replacementNoticeId;
    if (!newId || typeof newId !== 'string' || newId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Identificador del aviso sustituto (replacement_notice_id) es requerido.'
      });
    }

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const superseded = await repo.supersedeNotice(id, newId.trim(), actor, reason);
      return res.json({
        success: true,
        message: 'Aviso fitosanitario sustituido exitosamente.',
        data: superseded
      });
    }

    const catalog = getCatalogService();
    const superseded = catalog.supersedeNotice(id, newId.trim(), actor, reason);

    return res.json({
      success: true,
      message: 'Aviso fitosanitario sustituido exitosamente.',
      data: superseded
    });
  } catch (err) {
    const status = err.message && (err.message.includes('no existe') || err.message.includes('no encontrado')) ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * PUT /api/phytosanitary/admin/notices/:id
 * Actualiza metadatos del aviso e invalida aprobaciones si hay cambios sustantivos.
 */
async function adminUpdateNotice(req, res) {
  try {
    const auth = await verifyAndAuthorizeActor(req, 'admin');
    if (!auth.authorized) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const actor = auth.actor;

    const expectedVersion = req.body.expected_version !== undefined
      ? req.body.expected_version
      : (req.headers['if-match'] ? parseInt(req.headers['if-match'], 10) : undefined);

    const mode = getStorageBackendMode();
    if (mode === 'postgres') {
      const repo = getNoticeRepository();
      const updated = await repo.updateNotice(req.params.id, req.body, actor, { expectedVersion });
      return res.json({
        success: true,
        message: 'Aviso fitosanitario actualizado.',
        data: updated
      });
    }

    const catalog = getCatalogService();
    const updated = catalog.updateNotice(req.params.id, req.body, actor, { expectedVersion });

    return res.json({
      success: true,
      message: 'Aviso fitosanitario actualizado.',
      data: updated
    });
  } catch (err) {
    if (err.message && err.message.includes('Conflicto de concurrencia')) {
      return res.status(409).json({
        success: false,
        error: err.message,
        code: 'CONCURRENCY_CONFLICT'
      });
    }
    const status = err.message && err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: err.message
    });
  }
}

module.exports = {
  listNotices,
  getNoticeById,
  evaluateParcelRelevance,
  requirePhytosanitaryEnabled,
  requireAdminReviewEnabled,
  getAuthenticatedActor,
  verifyAndAuthorizeActor,
  getStorageBackendMode,
  adminRegisterNotice,
  adminListPendingNotices,
  adminGetNoticeHistory,
  adminReviewNotice,
  adminApproveNotice,
  adminRejectNotice,
  adminWithdrawNotice,
  adminSupersedeNotice,
  adminUpdateNotice,
  getCatalogService,
  setCatalogService,
  getNoticeRepository,
  setNoticeRepository,
  setParcelResolverOverride
};
