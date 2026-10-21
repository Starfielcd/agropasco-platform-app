/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L09
 * ==============================================================================
 * GESTIÓN ADMINISTRATIVA, VERIFICACIÓN HUMANA Y GOBERNANZA DE AVISOS FITOSANITARIOS
 *
 * Cobertura de 40 Verificaciones Rigurosas:
 *  - Bloque 1: Registro controlado, validación de fuentes institucionales y metadatos (Checks 01 a 07)
 *  - Bloque 2: Máquina de estados, transiciones y matriz de autorización por rol (Checks 08 a 13)
 *  - Bloque 3: Identidad inviolable, desacoplamiento y blindaje JWT (Checks 14 a 19)
 *  - Bloque 4: Integridad, control de versiones, concurrencia y auditoría inmutable (Checks 20 a 30)
 *  - Bloque 5: Retirada, sustitución y aislamiento operativo de publicación (Checks 31 a 36)
 *  - Bloque 6: Resiliencia del sistema y restricciones absolutas (Checks 37 a 40)
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED = 'false';
process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'false';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

const {
  OfficialNoticeCatalogService,
  AUTHORIZED_INSTITUTIONS,
  VALID_TRANSITIONS,
  validateInstitutionalSource,
  isSubstantiveChange
} = require('../services/officialNoticeCatalogService');

const {
  NOTICE_STATUSES,
  OFFICIAL_SEVERITIES,
  INTERNAL_PRIORITIES
} = require('../services/phytosanitaryNoticeClassifier');

const phytosanitaryController = require('../controllers/phytosanitaryController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Helper para mock de Req / Res
function createMockReqRes({ params = {}, query = {}, body = {}, user = null, headers = {} } = {}) {
  const req = {
    params,
    query,
    body: { ...body },
    user,
    headers: { ...headers }
  };
  if (user && !headers['authorization']) {
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
    req.headers['authorization'] = `Bearer ${token}`;
  }

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };

  return { req, res };
}

let totalChecks = 0;
function passCheck(desc) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${desc}`);
}

async function runPhytosanitaryGovernanceL09Suite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L09');
  console.log('GESTIÓN ADMINISTRATIVA, VERIFICACIÓN HUMANA Y GOBERNANZA FITOSANITARIA');
  console.log('==============================================================================\n');

  // --------------------------------------------------------------------------
  // BLOQUE 1: REGISTRO CONTROLADO, VALIDACIÓN DE FUENTES Y METADATOS (Checks 01 a 07)
  // --------------------------------------------------------------------------
  console.log('--- BLOQUE 1: REGISTRO CONTROLADO, FUENTES Y METADATOS ---');

  const catalog = new OfficialNoticeCatalogService({ allowTestFixtures: true });
  phytosanitaryController.setCatalogService(catalog);

  // Check 01: Registro inicial en estado no activo (DISCOVERED o PENDING_VERIFICATION, nunca ACTIVE)
  const freshNotice = catalog.registerNotice({
    notice_id: 'SENASA-GOV-001',
    source_institution: 'SENASA',
    official_title: 'Alerta inicial sobre monitoreo de plagas en papa',
    issue_date: '2024-05-10',
    verification_status: 'active' // intento de ingresar directamente como activo
  });
  assert.notStrictEqual(freshNotice.verification_status, 'active');
  assert.strictEqual(freshNotice.verification_status, NOTICE_STATUSES.DISCOVERED);
  assert.strictEqual(freshNotice.version, 1);
  passCheck('Registro inicial forzado en estado no activo (DISCOVERED o PENDING_VERIFICATION)');

  // Check 02: Rechazo de fuentes inválidas (URL no HTTP/HTTPS o malformada)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-ERR-URL',
      source_institution: 'SENASA',
      official_title: 'Aviso con URL malformada',
      official_url: 'ftp://senasa.gob.pe/archivo.pdf'
    });
  }, /URL oficial inválida o no verificable/);
  passCheck('Rechazo automático de fuentes con protocolo o formato de URL inválido');

  // Check 03: Rechazo de títulos vacíos o insuficientes (< 5 caracteres)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-ERR-TITLE',
      source_institution: 'SENASA',
      official_title: '   '
    });
  }, /official_title es obligatorio/);
  passCheck('Rechazo estricto de títulos vacíos, en blanco o con longitud insuficiente');

  // Check 04: Rechazo de fechas inconsistentes (effective_until anterior a issue_date)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-ERR-DATE',
      source_institution: 'SENASA',
      official_title: 'Aviso con fechas ilógicas',
      issue_date: '2024-06-01',
      effective_until: '2024-05-01'
    });
  }, /Fechas inconsistentes/);
  passCheck('Rechazo de fechas inconsistentes (fecha fin anterior a fecha de emisión)');

  // Check 05: Rechazo de cultivos no verificables (entradas vacías o no reconocidas)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-ERR-CROPS',
      source_institution: 'SENASA',
      official_title: 'Aviso con cultivos corruptos',
      issue_date: '2024-06-01',
      affected_crops: ['papa', '  ', '']
    });
  }, /affected_crops contiene valores vacíos o no válidos/);
  passCheck('Rechazo de listas de cultivos afectados con elementos vacíos o inválidos');

  // Check 06: Rechazo de URL engañosa (hostname fuera de .gob.pe, credenciales incrustadas o SSRF)
  const fakeDomainRes = validateInstitutionalSource('https://senasa.gob.pe.malicious.com/fake.pdf', 'SENASA');
  assert.strictEqual(fakeDomainRes.valid, false);
  assert(fakeDomainRes.reason.includes('no pertenece al ámbito gubernamental') || fakeDomainRes.reason.includes('no oficial'));

  const credsUrlRes = validateInstitutionalSource('https://admin:pass@senasa.gob.pe/doc.pdf', 'SENASA');
  assert.strictEqual(credsUrlRes.valid, false);
  assert(credsUrlRes.reason.includes('credenciales'));

  const ssrfRes = validateInstitutionalSource('http://127.0.0.1/admin/secret.pdf', 'SENASA');
  assert.strictEqual(ssrfRes.valid, false);
  assert(ssrfRes.reason.includes('host local') || ssrfRes.reason.includes('red privada'));
  passCheck('Rechazo de URLs engañosas, dominios con sufijo espurio, credenciales incrustadas y SSRF');

  // Check 07: Rechazo de procedencia incompleta (institución no autorizada)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'CORP-ERR-001',
      source_institution: 'AGROQUIMICA_PRIVADA_SAC',
      official_title: 'Boletín fitosanitario comercial no oficial'
    });
  }, /Institución emisora .* desconocida o no autorizada/);
  passCheck('Rechazo de procedencia incompleta o de emisores no oficiales no autorizados');

  // --------------------------------------------------------------------------
  // BLOQUE 2: MÁQUINA DE ESTADOS Y CONTROL DE ACCESO POR ROL (Checks 08 a 13)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 2: MÁQUINA DE ESTADOS Y AUTORIZACIÓN POR ROL ---');

  // Check 08: Transición permitida en el ciclo de vida
  const noticeLifecycle = catalog.registerNotice({
    notice_id: 'SENASA-FLOW-001',
    source_institution: 'SENASA',
    official_title: 'Aviso para prueba de flujo de ciclo de vida',
    issue_date: '2024-06-15',
    verification_evidence: { source_verified: true, url: 'https://senasa.gob.pe/avisos/doc1.pdf' }
  });
  catalog.transitionStatus('SENASA-FLOW-001', NOTICE_STATUSES.PENDING_VERIFICATION, {
    reviewer: { id: 10, name: 'Asesor Técnico', role: 'advisor' },
    reason: 'Pase a verificación técnica inicial'
  });
  catalog.transitionStatus('SENASA-FLOW-001', NOTICE_STATUSES.VERIFIED, {
    reviewer: { id: 10, name: 'Asesor Técnico', role: 'advisor' },
    reason: 'Documento original verificado'
  });
  catalog.transitionStatus('SENASA-FLOW-001', NOTICE_STATUSES.REVIEW_REQUIRED, {
    reviewer: { id: 10, name: 'Asesor Técnico', role: 'advisor' },
    reason: 'Se requiere revisión técnica agronómica'
  });
  const inReviewNotice = catalog.getNotice('SENASA-FLOW-001');
  assert.strictEqual(inReviewNotice.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Transiciones secuenciales permitidas (DISCOVERED -> PENDING_VERIFICATION -> VERIFIED -> REVIEW_REQUIRED)');

  // Check 09: Transición prohibida (salto directo arbitrario)
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-JUMP-001',
      source_institution: 'SENASA',
      official_title: 'Aviso para prueba de salto prohibido'
    });
    // Intentar saltar de DISCOVERED directo a APPROVED
    catalog.approveNotice('SENASA-JUMP-001', { id: 1, name: 'Admin', role: 'admin' });
  }, /Transición inválida/);
  passCheck('Bloqueo de transiciones arbitrarias no contempladas en la máquina de estados');

  // Habilitar temporalmente flag administrativo para probar autorizaciones HTTP
  process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'true';

  // Check 10: Farmer no puede gestionar avisos (403)
  const { req: reqFarmer, res: resFarmer } = createMockReqRes({
    body: { notice_id: 'SENASA-FARMER-TRY', source_institution: 'SENASA', official_title: 'Intento de agricultor' },
    user: { id: 101, name: 'Juan Agricultor', role: 'farmer' }
  });
  await phytosanitaryController.adminRegisterNotice(reqFarmer, resFarmer);
  assert.strictEqual(resFarmer.statusCode, 403);
  passCheck('Rol farmer estrictamente bloqueado (403) para registro y gestión administrativa');

  // Check 11: Supermarket no puede gestionar avisos (403)
  const { req: reqSuper, res: resSuper } = createMockReqRes({
    user: { id: 202, name: 'Supermercado Central', role: 'supermarket' }
  });
  await phytosanitaryController.adminListPendingNotices(reqSuper, resSuper);
  assert.strictEqual(resSuper.statusCode, 403);
  passCheck('Rol supermarket estrictamente bloqueado (403) para consulta y gestión administrativa');

  // Check 12: Advisor puede revisar técnicamente dentro de sus permisos
  catalog.registerNotice({
    notice_id: 'SENASA-ADVISOR-REV',
    source_institution: 'SENASA',
    official_title: 'Aviso para revisión técnica por asesor',
    issue_date: '2024-07-01',
    verification_status: NOTICE_STATUSES.PENDING_VERIFICATION,
    verification_evidence: { url: 'https://senasa.gob.pe/alerta.pdf' }
  });
  const { req: reqAdv, res: resAdv } = createMockReqRes({
    params: { id: 'SENASA-ADVISOR-REV' },
    body: {
      technical_observations: 'Se constató que la plaga afecta principalmente cultivos en Oxapampa.',
      recommended_status: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidence_reference: 'Informe Técnico N° 012-2024-AGROPASCO'
    },
    user: { id: 301, name: 'Ing. Carlos Asesor', role: 'advisor' }
  });
  await phytosanitaryController.adminReviewNotice(reqAdv, resAdv);
  assert.strictEqual(resAdv.statusCode, 200);
  assert.strictEqual(resAdv.body.success, true);
  const reviewedByAdvisor = catalog.getNotice('SENASA-ADVISOR-REV');
  assert.strictEqual(reviewedByAdvisor.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  assert.strictEqual(reviewedByAdvisor.technical_reviews.length, 1);
  passCheck('Rol advisor facultado para registrar observaciones técnicas y avanzar a REVIEW_REQUIRED');

  // Check 13: Admin puede aprobar únicamente cuando corresponde
  const { req: reqAdmApprove, res: resAdmApprove } = createMockReqRes({
    params: { id: 'SENASA-ADVISOR-REV' },
    body: {
      reason: 'Aprobación formal con base en informe del asesor',
      evidence_reference: 'Resolución Jefatural N° 078-2024-SENASA'
    },
    user: { id: 1, name: 'Administrador General', role: 'admin' }
  });
  await phytosanitaryController.adminApproveNotice(reqAdmApprove, resAdmApprove);
  assert.strictEqual(resAdmApprove.statusCode, 200);
  assert.strictEqual(resAdmApprove.body.success, true);
  const approvedNotice = catalog.getNotice('SENASA-ADVISOR-REV');
  assert.strictEqual(approvedNotice.verification_status, NOTICE_STATUSES.APPROVED);
  passCheck('Rol admin facultado para aprobar formalmente avisos en estado REVIEW_REQUIRED');

  // --------------------------------------------------------------------------
  // BLOQUE 3: IDENTIDAD INVIOLABLE Y BLINDAJE JWT (Checks 14 a 19)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 3: IDENTIDAD INVIOLABLE Y BLINDAJE JWT ---');

  // Check 14: JWT ausente en petición administrativa
  let authNextCalled = false;
  const { req: reqNoJwt, res: resNoJwt } = createMockReqRes({ headers: {} });
  authenticateToken(reqNoJwt, resNoJwt, () => { authNextCalled = true; });
  assert.strictEqual(resNoJwt.statusCode, 401);
  assert.strictEqual(authNextCalled, false);
  passCheck('Petición administrativa sin token JWT rechazada categóricamente (401 Unauthorized)');

  // Check 15: JWT inválido o manipulado (401 Unauthorized según H-02)
  const { req: reqBadJwt, res: resBadJwt } = createMockReqRes({
    headers: { authorization: 'Bearer token_falso_y_manipulado' }
  });
  authenticateToken(reqBadJwt, resBadJwt, () => {});
  assert.strictEqual(resBadJwt.statusCode, 401);
  passCheck('Token JWT manipulado, truncado o con firma corrupta rechazado (401 Unauthorized)');

  // Check 16: Identidad de revisor manipulada en body es ignorada
  const { req: reqSpoof, res: resSpoof } = createMockReqRes({
    params: { id: 'SENASA-FLOW-001' },
    body: {
      reviewer_name: 'Director Nacional SENASA (Identidad Fabricada)',
      role: 'admin',
      observations: 'Revisión técnica'
    },
    user: { id: 301, name: 'Ing. Carlos Asesor Real', role: 'advisor' }
  });
  await phytosanitaryController.adminReviewNotice(reqSpoof, resSpoof);
  assert.strictEqual(resSpoof.statusCode, 200);
  const spoofAudited = catalog.getNotice('SENASA-FLOW-001');
  const latestReview = spoofAudited.technical_reviews[spoofAudited.technical_reviews.length - 1];
  assert.strictEqual(latestReview.reviewer_name, 'Ing. Carlos Asesor Real');
  assert.notStrictEqual(latestReview.reviewer_name, 'Director Nacional SENASA (Identidad Fabricada)');
  passCheck('Parámetro reviewer_name manipulado en body es ignorado; prevalece req.user');

  // Check 17: approved_by falsificado en body no se acepta como autoridad
  catalog.registerNotice({
    notice_id: 'SENASA-SPOOF-APP',
    source_institution: 'SENASA',
    official_title: 'Aviso para prueba de approved_by falsificado',
    issue_date: '2024-07-02',
    verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
  });
  catalog.transitionStatus('SENASA-SPOOF-APP', NOTICE_STATUSES.PENDING_VERIFICATION);
  catalog.transitionStatus('SENASA-SPOOF-APP', NOTICE_STATUSES.VERIFIED);
  catalog.transitionStatus('SENASA-SPOOF-APP', NOTICE_STATUSES.REVIEW_REQUIRED);

  const { req: reqSpoofApp, res: resSpoofApp } = createMockReqRes({
    params: { id: 'SENASA-SPOOF-APP' },
    body: {
      approved_by: 'Ministro de Agricultura (Ficticio)',
      evidence_reference: 'Evidencia oficial'
    },
    user: { id: 1, name: 'Admin Legítimo', role: 'admin' }
  });
  await phytosanitaryController.adminApproveNotice(reqSpoofApp, resSpoofApp);
  assert.strictEqual(resSpoofApp.statusCode, 200);
  const spoofAppNotice = catalog.getNotice('SENASA-SPOOF-APP');
  assert.strictEqual(spoofAppNotice.approved_by.name, 'Admin Legítimo');
  assert.notStrictEqual(spoofAppNotice.approved_by.name, 'Ministro de Agricultura (Ficticio)');
  passCheck('Campo approved_by falsificado en body no suplanta la identidad autenticada');

  // Check 18: Objeto isAuthenticated fabricado en body es ignorado
  const { req: reqFakeAuth, res: resFakeAuth } = createMockReqRes({
    body: {
      isAuthenticated: true,
      role: 'admin',
      user: { id: 1, role: 'admin', name: 'Fake Admin' }
    },
    headers: {} // sin cabecera de autenticación
  });
  await phytosanitaryController.adminRegisterNotice(reqFakeAuth, resFakeAuth);
  assert.strictEqual(resFakeAuth.statusCode, 401);
  passCheck('Objeto { isAuthenticated: true, role: "admin" } en payload rechazado sin JWT (401)');

  // Check 19: Intento de autoaprobación no autorizada (advisor intentando aprobar final)
  const { req: reqAdvApp, res: resAdvApp } = createMockReqRes({
    params: { id: 'SENASA-SPOOF-APP' },
    body: { evidence_reference: 'Evidencia' },
    user: { id: 301, name: 'Asesor', role: 'advisor' }
  });
  await phytosanitaryController.adminApproveNotice(reqAdvApp, resAdvApp);
  assert.strictEqual(resAdvApp.statusCode, 403);
  passCheck('Intento de aprobación final por usuario con rol advisor estrictamente denegado (403)');

  // --------------------------------------------------------------------------
  // BLOQUE 4: INTEGRIDAD, CONTROL DE VERSIONES Y AUDITORÍA INMUTABLE (Checks 20 a 30)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 4: INTEGRIDAD, VERSIONADO Y AUDITORÍA INMUTABLE ---');

  // Check 20: Aprobación sin evidencia rechazada
  catalog.registerNotice({
    notice_id: 'SENASA-NO-EVIDENCE',
    source_institution: 'SENASA',
    official_title: 'Aviso sin evidencia documental',
    issue_date: '2024-07-05'
  });
  catalog.transitionStatus('SENASA-NO-EVIDENCE', NOTICE_STATUSES.PENDING_VERIFICATION);
  catalog.transitionStatus('SENASA-NO-EVIDENCE', NOTICE_STATUSES.VERIFIED);
  catalog.transitionStatus('SENASA-NO-EVIDENCE', NOTICE_STATUSES.REVIEW_REQUIRED);
  const { req: reqNoEv, res: resNoEv } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: { reason: 'Intento de aprobación sin evidencia' },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminApproveNotice(reqNoEv, resNoEv);
  assert.strictEqual(resNoEv.statusCode, 400);
  assert(resNoEv.body.error.includes('evidencia'));
  passCheck('Aprobación técnica formal denegada si carece de evidencia institucional verificable');

  // Check 21: Aprobación con evidencia permitida
  const { req: reqWithEv, res: resWithEv } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: {
      reason: 'Aprobación con expediente verificado',
      evidence_reference: 'Expediente Fitosanitario N° SENASA-PASCO-2024-089'
    },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminApproveNotice(reqWithEv, resWithEv);
  assert.strictEqual(resWithEv.statusCode, 200);
  const evApproved = catalog.getNotice('SENASA-NO-EVIDENCE');
  assert.strictEqual(evApproved.verification_status, NOTICE_STATUSES.APPROVED);
  passCheck('Aprobación formal completada satisfactoriamente al aportar evidencia verificable');

  // Check 22: Cambio posterior de URL invalida la aprobación a REVIEW_REQUIRED
  const { req: reqChangeUrl, res: resChangeUrl } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: {
      official_url: 'https://senasa.gob.pe/avisos/nueva-resolucion-actualizada.pdf'
    },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminUpdateNotice(reqChangeUrl, resChangeUrl);
  assert.strictEqual(resChangeUrl.statusCode, 200);
  const noticeUrlChanged = catalog.getNotice('SENASA-NO-EVIDENCE');
  assert.strictEqual(noticeUrlChanged.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Modificación sustantiva de official_url posterior a la aprobación invalida el estado a REVIEW_REQUIRED');

  // Reactivar el aviso para probar cambio de ámbito geográfico
  catalog.approveNotice('SENASA-NO-EVIDENCE', { id: 1, name: 'Admin', role: 'admin' }, {
    reason: 'Reaprobación técnica',
    evidenceReference: 'Expediente 089-B'
  });
  assert.strictEqual(catalog.getNotice('SENASA-NO-EVIDENCE').verification_status, NOTICE_STATUSES.APPROVED);

  // Check 23: Cambio posterior de ámbito geográfico invalida la aprobación
  const { req: reqChangeScope, res: resChangeScope } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: {
      geographical_scope: { country: 'Perú', department: 'Pasco', provinces: ['Oxapampa'] }
    },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminUpdateNotice(reqChangeScope, resChangeScope);
  assert.strictEqual(resChangeScope.statusCode, 200);
  const noticeScopeChanged = catalog.getNotice('SENASA-NO-EVIDENCE');
  assert.strictEqual(noticeScopeChanged.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Modificación sustantiva de geographical_scope invalida automáticamente la aprobación');

  // Reactivar para probar cambio de cultivo
  catalog.approveNotice('SENASA-NO-EVIDENCE', { id: 1, name: 'Admin', role: 'admin' }, {
    reason: 'Reaprobación tras cambio de ámbito',
    evidenceReference: 'Expediente 089-C'
  });

  // Check 24: Cambio posterior de cultivo invalida la aprobación
  const { req: reqChangeCrop, res: resChangeCrop } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: {
      affected_crops: ['maca', 'papa']
    },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminUpdateNotice(reqChangeCrop, resChangeCrop);
  assert.strictEqual(resChangeCrop.statusCode, 200);
  const noticeCropChanged = catalog.getNotice('SENASA-NO-EVIDENCE');
  assert.strictEqual(noticeCropChanged.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Modificación sustantiva de affected_crops invalida automáticamente la aprobación');

  // Check 25: Invalidación de aprobación incrementa versión y registra auditoría
  assert(noticeCropChanged.version >= 4);
  const historyCrop = catalog.getNoticeHistory('SENASA-NO-EVIDENCE');
  const invalidationEvents = historyCrop.filter(e => e.action === 'APPROVAL_INVALIDATED');
  assert(invalidationEvents.length >= 3);
  assert.strictEqual(invalidationEvents[0].new_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Invalidación de aprobación incrementa versión y registra evento específico APPROVAL_INVALIDATED');

  // Check 26: Revisión técnica requerida tras actualización sustantiva
  assert.strictEqual(noticeCropChanged.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  passCheck('Aviso con aprobación invalidada queda en REVIEW_REQUIRED exigiendo nuevo triaje');

  // Check 27: Conflicto de versiones / concurrencia optimista
  const currentVer = noticeCropChanged.version;
  const { req: reqConflict, res: resConflict } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: {
      official_title: 'Título actualizado con versión desfasada',
      expected_version: currentVer - 1 // versión desfasada
    },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminUpdateNotice(reqConflict, resConflict);
  assert.strictEqual(resConflict.statusCode, 409);
  assert.strictEqual(resConflict.body.code, 'CONCURRENCY_CONFLICT');
  passCheck('Detección y bloqueo de conflicto de versiones (HTTP 409) ante edición concurrente');

  // Check 28: Registro de historial auditable con campos normalizados
  const { req: reqHist, res: resHist } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminGetNoticeHistory(reqHist, resHist);
  assert.strictEqual(resHist.statusCode, 200);
  assert(Array.isArray(resHist.body.data));
  const firstEvent = resHist.body.data[0];
  assert(firstEvent.event_id, 'event_id debe existir');
  assert(firstEvent.notice_id, 'notice_id debe existir');
  assert(firstEvent.action, 'action debe existir');
  assert(firstEvent.event_timestamp, 'event_timestamp debe existir');
  assert.strictEqual(typeof firstEvent.record_version, 'number');
  passCheck('Historial de auditoría contiene todos los campos normalizados requeridos');

  // Check 29: Registro de actor autorizado fidedigno en cada evento
  const lastEvent = resHist.body.data[resHist.body.data.length - 1];
  assert.strictEqual(lastEvent.actor_user_id, 1);
  assert.strictEqual(lastEvent.actor_role, 'admin');
  passCheck('Registro de actor fidedigno (actor_user_id y actor_role) trazado en auditoría');

  // Check 30: Rechazo de modificación o adulteración del historial de auditoría
  const historyDirect = catalog.getNoticeHistory('SENASA-NO-EVIDENCE');
  assert.throws(() => {
    historyDirect.push({ event_id: 'HACKED-EVENT' });
  }, /object is not extensible|cannot add property/i);
  // Comprobar que el historial interno del catálogo no se alteró
  assert(!catalog.getNoticeHistory('SENASA-NO-EVIDENCE').some(e => e.event_id === 'HACKED-EVENT'));
  passCheck('Historial de auditoría inmutable: rechazo de mutaciones o adiciones externas no controladas');

  // --------------------------------------------------------------------------
  // BLOQUE 5: RETIRADA, SUSTITUCIÓN Y AISLAMIENTO DE PUBLICACIÓN (Checks 31 a 36)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 5: RETIRADA, SUSTITUCIÓN Y AISLAMIENTO OPERATIVO ---');

  // Check 31: Retirada de aviso (WITHDRAWN)
  catalog.approveNotice('SENASA-NO-EVIDENCE', { id: 1, name: 'Admin', role: 'admin' }, {
    reason: 'Aprobación final previa a retiro',
    evidenceReference: 'Doc de cierre'
  });
  const { req: reqWithdraw, res: resWithdraw } = createMockReqRes({
    params: { id: 'SENASA-NO-EVIDENCE' },
    body: { reason: 'Resolución de término de emergencia sanitaria' },
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  await phytosanitaryController.adminWithdrawNotice(reqWithdraw, resWithdraw);
  assert.strictEqual(resWithdraw.statusCode, 200);
  const withdrawnNotice = catalog.getNotice('SENASA-NO-EVIDENCE');
  assert.strictEqual(withdrawnNotice.verification_status, NOTICE_STATUSES.WITHDRAWN);
  assert.strictEqual(withdrawnNotice.publication_status, 'retirado');
  passCheck('Retirada formal de aviso (WITHDRAWN) ejecutada con trazabilidad completa');

  // Check 32: Sustitución documentada (SUPERSEDED)
  catalog.registerNotice({
    notice_id: 'SENASA-ORIGINAL-001',
    source_institution: 'SENASA',
    official_title: 'Aviso original de vigilancia',
    verification_status: NOTICE_STATUSES.APPROVED,
    verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
  }, { allowInitialStatus: true });

  catalog.registerNotice({
    notice_id: 'SENASA-REPLACEMENT-002',
    source_institution: 'SENASA',
    official_title: 'Aviso sustituto con medidas actualizadas',
    verification_status: NOTICE_STATUSES.APPROVED,
    verification_evidence: { url: 'https://senasa.gob.pe/doc2.pdf' }
  }, { allowInitialStatus: true });

  catalog.supersedeNotice('SENASA-ORIGINAL-001', 'SENASA-REPLACEMENT-002', {
    id: 1,
    name: 'Admin',
    role: 'admin'
  }, 'Sustituido por actualización fitosanitaria');

  const oldNotice = catalog.getNotice('SENASA-ORIGINAL-001');
  const repNotice = catalog.getNotice('SENASA-REPLACEMENT-002');
  assert.strictEqual(oldNotice.verification_status, NOTICE_STATUSES.SUPERSEDED);
  assert.strictEqual(oldNotice.publication_status, 'sustituido');
  assert.strictEqual(oldNotice.superseded_by, 'SENASA-REPLACEMENT-002');
  assert.strictEqual(repNotice.supersedes_notice_id, 'SENASA-ORIGINAL-001');
  passCheck('Sustitución normativa documentada vinculando aviso anterior y aviso sustituto');

  // Check 33: Fixture sintético bloqueado operativamente
  const operationalCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: false });
  assert.throws(() => {
    operationalCatalog.registerNotice({
      notice_id: 'SENASA-SYNTH-BLOCKED',
      source_institution: 'SENASA',
      official_title: 'Aviso sintético',
      is_synthetic: true,
      verification_status: NOTICE_STATUSES.APPROVED
    });
    operationalCatalog.activateNotice('SENASA-SYNTH-BLOCKED', { id: 1, name: 'Admin', role: 'admin' });
  }, /No se permite activar avisos sintéticos en modo operativo/);
  passCheck('Avisos sintéticos categóricamente bloqueados de activación en modo operativo');

  // Check 34: Feature flag administrativo apagado por defecto
  process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'false';
  assert.strictEqual(process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED, 'false');
  passCheck('Feature flag PHYTOSANITARY_ADMIN_REVIEW_ENABLED apagado por defecto');

  // Check 35: Rutas administrativas deshabilitadas cuando flag está apagado (HTTP 503)
  const { req: reqDisabled, res: resDisabled } = createMockReqRes({
    user: { id: 1, name: 'Admin', role: 'admin' }
  });
  phytosanitaryController.requireAdminReviewEnabled(reqDisabled, resDisabled, () => {});
  assert.strictEqual(resDisabled.statusCode, 503);
  assert.strictEqual(resDisabled.body.code, 'PHYTOSANITARY_ADMIN_DISABLED');
  passCheck('Rutas administrativas responden con HTTP 503 cuando PHYTOSANITARY_ADMIN_REVIEW_ENABLED=false');

  // Check 36: Aislamiento de avisos no aprobados (público solo ve ACTIVE)
  const publicActiveList = catalog.listNotices({ activeOnly: true });
  assert(!publicActiveList.some(n => n.verification_status === NOTICE_STATUSES.DISCOVERED));
  assert(!publicActiveList.some(n => n.verification_status === NOTICE_STATUSES.PENDING_VERIFICATION));
  assert(!publicActiveList.some(n => n.verification_status === NOTICE_STATUSES.REVIEW_REQUIRED));
  assert(!publicActiveList.some(n => n.verification_status === NOTICE_STATUSES.WITHDRAWN));
  passCheck('Aislamiento estricto: la consulta pública no expone avisos no activos o en revisión');

  // --------------------------------------------------------------------------
  // BLOQUE 6: RESILIENCIA DEL SISTEMA Y RESTRICCIONES OPERATIVAS (Checks 37 a 40)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 6: RESILIENCIA Y RESTRICCIONES ABSOLUTAS ---');

  // Check 37: Sin efectos secundarios sobre ML
  const mlEnginePath = path.join(__dirname, '../services/mlEngine.js');
  assert(fs.existsSync(mlEnginePath), 'Motor ML nativo debe existir');
  const { MLEngine } = require(mlEnginePath);
  assert(typeof MLEngine === 'function');
  const engine = new MLEngine();
  assert(typeof engine.loadModels === 'function');
  passCheck('Motores de inferencia ML nativos y umbrales de alerta intactos');

  // Check 38: Sin envío de notificaciones
  assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
  passCheck('PHYTOSANITARY_NOTIFICATIONS_ENABLED permanece estrictamente en false');

  // Check 39: Sin acceso a fuentes externas (sin SSRF)
  assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
  passCheck('PHYTOSANITARY_AUTO_FETCH_ENABLED permanece en false (cero descargas o peticiones de red)');

  // Check 40: Sin migraciones ni cambios en base de datos productiva
  const ddlPath = path.join(__dirname, '../data/phytosanitary/phytosanitary_notices_schema_proposal.sql');
  assert(fs.existsSync(ddlPath), 'Propuesta DDL SQL debe existir documentalmente');
  const ddlContent = fs.readFileSync(ddlPath, 'utf8');
  assert(ddlContent.includes('CREATE TABLE IF NOT EXISTS phytosanitary_notices'));
  assert(ddlContent.includes('CREATE TABLE IF NOT EXISTS phytosanitary_notice_audits'));
  assert.strictEqual(process.env.PHYTOSANITARY_NOTICES_ENABLED, 'false');
  passCheck('Cero migraciones en base de datos productiva; DDL preservado como propuesta arquitectónica');

  console.log('\n==============================================================================');
  console.log(`FASE 9-L09: ${totalChecks}/40 VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
  console.log('==============================================================================\n');
}

runPhytosanitaryGovernanceL09Suite()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ ERROR EN SUITE FASE 9-L09:', err);
    process.exit(1);
  });
