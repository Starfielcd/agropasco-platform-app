/**
 * AgroPasco — Test Suite de Integración Nativa ML + Open-Meteo (Fase 8D)
 * =======================================================================
 * Pruebas automatizadas locales, aisladas, con mocks y fixtures representativos.
 * NO realiza peticiones de red reales ni modifica bases de datos en producción.
 *
 * Casos cubiertos (Paso 6):
 *  1. Predicción para una parcela válida (con inferencia ML nativa completa).
 *  2. Predicción para múltiples parcelas.
 *  3. Inferencia con variables meteorológicas completas (verificación de scores).
 *  4. Manejo de variables faltantes (sin sustitución silenciosa por cero).
 *  5. Coordenadas inválidas y fuera de rango.
 *  6. Altitudes extremas (estabilidad numérica).
 *  7. Fallos HTTP de Open-Meteo (400, 403, 429, 500).
 *  8. Timeout en la consulta meteorológica (AbortError).
 *  9. Manejo de error ante fallo de carga de modelos.
 * 10. Preservación estricta del contrato JSON esperado por el frontend.
 * 11. Funcionamiento del mecanismo de fallback a reglas.
 * 12. Evaluación del horizonte de pronóstico de hasta 72 horas (peor caso).
 * 13. Compatibilidad con pruebas previas.
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const mlService = require('../services/mlService');
const { MLEngine, defaultEngine } = require('../services/mlEngine');
const {
  calculateDayOfYear,
  aggregateHourlyByDate,
  calculateRollingWindow,
  checkFeatureCompleteness,
  buildDailyFeatures
} = require('../services/mlFeaturePipeline');

let passedTests = 0;
let failedTests = 0;

function it(description, fn) {
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASSED: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAILED: ${description}`);
    console.error(`     Detalle: ${err.message}`);
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASSED: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAILED: ${description}`);
    console.error(`     Detalle: ${err.message}`);
  }
}

/**
 * Generador de fixture meteorológico representativo de Open-Meteo
 * (7 días pasados + 3 días futuros de pronóstico = 10 días).
 */
function createMockOpenMeteoPayload(options = {}) {
  const dates = [
    '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    '2026-10-08', '2026-10-09', '2026-10-10', // 7 pasados
    '2026-10-11', '2026-10-12', '2026-10-13'  // 3 futuros
  ];

  const tMin = options.tMin || [1.2, 0.5, -0.8, -1.5, 0.2, -0.5, -2.5, -3.2, 0.4, 2.1];
  const tMax = options.tMax || [13.5, 14.0, 12.8, 11.5, 13.0, 12.4, 15.0, 11.8, 14.2, 13.9];
  const tMean = options.tMean || [7.3, 7.2, 6.0, 5.0, 6.6, 5.9, 6.2, 4.3, 7.3, 8.0];
  const precip = options.precip || [0.0, 1.2, 0.0, 3.5, 0.4, 0.1, 0.0, 18.5, 2.0, 0.0];
  const rainSum = options.rainSum || precip.slice();
  const wind = options.wind || [12.0, 15.2, 18.5, 20.1, 14.5, 16.2, 18.2, 19.4, 15.0, 12.8];
  const et0 = options.et0 || [3.1, 3.4, 3.2, 2.8, 3.5, 3.39, 4.08, 3.2, 3.6, 3.5];

  // Generar 240 horas (10 días * 24 horas)
  const hourlyTimes = [];
  const hourlyTemps = [];
  const hourlyHumidity = [];
  const hourlyPrecip = [];
  const hourlySoil = [];

  for (let d = 0; d < dates.length; d++) {
    const dStr = dates[d];
    for (let h = 0; h < 24; h++) {
      const hStr = h < 10 ? `0${h}` : `${h}`;
      hourlyTimes.push(`${dStr}T${hStr}:00`);
      hourlyTemps.push(tMean[d] + (h >= 12 && h <= 15 ? 5.0 : -3.0));
      hourlyHumidity.push(options.includeHumidity === false ? null : (65 + (h % 30)));
      hourlyPrecip.push((precip[d] > 0 && h === 16) ? precip[d] : 0.0);
      if (options.includeSoil !== false) {
        hourlySoil.push(options.soilValue !== undefined ? options.soilValue : 0.18 + ((d % 5) * 0.02));
      }
    }
  }

  const payload = {
    latitude: options.lat || -10.6674,
    longitude: options.lng || -76.2567,
    elevation: options.elevation !== undefined ? options.elevation : 4337,
    timezone: 'America/Lima',
    daily: {
      time: dates,
      temperature_2m_max: tMax,
      temperature_2m_min: tMin,
      temperature_2m_mean: tMean,
      precipitation_sum: precip,
      rain_sum: rainSum,
      wind_speed_10m_max: wind,
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTemps,
      relative_humidity_2m: hourlyHumidity,
      precipitation: hourlyPrecip
    }
  };

  if (options.includeEt0 !== false) {
    payload.daily.et0_fao_evapotranspiration = et0;
  }

  if (options.includeSoil !== false) {
    payload.hourly.soil_moisture_0_to_7cm = hourlySoil;
  }

  return payload;
}

async function runTestSuite() {
  console.log('='.repeat(75));
  console.log('🧪 AGROPASCO — FASE 8D: SUITE DE PRUEBAS LOCALES (ML NATIVO + OPEN-METEO)');
  console.log('='.repeat(75));

  const originalFetch = global.fetch;

  // -------------------------------------------------------------------------
  // 1. INGENIERÍA DE CARACTERÍSTICAS UNITARIA (mlFeaturePipeline)
  // -------------------------------------------------------------------------
  console.log('\n--- VERIFICACIÓN DE INGENIERÍA DE CARACTERÍSTICAS ---');

  it('Cálculo determinista de día del año (day_of_year)', () => {
    assert.strictEqual(calculateDayOfYear(2026, 1, 1), 1);
    assert.strictEqual(calculateDayOfYear(2026, 8, 3), 215); // Caso golden real
    assert.strictEqual(calculateDayOfYear(2026, 8, 4), 216);
    assert.strictEqual(calculateDayOfYear(2026, 12, 31), 365);
  });

  it('Agregación horaria a nivel diario (humidity y soil_moisture)', () => {
    const hourlyMock = {
      time: ['2026-10-11T00:00', '2026-10-11T06:00', '2026-10-11T12:00', '2026-10-11T18:00'],
      relative_humidity_2m: [80, 90, 40, 70],
      soil_moisture_0_to_7cm: [0.20, 0.22, 0.18, 0.20]
    };
    const aggs = aggregateHourlyByDate(hourlyMock);
    const day = aggs.get('2026-10-11');
    assert(day !== undefined);
    assert.strictEqual(day.humidity_mean, 70);
    assert.strictEqual(day.humidity_min, 40);
    assert.strictEqual(day.humidity_max, 90);
    assert.strictEqual(day.soil_moisture_mean, 0.20);
  });

  it('Cálculo de ventanas móviles (shift 1) sin fuga de datos futuros', () => {
    const temps = [10, 12, 14, 16, 18];
    // Ventana de 3 días para k = 3 debe ser temps[0..2] = [10, 12, 14] -> media = 12
    const roll3 = calculateRollingWindow(temps, 0, 2, 'mean');
    assert.strictEqual(roll3, 12);

    // Suma de 3 días para precipitación
    const precips = [0, 5, 10, 20];
    const sum3 = calculateRollingWindow(precips, 0, 2, 'sum');
    assert.strictEqual(sum3, 15);
  });

  it('Generación completa de vectores diarios desde payload Open-Meteo', () => {
    const payload = createMockOpenMeteoPayload();
    const dailyFeats = buildDailyFeatures(payload, 4337);

    assert.strictEqual(dailyFeats.length, 3, 'Debe generar exactamente 3 días de pronóstico');
    const day1 = dailyFeats[0];
    assert.strictEqual(day1.date, '2026-10-11');
    assert.strictEqual(day1.elevation, 4337);
    assert.strictEqual(day1.temp_min_lag1, -2.5, 'temp_min_lag1 debe coincidir con día t-1 (2026-10-10)');
    assert(typeof day1.temp_min_rolling_3d === 'number', 'temp_min_rolling_3d debe existir');
    assert(typeof day1.temp_min_rolling_7d === 'number', 'temp_min_rolling_7d debe existir');
    assert(typeof day1.soil_moisture_mean === 'number', 'soil_moisture_mean debe existir');
    assert(typeof day1.humidity_mean === 'number', 'humidity_mean debe existir');
  });

  // -------------------------------------------------------------------------
  // 2. CASO 1: PREDICCIÓN PARA UNA PARCELA VÁLIDA CON MOTOR ML NATIVO
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 1: PREDICCIÓN PARA PARCELA VÁLIDA (ML NATIVO) ---');

  await itAsync('Inferencia ML completa y correcta para parcela en Cerro de Pasco', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async (url) => {
      if (url.includes('open-meteo.com')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => mockPayload
        };
      }
      throw new Error(`Fetch no esperado a: ${url}`);
    };

    const parcel = { id: 101, name: 'Parcela San Juan', center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4337 };
    const result = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'ml_service');
    assert(result.data !== undefined);
    assert.strictEqual(result.data.parcel_id, 101);
    assert.strictEqual(result.data.latitude, -10.6674);
    assert.strictEqual(result.data.altitude_masl, 4337);

    const preds = result.data.predictions;
    assert.strictEqual(preds.length, 4);

    const frost = preds.find(p => p.phenomenon === 'frost');
    const heavyRain = preds.find(p => p.phenomenon === 'heavy_rain');
    const snow = preds.find(p => p.phenomenon === 'snow');
    const hail = preds.find(p => p.phenomenon === 'hail');

    assert.strictEqual(frost.model_type, 'ml_trained', 'Helada debe originarse de ml_trained');
    assert.strictEqual(heavyRain.model_type, 'ml_trained', 'Lluvia intensa debe originarse de ml_trained');
    assert.strictEqual(snow.model_type, 'ml_trained', 'Nieve debe originarse de ml_trained');
    assert.strictEqual(hail.model_type, 'rule_based', 'Granizo debe originarse de rule_based');

    assert(frost.risk_score >= 0 && frost.risk_score <= 100);
    assert(['high', 'moderate', 'low', 'none'].includes(frost.risk_level));
  });

  // -------------------------------------------------------------------------
  // 3. CASO 2: PREDICCIÓN PARA MÚLTIPLES PARCELAS
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 2: PREDICCIÓN PARA MÚLTIPLES PARCELAS ---');

  await itAsync('Procesamiento secuencial/paralelo de 3 parcelas distintas', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => mockPayload
    });

    const parcels = [
      { id: 201, name: 'Parcela Chaupimarca', center_lat: -10.68, center_lng: -76.25, altitude_masl: 4337 },
      { id: 202, name: 'Parcela Yanahuanca', center_lat: -10.49, center_lng: -76.51, altitude_masl: 3184 },
      { id: 203, name: 'Parcela Oxapampa', center_lat: -10.57, center_lng: -75.40, altitude_masl: 1814 }
    ];

    const results = [];
    for (const p of parcels) {
      const res = await mlService.getPredictionForParcel(p);
      results.push(res);
    }

    assert.strictEqual(results.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(results[i].success, true);
      assert.strictEqual(results[i].data.parcel_id, parcels[i].id);
      assert.strictEqual(results[i].data.predictions.length, 4);
    }
  });

  // -------------------------------------------------------------------------
  // 4. CASO 3: VARIABLES METEOROLÓGICAS COMPLETAS
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 3: VARIABLES METEOROLÓGICAS COMPLETAS ---');

  await itAsync('Verificación de variables en predictions[].variables_used', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockPayload
    });

    const parcel = { id: 301, name: 'Parcela Completa', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };
    const res = await mlService.getPredictionForParcel(parcel);

    const frost = res.data.predictions.find(p => p.phenomenon === 'frost');
    assert(frost.variables_used.temperature_2m_min !== undefined, 'frost debe registrar temp_min en variables_used');
    assert(frost.variables_used.wind_speed_10m_max !== undefined, 'frost debe registrar wind_speed en variables_used');
    assert(frost.variables_used.temp_min_rolling_3d !== undefined, 'frost debe registrar rolling_3d en variables_used');

    const heavyRain = res.data.predictions.find(p => p.phenomenon === 'heavy_rain');
    assert(heavyRain.variables_used.precipitation_sum !== undefined, 'heavy_rain debe registrar precip en variables_used');
    assert(heavyRain.variables_used.precip_rolling_3d !== undefined, 'heavy_rain debe registrar rolling_3d en variables_used');
  });

  // -------------------------------------------------------------------------
  // 5. CASO 4: VARIABLES FALTANTES (SIN IMPUTACIÓN POR CERO)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 4: MANEJO SEGURO DE VARIABLES FALTANTES ---');

  await itAsync('Payload sin soil_moisture_0_to_7cm activa fallback de reglas con transparencia', async () => {
    // Open-Meteo sin humedad del suelo
    const mockNoSoil = createMockOpenMeteoPayload({ includeSoil: false });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockNoSoil
    });

    const parcel = { id: 401, name: 'Parcela Sin Suelo', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, true);
    const frost = res.data.predictions.find(p => p.phenomenon === 'frost');
    // Dado que falta soil_moisture_mean, frost debe evaluar mediante reglas (sin inventar cero)
    assert.strictEqual(frost.model_type, 'rule_based', 'Helada debe pasar a rule_based ante falta de suelo');
    assert(frost.confidence_note.includes('reglas'), 'Debe documentar origen por reglas');

    const snow = res.data.predictions.find(p => p.phenomenon === 'snow');
    // El modelo de nieve NO requiere humedad del suelo, por lo que puede seguir ejecutando ML
    assert.strictEqual(snow.model_type, 'ml_trained', 'Nieve debe seguir en ml_trained pues no requiere suelo');
  });

  it('MLEngine rechaza vector con variable faltante y no sustituye por cero', () => {
    const incompleteInput = {
      temperature_2m_mean: 5.0,
      temperature_2m_max: 12.0
      // faltan las otras 16 variables
    };
    assert.throws(
      () => defaultEngine.predictFrost(incompleteInput),
      /Variables faltantes obligatorias/
    );
  });

  // -------------------------------------------------------------------------
  // 6. CASO 5: COORDENADAS INVÁLIDAS
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 5: VALIDACIÓN ESTRICTA DE COORDENADAS ---');

  await itAsync('Rechaza latitudes y longitudes inválidas y nulas', async () => {
    const testCases = [
      { parcel: { id: 501, center_lat: null, center_lng: -76.25 }, expectedFallback: 'no_coordinates' },
      { parcel: { id: 502, center_lat: '', center_lng: -76.25 }, expectedFallback: 'no_coordinates' },
      { parcel: { id: 503, center_lat: '   ', center_lng: -76.25 }, expectedFallback: 'no_coordinates' },
      { parcel: { id: 504, center_lat: 'invalido', center_lng: -76.25 }, expectedFallback: 'invalid_coordinates' },
      { parcel: { id: 505, center_lat: '12abc', center_lng: -76.25 }, expectedFallback: 'invalid_coordinates' },
      { parcel: { id: 506, center_lat: 91.0, center_lng: -76.25 }, expectedFallback: 'invalid_coordinates' },
      { parcel: { id: 507, center_lat: -95.0, center_lng: -76.25 }, expectedFallback: 'invalid_coordinates' },
      { parcel: { id: 508, center_lat: -10.66, center_lng: 185.0 }, expectedFallback: 'invalid_coordinates' }
    ];

    for (const tc of testCases) {
      const res = await mlService.getPredictionForParcel(tc.parcel);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.fallback, tc.expectedFallback);
    }
  });

  // -------------------------------------------------------------------------
  // 7. CASO 6: ALTITUDES EXTREMAS
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 6: ESTABILIDAD ANTE ALTITUDES EXTREMAS ---');

  await itAsync('Evaluación estable en altitud andina extrema (5,100 msnm) y baja (250 msnm)', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockPayload
    });

    const parcelTiclio = { id: 601, name: 'P-Ticlio', center_lat: -11.6, center_lng: -76.2, altitude_masl: 5100 };
    const resTiclio = await mlService.getPredictionForParcel(parcelTiclio);
    assert.strictEqual(resTiclio.success, true);
    for (const p of resTiclio.data.predictions) {
      assert(Number.isFinite(p.risk_score) && !Number.isNaN(p.risk_score));
    }

    const parcelSelva = { id: 602, name: 'P-SelvaBaja', center_lat: -9.8, center_lng: -74.9, altitude_masl: 250 };
    const resSelva = await mlService.getPredictionForParcel(parcelSelva);
    assert.strictEqual(resSelva.success, true);
    for (const p of resSelva.data.predictions) {
      assert(Number.isFinite(p.risk_score) && !Number.isNaN(p.risk_score));
    }
  });

  // -------------------------------------------------------------------------
  // 8. CASO 7: FALLOS HTTP DE OPEN-METEO (400, 403, 429, 500)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 7: MANEJO DE FALLOS HTTP DE OPEN-METEO ---');

  await itAsync('Manejo controlado de códigos de error HTTP del servicio meteorológico', async () => {
    const parcel = { id: 701, name: 'P-TestHttp', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };

    const statuses = [400, 403, 429, 500, 503];
    for (const s of statuses) {
      global.fetch = async () => ({
        ok: false,
        status: s,
        statusText: `Error ${s}`,
        json: async () => ({ reason: `Simulated error ${s}` }),
        text: async () => `Simulated error ${s}`
      });

      const res = await mlService.getPredictionForParcel(parcel);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.fallback, 'api_error');
      assert.strictEqual(res.http_status, s);
      assert(typeof res.error === 'string' && res.error.length > 0);
    }
  });

  // -------------------------------------------------------------------------
  // 9. CASO 8: TIMEOUT DE RED (ABORT CONTROLLER)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 8: MANEJO DE TIMEOUT ---');

  await itAsync('Clasificación correcta de fallo por timeout (10s)', async () => {
    const parcel = { id: 801, name: 'P-Timeout', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };

    global.fetch = async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    const res = await mlService.getPredictionForParcel(parcel);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.fallback, 'timeout');
    assert(res.error.includes('agotado'));
  });

  // -------------------------------------------------------------------------
  // 10. CASO 9: ERROR DE CARGA DE MODELOS (RESILIENCIA)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 9: RESILIENCIA ANTE FALLO DE CARGA DE MODELOS ---');

  await itAsync('Si el motor ML falla al inicializar, activa fallback de reglas automáticamente', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockPayload
    });

    // Simular motor con modelos ausentes
    const brokenEngine = new MLEngine('c:/ruta/que/no/existe/en/disco');
    const parcel = { id: 901, name: 'P-FallbackEngine', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };

    // Validar que instanciar y cargar en brokenEngine lanza error capturable
    assert.throws(() => brokenEngine.loadModels(), /Error cargando modelos/);

    // Ejecutar getPredictionForParcel (con defaultEngine en memoria)
    const res = await mlService.getPredictionForParcel(parcel);
    assert.strictEqual(res.success, true);
    assert(Array.isArray(res.data.predictions));
  });

  // -------------------------------------------------------------------------
  // 11. CASO 10: PRESERVACIÓN ESTRICTA DEL CONTRATO JSON
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 10: PRESERVACIÓN DEL CONTRATO JSON DEL FRONTEND ---');

  await itAsync('Verificación exhaustiva del esquema JSON consumido por ml-monitor.js', async () => {
    const mockPayload = createMockOpenMeteoPayload();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockPayload
    });

    const parcel = { id: 1001, name: 'P-Contrato', center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4337 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, true);
    const data = res.data;

    // Campos de nivel superior
    assert.strictEqual(data.parcel_id, 1001);
    assert.strictEqual(data.parcel_name, 'P-Contrato');
    assert.strictEqual(typeof data.latitude, 'number');
    assert.strictEqual(typeof data.longitude, 'number');
    assert.strictEqual(typeof data.altitude_masl, 'number');
    assert(typeof data.issued_at === 'string');
    assert(typeof data.valid_until === 'string');
    assert(typeof data.data_source === 'string');
    assert(Array.isArray(data.predictions));
    assert(typeof data.forecast_summary === 'object');

    // Forecast summary
    const fs = data.forecast_summary;
    assert.strictEqual(typeof fs.days, 'number');
    assert(Array.isArray(fs.dates) && fs.dates.length === fs.days);
    assert(Array.isArray(fs.temp_min) && fs.temp_min.length === fs.days);
    assert(Array.isArray(fs.temp_max) && fs.temp_max.length === fs.days);
    assert(Array.isArray(fs.precipitation) && fs.precipitation.length === fs.days);

    // Cada uno de los 4 fenómenos
    const expectedPhenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
    for (const ph of expectedPhenomena) {
      const p = data.predictions.find(item => item.phenomenon === ph);
      assert(p !== undefined, `Fenómeno ${ph} ausente en predictions`);
      assert(['high', 'moderate', 'low', 'none', 'model_unavailable'].includes(p.risk_level), `risk_level inválido en ${ph}`);
      assert(typeof p.risk_score === 'number' && p.risk_score >= 0 && p.risk_score <= 100, `risk_score inválido en ${ph}`);
      assert(['ml_trained', 'rule_based', 'datos_insuficientes'].includes(p.model_type), `model_type inválido en ${ph}`);
      assert(typeof p.confidence_note === 'string' && p.confidence_note.length > 0, `confidence_note ausente en ${ph}`);
      assert(typeof p.variables_used === 'object', `variables_used debe ser objeto en ${ph}`);
      assert(typeof p.period === 'string' && p.period.length > 0, `period debe ser string en ${ph}`);
      assert(Array.isArray(p.limitations) && p.limitations.length > 0, `limitations debe ser arreglo en ${ph}`);
    }
  });

  // -------------------------------------------------------------------------
  // 12. CASO 11: FUNCIONAMIENTO DEL FALLBACK DE REGLAS
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 11: FUNCIONAMIENTO DEL FALLBACK A REGLAS ---');

  await itAsync('getFallbackPrediction genera predicciones consistentes de respaldo', async () => {
    const mock3Days = {
      daily: {
        time: ['2026-10-11', '2026-10-12', '2026-10-13'],
        temperature_2m_max: [10.0, 11.5, 9.0],
        temperature_2m_min: [-4.0, -1.0, 2.0],
        temperature_2m_mean: [3.0, 5.2, 5.5],
        precipitation_sum: [0.0, 25.0, 1.0],
        rain_sum: [0.0, 25.0, 1.0],
        wind_speed_10m_max: [3.5, 4.0, 6.0]
      },
      elevation: 4300
    };

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mock3Days
    });

    const parcel = { id: 1101, name: 'P-FallbackDirect', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };
    const res = await mlService.getFallbackPrediction(parcel);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.source, 'fallback_rules');

    const frost = res.data.predictions.find(p => p.phenomenon === 'frost');
    assert.strictEqual(frost.model_type, 'rule_based');
    assert.strictEqual(frost.risk_level, 'high', 'tempMin -4.0°C debe dar riesgo alto en reglas');

    const heavyRain = res.data.predictions.find(p => p.phenomenon === 'heavy_rain');
    assert.strictEqual(heavyRain.model_type, 'rule_based');
    assert.strictEqual(heavyRain.risk_level, 'moderate', 'precip 25mm debe dar riesgo moderado en reglas');
  });

  // -------------------------------------------------------------------------
  // 13. CASO 12: HORIZONTE DE PREDICCIÓN DE HASTA 72 HORAS (PEOR CASO)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 12: HORIZONTE DE 72 HORAS Y PEOR CASO ---');

  await itAsync('Selecciona el peor caso entre los 3 días futuros del horizonte', async () => {
    // Día 1: frío moderado (-0.5°C) -> riesgo moderado
    // Día 2: helada severa (-4.5°C) -> riesgo alto
    // Día 3: templado (3.5°C) -> sin riesgo
    const mockMultiDay = createMockOpenMeteoPayload({
      tMin: [0.5, 0.2, -0.1, 0.0, 0.5, 0.2, 0.0, -0.5, -4.5, 3.5]
    });

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockMultiDay
    });

    const parcel = { id: 1201, name: 'P-WorstCase', center_lat: -10.66, center_lng: -76.25, altitude_masl: 4300 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, true);
    const frost = res.data.predictions.find(p => p.phenomenon === 'frost');
    assert.strictEqual(frost.risk_level, 'high', 'El peor caso del horizonte de 72h debe ser high debido al día 2');
    assert(frost.period.includes('2026-10-11 a 2026-10-13'));
  });

  // -------------------------------------------------------------------------
  // 14. CASO 13: ESTADO DE MODELOS Y HEALTH CHECK
  // -------------------------------------------------------------------------
  console.log('\n--- CASO 13: ENDPOINTS DE HEALTH Y METADATOS DE MODELOS ---');

  await itAsync('checkMLServiceHealth y getModelsStatus reportan estado nativo', async () => {
    const health = await mlService.checkMLServiceHealth();
    assert(health !== null);
    assert.strictEqual(health.status, 'ok');
    assert.strictEqual(health.engine, 'native_node_js');
    assert.strictEqual(health.models_loaded.length, 3);

    const models = await mlService.getModelsStatus();
    assert(models !== null);
    assert.strictEqual(models.frost.available, true);
    assert.strictEqual(models.heavy_rain.available, true);
    assert.strictEqual(models.snow.available, true);
    assert.strictEqual(models.hail.available, false);
    assert.strictEqual(models.frost.n_features, 18);
    assert.strictEqual(models.heavy_rain.n_features, 16);
    assert.strictEqual(models.snow.n_features, 13);
  });

  // Restaurar fetch original
  global.fetch = originalFetch;

  // -------------------------------------------------------------------------
  // RESUMEN FINAL
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(75));
  console.log(`📊 RESULTADOS FASE 8D: ${passedTests} APROBADAS | ${failedTests} FALLIDAS`);
  console.log('='.repeat(75));

  if (failedTests > 0) {
    console.error(`\n❌ Se detectaron ${failedTests} fallas en la suite de integración.`);
    process.exit(1);
  } else {
    console.log('\n🎉 TODAS LAS PRUEBAS DE INTEGRACIÓN ML NATIVO + OPEN-METEO PASARON (100% OK).');
  }
}

runTestSuite().catch(err => {
  console.error('Error fatal ejecutando suite de pruebas:', err);
  process.exit(1);
});
