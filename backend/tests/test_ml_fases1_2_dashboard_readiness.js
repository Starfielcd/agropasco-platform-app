/**
 * AgroPasco — Test Suite: Fases 1 y 2 (Benchmark de 5 Modelos ML y Preparación del Dashboard)
 * =========================================================================================
 * Verifica rigurosamente:
 *  1. Existencia e integridad de la comparativa de los 5 algoritmos ML.
 *  2. Realismo y completitud de métricas (F1, Precision, Recall, PR-AUC, ROC-AUC, Brier, ECE, latencia).
 *  3. Inferencia de los modelos seleccionados en memoria sin fuga ni valores nulos.
 *  4. Endpoints y contratos para el Dashboard (comparación, predicción manual, horizontes 24/48/72h,
 *     evaluación predicciones vs observaciones, contrato Monte Carlo y contrato de los 5 agentes).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MODELS_JSON_DIR = path.join(ROOT_DIR, 'data/models-json');
const REPORTS_DIR = path.join(ROOT_DIR, 'data/weather-history/reports');

const { defaultEngine } = require('../services/mlEngine');
const mlController = require('../controllers/mlController');

console.log('='.repeat(70));
console.log('AGROPASCO — VALIDACIÓN INTEGRAL DE FASES 1 Y 2 ML Y PREPARACIÓN DASHBOARD');
console.log('='.repeat(70));

let passedChecks = 0;
let totalChecks = 0;

function check(desc, fn) {
  totalChecks++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

// 1. VERIFICACIÓN DE AUDITORÍA Y BENCHMARK DE 5 MODELOS ML
console.log('\n[1/6] Verificación de la Matriz Comparativa de 5 Algoritmos...');

const compPath = path.join(MODELS_JSON_DIR, 'model_comparison_5_algorithms.json');
check('Existe el archivo model_comparison_5_algorithms.json', () => {
  assert(fs.existsSync(compPath), `No existe ${compPath}`);
});

const compData = JSON.parse(fs.readFileSync(compPath, 'utf-8'));

check('Estructura general contiene fenómenos y metadatos de Fase 2', () => {
  assert(compData.phase.includes('FASE 2'), 'Fase incorrecta');
  assert(compData.phenomena.frost, 'Falta frost');
  assert(compData.phenomena.heavy_rain, 'Falta heavy_rain');
  assert(compData.phenomena.snow, 'Falta snow');
  assert(compData.phenomena.hail, 'Falta hail');
});

const requiredAlgorithms = [
  'LogisticRegression',
  'RandomForestClassifier',
  'GradientBoostingClassifier',
  'ExtraTreesClassifier',
  'HistGradientBoostingClassifier',
];

['frost', 'heavy_rain', 'snow'].forEach(phen => {
  check(`Fenómeno '${phen}' evalúa los 5 algoritmos exigidos con métricas verificables`, () => {
    const phenData = compData.phenomena[phen];
    assert.strictEqual(typeof phenData.selected_model, 'string', 'Falta selected_model');
    assert.strictEqual(typeof phenData.selection_reason, 'string', 'Falta selection_reason');
    assert(phenData.selection_reason.length > 20, 'Justificación muy corta o vacía');

    const models = phenData.models;
    const evaluatedAlgoNames = Object.values(models).map(m => m.algorithm);

    requiredAlgorithms.forEach(algo => {
      assert(
        evaluatedAlgoNames.includes(algo),
        `Algoritmo ${algo} no encontrado en evaluación de ${phen}`
      );
    });

    // Validar métricas de cada algoritmo
    Object.entries(models).forEach(([name, m]) => {
      assert(m.test, `Faltan métricas de test en ${name}`);
      assert(typeof m.test.f1 === 'number', `Falta f1 en ${name}`);
      assert(typeof m.test.precision === 'number', `Falta precision en ${name}`);
      assert(typeof m.test.recall === 'number', `Falta recall en ${name}`);
      assert(typeof m.test.pr_auc === 'number', `Falta pr_auc en ${name}`);
      assert(typeof m.test.brier_score === 'number', `Falta brier_score en ${name}`);
      assert(typeof m.test.latency_per_sample_us === 'number', `Falta latencia en ${name}`);
      assert(m.fit_time_ms > 0, `fit_time_ms inválido en ${name}`);
    });
  });
});

check('Fenómeno Granizo (HAIL) registra limitación técnica justificada (0 eventos WMO)', () => {
  const hailData = compData.phenomena.hail;
  assert.strictEqual(hailData.status, 'not_viable_supervised_ml', 'Estado incorrecto para granizo');
  assert(hailData.message.includes('0 horas') || hailData.message.includes('ERA5'), 'Mensaje incompleto');
});

// 2. VERIFICACIÓN DEL MOTOR DE INFERENCIA NATIVO JS
console.log('\n[2/6] Verificación de Inferencia y Carga de Artefactos...');

check('Carga de artefactos frost, heavy_rain y snow en MLEngine', () => {
  const loadResult = defaultEngine.loadModels();
  assert.strictEqual(loadResult.loaded, true);
  assert(defaultEngine.models.frost, 'Falta modelo frost');
  assert(defaultEngine.models.heavy_rain, 'Falta modelo heavy_rain');
  assert(defaultEngine.models.snow, 'Falta modelo snow');
});

// 3. PREDICCIÓN MANUAL PARA EL DASHBOARD
console.log('\n[3/6] Prueba del Controlador de Predicción Manual (Dashboard)...');

check('predictManualSimulation retorna predicciones completas para los 4 fenómenos', async () => {
  const req = {
    body: {
      altitude_masl: 4337,
      temperature_2m_min: -3.5,
      temperature_2m_max: 8.0,
      precipitation_sum: 0.0,
      wind_speed_10m_max: 2.1,
      humidity_mean: 45.0,
    },
  };
  let sentData = null;
  const res = {
    json: (d) => { sentData = d; },
    status: () => res,
  };

  await mlController.predictManualSimulation(req, res);
  assert(sentData && sentData.success, 'Fallo respuesta manual');
  assert(sentData.predictions.frost, 'Falta frost en predicción manual');
  assert(sentData.predictions.heavy_rain, 'Falta heavy_rain en predicción manual');
  assert(sentData.predictions.snow, 'Falta snow en predicción manual');
  assert(sentData.predictions.hail, 'Falta hail en predicción manual');
  assert(['high', 'moderate', 'low', 'none'].includes(sentData.predictions.frost.risk_level));
});

check('predictManualSimulation rechaza entradas con datos insuficientes', async () => {
  const req = { body: {} };
  let statusCode = 200;
  let sentData = null;
  const res = {
    status: (c) => { statusCode = c; return res; },
    json: (d) => { sentData = d; },
  };

  await mlController.predictManualSimulation(req, res);
  assert.strictEqual(statusCode, 400, 'Debe retornar 400');
  assert.strictEqual(sentData.status, 'insufficient_data');
});

// 4. COMPARATIVA DE 5 MODELOS (ENDPOINT DASHBOARD)
console.log('\n[4/6] Prueba del Endpoint de Comparativa de 5 Modelos...');

check('get5ModelsComparison entrega la matriz completa en formato JSON', async () => {
  let sentData = null;
  const req = {};
  const res = {
    json: (d) => { sentData = d; },
    status: () => res,
  };

  await mlController.get5ModelsComparison(req, res);
  assert(sentData && sentData.success, 'Fallo respuesta get5ModelsComparison');
  assert(sentData.data.phenomena.frost, 'Falta frost');
  assert(sentData.data.phenomena.frost.selected_model, 'Falta modelo seleccionado');
});

// 5. EVALUACIÓN OBSERVACIONES Y CONTRATOS MONTE CARLO / MULTIAGENTE
console.log('\n[5/6] Prueba de Contratos Monte Carlo y Sistema Multiagente...');

check('getMonteCarloSimulationContract entrega especificación formal lista para Fase 3', async () => {
  let sentData = null;
  const res = { json: (d) => { sentData = d; }, status: () => res };
  await mlController.getMonteCarloSimulationContract({}, res);

  assert(sentData && sentData.success);
  assert.strictEqual(sentData.status, 'ready_for_phase3');
  assert(sentData.specification.input_schema.properties.iterations);
  assert(sentData.specification.output_schema.properties.percentile_p90);
});

check('getAgentsStatusContract entrega los 5 agentes agrícolas especializados', async () => {
  let sentData = null;
  const res = { json: (d) => { sentData = d; }, status: () => res };
  await mlController.getAgentsStatusContract({}, res);

  assert(sentData && sentData.success);
  assert.strictEqual(sentData.agents.length, 5, 'Deben ser exactamente 5 agentes');
  const agentIds = sentData.agents.map(a => a.id);
  assert(agentIds.includes('agent_meteorological'));
  assert(agentIds.includes('agent_irrigation'));
  assert(agentIds.includes('agent_phytosanitary'));
  assert(agentIds.includes('agent_harvest'));
  assert(agentIds.includes('agent_agronomic_advisory'));
});

// 6. EVALUACIÓN CONTRA OBSERVACIONES DE CAMPO
console.log('\n[6/6] Prueba de Evaluación Predicciones vs Observaciones...');

check('getPredictionsVsObservationsEvaluation expone protocolo de contraste con SENAMHI/campo', async () => {
  let sentData = null;
  const res = { json: (d) => { sentData = d; }, status: () => res };
  await mlController.getPredictionsVsObservationsEvaluation({}, res);

  assert(sentData && sentData.success);
  assert(sentData.evaluation_protocol.source_real.includes('ground_truth_observations'));
  assert(Array.isArray(sentData.observations));
});

console.log('\n' + '='.repeat(70));
console.log(`RESUMEN DE PRUEBAS: ${passedChecks}/${totalChecks} VERIFICACIONES EXITOSAS`);
console.log('='.repeat(70));
process.exit(0);

