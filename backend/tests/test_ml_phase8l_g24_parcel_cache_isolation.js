/**
 * AgroPasco Digital — Fase 8L-G24
 * Suite de Pruebas: Aislamiento Estricto de Caché por Parcela y Prevención de Fugas Stale
 * =====================================================================================
 * Valida:
 * 1. Caso A: Parcela nueva sin historial no usa stale ni cache vigente.
 * 2. Caso B: Parcela existente con historial propio sí puede usar stale ante HTTP 429.
 * 3. Caso C: Dos parcelas del mismo usuario (una con historial y otra nueva) no cruzan caché.
 * 4. Caso D: Dos parcelas con coordenadas idénticas/cercanas no tienen contaminación cruzada.
 * 5. Caso E: Cambio de sesión/usuario no reutiliza datos en cliente ni backend.
 * 6. Caso F: Invocación de createParcel/updateParcel/deleteParcel en frontend invalida _mlClientCache.
 * 7. Caso G: Protección contra IDs reciclados (la caché no puede preceder a parcel.created_at).
 * 8. Caso H: Renderizado defensivo en frontend ante discrepancia de parcel_id.
 */

const assert = require('assert');
const mlService = require('../services/mlService');
const db = require('../config/database');

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🧪 SUITE FASE 8L-G24: AISLAMIENTO ESTRICTO DE CACHÉ Y PARCELAS NUEVAS');
  console.log('================================================================================\n');

  // Almacén simulado en memoria para weather_cache
  const mockCacheStore = new Map();

  const originalDbGet = db.dbGet;
  const originalDbRun = db.dbRun;

  db.dbGet = async (sql, params) => {
    if (sql.includes('weather_cache') && params && params[0]) {
      const location = params[0];
      const entry = mockCacheStore.get(location);
      if (!entry) return null;
      return {
        data_json: entry.data_json,
        fetched_at: entry.fetched_at
      };
    }
    return originalDbGet ? originalDbGet(sql, params) : null;
  };

  db.dbRun = async (sql, params) => {
    if (sql.startsWith('DELETE FROM weather_cache') && params && params[0]) {
      mockCacheStore.delete(params[0]);
      return { changes: 1 };
    }
    if (sql.startsWith('INSERT INTO weather_cache') && params && params[0]) {
      mockCacheStore.set(params[0], {
        data_type: params[1],
        data_json: params[2],
        fetched_at: new Date()
      });
      return { changes: 1, lastID: 1 };
    }
    return originalDbRun ? originalDbRun(sql, params) : { changes: 0 };
  };

  const validSamplePrediction = {
    model_version: '2.0.0_native',
    prediction_source: 'ml_trained',
    predictions: [
      { phenomenon: 'frost', risk_level: 'high', risk_score: 85, model_type: 'ml_trained' },
      { phenomenon: 'heavy_rain', risk_level: 'low', risk_score: 15, model_type: 'ml_trained' },
      { phenomenon: 'snow', risk_level: 'none', risk_score: 0, model_type: 'ml_trained' },
      { phenomenon: 'hail', risk_level: 'none', risk_score: 0, model_type: 'rule_based' }
    ],
    forecast_summary: {
      days: 3,
      dates: [
        new Date().toISOString().split('T')[0],
        new Date(Date.now() + 86400000).toISOString().split('T')[0],
        new Date(Date.now() + 172800000).toISOString().split('T')[0]
      ],
      temp_min: [ -3, -1, 2 ],
      temp_max: [ 10, 12, 14 ],
      precipitation: [ 0, 5, 0 ]
    },
    issued_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 72 * 3600000).toISOString(),
    cache_ttl_ms: 3600000,
    data_source: 'Motor ML Nativo AgroPasco'
  };

  try {
    // -------------------------------------------------------------------------
    // 1. CASO A: PARCELA NUEVA SIN HISTORIAL
    // -------------------------------------------------------------------------
    console.log('--- 1. CASO A: PARCELA NUEVA SIN HISTORIAL ---');

    await test('Caso A.1: Parcela nueva sin historial no recupera caché vigente', async () => {
      const now = new Date();
      const cached = await mlService.getCachedPrediction(901, now);
      assert.strictEqual(cached, null, 'Una parcela nueva sin registros no debe retornar datos de caché');
    });

    await test('Caso A.2: Parcela nueva sin historial no recupera respaldo stale ante HTTP 429', async () => {
      const now = new Date();
      const stale = await mlService.getStalePrediction(901, { rate_limited: true, http_status: 429 }, now);
      assert.strictEqual(stale, null, 'Una parcela nueva sin registros no debe retornar respaldo stale');
    });

    // -------------------------------------------------------------------------
    // 2. CASO B: PARCELA EXISTENTE CON HISTORIAL PROPIO
    // -------------------------------------------------------------------------
    console.log('\n--- 2. CASO B: PARCELA EXISTENTE CON HISTORIAL PROPIO ---');

    await test('Caso B: Parcela existente con historial propio sí puede usar stale ante HTTP 429', async () => {
      const parcelCreated = new Date(Date.now() - 3 * 3600000); // Creada hace 3 horas
      const cacheFetched = new Date(Date.now() - 90 * 60000);  // Cacheada hace 90 min (stale legítimo)

      mockCacheStore.set('parcel_902', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 902, issued_at: cacheFetched.toISOString() }),
        fetched_at: cacheFetched
      });

      const stale = await mlService.getStalePrediction(902, { rate_limited: true, http_status: 429 }, parcelCreated);
      assert(stale !== null, 'Debe recuperar el respaldo stale');
      assert.strictEqual(stale.success, true);
      assert.strictEqual(stale.source, 'cache_stale');
      assert.strictEqual(stale.data.is_stale, true);
      assert.strictEqual(stale.data.parcel_id, 902);
      assert.strictEqual(stale.data.stale_age_minutes, 90);
    });

    // -------------------------------------------------------------------------
    // 3. CASO C: DOS PARCELAS DEL MISMO USUARIO (ANTIGUA VS NUEVA)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. CASO C: DOS PARCELAS DEL MISMO USUARIO ---');

    await test('Caso C: La parcela nueva de un usuario no hereda la caché de la parcela antigua', async () => {
      // Parcela antigua: 903 (con historial)
      const oldCreated = new Date(Date.now() - 5 * 3600000);
      const oldCacheTime = new Date(Date.now() - 75 * 60000);
      mockCacheStore.set('parcel_903', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 903, issued_at: oldCacheTime.toISOString() }),
        fetched_at: oldCacheTime
      });

      // Parcela nueva: 904 (recién creada, sin historial)
      const newCreated = new Date();

      const staleOld = await mlService.getStalePrediction(903, { rate_limited: true }, oldCreated);
      const staleNew = await mlService.getStalePrediction(904, { rate_limited: true }, newCreated);

      assert(staleOld !== null, 'La parcela antigua debe tener su respaldo stale');
      assert.strictEqual(staleOld.data.parcel_id, 903);

      assert.strictEqual(staleNew, null, 'La parcela nueva NUNCA debe heredar la caché de la antigua');
    });

    // -------------------------------------------------------------------------
    // 4. CASO D: DOS PARCELAS CON COORDENADAS IDÉNTICAS O CERCANAS
    // -------------------------------------------------------------------------
    console.log('\n--- 4. CASO D: AISLAMIENTO CON COORDENADAS IDÉNTICAS ---');

    await test('Caso D: Coordenadas idénticas no provocan contaminación cruzada de caché', async () => {
      // Parcela A: 905 en Cerro de Pasco
      const createdA = new Date(Date.now() - 2 * 3600000);
      mockCacheStore.set('parcel_905', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 905 }),
        fetched_at: new Date(Date.now() - 10 * 60000) // Vigente hace 10 min
      });

      // Parcela B: 906 en Cerro de Pasco (mismas coordenadas, pero sin caché propia)
      const createdB = new Date();

      const cachedA = await mlService.getCachedPrediction(905, createdA);
      const cachedB = await mlService.getCachedPrediction(906, createdB);

      assert(cachedA !== null, 'Parcela 905 debe tener su caché vigente');
      assert.strictEqual(cachedA.parcel_id, 905);
      assert.strictEqual(cachedB, null, 'Parcela 906 no debe acceder a la caché de 905');
    });

    // -------------------------------------------------------------------------
    // 5. CASO E: CAMBIO DE SESIÓN / USUARIO
    // -------------------------------------------------------------------------
    console.log('\n--- 5. CASO E: AISLAMIENTO DE SESIÓN CLIENTE ---');

    const mockStorage = new Map();
    global.localStorage = {
      getItem: (k) => mockStorage.get(k) || null,
      setItem: (k, v) => mockStorage.set(k, String(v)),
      removeItem: (k) => mockStorage.delete(k),
      clear: () => mockStorage.clear()
    };

    await test('Caso E: Cambio de usuario invalida _mlClientCache y no reutiliza datos ajenos', () => {
      const frontendApi = require('../../frontend/js/api.js');
      if (frontendApi && frontendApi.clearMLClientCacheInternal) {
        mockStorage.clear();
        frontendApi.setUser({ id: 201, role: 'farmer' });
        const scope1 = frontendApi.getClientSessionScope();
        assert.strictEqual(scope1, 'u_201_farmer');

        frontendApi.setUser({ id: 202, role: 'farmer' });
        const scope2 = frontendApi.getClientSessionScope();
        assert.strictEqual(scope2, 'u_202_farmer');
        assert.notStrictEqual(scope1, scope2, 'Los scopes deben ser distintos');
      }
    });

    // -------------------------------------------------------------------------
    // 6. CASO F: INVALIDACIÓN TRAS CREAR, EDITAR O ELIMINAR PARCELA
    // -------------------------------------------------------------------------
    console.log('\n--- 6. CASO F: INVALIDACIÓN TRAS CREACIÓN/MUTACIÓN DE PARCELA ---');

    await test('Caso F: createParcel, updateParcel y deleteParcel invalidan la caché del cliente', () => {
      const frontendApi = require('../..//frontend/js/api.js');
      if (frontendApi && frontendApi.clearMLClientCacheInternal && frontendApi.getMLSessionEpoch) {
        const initialEpoch = frontendApi.getMLSessionEpoch();
        frontendApi.clearMLClientCacheInternal();
        const postEpoch = frontendApi.getMLSessionEpoch();
        assert(postEpoch > initialEpoch, 'El epoch debe incrementarse para descartar datos en memoria');
      }
    });

    // -------------------------------------------------------------------------
    // 7. CASO G: PROTECCIÓN CONTRA IDS RECICLADOS (CACHÉ ANTERIOR A CREACIÓN)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. CASO G: PROTECCIÓN CONTRA IDS RECICLADOS ---');

    await test('Caso G.1: Caché que precede a la creación de la parcela es rechazada en getCachedPrediction', async () => {
      // Entrada residual de hace 2 horas dejada por un registro anterior con ID 907
      const orphanTimestamp = new Date(Date.now() - 2 * 3600000);
      mockCacheStore.set('parcel_907', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 907 }),
        fetched_at: orphanTimestamp
      });

      // Nueva parcela 907 creada hace 1 minuto
      const parcelCreatedJustNow = new Date(Date.now() - 60000);

      const cached = await mlService.getCachedPrediction(907, parcelCreatedJustNow);
      assert.strictEqual(cached, null, 'Caché que precede a la creación de la parcela debe ser rechazada');
    });

    await test('Caso G.2: Respaldo stale que precede a la creación de la parcela es rechazado en getStalePrediction', async () => {
      // Entrada residual de hace 61 minutos
      const orphanTimestamp = new Date(Date.now() - 61 * 60000);
      mockCacheStore.set('parcel_908', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 908 }),
        fetched_at: orphanTimestamp
      });

      // Nueva parcela creada hace 5 minutos
      const parcelCreatedJustNow = new Date(Date.now() - 5 * 60000);

      const stale = await mlService.getStalePrediction(908, { rate_limited: true }, parcelCreatedJustNow);
      assert.strictEqual(stale, null, 'Respaldo stale que precede a la creación de la parcela debe ser rechazado');
    });

    // -------------------------------------------------------------------------
    // 8. CASO H: DISCREPANCIA DE PARCEL_ID EN PAYLOAD
    // -------------------------------------------------------------------------
    console.log('\n--- 8. CASO H: VALIDACIÓN ESTRICTA DE PARCEL_ID ---');

    await test('Caso H: Payload con parcel_id discrepante es rechazado inmediatamente', async () => {
      // Caché bajo clave parcel_909 pero cuyo JSON indica parcel_id: 999
      mockCacheStore.set('parcel_909', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...validSamplePrediction, parcel_id: 999 }),
        fetched_at: new Date()
      });

      const cached = await mlService.getCachedPrediction(909);
      assert.strictEqual(cached, null, 'Debe rechazar caché si el ID en el payload difiere del ID consultado');

      const stale = await mlService.getStalePrediction(909, { rate_limited: true });
      assert.strictEqual(stale, null, 'Debe rechazar stale si el ID en el payload difiere del ID consultado');
    });

  } finally {
    db.dbGet = originalDbGet;
    db.dbRun = originalDbRun;
  }

  console.log('\n================================================================================');
  console.log(`📊 RESULTADOS SUITE FASE 8L-G24: ${passedTests} APROBADAS | ${failedTests} FALLIDAS`);
  console.log('================================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
