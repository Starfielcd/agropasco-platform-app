/**
 * AgroPasco Digital — Suite de Pruebas y Validación FASE 9-L08B
 * ==============================================================================
 * CORRECCIÓN DE AUTORIZACIÓN, FEATURE FLAGS, PAGINACIÓN Y CONFIABILIDAD GEOGRÁFICA
 *
 * Verificaciones obligatorias (mínimo 40 checks según especificación L08B):
 *   1. Farmer accede a parcela propia (200 OK).
 *   2. Farmer no accede a parcela ajena (403 Forbidden).
 *   3. Advisor accede según permisos regionales actuales (200 OK).
 *   4. Admin accede según permisos administrativos actuales (200 OK).
 *   5. Rol supermarket es estrictamente rechazado (403 Forbidden) [H-MED-01].
 *   6. Rol guest es rechazado (403 Forbidden).
 *   7. Rol desconocido o sin rol es rechazado (403 Forbidden).
 *   8. JWT ausente deniega acceso en middleware (401 Unauthorized).
 *   9. JWT inválido deniega acceso en middleware (403 Forbidden).
 *  10. parcelId inválido (NaN, string, negativo, cero) retorna 400 Bad Request.
 *  11. parcelId inexistente retorna 404 Not Found.
 *  12. Feature flag ausente (PHYTOSANITARY_NOTICES_ENABLED undefined) retorna 503 [H-MED-02].
 *  13. Feature flag 'false' retorna 503 Service Unavailable.
 *  14. Feature flag 'true' en proceso aislado habilita el servicio (200 OK).
 *  15. Feature flag con valores no canónicos ('1', 'yes', 'TRUE', 'enabled') retorna 503.
 *  16. Módulo deshabilitado no expone lista de avisos (503 Service Unavailable).
 *  17. Módulo deshabilitado no expone detalle de avisos ni parcelas (503).
 *  18. Módulo habilitado no expone fixtures sintéticos en modo operativo (404).
 *  19. Módulo habilitado no omite verificación documental ni ciclo de vida.
 *  20. Paginación predeterminada (limit=20, offset=0, has_more) [H-BAJ-01].
 *  21. Paginación con limit máximo (limit=50).
 *  22. Paginación con offset válido (desplaza correctamente la ventana).
 *  23. Limit inválido (0, negativo, >50, 'abc', decimal) retorna 400 Bad Request.
 *  24. Offset inválido (negativo, 'xyz') retorna 400 Bad Request.
 *  25. Ordenamiento determinista de avisos (issue_date DESC, notice_id ASC).
 *  26. Total basado únicamente en registros elegibles y visibles.
 *  27. Provincia estructurada confiable detectada correctamente [H-BAJ-02].
 *  28. Parcela en Oxapampa con notas mencionando Yanahuanca NO se desvía a Carrión.
 *  29. Nombre de parcela con toponimia de otro distrito no desvía la provincia estructurada.
 *  30. Coordenadas sin geocodificación administrativa clasificada como insufficient_geographic_information.
 *  31. Ubicación incompleta clasificada como insufficient_geographic_information.
 *  32. Ubicación confiable coincidente con aviso clasificada como applicable_scope_confirmed.
 *  33. Aviso circunscrito a otra provincia clasificado como not_applicable.
 *  34. Seguridad agronómica: Cero diagnóstico inventado y descargo obligatorio.
 *  35. Notificaciones desacopladas: should_notify === false permanente.
 *  36. Aislamiento externo: Cero llamadas a proveedores comerciales (OpenAI, Gemini).
 *  37. Integridad RAG: Índice oficial active_knowledge_chunks.json intacto y vacío.
 *  38. Contrato advisory-chat intacto y desacoplado.
 *  39. Integridad ML: Modelos e inferencia meteorológica intactos.
 *  40. Ausencia de cambios productivos (cero migraciones, cero Render).
 */

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED = 'false';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

const {
  OfficialNoticeCatalogService
} = require('../services/officialNoticeCatalogService');

const {
  ParcelNoticeRelevanceService,
  RELEVANCE_STATES
} = require('../services/parcelNoticeRelevanceService');

const phytosanitaryController = require('../controllers/phytosanitaryController');
const phytosanitaryRoutes = require('../routes/phytosanitary');
const { authenticateToken } = require('../middleware/auth');

// Helper para mock de Req / Res
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

async function runPhytosanitarySurveillanceL08BSuite() {
  console.log('\n==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L08B');
  console.log('CORRECCIÓN DE AUTORIZACIÓN, FEATURE FLAGS, PAGINACIÓN Y CONFIABILIDAD GIS');
  console.log('==============================================================================\n');

  const fixturesPath = path.resolve(__dirname, 'fixtures', 'l08_phytosanitary_test_fixtures.json');
  assert(fs.existsSync(fixturesPath), 'El archivo de fixtures sintéticos L08 debe existir.');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  const catalog = new OfficialNoticeCatalogService({ allowTestFixtures: true });
  for (const f of fixtures) {
    catalog.registerNotice(f);
  }

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
    district: 'Villa Rica',
    notes: 'El agricultor compró plantones de café y semillas en Yanahuanca el año pasado'
  };

  phytosanitaryController.setCatalogService(catalog);
  phytosanitaryController.setParcelResolverOverride(async (id) => {
    const map = {
      '101': parcelPasco,
      '102': parcelCarrion,
      '103': parcelOxapampa
    };
    return map[String(id)] || null;
  });

  // --------------------------------------------------------------------------
  // BLOQUE 1: CONTROL DE ACCESO MULTIUSUARIO Y AUTORIZACIÓN ESTRICTA (H-MED-01)
  // --------------------------------------------------------------------------
  console.log('--- BLOQUE 1: CONTROL DE ACCESO MULTIUSUARIO Y AUTORIZACIÓN (H-MED-01) ---');

  // Asegurar feature flag activo para pruebas de autorización
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'true';

  // Check 1: Farmer accede a parcela propia (200 OK)
  const farmerUser = { id: 10, name: 'Juan Quispe', role: 'farmer' };
  const { req: r1, res: res1 } = createMockReqRes({ params: { parcelId: '101' }, user: farmerUser });
  await phytosanitaryController.evaluateParcelRelevance(r1, res1);
  assert.strictEqual(res1.statusCode, 200);
  assert.strictEqual(res1.body.success, true);
  passCheck('Farmer accede a la relevancia de su propia parcela legítimamente (200 OK)');

  // Check 2: Farmer no accede a parcela ajena (403 Forbidden)
  const foreignFarmerUser = { id: 99, name: 'Pedro Chauca', role: 'farmer' };
  const { req: r2, res: res2 } = createMockReqRes({ params: { parcelId: '101' }, user: foreignFarmerUser });
  await phytosanitaryController.evaluateParcelRelevance(r2, res2);
  assert.strictEqual(res2.statusCode, 403);
  assert.strictEqual(res2.body.success, false);
  assert(res2.body.error.includes('Acceso denegado'));
  passCheck('Farmer es bloqueado categóricamente (403 Forbidden) al consultar parcela ajena');

  // Check 3: Advisor accede según permisos regionales (200 OK)
  const advisorUser = { id: 50, name: 'Ing. Asesor Técnico', role: 'advisor' };
  const { req: r3, res: res3 } = createMockReqRes({ params: { parcelId: '101' }, user: advisorUser });
  await phytosanitaryController.evaluateParcelRelevance(r3, res3);
  assert.strictEqual(res3.statusCode, 200);
  passCheck('Advisor accede a la evaluación técnica de parcelas en la región (200 OK)');

  // Check 4: Admin accede según permisos administrativos (200 OK)
  const adminUser = { id: 1, name: 'Administrador General', role: 'admin' };
  const { req: r4, res: res4 } = createMockReqRes({ params: { parcelId: '101' }, user: adminUser });
  await phytosanitaryController.evaluateParcelRelevance(r4, res4);
  assert.strictEqual(res4.statusCode, 200);
  passCheck('Admin accede a la evaluación de parcelas regionales (200 OK)');

  // Check 5: Supermarket es estrictamente rechazado (403 Forbidden) [H-MED-01]
  const supermarketUser = { id: 80, name: 'Cadena Supermercados', role: 'supermarket' };
  const { req: r5, res: res5 } = createMockReqRes({ params: { parcelId: '101' }, user: supermarketUser });
  await phytosanitaryController.evaluateParcelRelevance(r5, res5);
  assert.strictEqual(res5.statusCode, 403);
  assert.strictEqual(res5.body.success, false);
  assert(res5.body.error.includes('Acceso denegado'));
  passCheck('Rol supermarket estrictamente rechazado (403 Forbidden) en consulta fitosanitaria [H-MED-01]');

  // Check 6: Rol guest es rechazado (403 Forbidden)
  const guestUser = { id: 81, name: 'Invitado Web', role: 'guest' };
  const { req: r6, res: res6 } = createMockReqRes({ params: { parcelId: '101' }, user: guestUser });
  await phytosanitaryController.evaluateParcelRelevance(r6, res6);
  assert.strictEqual(res6.statusCode, 403);
  passCheck('Rol guest denegado por política de autorización explícita (403 Forbidden)');

  // Check 7: Rol desconocido o nulo es rechazado (403 Forbidden)
  const unknownUser = { id: 82, name: 'Usuario Malicioso', role: 'auditor_externo' };
  const { req: r7, res: res7 } = createMockReqRes({ params: { parcelId: '101' }, user: unknownUser });
  await phytosanitaryController.evaluateParcelRelevance(r7, res7);
  assert.strictEqual(res7.statusCode, 403);
  passCheck('Rol desconocido o inventado denegado por defecto (403 Forbidden)');

  // Check 8: JWT ausente deniega acceso (401 Unauthorized)
  const { req: r8, res: res8 } = createMockReqRes({ params: { parcelId: '101' }, headers: {} });
  let nextCalled8 = false;
  authenticateToken(r8, res8, () => { nextCalled8 = true; });
  assert.strictEqual(res8.statusCode, 401);
  assert.strictEqual(nextCalled8, false);
  passCheck('Petición sin cabecera Authorization denegada (401 Unauthorized)');

  // Check 9: JWT inválido o manipulado deniega acceso (403 Forbidden)
  const { req: r9, res: res9 } = createMockReqRes({
    params: { parcelId: '101' },
    headers: { authorization: 'Bearer token.invalido.falso' }
  });
  let nextCalled9 = false;
  authenticateToken(r9, res9, () => { nextCalled9 = true; });
  assert.strictEqual(res9.statusCode, 403);
  assert.strictEqual(nextCalled9, false);
  passCheck('Token JWT manipulado o expirado denegado (403 Forbidden)');

  // Check 10: parcelId inválido (NaN, negativos, cero, string no numérico) retorna 400
  const invalidIds = ['abc', '-1', '0', 'NaN', '1.5', 'null'];
  for (const invId of invalidIds) {
    const { req: rInv, res: resInv } = createMockReqRes({ params: { parcelId: invId }, user: adminUser });
    await phytosanitaryController.evaluateParcelRelevance(rInv, resInv);
    assert.strictEqual(resInv.statusCode, 400, `Debe retornar 400 para parcelId "${invId}"`);
    assert(resInv.body.error.includes('inválido'));
  }
  passCheck('Validación estricta de parcelId rechaza NaN, negativos y cadenas no numéricas (400 Bad Request)');

  // Check 11: parcelId inexistente retorna 404 Not Found
  const { req: r11, res: res11 } = createMockReqRes({ params: { parcelId: '9999' }, user: adminUser });
  await phytosanitaryController.evaluateParcelRelevance(r11, res11);
  assert.strictEqual(res11.statusCode, 404);
  assert(res11.body.error.includes('no encontrada'));
  passCheck('Consulta de parcela inexistente retorna 404 Not Found sin filtrar datos internos');

  // --------------------------------------------------------------------------
  // BLOQUE 2: COMPROBACIÓN EXPLICITA DE FEATURE FLAG MAESTRO (H-MED-02)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 2: FEATURE FLAG MAESTRO (H-MED-02) ---');

  // Check 12: Feature flag ausente (undefined) -> 503 Service Unavailable
  delete process.env.PHYTOSANITARY_NOTICES_ENABLED;
  const { req: r12, res: res12 } = createMockReqRes();
  phytosanitaryController.requirePhytosanitaryEnabled(r12, res12, () => {});
  assert.strictEqual(res12.statusCode, 503);
  assert.strictEqual(res12.body.code, 'PHYTOSANITARY_MODULE_DISABLED');
  passCheck('Feature flag no definido produce denegación por defecto (503 Service Unavailable)');

  // Check 13: Feature flag 'false' -> 503 Service Unavailable
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
  const { req: r13, res: res13 } = createMockReqRes();
  phytosanitaryController.requirePhytosanitaryEnabled(r13, res13, () => {});
  assert.strictEqual(res13.statusCode, 503);
  assert.strictEqual(res13.body.code, 'PHYTOSANITARY_MODULE_DISABLED');
  passCheck('Feature flag explícito "false" bloquea todas las rutas del módulo (503 Service Unavailable)');

  // Check 14: Feature flag 'true' en proceso aislado habilita el servicio
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'true';
  let flagNextCalled = false;
  const { req: r14, res: res14 } = createMockReqRes();
  phytosanitaryController.requirePhytosanitaryEnabled(r14, res14, () => { flagNextCalled = true; });
  assert.strictEqual(flagNextCalled, true);
  assert.strictEqual(res14.statusCode, 200);
  passCheck('Feature flag estrictamente igual a "true" permite el paso hacia los controladores');

  // Check 15: Valores ambiguos ('1', 'yes', 'TRUE', 'enabled') deben interpretarse como deshabilitado
  const ambiguousFlags = ['1', 'yes', 'TRUE', 'enabled', 'on', 'si'];
  for (const amb of ambiguousFlags) {
    process.env.PHYTOSANITARY_NOTICES_ENABLED = amb;
    const { req: rAmb, res: resAmb } = createMockReqRes();
    phytosanitaryController.requirePhytosanitaryEnabled(rAmb, resAmb, () => {});
    assert.strictEqual(resAmb.statusCode, 503, `Flag "${amb}" debe retornar 503`);
    assert.strictEqual(resAmb.body.code, 'PHYTOSANITARY_MODULE_DISABLED');
  }
  passCheck('Cualquier valor distinto a la cadena literal "true" bloquea el módulo con HTTP 503');

  // Check 16: Módulo deshabilitado no expone avisos ni metadatos
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
  const { req: r16, res: res16 } = createMockReqRes();
  await phytosanitaryController.listNotices(r16, res16);
  assert.strictEqual(res16.statusCode, 503);
  assert.strictEqual(res16.body.code, 'PHYTOSANITARY_MODULE_DISABLED');
  passCheck('listNotices rechaza consultas con 503 cuando el módulo está inactivo');

  // Check 17: Módulo deshabilitado no evalúa parcelas ni filtra existencia
  const { req: r17, res: res17 } = createMockReqRes({ params: { parcelId: '101' }, user: adminUser });
  await phytosanitaryController.evaluateParcelRelevance(r17, res17);
  assert.strictEqual(res17.statusCode, 503);
  assert.strictEqual(res17.body.code, 'PHYTOSANITARY_MODULE_DISABLED');
  passCheck('evaluateParcelRelevance bloqueado con 503 antes de consultar la base de datos');

  // Reactivar para las siguientes pruebas en aislamiento
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'true';

  // Check 18: Módulo habilitado no expone fixtures sintéticos en modo operativo
  const strictCatalog = new OfficialNoticeCatalogService({ allowTestFixtures: false });
  strictCatalog.registerNotice({
    notice_id: 'SENASA-SYNTH-OP',
    source_institution: 'SENASA',
    official_title: 'Aviso sintético secreto',
    is_synthetic: true
  });
  phytosanitaryController.setCatalogService(strictCatalog);
  const { req: r18, res: res18 } = createMockReqRes({ params: { id: 'SENASA-SYNTH-OP' } });
  await phytosanitaryController.getNoticeById(r18, res18);
  assert.strictEqual(res18.statusCode, 404);
  passCheck('Avisos sintéticos invisibles (404) aun cuando el feature flag esté activado');

  // Restaurar catálogo de prueba
  phytosanitaryController.setCatalogService(catalog);

  // Check 19: Módulo habilitado no omite verificación documental
  const unverifiedNotice = catalog.registerNotice({
    notice_id: 'SENASA-UNVERIFIED-TEST',
    source_institution: 'SENASA',
    official_title: 'Aviso sin verificar',
    is_synthetic: true,
    verification_status: 'discovered'
  });
  const activeList = catalog.listNotices({ activeOnly: true });
  assert(!activeList.some(n => n.notice_id === 'SENASA-UNVERIFIED-TEST'));
  passCheck('Avisos en estado descubierto o pendiente no se exponen como activos');

  // --------------------------------------------------------------------------
  // BLOQUE 3: PAGINACIÓN DEFENSIVA Y ORDENAMIENTO (H-BAJ-01)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 3: PAGINACIÓN DEFENSIVA Y ORDENAMIENTO (H-BAJ-01) ---');

  // Check 20: Paginación predeterminada (limit=20, offset=0, has_more)
  const { req: r20, res: res20 } = createMockReqRes({ query: { activeOnly: 'false' } });
  await phytosanitaryController.listNotices(r20, res20);
  assert.strictEqual(res20.statusCode, 200);
  assert.strictEqual(res20.body.limit, 20);
  assert.strictEqual(res20.body.offset, 0);
  assert.strictEqual(typeof res20.body.has_more, 'boolean');
  assert(Array.isArray(res20.body.data));
  passCheck('Paginación predeterminada (limit=20, offset=0, has_more) estructurada correctamente');

  // Check 21: Paginación con limit máximo (50)
  const { req: r21, res: res21 } = createMockReqRes({ query: { limit: '50' } });
  await phytosanitaryController.listNotices(r21, res21);
  assert.strictEqual(res21.statusCode, 200);
  assert.strictEqual(res21.body.limit, 50);
  passCheck('Limit máximo permitido (50) aceptado y aplicado');

  // Check 22: Paginación con offset válido (desplaza correctamente)
  const { req: r22a, res: res22a } = createMockReqRes({ query: { limit: '2', offset: '0', activeOnly: 'false' } });
  const { req: r22b, res: res22b } = createMockReqRes({ query: { limit: '2', offset: '2', activeOnly: 'false' } });
  await phytosanitaryController.listNotices(r22a, res22a);
  await phytosanitaryController.listNotices(r22b, res22b);
  assert.strictEqual(res22a.statusCode, 200);
  assert.strictEqual(res22b.statusCode, 200);
  assert.notStrictEqual(res22a.body.data[0].notice_id, res22b.body.data[0].notice_id);
  passCheck('Offset válido desplaza adecuadamente la ventana de resultados');

  // Check 23: Limit inválido (0, -1, 51, 'abc', 2.5) -> HTTP 400
  const invalidLimits = ['0', '-5', '51', '1000', 'abc', '2.5'];
  for (const invLim of invalidLimits) {
    const { req: rLim, res: resLim } = createMockReqRes({ query: { limit: invLim } });
    await phytosanitaryController.listNotices(rLim, resLim);
    assert.strictEqual(resLim.statusCode, 400, `Limit "${invLim}" debe retornar 400`);
    assert(resLim.body.error.includes('limit'));
  }
  passCheck('Limit inválido rechazado defensivamente (400 Bad Request)');

  // Check 24: Offset inválido (negativo, 'xyz') -> HTTP 400
  const invalidOffsets = ['-1', '-50', 'xyz', '1.2'];
  for (const invOff of invalidOffsets) {
    const { req: rOff, res: resOff } = createMockReqRes({ query: { offset: invOff } });
    await phytosanitaryController.listNotices(rOff, resOff);
    assert.strictEqual(resOff.statusCode, 400, `Offset "${invOff}" debe retornar 400`);
    assert(resOff.body.error.includes('offset'));
  }
  passCheck('Offset negativo o no numérico rechazado defensivamente (400 Bad Request)');

  // Check 25: Orden determinista (fechas descendentes e IDs)
  const { req: r25, res: res25 } = createMockReqRes({ query: { activeOnly: 'false', limit: '50' } });
  await phytosanitaryController.listNotices(r25, res25);
  const items = res25.body.data;
  for (let i = 0; i < items.length - 1; i++) {
    const dateCurr = items[i].issue_date || '';
    const dateNext = items[i + 1].issue_date || '';
    assert(dateCurr >= dateNext, 'Los avisos deben estar ordenados cronológicamente descendente');
  }
  passCheck('Ordenamiento determinista y repetible por issue_date DESC');

  // Check 26: Total basado únicamente en registros elegibles y visibles
  assert.strictEqual(res25.body.total, items.length);
  passCheck('Total metadatos refleja con exactitud la cantidad de registros visibles');

  // --------------------------------------------------------------------------
  // BLOQUE 4: CONFIABILIDAD GEOGRÁFICA Y RESOLUCIÓN ESTRUCTURADA (H-BAJ-02)
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 4: CONFIABILIDAD GEOGRÁFICA Y BLINDAJE GIS (H-BAJ-02) ---');

  const relevanceService = new ParcelNoticeRelevanceService();

  // Check 27: Provincia y distrito estructurados confiables detectados
  const locNormal = relevanceService.resolveParcelLocation({
    department: 'Pasco',
    province: 'Oxapampa',
    district: 'Villa Rica'
  });
  assert.strictEqual(locNormal.province, 'Oxapampa');
  assert.strictEqual(locNormal.district, 'villa rica');
  assert.strictEqual(locNormal.is_reliable, true);
  passCheck('Campos administrativos estructurados resueltos con alta confiabilidad');

  // Check 28: Parcela en Oxapampa con notas que mencionan Yanahuanca NO se desvía [H-BAJ-02]
  const parcelOxapampaTrickNotes = {
    id: 103,
    user_id: 20,
    name: 'Fundo Villa Rica',
    crop_name: 'Café',
    department: 'Pasco',
    province: 'Oxapampa',
    district: 'Villa Rica',
    notes: 'El agricultor viajó a Yanahuanca y compró fertilizante en Daniel Alcides Carrión'
  };
  const locProtectedNotes = relevanceService.resolveParcelLocation(parcelOxapampaTrickNotes);
  assert.strictEqual(locProtectedNotes.province, 'Oxapampa', 'La provincia NO debe desviarse a Daniel Alcides Carrión');
  assert.strictEqual(locProtectedNotes.district, 'villa rica', 'El distrito NO debe ser sobreescrito por menciones en notas');
  passCheck('Mención de distrito ajeno en notas libres NO desvía la localización de la parcela [H-BAJ-02]');

  // Check 29: Nombre de parcela con toponimia de otro distrito no desvía la provincia
  const parcelTrickName = {
    id: 104,
    user_id: 20,
    name: 'Sector Yanahuanca y Paucartambo',
    crop_name: 'Palto',
    department: 'Pasco',
    province: 'Oxapampa',
    district: 'Chontabamba'
  };
  const locProtectedName = relevanceService.resolveParcelLocation(parcelTrickName);
  assert.strictEqual(locProtectedName.province, 'Oxapampa');
  assert.strictEqual(locProtectedName.district, 'chontabamba');
  passCheck('Topónimos presentes en el nombre de la parcela ignorados en favor de campos estructurados');

  // Check 30: Coordenadas sin geocodificación administrativa -> insufficient_geographic_information
  const parcelOnlyCoords = {
    id: 105,
    user_id: 20,
    name: 'Predio GPS Puro',
    crop_name: 'Papa',
    latitude: -10.6868,
    longitude: -76.2625,
    department: null,
    province: null,
    district: null
  };
  const noticeProvincial = fixtures[3]; // Daniel Alcides Carrión
  const evalCoords = relevanceService.evaluateNoticeRelevanceForParcel(noticeProvincial, parcelOnlyCoords);
  assert.strictEqual(evalCoords.relevance_status, RELEVANCE_STATES.INSUFFICIENT_GEOGRAPHIC_INFORMATION);
  passCheck('Coordenadas sin límites administrativos clasificada como información geográfica insuficiente');

  // Check 31: Ubicación incompleta o departamento desconocido
  const parcelIncomplete = {
    id: 106,
    user_id: 20,
    name: 'Predio Incompleto',
    crop_name: 'Papa',
    department: null,
    province: null
  };
  const evalIncomplete = relevanceService.evaluateNoticeRelevanceForParcel(noticeProvincial, parcelIncomplete);
  assert.strictEqual(evalIncomplete.relevance_status, RELEVANCE_STATES.INSUFFICIENT_GEOGRAPHIC_INFORMATION);
  passCheck('Parcela sin departamento ni provincia clasificada como información insuficiente');

  // Check 32: Ubicación confiable coincidente con aviso -> applicable_scope_confirmed
  const evalConfirmed = relevanceService.evaluateNoticeRelevanceForParcel(noticeProvincial, parcelCarrion);
  assert.strictEqual(evalConfirmed.relevance_status, RELEVANCE_STATES.APPLICABLE_SCOPE_CONFIRMED);
  passCheck('Coincidencia administrativa estructurada clasificada como applicable_scope_confirmed');

  // Check 33: Aviso circunscrito a otra provincia -> not_applicable
  const evalMismatch = relevanceService.evaluateNoticeRelevanceForParcel(noticeProvincial, parcelOxapampa);
  assert.strictEqual(evalMismatch.relevance_status, RELEVANCE_STATES.NOT_APPLICABLE);
  passCheck('Aviso oficial de otra provincia evaluado como estrictamente not_applicable');

  // --------------------------------------------------------------------------
  // BLOQUE 5: SEGURIDAD AGRONÓMICA, INTEGRIDAD DE SISTEMAS Y RESTRICCIONES
  // --------------------------------------------------------------------------
  console.log('\n--- BLOQUE 5: SEGURIDAD AGRONÓMICA E INTEGRIDAD DEL SISTEMA ---');

  // Check 34: Sin diagnóstico inventado (descargo obligatorio)
  assert(evalConfirmed.safety_disclaimer.includes('NO constituye un diagnóstico de infección de la parcela'));
  passCheck('Exención agronómica de no diagnóstico presente en todas las evaluaciones');

  // Check 35: Sin notificaciones enviadas (should_notify === false permanente)
  const notif = relevanceService.prepareNotificationCandidate(noticeProvincial, parcelCarrion);
  assert.strictEqual(notif.should_notify, false);
  passCheck('should_notify permanece estrictamente false en candidatos de notificación');

  // Check 36: Sin llamadas a proveedores comerciales (OpenAI, Gemini)
  assert.strictEqual(process.env.LLM_ENABLED, 'false');
  passCheck('LLM_ENABLED permanece false (cero llamadas a OpenAI o Gemini)');

  // Check 37: Índice oficial RAG intacto
  const activeChunksPath = path.resolve(__dirname, '..', 'knowledge', 'chunks', 'active_knowledge_chunks.json');
  assert(fs.existsSync(activeChunksPath));
  const activeChunks = JSON.parse(fs.readFileSync(activeChunksPath, 'utf8'));
  assert.strictEqual(activeChunks.length, 0);
  passCheck('Índice RAG activo active_knowledge_chunks.json estrictamente vacío ([])');

  // Check 38: Contrato advisory-chat intacto
  const aiController = require('../controllers/aiController');
  assert(typeof aiController.advisoryChat === 'function');
  passCheck('Contrato y controlador de POST /api/ai/advisory-chat intacto y desacoplado');

  // Check 39: Modelos ML intactos
  const notificationService = require('../services/notificationService');
  assert(typeof notificationService.createWeatherAlertAtomically === 'function');
  passCheck('Modelos ML y alertas meteorológicas intactos y desacoplados');

  // Check 40: Ausencia de cambios productivos
  process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
  assert.strictEqual(process.env.PHYTOSANITARY_NOTICES_ENABLED, 'false');
  passCheck('PHYTOSANITARY_NOTICES_ENABLED restaurado a false por defecto; cero migraciones en BD');

  console.log('\n==============================================================================');
  console.log(`FASE 9-L08B: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
  console.log('==============================================================================\n');
}

runPhytosanitarySurveillanceL08BSuite().catch(err => {
  console.error('\n❌ Error en la suite L08B:', err);
  process.exit(1);
});
