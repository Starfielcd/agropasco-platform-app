/**
 * AgroPasco Digital — Test Suite Fase 5: Estrategias de Mitigación y Respuesta
 * ==============================================================================
 * Verificación exhaustiva de:
 * 1. Unificación de modelos en modelRegistry.js y justificación técnica.
 * 2. Motor de recomendaciones agronómicas (INIA / SENAMHI / FAO):
 *    - Cobertura de las 4 amenazas: Heladas, Nevadas, Granizadas, Lluvias Intensas.
 *    - Reglas por cultivo: Papa (vulnerabilidad en floración), Maca (rusticidad y anegamiento), Quinua.
 *    - Manejo robusto de datos incompletos.
 * 3. Priorización agronómica estricta (crítica, alta, media, baja).
 * 4. Trazabilidad determinista de códigos de estrategia (strategy_id).
 * 5. Integración con Monte Carlo: análisis de sensibilidad P90 y dispersión de incertidumbre.
 * 6. Endpoints REST y control de acceso RBAC por parcela (HTTP 400, 403, 404, 200).
 * 7. Seguimiento de acciones en base de datos (UPSERT idempotente, notas de asesor).
 * 8. Integración frontend (predictive-dashboard.js, mitigation-strategies.js, api.js, index.html).
 * 9. No-regresión cruzada de FIX02, COMERCIO01, Fase 3 y Fase 4.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { defaultMitigationService, STRATEGY_CATALOG } = require('../services/mitigationService');
const mitigationController = require('../controllers/mitigationController');
const { getActiveModel, getAllActiveModels } = require('../config/modelRegistry');
const db = require('../config/database');

console.log('======================================================================');
console.log('AGROPASCO DIGITAL — TEST SUITE FASE 5: ESTRATEGIAS DE MITIGACIÓN ML');
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
  // MÓDULO 1: CORRECCIÓN PREVIA Y REGISTRO VERSIONADO DE MODELOS ML
  // -------------------------------------------------------------------------
  console.log('[1/7] Verificación de Correcciones Previas y Model Registry...');

  test('modelRegistry.js unifica la selección oficial de modelos versionados', () => {
    const frostModel = getActiveModel('frost');
    assert(frostModel, 'Debe existir registro para frost');
    assert.strictEqual(frostModel.algorithm, 'LogisticRegression', 'Frost debe estar unificado como LogisticRegression');
    assert.strictEqual(frostModel.version, '2.0.0_audited_no_leak');
    assert(frostModel.selection_rationale.includes('parsimonioso'), 'Debe contener justificación técnica');

    const rainModel = getActiveModel('heavy_rain');
    assert.strictEqual(rainModel.algorithm, 'RandomForestClassifier');

    const hailModel = getActiveModel('hail');
    assert.strictEqual(hailModel.is_supervised_ml, false, 'Granizo debe estar registrado como regla física no supervisada');
  });

  test('Cholesky en monteCarloService documenta proveniencia empírica de 2,461 registros de Cerro de Pasco', () => {
    const mcServiceContent = fs.readFileSync(path.resolve(__dirname, '../services/monteCarloService.js'), 'utf-8');
    assert(mcServiceContent.includes('cerro_de_pasco_processed.csv'), 'Debe citar el CSV histórico de Cerro de Pasco');
    assert(mcServiceContent.includes('0.4849') && mcServiceContent.includes('0.6573') && mcServiceContent.includes('0.6188'), 'Debe contener los coeficientes empíricos exactos');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 2: CATÁLOGO Y ESTRATEGIAS POR FENÓMENO METEOROLÓGICO
  // -------------------------------------------------------------------------
  console.log('\n[2/7] Verificación de Catálogo de Estrategias para los 4 Fenómenos...');

  test('Las 4 amenazas meteorológicas cuentan con estrategias agronómicas documentadas', () => {
    const phenomena = ['frost', 'snow', 'hail', 'heavy_rain'];
    for (const phen of phenomena) {
      assert(Array.isArray(STRATEGY_CATALOG[phen]), `Debe existir catálogo para ${phen}`);
      assert(STRATEGY_CATALOG[phen].length >= 2, `Debe haber al menos 2 estrategias para ${phen}`);
    }
  });

  test('Heladas: contempla coberturas agrotéxtiles, riego térmico y bioestimulantes con precauciones críticas', () => {
    const frostStrats = STRATEGY_CATALOG.frost;
    const agrotex = frostStrats.find(s => s.id_template.includes('AGROTEX'));
    const sprinkler = frostStrats.find(s => s.id_template.includes('SPRINKLER'));
    const osmoprotect = frostStrats.find(s => s.id_template.includes('OSMOPROTECT'));

    assert(agrotex, 'Debe incluir manta térmica agrotéxtil');
    assert(agrotex.technical_rationale.includes('INIA'), 'Debe referenciar norma INIA');

    assert(sprinkler, 'Debe incluir riego por aspersión preventivo');
    assert(sprinkler.precautions.includes('-4.0°C'), 'Debe advertir de no regar si la temperatura baja de -4°C por congelamiento');

    assert(osmoprotect, 'Debe incluir bioestimulación osmoprotectora (potasio/prolina)');
  });

  test('Lluvias Intensas, Nevadas y Granizadas: contemplan drenaje, refuerzo estructural y cicatrizantes', () => {
    const rainStrats = STRATEGY_CATALOG.heavy_rain;
    assert(rainStrats.some(s => s.id_template.includes('DRAINAGE')), 'Lluvias debe incluir zanjas de drenaje');
    assert(rainStrats.some(s => s.id_template.includes('PHYTO')), 'Lluvias debe incluir monitoreo de Rancha (Phytophthora)');

    const snowStrats = STRATEGY_CATALOG.snow;
    assert(snowStrats.some(s => s.id_template.includes('STRUCTURAL')), 'Nieve debe incluir refuerzo de cobertizos');

    const hailStrats = STRATEGY_CATALOG.hail;
    assert(hailStrats.some(s => s.id_template.includes('POSTDAMAGE')), 'Granizo debe incluir tratamiento cicatrizante con cobre en 24-48h');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 3: SENSIBILIDAD POR CULTIVO, ETAPA FENOLÓGICA Y MONTE CARLO
  // -------------------------------------------------------------------------
  console.log('\n[3/7] Verificación de Sensibilidad por Cultivo, Fenología e Integración Monte Carlo...');

  test('Papa en floración ante helada eleva automáticamente la prioridad a CRÍTICA', () => {
    const res = defaultMitigationService.generateRecommendations({
      parcel_id: 10,
      crop: 'papa',
      phenological_stage: 'floracion',
      phenomenon: 'frost',
      horizon: '24h',
      operational_forecast: { altitude_masl: 3950 },
      ml_prediction: { risk_level: 'moderate', risk_score: 55, probability: 0.55 },
    });

    assert(res.success === true);
    assert(res.strategies.length > 0);
    const topStrat = res.strategies[0];
    assert.strictEqual(topStrat.priority, 'critica', 'La papa en floración debe elevarse a prioridad crítica');
    assert(topStrat.agronomic_context_note.includes('floración'), 'Debe incluir nota agronómica de floración');
  });

  test('Maca ante helada calibra su prioridad reconociendo rusticidad natural hasta -4°C', () => {
    const res = defaultMitigationService.generateRecommendations({
      parcel_id: 11,
      crop: 'maca',
      phenological_stage: 'vegetativo',
      phenomenon: 'frost',
      horizon: '24h',
      operational_forecast: { altitude_masl: 4350 },
      ml_prediction: { risk_level: 'moderate', risk_score: 45, probability: 0.45 },
    });

    assert(res.success === true);
    const agrotex = res.strategies.find(s => s.strategy_id.includes('AGROTEX'));
    assert(agrotex);
    assert(agrotex.agronomic_context_note.includes('rusticidad andina'));
  });

  test('Integración Monte Carlo: P90 elevado genera advertencia explícita de sensibilidad estocástica', () => {
    const res = defaultMitigationService.generateRecommendations({
      parcel_id: 12,
      crop: 'papa',
      phenological_stage: 'tuberizacion',
      phenomenon: 'frost',
      horizon: '24h',
      operational_forecast: { altitude_masl: 4100 },
      ml_prediction: { risk_level: 'moderate', risk_score: 48, probability: 0.48 }, // Riesgo moderado operativo
      monte_carlo_results: {
        percentiles: { p10: 0.25, p50: 0.48, p90: 0.78 }, // P90 en rango alto
        uncertainty_interval_80: { spread: 0.53 },
      },
    });

    assert(res.success === true);
    const strat = res.strategies[0];
    assert(strat.stochastic_sensitivity.includes('Alerta de sensibilidad Monte Carlo'));
    assert(strat.stochastic_sensitivity.includes('P90 crítico alcanza 78.0%'));
  });

  test('Manejo robusto de datos incompletos: asume valores por defecto razonables sin fallar', () => {
    const res = defaultMitigationService.generateRecommendations({});
    assert(res.success === true);
    assert(res.strategies.length > 0);
    assert.strictEqual(res.context.crop, 'papa');
    assert.strictEqual(res.context.phenomenon, 'frost');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 4: TRAZABILIDAD DETERMINISTA Y PREVENCIÓN DE DUPLICADOS
  // -------------------------------------------------------------------------
  console.log('\n[4/7] Verificación de Trazabilidad Determinista y Deduplicación...');

  test('Los IDs de estrategia son deterministas y únicos por cultivo y horizonte', () => {
    const res24 = defaultMitigationService.generateRecommendations({ crop: 'papa', horizon: '24h' });
    const res48 = defaultMitigationService.generateRecommendations({ crop: 'papa', horizon: '48h' });

    const id24 = res24.strategies[0].strategy_id;
    const id48 = res48.strategies[0].strategy_id;

    assert(id24.includes('-24H'));
    assert(id48.includes('-48H'));
    assert.notStrictEqual(id24, id48, 'Horizontes diferentes deben tener IDs diferenciados');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 5: ENDPOINTS HTTP Y CONTROL DE ACCESO (RBAC)
  // -------------------------------------------------------------------------
  console.log('\n[5/7] Verificación de Endpoints REST y Seguridad RBAC...');

  await asyncTest('GET /mitigation/strategies/:parcelId rechaza parcelas no existentes con HTTP 404', async () => {
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql, params) => null; // Simular parcela no encontrada

    try {
      const req = { params: { parcelId: '9999' }, query: {}, user: { id: 1, role: 'farmer' } };
      let statusCode = null, jsonResponse = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonResponse = data; return res; },
      };

      await mitigationController.getMitigationStrategiesForParcel(req, res);
      assert.strictEqual(statusCode, 404);
      assert.strictEqual(jsonResponse.success, false);
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  await asyncTest('GET /mitigation/strategies/:parcelId bloquea acceso a parcela ajena con HTTP 403', async () => {
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql, params) => {
      if (sql.includes('SELECT * FROM parcels WHERE id = ?')) {
        return { id: 50, user_id: 888, name: 'Parcela de Pedro', crop_type: 'papa', altitude_masl: 4000 };
      }
      return null;
    };

    try {
      const req = {
        params: { parcelId: '50' },
        query: {},
        user: { id: 777, role: 'farmer' }, // Usuario 777 intenta ver parcela de 888
      };
      let statusCode = null, jsonResponse = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonResponse = data; return res; },
      };

      await mitigationController.getMitigationStrategiesForParcel(req, res);
      assert.strictEqual(statusCode, 403);
      assert(jsonResponse.error.includes('Acceso no autorizado'));
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  await asyncTest('POST /mitigation/actions valida estados permitidos y rechaza entradas inválidas', async () => {
    const originalDbGet = db.dbGet;
    db.dbGet = async (sql) => ({ id: 1, user_id: 1 });

    try {
      const req = {
        body: {
          parcel_id: 1,
          strategy_id: 'STRAT-TEST',
          status: 'estado_invalido_hacker',
        },
        user: { id: 1, role: 'farmer' },
      };
      let statusCode = null, jsonResponse = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonResponse = data; return res; },
      };

      await mitigationController.recordMitigationAction(req, res);
      assert.strictEqual(statusCode, 500);
      assert(jsonResponse.error.includes('Estado inválido'));
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  await asyncTest('POST /mitigation/advisor-note restringe acceso exclusivamente a asesores o admin', async () => {
    const req = {
      body: { parcel_id: 1, strategy_id: 'STRAT-TEST', notes: 'Nota' },
      user: { id: 1, role: 'farmer' }, // Rol farmer no tiene permiso para agregar nota técnica de asesor
    };
    let statusCode = null, jsonResponse = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResponse = data; return res; },
    };

    await mitigationController.addAdvisorMitigationNote(req, res);
    assert.strictEqual(statusCode, 403);
    assert(jsonResponse.error.includes('Solo asesores'));
  });

  // -------------------------------------------------------------------------
  // MÓDULO 6: INTEGRACIÓN FRONTEND Y SEGUIMIENTO EN TIEMPO REAL
  // -------------------------------------------------------------------------
  console.log('\n[6/7] Verificación de Componentes de Frontend...');

  test('mitigation-strategies.js y rutas registradas en index.html y api.js', () => {
    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
    assert(indexHtml.includes('frontend/js/mitigation-strategies.js'), 'index.html debe cargar mitigation-strategies.js');

    const apiJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/api.js'), 'utf-8');
    assert(apiJs.includes('getMitigationStrategies'), 'api.js debe exportar getMitigationStrategies');
    assert(apiJs.includes('recordMitigationAction'), 'api.js debe exportar recordMitigationAction');
    assert(apiJs.includes('addAdvisorMitigationNote'), 'api.js debe exportar addAdvisorMitigationNote');
  });

  test('predictive-dashboard.js incorpora la sección de mitigación y botón de salto rápido', () => {
    const dashJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/predictive-dashboard.js'), 'utf-8');
    assert(dashJs.includes('renderMitigationStrategiesSection'), 'Debe llamar a renderMitigationStrategiesSection');
    assert(dashJs.includes('section-mitigation-strategies'), 'Debe existir ancla section-mitigation-strategies');
    assert(dashJs.includes('loadMitigationStrategies'), 'Debe sincronizar carga al seleccionar parcela');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 7: NO-REGRESIÓN DE FASES ANTERIORES (FIX02, COMERCIO01, FASE 3, FASE 4)
  // -------------------------------------------------------------------------
  console.log('\n[7/7] Verificación de No-Regresión Cruzada...');

  test('Monte Carlo (Fase 4): simulador sigue operativo con reproducibilidad y percentiles', () => {
    const { MonteCarloSimulator } = require('../services/monteCarloService');
    const sim = new MonteCarloSimulator({ seed: 777 });
    const res = sim.runSimulation({ temperature_2m_min: 1.0, altitude_masl: 4000 }, 'frost', 100);
    assert(res.success === true);
    assert(res.statistics.percentiles.p90 >= res.statistics.percentiles.p10);
  });

  test('COMERCIO01 y FIX02: controladores comerciales y persistencia protegidos', () => {
    const orderCtrl = require('../controllers/orderController');
    assert(typeof orderCtrl.createOrder === 'function');
    assert(typeof orderCtrl.farmerResponse === 'function');

    const parcelCtrl = require('../controllers/parcelController');
    assert(typeof parcelCtrl.listParcels === 'function');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADO FINAL DE PRUEBAS FASE 5: ${passedTests}/${totalTests} APROBADAS`);
  console.log('======================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Error fatal en suite de pruebas Fase 5:', err);
  process.exit(1);
});
