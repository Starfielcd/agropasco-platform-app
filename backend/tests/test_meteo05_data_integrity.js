/**
 * AgroPasco — Suite de Integridad de Datos Meteorológicos (METEO05)
 *
 * Valida los 10 puntos de control de integridad:
 * 1. Open-Meteo disponible (estado fresh / live).
 * 2. Caché vigente (estado cache).
 * 3. Caché desactualizado de respaldo (estado stale).
 * 4. HTTP 429 y activación de Circuit Breaker.
 * 5. Ausencia total de datos meteorológicos (estado unavailable, sin Math.random()).
 * 6. Contrato de Dashboard sin datos (valores null consistentes, sin TypeError).
 * 7. Contrato de Clima sin datos (forecast vacío [], sin datos mock estáticos).
 * 8. Alertas sin datos (cero alertas generadas por azar algorítmico).
 * 9. Simulación explícita de demostración (?sim=helada / allowSimulation).
 * 10. Blindaje e integridad de ML y Gemini.
 */

const assert = require('assert');
const weatherService = require('../services/weatherService');
const weatherCacheService = require('../services/weatherCacheService');
const mlService = require('../services/mlService');
const aiContextBuilder = require('../services/aiContextBuilder');
const db = require('../config/database');

async function runMeteo05IntegritySuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE METEO05: INTEGRIDAD DE DATOS METEOROLÓGICOS Y BLINDAJE DE PRODUCCIÓN');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    weatherCacheService.clearSharedCache();
    mlService.clearRateLimit();
    try {
      await fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  const origFetch = global.fetch;
  const origDbGet = db.dbGet;
  const origDbRun = db.dbRun;

  try {
    // -------------------------------------------------------------------------
    // 1. OPEN-METEO DISPONIBLE
    // -------------------------------------------------------------------------
    await check('1. Open-Meteo disponible retorna estado fresh y live con datos reales', async () => {
      db.dbGet = async () => null; // Sin caché local
      db.dbRun = async () => {};

      global.fetch = async (url) => {
        if (url.includes('open-meteo.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              current: {
                temperature_2m: 5.4,
                relative_humidity_2m: 68,
                surface_pressure: 622,
                wind_speed_10m: 3.8,
                soil_temperature_0cm: 6.1,
                soil_moisture_0_to_1cm: 0.42,
                uv_index: 8.2
              },
              daily: {
                time: ['2026-10-16', '2026-10-17', '2026-10-18'],
                temperature_2m_max: [12.5, 11.8, 13.0],
                temperature_2m_min: [1.2, -0.5, 2.0],
                precipitation_probability_max: [15, 45, 10]
              }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      const weather = await weatherService.getCurrentWeather();
      assert.strictEqual(weather.status, 'fresh');
      assert.strictEqual(weather._source, 'open-meteo-live');
      assert.strictEqual(weather.is_available, true);
      assert.strictEqual(weather.is_simulation, false);
      assert.strictEqual(weather.temp_2m, 5.4);
      assert.strictEqual(weather.main.temp, 5.4);
    });

    // -------------------------------------------------------------------------
    // 2. CACHÉ VIGENTE
    // -------------------------------------------------------------------------
    await check('2. Caché vigente (< 30 min) se entrega como cache sin consultar red', async () => {
      let networkCalled = false;
      global.fetch = async () => {
        networkCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      db.dbGet = async (sql) => {
        if (sql.includes('weather_cache')) {
          return {
            data_json: JSON.stringify({
              name: 'Cerro de Pasco',
              status: 'cache',
              _source: 'open-meteo-cache',
              is_available: true,
              is_simulation: false,
              temp_2m: 6.0,
              main: { temp: 6.0, temp_min: 1.0, temp_max: 13.0 }
            }),
            fetched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min de antigüedad
          };
        }
        return null;
      };

      const weather = await weatherService.getCurrentWeather();
      assert.strictEqual(networkCalled, false, 'No debió invocar a la red');
      assert.strictEqual(weather.status, 'cache');
      assert.strictEqual(weather.temp_2m, 6.0);
      assert.strictEqual(weather.is_simulation, false);
    });

    // -------------------------------------------------------------------------
    // 3. CACHÉ DESACTUALIZADO (STALE)
    // -------------------------------------------------------------------------
    await check('3. Caché desactualizado entrega respaldo seguro con is_stale: true', async () => {
      mlService.tripRateLimit(60000, 'Rate limit forzado');
      global.fetch = async () => ({ ok: false, status: 429 });

      // Caché local de hace 3 horas (stale pero dentro de 24h)
      db.dbGet = async (sql) => {
        if (sql.includes('weather_cache')) {
          return {
            data_json: JSON.stringify({
              name: 'Cerro de Pasco',
              status: 'cache',
              _source: 'open-meteo-cache',
              is_available: true,
              is_simulation: false,
              temp_2m: 4.8,
              main: { temp: 4.8, temp_min: -1.0, temp_max: 11.0 }
            }),
            fetched_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
          };
        }
        return null;
      };

      const weather = await weatherService.getCurrentWeather();
      assert.strictEqual(weather.status, 'stale');
      assert.strictEqual(weather.is_stale, true);
      assert.strictEqual(weather.temp_2m, 4.8);
      assert.strictEqual(weather.is_simulation, false);
    });

    // -------------------------------------------------------------------------
    // 4. HTTP 429 Y CIRCUIT BREAKER
    // -------------------------------------------------------------------------
    await check('4. HTTP 429 activa Circuit Breaker y no genera datos sintéticos', async () => {
      db.dbGet = async () => null; // Sin caché previo

      global.fetch = async () => ({
        ok: false,
        status: 429,
        headers: {
          get: (header) => (header.toLowerCase() === 'retry-after' ? '60' : null)
        },
        json: async () => ({ reason: 'Quota exceeded' })
      });

      const weather = await weatherService.getCurrentWeather();
      assert.strictEqual(mlService.isRateLimitActive(), true, 'Debe activar circuit breaker');
      assert.strictEqual(weather.status, 'unavailable');
      assert.strictEqual(weather._source, 'unavailable');
      assert.strictEqual(weather.is_available, false);
      assert.strictEqual(weather.temp_2m, null);
      assert.strictEqual(weather.main.temp, null);
    });

    // -------------------------------------------------------------------------
    // 5. AUSENCIA TOTAL DE INFORMACIÓN METEOROLÓGICA
    // -------------------------------------------------------------------------
    await check('5. Ausencia total de datos devuelve unavailable sin Math.random()', async () => {
      mlService.tripRateLimit(60000, 'Activo');
      db.dbGet = async () => null;

      const weather = await weatherService.getCurrentWeather();
      assert.strictEqual(weather.status, 'unavailable');
      assert.strictEqual(weather.is_available, false);
      assert.strictEqual(weather.temp_2m, null);
      assert.strictEqual(weather.main.temp, null);
      assert.strictEqual(weather.humidity, null);
      assert.strictEqual(weather.wind_speed, null);
      assert(weather.message.includes('temporalmente no disponible'));
    });

    // -------------------------------------------------------------------------
    // 6. DASHBOARD SIN DATOS (CONTRATO SEGURO)
    // -------------------------------------------------------------------------
    await check('6. Contrato seguro para Dashboard: no arroja excepciones con valores null', async () => {
      const unavailable = weatherService.buildUnavailableWeatherObject();
      assert.strictEqual(unavailable.status, 'unavailable');

      // Emulación del cálculo en dashboard.js
      const isAvailable = unavailable.is_available !== false && unavailable.status !== 'unavailable' && (unavailable.temp_2m !== null || unavailable.main?.temp !== null);
      const temp = isAvailable ? (unavailable.temp_2m ?? unavailable.main?.temp) : null;
      const humidity = isAvailable ? (unavailable.humidity ?? unavailable.main?.humidity) : null;

      assert.strictEqual(isAvailable, false);
      assert.strictEqual(temp, null);
      assert.strictEqual(humidity, null);
    });

    // -------------------------------------------------------------------------
    // 7. CLIMA SIN DATOS (FORECAST VACÍO)
    // -------------------------------------------------------------------------
    await check('7. getForecast devuelve [] en producción si no hay datos reales (sin mocks)', async () => {
      db.dbGet = async () => null;
      global.fetch = async () => ({ ok: false, status: 500 });

      const forecast = await weatherService.getForecast();
      assert(Array.isArray(forecast));
      assert.strictEqual(forecast.length, 0, 'No debe inyectar mockWeatherData en producción');
    });

    // -------------------------------------------------------------------------
    // 8. ALERTAS SIN DATOS (CERO FALSAS ALARMAS)
    // -------------------------------------------------------------------------
    await check('8. generateAlerts con clima unavailable devuelve [] (cero falsas alertas)', async () => {
      const unavailable = weatherService.buildUnavailableWeatherObject();
      const alerts = weatherService.generateAlerts(unavailable, []);
      assert(Array.isArray(alerts));
      assert.strictEqual(alerts.length, 0, 'No debe generar alertas cuando el clima no está disponible');
    });

    // -------------------------------------------------------------------------
    // 9. SIMULACIÓN EXPLÍCITA DE DEMOSTRACIÓN (?sim=helada / allowSimulation)
    // -------------------------------------------------------------------------
    await check('9. Simulación explícita autorizada genera alertas rotuladas como demo', async () => {
      const simWeather = weatherService.generateRealisticWeather();
      assert.strictEqual(simWeather.status, 'simulated');
      assert.strictEqual(simWeather.is_simulation, true);
      assert.strictEqual(simWeather.is_demo, true);

      // Simulación explícita tipo 'helada'
      const demoAlerts = weatherService.generateAlerts(simWeather, [], 'helada');
      assert(demoAlerts.length > 0);
      assert.strictEqual(demoAlerts[0].is_demo, true);
      assert(demoAlerts[0].title.includes('[DEMO]'));
    });

    // -------------------------------------------------------------------------
    // 10. PROTECCIÓN DE ML Y GEMINI
    // -------------------------------------------------------------------------
    await check('10. Modelos ML y Agente Gemini nunca consumen datos simulados', async () => {
      // 10a. mlService no tiene relación con datos simulados
      assert.strictEqual(typeof mlService.generateRealisticWeather, 'undefined');

      // 10b. aiContextBuilder reporta 'missing_weather' y no inventa lecturas sintéticas
      db.dbGet = async (sql, params) => {
        if (sql.includes('FROM parcels')) {
          return {
            id: 999,
            user_id: 1,
            name: 'Parcela Test Rigor',
            crop_type: 'papa',
            variety: 'canchan',
            altitude_masl: 4380,
            latitude: -10.6868,
            longitude: -76.2625
          };
        }
        return null;
      };

      const ctx = await aiContextBuilder.buildAgriculturalContext({
        userId: 1,
        userRole: 'farmer',
        parcelId: 999
      });

      assert.strictEqual(ctx.success, true);
      assert.strictEqual(ctx.weather_status, 'missing_weather');
      assert.strictEqual(ctx.llm_context.temperature_current, null);
      assert.strictEqual(ctx.llm_context.ml_frost_risk, null);
      assert(ctx.warnings.some(w => w.includes('No hay información meteorológica reciente')));
    });

  } finally {
    global.fetch = origFetch;
    db.dbGet = origDbGet;
    db.dbRun = origDbRun;
    weatherCacheService.clearSharedCache();
    mlService.clearRateLimit();
  }

  console.log('='.repeat(80));
  console.log(`📊 RESULTADOS SUITE METEO05: ${passed} APROBADAS | ${failed} FALLIDAS`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runMeteo05IntegritySuite();
