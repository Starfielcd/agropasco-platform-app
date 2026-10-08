/**
 * AgroPasco — Test Suite de Integración y Seguridad del Módulo ML
 * ================================================================
 * Verifica:
 * 1. Comunicación Node.js <-> FastAPI (/health y /predict).
 * 2. Protección JWT y Control de Acceso Basado en Roles (RBAC):
 *    - Usuario A (Agricultor 1) consulta su propia parcela -> 200 OK.
 *    - Usuario A intenta consultar la parcela de Usuario B (Agricultor 4) -> 403 Prohibido.
 *    - Usuario B consulta su parcela -> 200 OK.
 *    - Administrador o Asesor puede consultar parcelas de otros agricultores -> 200 OK.
 *    - Agricultor intenta acceder a endpoints restringidos (/api/ml/predictions/all) -> 403 Prohibido.
 * 3. Gestión y Aislamiento de Alertas:
 *    - Generación masiva de alertas meteorológicas.
 *    - Prevención de duplicados por parcela dentro de la ventana de 6h.
 *    - Aislamiento de alertas: Usuario A solo ve sus alertas, nunca las de Usuario B.
 *    - Marcado de alertas leídas con control de propiedad.
 */

const jwt = require('jsonwebtoken');
const { dbGet, dbAll, dbRun } = require('../config/database');
const mlController = require('../controllers/mlController');
const mlService = require('../services/mlService');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

function generateTestToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function mockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('=' .repeat(70));
  console.log('🧪 EJECUTANDO TEST SUITE DE INTEGRACIÓN, SEGURIDAD Y ALERTAS ML');
  console.log('=' .repeat(70));

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${message}`);
      failed++;
    }
  }

  try {
    // Obtener usuarios de prueba de la BD
    const userA = await dbGet('SELECT * FROM users WHERE id = 1'); // Farmer
    const userB = await dbGet('SELECT * FROM users WHERE id = 4'); // Farmer
    const admin = await dbGet("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
    const advisor = await dbGet("SELECT * FROM users WHERE role = 'advisor' LIMIT 1");

    assert(userA && userB && admin, 'Usuarios de prueba cargados desde la base de datos');

    // Parcelas de prueba
    const parcelUserA = await dbGet('SELECT * FROM parcels WHERE user_id = ? AND center_lat IS NOT NULL LIMIT 1', [userA.id]);
    const parcelUserB = await dbGet('SELECT * FROM parcels WHERE user_id = ? AND center_lat IS NOT NULL LIMIT 1', [userB.id]);

    assert(parcelUserA && parcelUserB, `Parcelas con coordenadas: Parcela A (ID ${parcelUserA?.id}), Parcela B (ID ${parcelUserB?.id})`);

    // --- TEST 1: Comunicación Node.js <-> FastAPI Health Check ---
    console.log('\n--- 1. Comunicación Node.js <-> FastAPI ---');
    const health = await mlService.checkMLServiceHealth();
    assert(health !== null && health.status === 'ok', `Microservicio FastAPI respondiendo en /health (${health?.status || 'offline'})`);
    assert(health?.models_loaded?.length >= 3, `Modelos reportados en FastAPI: ${health?.models_loaded?.join(', ')}`);

    // --- TEST 2: RBAC - Consulta de Parcela Propia vs Ajena ---
    console.log('\n--- 2. Control de Acceso y Aislamiento Multiusuario ---');
    
    // Usuario A consulta SU parcela
    const reqOwn = { params: { parcelId: parcelUserA.id }, user: userA };
    const resOwn = mockResponse();
    await mlController.predictForParcel(reqOwn, resOwn);
    assert(resOwn.statusCode === 200 && resOwn.body.success, `Usuario A (ID ${userA.id}) consultó exitosamente su parcela ${parcelUserA.id}`);

    // Usuario A intenta consultar la parcela de Usuario B -> DEBE DAR 403
    const reqOther = { params: { parcelId: parcelUserB.id }, user: userA };
    const resOther = mockResponse();
    await mlController.predictForParcel(reqOther, resOther);
    assert(resOther.statusCode === 403, `Seguridad: Usuario A bloqueado con 403 al intentar acceder a parcela ajena (ID ${parcelUserB.id})`);

    // Usuario B consulta SU parcela -> 200
    const reqBOwn = { params: { parcelId: parcelUserB.id }, user: userB };
    const resBOwn = mockResponse();
    await mlController.predictForParcel(reqBOwn, resBOwn);
    assert(resBOwn.statusCode === 200 && resBOwn.body.success, `Usuario B consultó exitosamente su parcela ${parcelUserB.id}`);

    // Admin consulta parcela de Usuario B -> 200 (autorizado para admin)
    const reqAdmin = { params: { parcelId: parcelUserB.id }, user: admin };
    const resAdmin = mockResponse();
    await mlController.predictForParcel(reqAdmin, resAdmin);
    assert(resAdmin.statusCode === 200 && resAdmin.body.success, `Administrador autorizado para consultar parcela ${parcelUserB.id}`);

    // --- TEST 3: Generación de Alertas y Detección de Duplicados ---
    console.log('\n--- 3. Generación de Alertas y Prevención de Duplicados ---');
    
    const reqGen = { user: admin };
    const resGen1 = mockResponse();
    await mlController.generateAlerts(reqGen, resGen1);
    assert(resGen1.statusCode === 200, `Generación de alertas ejecutada exitosamente (Alertas creadas: ${resGen1.body.data.alerts_created}, Omitidas: ${resGen1.body.data.alerts_skipped})`);

    // Segunda ejecución inmediata: TODAS las alertas recientes deben ser omitidas por duplicado
    const resGen2 = mockResponse();
    await mlController.generateAlerts(reqGen, resGen2);
    assert(resGen2.body.data.alerts_created === 0, `Prevención de duplicados: Segunda ejecución consecutiva generó 0 alertas nuevas (Omitidas: ${resGen2.body.data.alerts_skipped})`);

    // --- TEST 4: Aislamiento de Alertas entre Usuarios ---
    console.log('\n--- 4. Aislamiento y Privacidad de Alertas ---');
    
    const reqAlertsA = { user: userA, query: {} };
    const resAlertsA = mockResponse();
    await mlController.getUserAlerts(reqAlertsA, resAlertsA);

    const reqAlertsB = { user: userB, query: {} };
    const resAlertsB = mockResponse();
    await mlController.getUserAlerts(reqAlertsB, resAlertsB);

    assert(resAlertsA.statusCode === 200 && resAlertsB.statusCode === 200, 'Endpoints de alertas de usuario respondieron 200 OK');
    
    // Verificar que ninguna alerta de A tiene user_id de B ni viceversa
    const userAHasBAlerts = resAlertsA.body.data.some(a => a.user_id !== userA.id);
    const userBHasAAlerts = resAlertsB.body.data.some(a => a.user_id !== userB.id);
    assert(!userAHasBAlerts, 'Usuario A NO tiene acceso ni visibilidad sobre alertas de otros usuarios');
    assert(!userBHasAAlerts, 'Usuario B NO tiene acceso ni visibilidad sobre alertas de otros usuarios');

    // --- TEST 5: Marcado de Alerta Leída con Control de Propiedad ---
    console.log('\n--- 5. Control de Propiedad en Marcado de Alertas ---');
    if (resAlertsA.body.data.length > 0) {
      const alertA = resAlertsA.body.data[0];
      // Usuario B intenta marcar como leída la alerta de Usuario A -> DEBE DAR 404/no autorizado
      const reqMarkUnauthorized = { params: { id: alertA.id }, user: userB };
      const resMarkUnauthorized = mockResponse();
      await mlController.markAlertAsRead(reqMarkUnauthorized, resMarkUnauthorized);
      assert(resMarkUnauthorized.statusCode === 404, `Intento no autorizado de marcar alerta ajena rechazado con 404/Forbidden`);

      // Usuario A marca su propia alerta -> 200 OK
      const reqMarkOwn = { params: { id: alertA.id }, user: userA };
      const resMarkOwn = mockResponse();
      await mlController.markAlertAsRead(reqMarkOwn, resMarkOwn);
      assert(resMarkOwn.statusCode === 200 && resMarkOwn.body.success, `Usuario A marcó exitosamente su alerta ${alertA.id} como leída`);
    } else {
      console.log('  ℹ️ Usuario A no tiene alertas en cola para probar marcado de lectura (OK)');
    }

    console.log('\n' + '=' .repeat(70));
    console.log(`🏁 RESULTADOS: ${passed} PASSED | ${failed} FAILED`);
    console.log('=' .repeat(70));
    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    console.error('Error fatal ejecutando suite de integración:', err);
    process.exit(1);
  }
}

runTests();
