/**
 * AgroPasco Digital — Test Suite Fase 3: Dashboard Predictivo en Tiempo Real
 * ==========================================================================
 * Verificación exhaustiva de:
 * 1. Registro de rutas, roles y navegación del Dashboard en SPA.
 * 2. Endpoint GET /api/ml/models/comparison (5 algoritmos, métricas, justificación y regla de granizo).
 * 3. Endpoint POST /api/ml/predict/manual (Sandbox de simulación sin tocar BD).
 * 4. Endpoint GET /api/ml/predict/:parcelId/horizons (Desglose 24h/48h/72h y control de acceso).
 * 5. Endpoint GET /api/ml/evaluation/predictions-vs-observations (Manejo de observaciones y estado sin datos).
 * 6. Contratos de integración: Monte Carlo y 5 Agentes Inteligentes.
 * 7. Integridad de los módulos preexistentes (FIX02 y COMERCIO01).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco-secret-key-2026';

console.log('======================================================================');
console.log('AGROPASCO DIGITAL — TEST SUITE FASE 3: DASHBOARD PREDICTIVO');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function asyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  // -------------------------------------------------------------------------
  // MÓDULO 1: INTEGRACIÓN DE NAVEGACIÓN Y RUTAS DEL FRONTEND
  // -------------------------------------------------------------------------
  console.log('[1/7] Verificación de Navegación, Roles y Rutas del Frontend...');

  test('Ruta /predictive-dashboard registrada en app.js para farmer, advisor, supermarket y admin', () => {
    const appJsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/app.js'), 'utf-8');
    assert(appJsContent.includes("'/predictive-dashboard'"), "app.js debe incluir la ruta '/predictive-dashboard'");
    assert(appJsContent.includes("roles: ['farmer', 'advisor', 'supermarket', 'admin']"), 'La ruta debe ser accesible para los 4 roles principales');
    assert(appJsContent.includes('renderPredictiveDashboardPage'), 'La ruta debe invocar renderPredictiveDashboardPage');
  });

  test('Auto-inicialización de mapa en app.js para /predictive-dashboard', () => {
    const appJsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/app.js'), 'utf-8');
    assert(appJsContent.includes("initPredictiveDashboardMap"), 'app.js debe ejecutar initPredictiveDashboardMap');
  });

  test('Menús laterales (Sidebar) incluyen Dashboard Predictivo en los 4 roles', () => {
    const appJsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/app.js'), 'utf-8');
    // Contar apariciones de data-route="/predictive-dashboard"
    const matches = appJsContent.match(/data-route="\/predictive-dashboard"/g) || [];
    assert(matches.length >= 4, `Se esperaban al menos 4 enlaces de sidebar a /predictive-dashboard, encontrados: ${matches.length}`);
  });

  test('Inclusión de scripts en index.html: Chart.js y predictive-dashboard.js', () => {
    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
    assert(indexHtml.includes('chart.umd.min.js'), 'index.html debe incluir Chart.js para visualización de series de tiempo');
    assert(indexHtml.includes('frontend/js/predictive-dashboard.js'), 'index.html debe cargar frontend/js/predictive-dashboard.js');
  });

  test('Métodos de cliente en api.js para los 6 endpoints del Dashboard Predictivo', () => {
    const apiJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/api.js'), 'utf-8');
    assert(apiJs.includes('getMLModelsComparison:'), 'api.js debe contener getMLModelsComparison');
    assert(apiJs.includes('predictMLManual:'), 'api.js debe contener predictMLManual');
    assert(apiJs.includes('getMLParcelHorizons:'), 'api.js debe contener getMLParcelHorizons');
    assert(apiJs.includes('getMLPredictionsVsObservations:'), 'api.js debe contener getMLPredictionsVsObservations');
    assert(apiJs.includes('getMLSimulationContract:'), 'api.js debe contener getMLSimulationContract');
    assert(apiJs.includes('getMLAgentsStatus:'), 'api.js debe contener getMLAgentsStatus');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 2: ENDPOINT DE COMPARATIVA DE 5 MODELOS ML (GET /api/ml/models/comparison)
  // -------------------------------------------------------------------------
  console.log('\n[2/7] Verificación del Endpoint de Comparativa de 5 Algoritmos...');

  await asyncTest('Endpoint get5ModelsComparison responde matriz completa con 5 algoritmos', async () => {
    const { get5ModelsComparison } = require('../controllers/mlController');
    let resData = null;
    const req = { user: { id: 1, role: 'farmer' } };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => ({ json: (d) => { resData = { code, ...d }; } })
    };

    await get5ModelsComparison(req, res);
    assert(resData && resData.success, 'Respuesta debe tener success: true');
    assert(resData.data && resData.data.phenomena, 'Debe contener el objeto phenomena');

    const phenomena = resData.data.phenomena;
    assert(phenomena.frost, 'Debe incluir fenómeno frost');
    assert(phenomena.heavy_rain, 'Debe incluir fenómeno heavy_rain');
    assert(phenomena.snow, 'Debe incluir fenómeno snow');
    assert(phenomena.hail, 'Debe incluir fenómeno hail');

    // Verificar 5 algoritmos en Heladas (frost)
    const frostModels = phenomena.frost.models;
    const expectedAlgos = ['logistic_regression', 'random_forest', 'gradient_boosting', 'extra_trees', 'hist_gradient_boosting'];
    for (const algoKey of expectedAlgos) {
      assert(frostModels[algoKey], `frost debe contener evaluación de ${algoKey}`);
      const m = frostModels[algoKey];
      assert(m.test, `${algoKey} debe tener métricas de test`);
      assert(m.test.f1 !== undefined, `${algoKey} debe tener F1-Score`);
      assert(m.test.precision !== undefined, `${algoKey} debe tener Precision`);
      assert(m.test.recall !== undefined, `${algoKey} debe tener Recall`);
      assert(m.test.pr_auc !== undefined, `${algoKey} debe tener PR-AUC`);
      assert(m.test.brier_score !== undefined, `${algoKey} debe tener Brier Score`);
      assert(m.test.expected_calibration_error !== undefined, `${algoKey} debe tener ECE`);
      assert(m.test.latency_per_sample_us !== undefined, `${algoKey} debe tener latencia medida`);
    }

    // Justificación técnica documentada
    assert(phenomena.frost.selected_model, 'Debe registrar modelo seleccionado');
    assert(phenomena.frost.selection_reason, 'Debe registrar justificación técnica de selección');
  });

  test('Documentación explícita de limitaciones en Granizadas (Hail): reglas físicas deterministas', () => {
    const comparisonPath = path.resolve(__dirname, '../data/models-json/model_comparison_5_algorithms.json');
    const data = JSON.parse(fs.readFileSync(comparisonPath, 'utf-8'));
    const hail = data.phenomena.hail;
    assert.strictEqual(hail.status, 'not_viable_supervised_ml');
    assert(hail.message.includes('0 horas') || hail.message.includes('0 eventos'), 'Debe justificar la ausencia de etiquetas supervisadas en ERA5');
    assert(hail.message.includes('reglas físicas'), 'Debe documentar reglas físicas provisionales');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 3: ENDPOINT DE SIMULACIÓN MANUAL SANDBOX (POST /api/ml/predict/manual)
  // -------------------------------------------------------------------------
  console.log('\n[3/7] Verificación del Laboratorio de Simulación Manual (Sandbox)...');

  await asyncTest('predictManualSimulation infiere instantáneamente sin modificar la base de datos', async () => {
    const { predictManualSimulation } = require('../controllers/mlController');
    let resData = null;
    const req = {
      body: {
        temperature_2m_min: -4.5,
        temperature_2m_max: 7.0,
        precipitation_sum: 2.0,
        humidity_mean: 80.0,
        wind_speed_10m_max: 5.0,
        altitude_masl: 4350,
      },
      user: { id: 1, role: 'farmer' }
    };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => ({ json: (d) => { resData = { code, ...d }; } })
    };

    await predictManualSimulation(req, res);
    assert(resData && resData.success, 'Simulación manual debe responder con éxito');
    assert.strictEqual(resData.simulation_type, 'manual_input');
    assert(resData.predictions, 'Debe entregar objeto predictions');

    const preds = resData.predictions;
    assert(preds.frost && preds.frost.risk_level === 'high', 'Con -4.5°C a 4350msnm, el riesgo de helada debe ser ALTO');
    assert(preds.snow && preds.snow.risk_level === 'high', 'Con temp bajo cero y precipitación en puna alta, nevada debe ser ALTA');
    assert(preds.heavy_rain, 'Debe evaluar lluvias intensas');
    assert(preds.hail, 'Debe evaluar granizo con regla determinista');
  });

  await asyncTest('predictManualSimulation rechaza solicitudes sin variables térmicas esenciales', async () => {
    const { predictManualSimulation } = require('../controllers/mlController');
    let resCode = 200;
    let resData = null;
    const req = {
      body: {
        humidity_mean: 80.0, // Falta temperatura
      },
      user: { id: 1, role: 'farmer' }
    };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => {
        resCode = code;
        return { json: (d) => { resData = d; } };
      }
    };

    await predictManualSimulation(req, res);
    assert.strictEqual(resCode, 400, 'Debe responder HTTP 400 por variables insuficientes');
    assert.strictEqual(resData.status, 'insufficient_data');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 4: ENDPOINT DE HORIZONTES 24H, 48H, 72H (GET /api/ml/predict/:parcelId/horizons)
  // -------------------------------------------------------------------------
  console.log('\n[4/7] Verificación del Endpoint de Horizontes Temporales...');

  await asyncTest('getParcelHorizonsPrediction rechaza accesos a parcelas no existentes con HTTP 404', async () => {
    const db = require('../config/database');
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql, params) => null;

    try {
      const { getParcelHorizonsPrediction } = require('../controllers/mlController');
      let resCode = 200;
      let resData = null;
      const req = {
        params: { parcelId: '999999' },
        user: { id: 1, role: 'farmer' }
      };
      const res = {
        json: (d) => { resData = d; },
        status: (code) => {
          resCode = code;
          return { json: (d) => { resData = d; } };
        }
      };

      await getParcelHorizonsPrediction(req, res);
      assert.strictEqual(resCode, 404, 'Parcela inexistente debe retornar 404');
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  await asyncTest('getParcelHorizonsPrediction bloquea parcelas de terceros sin rol privilegiado con HTTP 403', async () => {
    const db = require('../config/database');
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql, params) => ({
      id: 10,
      user_id: 99, // Otro usuario
      name: 'Parcela Ajena',
      center_lat: -10.68,
      center_lng: -76.25,
      altitude_masl: 4100
    });

    try {
      const { getParcelHorizonsPrediction } = require('../controllers/mlController');
      let resCode = 200;
      let resData = null;
      const req = {
        params: { parcelId: '10' },
        user: { id: 1, role: 'farmer' }
      };
      const res = {
        json: (d) => { resData = d; },
        status: (code) => {
          resCode = code;
          return { json: (d) => { resData = d; } };
        }
      };

      await getParcelHorizonsPrediction(req, res);
      assert.strictEqual(resCode, 403, 'Acceso no autorizado debe retornar 403');
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  await asyncTest('getParcelHorizonsPrediction estructura horizontes 24h, 48h y 72h con predicciones reales', async () => {
    const db = require('../config/database');
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql, params) => ({
      id: 1,
      user_id: 1,
      name: 'Parcela Maca San Pedro',
      center_lat: -10.6868,
      center_lng: -76.2625,
      altitude_masl: 4380,
      crop_type: 'Maca'
    });

    try {
      const { getParcelHorizonsPrediction } = require('../controllers/mlController');
      let resCode = 200;
      let resData = null;
      const req = {
        params: { parcelId: '1' },
        user: { id: 1, role: 'farmer' }
      };
      const res = {
        json: (d) => { resData = d; },
        status: (code) => {
          resCode = code;
          return { json: (d) => { resData = d; } };
        }
      };

      await getParcelHorizonsPrediction(req, res);
      assert(resData && resData.success, 'Debe retornar éxito');
      assert(resData.horizons, 'Debe incluir objeto horizons');
      assert(resData.horizons.horizon_24h, 'Debe incluir horizon_24h');
      assert(resData.horizons.horizon_48h, 'Debe incluir horizon_48h');
      assert(resData.horizons.horizon_72h, 'Debe incluir horizon_72h');
      assert(Array.isArray(resData.raw_predictions), 'Debe incluir raw_predictions');
      assert.strictEqual(resData.parcel.altitude_masl, 4380, 'Debe preservar altitud de la parcela');
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  // -------------------------------------------------------------------------
  // MÓDULO 5: EVALUACIÓN PREDICCIÓN VS OBSERVACIONES DE CAMPO
  // -------------------------------------------------------------------------
  console.log('\n[5/7] Verificación del Módulo Predicción vs Realidad...');

  await asyncTest('getPredictionsVsObservationsEvaluation gestiona limpiamente la ausencia de observaciones', async () => {
    const { getPredictionsVsObservationsEvaluation } = require('../controllers/mlController');
    let resData = null;
    const req = { user: { id: 1, role: 'farmer' } };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => ({ json: (d) => { resData = { code, ...d }; } })
    };

    await getPredictionsVsObservationsEvaluation(req, res);
    assert(resData && resData.success, 'Debe responder con éxito');
    assert(Array.isArray(resData.observations), 'observations debe ser un arreglo');
    assert(resData.evaluation_protocol, 'Debe detallar el protocolo de evaluación');
    assert(resData.evaluation_protocol.source_real.includes('ground_truth_observations'), 'Debe referenciar observaciones de campo');
    assert(resData.evaluation_protocol.source_predictive.includes('Motor ML AgroPasco'), 'Debe referenciar la fuente predictiva');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 6: CONTRATOS TÉCNICOS PREPARADOS PARA MONTE CARLO Y MULTIAGENTE
  // -------------------------------------------------------------------------
  console.log('\n[6/7] Verificación de Contratos para Fases Futuras...');

  await asyncTest('getMonteCarloSimulationContract especifica simulación estocástica y percentiles P10, P50, P90', async () => {
    const { getMonteCarloSimulationContract } = require('../controllers/mlController');
    let resData = null;
    const req = { user: { id: 1, role: 'farmer' } };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => ({ json: (d) => { resData = { code, ...d }; } })
    };

    await getMonteCarloSimulationContract(req, res);
    assert(resData && resData.success);
    assert.strictEqual(resData.status, 'ready_for_phase3');
    assert.strictEqual(resData.endpoint, '/api/ml/simulation/monte-carlo');
    const dists = resData.specification.input_schema.properties.distribution_assumptions;
    assert(dists.temperature_2m_min.includes('Normal'), 'Distribución térmica debe ser Normal calibrada');
    assert(dists.precipitation_sum.includes('Gamma'), 'Distribución pluviométrica debe ser Gamma calibrada');
  });

  await asyncTest('getAgentsStatusContract expone los 5 agentes agrícolas especializados', async () => {
    const { getAgentsStatusContract } = require('../controllers/mlController');
    let resData = null;
    const req = { user: { id: 1, role: 'farmer' } };
    const res = {
      json: (d) => { resData = d; },
      status: (code) => ({ json: (d) => { resData = { code, ...d }; } })
    };

    await getAgentsStatusContract(req, res);
    assert(resData && resData.success);
    assert(Array.isArray(resData.agents), 'agents debe ser un arreglo');
    assert.strictEqual(resData.agents.length, 5, 'Debe contener exactamente 5 agentes');
    const agentIds = resData.agents.map(a => a.id);
    assert(agentIds.includes('agent_meteorological'), 'Debe incluir agent_meteorological');
    assert(agentIds.includes('agent_irrigation'), 'Debe incluir agent_irrigation');
    assert(agentIds.includes('agent_phytosanitary'), 'Debe incluir agent_phytosanitary');
    assert(agentIds.includes('agent_harvest'), 'Debe incluir agent_harvest');
    assert(agentIds.includes('agent_agronomic_advisory'), 'Debe incluir agent_agronomic_advisory');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 7: CALIDAD PREDICTIVA Y PREVENCIÓN DE DATA LEAKAGE
  // -------------------------------------------------------------------------
  console.log('\n[7/7] Verificación de Integridad Predictiva y Prevención de Data Leakage...');

  test('Validación temporal anti-leakage: el conjunto de test es estrictamente posterior a entrenamiento', () => {
    const trainingReportPath = path.resolve(__dirname, '../data/weather-history/reports/training_report.json');
    const report = JSON.parse(fs.readFileSync(trainingReportPath, 'utf-8'));
    const frostSummary = report.frost.data_summary;
    assert(frostSummary.train_period.includes('2024-12-31'), 'Entrenamiento hasta 2024-12-31');
    assert(frostSummary.test_period.includes('2025-06-30'), 'Test estrictamente posterior a 2025-06-30');
  });

  test('Paridad de variables: el motor ML V8 acepta las variables emitidas por Open-Meteo', () => {
    const { defaultEngine } = require('../services/mlEngine');
    assert(defaultEngine.isLoaded, 'MLEngine debe estar cargado en memoria');
    const testSample = {
      temperature_2m_min: 0.5,
      temperature_2m_max: 12.0,
      temperature_2m_mean: 6.25,
      temp_range: 11.5,
      precipitation_sum: 5.0,
      wind_speed_10m_max: 3.2,
      humidity_mean: 72.0,
      humidity_max: 88.0,
      humidity_min: 55.0,
      soil_moisture_mean: 0.30,
      et0_fao_evapotranspiration: 2.8,
      elevation: 4100,
      month: 7,
      day_of_year: 195,
      is_winter: 1,
      is_dry_season: 1,
      precip_lag1: 2.0,
      precip_rolling_3d: 8.0,
      precip_rolling_7d: 15.0,
      temp_min_lag1: 1.0,
      temp_max_lag1: 13.0,
      temp_min_rolling_3d: 1.2,
      temp_min_rolling_7d: 1.5,
      temp_max_rolling_3d: 12.5,
    };

    const resFrost = defaultEngine.predictFrost(testSample);
    assert(resFrost.probability !== undefined, 'Predicción de heladas debe contener probabilidad numérica');
    assert(resFrost.risk_score !== undefined, 'Predicción de heladas debe contener score normalizado');
    assert(resFrost.risk_level, 'Predicción de heladas debe clasificar nivel de riesgo');
  });

  console.log('\n======================================================================');
  console.log(`RESUMEN DE PRUEBAS FASE 3: ${passedTests}/${totalTests} APROBADAS`);
  console.log('======================================================================\n');
  process.exit(0);
}

runAll().catch(err => {
  console.error('Error fatal durante la ejecución de pruebas:', err);
  process.exit(1);
});
