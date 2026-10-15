/**
 * AgroPasco Digital — Repositorio PostgreSQL de Avisos Fitosanitarios
 * FASE 9-L10: Persistencia Relacional Segura, Transacciones ACID y Auditoría Durable
 */

'use strict';

const crypto = require('crypto');
const { getDb, withTransaction } = require('../config/database');
const { verifyActiveUserStatus } = require('../services/userStatusService');
const {
  validateInstitutionalSource,
  isSubstantiveChange
} = require('../services/officialNoticeCatalogService');
const {
  NOTICE_STATUSES,
  OFFICIAL_SEVERITIES,
  INTERNAL_PRIORITIES,
  inferPriority,
  classifyNoticeType,
  buildPublicPreventiveAction,
  normalizeCrop
} = require('../services/phytosanitaryNoticeClassifier');

function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Valida que el contexto del actor provenga de un origen confiable
 */
function assertTrustedActorContext(actorContext, requiredRole = null) {
  if (!actorContext || typeof actorContext !== 'object') {
    throw new Error('Límite de confianza violado: Se requiere un contexto de actor explícito y autenticado.');
  }
  if (!actorContext.id || Number(actorContext.id) <= 0) {
    throw new Error('Límite de confianza violado: Identificador de actor ausente o inválido.');
  }
  if (!actorContext.role || typeof actorContext.role !== 'string') {
    throw new Error('Límite de confianza violado: Rol de actor no definido.');
  }
  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowed.includes(actorContext.role)) {
      throw new Error(`Acceso denegado: Se requiere rol "${Array.isArray(requiredRole) ? requiredRole.join(' o ') : requiredRole}", pero el actor tiene rol "${actorContext.role}".`);
    }
  }
}

class PhytosanitaryNoticeRepository {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.db] Pool o cliente de base de datos
   * @param {boolean} [options.verifyUserActive=false] Si debe validar contra users(id) en base de datos
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.verifyUserActive = Boolean(options.verifyUserActive);
  }

  getExecutor(client) {
    if (client && client.client) return client.client;
    return client || this.db || getDb();
  }

  /**
   * Ejecuta una rutina dentro de una transacción ACID, garantizando:
   * 1. Si no se provee cliente y existe un Pool, adquiere una conexión dedicada mediante pool.connect(),
   *    ejecuta BEGIN/COMMIT/ROLLBACK en ese mismo cliente y lo libera en el bloque finally (H-ALT-01).
   * 2. Si el llamador proporciona un contexto transaccional explícito (inTransaction: true), respeta
   *    la propiedad de la transacción: no ejecuta BEGIN/COMMIT/ROLLBACK ni libera la conexión del llamador.
   * 3. Si el llamador proporciona un PoolClient real sin transacción activa ni delegación explícita,
   *    rechaza la operación de forma segura para prevenir escrituras en autocommit no atómicas (L11C).
   * 4. Si el llamador delega expresamente la transacción (delegateTransaction: true), el repositorio
   *    administra BEGIN/COMMIT/ROLLBACK pero nunca invoca release() sobre la conexión del llamador.
   * 5. Si se inyecta un mock/adaptador unitario sin .release(), mantiene compatibilidad unitaria.
   */
  async _runTransactional(runInTx, clientContext = null) {
    if (clientContext) {
      // 1. Extraer cliente subyacente si viene encapsulado en un contexto transaccional
      const client = clientContext.client || clientContext;
      const isCallerManaged = clientContext.inTransaction === true || client.inTransaction === true;
      const isDelegated = clientContext.delegateTransaction === true || client.delegateTransaction === true;

      // 2. Transacción explícita del llamador: participa sin emitir BEGIN, COMMIT, ROLLBACK ni release
      if (isCallerManaged) {
        return await runInTx(client);
      }

      // 3. Cliente real de PostgreSQL (PoolClient con método release()) sin transacción y sin delegación explícita:
      // Rechazo seguro obligatorio para evitar operaciones en autocommit (L11C)
      if (typeof client.release === 'function' && !isDelegated) {
        throw new Error(
          'Contrato transaccional violado: El PoolClient proporcionado no cuenta con una transacción activa (inTransaction: true) ni delegación explícita (delegateTransaction: true). Operación rechazada para prevenir ejecuciones en autocommit no atómicas.'
        );
      }

      // 4. Delegación transaccional explícita o adaptador simulado sin release() (MockPgTransactionalClient)
      await client.query('BEGIN');
      try {
        const result = await runInTx(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rbErr) {
          console.error('Error durante ROLLBACK en cliente transaccional delegado:', rbErr && rbErr.message ? rbErr.message : rbErr);
        }
        throw err;
      }
      // NUNCA se libera un cliente que pertenece al llamador externo
    }

    const pool = this.db || getDb();
    if (!pool) {
      throw new Error('Fallo de conexión: No hay pool o cliente de base de datos disponible.');
    }

    // A. Pool real de PostgreSQL (pg.Pool o interfaz equivalente con .connect)
    if (typeof pool.connect === 'function') {
      const dedicatedClient = await pool.connect();
      let committed = false;
      try {
        await dedicatedClient.query('BEGIN');
        const result = await runInTx(dedicatedClient);
        await dedicatedClient.query('COMMIT');
        committed = true;
        return result;
      } catch (err) {
        if (!committed) {
          try {
            await dedicatedClient.query('ROLLBACK');
          } catch (rbErr) {
            console.error('Error durante ROLLBACK en conexión transaccional dedicada:', rbErr && rbErr.message ? rbErr.message : rbErr);
          }
        }
        throw err;
      } finally {
        try {
          dedicatedClient.release();
        } catch (relErr) {
          console.error('Error al liberar cliente transaccional al pool:', relErr && relErr.message ? relErr.message : relErr);
        }
      }
    }

    // B. Adaptador simulado para pruebas unitarias sin pool real (MockPgTransactionalClient)
    if (typeof pool.query === 'function') {
      if (pool.inTransaction) {
        return await runInTx(pool);
      }
      await pool.query('BEGIN');
      try {
        const result = await runInTx(pool);
        await pool.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await pool.query('ROLLBACK');
        } catch (rbErr) {
          console.error('Error durante ROLLBACK en adaptador simulado:', rbErr && rbErr.message ? rbErr.message : rbErr);
        }
        throw err;
      }
    }

    // C. Fallback a withTransaction si está disponible
    return await withTransaction(async (tx) => {
      return await runInTx(tx.client || tx);
    });
  }

  /**
   * Registra un nuevo aviso fitosanitario de forma atómica en PostgreSQL.
   */
  async registerNotice(noticeData, actorContext, client = null) {
    assertTrustedActorContext(actorContext, 'admin');

    const executor = this.getExecutor(client);
    if (!executor) {
      throw new Error('Fallo de conexión: No hay conexión a base de datos disponible para registrar el aviso.');
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
      geographical_scope_type = 'nacional',
      issue_date,
      effective_from = null,
      effective_until = null,
      original_document_hash = null,
      severity_official = 'no_especificada',
      recommended_public_action = null,
      requires_human_review = false,
      is_official = true,
      is_synthetic = false,
      verification_evidence = null
    } = noticeData;

    if (!notice_id || typeof notice_id !== 'string' || notice_id.trim().length < 3) {
      throw new Error('notice_id es obligatorio y debe tener al menos 3 caracteres.');
    }
    const cleanId = notice_id.trim();

    if (!source_institution || typeof source_institution !== 'string') {
      throw new Error('source_institution es obligatorio.');
    }
    const normInstitution = source_institution.trim().toUpperCase();

    if (!official_title || typeof official_title !== 'string' || official_title.trim().length < 5) {
      throw new Error('official_title es obligatorio y debe tener al menos 5 caracteres descriptivos.');
    }

    if (official_url) {
      const v = validateInstitutionalSource(official_url, normInstitution);
      if (!v.valid) {
        throw new Error(`URL oficial inválida o no verificable: "${official_url}". ${v.reason}`);
      }
    }

    const normalizedCrops = Array.isArray(affected_crops)
      ? affected_crops.map(c => normalizeCrop(c)).filter(Boolean)
      : [];

    const resolvedNoticeType = notice_type || classifyNoticeType({
      title: official_title,
      excerpt: '',
      documentNumber: official_document_number || '',
      isOfficial: is_official
    });

    const priorityInternal = inferPriority(resolvedNoticeType, severity_official);

    const recommendedAction = recommended_public_action || buildPublicPreventiveAction({
      pestCommonName: pest_common_name,
      affectedCrops: normalizedCrops,
      isQuarantine: false
    });

    const nowIso = new Date().toISOString();
    const resolvedScope = geographical_scope || { country: 'Perú', department: null, provinces: [], districts: [] };

    const initialStatus = NOTICE_STATUSES.DISCOVERED;
    const initialVersion = 1;
    const provenance = {
      captured_by: actorContext.name,
      captured_by_user_id: actorContext.id,
      timestamp: nowIso
    };

    const insertNoticeSql = `
      INSERT INTO phytosanitary_notices (
        id, source_institution, official_title, official_document_number,
        official_url, notice_type, pest_scientific_name, pest_common_name,
        affected_crops, geographical_scope, geographical_scope_type,
        issue_date, effective_from, effective_until, publication_status,
        verification_status, source_verified_at, ingestion_timestamp,
        original_document_hash, severity_official, priority_internal,
        recommended_public_action, requires_human_review, is_official,
        is_synthetic, provenance, verification_evidence,
        created_by_user_id, created_by_name, created_by_role,
        version, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11,
        $12, $13, $14, $15,
        $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24,
        $25, $26::jsonb, $27::jsonb,
        $28, $29, $30,
        $31, $32, $33
      ) RETURNING *;
    `;

    const noticeValues = [
      cleanId, normInstitution, official_title.trim(), official_document_number,
      official_url, resolvedNoticeType, pest_scientific_name, pest_common_name,
      JSON.stringify(normalizedCrops), JSON.stringify(resolvedScope), geographical_scope_type,
      issue_date || null, effective_from || issue_date || null, effective_until || null, 'vigente',
      initialStatus, nowIso, nowIso,
      original_document_hash, severity_official, priorityInternal,
      recommendedAction, Boolean(requires_human_review), Boolean(is_official),
      Boolean(is_synthetic), JSON.stringify(provenance), verification_evidence ? JSON.stringify(verification_evidence) : null,
      actorContext.id, actorContext.name, actorContext.role,
      initialVersion, nowIso, nowIso
    ];

    const insertHistorySql = `
      INSERT INTO phytosanitary_notice_history (
        event_id, notice_id, from_status, to_status, previous_status, new_status,
        actor_user_id, actor_role, action, reason, evidence_reference,
        event_timestamp, record_version, correlation_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14
      );
    `;

    const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}-1`;
    const correlationId = `CORR-${Date.now()}`;
    const historyValues = [
      eventId, cleanId, null, initialStatus, null, initialStatus,
      actorContext.id, actorContext.role, 'NOTICE_REGISTERED', 'Registro inicial en PostgreSQL',
      verification_evidence ? JSON.stringify(verification_evidence) : null,
      nowIso, initialVersion, correlationId
    ];

    // Ejecución atómica en transacción
    const runInTx = async (txClient) => {
      const resNotice = await txClient.query(insertNoticeSql, noticeValues);
      await txClient.query(insertHistorySql, historyValues);
      return deepClone(resNotice.rows[0]);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Consulta un aviso por su ID junto a sus revisiones técnicas y eventos de auditoría.
   */
  async getNoticeById(noticeId, client = null) {
    const executor = this.getExecutor(client);
    if (!executor) throw new Error('Conexión a base de datos no disponible.');

    const res = await executor.query(
      'SELECT * FROM phytosanitary_notices WHERE id = $1 LIMIT 1',
      [noticeId]
    );
    if (!res.rows || res.rows.length === 0) return null;

    const notice = res.rows[0];

    // Consultar revisiones técnicas asociadas
    const resRev = await executor.query(
      'SELECT * FROM phytosanitary_technical_reviews WHERE notice_id = $1 ORDER BY id ASC',
      [noticeId]
    );
    notice.technical_reviews = resRev.rows || [];

    // Consultar auditoría asociada
    const resHist = await executor.query(
      'SELECT * FROM phytosanitary_notice_history WHERE notice_id = $1 ORDER BY id ASC',
      [noticeId]
    );
    notice.audit_history = resHist.rows || [];

    return deepClone(notice);
  }

  /**
   * Consulta filtrada del catálogo
   */
  async listNotices(filters = {}, client = null) {
    const executor = this.getExecutor(client);
    if (!executor) throw new Error('Conexión a base de datos no disponible.');

    const conditions = [];
    const values = [];

    if (filters.activeOnly) {
      values.push(NOTICE_STATUSES.ACTIVE);
      conditions.push(`verification_status = $${values.length}`);
      conditions.push(`publication_status NOT IN ('derogado', 'sustituido', 'expirado')`);
    }

    if (filters.pendingOnly) {
      conditions.push(`verification_status IN ('discovered', 'pending_verification', 'review_required', 'verified')`);
    }

    if (filters.verificationStatus) {
      values.push(filters.verificationStatus);
      conditions.push(`verification_status = $${values.length}`);
    }

    if (filters.noticeType) {
      values.push(filters.noticeType);
      conditions.push(`notice_type = $${values.length}`);
    }

    if (filters.severity) {
      values.push(filters.severity);
      conditions.push(`severity_official = $${values.length}`);
    }

    if (filters.crop) {
      const cleanCrop = normalizeCrop(filters.crop);
      values.push(JSON.stringify([cleanCrop]));
      conditions.push(`affected_crops @> $${values.length}::jsonb`);
    }

    let sql = 'SELECT * FROM phytosanitary_notices';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY issue_date DESC, id DESC';

    const res = await executor.query(sql, values);
    return deepClone(res.rows || []);
  }

  /**
   * Registra una revisión técnica agronómica de forma atómica.
   */
  async recordTechnicalReview(noticeId, reviewData, actorContext, client = null) {
    assertTrustedActorContext(actorContext);
    if (actorContext.role !== 'advisor' && actorContext.role !== 'admin') {
      throw new Error(`Acceso denegado: El rol "${actorContext.role}" no puede registrar revisiones técnicas.`);
    }

    const {
      observations,
      recommendedStatus = NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference = null
    } = reviewData;

    if (!observations || observations.trim().length === 0) {
      throw new Error('observations es obligatorio para registrar una revisión técnica.');
    }

    const runInTx = async (txClient) => {
      // 1. Bloqueo pesimista de fila (SELECT ... FOR UPDATE)
      const res = await txClient.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
        [noticeId]
      );
      if (!res.rows || res.rows.length === 0) {
        throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
      }

      const notice = res.rows[0];
      const nowIso = new Date().toISOString();

      // 2. Insertar revisión técnica con versión del aviso actual
      const insertRevSql = `
        INSERT INTO phytosanitary_technical_reviews (
          notice_id, reviewer_user_id, reviewer_name, reviewer_role,
          reviewed_at, observations, recommended_status, evidence_reference,
          review_version
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9
        ) RETURNING *;
      `;
      const revValues = [
        noticeId, actorContext.id, actorContext.name, actorContext.role,
        nowIso, observations.trim(), recommendedStatus, evidenceReference,
        notice.version
      ];
      await txClient.query(insertRevSql, revValues);

      // 3. Actualizar estado del aviso si corresponde
      const targetStatus = recommendedStatus || NOTICE_STATUSES.REVIEW_REQUIRED;
      await txClient.query(
        'UPDATE phytosanitary_notices SET verification_status = $1, updated_at = $2 WHERE id = $3',
        [targetStatus, nowIso, noticeId]
      );

      // 4. Registrar auditoría
      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason, evidence_reference,
          event_timestamp, record_version, correlation_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14
        );
      `, [
        eventId, noticeId, notice.verification_status, targetStatus, notice.verification_status, targetStatus,
        actorContext.id, actorContext.role, 'TECHNICAL_REVIEW_RECORDED', observations.trim(), evidenceReference,
        nowIso, notice.version, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(noticeId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Aprueba formalmente un aviso dentro de una transacción ACID estricta.
   */
  async approveNotice(noticeId, reviewerContext, options = {}, client = null) {
    assertTrustedActorContext(reviewerContext, 'admin');

    const reason = typeof options === 'string' ? options : (options.reason || 'Aprobación administrativa formal');
    const evidenceReference = typeof options === 'object' ? options.evidenceReference : null;
    const expectedVersion = typeof options === 'object' ? options.expectedVersion : null;

    const runInTx = async (txClient) => {
      // 1. Verificación en base de datos del estado activo del administrador
      if (this.verifyUserActive) {
        const uStatus = await verifyActiveUserStatus(reviewerContext.id, {
          expectedRole: 'admin',
          client: txClient
        });
        if (!uStatus.valid) {
          throw new Error(`Aprobación denegada: ${uStatus.reason}`);
        }
      }

      // 2. Bloqueo de fila y lectura de estado actual (SELECT ... FOR UPDATE)
      const res = await txClient.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
        [noticeId]
      );
      if (!res.rows || res.rows.length === 0) {
        throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
      }

      const notice = res.rows[0];

      // 3. Concurrencia optimista
      if (expectedVersion !== undefined && expectedVersion !== null) {
        if (Number(expectedVersion) !== Number(notice.version)) {
          throw new Error(`Conflicto de concurrencia: la versión esperada (${expectedVersion}) no coincide con la actual (${notice.version}).`);
        }
      }

      // 4. Bloqueo si ya está aprobado
      if (notice.verification_status === NOTICE_STATUSES.APPROVED || notice.verification_status === NOTICE_STATUSES.ACTIVE) {
        throw new Error(`El aviso "${noticeId}" ya se encuentra en estado ${notice.verification_status}.`);
      }

      // 5. Validación de estado permitido: NUNCA aprobar directamente desde VERIFIED
      if (notice.verification_status === NOTICE_STATUSES.VERIFIED) {
        throw new Error('Aprobación denegada: No se permite la aprobación basada exclusivamente en estado VERIFIED. Se requiere revisión técnica previa en estado REVIEW_REQUIRED.');
      }
      if (notice.verification_status !== NOTICE_STATUSES.REVIEW_REQUIRED) {
        throw new Error(`Transición inválida: No se puede aprobar un aviso en estado "${notice.verification_status}". Debe encontrarse en estado REVIEW_REQUIRED.`);
      }

      const isHighImpact = notice.severity_official === 'emergencia' ||
        notice.severity_official === 'alerta_roja' ||
        notice.priority_internal === 'alta' ||
        Boolean(notice.requires_human_review);

      // 6. Verificación de evidencia obligatoria
      const evidence = evidenceReference || notice.verification_evidence;
      if (!evidence || (typeof evidence === 'object' && Object.keys(evidence).length === 0)) {
        throw new Error('Se requiere evidencia verificable de procedencia institucional para aprobar el aviso fitosanitario.');
      }

      // 7. Verificación de revisión técnica válida correspondiente a la versión actual
      const resRev = await txClient.query(
        'SELECT * FROM phytosanitary_technical_reviews WHERE notice_id = $1 AND review_version = $2',
        [noticeId, notice.version]
      );
      if (isHighImpact || Boolean(notice.requires_human_review) || options.requireTechnicalReview === true) {
        const resAll = await txClient.query(
          'SELECT * FROM phytosanitary_technical_reviews WHERE notice_id = $1',
          [noticeId]
        );
        if (!resAll.rows || resAll.rows.length === 0) {
          throw new Error('Se requiere al menos una revisión técnica previa completada para aprobar este aviso fitosanitario.');
        }
        if (!resRev.rows || resRev.rows.length === 0) {
          throw new Error(`La revisión técnica existente corresponde a una versión anterior y no a la versión actual (${notice.version}) del aviso.`);
        }
      }

      // 8. Comprobar separación de funciones: El aprobador no debe ser el mismo revisor técnico que emitió el informe
      if (resRev && resRev.rows && resRev.rows.length > 0) {
        const selfReview = resRev.rows.find(r => Number(r.reviewer_user_id) === Number(reviewerContext.id));
        if (selfReview) {
          throw new Error('Separación de funciones violada: El aprobador no puede ser el mismo usuario que realizó la revisión técnica del aviso.');
        }
      }

      // 9. Actualización atómica del aviso
      const nowIso = new Date().toISOString();
      const newVersion = notice.version + 1;
      await txClient.query(`
        UPDATE phytosanitary_notices SET
          verification_status = $1,
          approved_by_user_id = $2,
          approved_by_name = $3,
          approved_at = $4,
          verification_evidence = COALESCE($5::jsonb, verification_evidence),
          version = $6,
          updated_at = $7
        WHERE id = $8;
      `, [
        NOTICE_STATUSES.APPROVED,
        reviewerContext.id,
        reviewerContext.name,
        nowIso,
        evidenceReference ? JSON.stringify(evidenceReference) : null,
        newVersion,
        nowIso,
        noticeId
      ]);

      // 10. Inserción obligatoria del evento en el historial durable append-only
      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason, evidence_reference,
          event_timestamp, record_version, correlation_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14
        );
      `, [
        eventId, noticeId, notice.verification_status, NOTICE_STATUSES.APPROVED,
        notice.verification_status, NOTICE_STATUSES.APPROVED,
        reviewerContext.id, reviewerContext.role, 'NOTICE_APPROVED', reason,
        evidenceReference ? JSON.stringify(evidenceReference) : null,
        nowIso, newVersion, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(noticeId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Modifica metadatos con detección de cambios sustantivos e invalidación atómica.
   */
  async updateNotice(noticeId, updates, actorContext, options = {}, client = null) {
    assertTrustedActorContext(actorContext, 'admin');

    const expectedVersion = options.expectedVersion;

    const runInTx = async (txClient) => {
      const res = await txClient.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
        [noticeId]
      );
      if (!res.rows || res.rows.length === 0) {
        throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
      }

      const notice = res.rows[0];

      if (expectedVersion !== undefined && expectedVersion !== null) {
        if (Number(expectedVersion) !== Number(notice.version)) {
          throw new Error(`Conflicto de concurrencia: la versión esperada (${expectedVersion}) no coincide con la actual (${notice.version}).`);
        }
      }

      const isSubstantive = isSubstantiveChange(notice, updates);
      let targetStatus = notice.verification_status;
      let previousApproval = null;
      let statusInvalidated = false;

      if (isSubstantive && (notice.verification_status === NOTICE_STATUSES.APPROVED || notice.verification_status === NOTICE_STATUSES.ACTIVE)) {
        targetStatus = NOTICE_STATUSES.REVIEW_REQUIRED;
        statusInvalidated = true;
        if (notice.approved_by_user_id) {
          previousApproval = {
            approved_by_user_id: notice.approved_by_user_id,
            approved_by_name: notice.approved_by_name,
            approved_at: notice.approved_at,
            invalidated_at: new Date().toISOString(),
            invalidated_at_version: notice.version
          };
        }
      }

      const nowIso = new Date().toISOString();
      const newVersion = notice.version + 1;

      // Actualizar columnas
      const updatedTitle = updates.official_title !== undefined ? updates.official_title.trim() : notice.official_title;
      const updatedUrl = updates.official_url !== undefined ? updates.official_url.trim() : notice.official_url;
      const updatedCrops = updates.affected_crops !== undefined ? updates.affected_crops.map(c => normalizeCrop(c)).filter(Boolean) : notice.affected_crops;
      const updatedScope = updates.geographical_scope !== undefined ? updates.geographical_scope : notice.geographical_scope;
      const updatedSeverity = updates.severity_official !== undefined ? updates.severity_official : notice.severity_official;
      const updatedEvidence = updates.verification_evidence !== undefined ? updates.verification_evidence : notice.verification_evidence;

      await txClient.query(`
        UPDATE phytosanitary_notices SET
          official_title = $1,
          official_url = $2,
          affected_crops = $3::jsonb,
          geographical_scope = $4::jsonb,
          severity_official = $5,
          verification_evidence = $6::jsonb,
          verification_status = $7,
          approved_by_user_id = CASE WHEN $8 THEN NULL ELSE approved_by_user_id END,
          approved_by_name = CASE WHEN $8 THEN NULL ELSE approved_by_name END,
          approved_at = CASE WHEN $8 THEN NULL ELSE approved_at END,
          previous_approval = CASE WHEN $8 THEN $9::jsonb ELSE previous_approval END,
          version = $10,
          updated_at = $11
        WHERE id = $12;
      `, [
        updatedTitle, updatedUrl, JSON.stringify(updatedCrops), JSON.stringify(updatedScope),
        updatedSeverity, updatedEvidence ? JSON.stringify(updatedEvidence) : null,
        targetStatus, statusInvalidated, previousApproval ? JSON.stringify(previousApproval) : null,
        newVersion, nowIso, noticeId
      ]);

      // Registro de auditoría
      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      const actionName = statusInvalidated ? 'APPROVAL_INVALIDATED' : (isSubstantive ? 'NOTICE_SUBSTANTIVE_UPDATE' : 'NOTICE_METADATA_UPDATE');
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason, evidence_reference,
          event_timestamp, record_version, correlation_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14
        );
      `, [
        eventId, noticeId, notice.verification_status, targetStatus,
        notice.verification_status, targetStatus,
        actorContext.id, actorContext.role, actionName,
        updates.reason || 'Modificación de metadatos administrativos',
        updates.evidence_reference || null,
        nowIso, newVersion, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(noticeId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Retira un aviso de circulación
   */
  async withdrawNotice(noticeId, reviewerContext, reason = 'Aviso retirado', client = null) {
    assertTrustedActorContext(reviewerContext, 'admin');

    const runInTx = async (txClient) => {
      const res = await txClient.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
        [noticeId]
      );
      if (!res.rows || res.rows.length === 0) {
        throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
      }

      const notice = res.rows[0];
      const nowIso = new Date().toISOString();
      const newVersion = notice.version + 1;

      await txClient.query(`
        UPDATE phytosanitary_notices SET
          verification_status = $1,
          publication_status = 'retirado',
          withdrawn_at = $2,
          withdrawn_by_user_id = $3,
          version = $4,
          updated_at = $2
        WHERE id = $5;
      `, [NOTICE_STATUSES.WITHDRAWN, nowIso, reviewerContext.id, newVersion, noticeId]);

      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason,
          event_timestamp, record_version, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
      `, [
        eventId, noticeId, notice.verification_status, NOTICE_STATUSES.WITHDRAWN,
        notice.verification_status, NOTICE_STATUSES.WITHDRAWN,
        reviewerContext.id, reviewerContext.role, 'NOTICE_WITHDRAWN', reason,
        nowIso, newVersion, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(noticeId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Rechaza un aviso fitosanitario con justificación documentada
   */
  async rejectNotice(noticeId, reviewerContext, reason = 'Aviso rechazado por inconsistencia documental', client = null) {
    assertTrustedActorContext(reviewerContext, ['admin', 'advisor']);

    const runInTx = async (txClient) => {
      const res = await txClient.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
        [noticeId]
      );
      if (!res.rows || res.rows.length === 0) {
        throw new Error(`Aviso fitosanitario "${noticeId}" no encontrado.`);
      }

      const notice = res.rows[0];
      const nowIso = new Date().toISOString();
      const newVersion = notice.version + 1;

      await txClient.query(`
        UPDATE phytosanitary_notices SET
          verification_status = $1,
          version = $2,
          updated_at = $3
        WHERE id = $4;
      `, [NOTICE_STATUSES.REJECTED, newVersion, nowIso, noticeId]);

      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason,
          event_timestamp, record_version, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
      `, [
        eventId, noticeId, notice.verification_status, NOTICE_STATUSES.REJECTED,
        notice.verification_status, NOTICE_STATUSES.REJECTED,
        reviewerContext.id, reviewerContext.role, 'NOTICE_REJECTED', reason,
        nowIso, newVersion, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(noticeId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Sustituye un aviso por otro más reciente con adquisición determinista de bloqueos FOR UPDATE (H-MED-01).
   * Previene deadlocks por bloqueo cruzado ordenando los identificadores antes de adquirir las filas.
   */
  async supersedeNotice(oldNoticeId, newNoticeId, reviewerContext, reason = 'Sustituido', client = null) {
    assertTrustedActorContext(reviewerContext, 'admin');

    // 1. Validar identificadores y normalizarlos
    if (!oldNoticeId || typeof oldNoticeId !== 'string' || oldNoticeId.trim().length === 0) {
      throw new Error('Identificador de aviso original (oldNoticeId) inválido o no especificado.');
    }
    if (!newNoticeId || typeof newNoticeId !== 'string' || newNoticeId.trim().length === 0) {
      throw new Error('Identificador de aviso sustituto (newNoticeId) inválido o no especificado.');
    }

    const cleanOldId = oldNoticeId.trim();
    const cleanNewId = newNoticeId.trim();

    // 2. Rechazar IDs idénticos
    if (cleanOldId === cleanNewId) {
      throw new Error(`Sustitución inválida: Un aviso no puede sustituirse a sí mismo ("${cleanOldId}").`);
    }

    // 3. Orden determinista de identificadores para prevenir deadlocks
    const sortedIds = [cleanOldId, cleanNewId].sort((a, b) => a.localeCompare(b));

    const runInTx = async (txClient) => {
      // 4. Adquirir bloqueos FOR UPDATE en orden estrictamente determinista
      const lockedRows = new Map();
      for (const id of sortedIds) {
        const res = await txClient.query(
          'SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (!res.rows || res.rows.length === 0) {
          const roleDesc = id === cleanOldId ? 'original' : 'sustituto';
          throw new Error(`Aviso ${roleDesc} "${id}" no existe.`);
        }
        lockedRows.set(id, res.rows[0]);
      }

      const oldNotice = lockedRows.get(cleanOldId);
      const newNotice = lockedRows.get(cleanNewId);

      // 5. Validaciones de negocio sobre las filas bloqueadas
      if (oldNotice.verification_status === NOTICE_STATUSES.SUPERSEDED || oldNotice.publication_status === 'sustituido' || Boolean(oldNotice.superseded_by)) {
        throw new Error(`El aviso original "${cleanOldId}" ya se encuentra sustituido.`);
      }

      if (newNotice.verification_status === NOTICE_STATUSES.WITHDRAWN || newNotice.publication_status === 'retirado') {
        throw new Error(`El aviso sustituto "${cleanNewId}" se encuentra retirado y no puede sustituir a otro aviso.`);
      }
      if (newNotice.verification_status === NOTICE_STATUSES.SUPERSEDED || newNotice.publication_status === 'sustituido') {
        throw new Error(`El aviso sustituto "${cleanNewId}" ya ha sido sustituido y no puede utilizarse como sustituto.`);
      }

      // Verificación de referencias circulares
      if (oldNotice.supersedes_notice_id === cleanNewId || newNotice.superseded_by === cleanOldId) {
        throw new Error(`Relación circular detectada: "${cleanOldId}" y "${cleanNewId}" presentan referencias cruzadas de sustitución.`);
      }

      const nowIso = new Date().toISOString();
      const newVersion = oldNotice.version + 1;

      // 6. Actualización atómica de ambas filas
      await txClient.query(`
        UPDATE phytosanitary_notices SET
          verification_status = $1,
          publication_status = 'sustituido',
          superseded_by = $2,
          version = $3,
          updated_at = $4
        WHERE id = $5;
      `, [NOTICE_STATUSES.SUPERSEDED, cleanNewId, newVersion, nowIso, cleanOldId]);

      await txClient.query(`
        UPDATE phytosanitary_notices SET
          supersedes_notice_id = $1,
          updated_at = $2
        WHERE id = $3;
      `, [cleanOldId, nowIso, cleanNewId]);

      // 7. Registro de auditoría durable
      const eventId = crypto.randomUUID ? crypto.randomUUID() : `EVT-${Date.now()}`;
      await txClient.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason,
          event_timestamp, record_version, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
      `, [
        eventId, cleanOldId, oldNotice.verification_status, NOTICE_STATUSES.SUPERSEDED,
        oldNotice.verification_status, NOTICE_STATUSES.SUPERSEDED,
        reviewerContext.id, reviewerContext.role, 'NOTICE_SUPERSEDED', reason,
        nowIso, newVersion, `CORR-${Date.now()}`
      ]);

      return await this.getNoticeById(cleanOldId, txClient);
    };

    return await this._runTransactional(runInTx, client);
  }

  /**
   * Obtiene el historial de auditoría ordenado
   */
  async getNoticeHistory(noticeId, client = null) {
    const executor = this.getExecutor(client);
    if (!executor) throw new Error('Conexión a base de datos no disponible.');

    const res = await executor.query(
      'SELECT * FROM phytosanitary_notice_history WHERE notice_id = $1 ORDER BY id ASC',
      [noticeId]
    );
    const list = res.rows || [];
    return Object.freeze(deepClone(list).map(event => Object.freeze(event)));
  }
}

/**
 * Crea un contexto explícito para indicar que el llamador posee una transacción activa.
 */
function createCallerTransactionContext(client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Cliente inválido para contexto transaccional del llamador.');
  }
  return {
    client,
    inTransaction: true,
    isCallerManaged: true
  };
}

/**
 * Crea un contexto explícito para delegar temporalmente el manejo de BEGIN/COMMIT/ROLLBACK
 * al repositorio sobre una conexión existente, sin transferir la propiedad de release().
 */
function createDelegatedTransactionContext(client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Cliente inválido para contexto transaccional delegado.');
  }
  return {
    client,
    delegateTransaction: true,
    isCallerManaged: false
  };
}

module.exports = {
  PhytosanitaryNoticeRepository,
  assertTrustedActorContext,
  createCallerTransactionContext,
  createDelegatedTransactionContext
};
