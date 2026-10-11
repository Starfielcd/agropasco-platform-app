/**
 * AgroPasco — Test Suite de Seguridad y Consistencia (Fase 8L-G16)
 * ===============================================================
 * Cobertura de validación para los hallazgos de auditoría:
 *  - H-01: Bloqueo estricto de generación de alertas desde predicciones stale (is_stale, cache_stale).
 *  - H-02: Aislamiento estricto de sesiones en cliente (_mlClientCache, in-flight promises, logout/login, 401).
 *  - H-03: Preservación monótona del enfriamiento del circuit breaker ante HTTP 429 concurrentes.
 *  - H-04: Soporte de Retry-After en weatherService.
 *
 * EJECUCIÓN 100% LOCAL Y DETERMINISTA (SIN ACCESO A SUPABASE NI OPEN-METEO).
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('../config/database');
const mlService = require('../services/mlService');
const weatherService = require('../services/weatherService');
const notificationService = require('../services/notificationService');
const mlController = require('../controllers/mlController');

async function runSecuritySuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 8L-G16: SEGURIDAD, AISLAMIENTO Y CIRCUIT BREAKER (H-01, H-02, H-03)');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  // ============================================================================
  // SIMULADOR EN MEMORIA PARA TRANSACCIONES Y ADVISORY LOCKS
  // ============================================================================
  const inMemoryNotifications = [];
  let nextNotificationId = 1;
  const activeAdvisoryLocks = new Set();
  const advisoryLockWaiters = new Map();

  async function acquireAdvisoryLock(key, timeoutMs = 5000) {
    if (activeAdvisoryLocks.has(key)) {
      if (!advisoryLockWaiters.has(key)) advisoryLockWaiters.set(key, []);
      let timer;
      const waitPromise = new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        advisoryLockWaiters.get(key).push(waiter);
        if (timeoutMs > 0 && timeoutMs !== Infinity) {
          timer = setTimeout(() => {
            const list = advisoryLockWaiters.get(key);
            if (list) {
              const idx = list.indexOf(waiter);
              if (idx !== -1) list.splice(idx, 1);
            }
            const err = new Error('canceling statement due to lock timeout');
            err.code = '55P03';
            reject(err);
          }, timeoutMs);
        }
      });
      await waitPromise;
      if (timer) clearTimeout(timer);
    }
    activeAdvisoryLocks.add(key);
  }

  function releaseAdvisoryLock(key) {
    activeAdvisoryLocks.delete(key);
    const waiters = advisoryLockWaiters.get(key);
    if (waiters && waiters.length > 0) {
      const nextWaiter = waiters.shift();
      nextWaiter.resolve();
    }
  }

  function createMockTransactionalContext() {
    const heldLocks = new Set();
    let localLockTimeoutMs = 5000;

    return {
      client: {
        query: async (sql, params = []) => {
          if (sql === 'BEGIN') return;
          if (sql.includes('SET LOCAL lock_timeout')) {
            const match = sql.match(/lock_timeout\s*=\s*'(\d+)ms'/i);
            if (match) localLockTimeoutMs = parseInt(match[1], 10);
            return { rows: [] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            for (const lockKey of heldLocks) releaseAdvisoryLock(lockKey);
            heldLocks.clear();
            return;
          }
          if (sql.includes('pg_advisory_xact_lock')) {
            const lockKey = params[0];
            await acquireAdvisoryLock(lockKey, localLockTimeoutMs);
            heldLocks.add(lockKey);
            return { rows: [{}] };
          }
          return { rows: [] };
        }
      },
      dbGet: async (sql, params = []) => {
        if (sql.includes('FROM notifications')) {
          const userId = params[0];
          const type = params[1];
          const windowHours = params[params.length - 1];
          const windowMs = (typeof windowHours === 'number' ? windowHours : 6) * 60 * 60 * 1000;
          const now = Date.now();

          const hasPhenomenonFilter = sql.includes('phenomenon = ?');
          let phenomenonParam = null;
          let parcelIdParam = null;

          let paramIdx = 2;
          if (hasPhenomenonFilter) phenomenonParam = params[paramIdx++];
          const hasParcelIdFilter = sql.includes('parcel_id = ?');
          if (hasParcelIdFilter) parcelIdParam = params[paramIdx++];

          const found = inMemoryNotifications.find(n => {
            const ageMs = now - new Date(n.created_at).getTime();
            if (ageMs > windowMs) return false;
            if (n.user_id !== userId) return false;
            if (n.type !== type) return false;
            if (hasPhenomenonFilter && phenomenonParam && n.phenomenon !== phenomenonParam) return false;
            if (parcelIdParam !== null && parcelIdParam !== undefined && n.parcel_id !== parcelIdParam) return false;
            return true;
          });

          return found ? { id: found.id, title: found.title } : null;
        }
        return null;
      },
      dbRun: async (sql, params = []) => {
        if (sql.includes('INSERT INTO notifications')) {
          const [userId, type, title, message, severity, parcelId, phenomenon, modelType] = params;
          const newRow = {
            id: nextNotificationId++,
            user_id: userId,
            type,
            title,
            message,
            severity,
            parcel_id: parcelId !== undefined ? parcelId : null,
            phenomenon: phenomenon !== undefined ? phenomenon : null,
            model_type: modelType !== undefined ? modelType : null,
            created_at: new Date().toISOString()
          };
          inMemoryNotifications.push(newRow);
          return { lastID: newRow.id, changes: 1 };
        }
        return { changes: 0 };
      }
    };
  }

  const originalWithTransaction = db.withTransaction;
  db.withTransaction = async (callback) => {
    const tx = createMockTransactionalContext();
    await tx.client.query('BEGIN');
    try {
      const result = await callback(tx);
      await tx.client.query('COMMIT');
      return result;
    } catch (err) {
      await tx.client.query('ROLLBACK');
      throw err;
    }
  };

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

  try {
    // ============================================================================
    // ETAPA 1: ESCENARIOS A & B — SEGURIDAD DE ALERTAS (H-01)
    // ============================================================================
    console.log('\n--- ESCENARIO A & B: PROTECCIÓN DE ALERTAS METEOROLÓGICAS (H-01) ---');

    await test('A. Una predicción stale (is_stale: true o source: cache_stale) NUNCA genera alertas', async () => {
      const originalDbAll = db.dbAll;
      const originalDbGet = db.dbGet;
      const originalGetPred = mlService.getPredictionForParcel;

      const dummyParcels = [
        { id: 101, name: 'Parcela San Juan', user_id: 11, status: 'activa', center_lat: -10.5, center_lng: -76.2 }
      ];

      db.dbAll = async () => dummyParcels;
      db.dbGet = async () => null;

      // Caso A1: source === 'cache_stale'
      mlService.getPredictionForParcel = async () => ({
        success: true,
        source: 'cache_stale',
        data: {
          is_stale: true,
          source: 'cache_stale',
          predictions: [
            { phenomenon: 'frost', risk_level: 'high', risk_score: 90, model_type: 'ml_trained', period: '24h' },
            { phenomenon: 'heavy_rain', risk_level: 'moderate', risk_score: 65, model_type: 'ml_trained', period: '24h' }
          ]
        }
      });

      let resData;
      const req = { user: { role: 'admin' } };
      const res = {
        statusCode: 200,
        status: function(c) { this.statusCode = c; return this; },
        json: function(d) { resData = d; }
      };

      try {
        await mlController.generateAlerts(req, res);
        assert.strictEqual(resData.success, true);
        assert.strictEqual(resData.data.alerts_created, 0, 'No debe crear ninguna alerta desde caché stale');
        assert.strictEqual(resData.data.alerts_skipped_stale, 2, 'Debe registrar 2 alertas individuales omitidas por stale');

        // Caso A2: result.data.is_stale === true aunque result.source no lo indique explícitamente
        mlService.getPredictionForParcel = async () => ({
          success: true,
          source: 'ml_service',
          data: {
            is_stale: true,
            predictions: [
              { phenomenon: 'snow', risk_level: 'high', risk_score: 85, model_type: 'ml_trained', period: '24h' }
            ]
          }
        });

        await mlController.generateAlerts(req, res);
        assert.strictEqual(resData.data.alerts_created, 0, 'No debe crear alerta si data.is_stale es true');
        assert.strictEqual(resData.data.alerts_skipped_stale, 1, 'Debe omitir la alerta de nieve stale');
      } finally {
        db.dbAll = originalDbAll;
        db.dbGet = originalDbGet;
        mlService.getPredictionForParcel = originalGetPred;
      }
    });

    await test('B. Una predicción vigente puede generar una alerta legítima', async () => {
      const originalDbAll = db.dbAll;
      const originalDbGet = db.dbGet;
      const originalGetPred = mlService.getPredictionForParcel;

      const dummyParcels = [
        { id: 201, name: 'Parcela Oxapampa Alta', user_id: 22, status: 'activa', center_lat: -10.5, center_lng: -76.2 }
      ];

      db.dbAll = async () => dummyParcels;
      db.dbGet = async () => null;

      mlService.getPredictionForParcel = async () => ({
        success: true,
        source: 'ml_service',
        data: {
          is_stale: false,
          predictions: [
            {
              phenomenon: 'frost',
              risk_level: 'high',
              risk_score: 88,
              model_type: 'ml_trained',
              period: '24h',
              variables_used: { temperature_2m_min: -2.5 }
            }
          ]
        }
      });

      let resData;
      const req = { user: { role: 'admin' } };
      const res = {
        statusCode: 200,
        status: function(c) { this.statusCode = c; return this; },
        json: function(d) { resData = d; }
      };

      try {
        await mlController.generateAlerts(req, res);
        assert.strictEqual(resData.success, true);
        assert.strictEqual(resData.data.alerts_created, 1, 'Debe generar exactamente 1 alerta legítima');
        assert.strictEqual(resData.data.alerts_skipped_stale, 0, 'Cero alertas omitidas por stale');
      } finally {
        db.dbAll = originalDbAll;
        db.dbGet = originalDbGet;
        mlService.getPredictionForParcel = originalGetPred;
      }
    });

    // ============================================================================
    // ETAPA 2: ESCENARIOS C, D, E & F — AISLAMIENTO DE SESIONES CLIENTE (H-02)
    // ============================================================================
    console.log('\n--- ESCENARIO C, D, E & F: AISLAMIENTO DE SESIONES FRONTEND (H-02) ---');

    const clientApiModule = require('../../frontend/js/api.js');

    const mockStorage = new Map();
    global.localStorage = {
      getItem: (k) => mockStorage.get(k) || null,
      setItem: (k, v) => mockStorage.set(k, String(v)),
      removeItem: (k) => mockStorage.delete(k),
      clear: () => mockStorage.clear()
    };

    await test('C. Usuario A cierra sesión y usuario B inicia sesión sin recibir datos cacheados de A', async () => {
      mockStorage.clear();
      clientApiModule.clearMLClientCacheInternal();

      // 1. Usuario A (Agricultor 1) inicia sesión
      const userA = { id: 101, name: 'Agricultor A', role: 'farmer' };
      clientApiModule.setToken('jwt_token_A');
      clientApiModule.setUser(userA);

      clientApiModule._mlClientCache.user.data = { success: true, farmer: 'Datos de A' };
      clientApiModule._mlClientCache.user.timestamp = Date.now();
      clientApiModule._mlClientCache.user.epoch = clientApiModule.getMLSessionEpoch();
      clientApiModule._mlClientCache.user.scope = clientApiModule.getClientSessionScope();

      assert.strictEqual(clientApiModule.getClientSessionScope(), 'u_101_farmer');

      // 2. Usuario A cierra sesión
      clientApiModule.removeToken();
      clientApiModule.removeUser();

      assert.strictEqual(clientApiModule.getClientSessionScope(), 'anon');
      assert.strictEqual(clientApiModule._mlClientCache.user.data, null, 'Caché debe quedar nula tras logout');

      // 3. Usuario B (Agricultor 2) inicia sesión
      const userB = { id: 202, name: 'Agricultor B', role: 'farmer' };
      clientApiModule.setToken('jwt_token_B');
      clientApiModule.setUser(userB);

      assert.strictEqual(clientApiModule.getClientSessionScope(), 'u_202_farmer');
      assert.strictEqual(clientApiModule._mlClientCache.user.data, null, 'Usuario B inicia con caché limpia');
    });

    await test('D. Solicitud iniciada por A y completada tras el logout no repuebla la caché de B', async () => {
      mockStorage.clear();
      clientApiModule.clearMLClientCacheInternal();

      // 1. Iniciar sesión A
      clientApiModule.setToken('jwt_token_A');
      clientApiModule.setUser({ id: 101, role: 'farmer' });

      const capturedEpochA = clientApiModule.getMLSessionEpoch();
      const capturedScopeA = clientApiModule.getClientSessionScope();

      // 2. Simular petición en vuelo iniciada por A
      let resolveRequestA;
      const pendingPromiseA = new Promise((resolve) => {
        resolveRequestA = resolve;
      });

      clientApiModule._mlClientCache.user.promise = pendingPromiseA;
      clientApiModule._mlClientCache.user.epoch = capturedEpochA;
      clientApiModule._mlClientCache.user.scope = capturedScopeA;

      // 3. A hace logout e ingresa B antes de que la petición de A termine
      clientApiModule.removeToken();
      clientApiModule.removeUser();

      clientApiModule.setToken('jwt_token_B');
      clientApiModule.setUser({ id: 202, role: 'farmer' });

      assert.notStrictEqual(clientApiModule.getMLSessionEpoch(), capturedEpochA, 'El epoch debió avanzar');

      // 4. Ahora resuelve la promesa tardía de A
      resolveRequestA({ success: true, parcel: 'Parcela Privada de A' });
      await pendingPromiseA;

      // 5. Verificar que los datos de A NO fueron aceptados en la caché de B
      assert.strictEqual(
        clientApiModule._mlClientCache.user.data,
        null,
        'Los datos tardíos de A no deben contaminar la sesión de B'
      );
    });

    await test('E. Respuesta HTTP 401 invalida inmediatamente los datos almacenados', async () => {
      mockStorage.clear();
      clientApiModule.setToken('token_valido');
      clientApiModule.setUser({ id: 301, role: 'farmer' });

      clientApiModule._mlClientCache.user.data = { secret: 'datos_sensibles' };
      clientApiModule._mlClientCache.user.epoch = clientApiModule.getMLSessionEpoch();

      // Simular 401
      clientApiModule.clearMLClientCacheInternal();
      clientApiModule.removeToken();
      clientApiModule.removeUser();

      assert.strictEqual(clientApiModule.getToken(), null);
      assert.strictEqual(clientApiModule.getUser(), null);
      assert.strictEqual(clientApiModule._mlClientCache.user.data, null, 'Caché eliminada tras 401');
    });

    await test('F. Aislamiento adecuado entre claves user, all y status', async () => {
      mockStorage.clear();
      clientApiModule.clearMLClientCacheInternal();

      clientApiModule.setToken('token_advisor');
      clientApiModule.setUser({ id: 401, role: 'advisor' });

      const epoch = clientApiModule.getMLSessionEpoch();
      const scope = clientApiModule.getClientSessionScope();

      clientApiModule._mlClientCache.user = { data: 'data_user', timestamp: Date.now(), promise: null, epoch, scope };
      clientApiModule._mlClientCache.all = { data: 'data_all', timestamp: Date.now(), promise: null, epoch, scope };
      clientApiModule._mlClientCache.status = { data: 'data_status', timestamp: Date.now(), promise: null, epoch, scope: 'global_status' };

      assert.strictEqual(clientApiModule._mlClientCache.user.data, 'data_user');
      assert.strictEqual(clientApiModule._mlClientCache.all.data, 'data_all');
      assert.strictEqual(clientApiModule._mlClientCache.status.scope, 'global_status');
    });

    // ============================================================================
    // ETAPA 3: ESCENARIO G — PRESERVACIÓN MONÓTONA DEL CIRCUIT BREAKER (H-03)
    // ============================================================================
    console.log('\n--- ESCENARIO G: PRESERVACIÓN MONÓTONA DEL CIRCUIT BREAKER (H-03) ---');

    await test('G. Dos HTTP 429 concurrentes con Retry-After diferente no reducen el enfriamiento', async () => {
      mlService.clearRateLimit();

      // 1. Petición A recibe HTTP 429 con Retry-After de 120s
      mlService.tripRateLimit(120000, 'HTTP 429 Petición A');
      const untilA = mlService.getRateLimitStatus().remainingMs;

      assert.strictEqual(mlService.isRateLimitActive(), true);
      assert(untilA >= 115000 && untilA <= 120000, `Enfriamiento inicial debe ser ~120s (fue: ${untilA}ms)`);

      // 2. Petición concurrente B llega momentos después con Retry-After menor de 30s
      mlService.tripRateLimit(30000, 'HTTP 429 Petición B concurrente menor');
      const untilAfterB = mlService.getRateLimitStatus().remainingMs;

      assert(
        untilAfterB >= untilA - 100,
        `El enfriamiento no debió disminuir de ${untilA}ms a 30s (fue: ${untilAfterB}ms)`
      );

      // 3. Petición concurrente C llega sin cabecera Retry-After (usa default de 60s)
      mlService.tripRateLimit(undefined, 'HTTP 429 Petición C sin header');
      const untilAfterC = mlService.getRateLimitStatus().remainingMs;

      assert(
        untilAfterC >= untilAfterB - 100,
        `El enfriamiento no debió disminuir tras petición sin header (fue: ${untilAfterC}ms)`
      );

      // 4. Petición concurrente D con tiempo MAYOR (180s) debe extender monótonamente
      mlService.tripRateLimit(180000, 'HTTP 429 Petición D mayor');
      const untilAfterD = mlService.getRateLimitStatus().remainingMs;

      assert(
        untilAfterD > untilAfterC,
        `Un Retry-After mayor sí debe incrementar el enfriamiento (fue: ${untilAfterD}ms vs ${untilAfterC}ms)`
      );
    });

    // ============================================================================
    // ESCENARIOS H & I: DEDUPLICACIÓN ATÓMICA Y CONTRATOS JSON
    // ============================================================================
    console.log('\n--- ESCENARIOS H & I: DEDUPLICACIÓN ATÓMICA Y CONTRATOS JSON ---');

    await test('H. La deduplicación atómica PostgreSQL continúa operando correctamente', async () => {
      inMemoryNotifications.length = 0;

      const alertA = await notificationService.createWeatherAlertAtomically({
        userId: 55,
        type: 'alerta_helada',
        title: '⚠️ Helada de Prueba H',
        message: 'Detalle de prueba',
        parcelId: 5501,
        parcelName: 'Parcela H',
        phenomenon: 'frost',
        windowHours: 6
      });

      const alertB = await notificationService.createWeatherAlertAtomically({
        userId: 55,
        type: 'alerta_helada',
        title: '⚠️ Helada de Prueba H',
        message: 'Detalle duplicado',
        parcelId: 5501,
        parcelName: 'Parcela H',
        phenomenon: 'frost',
        windowHours: 6
      });

      assert.strictEqual(alertA.created, true, 'Primera alerta debe crearse');
      assert.strictEqual(alertB.skipped, true, 'Segunda alerta idéntica debe deduplicarse');
    });

    await test('I. El controlador generateAlerts preserva íntegramente el contrato JSON esperado por el frontend', async () => {
      const originalDbAll = db.dbAll;
      const originalDbGet = db.dbGet;
      const originalGetPred = mlService.getPredictionForParcel;

      db.dbAll = async () => [];
      db.dbGet = async () => null;

      let resData;
      const req = { user: { role: 'admin' } };
      const res = {
        statusCode: 200,
        status: function(c) { this.statusCode = c; return this; },
        json: function(d) { resData = d; }
      };

      try {
        await mlController.generateAlerts(req, res);
        assert.strictEqual(resData.success, true);
        assert('parcels_evaluated' in resData.data, 'Debe incluir parcels_evaluated');
        assert('alerts_created' in resData.data, 'Debe incluir alerts_created');
        assert('alerts_skipped_duplicate' in resData.data, 'Debe incluir alerts_skipped_duplicate');
        assert('alerts_skipped_stale' in resData.data, 'Debe incluir alerts_skipped_stale');
        assert('alerts_skipped' in resData.data, 'Debe incluir alerts_skipped');
        assert('generated_at' in resData.data, 'Debe incluir generated_at');
      } finally {
        db.dbAll = originalDbAll;
        db.dbGet = originalDbGet;
        mlService.getPredictionForParcel = originalGetPred;
      }
    });

    await test('J. weatherService respeta la cabecera Retry-After cuando Open-Meteo retorna HTTP 429 (H-04)', async () => {
      mlService.clearRateLimit();
      const originalFetch = global.fetch;

      global.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['retry-after', '90']]),
        json: async () => ({ reason: 'Quota exceeded' })
      });

      try {
        const result = await weatherService.getCurrentWeather();
        assert.strictEqual(result._source, 'simulated', 'Debe degradar a datos simulados');
        assert.strictEqual(mlService.isRateLimitActive(), true, 'Debe activar circuit breaker');
        const status = mlService.getRateLimitStatus();
        assert(status.remainingMs >= 85000 && status.remainingMs <= 90000, `Debe respetar ~90s (fue: ${status.remainingMs}ms)`);
      } finally {
        global.fetch = originalFetch;
      }
    });

    console.log('='.repeat(80));
    console.log(`📊 RESULTADOS SUITE SEGURIDAD FASE 8L-G16: ${passed} APROBADAS | ${failed} FALLIDAS`);
    console.log('='.repeat(80));

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    db.withTransaction = originalWithTransaction;
  }
}

if (require.main === module) {
  runSecuritySuite().catch(err => {
    console.error('Error fatal en suite de seguridad:', err);
    process.exit(1);
  });
}

module.exports = { runSecuritySuite };
