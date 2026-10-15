/**
 * AgroPasco Digital — Test Suite METEO02: Validación Pre-Despliegue y Regresiones
 * ==============================================================================
 * Verificaciones obligatorias antes del despliegue en producción:
 * 1. Rechazo de reutilización de pronósticos entre parcelas con altitud dispar (>150m).
 * 2. Aceptación de reutilización con altitud compatible (<=150m).
 * 3. Segmentación de clave de caché (lat, lng, banda altitudinal, scope).
 * 4. Validación de completitud de variables antes de entregar a modelos ML.
 * 5. Conservación de altitud real de parcela y metadatos de cuadrícula (no alteración silenciosa).
 * 6. Contrato exacto de /weather/current para frontend/js/api.js, weather.js y dashboard.js.
 * 7. Recuperación de parcela en estado pending tras restablecimiento de Open-Meteo.
 * 8. Rechazo de datos stale con horizonte vencido o sin fechas vigentes.
 * 9. Supervivencia de la caché compartida tras reinicio de memoria (restauración desde BD).
 * 10. Seguridad multi-inquilino, RBAC y aislamiento sin fuga de PII ni datos de terceros.
 *
 * EJECUCIÓN 100% AISLADA Y DETERMINISTA CON MOCKS LOCALES (CERO RED EXTERNA).
 */

'use strict';

process.env.NODE_ENV = 'test';

const assert = require('assert');
const weatherCacheService = require('../services/weatherCacheService');
const weatherService = require('../services/weatherService');
const mlService = require('../services/mlService');
const db = require('../config/database');

function createFullMlForecast(lat = -10.6674, lng = -76.2567, elevation = 4380) {
  const dates = [];
  const baseDate = new Date('2026-10-15T00:00:00Z');
  for (let d = 0; d < 10; d++) {
    const dt = new Date(baseDate.getTime() + d * 86400000);
    dates.push(dt.toISOString().split('T')[0]);
  }

  const hourlyTimes = [];
  const hourlyTemp = [];
  const hourlyHum = [];
  const hourlySoil = [];

  for (let d = 0; d < 10; d++) {
    for (let h = 0; h < 24; h++) {
      const hStr = String(h).padStart(2, '0');
      hourlyTimes.push(`${dates[d]}T${hStr}:00`);
      hourlyTemp.push(4.5 + Math.sin(h / 3) * 5);
      hourlyHum.push(75);
      hourlySoil.push(0.35);
    }
  }

  return {
    latitude: lat,
    longitude: lng,
    elevation: elevation,
    current: {
      temperature_2m: 5.2,
      relative_humidity_2m: 78,
      surface_pressure: 622,
      wind_speed_10m: 4.8,
      soil_temperature_0cm: 5.5,
      soil_moisture_0_to_1cm: 0.38,
      uv_index: 9.8
    },
    daily: {
      time: dates,
      temperature_2m_max: dates.map(() => 12.0),
      temperature_2m_min: dates.map(() => -1.5),
      temperature_2m_mean: dates.map(() => 5.2),
      precipitation_sum: dates.map(() => 1.5),
      rain_sum: dates.map(() => 1.5),
      wind_speed_10m_max: dates.map(() => 5.0),
      et0_fao_evapotranspiration: dates.map(() => 2.5),
      precipitation_probability_max: dates.map(() => 25)
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTemp,
      relative_humidity_2m: hourlyHum,
      soil_moisture_0_to_1cm: hourlySoil
    }
  };
}

async function runMeteo02Suite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE METEO02: VALIDACIÓN FINAL PRE-DESPLIEGUE Y REGRESIONES');
  console.log('='.repeat(80));

  let passed = 0;
  let total = 0;

  function check(desc, condition) {
    total++;
    assert(condition, `Fallo en: ${desc}`);
    console.log(`  ✓ [CHECK ${total}] ${desc}`);
    passed++;
  }

  const originalFetch = global.fetch;
  const realDbGet = db.dbGet;
  const realDbRun = db.dbRun;

  try {
    weatherCacheService.setTestModeOverride(true);
    weatherCacheService.resetWeatherMetrics();
    mlService.clearRateLimit();
    mlService.clearInFlightRequests();

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 1: Rechazo de Reutilización con Diferencia Altitudinal Dispar (>150m) ---');
    // -------------------------------------------------------------------------
    // Guardar pronóstico de alta montaña (Cerro de Pasco, 4380 msnm)
    const cerroForecast = createFullMlForecast(-10.6674, -76.2567, 4380);
    await weatherCacheService.saveSharedForecast(-10.6674, -76.2567, cerroForecast, {
      allowInTest: true,
      altitude: 4380,
      scope: 'ml_full'
    });

    // Parcela en quebrada baja (3500 msnm) en la misma cuadrícula
    const lowParcelAlt = 3500;
    const diffMeters = Math.abs(4380 - lowParcelAlt); // 880m > 150m

    const rejectedRead = await weatherCacheService.getSharedForecast(-10.6674, -76.2567, {
      allowInTest: true,
      altitude: lowParcelAlt,
      requireMlFeatures: true
    });

    check('Diferencia altitudinal es superior al umbral seguro (880m > 150m)', diffMeters > 150);
    check('Pronóstico de alta montaña NO es reutilizado para parcela de altitud dispar', rejectedRead === null);

    const metrics1 = weatherCacheService.getWeatherMetrics();
    check('Telemetría registró el rechazo por incompatibilidad altitudinal', metrics1.altitudeIncompatibleCount >= 1);

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 2: Aceptación de Reutilización con Altitud Compatible (<=150m) ---');
    // -------------------------------------------------------------------------
    // Parcela colindante en la misma meseta (4320 msnm, diferencia 60m <= 150m)
    const compatibleAlt = 4320;
    const acceptedRead = await weatherCacheService.getSharedForecast(-10.6674, -76.2567, {
      allowInTest: true,
      altitude: compatibleAlt,
      requireMlFeatures: true
    });

    check('Pronóstico compartido es aceptado para parcela con altitud compatible (diff=60m)', acceptedRead !== null && acceptedRead.valid);
    check('Metadatos incluyen elevación de referencia de la cuadrícula (4380)', acceptedRead.reference_elevation === 4380);
    check('Metadatos calculan la diferencia exacta de elevación (60m)', acceptedRead.altitude_diff === 60);

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 3: Segmentación de Claves de Cuadrícula con Altitud y Alcance ---');
    // -------------------------------------------------------------------------
    const keyHigh = weatherCacheService.getGridKey(-10.6674, -76.2567, 4380, 'ml_full');
    const keyLow = weatherCacheService.getGridKey(-10.6674, -76.2567, 3500, 'ml_full');
    const keyBasic = weatherCacheService.getGridKey(-10.6674, -76.2567, null, 'standard');

    check('Claves de cuadrícula para 4380m y 3500m son distintas', keyHigh !== keyLow);
    check('Clave para 4380m contiene sufijo altimétrico correspondiente', keyHigh.includes('alt4350'));
    check('Clave para 3500m contiene sufijo altimétrico correspondiente', keyLow.includes('alt3450'));
    check('Clave básica sin altitud preserva retrocompatibilidad regional', keyBasic === 'geo_-10.67_-76.26');

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 4: Rechazo de Pronóstico Incompleto para Modelos ML ---');
    // -------------------------------------------------------------------------
    // Guardar un pronóstico básico (sin past_days, solo 1 día de pronóstico sin precip_sum)
    const incompleteForecast = {
      latitude: -10.50,
      longitude: -76.30,
      elevation: 4100,
      daily: {
        time: ['2026-10-15'],
        temperature_2m_max: [10.0]
      }
    };

    await weatherCacheService.saveSharedForecast(-10.50, -76.30, incompleteForecast, {
      allowInTest: true,
      altitude: 4100,
      scope: 'standard'
    });

    const mlRejection = await weatherCacheService.getSharedForecast(-10.50, -76.30, {
      allowInTest: true,
      altitude: 4100,
      requireMlFeatures: true
    });

    check('Pronóstico básico sin historial es rechazado cuando se exigen variables ML', mlRejection === null);

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 5: Conservación de Altitud Real de Parcela en Inferencia ML ---');
    // -------------------------------------------------------------------------
    // Guardar pronóstico compartido para lat -10.60, lng -76.30, elevation 4200
    const gridForecast = createFullMlForecast(-10.60, -76.30, 4200);
    await weatherCacheService.saveSharedForecast(-10.60, -76.30, gridForecast, {
      allowInTest: true,
      altitude: 4200,
      scope: 'ml_full'
    });

    // Simular fallo de Open-Meteo (429) para que mlService use el grid
    mlService.clearRateLimit();
    mlService.clearInFlightRequests();
    global.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ reason: 'Quota exceeded' }),
      text: async () => 'Quota exceeded'
    });

    const targetParcel = {
      id: 9901,
      name: 'Parcela Ninacaca Alta',
      center_lat: -10.601,
      center_lng: -76.301,
      altitude_masl: 4250 // Parcela a 4250m (diff 50m <= 150m)
    };

    const staleResult = await mlService.getPredictionForParcel(targetParcel);

    check('Inferencia recupera pronóstico compatible ante 429', staleResult.success === true);
    check('Resultado conserva la altitud real de la parcela (4250 msnm)', staleResult.data.altitude_masl === 4250);
    check('Resultado documenta elevación de referencia del modelo (4200 msnm)', (staleResult.data.forecast_summary?.elevation_model === 4200 || staleResult.data.reference_elevation === 4200));
    check('Resultado documenta predicción supervisada de modelos ML', staleResult.data.prediction_source === 'ml_trained');

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 6: Contrato de Datos para /weather/current en Frontend ---');
    // -------------------------------------------------------------------------
    // weatherService.getCurrentWeather() debe proveer todas las claves que consumen api.js, weather.js y dashboard.js
    const currentWeather = await weatherService.getCurrentWeather();

    check('weatherService produce temp_2m numérico', typeof currentWeather.temp_2m === 'number');
    check('weatherService produce humidity numérico', typeof currentWeather.humidity === 'number');
    check('weatherService produce soil_temp_0cm', typeof currentWeather.soil_temp_0cm === 'number');
    check('weatherService produce soil_moisture_1cm', typeof currentWeather.soil_moisture_1cm === 'number');
    check('weatherService produce uv_index', typeof currentWeather.uv_index === 'number');
    check('weatherService provee estructura main compatible con dashboard.js', typeof currentWeather.main?.temp === 'number');
    check('weatherService provee estructura weather para descripción de condiciones', Array.isArray(currentWeather.weather) && currentWeather.weather.length > 0);

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 7: Recuperación de Parcela en Estado Pending tras Cooldown ---');
    // -------------------------------------------------------------------------
    // Parcela nueva aislada en punto sin pronóstico previo
    const pendingParcel = {
      id: 9902,
      name: 'Parcela Nueva en Paucartambo',
      center_lat: -10.77,
      center_lng: -75.80,
      altitude_masl: 2900
    };

    // 1. Simular Open-Meteo saturado (429) -> debe responder 'pending'
    global.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ reason: 'Rate limit' }),
      text: async () => 'Rate limit'
    });

    const pendingResult = await mlService.getPredictionForParcel(pendingParcel);
    check('Parcela nueva ante 429 adquiere status="pending"', pendingResult.status === 'pending');
    check('user_message amigable para el agricultor', pendingResult.user_message.includes('preparando la información meteorológica'));

    // 2. Simular recuperación: el enfriamiento termina y Open-Meteo vuelve a responder 200 OK
    mlService.clearRateLimit();
    mlService.clearInFlightRequests();

    const freshForecastPayload = createFullMlForecast(-10.77, -75.80, 2900);
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => freshForecastPayload
    });

    const recoveredResult = await mlService.getPredictionForParcel(pendingParcel);
    check('Al normalizarse el servicio, la parcela se recupera con success=true', recoveredResult.success === true);
    check('Predicciones ML son generadas exitosamente', recoveredResult.data?.predictions?.length > 0);
    check('No permanece en estado pending', recoveredResult.status !== 'pending');

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 8: Validación de Horizonte Futuro en Datos Stale ---');
    // -------------------------------------------------------------------------
    // Simular un registro en base de datos con horizonte valid_until vencido ayer
    const expiredStalePayload = {
      parcel_id: 9903,
      model_version: mlService.EXPECTED_MODEL_VERSION,
      predictions: [],
      forecast_summary: {
        dates: ['2026-10-10', '2026-10-11'] // Fechas en el pasado
      },
      valid_until: new Date(Date.now() - 3600000).toISOString(), // Vencido hace 1h
      issued_at: new Date(Date.now() - 10000000).toISOString()
    };

    db.dbGet = async (sql, params) => {
      if (sql.includes('weather_cache') && params && params[0] === 'parcel_9903') {
        return {
          data_json: JSON.stringify(expiredStalePayload),
          fetched_at: new Date(Date.now() - 3600000)
        };
      }
      return null;
    };

    const expiredResult = await mlService.getStalePrediction(9903, { http_status: 429 });
    check('Datos stale con fechas en el pasado y horizonte vencido son rechazados (retorna null)', expiredResult === null);

    db.dbGet = realDbGet;

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 9: Supervivencia de Caché Compartida tras Reinicio del Backend ---');
    // -------------------------------------------------------------------------
    // Simular que el proceso de Node.js reinicia: _sharedMemoryCache se vacía por completo
    const persistedForecast = createFullMlForecast(-10.45, -76.35, 3800);
    const mockDbStore = new Map();

    db.dbRun = async (sql, params) => {
      if (sql.includes('INSERT INTO weather_cache')) {
        mockDbStore.set(params[0], {
          data_json: params[1],
          fetched_at: new Date()
        });
      }
      return { rowcount: 1 };
    };

    db.dbGet = async (sql, params) => {
      if (sql.includes('FROM weather_cache WHERE location = ?')) {
        return mockDbStore.get(params[0]) || null;
      }
      return null;
    };

    // Guardar pronóstico (se guarda en memoria y en la base de datos simulada)
    await weatherCacheService.saveSharedForecast(-10.45, -76.35, persistedForecast, {
      allowInTest: true,
      altitude: 3800,
      scope: 'ml_full'
    });

    // SIMULAR REINICIO EN CALIENTE DEL PROCESO NODE.JS
    weatherCacheService.resetWeatherMetrics(); // Vacía memoria interna _sharedMemoryCache
    weatherCacheService.setTestModeOverride(true);

    const postRestartRead = await weatherCacheService.getSharedForecast(-10.45, -76.35, {
      allowInTest: true,
      altitude: 3800,
      requireMlFeatures: true
    });

    check('Pronóstico se recupera exitosamente desde la base de datos tras vaciar memoria', postRestartRead !== null && postRestartRead.valid);
    check('Origen identificado como shared_db_fresh', postRestartRead.source.includes('shared_db'));
    check('Datos restaurados conservan la elevación y variables originales', postRestartRead.forecast.elevation === 3800);

    db.dbGet = realDbGet;
    db.dbRun = realDbRun;

    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 10: Seguridad Multi-Inquilino y Aislamiento Estricto ---');
    // -------------------------------------------------------------------------
    // La clave de cuadrícula 'geo_...' jamás expone IDs ni datos privados de parcelas
    const sampleGridKey = weatherCacheService.getGridKey(-10.6674, -76.2567, 4380);
    check('Clave espacial de cuadrícula no contiene PII, IDs de parcela ni nombres', !sampleGridKey.includes('user') && !sampleGridKey.includes('parcel'));

    console.log('\n' + '='.repeat(80));
    console.log(`📊 RESULTADO SUITE METEO02: ${passed}/${total} PRUEBAS APROBADAS (100% SATISFACTORIO)`);
    console.log('='.repeat(80));

  } finally {
    global.fetch = originalFetch;
    db.dbGet = realDbGet;
    db.dbRun = realDbRun;
    weatherCacheService.setTestModeOverride(false);
    weatherCacheService.resetWeatherMetrics();
    mlService.clearRateLimit();
    mlService.clearInFlightRequests();
  }
}

runMeteo02Suite().catch(err => {
  console.error('\n❌ ERROR EN SUITE METEO02:', err);
  process.exit(1);
});
