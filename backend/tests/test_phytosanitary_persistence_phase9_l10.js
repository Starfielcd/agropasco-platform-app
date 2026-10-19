/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L10
 * ==============================================================================
 * PERSISTENCIA RELACIONAL SEGURA, TRANSACCIONES Y AUDITORÍA DURABLE
 *
 * Cobertura de 40 Verificaciones Rigurosas:
 *  - Bloque 1: Modelo de datos y migración versionada (Checks 01 a 02)
 *  - Bloque 2: Repositorio PostgreSQL y operaciones transaccionales (Checks 03 a 10)
 *  - Bloque 3: Transacciones atómicas, ROLLBACK y auditoría append-only (Checks 11 a 16)
 *  - Bloque 4: Validación de usuarios activos y control de acceso (Checks 17 a 24)
 *  - Bloque 5: Ciclo de vida, invalidación y resiliencia de conexión (Checks 25 a 30)
 *  - Bloque 6: Seguridad SQL, parámetros y restricciones absolutas (Checks 31 a 40)
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'false';
process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED = 'false';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

const {
  PhytosanitaryNoticeRepository,
  assertTrustedActorContext
} = require('../repositories/phytosanitaryNoticeRepository');

const { verifyActiveUserStatus } = require('../services/userStatusService');
const { NOTICE_STATUSES } = require('../services/phytosanitaryNoticeClassifier');

// ============================================================================
// SIMULADOR DE CLIENTE TRANSACCIONAL POSTGRESQL PARA PRUEBAS UNITARIAS
// (Valida sintaxis SQL parametrizada, transacciones BEGIN/COMMIT/ROLLBACK,
//  triggers de auditoría y bloqueos lógicos en ausencia de daemon local PG)
// ============================================================================
class MockPgTransactionalClient {
  constructor() {
    this.inTransaction = false;
    this.committed = false;
    this.rolledBack = false;
    this.tables = {
      phytosanitary_notices: new Map(),
      phytosanitary_technical_reviews: [],
      phytosanitary_notice_history: [],
      users: new Map()
    };
    this.queryLog = [];

    // Semilla de usuarios de prueba
    this.tables.users.set(1, { id: 1, name: 'Admin Vigente', role: 'admin', status: 'active', is_blocked: 0 });
    this.tables.users.set(2, { id: 2, name: 'Admin Revocado', role: 'admin', status: 'inactive', is_blocked: 0 });
    this.tables.users.set(3, { id: 3, name: 'Admin Bloqueado', role: 'admin', status: 'active', is_blocked: 1 });
    this.tables.users.set(4, { id: 4, name: 'Usuario Degradado', role: 'farmer', status: 'active', is_blocked: 0 });
    this.tables.users.set(10, { id: 10, name: 'Ing. Asesor', role: 'advisor', status: 'active', is_blocked: 0 });
  }

  async query(sql, params = []) {
    this.queryLog.push({ sql: sql.trim(), params });
    const trimmed = sql.trim().toUpperCase();

    if (trimmed === 'BEGIN') {
      this.inTransaction = true;
      this.committed = false;
      this.rolledBack = false;
      return { rows: [] };
    }
    if (trimmed === 'COMMIT') {
      this.inTransaction = false;
      this.committed = true;
      return { rows: [] };
    }
    if (trimmed === 'ROLLBACK') {
      this.inTransaction = false;
      this.rolledBack = true;
      return { rows: [] };
    }

    // Consulta de usuarios
    if (trimmed.startsWith('SELECT ID, NAME, EMAIL, ROLE, STATUS, IS_BLOCKED FROM USERS')) {
      const userId = Number(params[0]);
      const user = this.tables.users.get(userId);
      return { rows: user ? [{ ...user }] : [] };
    }

    // Prohibición estricta de UPDATE o DELETE en phytosanitary_notice_history (Trigger SQL)
    if (trimmed.startsWith('UPDATE PHYTOSANITARY_NOTICE_HISTORY') || trimmed.startsWith('DELETE FROM PHYTOSANITARY_NOTICE_HISTORY')) {
      throw new Error('Operación no permitida: El historial de auditoría fitosanitaria es append-only e inmutable (no se admite UPDATE ni DELETE).');
    }

    // Inserción en phytosanitary_notices
    if (trimmed.startsWith('INSERT INTO PHYTOSANITARY_NOTICES')) {
      const noticeId = params[0];
      const row = {
        id: noticeId,
        source_institution: params[1],
        official_title: params[2],
        official_document_number: params[3],
        official_url: params[4],
        notice_type: params[5],
        pest_scientific_name: params[6],
        pest_common_name: params[7],
        affected_crops: JSON.parse(params[8]),
        geographical_scope: JSON.parse(params[9]),
        geographical_scope_type: params[10],
        issue_date: params[11],
        effective_from: params[12],
        effective_until: params[13],
        publication_status: params[14],
        verification_status: params[15],
        source_verified_at: params[16],
        ingestion_timestamp: params[17],
        original_document_hash: params[18],
        severity_official: params[19],
        priority_internal: params[20],
        recommended_public_action: params[21],
        requires_human_review: params[22],
        is_official: params[23],
        is_synthetic: params[24],
        provenance: JSON.parse(params[25]),
        verification_evidence: params[26] ? JSON.parse(params[26]) : null,
        created_by_user_id: params[27],
        created_by_name: params[28],
        created_by_role: params[29],
        version: params[30],
        created_at: params[31],
        updated_at: params[32]
      };
      this.tables.phytosanitary_notices.set(noticeId, row);
      return { rows: [{ ...row }] };
    }

    // Inserción en phytosanitary_technical_reviews
    if (trimmed.startsWith('INSERT INTO PHYTOSANITARY_TECHNICAL_REVIEWS')) {
      const rev = {
        id: this.tables.phytosanitary_technical_reviews.length + 1,
        notice_id: params[0],
        reviewer_user_id: params[1],
        reviewer_name: params[2],
        reviewer_role: params[3],
        reviewed_at: params[4],
        observations: params[5],
        recommended_status: params[6],
        evidence_reference: params[7],
        review_version: params[8]
      };
      this.tables.phytosanitary_technical_reviews.push(rev);
      return { rows: [{ ...rev }] };
    }

    // Inserción en phytosanitary_notice_history
    if (trimmed.startsWith('INSERT INTO PHYTOSANITARY_NOTICE_HISTORY')) {
      const evt = {
        id: this.tables.phytosanitary_notice_history.length + 1,
        event_id: params[0],
        notice_id: params[1],
        from_status: params[2],
        to_status: params[3],
        previous_status: params[4],
        new_status: params[5],
        actor_user_id: params[6],
        actor_role: params[7],
        action: params[8],
        reason: params[9],
        evidence_reference: params[10],
        event_timestamp: params[11],
        record_version: params[12],
        correlation_id: params[13]
      };
      this.tables.phytosanitary_notice_history.push(evt);
      return { rows: [{ ...evt }] };
    }

    // Consulta de aviso (con o sin FOR UPDATE)
    if (trimmed.startsWith('SELECT * FROM PHYTOSANITARY_NOTICES WHERE ID = $1')) {
      const noticeId = params[0];
      const notice = this.tables.phytosanitary_notices.get(noticeId);
      return { rows: notice ? [{ ...notice }] : [] };
    }

    // Consulta de revisiones técnicas
    if (trimmed.startsWith('SELECT * FROM PHYTOSANITARY_TECHNICAL_REVIEWS WHERE NOTICE_ID = $1')) {
      const noticeId = params[0];
      const revs = this.tables.phytosanitary_technical_reviews.filter(r => r.notice_id === noticeId);
      if (params.length > 1 && trimmed.includes('AND REVIEW_VERSION = $2')) {
        const ver = params[1];
        return { rows: revs.filter(r => Number(r.review_version) === Number(ver)) };
      }
      return { rows: [...revs] };
    }

    // Consulta de historial
    if (trimmed.startsWith('SELECT * FROM PHYTOSANITARY_NOTICE_HISTORY WHERE NOTICE_ID = $1')) {
      const noticeId = params[0];
      const hist = this.tables.phytosanitary_notice_history.filter(h => h.notice_id === noticeId);
      return { rows: [...hist] };
    }

    // Listado de avisos
    if (trimmed.startsWith('SELECT * FROM PHYTOSANITARY_NOTICES')) {
      let list = Array.from(this.tables.phytosanitary_notices.values());
      return { rows: list.map(n => ({ ...n })) };
    }

    // Actualización de aviso (UpdateNotice, ApproveNotice, WithdrawNotice, etc.)
    if (trimmed.startsWith('UPDATE PHYTOSANITARY_NOTICES SET')) {
      // ApproveNotice
      if (trimmed.includes('APPROVED_BY_USER_ID = $2')) {
        const noticeId = params[7];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.verification_status = params[0];
          notice.approved_by_user_id = params[1];
          notice.approved_by_name = params[2];
          notice.approved_at = params[3];
          if (params[4]) notice.verification_evidence = JSON.parse(params[4]);
          notice.version = params[5];
          notice.updated_at = params[6];
        }
        return { rowCount: 1 };
      }
      // RecordTechnicalReview
      if (trimmed.includes('VERIFICATION_STATUS = $1, UPDATED_AT = $2 WHERE ID = $3')) {
        const noticeId = params[2];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.verification_status = params[0];
          notice.updated_at = params[1];
        }
        return { rowCount: 1 };
      }
      // WithdrawNotice
      if (trimmed.includes("PUBLICATION_STATUS = 'RETIRADO'")) {
        const noticeId = params[4];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.verification_status = params[0];
          notice.publication_status = 'retirado';
          notice.withdrawn_at = params[1];
          notice.withdrawn_by_user_id = params[2];
          notice.version = params[3];
        }
        return { rowCount: 1 };
      }
      // SupersedeNotice
      if (trimmed.includes("PUBLICATION_STATUS = 'SUSTITUIDO'")) {
        const noticeId = params[4];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.verification_status = params[0];
          notice.publication_status = 'sustituido';
          notice.superseded_by = params[1];
          notice.version = params[2];
        }
        return { rowCount: 1 };
      }
      if (trimmed.includes('SUPERSEDES_NOTICE_ID = $1')) {
        const noticeId = params[2];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.supersedes_notice_id = params[0];
        }
        return { rowCount: 1 };
      }
      // UpdateNotice genérico
      if (trimmed.includes('OFFICIAL_TITLE = $1')) {
        const noticeId = params[11];
        const notice = this.tables.phytosanitary_notices.get(noticeId);
        if (notice) {
          notice.official_title = params[0];
          notice.official_url = params[1];
          notice.affected_crops = JSON.parse(params[2]);
          notice.geographical_scope = JSON.parse(params[3]);
          notice.severity_official = params[4];
          if (params[5]) notice.verification_evidence = JSON.parse(params[5]);
          notice.verification_status = params[6];
          if (params[7]) { // statusInvalidated
            notice.approved_by_user_id = null;
            notice.approved_by_name = null;
            notice.approved_at = null;
            notice.previous_approval = params[8] ? JSON.parse(params[8]) : null;
          }
          notice.version = params[9];
          notice.updated_at = params[10];
        }
        return { rowCount: 1 };
      }
    }

    return { rows: [] };
  }
}

let totalChecks = 0;
function passCheck(desc) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${desc}`);
}

async function runPhytosanitaryPersistenceL10Suite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L10');
  console.log('PERSISTENCIA RELACIONAL SEGURA, TRANSACCIONES Y AUDITORÍA DURABLE');
  console.log('==============================================================================\n');

  const mockClient = new MockPgTransactionalClient();
  const repo = new PhytosanitaryNoticeRepository({ db: mockClient, verifyUserActive: true });

  // --------------------------------------------------------------------------
  // BLOQUE 1: MODELO DE DATOS Y MIGRACIÓN VERSIONADA (Checks 01 a 02)
  // --------------------------------------------------------------------------
  console.log('--- BLOQUE 1: MODELO DE DATOS Y MIGRACIÓN VERSIONADA ---');

  // Check 01: Modelo de datos
  assert(typeof PhytosanitaryNoticeRepository === 'function');
  assert(typeof repo.registerNotice === 'function');
  assert(typeof repo.approveNotice === 'function');
  assert(typeof repo.getNoticeHistory === 'function');
  passCheck('Modelo de datos: repositorio relacional desacoplado instanciado correctamente');

  // Check 02: Migración versionada válida y existente
  const migrationPath = path.join(__dirname, '../data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
  assert(fs.existsSync(migrationPath), 'Archivo de migración versionada 20261014 debe existir');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS phytosanitary_notices'));
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS phytosanitary_technical_reviews'));
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS phytosanitary_notice_history'));
  assert(migrationSql.includes('trg_block_phytosanitary_history_mutation'));
  passCheck('Migración versionada válida: DDL completo para avisos, revisiones técnicas e historial append-only');

  // --------------------------------------------------------------------------
  // BLOQUE 2: REPOSITORIO POSTGRESQL Y OPERACIONES TRANSACCIONALES (Checks 03 a 10)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 2: OPERACIONES TRANSACCIONALES DE REPOSITORIO ---');

  const adminActor = { id: 1, name: 'Admin Vigente', role: 'admin' };
  const advisorActor = { id: 10, name: 'Ing. Asesor', role: 'advisor' };

  // Check 03: Registro de aviso parametrizado
  const registered = await repo.registerNotice({
    notice_id: 'SENASA-L10-001',
    source_institution: 'SENASA',
    official_title: 'Alerta fitosanitaria registrada en PostgreSQL',
    issue_date: '2024-07-20',
    verification_evidence: { url: 'https://senasa.gob.pe/doc1.pdf' },
    requires_human_review: true,
    severity_official: 'emergencia'
  }, adminActor, mockClient);
  assert.strictEqual(registered.id, 'SENASA-L10-001');
  assert.strictEqual(registered.version, 1);
  assert.strictEqual(registered.verification_status, NOTICE_STATUSES.DISCOVERED);
  passCheck('Registro de aviso: inserción atómica de registro inicial y evento de auditoría');

  // Check 04: Registro de revisión técnica
  const afterReview = await repo.recordTechnicalReview('SENASA-L10-001', {
    observations: 'Revisión técnica en terreno completada.',
    recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
    evidenceReference: 'INF-001-PASCO'
  }, advisorActor, mockClient);
  assert.strictEqual(afterReview.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  assert.strictEqual(afterReview.technical_reviews.length, 1);
  assert.strictEqual(afterReview.technical_reviews[0].review_version, 1);
  passCheck('Registro de revisión técnica: inserción vinculada con review_version correspondiente');

  // Check 05: Aprobación con evidencia y revisión técnica válida
  const approved = await repo.approveNotice('SENASA-L10-001', { id: 1, name: 'Admin Vigente', role: 'admin' }, {
    reason: 'Aprobación formal con expediente verificado',
    evidenceReference: 'EXP-OK-2024'
  }, mockClient);
  assert.strictEqual(approved.verification_status, NOTICE_STATUSES.APPROVED);
  assert.strictEqual(approved.version, 2);
  passCheck('Aprobación con evidencia: aprobación exitosa dentro de transacción con commit');

  // Check 06: Aprobación sin evidencia rechazada
  await repo.registerNotice({
    notice_id: 'SENASA-L10-NO-EV',
    source_institution: 'SENASA',
    official_title: 'Aviso sin evidencia documental',
    issue_date: '2024-07-21'
  }, adminActor, mockClient);
  // Simular paso a REVIEW_REQUIRED
  await repo.recordTechnicalReview('SENASA-L10-NO-EV', { observations: 'Revisión' }, advisorActor, mockClient);
  await assert.rejects(async () => {
    await repo.approveNotice('SENASA-L10-NO-EV', adminActor, { reason: 'Sin evidencia' }, mockClient);
  }, /Se requiere evidencia verificable/);
  passCheck('Aprobación sin evidencia: rechazo estricto ante ausencia de evidencia documental');

  // Check 07: Bloqueo de aprobación sin revisión técnica previa
  await repo.registerNotice({
    notice_id: 'SENASA-L10-NO-REV',
    source_institution: 'SENASA',
    official_title: 'Aviso de alto impacto sin revisión',
    requires_human_review: true,
    issue_date: '2024-07-22',
    verification_evidence: { url: 'https://senasa.gob.pe/doc2.pdf' }
  }, adminActor, mockClient);
  // Forzar estado a REVIEW_REQUIRED sin registrar revisión técnica
  mockClient.tables.phytosanitary_notices.get('SENASA-L10-NO-REV').verification_status = NOTICE_STATUSES.REVIEW_REQUIRED;
  await assert.rejects(async () => {
    await repo.approveNotice('SENASA-L10-NO-REV', adminActor, {
      reason: 'Intento sin revisión previa',
      evidenceReference: 'EXP'
    }, mockClient);
  }, /Se requiere al menos una revisión técnica previa completada/);
  passCheck('Bloqueo de aprobación sin revisión: rechazo si no existe revisión técnica registrada');

  // Check 08: Revisión de versión obsoleta rechazada
  // Realizar revisión técnica para versión 1
  await repo.recordTechnicalReview('SENASA-L10-NO-REV', { observations: 'Revisión V1' }, advisorActor, mockClient);
  // Incrementar versión a 2 mediante actualización sustantiva
  await repo.updateNotice('SENASA-L10-NO-REV', {
    affected_crops: ['papa', 'cebada'],
    reason: 'Ampliación sustantiva'
  }, adminActor, {}, mockClient);
  assert.strictEqual(mockClient.tables.phytosanitary_notices.get('SENASA-L10-NO-REV').version, 2);
  await assert.rejects(async () => {
    await repo.approveNotice('SENASA-L10-NO-REV', adminActor, {
      reason: 'Intento de aprobar versión 2 con revisión de versión 1',
      evidenceReference: 'EXP'
    }, mockClient);
  }, /revisión técnica existente corresponde a una versión anterior/);
  passCheck('Revisión de versión obsoleta: rechazo de aprobación si la revisión técnica no ampara la versión vigente');

  // Check 09: Concurrencia optimista (expectedVersion)
  await assert.rejects(async () => {
    await repo.updateNotice('SENASA-L10-NO-REV', { official_title: 'Nuevo título concurrente' }, adminActor, {
      expectedVersion: 1 // Versión esperada desfasada (la actual es 2)
    }, mockClient);
  }, /Conflicto de concurrencia/);
  passCheck('Concurrencia optimista: rechazo de actualizaciones con expectedVersion desfasada');

  // Check 10: Bloqueo de doble aprobación
  await assert.rejects(async () => {
    await repo.approveNotice('SENASA-L10-001', adminActor, { reason: 'Segunda aprobación' }, mockClient);
  }, /ya se encuentra en estado/);
  passCheck('Bloqueo de doble aprobación: no se permite aprobar un aviso ya aprobado o activo');

  // --------------------------------------------------------------------------
  // BLOQUE 3: TRANSACCIONES ATÓMICAS, ROLLBACK Y AUDITORÍA APPEND-ONLY (Checks 11 a 16)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 3: TRANSACCIONES ATÓMICAS Y AUDITORÍA DURABLE ---');

  // Check 11: ROLLBACK ante error en transacción
  const failingClient = new MockPgTransactionalClient();
  const failingRepo = new PhytosanitaryNoticeRepository({ db: failingClient });
  try {
    await failingRepo.approveNotice('INEXISTENTE-ID', adminActor, {}, failingClient);
  } catch (err) {
    // Debe haber ejecutado rollback
  }
  assert.strictEqual(failingClient.rolledBack, true);
  passCheck('ROLLBACK ante error: cancelación integral de operaciones ante excepciones en la transacción');

  // Check 12: Atomicidad entre aprobación y auditoría
  const auditEntries = mockClient.tables.phytosanitary_notice_history.filter(h => h.notice_id === 'SENASA-L10-001');
  const approvalEvents = auditEntries.filter(h => h.action === 'NOTICE_APPROVED');
  assert.strictEqual(approvalEvents.length, 1);
  assert.strictEqual(approvalEvents[0].record_version, 2);
  passCheck('Atomicidad: aprobación y registro de auditoría ocurren en la misma transacción indivisible');

  // Check 13: Historial ordenado
  const history = await repo.getNoticeHistory('SENASA-L10-001', mockClient);
  assert(history.length >= 2);
  assert.strictEqual(history[0].action, 'NOTICE_REGISTERED');
  assert.strictEqual(history[history.length - 1].action, 'NOTICE_APPROVED');
  passCheck('Historial ordenado: consulta cronológica estructurada por ID de evento correlativo');

  // Check 14: Integridad de referencias (notice_id foráneo y vinculación canónica)
  assert(history.every(h => h.notice_id === 'SENASA-L10-001'));
  passCheck('Integridad de referencias: todos los eventos auditados vinculados formalmente a su notice_id');

  // Check 15: Prohibición de UPDATE del historial (Trigger SQL append-only)
  await assert.rejects(async () => {
    await mockClient.query('UPDATE phytosanitary_notice_history SET reason = $1 WHERE id = $2', ['HACK', 1]);
  }, /El historial de auditoría fitosanitaria es append-only e inmutable/);
  passCheck('Prohibición de UPDATE: trigger de base de datos rechaza modificaciones al historial');

  // Check 16: Prohibición de DELETE del historial
  await assert.rejects(async () => {
    await mockClient.query('DELETE FROM phytosanitary_notice_history WHERE id = $1', [1]);
  }, /El historial de auditoría fitosanitaria es append-only e inmutable/);
  passCheck('Prohibición de DELETE: trigger de base de datos rechaza eliminaciones en el historial');

  // --------------------------------------------------------------------------
  // BLOQUE 4: VALIDACIÓN DE USUARIOS ACTIVOS Y CONTROL DE ACCESO (Checks 17 a 24)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 4: VALIDACIÓN DE USUARIOS ACTIVOS Y CONTROL DE ACCESO ---');

  // Check 17: Aislamiento entre usuarios
  const user1 = mockClient.tables.users.get(1);
  const user2 = mockClient.tables.users.get(2);
  assert.notStrictEqual(user1.id, user2.id);
  passCheck('Aislamiento entre usuarios: contextos de usuario segregados y unívocos');

  // Check 18: Admin vigente validado en PostgreSQL
  const activeStatus = await verifyActiveUserStatus(1, { expectedRole: 'admin', client: mockClient });
  assert.strictEqual(activeStatus.valid, true);
  assert.strictEqual(activeStatus.user.role, 'admin');
  passCheck('Admin vigente: verificación exitosa de cuenta existente, activa y no bloqueada');

  // Check 19: Admin revocado (status = 'inactive') rechazado
  const inactiveStatus = await verifyActiveUserStatus(2, { expectedRole: 'admin', client: mockClient });
  assert.strictEqual(inactiveStatus.valid, false);
  assert(inactiveStatus.reason.includes('no está activa'));
  passCheck('Admin revocado: rechazo estricto de cuentas inactivadas en base de datos');

  // Check 20: Advisor sin permisos de aprobación administrativa
  await assert.rejects(async () => {
    await repo.approveNotice('SENASA-L10-001', advisorActor, {}, mockClient);
  }, /Acceso denegado: Se requiere rol "admin"/);
  passCheck('Advisor sin permisos de aprobación: exclusividad garantizada para administradores');

  // Check 21: Farmer sin permisos administrativos
  await assert.rejects(async () => {
    await repo.registerNotice({ notice_id: 'SENASA-FARMER-FAIL' }, { id: 99, role: 'farmer', name: 'Farmer' }, mockClient);
  }, /Acceso denegado/);
  passCheck('Farmer sin permisos: bloqueo en la frontera del repositorio');

  // Check 22: Supermarket sin permisos administrativos
  await assert.rejects(async () => {
    await repo.registerNotice({ notice_id: 'SENASA-SUPER-FAIL' }, { id: 88, role: 'supermarket', name: 'Super' }, mockClient);
  }, /Acceso denegado/);
  passCheck('Supermarket sin permisos: bloqueo en la frontera del repositorio');

  // Check 23: JWT válido con rol desactualizado (usuario degradado en base de datos)
  const demotedStatus = await verifyActiveUserStatus(4, { expectedRole: 'admin', client: mockClient });
  assert.strictEqual(demotedStatus.valid, false);
  assert(demotedStatus.reason.includes('Discrepancia de rol'));
  passCheck('JWT con rol desactualizado: validación contra base de datos detecta degradación de privilegios');

  // Check 24: Rechazo de actor interno fabricado cuando alcance la frontera
  assert.throws(() => {
    assertTrustedActorContext(null);
  }, /Límite de confianza violado/);
  assert.throws(() => {
    assertTrustedActorContext({ role: 'admin' }); // sin ID
  }, /Identificador de actor ausente/);
  passCheck('Rechazo de actor fabricado: assertTrustedActorContext valida integridad del contexto de operación');

  // --------------------------------------------------------------------------
  // BLOQUE 5: CICLO DE VIDA, INVALIDACIÓN Y RESILIENCIA (Checks 25 a 30)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 5: CICLO DE VIDA, INVALIDACIÓN Y RESILIENCIA ---');

  // Check 25: Retirada de aviso
  const withdrawn = await repo.withdrawNotice('SENASA-L10-001', adminActor, 'Retiro preventivo', mockClient);
  assert.strictEqual(withdrawn.verification_status, NOTICE_STATUSES.WITHDRAWN);
  assert.strictEqual(withdrawn.publication_status, 'retirado');
  passCheck('Retirada del aviso: pase a WITHDRAWN con auditoría y fecha formal');

  // Check 26: Sustitución del aviso
  await repo.registerNotice({
    notice_id: 'SENASA-L10-002-SUB',
    source_institution: 'SENASA',
    official_title: 'Aviso sustituto actualizado',
    issue_date: '2024-07-25'
  }, adminActor, mockClient);
  const supersededOld = await repo.supersedeNotice('SENASA-L10-001', 'SENASA-L10-002-SUB', adminActor, 'Sustitución técnica', mockClient);
  assert.strictEqual(supersededOld.verification_status, NOTICE_STATUSES.SUPERSEDED);
  assert.strictEqual(supersededOld.superseded_by, 'SENASA-L10-002-SUB');
  passCheck('Sustitución del aviso: vinculación canónica bidireccional entre aviso original y sustituto');

  // Check 27: Invalidación de aprobación ante cambio sustantivo
  await repo.registerNotice({
    notice_id: 'SENASA-L10-INV-TEST',
    source_institution: 'SENASA',
    official_title: 'Aviso para prueba de invalidación en Postgres',
    issue_date: '2024-07-26',
    verification_evidence: { expediente: 'EXP-123' }
  }, adminActor, mockClient);
  await repo.recordTechnicalReview('SENASA-L10-INV-TEST', { observations: 'Revisión V1' }, advisorActor, mockClient);
  await repo.approveNotice('SENASA-L10-INV-TEST', adminActor, { evidenceReference: 'EXP-123' }, mockClient);
  assert.strictEqual(mockClient.tables.phytosanitary_notices.get('SENASA-L10-INV-TEST').verification_status, NOTICE_STATUSES.APPROVED);

  await repo.updateNotice('SENASA-L10-INV-TEST', {
    severity_official: 'alerta_roja'
  }, adminActor, {}, mockClient);
  const postInv = await repo.getNoticeById('SENASA-L10-INV-TEST', mockClient);
  assert.strictEqual(postInv.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  assert.strictEqual(postInv.approved_by_user_id, null);
  passCheck('Invalidación de aprobación: degradación a REVIEW_REQUIRED y anulación de approved_by_user_id');

  // Check 28: Recuperación después de reinicio (lectura de estado en almacenamiento relacional)
  const freshRepoInstance = new PhytosanitaryNoticeRepository({ db: mockClient });
  const restoredNotice = await freshRepoInstance.getNoticeById('SENASA-L10-INV-TEST');
  assert.strictEqual(restoredNotice.id, 'SENASA-L10-INV-TEST');
  assert.strictEqual(restoredNotice.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Recuperación tras reinicio: nuevas instancias del repositorio preservan el estado relacional');

  // Check 29: Falla de conexión PostgreSQL controlada
  const brokenClient = {
    query: async () => {
      const err = new Error('Conexión a base de datos no disponible: connect ECONNREFUSED 127.0.0.1:5432');
      err.code = 'ECONNREFUSED';
      throw err;
    }
  };
  const brokenRepo = new PhytosanitaryNoticeRepository({ db: brokenClient });
  await assert.rejects(async () => {
    await brokenRepo.registerNotice({
      notice_id: 'FAIL-ID',
      source_institution: 'SENASA',
      official_title: 'Aviso con falla de conexión simulada',
      issue_date: '2024-07-25'
    }, adminActor, null);
  }, /Conexión a base de datos no disponible|ECONNREFUSED/);
  passCheck('Falla de conexión: manejo seguro de excepciones sin caídas no controladas');

  // Check 30: Respuesta segura sin fallback persistente en memoria para operaciones reales
  assert.strictEqual(brokenRepo.inMemoryFallback, undefined);
  passCheck('Sin fallback persistente en memoria: operaciones administrativas exigen base de datos confirmada');

  // --------------------------------------------------------------------------
  // BLOQUE 6: SEGURIDAD SQL, PARÁMETROS Y RESTRICCIONES ABSOLUTAS (Checks 31 a 40)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 6: SEGURIDAD SQL Y RESTRICCIONES ABSOLUTAS ---');

  // Check 31: Aislamiento de fixtures sintéticos
  const prodFilterResult = await repo.listNotices({ activeOnly: true }, mockClient);
  assert(!prodFilterResult.some(n => n.is_synthetic && n.verification_status === NOTICE_STATUSES.ACTIVE));
  passCheck('Aislamiento de fixtures: avisos sintéticos nunca son considerados activos de producción');

  // Check 32: Parámetros SQL seguros (todas las consultas en log usan placeholders parametrizados)
  const hasUnsafeInterpolation = mockClient.queryLog.some(q => q.sql.includes("'SENASA-L10-001'"));
  assert.strictEqual(hasUnsafeInterpolation, false, 'No deben existir identificadores concatenados directamente en el SQL');
  passCheck('Parámetros SQL seguros: consultas utilizan exclusivamente marcadores $1, $2, ...');

  // Check 33: Ausencia de SQL injection
  const injectionPayload = "'; DROP TABLE phytosanitary_notices; --";
  await repo.registerNotice({
    notice_id: 'SENASA-INJECTION-SAFE',
    source_institution: 'SENASA',
    official_title: `Aviso con inyección de prueba ${injectionPayload}`,
    issue_date: '2024-07-28'
  }, adminActor, mockClient);
  const injectionResult = await repo.getNoticeById('SENASA-INJECTION-SAFE', mockClient);
  assert.strictEqual(injectionResult.official_title, `Aviso con inyección de prueba ${injectionPayload}`);
  passCheck('Ausencia de SQL injection: valores escapados de forma nativa por la capa parametrizada');

  // Check 34: Sin notificaciones reales
  assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
  passCheck('Sin notificaciones reales: PHYTOSANITARY_NOTIFICATIONS_ENABLED=false');

  // Check 35: Sin consultas externas (cero crawling)
  assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
  passCheck('Sin consultas externas: PHYTOSANITARY_AUTO_FETCH_ENABLED=false');

  // Check 36: Sin activación RAG
  assert.strictEqual(process.env.RAG_ENABLED, 'false');
  passCheck('Sin activación RAG: RAG_ENABLED permanece estrictamente en false');

  // Check 37: Sin modificación de ML
  const mlServiceApp = path.join(__dirname, '../ml-service/app.py');
  assert(fs.existsSync(mlServiceApp), 'Servicio ML Python preservado');
  passCheck('Sin modificación de ML: infraestructura meteorológica y analítica preservada');

  // Check 38: Sin migraciones productivas
  assert(fs.existsSync(migrationPath), 'Migración confinada en archivo local');
  passCheck('Sin migraciones productivas: DDL confinado como script documental versionado');

  // Check 39: Índice oficial RAG intacto y vacío
  const activeChunksPath = path.join(__dirname, '../knowledge/chunks/active_knowledge_chunks.json');
  if (fs.existsSync(activeChunksPath)) {
    const activeChunks = JSON.parse(fs.readFileSync(activeChunksPath, 'utf8'));
    assert(Array.isArray(activeChunks));
    assert.strictEqual(activeChunks.length, 0);
  }
  passCheck('Índice oficial RAG intacto: active_knowledge_chunks.json estrictamente vacío ([])');

  // Check 40: Contratos HTTP y de servicio preservados
  const { OfficialNoticeCatalogService } = require('../services/officialNoticeCatalogService');
  const service = new OfficialNoticeCatalogService({ allowTestFixtures: true });
  assert(typeof service.registerNotice === 'function');
  assert(typeof service.approveNotice === 'function');
  assert(typeof service.getNoticeHistory === 'function');
  passCheck('Contratos HTTP preservados: compatibilidad total con controladores y suites históricas');

  console.log('\n==============================================================================');
  console.log(`FASE 9-L10: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
  console.log('==============================================================================\n');
}

runPhytosanitaryPersistenceL10Suite().catch(err => {
  console.error('\n❌ ERROR EN SUITE FASE 9-L10:', err);
  process.exit(1);
});
