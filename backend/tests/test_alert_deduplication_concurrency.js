/**
 * AgroPasco — Test Suite de Deduplicación y Concurrencia de Alertas (Fase 8L-G2)
 * ==============================================================================
 * Cobertura exhaustiva de los 14 escenarios obligatorios de auditoría:
 *  1. Dos solicitudes simultáneas para el mismo evento (1 creada, 1 omitida).
 *  2. Cinco solicitudes simultáneas para el mismo evento (1 creada, 4 omitidas).
 *  3. Parcelas con nombres similares (ej. "Chaupimarca" vs "Chaupimarca Alta").
 *  4. Parcelas con caracteres especiales % y _ (escape estricto de comodines).
 *  5. Parcelas diferentes del mismo agricultor (alertas independientes).
 *  6. Fenómenos diferentes en la misma parcela (ej. helada vs nieve / lluvia).
 *  7. Registros históricos con parcel_id NULL (fallback seguro por título).
 *  8. Ventana de seis horas (deduplicada dentro de 6h, permitida tras 6h).
 *  9. Fallo de INSERT y ROLLBACK (sin registros residuales corruptos).
 * 10. ROLLBACK y liberación inmediata del bloqueo asesor.
 * 11. Agotamiento de lock_timeout (ROLLBACK, liberación y error controlado).
 * 12. Integridad de parámetros SQL y eliminación de mezcla ? con $4.
 * 13. Compatibilidad de consultas PostgreSQL nativas con $1, $2 en convertPlaceholders.
 * 14. Conservación de preferencias del agricultor y control de acceso RBAC.
 *
 * EJECUCIÓN 100% LOCAL Y AISLADA CON EMULADOR TRANSACCIONAL (SIN TOCAR SUPABASE).
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('../config/database');
const notificationService = require('../services/notificationService');
const mlController = require('../controllers/mlController');

async function runAlertDeduplicationSuite() {
  console.log('='.repeat(80));
  console.log('🧪 AGROPASCO — FASE 8L-G2: SUITE DE DEDUPLICACIÓN, SQL, IDENTIDAD Y BLOQUEOS');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
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

  // ============================================================================
  // SIMULADOR DE BASE DE DATOS TRANSACCIONAL CON ADVISORY LOCKS Y TIMEOUT
  // ============================================================================
  const inMemoryNotifications = [];
  let nextNotificationId = 1;
  const activeAdvisoryLocks = new Set();
  const advisoryLockWaiters = new Map(); // key -> Array of { resolve, reject }

  async function acquireAdvisoryLock(key, timeoutMs = 5000) {
    if (activeAdvisoryLocks.has(key)) {
      if (!advisoryLockWaiters.has(key)) {
        advisoryLockWaiters.set(key, []);
      }
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
    let inTransaction = false;
    let localLockTimeoutMs = 5000;

    return {
      client: {
        query: async (sql, params = []) => {
          if (sql === 'BEGIN') {
            inTransaction = true;
            return;
          }
          if (sql.includes('SET LOCAL lock_timeout')) {
            const match = sql.match(/lock_timeout\s*=\s*'(\d+)ms'/i);
            if (match) {
              localLockTimeoutMs = parseInt(match[1], 10);
            }
            return { rows: [] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            inTransaction = false;
            for (const lockKey of heldLocks) {
              releaseAdvisoryLock(lockKey);
            }
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
          // 1. Verificación estricta de no mezclar marcadores ? con $N
          if (sql.includes('?') && /\$[1-9]/.test(sql)) {
            throw new Error('Sintaxis inválida: Se detectó mezcla indebida de marcadores ? y $N');
          }

          // 2. Verificación estricta de expresión de intervalo parametrizado
          if (!sql.includes("(? * INTERVAL '1 hour')")) {
            throw new Error("Sintaxis inválida: debe usar (? * INTERVAL '1 hour')");
          }

          // 3. Verificación estricta de no producir ERROR 22025 (cláusula ESCAPE inválida de > 1 carácter)
          if (/ESCAPE\s*['"]?[^'"]{2,}['"]?/i.test(sql) || sql.includes("ESCAPE '\\\\'")) {
            const err = new Error('invalid escape string: Escape string must be empty or one character.');
            err.code = '22025';
            throw err;
          }

          const userId = params[0];
          const type = params[1];
          const windowHours = params[params.length - 1];

          if (typeof windowHours !== 'number' || windowHours <= 0) {
            throw new Error(`Tipo de parámetro inválido para windowHours: ${typeof windowHours}`);
          }

          const windowMs = windowHours * 60 * 60 * 1000;
          const now = Date.now();

          // Detección de parámetros opcionales en la consulta
          const hasPhenomenonFilter = sql.includes('phenomenon = ?');
          let phenomenonParam = null;
          let parcelIdParam = null;

          let paramIdx = 2;
          if (hasPhenomenonFilter) {
            phenomenonParam = params[paramIdx++];
          }

          const hasParcelIdFilter = sql.includes('parcel_id = ?');
          if (hasParcelIdFilter) {
            parcelIdParam = params[paramIdx++];
          }

          const found = inMemoryNotifications.find(n => {
            const ageMs = now - new Date(n.created_at).getTime();
            if (ageMs > windowMs) return false;
            if (n.user_id !== userId) return false;
            if (n.type !== type) return false;

            // Filtro de fenómeno
            if (hasPhenomenonFilter && phenomenonParam) {
              if (n.phenomenon !== null && n.phenomenon !== phenomenonParam) {
                return false;
              }
            }

            // Filtro de parcela
            if (parcelIdParam !== null && parcelIdParam !== undefined) {
              // Si la notificación tiene parcel_id registrado, comparar directamente
              if (n.parcel_id !== null && n.parcel_id !== undefined) {
                return n.parcel_id === parcelIdParam;
              }
              // Si la notificación histórica tiene parcel_id NULL, evaluar patrones seguros de título
              if (sql.includes('title ILIKE')) {
                const pattern1 = params[paramIdx];
                const pattern2 = params[paramIdx + 1];
                if (pattern1 && pattern2) {
                  const checkSuffix = (title, pat) => {
                    const clean = pat.replace(/^%[—\-]\s*/, '').replace(/\\([%_\\])/g, '$1');
                    const normalized = title.trim();
                    return normalized.endsWith('— ' + clean) || normalized.endsWith('- ' + clean);
                  };
                  return checkSuffix(n.title, pattern1) || checkSuffix(n.title, pattern2);
                }
              }
              return false;
            }

            return true;
          });

          return found ? { id: found.id } : undefined;
        }
        return undefined;
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

  // Interceptar withTransaction para usar el simulador
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

  try {
    // --------------------------------------------------------------------------
    console.log('\n--- 1 & 2. CONCURRENCIA SIMULTÁNEA: 2 Y 5 SOLICITUDES ---');
    // --------------------------------------------------------------------------
    await test('1. Dos solicitudes simultáneas para el mismo evento generan 1 alerta y 1 omitida', async () => {
      inMemoryNotifications.length = 0;
      const alertParams = {
        userId: 1,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela 101',
        message: 'Riesgo alto',
        severity: 'critical',
        parcelId: 101,
        parcelName: 'Parcela 101',
        phenomenon: 'frost'
      };

      const [resA, resB] = await Promise.all([
        notificationService.createWeatherAlertAtomically(alertParams),
        notificationService.createWeatherAlertAtomically(alertParams)
      ]);

      const createdCount = (resA.created ? 1 : 0) + (resB.created ? 1 : 0);
      const skippedCount = (resA.skipped ? 1 : 0) + (resB.skipped ? 1 : 0);

      assert.strictEqual(createdCount, 1, 'Exactamente 1 solicitud debe crear la alerta');
      assert.strictEqual(skippedCount, 1, 'Exactamente 1 solicitud debe omitir el duplicado');
      assert.strictEqual(inMemoryNotifications.length, 1, 'BD debe contener exactamente 1 notificación');
    });

    await test('2. Cinco solicitudes simultáneas para el mismo evento generan 1 alerta y 4 omitidas', async () => {
      inMemoryNotifications.length = 0;
      const alertParams = {
        userId: 2,
        type: 'alerta_lluvia',
        title: '⚠️ Alerta: Riesgo de Lluvia Intensa — Parcela 201',
        message: 'Riesgo de inundación',
        severity: 'critical',
        parcelId: 201,
        parcelName: 'Parcela 201',
        phenomenon: 'heavy_rain'
      };

      const results = await Promise.all([
        notificationService.createWeatherAlertAtomically(alertParams),
        notificationService.createWeatherAlertAtomically(alertParams),
        notificationService.createWeatherAlertAtomically(alertParams),
        notificationService.createWeatherAlertAtomically(alertParams),
        notificationService.createWeatherAlertAtomically(alertParams)
      ]);

      const created = results.filter(r => r.created).length;
      const skipped = results.filter(r => r.skipped).length;

      assert.strictEqual(created, 1, 'Solo 1 de las 5 debe crear la alerta');
      assert.strictEqual(skipped, 4, 'Las otras 4 deben omitir');
      assert.strictEqual(inMemoryNotifications.length, 1, 'BD debe tener exactamente 1 alerta');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 3 & 4. IDENTIDAD DE PARCELAS: NOMBRES SIMILARES Y COMODINES ---');
    // --------------------------------------------------------------------------
    await test('3. Parcelas con nombres similares no generan falsos duplicados ni colisiones', async () => {
      inMemoryNotifications.length = 0;
      // Caso: "Chaupimarca" vs "Chaupimarca Alta"
      const resAlfa = await notificationService.createWeatherAlertAtomically({
        userId: 3,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Chaupimarca Alta',
        message: 'Helada',
        parcelId: 301,
        parcelName: 'Chaupimarca Alta',
        phenomenon: 'frost'
      });

      const resBase = await notificationService.createWeatherAlertAtomically({
        userId: 3,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Chaupimarca',
        message: 'Helada',
        parcelId: 302,
        parcelName: 'Chaupimarca',
        phenomenon: 'frost'
      });

      assert.strictEqual(resAlfa.created, true, 'Chaupimarca Alta debe crearse');
      assert.strictEqual(resBase.created, true, 'Chaupimarca no debe ser suprimida falsamente');
      assert.strictEqual(inMemoryNotifications.length, 2, 'Deben existir 2 alertas independientes en BD');
    });

    await test('4. Parcelas con caracteres especiales %, _ y \\ no sufren colisiones de comodines SQL', async () => {
      inMemoryNotifications.length = 0;
      // Verificar la función de escape
      const escapedPercent = notificationService.escapeLikePattern('Parcela 100% Organica');
      assert.strictEqual(escapedPercent, 'Parcela 100\\% Organica', 'Debe escapar el carácter %');

      const escapedUnderscore = notificationService.escapeLikePattern('Lote_1');
      assert.strictEqual(escapedUnderscore, 'Lote\\_1', 'Debe escapar el carácter _');

      const escapedBackslash = notificationService.escapeLikePattern('Lote\\Sec');
      assert.strictEqual(escapedBackslash, 'Lote\\\\Sec', 'Debe escapar el carácter \\');

      // Parcela 1: Lote_1
      const resLote1 = await notificationService.createWeatherAlertAtomically({
        userId: 4,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Lote_1',
        message: 'Helada',
        parcelId: 401,
        parcelName: 'Lote_1',
        phenomenon: 'frost'
      });

      // Parcela 2: Lote A (que coincidiría si _ no estuviera escapado en SQL LIKE)
      const resLoteA = await notificationService.createWeatherAlertAtomically({
        userId: 4,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Lote A',
        message: 'Helada',
        parcelId: 402,
        parcelName: 'Lote A',
        phenomenon: 'frost'
      });

      // Parcela 3: Lote\Sec
      const resLoteBackslash = await notificationService.createWeatherAlertAtomically({
        userId: 4,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Lote\\Sec',
        message: 'Helada',
        parcelId: 403,
        parcelName: 'Lote\\Sec',
        phenomenon: 'frost'
      });

      assert.strictEqual(resLote1.created, true);
      assert.strictEqual(resLoteA.created, true);
      assert.strictEqual(resLoteBackslash.created, true);
      assert.strictEqual(inMemoryNotifications.length, 3, 'Lote_1, Lote A y Lote\\Sec deben ser independientes');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 5 & 6. DIFERENCIACIÓN DE PARCELAS Y FENÓMENOS ---');
    // --------------------------------------------------------------------------
    await test('5. Parcelas diferentes del mismo agricultor generan alertas independientes', async () => {
      inMemoryNotifications.length = 0;
      const [resParcelA, resParcelB] = await Promise.all([
        notificationService.createWeatherAlertAtomically({
          userId: 5,
          type: 'alerta_helada',
          title: '⚠️ Alerta: Riesgo de Helada — Parcela 501',
          message: 'Helada',
          parcelId: 501,
          parcelName: 'Parcela 501',
          phenomenon: 'frost'
        }),
        notificationService.createWeatherAlertAtomically({
          userId: 5,
          type: 'alerta_helada',
          title: '⚠️ Alerta: Riesgo de Helada — Parcela 502',
          message: 'Helada',
          parcelId: 502,
          parcelName: 'Parcela 502',
          phenomenon: 'frost'
        })
      ]);

      assert.strictEqual(resParcelA.created, true);
      assert.strictEqual(resParcelB.created, true);
      assert.strictEqual(inMemoryNotifications.length, 2);
    });

    await test('6. Fenómenos diferentes en la misma parcela generan alertas independientes', async () => {
      inMemoryNotifications.length = 0;
      // Mismo tipo base alerta_helada, pero diferente fenómeno: frost vs snow
      const resFrost = await notificationService.createWeatherAlertAtomically({
        userId: 6,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela 601',
        message: 'Helada',
        parcelId: 601,
        parcelName: 'Parcela 601',
        phenomenon: 'frost'
      });

      const resSnow = await notificationService.createWeatherAlertAtomically({
        userId: 6,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Nevada — Parcela 601',
        message: 'Nevada',
        parcelId: 601,
        parcelName: 'Parcela 601',
        phenomenon: 'snow'
      });

      assert.strictEqual(resFrost.created, true, 'Alerta de helada debe crearse');
      assert.strictEqual(resSnow.created, true, 'Alerta de nevada debe crearse independientemente');
      assert.strictEqual(inMemoryNotifications.length, 2, 'Ambos fenómenos válidos deben coexistir');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 7 & 8. REGISTROS HISTÓRICOS Y VENTANA TEMPORAL ---');
    // --------------------------------------------------------------------------
    await test('7. Registros históricos con parcel_id NULL son detectados mediante fallback seguro', async () => {
      inMemoryNotifications.length = 0;
      // Registro histórico insertado con parcel_id NULL
      inMemoryNotifications.push({
        id: nextNotificationId++,
        user_id: 7,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela Histórica 701',
        message: 'Registro histórico',
        parcel_id: null,
        phenomenon: null,
        created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // hace 1 hora
      });

      // Intento de alerta moderna para la misma parcela histórica
      const resDuplicate = await notificationService.createWeatherAlertAtomically({
        userId: 7,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela Histórica 701',
        message: 'Nueva alerta',
        parcelId: 701,
        parcelName: 'Parcela Histórica 701',
        phenomenon: 'frost'
      });

      // Intento de alerta para otra parcela diferente
      const resDifferent = await notificationService.createWeatherAlertAtomically({
        userId: 7,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela Nueva 702',
        message: 'Nueva parcela',
        parcelId: 702,
        parcelName: 'Parcela Nueva 702',
        phenomenon: 'frost'
      });

      assert.strictEqual(resDuplicate.created, false, 'Debe detectar duplicado del registro histórico');
      assert.strictEqual(resDuplicate.skipped, true, 'Debe marcar skipped');
      assert.strictEqual(resDifferent.created, true, 'Otra parcela no debe ser afectada por el histórico');
      assert.strictEqual(inMemoryNotifications.length, 2);
    });

    await test('8. Ventana temporal de 6 horas: deduplicada dentro de 6h, permitida tras 6h', async () => {
      inMemoryNotifications.length = 0;
      // Alerta antigua creada hace 7 horas (ventana de 6h expirada)
      inMemoryNotifications.push({
        id: nextNotificationId++,
        user_id: 8,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela 801',
        message: 'Alerta ciclo anterior',
        parcel_id: 801,
        phenomenon: 'frost',
        created_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
      });

      // Nueva alerta después de 7 horas -> debe permitirse
      const resNewCycle = await notificationService.createWeatherAlertAtomically({
        userId: 8,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela 801',
        message: 'Nuevo ciclo',
        parcelId: 801,
        parcelName: 'Parcela 801',
        phenomenon: 'frost',
        windowHours: 6
      });

      assert.strictEqual(resNewCycle.created, true, 'Alerta después de 6h debe ser creada');

      // Intento inmediato siguiente -> debe deduplicarse
      const resImmediate = await notificationService.createWeatherAlertAtomically({
        userId: 8,
        type: 'alerta_helada',
        title: '⚠️ Alerta: Riesgo de Helada — Parcela 801',
        message: 'Duplicado inmediato',
        parcelId: 801,
        parcelName: 'Parcela 801',
        phenomenon: 'frost',
        windowHours: 6
      });

      assert.strictEqual(resImmediate.created, false);
      assert.strictEqual(resImmediate.skipped, true);
      assert.strictEqual(inMemoryNotifications.length, 2, 'Total en BD: 2 registros históricos');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 9 & 10. TRANSACCIONALIDAD: ROLLBACK Y LIBERACIÓN DE LOCKS ---');
    // --------------------------------------------------------------------------
    await test('9. Fallo de INSERT ejecuta ROLLBACK y no deja registros corruptos en BD', async () => {
      inMemoryNotifications.length = 0;
      let errorThrown = false;

      const originalMock = db.withTransaction;
      db.withTransaction = async (callback) => {
        const tx = createMockTransactionalContext();
        await tx.client.query('BEGIN');
        tx.dbRun = async () => {
          throw new Error('PostgreSQL Error: Disk quota exceeded on INSERT');
        };
        try {
          await callback(tx);
          await tx.client.query('COMMIT');
        } catch (e) {
          await tx.client.query('ROLLBACK');
          throw e;
        }
      };

      try {
        await notificationService.createWeatherAlertAtomically({
          userId: 9,
          type: 'alerta_helada',
          title: '⚠️ Alerta — Parcela 901',
          message: 'Test',
          parcelId: 901,
          parcelName: 'Parcela 901',
          phenomenon: 'frost'
        });
      } catch (e) {
        errorThrown = true;
        assert(e.message.includes('Disk quota exceeded'));
      } finally {
        db.withTransaction = originalMock;
      }

      assert.strictEqual(errorThrown, true, 'Debe propagar la excepción');
      assert.strictEqual(inMemoryNotifications.length, 0, 'No debe haber ningún registro residual');
    });

    await test('10. ROLLBACK libera inmediatamente el advisory lock para operaciones posteriores', async () => {
      // Verificar que ningún bloqueo haya quedado retenido
      assert.strictEqual(activeAdvisoryLocks.size, 0, 'No deben quedar bloqueos activos tras error');

      // Intentar una operación normal sobre la misma clave
      const res = await notificationService.createWeatherAlertAtomically({
        userId: 9,
        type: 'alerta_helada',
        title: '⚠️ Alerta — Parcela 901',
        message: 'Recuperado',
        parcelId: 901,
        parcelName: 'Parcela 901',
        phenomenon: 'frost'
      });

      assert.strictEqual(res.created, true, 'Debe adquirir el bloqueo y operar con normalidad');
      assert.strictEqual(activeAdvisoryLocks.size, 0, 'Lock liberado tras commit');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 11. AGOTAMIENTO DE LOCK_TIMEOUT ---');
    // --------------------------------------------------------------------------
    await test('11. Agotamiento de lock_timeout devuelve error controlado y libera la conexión', async () => {
      inMemoryNotifications.length = 0;
      const testKey = 'agropasco_alert:11:1101:frost';

      // Simular que otra transacción retiene el bloqueo
      activeAdvisoryLocks.add(testKey);

      // Simular tiempo de espera configurado en 10ms para la prueba
      const originalMock = db.withTransaction;
      db.withTransaction = async (callback) => {
        const tx = createMockTransactionalContext();
        await tx.client.query('BEGIN');
        tx.client.query = async (sql, params = []) => {
          if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return;
          if (sql.includes('pg_advisory_xact_lock')) {
            const err = new Error('canceling statement due to lock timeout');
            err.code = '55P03';
            throw err;
          }
        };
        try {
          await callback(tx);
          await tx.client.query('COMMIT');
        } catch (e) {
          await tx.client.query('ROLLBACK');
          throw e;
        }
      };

      try {
        const resTimeout = await notificationService.createWeatherAlertAtomically({
          userId: 11,
          type: 'alerta_helada',
          title: '⚠️ Alerta — Parcela 1101',
          message: 'Timeout test',
          parcelId: 1101,
          parcelName: 'Parcela 1101',
          phenomenon: 'frost'
        });

        assert.strictEqual(resTimeout.created, false, 'No debe crear alerta ante timeout');
        assert.strictEqual(resTimeout.skipped, false, 'No debe reportar skipped como si fuera duplicado');
        assert.strictEqual(resTimeout.error, 'lock_timeout', 'Debe clasificar como lock_timeout');
        assert.strictEqual(resTimeout.reason, 'lock_timeout_exceeded');
        assert.strictEqual(inMemoryNotifications.length, 0, 'No debe insertar registros parciales');
      } finally {
        activeAdvisoryLocks.delete(testKey);
        db.withTransaction = originalMock;
      }
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 12. INTEGRIDAD DE PARÁMETROS SQL Y ELIMINACIÓN DE MEZCLA ? CON $4 ---');
    // --------------------------------------------------------------------------
    await test('12. Consulta de deduplicación no mezcla marcadores ? con $4 y usa (? * INTERVAL 1 hour)', async () => {
      let interceptedSql = '';
      let interceptedParams = [];

      const originalMock = db.withTransaction;
      db.withTransaction = async (callback) => {
        const tx = {
          client: {
            query: async () => ({ rows: [] })
          },
          dbGet: async (sql, params) => {
            interceptedSql = sql;
            interceptedParams = params;
            return undefined;
          },
          dbRun: async () => ({ lastID: 999, changes: 1 })
        };
        return await callback(tx);
      };

      try {
        await notificationService.createWeatherAlertAtomically({
          userId: 12,
          type: 'alerta_helada',
          title: '⚠️ Alerta — Parcela 1201',
          message: 'Audit SQL',
          parcelId: 1201,
          parcelName: 'Parcela 1201',
          phenomenon: 'frost',
          windowHours: 6
        });

        // 1. Ausencia de mezcla ? con $N
        assert.strictEqual(interceptedSql.includes('$'), false, 'El SQL antes de convertPlaceholders no debe contener $N crudo');
        assert.strictEqual(interceptedSql.includes('?'), true, 'El SQL debe contener marcadores ? consistentes');

        // 2. Uso correcto de NOW() - (? * INTERVAL '1 hour')
        assert.strictEqual(interceptedSql.includes("NOW() - (? * INTERVAL '1 hour')"), true, 'Debe usar aritmética de intervalo parametrizada');

        // 3. Parámetro windowHours es el último y es de tipo number
        const lastParam = interceptedParams[interceptedParams.length - 1];
        assert.strictEqual(typeof lastParam, 'number', 'windowHours debe ser numérico');
        assert.strictEqual(lastParam, 6, 'windowHours debe ser 6');

        // 4. Transformación limpia de convertPlaceholders
        const converted = db.convertPlaceholders(interceptedSql);
        assert.strictEqual(converted.includes('?'), false, 'convertPlaceholders debe eliminar todos los ?');
        assert.strictEqual(converted.includes('$1'), true, 'convertPlaceholders debe incluir $1');
        assert.strictEqual(converted.includes('$2'), true, 'convertPlaceholders debe incluir $2');

        // 5. Prevención estricta de ERROR 22025 en PostgreSQL 16 (sin ESCAPE '\\\\')
        assert.strictEqual(interceptedSql.includes("ESCAPE '\\\\'"), false, 'El SQL no debe contener ESCAPE \\\\');
        assert.strictEqual(/ESCAPE\s*['"]?[^'"]{2,}['"]?/i.test(interceptedSql), false, 'No debe contener cláusula ESCAPE de más de 1 carácter');
        assert.strictEqual(converted.includes("ESCAPE '\\\\'"), false, 'El SQL convertido no debe contener ESCAPE \\\\');
      } finally {
        db.withTransaction = originalMock;
      }
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 13. COMPATIBILIDAD DE CONSULTAS POSTGRESQL NATIVAS ($1, $2) ---');
    // --------------------------------------------------------------------------
    await test('13. convertPlaceholders preserva intactas consultas nativas de PostgreSQL con $1, $2', async () => {
      const nativeSql = 'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 AND created_at > NOW() - ($3 * INTERVAL \'1 hour\')';
      const result = db.convertPlaceholders(nativeSql);
      assert.strictEqual(result, nativeSql, 'No debe alterar consultas nativas que no contengan marcadores ?');

      const mixedWithQuotes = "SELECT * FROM users WHERE status = '?' AND id = ?";
      const resultQuotes = db.convertPlaceholders(mixedWithQuotes);
      assert.strictEqual(resultQuotes, "SELECT * FROM users WHERE status = '?' AND id = $1", 'Solo debe reemplazar el ? fuera de comillas');
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 14. PREFERENCIAS DEL AGRICULTOR, CONTROL RBAC Y generateAlerts ---');
    // --------------------------------------------------------------------------
    await test('14. generateAlerts respeta preferencias, roles y previene duplicados en concurrencia', async () => {
      inMemoryNotifications.length = 0;
      const originalDbAll = db.dbAll;
      const originalDbGet = db.dbGet;

      db.dbAll = async (sql) => {
        if (sql.includes('FROM parcels')) {
          return [
            { id: 1401, user_id: 141, name: 'Parcela Norte', altitude_masl: 4100, center_lat: -10.66, center_lng: -76.25 },
            { id: 1402, user_id: 142, name: 'Parcela Sur', altitude_masl: 3800, center_lat: -10.45, center_lng: -76.35 }
          ];
        }
        return [];
      };

      db.dbGet = async (sql) => {
        if (sql.includes('FROM alert_preferences')) {
          return { frost_enabled: 1, heavy_rain_enabled: 1, snow_enabled: 1, hail_enabled: 1, min_risk_level: 'moderate' };
        }
        return undefined;
      };

      const originalGetPrediction = require('../services/mlService').getPredictionForParcel;
      require('../services/mlService').getPredictionForParcel = async () => ({
        success: true,
        data: {
          predictions: [
            { phenomenon: 'frost', risk_level: 'high', risk_score: 88, model_type: 'ml_trained', period: '24h' }
          ]
        }
      });

      let resDataA, resDataB;
      const req = { user: { role: 'admin' } };
      const resA = {
        statusCode: 200,
        status: function(c) { this.statusCode = c; return this; },
        json: function(d) { resDataA = d; }
      };
      const resB = {
        statusCode: 200,
        status: function(c) { this.statusCode = c; return this; },
        json: function(d) { resDataB = d; }
      };

      try {
        // Concurrencia de 2 solicitudes completas a generateAlerts
        await Promise.all([
          mlController.generateAlerts(req, resA),
          mlController.generateAlerts(req, resB)
        ]);

        assert.strictEqual(resDataA.success, true);
        assert.strictEqual(resDataB.success, true);

        const totalCreated = resDataA.data.alerts_created + resDataB.data.alerts_created;
        const totalSkipped = resDataA.data.alerts_skipped_duplicate + resDataB.data.alerts_skipped_duplicate;

        assert.strictEqual(totalCreated, 2, 'Deben crearse exactamente 2 alertas (1 por cada parcela)');
        assert.strictEqual(totalSkipped, 2, 'Deben omitirse exactamente 2 alertas duplicadas');
        assert.strictEqual(inMemoryNotifications.length, 2, 'Exactamente 2 registros en BD');
      } finally {
        db.dbAll = originalDbAll;
        db.dbGet = originalDbGet;
        require('../services/mlService').getPredictionForParcel = originalGetPrediction;
      }
    });

    // --------------------------------------------------------------------------
    console.log('\n--- 15. PREVENCIÓN DEFINITIVA DEL ERROR SQL 22025 Y COMPATIBILIDAD CON POSTGRESQL 16 ---');
    // --------------------------------------------------------------------------
    await test('15. El SQL de deduplicación no genera ERROR 22025 y preserva coincidencia exacta con %, _ y \\', async () => {
      inMemoryNotifications.length = 0;

      // 1. Inserción de alerta con caracteres especiales %, _ y \
      const resComplex1 = await notificationService.createWeatherAlertAtomically({
        userId: 15,
        type: 'alerta_helada',
        title: '⚠️ Alerta — Lote_100%\\Especial',
        message: 'Prueba de caracteres especiales',
        parcelId: 1501,
        parcelName: 'Lote_100%\\Especial',
        phenomenon: 'frost',
        windowHours: 6
      });
      assert.strictEqual(resComplex1.created, true, 'Debe crear la alerta sin ERROR 22025');

      // 2. Intento duplicado del mismo evento complejo -> deduplicado
      const resComplexDup = await notificationService.createWeatherAlertAtomically({
        userId: 15,
        type: 'alerta_helada',
        title: '⚠️ Alerta — Lote_100%\\Especial',
        message: 'Duplicado idéntico',
        parcelId: 1501,
        parcelName: 'Lote_100%\\Especial',
        phenomenon: 'frost',
        windowHours: 6
      });
      assert.strictEqual(resComplexDup.skipped, true, 'Debe deduplicar correctamente');

      // 3. Parcela similar con carácter que coincidiría con comodín no escapado (LoteA en vez de Lote_)
      const resComplexSimilar = await notificationService.createWeatherAlertAtomically({
        userId: 15,
        type: 'alerta_helada',
        title: '⚠️ Alerta — LoteA100%\\Especial',
        message: 'Parcela similar no debe colisionar',
        parcelId: 1502,
        parcelName: 'LoteA100%\\Especial',
        phenomenon: 'frost',
        windowHours: 6
      });
      assert.strictEqual(resComplexSimilar.created, true, 'Parcela con A en vez de _ no debe colisionar');

      // 4. Fenómeno distinto en la misma parcela -> alerta independiente
      const resComplexRain = await notificationService.createWeatherAlertAtomically({
        userId: 15,
        type: 'alerta_lluvia',
        title: '⚠️ Alerta — Lote_100%\\Especial',
        message: 'Lluvia en misma parcela',
        parcelId: 1501,
        parcelName: 'Lote_100%\\Especial',
        phenomenon: 'heavy_rain',
        windowHours: 6
      });
      assert.strictEqual(resComplexRain.created, true, 'Fenómeno distinto genera alerta independiente');

      // 5. Histórico con parcel_id NULL y caracteres complejos
      inMemoryNotifications.push({
        id: nextNotificationId++,
        user_id: 15,
        type: 'alerta_helada',
        title: '⚠️ Alerta Histórica — Lote_Hist%\\Old',
        message: 'Histórico sin parcel_id',
        severity: 'warning',
        parcel_id: null,
        phenomenon: 'frost',
        model_type: 'rule_based',
        created_at: new Date().toISOString()
      });

      const resHistDup = await notificationService.createWeatherAlertAtomically({
        userId: 15,
        type: 'alerta_helada',
        title: '⚠️ Alerta — Lote_Hist%\\Old',
        message: 'Intento sobre histórico',
        parcelName: 'Lote_Hist%\\Old',
        phenomenon: 'frost',
        windowHours: 6
      });
      assert.strictEqual(resHistDup.skipped, true, 'Histórico con parcel_id NULL es detectado sin error');
      assert.strictEqual(inMemoryNotifications.length, 4, 'Total de 4 registros independientes y consistentes en BD');
    });

  } finally {
    db.withTransaction = originalWithTransaction;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADOS SUITE ALERTAS: ${passed} APROBADAS | ${failed} FALLIDAS (Total: ${passed + failed})`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.error('❌ SE DETECTARON PRUEBAS FALLIDAS EN DEDUPLICACIÓN DE ALERTAS.');
    process.exit(1);
  } else {
    console.log(`🎉 TODAS LAS ${passed} PRUEBAS DE DEDUPLICACIÓN, SQL Y CONCURRENCIA PASARON (100% OK).\n`);
  }
}

runAlertDeduplicationSuite().catch(err => {
  console.error('Error fatal ejecutando suite de alertas:', err);
  process.exit(1);
});
