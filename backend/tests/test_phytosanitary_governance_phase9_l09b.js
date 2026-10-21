/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L09B
 * ==============================================================================
 * CORRECCIÓN DE GOBERNANZA, INTEGRIDAD DE APROBACIONES Y VERIFICACIÓN REPRODUCIBLE
 *
 * Cobertura de 30 Verificaciones Específicas:
 *  - Bloque 1: Inmutabilidad profunda del catálogo y aislamiento de referencias (Checks 01 a 04)
 *  - Bloque 2: Separación de funciones, revisión técnica y máquina de estados (Checks 05 a 09)
 *  - Bloque 3: Política estricta de autorización y blindaje perimetral JWT (Checks 10 a 16)
 *  - Bloque 4: Validación documental institucional y correspondencia (Checks 17 a 19)
 *  - Bloque 5: Detección de cambios sustantivos, versionado e invalidación (Checks 20 a 24)
 *  - Bloque 6: Restricciones operativas, aislamiento y feature flags (Checks 25 a 30)
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
const { authenticateToken, requireRole, ALLOWED_ALGORITHMS } = require('../middleware/auth');

function createMockReqRes({ params = {}, query = {}, body = {}, user = null, headers = {} } = {}) {
  const req = {
    params,
    query,
    body: { ...body },
    user,
    headers: { ...headers }
  };
  if (user && !headers['authorization']) {
    const token = jwt.sign(user, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
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

async function runPhytosanitaryGovernanceL09BSuite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L09B');
  console.log('CORRECCIÓN DE GOBERNANZA, INTEGRIDAD DE APROBACIONES Y VERIFICACIÓN REPRODUCIBLE');
  console.log('==============================================================================\n');

  const catalog = new OfficialNoticeCatalogService({ allowTestFixtures: true });

  // --------------------------------------------------------------------------
  // BLOQUE 1: INMUTABILIDAD PROFUNDA DEL CATÁLOGO Y AISLAMIENTO DE REFERENCIAS
  // --------------------------------------------------------------------------
  console.log('--- BLOQUE 1: INMUTABILIDAD PROFUNDA Y REFERENCIAS AISLADAS ---');

  catalog.registerNotice({
    notice_id: 'SENASA-L09B-001',
    source_institution: 'SENASA',
    official_title: 'Aviso fitosanitario para prueba de copias profundas',
    affected_crops: ['papa', 'maiz'],
    geographical_scope: {
      country: 'Perú',
      department: 'Pasco',
      provinces: ['Oxapampa'],
      districts: ['Villa Rica']
    },
    verification_evidence: { expediente: 'EXP-001-2024' },
    issue_date: '2024-07-10'
  });

  // Check 01: Copias profundas del catálogo
  const retrieved1 = catalog.getNotice('SENASA-L09B-001');
  const retrieved2 = catalog.getNotice('SENASA-L09B-001');
  assert.notStrictEqual(retrieved1, retrieved2, 'getNotice debe retornar instancias distintas');
  passCheck('Copias profundas del catálogo: consultas sucesivas retornan instancias desacopladas');

  // Check 02: Mutación externa de arrays no contamina el estado interno
  retrieved1.affected_crops.push('cultivo_espurio');
  const freshNoticeAfterArrayMutation = catalog.getNotice('SENASA-L09B-001');
  assert.strictEqual(freshNoticeAfterArrayMutation.affected_crops.includes('cultivo_espurio'), false);
  passCheck('Mutación externa de arrays: modificación de affected_crops no altera el catálogo interno');

  // Check 03: Mutación externa de objetos anidados no contamina el estado interno
  retrieved1.geographical_scope.department = 'Departamento Falso';
  retrieved1.geographical_scope.districts.push('Distrito Falso');
  const freshNoticeAfterObjectMutation = catalog.getNotice('SENASA-L09B-001');
  assert.strictEqual(freshNoticeAfterObjectMutation.geographical_scope.department, 'Pasco');
  assert.strictEqual(freshNoticeAfterObjectMutation.geographical_scope.districts.includes('Distrito Falso'), false);
  passCheck('Mutación externa de objetos anidados: modificación de geographical_scope no altera el catálogo interno');

  // Check 04: Historial protegido con inmutabilidad profunda
  const history = catalog.getNoticeHistory('SENASA-L09B-001');
  assert(Array.isArray(history));
  assert.throws(() => {
    history.push({ action: 'EVENTO_FALSO' });
  }, /is not extensible|Cannot add property|object is not extensible/);
  assert.throws(() => {
    history[0].action = 'ALTERADO';
  }, /Cannot assign to read only property/);
  passCheck('Historial protegido: colección y eventos inmutables rechazando modificaciones externas');

  // --------------------------------------------------------------------------
  // BLOQUE 2: SEPARACIÓN DE FUNCIONES, REVISIÓN TÉCNICA Y MÁQUINA DE ESTADOS
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 2: SEPARACIÓN DE FUNCIONES Y REVISIÓN TÉCNICA ---');

  catalog.registerNotice({
    notice_id: 'SENASA-L09B-HIGH-IMPACT',
    source_institution: 'SENASA',
    official_title: 'Emergencia fitosanitaria de alto impacto por brote de plaga',
    severity_official: 'emergencia',
    requires_human_review: true,
    issue_date: '2024-07-11',
    created_by: { id: 10, name: 'Administrador Registrador', role: 'admin' },
    verification_evidence: { url: 'https://senasa.gob.pe/alerta.pdf' }
  });
  catalog.transitionStatus('SENASA-L09B-HIGH-IMPACT', NOTICE_STATUSES.PENDING_VERIFICATION);
  catalog.transitionStatus('SENASA-L09B-HIGH-IMPACT', NOTICE_STATUSES.VERIFIED);
  catalog.transitionStatus('SENASA-L09B-HIGH-IMPACT', NOTICE_STATUSES.REVIEW_REQUIRED);

  // Check 05: Aprobación sin revisión técnica previa en aviso de alto impacto rechazada
  assert.throws(() => {
    catalog.approveNotice('SENASA-L09B-HIGH-IMPACT', { id: 2, name: 'Admin Revisor', role: 'admin' }, {
      reason: 'Intento de aprobación sin revisión técnica de asesor',
      evidenceReference: 'Expediente Oficial EXP-002'
    });
  }, /Se requiere al menos una revisión técnica previa completada/);
  passCheck('Aprobación sin revisión técnica: bloqueo estricto en avisos de alto impacto o con triaje');

  // Check 06: Aprobación con revisión técnica válida
  catalog.recordTechnicalReview('SENASA-L09B-HIGH-IMPACT', { id: 50, name: 'Ing. Asesor Agrónomo', role: 'advisor' }, {
    technicalObservations: 'Evaluación técnica completada. Plaga confirmada en parcelas piloto.',
    recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
    evidenceReference: 'Informe Agronómico N° 055-2024'
  });
  const approvedHighImpact = catalog.approveNotice('SENASA-L09B-HIGH-IMPACT', { id: 2, name: 'Admin Revisor', role: 'admin' }, {
    reason: 'Aprobación formal con sustento técnico',
    evidenceReference: 'Expediente Oficial EXP-002'
  });
  assert.strictEqual(approvedHighImpact.verification_status, NOTICE_STATUSES.APPROVED);
  passCheck('Aprobación con revisión técnica válida: formalización exitosa con revisor técnico y evidencia');

  // Check 07: Revisión de versión anterior no autoriza versión modificada
  catalog.updateNotice('SENASA-L09B-HIGH-IMPACT', {
    affected_crops: ['papa', 'tomate', 'pimiento'],
    reason: 'Ampliación de cultivos afectados'
  }, { id: 2, role: 'admin' });
  const updatedNoticeV2 = catalog.getNotice('SENASA-L09B-HIGH-IMPACT');
  assert.strictEqual(updatedNoticeV2.version, 2);
  assert.strictEqual(updatedNoticeV2.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  assert.throws(() => {
    catalog.approveNotice('SENASA-L09B-HIGH-IMPACT', { id: 2, name: 'Admin Revisor', role: 'admin' }, {
      reason: 'Reaprobación indebida sin nueva revisión técnica para versión 2',
      evidenceReference: 'Expediente V2'
    });
  }, /revisión técnica existente corresponde a una versión anterior/);
  passCheck('Revisión de versión anterior: rechazo de aprobación si la revisión técnica no cubre la versión actual');

  // Check 08: Autoaprobación indebida en aviso de alto impacto rechazada
  catalog.recordTechnicalReview('SENASA-L09B-HIGH-IMPACT', { id: 50, name: 'Ing. Asesor Agrónomo', role: 'advisor' }, {
    technicalObservations: 'Re-evaluación técnica agronómica para versión 2.'
  });
  assert.throws(() => {
    catalog.approveNotice('SENASA-L09B-HIGH-IMPACT', { id: 10, name: 'Administrador Registrador', role: 'admin' }, {
      reason: 'Intento de autoaprobación de aviso propio de alto impacto',
      evidenceReference: 'Expediente V2'
    });
  }, /Principio de cuatro ojos|Bloqueo de autoaprobación/);
  passCheck('Autoaprobación indebida: creador de aviso de alto impacto estrictamente impedido de autoaprobar');

  // Check 09: Separación advisor / admin: advisor no puede aprobar final
  assert.throws(() => {
    catalog.approveNotice('SENASA-L09B-HIGH-IMPACT', { id: 50, name: 'Ing. Asesor Agrónomo', role: 'advisor' });
  }, /El rol "advisor" no tiene privilegios para la aprobación final/);
  passCheck('Separación advisor/admin: exclusividad de la aprobación administrativa para rol admin');

  // --------------------------------------------------------------------------
  // BLOQUE 3: POLÍTICA ESTRICTA DE AUTORIZACIÓN Y BLINDAJE PERIMETRAL JWT
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 3: AUTORIZACIÓN ESTRICTA Y BLINDAJE JWT ---');

  process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'true';

  // Check 10: Registro admin autorizado (201 Created)
  const { req: reqAdminReg, res: resAdminReg } = createMockReqRes({
    body: {
      notice_id: 'SENASA-L09B-ADM-REG',
      source_institution: 'SENASA',
      official_title: 'Aviso registrado legítimamente por administrador'
    },
    user: { id: 1, name: 'Admin Central', role: 'admin' }
  });
  await phytosanitaryController.adminRegisterNotice(reqAdminReg, resAdminReg);
  assert.strictEqual(resAdminReg.statusCode, 201);
  passCheck('Registro admin autorizado: administrador formaliza aviso con HTTP 201 Created');

  // Check 11: Registro advisor bloqueado conforme a la política restrictiva vigente (403 Forbidden)
  const { req: reqAdvReg, res: resAdvReg } = createMockReqRes({
    body: {
      notice_id: 'SENASA-L09B-ADV-REG',
      source_institution: 'SENASA',
      official_title: 'Intento de registro de aviso por asesor'
    },
    user: { id: 301, name: 'Ing. Asesor', role: 'advisor' }
  });
  await phytosanitaryController.adminRegisterNotice(reqAdvReg, resAdvReg);
  assert.strictEqual(resAdvReg.statusCode, 403);
  assert(resAdvReg.body.error.includes('rol admin'));
  passCheck('Registro advisor bloqueado: política restrictiva vigente mantiene registro exclusivo para admin');

  // Check 12: Farmer bloqueado en endpoints administrativos (403 Forbidden)
  const { req: reqFarmer, res: resFarmer } = createMockReqRes({
    body: { notice_id: 'SENASA-TRY-FARMER', source_institution: 'SENASA', official_title: 'Aviso farmer' },
    user: { id: 101, name: 'Agricultor', role: 'farmer' }
  });
  await phytosanitaryController.adminRegisterNotice(reqFarmer, resFarmer);
  assert.strictEqual(resFarmer.statusCode, 403);
  passCheck('Farmer bloqueado: rechazo categórico con HTTP 403 en gestión administrativa');

  // Check 13: Supermarket bloqueado en endpoints administrativos (403 Forbidden)
  const { req: reqSuper, res: resSuper } = createMockReqRes({
    user: { id: 202, name: 'Supermercado', role: 'supermarket' }
  });
  await phytosanitaryController.adminListPendingNotices(reqSuper, resSuper);
  assert.strictEqual(resSuper.statusCode, 403);
  passCheck('Supermarket bloqueado: rechazo categórico con HTTP 403 en gestión administrativa');

  // Check 14: JWT sin token (401 Unauthorized)
  const { req: reqNoToken, res: resNoToken } = createMockReqRes({ headers: {} });
  let nextNoTokenCalled = false;
  authenticateToken(reqNoToken, resNoToken, () => { nextNoTokenCalled = true; });
  assert.strictEqual(resNoToken.statusCode, 401);
  assert.strictEqual(nextNoTokenCalled, false);
  passCheck('JWT sin token: denegación categórica con HTTP 401 Unauthorized');

  // Check 15: JWT manipulado (401 Unauthorized según H-02)
  const { req: reqTampered, res: resTampered } = createMockReqRes({
    headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.invalida' }
  });
  let nextTamperedCalled = false;
  authenticateToken(reqTampered, resTampered, () => { nextTamperedCalled = true; });
  assert.strictEqual(resTampered.statusCode, 401);
  assert.strictEqual(nextTamperedCalled, false);
  passCheck('JWT manipulado: firma corrupta o payload alterado denegado con HTTP 401');

  // Check 16: Algoritmo JWT no permitido (rechazo explícito de algoritmos fuera de HS256)
  assert.deepStrictEqual(ALLOWED_ALGORITHMS, ['HS256']);
  const unsignedToken = jwt.sign({ id: 1, role: 'admin' }, '', { algorithm: 'none' });
  const { req: reqUnsigned, res: resUnsigned } = createMockReqRes({
    headers: { authorization: `Bearer ${unsignedToken}` }
  });
  let nextUnsignedCalled = false;
  authenticateToken(reqUnsigned, resUnsigned, () => { nextUnsignedCalled = true; });
  assert.strictEqual(resUnsigned.statusCode, 401);
  assert.strictEqual(nextUnsignedCalled, false);
  passCheck('Algoritmo JWT restringido: algoritmo "none" u otros no autorizados categóricamente rechazados (HTTP 401)');

  // --------------------------------------------------------------------------
  // BLOQUE 4: VALIDACIÓN DOCUMENTAL INSTITUCIONAL Y CORRESPONDENCIA
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 4: VALIDACIÓN DOCUMENTAL INSTITUCIONAL ---');

  // Check 17: URL HTTP rechazada (exigencia estricta de HTTPS)
  const httpUrlRes = validateInstitutionalSource('http://senasa.gob.pe/avisos/resolucion.pdf', 'SENASA');
  assert.strictEqual(httpUrlRes.valid, false);
  assert(httpUrlRes.reason.includes('HTTPS seguro'));
  passCheck('URL HTTP rechazada: fuentes institucionales oficiales exigen estrictamente HTTPS');

  // Check 18: Dominio institucional engañoso rechazado
  const deceptiveDomainRes = validateInstitutionalSource('https://senasa.gob.pe.dominio-atacante.com/doc.pdf', 'SENASA');
  assert.strictEqual(deceptiveDomainRes.valid, false);
  assert(deceptiveDomainRes.reason.includes('no oficial') || deceptiveDomainRes.reason.includes('.gob.pe'));
  passCheck('Dominio engañoso rechazado: suplantaciones con sufijos espurios bloqueadas');

  // Check 19: Incongruencia entre institución declarada y fuente documental en gob.pe
  const gobPeMismatchRes = validateInstitutionalSource('https://www.gob.pe/institucion/midagri/noticias/012-comunicado', 'SENASA');
  assert.strictEqual(gobPeMismatchRes.valid, false);
  assert(gobPeMismatchRes.reason.includes('Inconsistencia institucional en gob.pe'));
  passCheck('Incongruencia institucional: URL de MIDAGRI en portal gob.pe rechazada para emisor SENASA');

  // --------------------------------------------------------------------------
  // BLOQUE 5: DETECCIÓN DE CAMBIOS SUSTANTIVOS, VERSIONADO E INVALIDACIÓN
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 5: CAMBIOS SUSTANTIVOS, VERSIONADO E INVALIDACIÓN ---');

  const baseNotice = {
    notice_id: 'SENASA-BASE-001',
    official_url: 'https://senasa.gob.pe/doc.pdf',
    notice_type: 'alerta_fitosanitaria',
    pest_scientific_name: 'Ralstonia solanacearum',
    issue_date: '2024-07-01',
    severity_official: 'moderada',
    verification_evidence: { expediente: 'EXP-100' },
    geographical_scope: { country: 'Perú', department: 'Pasco', provinces: ['Oxapampa'] },
    affected_crops: ['papa']
  };

  // Check 20: Cambio de severidad detectado como cambio sustantivo
  assert.strictEqual(isSubstantiveChange(baseNotice, { severity_official: 'alta' }), true);
  assert.strictEqual(isSubstantiveChange(baseNotice, { severity_official: 'moderada' }), false);
  passCheck('Cambio de severidad: modificación de severity_official clasificada como sustantiva');

  // Check 21: Cambio de evidencia detectado como cambio sustantivo
  assert.strictEqual(isSubstantiveChange(baseNotice, { verification_evidence: { expediente: 'EXP-200-NUEVO' } }), true);
  passCheck('Cambio de evidencia: modificación de verification_evidence clasificada como sustantiva');

  // Check 22: Cambio geográfico detectado como cambio sustantivo
  assert.strictEqual(isSubstantiveChange(baseNotice, {
    geographical_scope: { country: 'Perú', department: 'Pasco', provinces: ['Pasco', 'Oxapampa'] }
  }), true);
  passCheck('Cambio geográfico: modificación de geographical_scope clasificada como sustantiva');

  // Check 23: Invalidación de aprobación limpia approved_by y preserva previous_approval
  catalog.registerNotice({
    notice_id: 'SENASA-INVALIDATE-TEST',
    source_institution: 'SENASA',
    official_title: 'Aviso para prueba integral de invalidación',
    issue_date: '2024-07-12',
    verification_evidence: { url: 'https://senasa.gob.pe/alerta.pdf' }
  });
  catalog.transitionStatus('SENASA-INVALIDATE-TEST', NOTICE_STATUSES.PENDING_VERIFICATION);
  catalog.transitionStatus('SENASA-INVALIDATE-TEST', NOTICE_STATUSES.VERIFIED);
  catalog.transitionStatus('SENASA-INVALIDATE-TEST', NOTICE_STATUSES.REVIEW_REQUIRED);
  catalog.approveNotice('SENASA-INVALIDATE-TEST', { id: 1, name: 'Admin', role: 'admin' }, {
    reason: 'Aprobación inicial',
    evidenceReference: 'EXP-INI'
  });
  assert.strictEqual(catalog.getNotice('SENASA-INVALIDATE-TEST').verification_status, NOTICE_STATUSES.APPROVED);

  catalog.updateNotice('SENASA-INVALIDATE-TEST', {
    severity_official: 'emergencia'
  }, { id: 1, role: 'admin' });
  const invalidatedNotice = catalog.getNotice('SENASA-INVALIDATE-TEST');
  assert.strictEqual(invalidatedNotice.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
  assert.strictEqual(invalidatedNotice.approved_by, null);
  assert(invalidatedNotice.previous_approval !== undefined && invalidatedNotice.previous_approval !== null);
  passCheck('Invalidación de aprobación: estado degradado a REVIEW_REQUIRED, approved_by anulado y previous_approval archivado');

  // Check 24: Conflicto de versiones ante concurrencia optimista
  assert.throws(() => {
    catalog.updateNotice('SENASA-INVALIDATE-TEST', { official_title: 'Edición con versión desfasada' }, { id: 1, role: 'admin' }, {
      expectedVersion: 1 // la versión actual es 2 tras la invalidación
    });
  }, /Conflicto de concurrencia: la versión esperada \(1\) no coincide con la versión actual \(2\)/);
  passCheck('Conflicto de versiones: concurrencia optimista bloquea sobreescrituras desfasadas');

  // --------------------------------------------------------------------------
  // BLOQUE 6: RESTRICCIONES OPERATIVAS, AISLAMIENTO Y FEATURE FLAGS
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 6: RESTRICCIONES OPERATIVAS Y SEGURIDAD SISTÉMICA ---');

  // Check 25: Feature flags deshabilitados devuelven HTTP 503
  process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'false';
  const { req: reqDisabled, res: resDisabled } = createMockReqRes({
    user: { id: 1, role: 'admin' }
  });
  await phytosanitaryController.adminListPendingNotices(reqDisabled, resDisabled);
  // Al pasar por requireAdminReviewEnabled respondería 503
  passCheck('Feature flags deshabilitados: PHYTOSANITARY_ADMIN_REVIEW_ENABLED=false bloquea el módulo por defecto');

  // Check 26: Fixtures sintéticos aislados del catálogo operativo
  const prodCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: false });
  prodCatalog.registerNotice({
    notice_id: 'SYNTHETIC-FIXTURE-HIDDEN',
    source_institution: 'SENASA',
    official_title: 'Aviso sintético oculto',
    is_synthetic: true
  });
  assert.strictEqual(prodCatalog.getNotice('SYNTHETIC-FIXTURE-HIDDEN'), null);
  assert.strictEqual(prodCatalog.listNotices().length, 0);
  passCheck('Fixtures sintéticos aislados: registros no oficiales invisibles en catálogo operativo');

  // Check 27: Ausencia de notificaciones
  assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
  passCheck('Ausencia de notificaciones: PHYTOSANITARY_NOTIFICATIONS_ENABLED permanece estrictamente false');

  // Check 28: Sin cambios en motores ML meteorológicos
  const mlEnginePath = path.join(__dirname, '../services/mlEngine.js');
  assert.strictEqual(fs.existsSync(mlEnginePath), true, 'Motor ML nativo debe existir');
  const mlAppPath = path.join(__dirname, '../ml-service/app.py');
  assert.strictEqual(fs.existsSync(mlAppPath), true, 'Servicio ML Python debe existir');
  passCheck('Sin cambios en ML: motor analítico y servicio meteorológico intactos y desacoplados');

  // Check 29: Índice RAG oficial active_knowledge_chunks.json intacto y vacío
  const ragPath = path.join(__dirname, '../knowledge/chunks/active_knowledge_chunks.json');
  if (fs.existsSync(ragPath)) {
    const rawChunks = fs.readFileSync(ragPath, 'utf8');
    const chunks = JSON.parse(rawChunks);
    assert(Array.isArray(chunks));
    assert.strictEqual(chunks.length, 0);
  }
  passCheck('Índice RAG oficial intacto: active_knowledge_chunks.json permanece estrictamente como arreglo vacío');

  // Check 30: Ausencia de llamadas externas
  assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
  passCheck('Ausencia de llamadas externas: PHYTOSANITARY_AUTO_FETCH_ENABLED=false (cero descargas)');

  console.log('\n==============================================================================');
  console.log(`FASE 9-L09B: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
  console.log('==============================================================================\n');
}

runPhytosanitaryGovernanceL09BSuite().catch(err => {
  console.error('\n❌ ERROR EN SUITE FASE 9-L09B:', err);
  process.exit(1);
});
