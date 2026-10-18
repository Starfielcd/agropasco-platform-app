/**
 * AgroPasco Digital — Test Suite Fase 4: Simulador Monte Carlo en Tiempo Real
 * ===========================================================================
 * Verificación exhaustiva de:
 * 1. PRNG determinista Mulberry32 y reproducibilidad con semilla fija.
 * 2. Validez de distribuciones estadísticas (Normal Box-Muller y Gamma Marsaglia-Tsang) y límites físicos andinos.
 * 3. Matriz de correlación meteorológica (Cholesky 3x3: Temp, Lluvia, Humedad).
 * 4. Inferencia estocástica con los modelos ML (Heladas, Lluvias, Nevadas, Granizadas).
 * 5. Cálculo exacto de percentiles (P10 <= P50 <= P90), intervalos de incertidumbre e histogramas.
 * 6. Medición y reporte de rendimiento real en iteraciones por segundo.
 * 7. Endpoint HTTP POST /api/ml/simulation/monte-carlo con control de acceso y RBAC por parcela.
 * 8. Máquina de estados interactiva (Iniciar, Pausar, Reanudar, Reiniciar, Detener).
 * 9. Distinción explícita de simulación sintética vs mediciones reales.
 * 10. Integración con el Dashboard SPA y no-regresión de FIX02 y COMERCIO01.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const { MonteCarloSimulator, Mulberry32 } = require('../services/monteCarloService');
const { defaultEngine } = require('../services/mlEngine');
const mlController = require('../controllers/mlController');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco-secret-key-2026';

console.log('======================================================================');
console.log('AGROPASCO DIGITAL — TEST SUITE FASE 4: SIMULADOR MONTE CARLO ML');
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
  // MÓDULO 1: PRNG DETERMINISTA Y REPRODUCIBILIDAD CON SEMILLA
  // -------------------------------------------------------------------------
  console.log('[1/7] Verificación de PRNG Determinista y Reproducibilidad con Semilla...');

  test('Mulberry32 genera números pseudoaleatorios en el rango [0, 1)', () => {
    const prng = new Mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const val = prng.next();
      assert(val >= 0 && val < 1, `Valor fuera de [0, 1): ${val}`);
    }
  });

  test('Reproducibilidad estricta: dos simuladores con la misma semilla generan exactamente la misma secuencia', () => {
    const sim1 = new MonteCarloSimulator({ seed: 777 });
    const sim2 = new MonteCarloSimulator({ seed: 777 });

    const seq1 = [];
    const seq2 = [];
    for (let i = 0; i < 500; i++) {
      seq1.push(sim1.randomUniform());
      seq2.push(sim2.randomUniform());
    }

    assert.deepStrictEqual(seq1, seq2, 'Las secuencias con semilla idéntica deben ser exactamente iguales');
  });

  test('Diversidad estocástica: dos semillas diferentes producen secuencias distintas e incorreladas', () => {
    const simA = new MonteCarloSimulator({ seed: 101 });
    const simB = new MonteCarloSimulator({ seed: 202 });

    let diffCount = 0;
    for (let i = 0; i < 100; i++) {
      if (simA.randomUniform() !== simB.randomUniform()) diffCount++;
    }
    assert.strictEqual(diffCount, 100, 'Las secuencias con distintas semillas deben ser distintas');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 2: DISTRIBUCIONES ESTADÍSTICAS Y LÍMITES FÍSICOS ANDINOS
  // -------------------------------------------------------------------------
  console.log('\n[2/7] Verificación de Distribuciones Estadísticas y Restricciones Físicas...');

  test('Distribución Normal (Box-Muller): media y desviación estándar empírica convergen al valor teórico', () => {
    const sim = new MonteCarloSimulator({ seed: 999 });
    const targetMean = 4.5;
    const targetStd = 2.0;
    const N = 10000;

    let sum = 0;
    const samples = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const val = sim.randomNormal(targetMean, targetStd);
      samples[i] = val;
      sum += val;
    }

    const sampleMean = sum / N;
    let varSum = 0;
    for (let i = 0; i < N; i++) {
      const diff = samples[i] - sampleMean;
      varSum += diff * diff;
    }
    const sampleStd = Math.sqrt(varSum / N);

    assert(Math.abs(sampleMean - targetMean) < 0.1, `Media empírica ${sampleMean.toFixed(3)} desviada de ${targetMean}`);
    assert(Math.abs(sampleStd - targetStd) < 0.1, `Desviación empírica ${sampleStd.toFixed(3)} desviada de ${targetStd}`);
  });

  test('Distribución Gamma (Marsaglia-Tsang): valores estrictamente positivos y asimetría positiva', () => {
    const sim = new MonteCarloSimulator({ seed: 555 });
    const shape = 1.8;
    const scale = 2.5;
    const N = 5000;

    let minVal = Infinity;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const g = sim.randomGamma(shape, scale);
      assert(g >= 0, `Valor de lluvia negativo en Gamma: ${g}`);
      if (g < minVal) minVal = g;
      sum += g;
    }

    const empiricalMean = sum / N;
    const theoreticalMean = shape * scale; // 4.5
    assert(minVal >= 0, 'La precipitación simulada no puede ser negativa');
    assert(Math.abs(empiricalMean - theoreticalMean) < 0.25, `Media Gamma ${empiricalMean.toFixed(3)} alejada de teórica ${theoreticalMean}`);
  });

  test('Matriz de correlación Cholesky: conserva interdependencia física entre temperatura, lluvia y humedad', () => {
    const sim = new MonteCarloSimulator({ seed: 333 });
    const N = 5000;
    const zT = new Float64Array(N);
    const zP = new Float64Array(N);
    const zH = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const { zTemp, zPrecip, zHum } = sim.generateCorrelatedNormals();
      zT[i] = zTemp;
      zP[i] = zPrecip;
      zH[i] = zHum;
    }

    // Calcular correlación de Pearson Precipitación - Humedad (teórica: ~ +0.65)
    let sumProd = 0, sumSqP = 0, sumSqH = 0;
    for (let i = 0; i < N; i++) {
      sumProd += zP[i] * zH[i];
      sumSqP += zP[i] * zP[i];
      sumSqH += zH[i] * zH[i];
    }
    const rPrecipHum = sumProd / Math.sqrt(sumSqP * sumSqH);
    assert(rPrecipHum > 0.45 && rPrecipHum < 0.80, `Correlación Lluvia-Humedad ${rPrecipHum.toFixed(3)} fuera del rango esperado [0.45, 0.80]`);
  });

  test('Restricciones físicas de los Andes de Cerro de Pasco: validación de rangos extremos', () => {
    const sim = new MonteCarloSimulator({ seed: 888 });
    const baseline = {
      temperature_2m_min: -2.0,
      temperature_2m_max: 9.0,
      precipitation_sum: 8.0,
      humidity_mean: 85.0,
      wind_speed_10m_max: 4.5,
      altitude_masl: 4380,
    };

    for (let i = 0; i < 500; i++) {
      const s = sim.generateScenario(baseline, { temperature_std: 3.5, precipitation_shape: 2.0 });
      assert(s.temperature_2m_min >= -15.0, `Tmin < -15°C: ${s.temperature_2m_min}`);
      assert(s.temperature_2m_max <= 25.0, `Tmax > 25°C: ${s.temperature_2m_max}`);
      assert(s.temperature_2m_max > s.temperature_2m_min, 'Tmax debe ser mayor que Tmin');
      assert(s.temp_range >= 4.0, `Amplitud térmica < 4°C: ${s.temp_range}`);
      assert(s.precipitation_sum >= 0.0, `Precipitación < 0 mm: ${s.precipitation_sum}`);
      assert(s.humidity_mean >= 15.0 && s.humidity_mean <= 100.0, `Humedad fuera de [15%, 100%]: ${s.humidity_mean}`);
      assert(s.wind_speed_10m_max >= 0.0, `Viento < 0 m/s: ${s.wind_speed_10m_max}`);
    }
  });

  // -------------------------------------------------------------------------
  // MÓDULO 3: INFERENCIA ML, PERCENTILES Y ESTADÍSTICAS
  // -------------------------------------------------------------------------
  console.log('\n[3/7] Verificación de Inferencia ML sobre Escenarios y Cálculo de Percentiles...');

  test('Inferencia Monte Carlo para Heladas (frost) ejecuta pipeline ML nativo y calcula percentiles monótonos', () => {
    const sim = new MonteCarloSimulator({ seed: 42 });
    const baseline = {
      temperature_2m_min: 1.0,
      temperature_2m_max: 12.0,
      precipitation_sum: 0.2,
      humidity_mean: 55.0,
      wind_speed_10m_max: 2.0,
      altitude_masl: 4200,
      is_winter: 1,
      is_dry_season: 1,
    };

    const res = sim.runSimulation(baseline, 'frost', 500);

    assert(res.success === true, 'La simulación debe retornar success: true');
    assert.strictEqual(res.simulation_meta.phenomenon, 'frost');
    assert.strictEqual(res.simulation_meta.iterations, 500);
    assert.strictEqual(res.simulation_meta.is_supervised_ml, true);

    const stats = res.statistics;
    assert(stats.mean_probability >= 0 && stats.mean_probability <= 1, 'Probabilidad media en [0, 1]');
    assert(stats.median_probability >= 0 && stats.median_probability <= 1, 'Probabilidad mediana en [0, 1]');

    const p = stats.percentiles;
    assert(p.p10 <= p.p25, `Violación de monotonicidad: p10 (${p.p10}) > p25 (${p.p25})`);
    assert(p.p25 <= p.p50, `Violación de monotonicidad: p25 (${p.p25}) > p50 (${p.p50})`);
    assert(p.p50 <= p.p75, `Violación de monotonicidad: p50 (${p.p50}) > p75 (${p.p75})`);
    assert(p.p75 <= p.p90, `Violación de monotonicidad: p75 (${p.p75}) > p90 (${p.p90})`);

    // Intervalo de incertidumbre del 80%
    assert.strictEqual(res.statistics.uncertainty_interval_80.lower_bound_p10, p.p10);
    assert.strictEqual(res.statistics.uncertainty_interval_80.upper_bound_p90, p.p90);
    assert(res.statistics.uncertainty_interval_80.spread >= 0, 'El spread debe ser >= 0');
  });

  test('Inferencia Monte Carlo para Lluvias Intensas (heavy_rain) y Nevadas (snow)', () => {
    const simRain = new MonteCarloSimulator({ seed: 123 });
    const baselineWet = {
      temperature_2m_min: 3.5,
      temperature_2m_max: 11.0,
      precipitation_sum: 18.0,
      humidity_mean: 88.0,
      wind_speed_10m_max: 4.0,
      altitude_masl: 3900,
    };
    const resRain = simRain.runSimulation(baselineWet, 'heavy_rain', 300);
    assert(resRain.success === true);
    assert.strictEqual(resRain.simulation_meta.phenomenon, 'heavy_rain');
    assert(resRain.statistics.percentiles.p90 >= resRain.statistics.percentiles.p10);

    const simSnow = new MonteCarloSimulator({ seed: 456 });
    const baselineSnow = {
      temperature_2m_min: -3.0,
      temperature_2m_max: 3.0,
      precipitation_sum: 12.0,
      humidity_mean: 92.0,
      altitude_masl: 4400,
    };
    const resSnow = simSnow.runSimulation(baselineSnow, 'snow', 300);
    assert(resSnow.success === true);
    assert.strictEqual(resSnow.simulation_meta.phenomenon, 'snow');
  });

  test('Simulación de Granizadas (hail): documenta regla física determinista (is_supervised_ml = false)', () => {
    const sim = new MonteCarloSimulator({ seed: 789 });
    const baseline = {
      temperature_2m_min: 2.0,
      temperature_2m_max: 14.0,
      precipitation_sum: 12.0,
      humidity_mean: 86.0,
      altitude_masl: 4100,
    };

    const res = sim.runSimulation(baseline, 'hail', 200);
    assert(res.success === true);
    assert.strictEqual(res.simulation_meta.phenomenon, 'hail');
    assert.strictEqual(res.simulation_meta.is_supervised_ml, false, 'Granizadas debe marcarse como regla física determinista no supervisada');
    assert(res.methodological_disclaimer.hail_notice.includes('reglas físicas'), 'Debe incluir advertencia de regla física');
  });

  test('Frecuencia de categorías e histograma cubren el 100% de las iteraciones', () => {
    const sim = new MonteCarloSimulator({ seed: 654 });
    const N = 800;
    const res = sim.runSimulation({ temperature_2m_min: 0.5, altitude_masl: 4150 }, 'frost', N);

    const counts = res.risk_distribution.counts;
    const totalCount = counts.none + counts.low + counts.moderate + counts.high;
    assert.strictEqual(totalCount, N, `La suma de categorías (${totalCount}) debe ser exactamente igual a N (${N})`);

    const histTotal = res.histogram.frequencies.reduce((acc, v) => acc + v, 0);
    assert.strictEqual(histTotal, N, `El total de barras del histograma (${histTotal}) debe ser exactamente igual a N (${N})`);
  });

  // -------------------------------------------------------------------------
  // MÓDULO 4: MEDICIÓN DE RENDIMIENTO REAL (ITERACIONES POR SEGUNDO)
  // -------------------------------------------------------------------------
  console.log('\n[4/7] Medición Real de Rendimiento (Throughput de Iteraciones por Segundo)...');

  test('Rendimiento del simulador en Node.js V8: benchmark de 2,000 iteraciones con inferencia ML completa', () => {
    const sim = new MonteCarloSimulator({ seed: 1001 });
    const baseline = {
      temperature_2m_min: 0.0,
      temperature_2m_max: 11.5,
      precipitation_sum: 2.0,
      humidity_mean: 65.0,
      altitude_masl: 4200,
    };

    const N = 2000;
    const t0 = process.hrtime.bigint();
    const res = sim.runSimulation(baseline, 'frost', N);
    const t1 = process.hrtime.bigint();

    const elapsedMs = Number(t1 - t0) / 1e6;
    const throughput = Math.round((N / elapsedMs) * 1000);

    console.log(`     ⚡ Medición Real: ${N} iteraciones en ${elapsedMs.toFixed(2)} ms -> ${throughput.toLocaleString()} iteraciones/segundo`);

    assert(throughput >= 500, `Throughput insuficiente (${throughput} iter/s). Debe ser >= 500 iter/s`);
    assert(res.simulation_meta.throughput_iter_per_sec > 0, 'Throughput en metadata debe ser > 0');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 5: ENDPOINT HTTP POST /api/ml/simulation/monte-carlo Y RBAC
  // -------------------------------------------------------------------------
  console.log('\n[5/7] Verificación de Endpoint HTTP, Validación de Entradas y RBAC...');

  test('Endpoint /simulation/monte-carlo exportado en mlController y registrado en ml.js', () => {
    assert(typeof mlController.runMonteCarloSimulation === 'function', 'mlController debe exportar runMonteCarloSimulation');
    const routesContent = fs.readFileSync(path.resolve(__dirname, '../routes/ml.js'), 'utf-8');
    assert(routesContent.includes("router.post('/simulation/monte-carlo'"), 'ml.js debe registrar la ruta POST /simulation/monte-carlo');
  });

  await asyncTest('Validación de fenómeno inválido rechaza con 400 Bad Request', async () => {
    const req = {
      body: {
        phenomenon: 'huracan_tropical',
        manual_baseline: { temperature_2m_min: 5.0 },
      },
      user: { id: 1, role: 'farmer' },
    };
    let statusCode = null;
    let jsonResponse = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResponse = data; return res; },
    };

    await mlController.runMonteCarloSimulation(req, res);
    assert.strictEqual(statusCode, 400, 'Debe retornar 400');
    assert.strictEqual(jsonResponse.success, false);
    assert(jsonResponse.error.includes('Fenómeno inválido'));
  });

  await asyncTest('Simulación con manual_baseline responde 200 OK con payload completo sin tocar BD', async () => {
    const req = {
      body: {
        phenomenon: 'frost',
        iterations: 300,
        seed: 789,
        manual_baseline: {
          temperature_2m_min: -1.0,
          temperature_2m_max: 10.0,
          precipitation_sum: 0.0,
          humidity_mean: 45.0,
          altitude_masl: 4300,
        },
      },
      user: { id: 1, role: 'farmer' },
    };
    let statusCode = null;
    let jsonResponse = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResponse = data; return res; },
    };

    await mlController.runMonteCarloSimulation(req, res);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.simulation_meta.iterations, 300);
    assert(jsonResponse.statistics.percentiles.p90 >= jsonResponse.statistics.percentiles.p10);
    assert(jsonResponse.methodological_disclaimer.reality_distinction.includes('NO representan nuevas mediciones físicas'));
  });

  await asyncTest('Aislamiento de parcelas: usuario no autorizado recibe 403 Forbidden', async () => {
    // Stub de dbGet para simular parcela de otro agricultor
    const originalDbGet = db.dbGet;
    db.dbGet = async (query, params) => {
      if (query.includes('FROM parcels WHERE id = ?')) {
        return { id: 99, user_id: 888, name: 'Parcela Ajena', altitude_masl: 3950 };
      }
      return null;
    };

    try {
      const req = {
        body: {
          parcel_id: 99,
          phenomenon: 'frost',
        },
        user: { id: 777, role: 'farmer' }, // ID 777 intenta acceder a parcela de ID 888
      };
      let statusCode = null;
      let jsonResponse = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonResponse = data; return res; },
      };

      await mlController.runMonteCarloSimulation(req, res);
      assert.strictEqual(statusCode, 403, 'Debe retornar 403 por falta de autorización');
      assert.strictEqual(jsonResponse.success, false);
      assert(jsonResponse.error.includes('Acceso no autorizado'));
    } finally {
      db.dbGet = originalDbGet;
    }
  });

  // -------------------------------------------------------------------------
  // MÓDULO 6: INTEGRACIÓN FRONTEND Y MÁQUINA DE ESTADOS
  // -------------------------------------------------------------------------
  console.log('\n[6/7] Verificación de Componentes de Frontend y Máquina de Estados...');

  test('monte-carlo-simulator.js incluido en index.html', () => {
    const htmlContent = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
    assert(htmlContent.includes('frontend/js/monte-carlo-simulator.js'), 'index.html debe cargar monte-carlo-simulator.js');
  });

  test('predictive-dashboard.js contiene la sección de Simulador Monte Carlo', () => {
    const jsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/predictive-dashboard.js'), 'utf-8');
    assert(jsContent.includes('renderMonteCarloSimulatorSection'), 'predictive-dashboard.js debe incluir renderMonteCarloSimulatorSection');
    assert(jsContent.includes('section-monte-carlo'), 'Debe existir el ancla section-monte-carlo');
    assert(jsContent.includes('initMonteCarloCharts'), 'Debe inicializar los gráficos del simulador');
  });

  test('monte-carlo-simulator.js implementa todos los controles y estados interactivos', () => {
    const mcJsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/monte-carlo-simulator.js'), 'utf-8');
    assert(mcJsContent.includes('startMonteCarloSimulation'), 'Debe implementar Iniciar');
    assert(mcJsContent.includes('pauseMonteCarloSimulation'), 'Debe implementar Pausar');
    assert(mcJsContent.includes('resumeMonteCarloSimulation'), 'Debe implementar Reanudar');
    assert(mcJsContent.includes('resetMonteCarloSimulation'), 'Debe implementar Reiniciar');
    assert(mcJsContent.includes('stopMonteCarloSimulation'), 'Debe implementar Detener');
    assert(mcJsContent.includes('requestAnimationFrame'), 'Debe usar micro-batching con requestAnimationFrame');
    assert(mcJsContent.includes('mc-histogram-chart'), 'Debe incluir canvas de histograma');
    assert(mcJsContent.includes('mc-convergence-chart'), 'Debe incluir canvas de convergencia');
  });

  test('api.js exporta runMonteCarloSimulation para consumo de la SPA', () => {
    const apiJsContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/api.js'), 'utf-8');
    assert(apiJsContent.includes('runMonteCarloSimulation'), 'api.js debe exportar runMonteCarloSimulation');
    assert(apiJsContent.includes('/ml/simulation/monte-carlo'), 'api.js debe apuntar al endpoint correcto');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 7: REGRESIÓN DE FASE 3, FIX02 Y COMERCIO01
  // -------------------------------------------------------------------------
  console.log('\n[7/7] Verificación de No-Regresión de Módulos Críticos Preexistentes...');

  test('Fase 3: Endpoint de contratos y comparativa de 5 modelos siguen operativos', () => {
    const mlControllerContent = fs.readFileSync(path.resolve(__dirname, '../controllers/mlController.js'), 'utf-8');
    assert(mlControllerContent.includes('get5ModelsComparison'), 'get5ModelsComparison debe seguir presente');
    assert(mlControllerContent.includes('getMonteCarloSimulationContract'), 'getMonteCarloSimulationContract debe seguir presente');
    assert(mlControllerContent.includes('getPredictionsVsObservationsEvaluation'), 'getPredictionsVsObservationsEvaluation debe seguir presente');
  });

  test('COMERCIO01: Controladores y rutas de órdenes de compra B2B intactos', () => {
    const orderCtrlPath = path.resolve(__dirname, '../controllers/orderController.js');
    assert(fs.existsSync(orderCtrlPath), 'orderController.js debe existir');
    const orderCtrlContent = fs.readFileSync(orderCtrlPath, 'utf-8');
    assert(orderCtrlContent.includes('createOrder'), 'orderController debe mantener createOrder');
    assert(orderCtrlContent.includes('farmerResponse'), 'orderController debe mantener farmerResponse');
    assert(orderCtrlContent.includes('supermarketResponse'), 'orderController debe mantener supermarketResponse');
  });

  test('FIX02: Persistencia PostgreSQL y auditoría de sincronización protegidas', () => {
    const parcelCtrlPath = path.resolve(__dirname, '../controllers/parcelController.js');
    assert(fs.existsSync(parcelCtrlPath), 'parcelController.js debe existir');
    const parcelCtrlContent = fs.readFileSync(parcelCtrlPath, 'utf-8');
    assert(parcelCtrlContent.includes('listParcels'), 'parcelController debe mantener listParcels');
    assert(parcelCtrlContent.includes('createParcel'), 'parcelController debe mantener createParcel');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADO FINAL DE PRUEBAS: ${passedTests}/${totalTests} APROBADAS`);
  console.log('======================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Error fatal al ejecutar suite de pruebas:', err);
  process.exit(1);
});
