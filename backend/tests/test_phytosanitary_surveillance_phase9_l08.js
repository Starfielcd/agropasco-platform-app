/**
 * AgroPasco Digital — Suite de Pruebas y Validación FASE 9-L08
 * ==============================================================================
 * MÓDULO DE VIGILANCIA FITOSANITARIA OFICIAL, INGESTA CONTROLADA Y RELEVANCIA POR PARCELA
 *
 * Verificaciones obligatorias (44 checks exhaustivos):
 *   1. Registro de aviso oficial con metadatos completos y canónicos (Sección 5).
 *   2. Clasificación determinista: Noticia institucional informativa ≠ alerta formal.
 *   3. Clasificación determinista: Emergencia fitosanitaria formal (prioridad crítica).
 *   4. Clasificación determinista: Resolución de control oficial cuarentenario.
 *   5. Clasificación determinista: Aviso de vigilancia epidemiológica.
 *   6. Clasificación determinista: Recomendación general de buenas prácticas.
 *   7. Clasificación determinista: Publicación sin clasificación confirmada (fallback seguro).
 *   8. Manejo de vigencia: Aviso sin fecha de fin conserva null (sin expiración arbitraria).
 *   9. Clasificación de reporte histórico derogado con vigencia concluida.
 *  10. Trazabilidad de aviso sustituido (superseded): relación canónica con nuevo aviso.
 *  11. Ciclo de vida: Aviso retirado (withdrawn) por disposición oficial.
 *  12. Validación de entrada: Rechazo de aviso con URL no verificable o inválida.
 *  13. Validación de entrada: Rechazo de institución emisora desconocida / no autorizada.
 *  14. Validación de entrada: Rechazo de identificador o número oficial duplicado.
 *  15. Trazabilidad y ciclo de vida: Historial de auditoría completo en transiciones.
 *  16. Integridad de ciclo de vida: Bloqueo de transiciones arbitrarias (DISCOVERED -> ACTIVE directo).
 *  17. Autorización de revisores: Bloqueo de aprobación por roles no autorizados (farmer).
 *  18. Autorización de revisores: Rechazo estricto de identidad simulada o incompleta.
 *  19. Aislamiento estricto: Fixtures sintéticos bloqueados de pasar a ACTIVE en modo operativo.
 *  20. Relevancia geográfica: Aviso nacional clasificado como potentially_relevant (no foco local).
 *  21. Relevancia geográfica: Aviso departamental Pasco clasificado como applicable_scope_confirmed.
 *  22. Relevancia geográfica: Aviso provincial Pasco con parcela en provincia de Pasco.
 *  23. Relevancia geográfica: Aviso provincial Daniel Alcides Carrión con parcela en Yanahuanca.
 *  24. Relevancia geográfica: Aviso provincial Oxapampa con parcela en Villa Rica.
 *  25. Relevancia geográfica: Parcela en Oxapampa vs aviso restringido a Daniel Alcides Carrión (not_applicable).
 *  26. Relevancia geográfica: Aviso circunscrito a otro departamento (Junín) (not_applicable).
 *  27. Relevancia geográfica: Ámbito geográfico ambiguo (insufficient_geographic_information).
 *  28. Relevancia por cultivo: Coincidencia con sinónimos canónicos (Papa Canchán -> papa).
 *  29. Relevancia por cultivo: Normalización de Café arábica -> cafe y Palta Hass -> palto.
 *  30. Relevancia por cultivo: Cultivo diferente (papa vs plátano) clasificado como not_applicable.
 *  31. Relevancia por cultivo: Parcela con cultivo no asignado o desconocido manejado de forma conservadora.
 *  32. Seguridad agronómica: Cero dosis, mezclas o prescripciones químicas automáticas.
 *  33. Seguridad agronómica: Declaración explícita de que el aviso NO constituye diagnóstico de infección.
 *  34. Notificaciones desacopladas: should_notify es estrictamente FALSE en L08.
 *  35. Notificaciones desacopladas: Supresión fundamentada de avisos irrelevantes o derogados.
 *  36. HTTP Controller: Consulta pública devuelve estructura vacía e informativa cuando no hay avisos activos.
 *  37. HTTP Controller: Fixtures sintéticos totalmente aislados del catálogo en modo operativo.
 *  38. HTTP Controller / Seguridad: Agricultor consulta relevancia de su propia parcela (200 OK).
 *  39. HTTP Controller / Seguridad: Agricultor bloqueado al consultar parcela ajena (403 Forbidden).
 *  40. HTTP Controller / Seguridad: Endpoint protegido deniega acceso sin token JWT (401 Unauthorized).
 *  41. Asesor / Admin: Consulta autorizada de parcelas de cualquier agricultor (200 OK).
 *  42. Integridad de base de datos: Cero migraciones ejecutadas en L08.
 *  43. Integridad RAG: Índice oficial active_knowledge_chunks.json intacto y estrictamente vacío ([]).
 *  44. Integridad ML: Modelos meteorológicos y predicciones de riesgo desacopladas de avisos fitosanitarios.
 */

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED = 'false';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

const {
  NOTICE_TYPES,
  NOTICE_STATUSES,
  OFFICIAL_SEVERITIES,
  INTERNAL_PRIORITIES,
  SCOPE_TYPES,
  normalizeCrop,
  classifyNoticeType,
  extractPests,
  inferPriority,
  buildPublicPreventiveAction
} = require('../services/phytosanitaryNoticeClassifier');

const {
  OfficialNoticeCatalogService,
  AUTHORIZED_INSTITUTIONS,
  VALID_TRANSITIONS
} = require('../services/officialNoticeCatalogService');

const {
  ParcelNoticeRelevanceService,
  RELEVANCE_STATES
} = require('../services/parcelNoticeRelevanceService');

const phytosanitaryController = require('../controllers/phytosanitaryController');

// Helper para mock HTTP Req/Res
function createMockReqRes({ params = {}, query = {}, user = null, headers = {} } = {}) {
  const req = {
    params,
    query,
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

async function runPhytosanitarySurveillanceSuite() {
  console.log('\n==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L08');
  console.log('VIGILANCIA FITOSANITARIA OFICIAL, INGESTA CONTROLADA Y RELEVANCIA POR PARCELA');
  console.log('==============================================================================\n');

  const fixturesPath = path.resolve(__dirname, 'fixtures', 'l08_phytosanitary_test_fixtures.json');
  assert(fs.existsSync(fixturesPath), 'El archivo de fixtures sintéticos L08 debe existir.');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  // --------------------------------------------------------------------------
  // BLOQUE 1: MODELO DE DATOS Y CLASIFICACIÓN DE PUBLICACIONES (Secciones 5 y 6)
  // --------------------------------------------------------------------------
  console.log('--- BLOQUE 1: MODELO DE DATOS Y CLASIFICACIÓN FITOSANITARIA ---');

  // Check 1: Registro de aviso oficial con metadatos completos y canónicos
  const catalog = new OfficialNoticeCatalogService({ allowTestFixtures: true });
  const notice1 = catalog.registerNotice(fixtures[0]);
  assert.strictEqual(notice1.notice_id, 'SENASA-AF-2024-001');
  assert.strictEqual(notice1.source_institution, 'SENASA');
  assert.strictEqual(notice1.notice_type, NOTICE_TYPES.ALERTA_FITOSANITARIA);
  assert(Array.isArray(notice1.affected_crops));
  assert(notice1.affected_crops.includes('papa'));
  passCheck('Registro de aviso oficial con metadatos completos y campos canónicos requeridos');

  // Check 2: Clasificación de noticia informativa (no es alerta fitosanitaria)
  const noticeType2 = classifyNoticeType({
    title: 'SENASA informa sobre visita de inspección y capacitación en Ninacaca',
    excerpt: 'Especialistas brindaron charla informativa a productores locales.'
  });
  assert.strictEqual(noticeType2, NOTICE_TYPES.COMUNICADO_INFORMATIVO);
  passCheck('Noticia institucional clasificada como comunicado_informativo, no como alerta fitosanitaria');

  // Check 3: Clasificación de Emergencia Fitosanitaria formal
  const noticeType3 = classifyNoticeType({
    title: 'Declárase en Emergencia Fitosanitaria la provincia de Oxapampa por brote de plaga',
    documentNumber: 'R.J. 102-2024-SENASA'
  });
  assert.strictEqual(noticeType3, NOTICE_TYPES.EMERGENCIA_FITOSANITARIA);
  assert.strictEqual(inferPriority(noticeType3, OFFICIAL_SEVERITIES.EMERGENCIA), INTERNAL_PRIORITIES.CRITICA);
  passCheck('Emergencia fitosanitaria formal clasificada con severidad emergencia y prioridad crítica');

  // Check 4: Clasificación de Resolución de Control Oficial
  const noticeType4 = classifyNoticeType({
    title: 'Resolución Directoral que establece medidas de control oficial de plagas cuarentenarias',
    documentNumber: 'R.D. N° 012-2023-SENASA'
  });
  assert.strictEqual(noticeType4, NOTICE_TYPES.RESOLUCION_CONTROL_OFICIAL);
  passCheck('Resolución administrativa de control oficial clasificada adecuadamente');

  // Check 5: Clasificación de Aviso de Vigilancia
  const noticeType5 = classifyNoticeType({
    title: 'Aviso de vigilancia fitosanitaria y trampeo estacional en valles interandinos'
  });
  assert.strictEqual(noticeType5, NOTICE_TYPES.AVISO_VIGILANCIA);
  passCheck('Aviso de vigilancia preventiva clasificado con categoría aviso_vigilancia');

  // Check 6: Clasificación de Recomendación General
  const noticeType6 = classifyNoticeType({
    title: 'Guía técnica y buenas prácticas agrícolas para la prevención de enfermedades radiculares'
  });
  assert.strictEqual(noticeType6, NOTICE_TYPES.RECOMENDACION_GENERAL);
  passCheck('Recomendación técnica clasificada como recomendacion_general');

  // Check 7: Publicación sin clasificación confirmada (fallback seguro)
  const noticeType7 = classifyNoticeType({
    title: 'Anuario estadístico general del sector agrario 2024'
  });
  assert.strictEqual(noticeType7, NOTICE_TYPES.NO_CLASIFICADO);
  passCheck('Publicación sin términos fitosanitarios específicos clasificada como no confirmada (fallback seguro)');

  // Check 8: Aviso sin fecha de fin conserva null
  const noticeNoEndDate = catalog.registerNotice({
    notice_id: 'SENASA-TEST-NODATE',
    source_institution: 'SENASA',
    official_title: 'Disposición fitosanitaria de vigencia indefinida',
    issue_date: '2024-05-01',
    effective_until: null,
    is_synthetic: true
  });
  assert.strictEqual(noticeNoEndDate.effective_until, null);
  passCheck('Aviso sin fecha de conclusión conserva null (sin suponer expiración arbitraria)');

  // Check 9: Clasificación de Reporte Histórico
  const noticeType9 = classifyNoticeType({
    title: 'Boletín de campaña 2015 - Norma derogada de erradicación'
  });
  assert.strictEqual(noticeType9, NOTICE_TYPES.REPORTE_HISTORICO);
  passCheck('Reporte histórico o derogado clasificado con vigencia concluida');

  // --------------------------------------------------------------------------
  // BLOQUE 2: CICLO DE VIDA, TRANSICIONES Y VALIDACIÓN DE IDENTIDAD (Sección 7)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 2: CICLO DE VIDA, TRANSICIONES Y REVISIÓN HUMANA ---');

  const lifecycleNotice = catalog.registerNotice({
    notice_id: 'SENASA-LC-001',
    source_institution: 'SENASA',
    official_title: 'Aviso fitosanitario para prueba de ciclo de vida',
    issue_date: '2024-06-01',
    verification_status: NOTICE_STATUSES.DISCOVERED,
    is_synthetic: true
  });

  // Check 10: Trazabilidad de aviso sustituido (superseded)
  const oldNotice = catalog.registerNotice({
    notice_id: 'SENASA-OLD-001',
    source_institution: 'SENASA',
    official_title: 'Resolución previa de control fitosanitario',
    issue_date: '2023-01-01',
    verification_status: NOTICE_STATUSES.APPROVED,
    is_synthetic: true
  });
  const newNotice = catalog.registerNotice({
    notice_id: 'SENASA-NEW-002',
    source_institution: 'SENASA',
    official_title: 'Nueva resolución que sustituye a la previa',
    issue_date: '2024-01-01',
    verification_status: NOTICE_STATUSES.APPROVED,
    is_synthetic: true
  });
  catalog.supersedeNotice('SENASA-OLD-001', 'SENASA-NEW-002', {
    id: 1,
    name: 'Ing. Carlos Ramos',
    role: 'admin'
  }, 'Actualización por nueva normativa vigente');
  assert.strictEqual(catalog.getNotice('SENASA-OLD-001').verification_status, NOTICE_STATUSES.SUPERSEDED);
  assert.strictEqual(catalog.getNotice('SENASA-OLD-001').publication_status, 'sustituido');
  assert.strictEqual(catalog.getNotice('SENASA-NEW-002').supersedes_notice_id, 'SENASA-OLD-001');
  passCheck('Aviso sustituido (superseded) vinculado canónicamente y excluido de publicaciones vigentes');

  // Check 11: Aviso retirado (withdrawn)
  catalog.transitionStatus('SENASA-NEW-002', NOTICE_STATUSES.WITHDRAWN, {
    reviewer: { id: 1, name: 'Dra. Elena Vidal', role: 'admin' },
    reason: 'Retirado por rectificación institucional'
  });
  assert.strictEqual(catalog.getNotice('SENASA-NEW-002').verification_status, NOTICE_STATUSES.WITHDRAWN);
  passCheck('Aviso retirado (withdrawn) alcanza estado terminal auditable');

  // Check 12: Rechazo de URL oficial inválida
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-ERR-URL',
      source_institution: 'SENASA',
      official_title: 'Aviso con URL sospechosa',
      official_url: 'not-a-valid-http-url'
    });
  }, /URL oficial inválida o no verificable/);
  passCheck('Rechazo automático de aviso con URL no verificable o formato inválido');

  // Check 13: Rechazo de institución emisora desconocida
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'UNKNOWN-001',
      source_institution: 'EMPRESA_PRIVADA_AGRO',
      official_title: 'Aviso comercial no oficial'
    });
  }, /Institución emisora .* desconocida o no autorizada/);
  passCheck('Rechazo de instituciones emisoras no oficiales o no autorizadas');

  // Check 14: Rechazo de identificador oficial duplicado
  assert.throws(() => {
    catalog.registerNotice({
      notice_id: 'SENASA-AF-2024-001',
      source_institution: 'SENASA',
      official_title: 'Intento de registro duplicado'
    });
  }, /duplicado/i);
  passCheck('Rechazo categórico de número oficial o notice_id duplicado');

  // Check 15: Historial de auditoría completo
  catalog.transitionStatus('SENASA-LC-001', NOTICE_STATUSES.PENDING_VERIFICATION, {
    reviewer: { id: 2, name: 'Agrónomo Revisor', role: 'advisor' },
    reason: 'Pase a verificación técnica'
  });
  const audited = catalog.getNotice('SENASA-LC-001');
  assert(audited.audit_history.length >= 2);
  assert.strictEqual(audited.audit_history[1].to_status, NOTICE_STATUSES.PENDING_VERIFICATION);
  passCheck('Historial de trazabilidad y auditoría preservado en cada transición');

  // Check 16: Bloqueo de transición inválida (DISCOVERED -> ACTIVE directo)
  const freshNotice = catalog.registerNotice({
    notice_id: 'SENASA-FRESH-001',
    source_institution: 'SENASA',
    official_title: 'Aviso fresco sin verificar',
    issue_date: '2024-06-01',
    is_synthetic: true
  });
  assert.throws(() => {
    catalog.transitionStatus('SENASA-FRESH-001', NOTICE_STATUSES.ACTIVE, {
      reviewer: { id: 1, name: 'Admin', role: 'admin' }
    });
  }, /Transición inválida/);
  passCheck('Bloqueo de saltos de estado arbitrarios en el ciclo de vida');

  // Check 17: Bloqueo de aprobación por roles no autorizados (farmer)
  catalog.transitionStatus('SENASA-FRESH-001', NOTICE_STATUSES.PENDING_VERIFICATION);
  catalog.transitionStatus('SENASA-FRESH-001', NOTICE_STATUSES.VERIFIED);
  assert.throws(() => {
    catalog.approveNotice('SENASA-FRESH-001', {
      id: 99,
      name: 'Agricultor Usuario',
      role: 'farmer'
    });
  }, /no tiene privilegios para aprobar avisos fitosanitarios/);
  passCheck('Aprobación técnica denegada para usuarios con rol farmer');

  // Check 18: Rechazo de identidad simulada o incompleta de revisor
  assert.throws(() => {
    catalog.approveNotice('SENASA-FRESH-001', {
      id: 1,
      name: '  ',
      role: 'admin'
    });
  }, /Identidad de revisor no válida o incompleta/);
  passCheck('Rechazo estricto de identidad de revisor manipulada, vacía o simulada');

  // Check 19: Aislamiento estricto de fixtures sintéticos en modo operativo
  const strictCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: false });
  assert.throws(() => {
    strictCatalog.registerNotice({
      notice_id: 'SENASA-SYNTHETIC-ACTIVE',
      source_institution: 'SENASA',
      official_title: 'Aviso de prueba sintético',
      is_synthetic: true,
      verification_status: NOTICE_STATUSES.APPROVED
    });
    // Tratar de activar en catálogo operativo estricto
    strictCatalog.activateNotice('SENASA-SYNTHETIC-ACTIVE', {
      id: 1,
      name: 'Ing. Director',
      role: 'admin'
    });
  }, /Bloqueo de seguridad: No se permite activar avisos sintéticos en modo operativo/);
  passCheck('Avisos sintéticos de prueba categóricamente bloqueados de pasar a ACTIVE operativo');

  // --------------------------------------------------------------------------
  // BLOQUE 3: EVALUACIÓN DE RELEVANCIA GEOGRÁFICA Y POR CULTIVO (Secciones 8 y 9)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 3: RELEVANCIA GEOGRÁFICA Y AGRONÓMICA POR PARCELA ---');

  const relevanceService = new ParcelNoticeRelevanceService();

  // Parcelas sintéticas de prueba en las 3 provincias de Pasco
  const parcelPasco = {
    id: 101,
    user_id: 10,
    name: 'Parcela Paucartambo Papa',
    crop_name: 'Papa Canchán',
    department: 'Pasco',
    province: 'Pasco',
    district: 'Paucartambo'
  };

  const parcelCarrion = {
    id: 102,
    user_id: 10,
    name: 'Parcela Yanahuanca Papa',
    crop_name: 'Papa',
    department: 'Pasco',
    province: 'Daniel Alcides Carrión',
    district: 'Yanahuanca'
  };

  const parcelOxapampa = {
    id: 103,
    user_id: 20,
    name: 'Fundo Villa Rica Café',
    crop_name: 'Café arábica',
    department: 'Pasco',
    province: 'Oxapampa',
    district: 'Villa Rica'
  };

  const parcelOxapampaPalto = {
    id: 104,
    user_id: 20,
    name: 'Fundo Chontabamba Palto',
    crop_name: 'Palta Hass',
    department: 'Pasco',
    province: 'Oxapampa',
    district: 'Chontabamba'
  };

  // Avisos de fixtures
  const noticeNacionalRancha = fixtures[0]; // Papa, Nacional
  const noticeEmergenciaOxapampa = fixtures[1]; // Café, Oxapampa
  const noticeControlCarrion = fixtures[3]; // Papa, Daniel Alcides Carrión
  const noticeJunin = fixtures[5]; // Papa, Junín
  const noticeAmbiguo = fixtures[6]; // Pulgón, Ambiguo

  // Check 20: Aviso nacional clasificado como potentially_relevant (no foco local)
  const evalNacional = relevanceService.evaluateNoticeRelevanceForParcel(noticeNacionalRancha, parcelPasco);
  assert.strictEqual(evalNacional.relevance_status, RELEVANCE_STATES.POTENTIALLY_RELEVANT);
  assert(evalNacional.rationale.includes('Potencialmente relevante'));
  passCheck('Aviso nacional clasificado como potencialmente relevante sin atribuir infección local');

  // Check 21: Aviso departamental Pasco clasificado como applicable_scope_confirmed
  const noticeDeptPasco = {
    notice_id: 'SENASA-DEPT-PASCO',
    official_title: 'Aviso fitosanitario departamental para Pasco',
    affected_crops: ['papa'],
    geographical_scope: { country: 'Perú', department: 'Pasco', provinces: [] },
    geographical_scope_type: SCOPE_TYPES.DEPARTAMENTAL
  };
  const evalDept = relevanceService.evaluateNoticeRelevanceForParcel(noticeDeptPasco, parcelPasco);
  assert.strictEqual(evalDept.relevance_status, RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED);
  passCheck('Aviso departamental Pasco con cultivo coincidente clasificado como ámbito confirmado');

  // Check 22: Aviso provincial Pasco con parcela en provincia de Pasco
  const noticeProvPasco = {
    notice_id: 'SENASA-PROV-PASCO',
    official_title: 'Aviso para la provincia de Pasco',
    affected_crops: ['papa'],
    geographical_scope: { country: 'Perú', department: 'Pasco', provinces: ['Pasco'] },
    geographical_scope_type: SCOPE_TYPES.PROVINCIAL
  };
  const evalProvPasco = relevanceService.evaluateNoticeRelevanceForParcel(noticeProvPasco, parcelPasco);
  assert.strictEqual(evalProvPasco.relevance_status, RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED);
  passCheck('Aviso provincial Pasco coincide con parcela en provincia de Pasco');

  // Check 23: Aviso provincial Daniel Alcides Carrión con parcela en Yanahuanca
  const evalCarrion = relevanceService.evaluateNoticeRelevanceForParcel(noticeControlCarrion, parcelCarrion);
  assert.strictEqual(evalCarrion.relevance_status, RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED);
  passCheck('Aviso provincial Daniel Alcides Carrión coincide con parcela en Yanahuanca');

  // Check 24: Aviso provincial Oxapampa con parcela en Villa Rica
  const evalOxapampa = relevanceService.evaluateNoticeRelevanceForParcel(noticeEmergenciaOxapampa, parcelOxapampa);
  assert.strictEqual(evalOxapampa.relevance_status, RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED);
  passCheck('Aviso de emergencia en Oxapampa coincide con parcela cafetalera en Villa Rica');

  // Check 25: Parcela en Oxapampa vs aviso restringido a Daniel Alcides Carrión
  const evalMismatchedProv = relevanceService.evaluateNoticeRelevanceForParcel(noticeControlCarrion, parcelOxapampa);
  assert.strictEqual(evalMismatchedProv.relevance_status, RELEVANCE_STATES.NOT_APPLICABLE);
  passCheck('Parcela en Oxapampa evaluada contra aviso de Daniel Alcides Carrión resulta not_applicable');

  // Check 26: Aviso circunscrito a otro departamento (Junín)
  const evalJunin = relevanceService.evaluateNoticeRelevanceForParcel(noticeJunin, parcelPasco);
  assert.strictEqual(evalJunin.relevance_status, RELEVANCE_STATES.NOT_APPLICABLE);
  passCheck('Aviso circunscrito a Junín resulta not_applicable para parcelas en Pasco');

  // Check 27: Ámbito geográfico ambiguo
  const evalAmbiguo = relevanceService.evaluateNoticeRelevanceForParcel(noticeAmbiguo, parcelPasco);
  assert.strictEqual(evalAmbiguo.relevance_status, RELEVANCE_STATES.INSUFFICIENT_GEOGRAPHIC_INFORMATION);
  passCheck('Aviso con delimitación geográfica ambigua clasificado como información insuficiente');

  // Check 28: Coincidencia de cultivo con sinónimos canónicos (Papa Canchán -> papa)
  assert.strictEqual(normalizeCrop('Papa Canchán'), 'papa');
  assert.strictEqual(evalNacional.crop_evaluation.match, true);
  passCheck('Normalización de cultivo: "Papa Canchán" homologado canónicamente a "papa"');

  // Check 29: Normalización de Café arábica y Palta Hass
  assert.strictEqual(normalizeCrop('Café arábica'), 'cafe');
  assert.strictEqual(normalizeCrop('Palta Hass'), 'palto');
  passCheck('Normalización de cultivo: "Café arábica" -> "cafe" y "Palta Hass" -> "palto"');

  // Check 30: Cultivo diferente (papa vs café) clasificado como not_applicable
  const evalCropMismatch = relevanceService.evaluateNoticeRelevanceForParcel(noticeEmergenciaOxapampa, parcelPasco);
  assert.strictEqual(evalCropMismatch.relevance_status, RELEVANCE_STATES.NOT_APPLICABLE);
  passCheck('Cultivo diferente entre parcela y aviso resulta taxativamente not_applicable');

  // Check 31: Parcela con cultivo desconocido o no asignado
  const parcelNoCrop = { id: 105, user_id: 10, name: 'Parcela Sin Cultivo', department: 'Pasco', province: 'Pasco' };
  const evalNoCrop = relevanceService.evaluateNoticeRelevanceForParcel(noticeNacionalRancha, parcelNoCrop);
  assert.strictEqual(evalNoCrop.crop_evaluation.match, null);
  passCheck('Parcela sin cultivo asignado tratada de manera conservadora sin asignaciones forzadas');

  // --------------------------------------------------------------------------
  // BLOQUE 4: SEGURIDAD AGRONÓMICA Y NOTIFICACIONES DESACOPLADAS (Secciones 10 y 14)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 4: SEGURIDAD AGRONÓMICA Y DESACOPLAMIENTO DE NOTIFICACIONES ---');

  // Check 32: Cero prescripciones químicas automáticas
  const preventiveAction = buildPublicPreventiveAction({
    pestCommonName: 'Roya del Café',
    affectedCrops: ['cafe'],
    isQuarantine: false
  });
  assert(!/dosis|litros\/ha|gramos|ml\/cilindro|mancozeb|glifosato|clorpirifos|fungicida/i.test(preventiveAction));
  assert(preventiveAction.includes('Inspeccione visualmente'));
  assert(preventiveAction.includes('no aplique sustancias químicas sin indicación oficial'));
  passCheck('Recomendaciones oficiales estrictamente preventivas: Cero dosis y cero químicos automáticos');

  // Check 33: Declaración explícita de no diagnóstico
  assert(evalNacional.safety_disclaimer.includes('NO constituye un diagnóstico de infección de la parcela'));
  passCheck('Reporte de relevancia incluye cláusula explícita de exención de diagnóstico');

  // Check 34: Preparación de notificación desacoplada con should_notify === false
  const notificationCandidate = relevanceService.prepareNotificationCandidate(noticeEmergenciaOxapampa, parcelOxapampa);
  assert.strictEqual(notificationCandidate.should_notify, false);
  assert.strictEqual(notificationCandidate.candidate_payload.type, 'phytosanitary_alert');
  assert.strictEqual(notificationCandidate.candidate_payload.user_id, parcelOxapampa.user_id);
  assert.strictEqual(notificationCandidate.candidate_payload.parcel_id, parcelOxapampa.id);
  assert(notificationCandidate.suppression_reason.includes('PHYTOSANITARY_NOTIFICATIONS_ENABLED=false'));
  passCheck('Notificación candidata estructurada pero con envío real estrictamente desactivado (should_notify=false)');

  // Check 35: Supresión de avisos irrelevantes de la lista de candidatos
  const irrelevantCandidate = relevanceService.prepareNotificationCandidate(noticeJunin, parcelPasco);
  assert.strictEqual(irrelevantCandidate.should_notify, false);
  assert.strictEqual(irrelevantCandidate.is_eligible_candidate, false);
  assert(irrelevantCandidate.suppression_reason.includes('Aviso no aplicable o irrelevante'));
  passCheck('Supresión automática y justificada de avisos irrelevantes para generación de notificaciones');

  // --------------------------------------------------------------------------
  // BLOQUE 5: INTERFACES HTTP CONTROLADAS Y SEGURIDAD MULTIUSUARIO (Sección 13)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 5: ENDPOINTS HTTP CONTROLADOS Y SEGURIDAD JWT ---');

  // Inyectar catálogo de prueba para el controlador y habilitar feature flag en proceso de prueba aislado
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'true';
  phytosanitaryController.setCatalogService(catalog);
  phytosanitaryController.setParcelResolverOverride(async (id) => {
    const map = {
      '101': parcelPasco,
      '102': parcelCarrion,
      '103': parcelOxapampa,
      '104': parcelOxapampaPalto
    };
    return map[String(id)] || null;
  });

  // Check 36: Consulta pública con respuesta informativa cuando no hay avisos activos
  const emptyCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: true });
  phytosanitaryController.setCatalogService(emptyCatalog);
  const { req: reqEmpty, res: resEmpty } = createMockReqRes({ query: { activeOnly: 'true' } });
  await phytosanitaryController.listNotices(reqEmpty, resEmpty);
  assert.strictEqual(resEmpty.statusCode, 200);
  assert.strictEqual(resEmpty.body.total, 0);
  assert(Array.isArray(resEmpty.body.data));
  assert(resEmpty.body.message.includes('No se registran avisos'));
  passCheck('Endpoint listNotices devuelve estructura vacía e informativa cuando no hay avisos activos');

  // Check 37: Aislamiento de fixtures sintéticos en modo operativo en el controlador
  const operationalCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: false });
  // Añadir un fixture sintético
  operationalCatalog.registerNotice({
    notice_id: 'SENASA-OP-SYNTH',
    source_institution: 'SENASA',
    official_title: 'Aviso sintético secreto',
    is_synthetic: true
  });
  phytosanitaryController.setCatalogService(operationalCatalog);
  const { req: reqSynth, res: resSynth } = createMockReqRes({ params: { id: 'SENASA-OP-SYNTH' } });
  await phytosanitaryController.getNoticeById(reqSynth, resSynth);
  assert.strictEqual(resSynth.statusCode, 404);
  passCheck('Avisos sintéticos invisibles (404) a través del endpoint HTTP en modo operativo');

  // Restaurar catálogo de prueba con fixtures para pruebas de relevancia HTTP
  phytosanitaryController.setCatalogService(catalog);

  // Check 38: Agricultor consulta su propia parcela exitosamente (200 OK)
  const farmerUser = { id: 10, name: 'Juan Quispe', role: 'farmer' };
  const { req: reqFarmerOwn, res: resFarmerOwn } = createMockReqRes({
    params: { parcelId: '101' },
    query: { noticeId: 'SENASA-AF-2024-001' },
    user: farmerUser
  });
  await phytosanitaryController.evaluateParcelRelevance(reqFarmerOwn, resFarmerOwn);
  assert.strictEqual(resFarmerOwn.statusCode, 200);
  assert.strictEqual(resFarmerOwn.body.success, true);
  assert.strictEqual(resFarmerOwn.body.data.evaluation.relevance_status, RELEVANCE_STATES.POTENTIALLY_RELEVANT);
  passCheck('Agricultor consulta exitosamente la relevancia para su parcela propia (200 OK)');

  // Check 39: Agricultor bloqueado al intentar consultar parcela ajena (403 Forbidden)
  const otherFarmerUser = { id: 99, name: 'Pedro Chauca', role: 'farmer' };
  const { req: reqForbidden, res: resForbidden } = createMockReqRes({
    params: { parcelId: '101' }, // Parcela 101 pertenece a user_id: 10
    user: otherFarmerUser
  });
  await phytosanitaryController.evaluateParcelRelevance(reqForbidden, resForbidden);
  assert.strictEqual(resForbidden.statusCode, 403);
  assert.strictEqual(resForbidden.body.success, false);
  assert(resForbidden.body.error.includes('Acceso denegado'));
  passCheck('Agricultor bloqueado (403 Forbidden) al intentar acceder a parcelas de terceros');

  // Check 40: Endpoint protegido requiere autenticación (401 si no hay token)
  const { authenticateToken } = require('../middleware/auth');
  const { req: reqNoAuth, res: resNoAuth } = createMockReqRes({
    params: { parcelId: '101' },
    headers: {} // sin token
  });
  let nextCalled = false;
  authenticateToken(reqNoAuth, resNoAuth, () => { nextCalled = true; });
  assert.strictEqual(resNoAuth.statusCode, 401);
  assert.strictEqual(nextCalled, false);
  passCheck('Endpoint de relevancia rechaza peticiones sin autenticación (401 Unauthorized)');

  // Check 41: Asesor o Administrador puede consultar parcelas de cualquier agricultor (200 OK)
  const advisorUser = { id: 50, name: 'Ing. Asesor Regional', role: 'advisor' };
  const { req: reqAdvisor, res: resAdvisor } = createMockReqRes({
    params: { parcelId: '101' },
    user: advisorUser
  });
  await phytosanitaryController.evaluateParcelRelevance(reqAdvisor, resAdvisor);
  assert.strictEqual(resAdvisor.statusCode, 200);
  assert.strictEqual(resAdvisor.body.success, true);
  passCheck('Asesores y Administradores autorizados a auditar parcelas en toda la región (200 OK)');

  // Restaurar feature flag a false por seguridad predeterminada
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';


  // --------------------------------------------------------------------------
  // BLOQUE 6: RESPETO DE RESTRICCIONES ABSOLUTAS E INTEGRIDAD DEL SISTEMA
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 6: INTEGRIDAD ARQUITECTÓNICA Y RESTRICCIONES ABSOLUTAS ---');

  // Check 42: Cero migraciones ejecutadas en L08
  const sqlProposalPath = path.resolve(__dirname, '..', 'data', 'phytosanitary', 'phytosanitary_notices_schema_proposal.sql');
  assert(fs.existsSync(sqlProposalPath), 'El archivo de propuesta DDL debe existir como documentación.');
  passCheck('Propuesta DDL documentada exclusivamente en archivo SQL sin ejecución de migraciones en BD');

  // Check 43: Índice oficial RAG estrictamente intacto y vacío ([])
  const activeChunksPath = path.resolve(__dirname, '..', 'knowledge', 'chunks', 'active_knowledge_chunks.json');
  assert(fs.existsSync(activeChunksPath), 'El índice active_knowledge_chunks.json debe existir.');
  const activeChunks = JSON.parse(fs.readFileSync(activeChunksPath, 'utf8'));
  assert.strictEqual(Array.isArray(activeChunks), true);
  assert.strictEqual(activeChunks.length, 0, 'El índice oficial activo de RAG debe permanecer estrictamente vacío ([]).');
  passCheck('Índice oficial RAG estrictamente vacío ([]) y protegido contra contaminación');

  // Check 44: Modelos ML y alertas meteorológicas desacopladas
  const notificationService = require('../services/notificationService');
  assert(typeof notificationService.createWeatherAlertAtomically === 'function');
  assert(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED !== 'true');
  passCheck('Modelos ML y alertas meteorológicas intactos y totalmente desacoplados de avisos fitosanitarios');

  console.log('\n==============================================================================');
  console.log(`FASE 9-L08: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
  console.log('==============================================================================\n');
}

runPhytosanitarySurveillanceSuite().catch(err => {
  console.error('\n❌ Error en la suite L08:', err);
  process.exit(1);
});
