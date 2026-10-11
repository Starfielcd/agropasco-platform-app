/**
 * AgroPasco — Suite Automatizada de Equivalencia Matemática y Rendimiento (Fase 8C)
 * ===============================================================================
 * Compara las predicciones generadas por el motor nativo Node.js (`mlEngine.js`)
 * con las predicciones generadas en Python (`scikit-learn`) sobre 210 vectores golden.
 *
 * Criterios de validación:
 *  - Regresión Logística (Nevadas): Max error <= 1e-6
 *  - Gradient Boosting (Heladas): Max error <= 1e-4
 *  - Random Forest (Lluvias Intensas): Max error <= 1e-4
 *  - Nivel de riesgo ordinal: 100.0% de coincidencia
 *  - Rechazo estricto de variables faltantes e inválidas
 *  - Mediciones reales de memoria, tiempo de carga y latencia
 */

const fs = require('fs');
const path = require('path');
const { MLEngine } = require('../services/mlEngine');

const FIXTURES_PATH = path.resolve(__dirname, 'fixtures/golden_ml_test_cases.json');
const MODELS_DIR = path.resolve(__dirname, '../data/models-json');

async function runTestSuite() {
  console.log('='.repeat(70));
  console.log('AGROPASCO — FASE 8C: PRUEBAS DE EQUIVALENCIA Y RECURSOS (Node.js)');
  console.log('='.repeat(70));

  let passedVerifications = 0;
  let totalVerifications = 0;
  const failedTests = [];

  function assert(condition, testName, details = '') {
    totalVerifications++;
    if (condition) {
      passedVerifications++;
    } else {
      failedTests.push({ testName, details });
      console.error(`  ❌ FALLO: ${testName} ${details ? '(' + details + ')' : ''}`);
    }
  }

  // =========================================================================
  // SECCIÓN 1: MEDICIÓN REAL DE ARTEFACTOS Y CARGA EN MEMORIA
  // =========================================================================
  console.log('\n[1/5] Verificación de artefactos JSON y huella en disco...');

  const frostFile = path.join(MODELS_DIR, 'frost_model.json');
  const heavyRainFile = path.join(MODELS_DIR, 'heavy_rain_model.json');
  const snowFile = path.join(MODELS_DIR, 'snow_model.json');

  assert(fs.existsSync(frostFile), 'frost_model.json existe en disco');
  assert(fs.existsSync(heavyRainFile), 'heavy_rain_model.json existe en disco');
  assert(fs.existsSync(snowFile), 'snow_model.json existe en disco');

  const frostSizeKB = fs.statSync(frostFile).size / 1024;
  const heavyRainSizeKB = fs.statSync(heavyRainFile).size / 1024;
  const snowSizeKB = fs.statSync(snowFile).size / 1024;
  const totalModelsSizeKB = frostSizeKB + heavyRainSizeKB + snowSizeKB;

  console.log(`  - frost_model.json:      ${frostSizeKB.toFixed(1)} KB`);
  console.log(`  - heavy_rain_model.json: ${heavyRainSizeKB.toFixed(1)} KB`);
  console.log(`  - snow_model.json:       ${snowSizeKB.toFixed(2)} KB`);
  console.log(`  - Total en disco:        ${totalModelsSizeKB.toFixed(1)} KB (< 0.6 MB)`);

  // Medición de memoria antes y después de cargar en Node.js
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();

  const loadStartTime = process.hrtime.bigint();
  const engine = new MLEngine(MODELS_DIR);
  engine.loadModels();
  const loadEndTime = process.hrtime.bigint();

  const memAfter = process.memoryUsage();
  const loadTimeMs = Number(loadEndTime - loadStartTime) / 1e6;
  const heapDeltaMB = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

  console.log(`  - Tiempo de carga:       ${loadTimeMs.toFixed(2)} ms`);
  console.log(`  - Heap usado delta:      ${heapDeltaMB > 0 ? heapDeltaMB.toFixed(2) : '< 1.0'} MB`);
  assert(engine.isLoaded, 'MLEngine inicializado con éxito');

  // =========================================================================
  // SECCIÓN 2: CARGA DEL CONJUNTO GOLDEN (210 VECTORES)
  // =========================================================================
  console.log('\n[2/5] Cargando conjunto golden de validación cruzada...');
  assert(fs.existsSync(FIXTURES_PATH), 'Archivo golden_ml_test_cases.json existe');

  const goldenCases = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8'));
  console.log(`  - Total de casos golden: ${goldenCases.length} vectores`);
  assert(goldenCases.length >= 200, `Conjunto golden contiene >= 200 casos (${goldenCases.length})`);

  // =========================================================================
  // SECCIÓN 3: PRUEBAS DE EQUIVALENCIA MATEMÁTICA PYTHON ↔ NODE.JS
  // =========================================================================
  console.log('\n[3/5] Ejecutando pruebas de equivalencia numérica...');

  let maxDiffSnow = 0;
  let maxDiffFrost = 0;
  let maxDiffHeavyRain = 0;

  let riskMatchesSnow = 0;
  let riskMatchesFrost = 0;
  let riskMatchesHeavyRain = 0;

  for (const tc of goldenCases) {
    const feat = tc.features;
    const exp = tc.expected;

    // A. NEVADAS (LogisticRegression)
    const snowPred = engine.predictSnow(feat);
    const diffSnow = Math.abs(snowPred.probability - exp.snow.probability);
    if (diffSnow > maxDiffSnow) maxDiffSnow = diffSnow;

    if (snowPred.risk_level === exp.snow.risk_level) riskMatchesSnow++;
    assert(
      diffSnow <= 1e-6,
      `Caso #${tc.test_id} [Snow] tolerancia <= 1e-6`,
      `Diff=${diffSnow.toExponential(4)}, Node=${snowPred.probability.toFixed(6)}, Py=${exp.snow.probability.toFixed(6)}`
    );
    assert(
      snowPred.risk_level === exp.snow.risk_level,
      `Caso #${tc.test_id} [Snow] nivel de riesgo idéntico`,
      `Node=${snowPred.risk_level}, Py=${exp.snow.risk_level}`
    );

    // B. HELADAS (GradientBoostingClassifier)
    const frostPred = engine.predictFrost(feat);
    const diffFrost = Math.abs(frostPred.probability - exp.frost.probability);
    if (diffFrost > maxDiffFrost) maxDiffFrost = diffFrost;

    if (frostPred.risk_level === exp.frost.risk_level) riskMatchesFrost++;
    assert(
      diffFrost <= 1e-4,
      `Caso #${tc.test_id} [Frost] tolerancia <= 1e-4`,
      `Diff=${diffFrost.toExponential(4)}, Node=${frostPred.probability.toFixed(6)}, Py=${exp.frost.probability.toFixed(6)}`
    );
    assert(
      frostPred.risk_level === exp.frost.risk_level,
      `Caso #${tc.test_id} [Frost] nivel de riesgo idéntico`,
      `Node=${frostPred.risk_level}, Py=${exp.frost.risk_level}`
    );

    // C. LLUVIAS INTENSAS (RandomForestClassifier)
    const hrPred = engine.predictHeavyRain(feat);
    const diffHR = Math.abs(hrPred.probability - exp.heavy_rain.probability);
    if (diffHR > maxDiffHeavyRain) maxDiffHeavyRain = diffHR;

    if (hrPred.risk_level === exp.heavy_rain.risk_level) riskMatchesHeavyRain++;
    assert(
      diffHR <= 1e-4,
      `Caso #${tc.test_id} [HeavyRain] tolerancia <= 1e-4`,
      `Diff=${diffHR.toExponential(4)}, Node=${hrPred.probability.toFixed(6)}, Py=${exp.heavy_rain.probability.toFixed(6)}`
    );
    assert(
      hrPred.risk_level === exp.heavy_rain.risk_level,
      `Caso #${tc.test_id} [HeavyRain] nivel de riesgo idéntico`,
      `Node=${hrPred.risk_level}, Py=${exp.heavy_rain.risk_level}`
    );
  }

  console.log('\n  --- Resultados de Paridad Numérica ---');
  console.log(`  • Nevadas (Logistic Regression):`);
  console.log(`    - Máxima diferencia:     ${maxDiffSnow.toExponential(4)} (Criterio: <= 1e-6)`);
  console.log(`    - Concordancia de nivel: ${(riskMatchesSnow / goldenCases.length * 100).toFixed(1)}% (${riskMatchesSnow}/${goldenCases.length})`);

  console.log(`  • Heladas (Gradient Boosting):`);
  console.log(`    - Máxima diferencia:     ${maxDiffFrost.toExponential(4)} (Criterio: <= 1e-4)`);
  console.log(`    - Concordancia de nivel: ${(riskMatchesFrost / goldenCases.length * 100).toFixed(1)}% (${riskMatchesFrost}/${goldenCases.length})`);

  console.log(`  • Lluvias Intensas (Random Forest):`);
  console.log(`    - Máxima diferencia:     ${maxDiffHeavyRain.toExponential(4)} (Criterio: <= 1e-4)`);
  console.log(`    - Concordancia de nivel: ${(riskMatchesHeavyRain / goldenCases.length * 100).toFixed(1)}% (${riskMatchesHeavyRain}/${goldenCases.length})`);

  // =========================================================================
  // SECCIÓN 4: VALIDACIÓN ESTRICTA Y RECHAZO DE ENTRADAS INVÁLIDAS
  // =========================================================================
  console.log('\n[4/5] Pruebas de robustez y rechazo de entradas inválidas...');

  const validSample = { ...goldenCases[0].features };

  // 1. Variable faltante obligatoria
  const sampleMissing = { ...validSample };
  delete sampleMissing.temperature_2m_mean;
  let thrownMissing = false;
  try {
    engine.predictFrost(sampleMissing);
  } catch (err) {
    thrownMissing = err.message.includes('Variables faltantes');
  }
  assert(thrownMissing, 'Rechaza variable faltante sin imputar con cero');

  // 2. Valor NaN
  const sampleNaN = { ...validSample, soil_moisture_mean: NaN };
  let thrownNaN = false;
  try {
    engine.predictHeavyRain(sampleNaN);
  } catch (err) {
    thrownNaN = err.message.includes('valores no numéricos');
  }
  assert(thrownNaN, 'Rechaza valor NaN');

  // 3. Valor null
  const sampleNull = { ...validSample, elevation: null };
  let thrownNull = false;
  try {
    engine.predictSnow(sampleNull);
  } catch (err) {
    thrownNull = err.message.includes('Variables faltantes');
  }
  assert(thrownNull, 'Rechaza valor null');

  // 4. Cadena de texto
  const sampleString = { ...validSample, temp_range: '12.5abc' };
  let thrownString = false;
  try {
    engine.predictFrost(sampleString);
  } catch (err) {
    thrownString = err.message.includes('valores no numéricos');
  }
  assert(thrownString, 'Rechaza valor alfanumérico');

  // 5. Inferencia completa integrada con predictAll (incluye regla de granizo)
  const fullPrediction = engine.predictAll(validSample);
  assert(Array.isArray(fullPrediction.predictions), 'predictAll devuelve array de predicciones');
  assert(fullPrediction.predictions.length === 4, 'predictAll devuelve exactamente 4 fenómenos');

  const hailPred = fullPrediction.predictions.find(p => p.phenomenon === 'hail');
  assert(hailPred && hailPred.model_type === 'rule_based', 'Granizo se clasifica explícitamente como rule_based');

  // =========================================================================
  // SECCIÓN 5: MEDICIÓN REAL DE RENDIMIENTO Y LATENCIA
  // =========================================================================
  console.log('\n[5/5] Medición real de latencia y throughput (1,000 iteraciones)...');

  const benchmarkIterations = 1000;
  const benchSample = goldenCases[0].features;

  const benchStartTime = process.hrtime.bigint();
  for (let i = 0; i < benchmarkIterations; i++) {
    engine.predictAll(benchSample);
  }
  const benchEndTime = process.hrtime.bigint();

  const totalBenchMs = Number(benchEndTime - benchStartTime) / 1e6;
  const avgLatencyPerParcelMs = totalBenchMs / benchmarkIterations;
  const throughputOpsSec = Math.round((benchmarkIterations / (totalBenchMs / 1000)));

  console.log(`  - 1,000 evaluaciones completas (4 fenómenos): ${totalBenchMs.toFixed(2)} ms`);
  console.log(`  - Latencia media por parcela:                  ${avgLatencyPerParcelMs.toFixed(3)} ms`);
  console.log(`  - Capacidad de procesamiento (throughput):     ${throughputOpsSec.toLocaleString()} parcelas/segundo`);

  assert(avgLatencyPerParcelMs < 10.0, 'Latencia por parcela inferior a 10 ms (medido: ' + avgLatencyPerParcelMs.toFixed(3) + ' ms)');

  // =========================================================================
  // RESUMEN FINAL
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN DE VERIFICACIONES:');
  console.log(`  Total de verificaciones: ${totalVerifications}`);
  console.log(`  Aprobadas:                ${passedVerifications}`);
  console.log(`  Fallidas:                 ${failedTests.length}`);
  console.log('='.repeat(70));

  if (failedTests.length === 0) {
    console.log('🎉 TODAS LAS VERIFICACIONES DE EQUIVALENCIA Y RENDIMIENTO APROBADAS.\n');
    process.exit(0);
  } else {
    console.error(`❌ Se detectaron ${failedTests.length} fallos en las pruebas.`);
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal error en test suite:', err);
  process.exit(1);
});
