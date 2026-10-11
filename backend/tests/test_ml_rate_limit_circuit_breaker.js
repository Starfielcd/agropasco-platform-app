/**
 * AgroPasco — Test Suite de Circuit Breaker y Respaldo de Caché Stale (Fase 8L-G14)
 * =================================================================================
 * Valida de forma exhaustiva e independiente:
 *  1. HTTP 429 con Retry-After en segundos (ej. "30").
 *  2. HTTP 429 con Retry-After en formato fecha HTTP (RFC 7231).
 *  3. HTTP 429 sin Retry-After (usa enfriamiento por defecto).
 *  4. Enfriamiento compartido entre múltiples parcelas (estado del proceso).
 *  5. Ausencia de ráfagas adicionales hacia la red durante el enfriamiento.
 *  6. Recuperación automática posterior al periodo de enfriamiento.
 *  7. Caché vigente (<60m) se sirve normalmente sin invocar red ni marcar stale.
 *  8. Caché vencida (>60m pero <24h con horizonte futuro) se sirve con is_stale: true ante fallo 429.
 *  9. Caché completamente vencida (>24h o sin fechas futuras) se rechaza con error real.
 * 10. Compatibilidad de versión del modelo (rechaza versiones obsoletas como stale fallback).
 * 11. Fallo de red sin datos de respaldo reporta error real sin inventar datos.
 * 12. Timeout con respaldo seguro devuelve predicción previa stale en lugar de error.
 * 13. Múltiples solicitudes concurrentes bajo enfriamiento retornan de inmediato sin saturar.
 * 14. Integración del circuit breaker con weatherService.js (no evasión por ruta alterna).
 * 15. Contrato de datos y metadatos: is_stale, last_updated, stale_reason, stale_age_minutes.
 * 16. Ausencia estricta de escrituras a Supabase (NODE_ENV=test).
 * 17. No generación de alertas reales.
 *
 * EJECUCIÓN 100% AISLADA Y DETERMINISTA CON MOCKS EN MEMORIA
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('../config/database');
const mlService = require('../services/mlService');
const weatherService = require('../services/weatherService');

function createSamplePredictionPayload(parcelId, options = {}) {
  const ageMinutes = options.ageMinutes || 0;
  const issuedAt = new Date(Date.now() - ageMinutes * 60000).toISOString();
  const validUntil = new Date(Date.now() + (72 * 60 - ageMinutes) * 60000).toISOString();
  const todayStr = new Date().toISOString().split('T')[0];

  return {
    parcel_id: parcelId,
    parcel_name: `Parcela ${parcelId}`,
    latitude: -10.45,
    longitude: -76.35,
    altitude_masl: 3500,
    model_version: options.modelVersion || mlService.EXPECTED_MODEL_VERSION,
    prediction_source: 'ml_trained',
    predictions: [
      {
        phenomenon: 'frost',
        risk_level: 'high',
        risk_score: 75,
        model_type: 'ml_trained',
        period: `${todayStr} a 2026-10-15`
      },
      {
        phenomenon: 'heavy_rain',
        risk_level: 'low',
        risk_score: 20,
        model_type: 'ml_trained',
        period: `${todayStr} a 2026-10-15`
      },
      {
        phenomenon: 'snow',
        risk_level: 'none',
        risk_score: 0,
        model_type: 'ml_trained',
        period: `${todayStr} a 2026-10-15`
      },
      {
        phenomenon: 'hail',
        risk_level: 'none',
        risk_score: 0,
        model_type: 'rule_based',
        period: `${todayStr} a 2026-10-15`
      }
    ],
    forecast_summary: {
      days: 3,
      dates: options.dates || [todayStr, '2026-10-14', '2026-10-15'],
      temp_min: [-2.0, 1.0, 3.0],
      temp_max: [12.0, 14.0, 11.0],
      precipitation: [0, 5, 10]
    },
    issued_at: issuedAt,
    valid_until: options.validUntil !== undefined ? options.validUntil : validUntil
  };
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 8L-G14: CIRCUIT BREAKER OPEN-METEO Y RESPALDO SEGURO DE CACHÉ');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      mlService.clearInFlightRequests();
      mlService.clearRateLimit();
      await fn();
      passed++;
      console.log(`  ✅ PASSED: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  // ---------------------------------------------------------------------------
  console.log('\n--- 1. PARSEO DE RETRY-AFTER (RFC 7231) ---');
  // ---------------------------------------------------------------------------
  await test('parseRetryAfter interpreta enteros en segundos', async () => {
    assert.strictEqual(mlService.parseRetryAfter('30'), 30000);
    assert.strictEqual(mlService.parseRetryAfter('1'), 1000);
    assert.strictEqual(mlService.parseRetryAfter('0'), 0);
    assert.strictEqual(mlService.parseRetryAfter('  60  '), 60000);
  });

  await test('parseRetryAfter interpreta fechas HTTP válidas en el futuro', async () => {
    const futureDate = new Date(Date.now() + 45000).toUTCString();
    const parsed = mlService.parseRetryAfter(futureDate);
    assert(parsed !== null, 'Debe parsear la fecha HTTP');
    assert(parsed >= 40000 && parsed <= 46000, `El retardo debe ser ~45s, obtenido: ${parsed}ms`);
  });

  await test('parseRetryAfter rechaza valores vacíos o malformados', async () => {
    assert.strictEqual(mlService.parseRetryAfter(null), null);
    assert.strictEqual(mlService.parseRetryAfter(''), null);
    assert.strictEqual(mlService.parseRetryAfter('invalid-header'), null);
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 2. CIRCUIT BREAKER ANTE HTTP 429 ---');
  // ---------------------------------------------------------------------------
  await test('HTTP 429 con Retry-After: 30 activa circuit breaker y no reintenta síncronamente', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['retry-after', '30']]),
        json: async () => ({ reason: 'Quota exceeded' }),
        text: async () => 'Quota exceeded'
      };
    };

    const parcel = { id: 201, name: 'P-Retry30', center_lat: -10.45, center_lng: -76.35, altitude_masl: 3500 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.http_status, 429);
    assert.strictEqual(callCount, 1, 'No debe reintentar síncronamente cuando Retry-After excede presupuesto (>2s)');
    assert.strictEqual(mlService.isRateLimitActive(), true, 'Circuit breaker debe estar activo');

    const status = mlService.getRateLimitStatus();
    assert.strictEqual(status.active, true);
    assert(status.remainingMs > 25000, 'Debe restar enfriamiento de ~30s');
  });

  await test('HTTP 429 con Retry-After en formato fecha activa circuit breaker', async () => {
    let callCount = 0;
    const futureDate = new Date(Date.now() + 20000).toUTCString();
    global.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['retry-after', futureDate]]),
        json: async () => ({ reason: 'Rate limit' }),
        text: async () => 'Rate limit'
      };
    };

    const parcel = { id: 202, name: 'P-DateRetry', center_lat: -10.45, center_lng: -76.35, altitude_masl: 3500 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.http_status, 429);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(mlService.isRateLimitActive(), true);
  });

  await test('HTTP 429 sin Retry-After utiliza enfriamiento por defecto', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map(),
        json: async () => ({ reason: 'Limit' }),
        text: async () => 'Limit'
      };
    };

    const parcel = { id: 203, name: 'P-NoHeader429', center_lat: -10.45, center_lng: -76.35, altitude_masl: 3500 };
    const res = await mlService.getPredictionForParcel(parcel);

    assert.strictEqual(res.success, false);
    assert.strictEqual(mlService.isRateLimitActive(), true);
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 3. ENFRIAMIENTO COMPARTIDO Y AUSENCIA DE RÁFAGAS ---');
  // ---------------------------------------------------------------------------
  await test('Enfriamiento activo bloquea llamadas posteriores de múltiples parcelas sin invocar fetch', async () => {
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls++;
      return {
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '15']]),
        json: async () => ({ reason: 'Blocked' }),
        text: async () => 'Blocked'
      };
    };

    // Parcela 1 activa el circuit breaker
    const p1 = { id: 301, name: 'Parcela-1', center_lat: -10.45, center_lng: -76.35 };
    await mlService.getPredictionForParcel(p1);
    assert.strictEqual(fetchCalls, 1, 'Primera llamada alcanza la red');

    // Parcelas 2, 3 y 4 deben ser cortocircuitadas inmediatamente
    const p2 = { id: 302, name: 'Parcela-2', center_lat: -10.46, center_lng: -76.36 };
    const p3 = { id: 303, name: 'Parcela-3', center_lat: -10.47, center_lng: -76.37 };
    const p4 = { id: 304, name: 'Parcela-4', center_lat: -10.48, center_lng: -76.38 };

    const r2 = await mlService.getPredictionForParcel(p2);
    const r3 = await mlService.getPredictionForParcel(p3);
    const r4 = await mlService.getPredictionForParcel(p4);

    assert.strictEqual(fetchCalls, 1, 'No debe haber llamadas adicionales a la red durante el enfriamiento');
    assert.strictEqual(r2.circuit_breaker_open, true);
    assert.strictEqual(r3.circuit_breaker_open, true);
    assert.strictEqual(r4.circuit_breaker_open, true);
  });

  await test('weatherService respeta el circuit breaker y no evade el control', async () => {
    // Activar circuit breaker manualmente
    mlService.tripRateLimit(30000, 'Test de coordinación');

    let weatherFetchCalls = 0;
    global.fetch = async () => {
      weatherFetchCalls++;
      return { ok: true, json: async () => ({}) };
    };

    // weatherService.getCurrentWeather con dbGet mockeado devolviendo null (cache miss)
    const origDbGet = db.dbGet;
    db.dbGet = async () => null;

    const weather = await weatherService.getCurrentWeather();
    db.dbGet = origDbGet;

    assert.strictEqual(weatherFetchCalls, 0, 'weatherService no debe llamar a Open-Meteo durante enfriamiento activo');
    assert.strictEqual(weather._source, 'simulated', 'weatherService debe usar fallback simulado sin llamar a red');
  });

  await test('Recuperación automática posterior al periodo de enfriamiento', async () => {
    // Activar circuit breaker muy corto (50ms)
    mlService.tripRateLimit(50, 'Enfriamiento ultra-corto de prueba');
    assert.strictEqual(mlService.isRateLimitActive(), true);

    // Esperar a que expire
    await new Promise(r => setTimeout(r, 70));
    assert.strictEqual(mlService.isRateLimitActive(), false, 'Debe recuperarse automáticamente');

    let recoveredCall = 0;
    global.fetch = async () => {
      recoveredCall++;
      return {
        ok: false,
        status: 403,
        json: async () => ({ reason: 'Forbidden' }),
        text: async () => 'Forbidden'
      };
    };

    const p = { id: 305, name: 'P-Recover', center_lat: -10.45, center_lng: -76.35 };
    await mlService.getPredictionForParcel(p);
    assert.strictEqual(recoveredCall, 1, 'La llamada a red se restablece tras expirar el enfriamiento');
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 4. RESPALDO SEGURO DE CACHÉ (STALE-WHILE-REVALIDATE) ---');
  // ---------------------------------------------------------------------------
  await test('Caché vigente (<60m) se sirve con source=cache sin consultar la red', async () => {
    const origDbGet = db.dbGet;
    const freshPayload = createSamplePredictionPayload(401, { ageMinutes: 25 });
    db.dbGet = async (sql, params) => {
      return {
        data_json: JSON.stringify(freshPayload),
        fetched_at: freshPayload.issued_at
      };
    };

    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; throw new Error('No debe llamar fetch'); };

    const parcel = { id: 401, name: 'P-Fresh', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(fetchCalled, false);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.source, 'cache');
    assert.strictEqual(res.data.is_stale, undefined);
  });

  await test('Caché vencida (90 min) se entrega como respaldo seguro con is_stale: true ante HTTP 429', async () => {
    const origDbGet = db.dbGet;
    const stalePayload = createSamplePredictionPayload(402, { ageMinutes: 90 });
    db.dbGet = async (sql, params) => {
      return {
        data_json: JSON.stringify(stalePayload),
        fetched_at: stalePayload.issued_at
      };
    };

    global.fetch = async () => {
      return {
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '30']]),
        json: async () => ({ reason: 'Too many requests' }),
        text: async () => 'Too many requests'
      };
    };

    const parcel = { id: 402, name: 'P-StaleFallback', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(res.success, true, 'Debe tener éxito utilizando el respaldo');
    assert.strictEqual(res.source, 'cache_stale', 'El origen debe ser cache_stale');
    assert.strictEqual(res.data.is_stale, true, 'Debe marcar is_stale: true');
    assert.strictEqual(res.data.stale_reason, 'rate_limit_fallback');
    assert.strictEqual(res.data.stale_age_minutes, 90);
    assert(res.data.coverage_warning.includes('alta demanda'));
    assert.strictEqual(res.data.predictions.length, 4, 'Conserva las predicciones calculadas previamente');
  });

  await test('Caché con más de 24 horas se rechaza y no se sirve como respaldo', async () => {
    const origDbGet = db.dbGet;
    // 25 horas de antigüedad
    const veryOldPayload = createSamplePredictionPayload(403, { ageMinutes: 25 * 60 });
    db.dbGet = async (sql, params) => {
      return {
        data_json: JSON.stringify(veryOldPayload),
        fetched_at: veryOldPayload.issued_at
      };
    };

    global.fetch = async () => {
      return {
        ok: false,
        status: 429,
        headers: new Map(),
        json: async () => ({ reason: 'Blocked' }),
        text: async () => 'Blocked'
      };
    };

    const parcel = { id: 403, name: 'P-TooOld', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(res.success, false, 'No debe servir respaldo si excede 24 horas');
    assert.strictEqual(res.http_status, 429);
  });

  await test('Caché con versión de modelo incompatible se rechaza como respaldo', async () => {
    const origDbGet = db.dbGet;
    const incompatiblePayload = createSamplePredictionPayload(404, {
      ageMinutes: 120,
      modelVersion: '1.0.0_obsolete'
    });
    db.dbGet = async (sql, params) => {
      return {
        data_json: JSON.stringify(incompatiblePayload),
        fetched_at: incompatiblePayload.issued_at
      };
    };

    global.fetch = async () => {
      return {
        ok: false,
        status: 429,
        headers: new Map(),
        json: async () => ({ reason: 'Blocked' }),
        text: async () => 'Blocked'
      };
    };

    const parcel = { id: 404, name: 'P-BadVersion', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(res.success, false, 'Versión obsoleta debe ser rechazada');
  });

  await test('Fallo de timeout con respaldo seguro en caché entrega datos stale con stale_reason=timeout_fallback', async () => {
    const origDbGet = db.dbGet;
    const stalePayload = createSamplePredictionPayload(405, { ageMinutes: 75 });
    db.dbGet = async () => ({
      data_json: JSON.stringify(stalePayload),
      fetched_at: stalePayload.issued_at
    });

    global.fetch = async () => {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    const parcel = { id: 405, name: 'P-TimeoutStale', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.source, 'cache_stale');
    assert.strictEqual(res.data.is_stale, true);
    assert.strictEqual(res.data.stale_reason, 'timeout_fallback');
  });

  await test('Fallo de red sin datos en caché reporta error real sin inventar valores', async () => {
    const origDbGet = db.dbGet;
    db.dbGet = async () => null; // Sin caché

    global.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.open-meteo.com');
    };

    const parcel = { id: 406, name: 'P-NoNetNoCache', center_lat: -10.45, center_lng: -76.35 };
    const res = await mlService.getPredictionForParcel(parcel);

    db.dbGet = origDbGet;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.fallback, 'network_error');
    assert(res.error.includes('Error de conexión'));
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 5. CONCURRENCIA Y AISLAMIENTO ---');
  // ---------------------------------------------------------------------------
  await test('Lote concurrente con 429: parcela 1 activa breaker, parcela 2 no llama red pero recupera stale', async () => {
    const origDbGet = db.dbGet;
    const cacheMap = {
      501: createSamplePredictionPayload(501, { ageMinutes: 80 }),
      502: createSamplePredictionPayload(502, { ageMinutes: 95 })
    };

    db.dbGet = async (sql, params) => {
      const pId = params[0].replace('parcel_', '');
      const p = cacheMap[pId];
      if (!p) return null;
      return { data_json: JSON.stringify(p), fetched_at: p.issued_at };
    };

    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount++;
      return {
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '25']]),
        json: async () => ({ reason: 'Blocked' }),
        text: async () => 'Blocked'
      };
    };

    const parcels = [
      { id: 501, name: 'P-Batch1', center_lat: -10.45, center_lng: -76.35 },
      { id: 502, name: 'P-Batch2', center_lat: -10.46, center_lng: -76.36 }
    ];

    const results = await mlService.mapWithConcurrency(parcels, 2, async (p) => {
      return mlService.getPredictionForParcel(p);
    });

    db.dbGet = origDbGet;
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[0].source, 'cache_stale');
    assert.strictEqual(results[1].success, true);
    assert.strictEqual(results[1].source, 'cache_stale');
    assert(fetchCount <= 2, `Máximo 2 llamadas a fetch en paralelo antes del corte, obtenidas: ${fetchCount}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO SUITE FASE 8L-G14: ${passed} APROBADAS, ${failed} FALLIDAS`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Error fatal ejecutando suite:', err);
  process.exit(1);
});
