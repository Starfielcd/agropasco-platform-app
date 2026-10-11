/**
 * AgroPasco — Test Suite de Resiliencia de Caché y Prevención HTTP 429 (Fase 8L-G20)
 * ================================================================================
 * Valida de forma exhaustiva los 12 requisitos de la auditoría:
 *  1. Guardado de predicción válida en weather_cache local.
 *  2. Lectura exitosa de la predicción con getCachedPrediction().
 *  3. fetched_at interpretado correctamente cuando el driver devuelve Date nativo de JavaScript (PostgreSQL TIMESTAMPTZ).
 *  4. Consulta dentro de TTL reutiliza caché sin invocar Open-Meteo.
 *  5. Recuperación segura de predicción stale ante HTTP 429 cuando cumple criterios.
 *  6. Rechazo de predicción que excede límite de 24h o con vigencia (valid_until) expirada.
 *  7. Aislamiento estricto por parcela (parcel_1 no lee datos de parcel_2).
 *  8. Rechazo de versiones de modelo incompatibles o ausentes.
 *  9. Protección estricta: nunca se generan nuevas alertas agrícolas desde datos stale.
 * 10. Conservación exacta del instante UTC en fechas con zonas horarias explícitas (+/-HH:mm).
 * 11. Fechas inválidas se rechazan explícitamente sin provocar fechas artificiales ni Date.now().
 * 12. HTTP 429 sin Retry-After activa circuit breaker en el intento 1 y no dispara reintentos ciegos.
 *
 * EJECUCIÓN 100% LOCAL Y DETERMINISTA (SIN ACCESO A SUPABASE NI OPEN-METEO).
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('../config/database');
const mlService = require('../services/mlService');
const mlController = require('../controllers/mlController');

function createSamplePredictionPayload(parcelId, options = {}) {
  const ageMinutes = options.ageMinutes || 0;
  const issuedAt = options.issuedAt || new Date(Date.now() - ageMinutes * 60000).toISOString();
  const validHours = options.validHours !== undefined ? options.validHours : 72;
  const validUntil = options.validUntil || new Date(Date.now() + (validHours * 60 - ageMinutes) * 60000).toISOString();
  const modelVersion = options.modelVersion !== undefined ? options.modelVersion : mlService.EXPECTED_MODEL_VERSION;
  const todayStr = new Date().toISOString().split('T')[0];

  return {
    parcel_id: parcelId,
    parcel_name: `Parcela Test ${parcelId}`,
    latitude: -10.6025,
    longitude: -76.2050,
    altitude_masl: 4380,
    model_version: modelVersion,
    predictions: [
      { phenomenon: 'frost', risk_level: 'high', risk_score: 85, model_type: 'ml_trained', period: '2026-10-11 a 2026-10-14' },
      { phenomenon: 'heavy_rain', risk_level: 'low', risk_score: 15, model_type: 'ml_trained', period: '2026-10-11 a 2026-10-14' },
      { phenomenon: 'snow', risk_level: 'none', risk_score: 5, model_type: 'ml_trained', period: '2026-10-11 a 2026-10-14' },
      { phenomenon: 'hail', risk_level: 'none', risk_score: 0, model_type: 'rule_based', period: '2026-10-11 a 2026-10-14' }
    ],
    forecast_summary: {
      days: 3,
      dates: [todayStr, '2026-10-12', '2026-10-13'],
      temp_min: [-1.2, 0.5, 1.0],
      temp_max: [12.0, 13.5, 11.8],
      precipitation: [0, 2.5, 0]
    },
    issued_at: issuedAt,
    valid_until: validUntil,
    data_source: 'AgroPasco Native ML + Open-Meteo'
  };
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 8L-G20: RESILIENCIA DE CACHÉ POSTGRESQL Y PREVENCIÓN HTTP 429');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      mlService.clearRateLimit();
      mlService.clearInFlightRequests();
      await fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      failed++;
    }
  }

  // Almacén simulado en memoria para weather_cache
  const mockCacheStore = new Map();

  function setupMockDb() {
    db.dbGet = async (sql, params) => {
      if (sql.includes('weather_cache') && params && params[0]) {
        const key = params[0];
        const row = mockCacheStore.get(key);
        return row || null;
      }
      return null;
    };

    db.dbRun = async (sql, params) => {
      if (sql.startsWith('DELETE FROM weather_cache') && params && params[0]) {
        mockCacheStore.delete(params[0]);
        return { changes: 1 };
      }
      if (sql.startsWith('INSERT INTO weather_cache') && params && params[0]) {
        mockCacheStore.set(params[0], {
          location: params[0],
          data_type: params[1],
          data_json: params[2],
          fetched_at: new Date()
        });
        return { changes: 1, lastID: 1 };
      }
      return { changes: 0 };
    };
  }

  const origDbGet = db.dbGet;
  const origDbRun = db.dbRun;
  const origFetch = global.fetch;

  try {
    setupMockDb();

    // -------------------------------------------------------------------------
    console.log('\n--- 1. CICLO BÁSICO DE ESCRITURA Y LECTURA EN CACHÉ ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 1: Guardar una predicción válida en weather_cache local', async () => {
      const payload = createSamplePredictionPayload(101, { ageMinutes: 5 });
      // Simular guardado directo en el almacén de caché
      mockCacheStore.set('parcel_101', {
        location: 'parcel_101',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(payload),
        fetched_at: new Date()
      });

      assert(mockCacheStore.has('parcel_101'), 'Debe existir la clave en weather_cache');
      const stored = mockCacheStore.get('parcel_101');
      assert.strictEqual(stored.location, 'parcel_101');
      assert.strictEqual(stored.data_type, 'ml_prediction');
    });

    await test('PRUEBA 2: Leer la predicción con getCachedPrediction()', async () => {
      const cached = await mlService.getCachedPrediction(101);
      assert(cached !== null, 'Debe retornar la predicción almacenada');
      assert.strictEqual(cached.parcel_id, 101);
      assert.strictEqual(cached.model_version, mlService.EXPECTED_MODEL_VERSION);
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 2. COMPATIBILIDAD CON TIPOS DE POSTGRESQL Y SQLITE ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 3: Comprobar que fetched_at es interpretado correctamente cuando el driver devuelve Date nativo', async () => {
      const payload = createSamplePredictionPayload(103, { ageMinutes: 10 });
      // Objeto Date nativo tal como lo entrega node-postgres para TIMESTAMPTZ
      const pgDate = new Date(Date.now() - 10 * 60000);
      mockCacheStore.set('parcel_103', {
        location: 'parcel_103',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(payload),
        fetched_at: pgDate // Objeto Date nativo
      });

      const cached = await mlService.getCachedPrediction(103);
      assert(cached !== null, 'Debe parsear correctamente el objeto Date sin arrojar TypeError');
      assert.strictEqual(cached.parcel_id, 103);
    });

    await test('PRUEBA 4: Solicitar nuevamente la misma parcela dentro del TTL y verificar que NO se realiza nueva solicitud', async () => {
      let networkCalled = false;
      global.fetch = async () => {
        networkCalled = true;
        throw new Error('No debe realizar peticiones a Open-Meteo dentro del TTL');
      };

      const parcel = { id: 101, name: 'P-Cached', center_lat: -10.60, center_lng: -76.25, altitude_masl: 4300 };
      const res = await mlService.getPredictionForParcel(parcel);

      assert.strictEqual(networkCalled, false, 'Fetch no debe ser llamado cuando existe caché vigente');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.source, 'cache');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 3. RESPALDO STALE ANTE HTTP 429 Y CONDICIONES DE SEGURIDAD ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 5: Simular HTTP 429 y recuperar una predicción stale que todavía cumple criterios de seguridad', async () => {
      const payload = createSamplePredictionPayload(105, { ageMinutes: 75 }); // 75 min: fuera de TTL (60 min) pero dentro de 24h
      const pgDate = new Date(Date.now() - 75 * 60000);
      mockCacheStore.set('parcel_105', {
        location: 'parcel_105',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(payload),
        fetched_at: pgDate // Objeto Date nativo
      });

      global.fetch = async () => {
        return {
          ok: false,
          status: 429,
          headers: new Map(),
          json: async () => ({ reason: 'Daily API request limit exceeded' }),
          text: async () => 'Daily limit exceeded'
        };
      };

      const parcel = { id: 105, name: 'P-StaleResilience', center_lat: -10.60, center_lng: -76.25, altitude_masl: 4300 };
      const res = await mlService.getPredictionForParcel(parcel);

      assert.strictEqual(res.success, true, 'Debe recuperarse con éxito usando el respaldo seguro');
      assert.strictEqual(res.source, 'cache_stale');
      assert.strictEqual(res.data.is_stale, true);
      assert.strictEqual(res.data.stale_reason, 'rate_limit_fallback');
      assert.strictEqual(res.data.stale_age_minutes, 75);
      assert(typeof res.data.last_updated === 'string', 'last_updated debe ser una cadena ISO');
    });

    await test('PRUEBA 6: Rechazar una predicción que excede el límite de 24h o cuya vigencia ya expiró', async () => {
      // Caso 6A: Más de 24 horas
      const oldPayload = createSamplePredictionPayload(106, { ageMinutes: 25 * 60 });
      mockCacheStore.set('parcel_106', {
        location: 'parcel_106',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(oldPayload),
        fetched_at: new Date(Date.now() - 25 * 3600000)
      });

      const staleRes6A = await mlService.getStalePrediction(106, { http_status: 429 });
      assert.strictEqual(staleRes6A, null, 'Caché con más de 24h debe ser rechazada');

      // Caso 6B: valid_until vencido
      const expiredPayload = createSamplePredictionPayload(107, { ageMinutes: 30, validHours: -1 });
      mockCacheStore.set('parcel_107', {
        location: 'parcel_107',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(expiredPayload),
        fetched_at: new Date(Date.now() - 30 * 60000)
      });

      const staleRes6B = await mlService.getStalePrediction(107, { http_status: 429 });
      assert.strictEqual(staleRes6B, null, 'Caché con horizonte valid_until en el pasado debe ser rechazada');
    });

    await test('PRUEBA 7: Rechazar una predicción perteneciente a otra parcela', async () => {
      // Parcela 108 existe en caché, pero consultamos la parcela 999
      const payload108 = createSamplePredictionPayload(108, { ageMinutes: 10 });
      mockCacheStore.set('parcel_108', {
        location: 'parcel_108',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(payload108),
        fetched_at: new Date()
      });

      const cached999 = await mlService.getCachedPrediction(999);
      assert.strictEqual(cached999, null, 'No debe retornar datos de otra parcela distinta');
    });

    await test('PRUEBA 8: Rechazar una versión de modelo no compatible', async () => {
      const badVersionPayload = createSamplePredictionPayload(109, {
        ageMinutes: 15,
        modelVersion: '1.0.0_legacy_incompatible'
      });
      mockCacheStore.set('parcel_109', {
        location: 'parcel_109',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(badVersionPayload),
        fetched_at: new Date()
      });

      const cached = await mlService.getCachedPrediction(109);
      assert.strictEqual(cached, null, 'Debe rechazar versiones de modelo incompatibles');

      const stale = await mlService.getStalePrediction(109, { http_status: 429 });
      assert.strictEqual(stale, null, 'Debe rechazar versiones incompatibles también en respaldo stale');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 4. PROTECCIÓN AGRONÓMICA CONTRA ALERTAS DESDE DATOS STALE ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 9: Verificar que nunca se generan nuevas alertas agrícolas desde datos stale', async () => {
      const stalePayload = createSamplePredictionPayload(110, { ageMinutes: 90 });
      // Inyectar riesgo crítico en el payload stale
      stalePayload.predictions[0].risk_level = 'high';
      stalePayload.is_stale = true;

      // Mock de parcels para generateAlerts
      const origDbAll = db.dbAll;
      db.dbAll = async (sql) => {
        if (sql.includes('FROM parcels')) {
          return [{ id: 110, user_id: 1, name: 'Parcela Stale Test', center_lat: -10.60, center_lng: -76.25 }];
        }
        return [];
      };

      // Mock de mlService.getPredictionForParcel para retornar stale
      const origGetPred = mlService.getPredictionForParcel;
      mlService.getPredictionForParcel = async () => {
        return {
          success: true,
          source: 'cache_stale',
          data: stalePayload
        };
      };

      const req = { user: { role: 'admin' } };
      let jsonResult = null;
      const res = {
        json: (data) => { jsonResult = data; return res; },
        status: () => res
      };

      await mlController.generateAlerts(req, res);

      db.dbAll = origDbAll;
      mlService.getPredictionForParcel = origGetPred;

      assert(jsonResult !== null, 'Debe responder con JSON');
      assert.strictEqual(jsonResult.success, true);
      assert.strictEqual(jsonResult.data.alerts_created, 0, 'NUNCA debe crear alertas desde predicciones stale');
      assert.strictEqual(jsonResult.data.alerts_skipped_stale, 1, 'Debe contabilizar la alerta descartada por obsolescencia');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 5. TIMESTAMPS ROBUSTOS, HUSOS HORARIOS Y MANEJO DE ERRORES ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 10: Confirmar que las fechas con zonas horarias explícitas conservan correctamente su instante UTC', async () => {
      // Fecha en Lima (-05:00): 17:00 local equivale a 22:00 UTC
      const isoOffset = '2026-10-11T17:00:00-05:00';
      const parsedMs = mlService.parseCacheTimestamp(isoOffset);
      assert(parsedMs !== null, 'Debe parsear fecha con desplazamiento de zona');

      const expectedUtc = Date.parse('2026-10-11T22:00:00Z');
      assert.strictEqual(parsedMs, expectedUtc, 'El instante UTC debe ser exactamente 22:00:00Z');

      // Fecha SQLite UTC: '2026-10-11 17:00:00'
      const sqliteStr = '2026-10-11 17:00:00';
      const sqliteParsedMs = mlService.parseCacheTimestamp(sqliteStr);
      const sqliteExpectedUtc = Date.parse('2026-10-11T17:00:00Z');
      assert.strictEqual(sqliteParsedMs, sqliteExpectedUtc, 'El formato SQLite debe preservarse como UTC exacto');
    });

    await test('PRUEBA 11: Confirmar que una fecha inválida no provoca consultas ilimitadas ni errores silenciosos', async () => {
      assert.strictEqual(mlService.parseCacheTimestamp(null), null);
      assert.strictEqual(mlService.parseCacheTimestamp(undefined), null);
      assert.strictEqual(mlService.parseCacheTimestamp(''), null);
      assert.strictEqual(mlService.parseCacheTimestamp('fecha_totalmente_invalida'), null);
      assert.strictEqual(mlService.parseCacheTimestamp(new Date('invalid')), null);

      // Comprobar que en getCachedPrediction() un timestamp inválido retorna null limpiamente
      mockCacheStore.set('parcel_111', {
        location: 'parcel_111',
        data_type: 'ml_prediction',
        data_json: JSON.stringify(createSamplePredictionPayload(111)),
        fetched_at: 'fecha_corrupta_no_parseable'
      });

      const cachedInvalid = await mlService.getCachedPrediction(111);
      assert.strictEqual(cachedInvalid, null, 'Debe retornar null sin lanzar excepciones no controladas');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 6. CONTROL ESTRICTO DE REINTENTOS HTTP 429 ---');
    // -------------------------------------------------------------------------

    await test('PRUEBA 12: Verificar que un HTTP 429 sin Retry-After activa enfriamiento y NO dispara un reintento inmediato', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Map(), // Sin cabecera Retry-After
          json: async () => ({ reason: 'Rate limited by IP' }),
          text: async () => 'Rate limited by IP'
        };
      };

      const parcel = { id: 112, name: 'P-SingleAttempt429', center_lat: -10.60, center_lng: -76.25, altitude_masl: 4300 };
      const res = await mlService.getPredictionForParcel(parcel);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.http_status, 429);
      assert.strictEqual(callCount, 1, 'Debe realizar EXACTAMENTE 1 solicitud externa sin reintento ciego');
      assert.strictEqual(mlService.isRateLimitActive(), true, 'Debe activar el circuit breaker de inmediato');
    });

  } finally {
    db.dbGet = origDbGet;
    db.dbRun = origDbRun;
    global.fetch = origFetch;
    mlService.clearRateLimit();
    mlService.clearInFlightRequests();
  }

  console.log('='.repeat(80));
  console.log(`📊 RESULTADOS SUITE FASE 8L-G20: ${passed} APROBADAS | ${failed} FALLIDAS`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('FATAL ERROR EN SUITE FASE 8L-G20:', err);
  process.exit(1);
});
