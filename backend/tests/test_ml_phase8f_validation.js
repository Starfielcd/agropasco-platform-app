/**
 * AgroPasco — Test Suite de Validación de Correcciones ML (FASE 8F)
 * ===================================================================
 * Verifica de forma aislada y determinista:
 *  1. Métricas exactas auditadas de los tres modelos (vs metadata.json).
 *  2. Rechazo de entradas de caché sin propiedad model_version (cache miss).
 *  3. Rechazo de entradas de caché con versiones antiguas (cache miss).
 *  4. Aceptación de caché con versión vigente '2.0.0_native' (cache hit).
 *  5. TTL diferenciado de fallback (expira a los 5 minutos).
 *  6. TTL de inferencia ML nativa (válido hasta 60 minutos).
 *  7. Protección estricta contra escrituras SQL cuando NODE_ENV === 'test'.
 *  8. Preservación del contrato JSON esperado por frontend (ml-monitor.js).
 *  9. Conservación de autenticación y permisos RBAC.
 * 10. Conservación del mecanismo de fallback meteorológico.
 * 11. Integridad estructural de los modelos JSON exportados.
 * 12. Ausencia de regresiones.
 */

// Forzar entorno de prueba antes de cualquier importación
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Módulos bajo prueba
const mlService = require('../services/mlService');
const { defaultEngine, MLEngine } = require('../services/mlEngine');
const database = require('../config/database');

let passedTests = 0;
let failedTests = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('='.repeat(75));
  console.log('🧪 AGROPASCO — FASE 8F: VALIDACIÓN DE CORRECCIONES ML');
  console.log('='.repeat(75));

  // -------------------------------------------------------------------------
  // 1. VERIFICACIÓN DE MÉTRICAS ORIGINALES AUDITADAS
  // -------------------------------------------------------------------------
  console.log('\n--- 1. VERIFICACIÓN DE MÉTRICAS AUDITADAS (VS METADATA.JSON) ---');

  await itAsync('Las métricas de getModelsStatus coinciden exactamente con metadata.json', async () => {
    const frostMetaPath = path.resolve(__dirname, '../data/weather-history/models/frost/metadata.json');
    const rainMetaPath = path.resolve(__dirname, '../data/weather-history/models/heavy_rain/metadata.json');
    const snowMetaPath = path.resolve(__dirname, '../data/weather-history/models/snow/metadata.json');

    const frostMeta = JSON.parse(fs.readFileSync(frostMetaPath, 'utf8'));
    const rainMeta = JSON.parse(fs.readFileSync(rainMetaPath, 'utf8'));
    const snowMeta = JSON.parse(fs.readFileSync(snowMetaPath, 'utf8'));

    const status = await mlService.getModelsStatus();
    assert(status !== null, 'getModelsStatus no debe ser nulo');

    // HELADAS (Gradient Boosting)
    assert.strictEqual(status.frost.test_metrics.f1, frostMeta.test_metrics.f1);
    assert.strictEqual(status.frost.test_metrics.precision, frostMeta.test_metrics.precision);
    assert.strictEqual(status.frost.test_metrics.recall, frostMeta.test_metrics.recall);
    assert.strictEqual(status.frost.test_metrics.pr_auc, frostMeta.test_metrics.pr_auc);
    assert.strictEqual(status.frost.test_metrics.expected_calibration_error, frostMeta.test_metrics.expected_calibration_error);
    assert.strictEqual(status.frost.test_metrics.f1, 0.8997);
    assert.strictEqual(status.frost.test_metrics.precision, 0.8674);
    assert.strictEqual(status.frost.test_metrics.recall, 0.9345);

    // LLUVIAS INTENSAS (Random Forest)
    assert.strictEqual(status.heavy_rain.test_metrics.f1, rainMeta.test_metrics.f1);
    assert.strictEqual(status.heavy_rain.test_metrics.precision, rainMeta.test_metrics.precision);
    assert.strictEqual(status.heavy_rain.test_metrics.recall, rainMeta.test_metrics.recall);
    assert.strictEqual(status.heavy_rain.test_metrics.pr_auc, rainMeta.test_metrics.pr_auc);
    assert.strictEqual(status.heavy_rain.test_metrics.expected_calibration_error, rainMeta.test_metrics.expected_calibration_error);
    assert.strictEqual(status.heavy_rain.test_metrics.f1, 0.59);
    assert.strictEqual(status.heavy_rain.test_metrics.precision, 0.4646);
    assert.strictEqual(status.heavy_rain.test_metrics.recall, 0.8082);

    // NEVADAS (Logistic Regression)
    assert.strictEqual(status.snow.test_metrics.f1, snowMeta.test_metrics.f1);
    assert.strictEqual(status.snow.test_metrics.precision, snowMeta.test_metrics.precision);
    assert.strictEqual(status.snow.test_metrics.recall, snowMeta.test_metrics.recall);
    assert.strictEqual(status.snow.test_metrics.pr_auc, snowMeta.test_metrics.pr_auc);
    assert.strictEqual(status.snow.test_metrics.expected_calibration_error, snowMeta.test_metrics.expected_calibration_error);
    assert.strictEqual(status.snow.test_metrics.f1, 0.7575);
    assert.strictEqual(status.snow.test_metrics.precision, 0.7904);
    assert.strictEqual(status.snow.test_metrics.recall, 0.7273);

    // GRANIZO (Reglas físicas)
    assert.strictEqual(status.hail.available, false);
    assert.strictEqual(status.hail.fallback, 'rule_based');
  });

  it('No contiene las métricas tentativas inválidas de la FASE 8D (ej. f1 0.9022 para lluvia)', () => {
    // Verificar que los valores erróneos de 8D fueron purgados
    assert.notStrictEqual(mlService.getModelsStatus.toString().includes('0.9022'), true);
    assert.notStrictEqual(mlService.getModelsStatus.toString().includes('0.8124'), true);
  });

  // -------------------------------------------------------------------------
  // 2. VERSIONADO DE CACHÉ (PASO 3)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. VERSIONADO DE CACHÉ Y DETECCIÓN DE ENTRADAS OBSOLETAS ---');

  await itAsync('Rechaza entradas de caché sin propiedad model_version (trata como cache miss)', async () => {
    // Interceptar dbGet temporalmente para simular entrada de caché sin versión
    const originalDbGet = database.dbGet;
    database.dbGet = async () => ({
      location: 'parcel_1',
      data_type: 'ml_prediction',
      data_json: JSON.stringify({
        parcel_id: 1,
        predictions: [{ phenomenon: 'frost', risk_score: 80 }]
        // Sin model_version
      }),
      fetched_at: new Date().toISOString()
    });

    try {
      const cached = await mlService.getCachedPrediction(1);
      assert.strictEqual(cached, null, 'Entrada sin model_version debe retornar null (cache miss)');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  await itAsync('Rechaza entradas de caché con versiones anteriores o incompatibles (ej. 1.0.0)', async () => {
    const originalDbGet = database.dbGet;
    database.dbGet = async () => ({
      location: 'parcel_1',
      data_type: 'ml_prediction',
      data_json: JSON.stringify({
        parcel_id: 1,
        model_version: '1.0.0_legacy',
        predictions: [{ phenomenon: 'frost', risk_score: 80 }]
      }),
      fetched_at: new Date().toISOString()
    });

    try {
      const cached = await mlService.getCachedPrediction(1);
      assert.strictEqual(cached, null, 'Versión antigua 1.0.0 debe ser rechazada');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  await itAsync('Acepta entradas de caché con la versión vigente 2.0.0_native', async () => {
    const originalDbGet = database.dbGet;
    const testPayload = {
      parcel_id: 1,
      model_version: '2.0.0_native',
      prediction_source: 'ml_trained',
      predictions: [{ phenomenon: 'frost', risk_score: 45 }]
    };

    database.dbGet = async () => ({
      location: 'parcel_1',
      data_type: 'ml_prediction',
      data_json: JSON.stringify(testPayload),
      fetched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 minutos de antigüedad
    });

    try {
      const cached = await mlService.getCachedPrediction(1);
      assert(cached !== null, 'Entrada con versión 2.0.0_native debe ser aceptada');
      assert.strictEqual(cached.model_version, '2.0.0_native');
      assert.strictEqual(cached.prediction_source, 'ml_trained');
      assert.strictEqual(cached.predictions[0].risk_score, 45);
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  // -------------------------------------------------------------------------
  // 3. TTL DIFERENCIADO (PASO 4)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. TTL DIFERENCIADO: ML (60 MINUTOS) VS REGLAS (5 MINUTOS) ---');

  await itAsync('Caché de fallback de reglas (2.0.0_fallback_rules) es válido con 4 minutos de antigüedad', async () => {
    const originalDbGet = database.dbGet;
    const rulePayload = {
      parcel_id: 2,
      model_version: '2.0.0_fallback_rules',
      prediction_source: 'fallback_rules',
      predictions: [{ phenomenon: 'frost', risk_score: 25 }]
    };

    database.dbGet = async () => ({
      location: 'parcel_2',
      data_type: 'ml_prediction',
      data_json: JSON.stringify(rulePayload),
      fetched_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() // 4 minutos (< 5 min)
    });

    try {
      const cached = await mlService.getCachedPrediction(2);
      assert(cached !== null, 'Reglas con 4 minutos de antigüedad deben ser aceptadas');
      assert.strictEqual(cached.prediction_source, 'fallback_rules');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  await itAsync('Caché de fallback de reglas expira a los 6 minutos (supera límite de 5 minutos)', async () => {
    const originalDbGet = database.dbGet;
    const rulePayload = {
      parcel_id: 2,
      model_version: '2.0.0_fallback_rules',
      prediction_source: 'fallback_rules',
      predictions: [{ phenomenon: 'frost', risk_score: 25 }]
    };

    database.dbGet = async () => ({
      location: 'parcel_2',
      data_type: 'ml_prediction',
      data_json: JSON.stringify(rulePayload),
      fetched_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() // 6 minutos (> 5 min)
    });

    try {
      const cached = await mlService.getCachedPrediction(2);
      assert.strictEqual(cached, null, 'Reglas con 6 minutos de antigüedad deben expirar (retornar null)');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  await itAsync('Caché de inferencia ML nativa es válido con 50 minutos de antigüedad', async () => {
    const originalDbGet = database.dbGet;
    const mlPayload = {
      parcel_id: 3,
      model_version: '2.0.0_native',
      prediction_source: 'ml_trained',
      predictions: [{ phenomenon: 'heavy_rain', risk_score: 70 }]
    };

    database.dbGet = async () => ({
      location: 'parcel_3',
      data_type: 'ml_prediction',
      data_json: JSON.stringify(mlPayload),
      fetched_at: new Date(Date.now() - 50 * 60 * 1000).toISOString() // 50 minutos (< 60 min)
    });

    try {
      const cached = await mlService.getCachedPrediction(3);
      assert(cached !== null, 'Inferencia ML con 50 minutos de antigüedad debe ser válida');
      assert.strictEqual(cached.prediction_source, 'ml_trained');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  await itAsync('Caché de inferencia ML nativa expira a los 65 minutos (supera límite de 60 minutos)', async () => {
    const originalDbGet = database.dbGet;
    const mlPayload = {
      parcel_id: 3,
      model_version: '2.0.0_native',
      prediction_source: 'ml_trained',
      predictions: [{ phenomenon: 'heavy_rain', risk_score: 70 }]
    };

    database.dbGet = async () => ({
      location: 'parcel_3',
      data_type: 'ml_prediction',
      data_json: JSON.stringify(mlPayload),
      fetched_at: new Date(Date.now() - 65 * 60 * 1000).toISOString() // 65 minutos (> 60 min)
    });

    try {
      const cached = await mlService.getCachedPrediction(3);
      assert.strictEqual(cached, null, 'Inferencia ML con 65 minutos debe expirar');
    } finally {
      database.dbGet = originalDbGet;
    }
  });

  // -------------------------------------------------------------------------
  // 4. PROTECCIÓN DE PRUEBAS CONTRA ESCRITURAS SQL (PASO 5)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. PROTECCIÓN ESTRICTA DE PRUEBAS CONTRA ESCRITURAS SQL ---');

  await itAsync('cachePrediction NO ejecuta dbRun cuando NODE_ENV === test', async () => {
    let dbRunWasCalled = false;
    const originalDbRun = database.dbRun;
    database.dbRun = async () => {
      dbRunWasCalled = true;
    };

    try {
      assert.strictEqual(process.env.NODE_ENV, 'test');
      await mlService.cachePrediction(999, { dummy: 'test' });
      assert.strictEqual(dbRunWasCalled, false, 'dbRun no debió ser llamado en entorno test');
    } finally {
      database.dbRun = originalDbRun;
    }
  });

  // -------------------------------------------------------------------------
  // 5. PRESERVACIÓN DEL CONTRATO JSON DEL FRONTEND
  // -------------------------------------------------------------------------
  console.log('\n--- 5. CONTRATO JSON Y TRANSPARENCIA CON FRONTEND (ml-monitor.js) ---');

  await itAsync('El resultado de inferencia nativa incluye model_version y prediction_source', async () => {
    const mockParcel = {
      id: 10,
      name: 'Parcela Modelo 10',
      center_lat: -10.68,
      center_lng: -76.25,
      altitude_masl: 4337
    };

    // Mock fetch para devolver pronóstico meteorológico completo
    const originalFetch = global.fetch;
    const mockDaily = {
      time: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
      temperature_2m_max: [12.0, 11.5, 13.0, 12.5, 11.0, 13.5, 12.0, 12.5, 11.5, 12.0],
      temperature_2m_min: [-3.0, -2.5, -4.0, -1.0, -3.5, -2.0, -3.0, -2.5, -3.0, -1.5],
      temperature_2m_mean: [4.5, 4.0, 5.0, 5.5, 4.0, 5.5, 4.5, 5.0, 4.5, 5.2],
      precipitation_sum: [0.0, 1.2, 0.0, 0.0, 2.5, 0.0, 0.5, 0.0, 0.0, 1.0],
      rain_sum: [0.0, 1.2, 0.0, 0.0, 2.5, 0.0, 0.5, 0.0, 0.0, 1.0],
      wind_speed_10m_max: [14.0, 12.0, 16.0, 10.0, 15.0, 11.0, 13.0, 14.0, 12.0, 15.0],
      et0_fao_evapotranspiration: [2.5, 2.3, 2.6, 2.4, 2.2, 2.7, 2.5, 2.6, 2.4, 2.5]
    };
    const mockHourly = {
      time: Array.from({ length: 240 }, (_, i) => `2026-10-${String(Math.floor(i / 24) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`),
      temperature_2m: Array(240).fill(4.5),
      relative_humidity_2m: Array(240).fill(65.0),
      precipitation: Array(240).fill(0.1),
      soil_moisture_0_to_7cm: Array(240).fill(0.28)
    };

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        elevation: 4337,
        daily: mockDaily,
        hourly: mockHourly
      })
    });

    try {
      const predRes = await mlService.getPredictionForParcel(mockParcel);
      assert.strictEqual(predRes.success, true);
      assert.strictEqual(predRes.source, 'ml_service');
      const data = predRes.data;

      // Verificación de versionado y TTL en el objeto resultado
      assert.strictEqual(data.model_version, '2.0.0_native');
      assert.strictEqual(data.prediction_source, 'ml_trained');
      assert.strictEqual(data.cache_ttl_ms, 60 * 60 * 1000);
      assert(typeof data.cache_expires_at === 'string');

      // Verificación de los 4 fenómenos para el frontend
      assert(Array.isArray(data.predictions));
      assert.strictEqual(data.predictions.length, 4);

      const frost = data.predictions.find(p => p.phenomenon === 'frost');
      const rain = data.predictions.find(p => p.phenomenon === 'heavy_rain');
      const snow = data.predictions.find(p => p.phenomenon === 'snow');
      const hail = data.predictions.find(p => p.phenomenon === 'hail');

      assert(frost && rain && snow && hail, 'Deben existir los 4 fenómenos');
      assert.strictEqual(frost.model_type, 'ml_trained');
      assert.strictEqual(rain.model_type, 'ml_trained');
      assert.strictEqual(snow.model_type, 'ml_trained');
      assert.strictEqual(hail.model_type, 'rule_based');

      // Comprobar notas de transparencia
      assert(frost.confidence_note.includes('ERA5'));
      assert(hail.confidence_note.includes('reglas'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await itAsync('El resultado de fallback de reglas incluye versionado diferenciado y TTL de 5m', async () => {
    const mockParcel = {
      id: 11,
      name: 'Parcela Fallback 11',
      center_lat: -10.68,
      center_lng: -76.25,
      altitude_masl: 4337
    };

    const originalFetch = global.fetch;
    // Payload simplificado sin 7 días de historial para forzar fallback de reglas
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        elevation: 4337,
        daily: {
          time: ['2026-10-11', '2026-10-12', '2026-10-13'],
          temperature_2m_max: [14.0, 13.0, 15.0],
          temperature_2m_min: [-4.0, -1.0, 1.0],
          precipitation_sum: [25.0, 5.0, 0.0],
          wind_speed_10m_max: [12.0, 10.0, 8.0]
        },
        hourly: {
          temperature_2m: [0.0],
          relative_humidity_2m: [70.0],
          precipitation: [0.0]
        }
      })
    });

    try {
      const predRes = await mlService.getPredictionForParcel(mockParcel);
      assert.strictEqual(predRes.success, true);
      assert.strictEqual(predRes.source, 'fallback_rules');
      const data = predRes.data;

      assert.strictEqual(data.model_version, '2.0.0_fallback_rules');
      assert.strictEqual(data.prediction_source, 'fallback_rules');
      assert.strictEqual(data.cache_ttl_ms, 5 * 60 * 1000);
      assert(data.data_source.includes('Reglas AgroPasco'));

      for (const p of data.predictions) {
        assert.strictEqual(p.model_type, 'rule_based');
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 6. CONSERVACIÓN DE AUTENTICACIÓN Y AUTORIZACIÓN POR ROLES (RBAC)
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // 6. CONSERVACIÓN DE AUTENTICACIÓN Y AUTORIZACIÓN POR ROLES (RBAC)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. AUTORIZACIÓN Y CONTROL DE ACCESO POR ROLES (RBAC) ---');

  function createMockRes() {
    return {
      statusCode: 200,
      data: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.data = payload;
        return this;
      }
    };
  }

  function getIsolatedMLController(mockGet) {
    database.dbGet = mockGet;
    delete require.cache[require.resolve('../controllers/mlController')];
    return require('../controllers/mlController');
  }

  await itAsync('RBAC: Agricultor no propietario es bloqueado con HTTP 403', async () => {
    const originalDbGet = database.dbGet;
    try {
      const mlCtrl = getIsolatedMLController(async (sql) => {
        if (sql.includes('FROM parcels')) {
          return { id: 201, user_id: 2, center_lat: -10.68, center_lng: -76.25, altitude_masl: 4337 };
        }
        return null;
      });

      const req = {
        params: { parcelId: '201' },
        user: { id: 1, role: 'farmer', username: 'juan_perez' } // ID 1 != 2
      };
      const res = createMockRes();

      await mlCtrl.predictForParcel(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.data.success, false);
      assert(res.data.error.includes('No tienes permiso'));
    } finally {
      database.dbGet = originalDbGet;
      delete require.cache[require.resolve('../controllers/mlController')];
    }
  });

  await itAsync('RBAC: Asesor y Admin pueden consultar parcelas de cualquier agricultor', async () => {
    const originalDbGet = database.dbGet;
    const originalFetch = global.fetch;

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        elevation: 4337,
        daily: {
          time: ['2026-10-11', '2026-10-12', '2026-10-13'],
          temperature_2m_max: [12.0, 11.0, 13.0],
          temperature_2m_min: [-2.0, -1.0, 0.0],
          precipitation_sum: [1.0, 0.0, 2.0],
          wind_speed_10m_max: [10.0, 8.0, 12.0]
        },
        hourly: {
          temperature_2m: [2.0],
          relative_humidity_2m: [65.0],
          precipitation: [0.0]
        }
      })
    });

    try {
      const mlCtrl = getIsolatedMLController(async (sql) => {
        if (sql.includes('FROM parcels')) {
          return { id: 201, user_id: 2, center_lat: -10.68, center_lng: -76.25, altitude_masl: 4337 };
        }
        return null;
      });

      // Test Asesor
      const reqAdvisor = {
        params: { parcelId: '201' },
        user: { id: 99, role: 'advisor', username: 'agronomo_carlos' }
      };
      const resAdvisor = createMockRes();
      await mlCtrl.predictForParcel(reqAdvisor, resAdvisor);
      assert.strictEqual(resAdvisor.statusCode, 200);
      assert.strictEqual(resAdvisor.data.success, true);

      // Test Admin
      const reqAdmin = {
        params: { parcelId: '201' },
        user: { id: 100, role: 'admin', username: 'admin_agropasco' }
      };
      const resAdmin = createMockRes();
      await mlCtrl.predictForParcel(reqAdmin, resAdmin);
      assert.strictEqual(resAdmin.statusCode, 200);
      assert.strictEqual(resAdmin.data.success, true);
    } finally {
      database.dbGet = originalDbGet;
      global.fetch = originalFetch;
      delete require.cache[require.resolve('../controllers/mlController')];
    }
  });

  // -------------------------------------------------------------------------
  // 7. CONSERVACIÓN DEL MECANISMO DE FALLBACK
  // -------------------------------------------------------------------------
  console.log('\n--- 7. CONSERVACIÓN DEL MECANISMO DE FALLBACK ANTE FALLAS ---');

  await itAsync('Fallback selectivo cuando falta humedad del suelo (soil_moisture_0_to_7cm)', async () => {
    const mockParcel = {
      id: 50,
      name: 'Parcela Sin Suelo',
      center_lat: -10.68,
      center_lng: -76.25,
      altitude_masl: 4337
    };

    const originalFetch = global.fetch;
    // Historial presente pero sin soil_moisture_0_to_7cm
    const mockDaily = {
      time: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
      temperature_2m_max: Array(10).fill(12.0),
      temperature_2m_min: Array(10).fill(-2.0),
      temperature_2m_mean: Array(10).fill(5.0),
      precipitation_sum: Array(10).fill(1.0),
      rain_sum: Array(10).fill(1.0),
      wind_speed_10m_max: Array(10).fill(10.0),
      et0_fao_evapotranspiration: Array(10).fill(2.5)
    };
    const mockHourly = {
      time: Array.from({ length: 240 }, (_, i) => `2026-10-${String(Math.floor(i / 24) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`),
      temperature_2m: Array(240).fill(5.0),
      relative_humidity_2m: Array(240).fill(60.0),
      precipitation: Array(240).fill(0.1)
      // soil_moisture_0_to_7cm omitido deliberadamente
    };

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        elevation: 4337,
        daily: mockDaily,
        hourly: mockHourly
      })
    });

    try {
      const predRes = await mlService.getPredictionForParcel(mockParcel);
      assert.strictEqual(predRes.success, true);
      const data = predRes.data;

      // Heladas y Lluvias requieren soil_moisture -> fallback a rule_based
      const frost = data.predictions.find(p => p.phenomenon === 'frost');
      const rain = data.predictions.find(p => p.phenomenon === 'heavy_rain');
      const snow = data.predictions.find(p => p.phenomenon === 'snow');

      assert.strictEqual(frost.model_type, 'rule_based', 'Heladas debe usar rule_based por falta de soil_moisture');
      assert.strictEqual(rain.model_type, 'rule_based', 'Lluvias debe usar rule_based por falta de soil_moisture');
      assert.strictEqual(snow.model_type, 'ml_trained', 'Nieve no requiere soil_moisture, ejecuta ml_trained');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 8. INTEGRIDAD ESTRUCTURAL DE MODELOS JSON
  // -------------------------------------------------------------------------
  console.log('\n--- 8. INTEGRIDAD ESTRUCTURAL DE LOS MODELOS JSON ---');

  it('Los tres modelos JSON cargan correctamente y cumplen sus especificaciones de arquitectura', () => {
    const engine = new MLEngine();
    const result = engine.loadModels();
    assert.strictEqual(result.loaded, true);
    assert.deepStrictEqual(result.models, ['frost', 'heavy_rain', 'snow']);

    // Frost
    assert.strictEqual(engine.models.frost.phenomenon, 'frost');
    assert.strictEqual(engine.models.frost.n_features, 18);
    assert.strictEqual(engine.models.frost.trees.length, 100);
    assert.strictEqual(typeof engine.models.frost.learning_rate, 'number');

    // Heavy Rain
    assert.strictEqual(engine.models.heavy_rain.phenomenon, 'heavy_rain');
    assert.strictEqual(engine.models.heavy_rain.n_features, 16);
    assert.strictEqual(engine.models.heavy_rain.trees.length, 100);

    // Snow
    assert.strictEqual(engine.models.snow.phenomenon, 'snow');
    assert.strictEqual(engine.models.snow.n_features, 13);
    assert.strictEqual(engine.models.snow.coefficients.length, 13);
    assert.strictEqual(typeof engine.models.snow.intercept, 'number');
    assert.strictEqual(engine.models.snow.scaler.mean.length, 13);
    assert.strictEqual(engine.models.snow.scaler.scale.length, 13);
  });

  // -------------------------------------------------------------------------
  // RESUMEN FINAL
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(75));
  console.log(`📊 RESULTADOS FASE 8F: ${passedTests} APROBADAS | ${failedTests} FALLIDAS`);
  console.log('='.repeat(75));

  if (failedTests > 0) {
    console.error(`\n❌ Se detectaron ${failedTests} fallas en la suite de validación.`);
    process.exit(1);
  } else {
    console.log('\n🎉 TODAS LAS VERIFICACIONES DE LA FASE 8F APROBADAS (100% OK).');
  }
}

runTestSuite().catch(err => {
  console.error('Error fatal ejecutando test suite:', err);
  process.exit(1);
});
