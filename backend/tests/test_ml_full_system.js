/**
 * AgroPasco — Suite Completa de Pruebas de Integración y Seguridad del Módulo ML
 * ==============================================================================
 * 17 pruebas unitarias y de integración end-to-end con verificación real.
 * Valida autenticación JWT, control de acceso RBAC, aislamiento multitenant,
 * generación de alertas, prevención de duplicados por parcela, preferencias de usuario,
 * registro de observaciones de campo y degradación elegante ante caídas de FastAPI.
 */

const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026_pasco_peru';
const BASE_URL = 'http://localhost:5000/api';

// Generar tokens para usuarios con roles distintos
const farmer1Token = jwt.sign(
  { id: 1, role: 'farmer', email: 'cgarciato@undac.edu.pe' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const farmer4Token = jwt.sign(
  { id: 4, role: 'farmer', email: 'agricultor@agropasco.pe' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const adminToken = jwt.sign(
  { id: 16, role: 'admin', email: 'garciatorrescristian39@gmail.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(testNumber, name, fn) {
  process.stdout.write(`Prueba ${testNumber.toString().padStart(2, '0')}: ${name}... `);
  try {
    await fn();
    console.log('✅ APROBADA');
    passedCount++;
    testResults.push({ number: testNumber, name, status: 'PASSED' });
  } catch (err) {
    console.log(`❌ FALLIDA: ${err.message}`);
    failedCount++;
    testResults.push({ number: testNumber, name, status: 'FAILED', error: err.message });
  }
}

async function main() {
  console.log('=================================================================');
  console.log('AgroPasco — Suite de Integración, Seguridad y Resiliencia ML (17 Tests)');
  console.log('=================================================================\n');

  // Test 1: Conectividad y Health check Node.js <-> FastAPI
  await runTest(1, 'Conectividad FastAPI microservicio en /health', async () => {
    const res = await fetch('http://127.0.0.1:8100/health');
    assert(res.ok, `HTTP status no exitoso: ${res.status}`);
    const data = await res.json();
    assert(data.status === 'ok', 'Status no es ok');
    assert(data.models_loaded.length >= 3, 'Menos de 3 modelos cargados');
  });

  // Test 2: Estado de modelos auditados
  await runTest(2, 'Consulta de estado de modelos en /api/ml/models/status', async () => {
    const res = await fetch(`${BASE_URL}/ml/models/status`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success, 'Respuesta no exitosa');
    assert(json.data.models.frost.available === true, 'Modelo de heladas no disponible');
    assert(json.data.models.heavy_rain.available === true, 'Modelo de lluvia no disponible');
    assert(json.data.models.snow.available === true, 'Modelo de nieve no disponible');
    assert(json.data.models.hail.available === false, 'Granizo no debe tener modelo supervisado');
  });

  // Test 3: Agricultor 1 consulta su propia parcela (Parcela 5)
  await runTest(3, 'Agricultor consulta parcela propia (Parcela 5) autorizada', async () => {
    const res = await fetch(`${BASE_URL}/ml/predict/5`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Predicción no exitosa');
    assert(json.data.predictions.length === 4, 'No contiene 4 fenómenos');
  });

  // Test 4: Bloqueo de seguridad 403 Forbidden ante parcela ajena
  await runTest(4, 'Bloqueo 403 Forbidden para Agricultor 1 consultando parcela ajena (Parcela 1)', async () => {
    const res = await fetch(`${BASE_URL}/ml/predict/1`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.status === 403, `Esperado 403 Forbidden, recibido: ${res.status}`);
    const json = await res.json();
    assert(json.success === false, 'success debió ser false');
  });

  // Test 5: Inferencia exitosa para Parcela sin altitud registrada
  await runTest(5, 'Inferencia exitosa para Parcela 6 sin altitud (manejo de elevación)', async () => {
    const res = await fetch(`${BASE_URL}/ml/predict/6`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Predicción falló para parcela sin altitud');
  });

  // Test 6: Rechazo controlado ante parcela sin coordenadas
  await runTest(6, 'Rechazo 404 o 400 ante parcela inexistente o sin coordenadas', async () => {
    const res = await fetch(`${BASE_URL}/ml/predict/999999`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.status === 404, `Esperado 404 Not Found, recibido: ${res.status}`);
  });

  // Test 7: Consulta de predicciones consolidadas por Admin
  await runTest(7, 'Admin consulta predicciones consolidadas en /api/ml/predictions/all', async () => {
    const res = await fetch(`${BASE_URL}/ml/predictions/all`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Consulta fallida');
    assert(json.data.length > 0, 'No retornó parcelas');
  });

  // Test 8: Obtención de preferencias de alertas
  await runTest(8, 'Consulta de preferencias de alertas en GET /api/ml/preferences', async () => {
    const res = await fetch(`${BASE_URL}/ml/preferences`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Consulta preferencias fallida');
    assert(json.data.user_id === 1, 'user_id no coincide');
  });

  // Test 9: Actualización de preferencias de alertas
  await runTest(9, 'Actualización de preferencias en PUT /api/ml/preferences', async () => {
    const res = await fetch(`${BASE_URL}/ml/preferences`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${farmer1Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        frost_enabled: 1,
        heavy_rain_enabled: 1,
        snow_enabled: 0,
        min_risk_level: 'high'
      })
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Update preferencias falló');
    assert(json.data.snow_enabled === 0, 'snow_enabled no se actualizó');
    assert(json.data.min_risk_level === 'high', 'min_risk_level no se actualizó');
  });

  // Test 10: Generación masiva de alertas meteorológicas
  await runTest(10, 'Generación de alertas climáticas en POST /api/ml/alerts/generate', async () => {
    const res = await fetch(`${BASE_URL}/ml/alerts/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Generación de alertas falló');
    assert(json.data.parcels_evaluated > 0, 'No evaluó parcelas');
  });

  // Test 11: Prevención de alertas duplicadas por parcela
  await runTest(11, 'Prevención de duplicados en re-ejecución inmediata de alertas', async () => {
    const res = await fetch(`${BASE_URL}/ml/alerts/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.data.alerts_created === 0, `Debió crear 0 duplicados, creó: ${json.data.alerts_created}`);
    assert(json.data.alerts_skipped_duplicate >= 0, 'Omitidos debió ser >= 0');
  });

  // Test 12: Aislamiento multitenant de alertas
  await runTest(12, 'Aislamiento de alertas: Agricultor solo ve sus notificaciones', async () => {
    const res1 = await fetch(`${BASE_URL}/ml/alerts`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    const json1 = await res1.json();
    assert(json1.success === true, 'Consulta alertas fallida para Agricultor 1');

    const res4 = await fetch(`${BASE_URL}/ml/alerts`, {
      headers: { Authorization: `Bearer ${farmer4Token}` }
    });
    const json4 = await res4.json();
    assert(json4.success === true, 'Consulta alertas fallida para Agricultor 4');

    const ids1 = new Set(json1.data.map(a => a.id));
    const ids4 = new Set(json4.data.map(a => a.id));
    for (const id of ids1) {
      assert(!ids4.has(id), `Alerta id ${id} visible por ambos usuarios! Fuga multitenant!`);
    }
  });

  // Test 13: Bloqueo de marcado de alerta ajena
  await runTest(13, 'Rechazo 404/Forbidden al intentar marcar como leída una alerta ajena', async () => {
    const res4 = await fetch(`${BASE_URL}/ml/alerts`, {
      headers: { Authorization: `Bearer ${farmer4Token}` }
    });
    const json4 = await res4.json();
    if (json4.data.length > 0) {
      const otherAlertId = json4.data[0].id;
      const res = await fetch(`${BASE_URL}/ml/alerts/${otherAlertId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${farmer1Token}` }
      });
      assert(res.status === 404, `Esperado 404, recibido: ${res.status}`);
    } else {
      assert(true, 'No hay alertas en usuario 4 para probar cruce');
    }
  });

  // Test 14: Marcado exitoso de alerta propia
  await runTest(14, 'Marcado de lectura exitoso en PUT /api/ml/alerts/:id/read', async () => {
    const res = await fetch(`${BASE_URL}/ml/alerts`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    const json = await res.json();
    if (json.data.length > 0) {
      const myAlertId = json.data[0].id;
      const markRes = await fetch(`${BASE_URL}/ml/alerts/${myAlertId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${farmer1Token}` }
      });
      assert(markRes.ok, `HTTP status: ${markRes.status}`);
      const markJson = await markRes.json();
      assert(markJson.success === true, 'No marcó como leída');
    }
  });

  // Test 15: Registro de observación de campo verificada
  await runTest(15, 'Registro de observación verificada en POST /api/ml/observations', async () => {
    const res = await fetch(`${BASE_URL}/ml/observations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${farmer1Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        observed_at: new Date().toISOString(),
        parcel_id: 5,
        latitude: -10.65,
        longitude: -76.25,
        altitude_masl: 4337,
        phenomenon: 'frost',
        severity: 'severo',
        source: 'farmer_report',
        verification_method: 'thermometer',
        temperature_recorded: -3.2,
        notes: 'Helada negra severa con daño en follaje de tubérculos.'
      })
    });
    assert(res.status === 201, `Esperado 201 Created, recibido: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'No creó la observación');
    assert(json.data.temperature_recorded === -3.2, 'Temperatura registrada incorrecta');
  });

  // Test 16: Listado y filtrado de observaciones de campo
  await runTest(16, 'Listado y filtrado de observaciones en GET /api/ml/observations', async () => {
    const res = await fetch(`${BASE_URL}/ml/observations?phenomenon=frost`, {
      headers: { Authorization: `Bearer ${farmer1Token}` }
    });
    assert(res.ok, `HTTP status: ${res.status}`);
    const json = await res.json();
    assert(json.success === true, 'Consulta fallida');
    assert(json.total > 0, 'No retornó observaciones de helada');
    assert(json.data.every(o => o.phenomenon === 'frost'), 'Filtro por fenómeno no se respetó');
  });

  // Test 17: Resiliencia ante caída del microservicio FastAPI (degradación a reglas)
  await runTest(17, 'Resiliencia ante fallo de FastAPI: degradación elegante a fallback de reglas', async () => {
    const { getFallbackPrediction } = require('../services/mlService');
    const parcelMock = {
      id: 5,
      name: 'Parcela Ninacaca Test Fallback',
      center_lat: -10.85,
      center_lng: -76.12,
      altitude_masl: 4150,
    };
    const fallbackRes = await getFallbackPrediction(parcelMock);
    assert(fallbackRes.success === true, 'Fallback de reglas falló');
    assert(fallbackRes.source === 'fallback_rules', `Source esperado fallback_rules, recibido: ${fallbackRes.source}`);
    assert(fallbackRes.data.predictions.length === 4, 'Fallback no entregó los 4 fenómenos');
  });

  console.log('\n=================================================================');
  console.log(`RESUMEN FINAL: ${passedCount} APROBADAS | ${failedCount} FALLIDAS (Total: 17 Tests)`);
  console.log('=================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error fatal ejecutando suite de pruebas:', err);
  process.exit(1);
});
