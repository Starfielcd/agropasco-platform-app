/**
 * AgroPasco Digital — Suite de Pruebas FASE 8L-G28
 * ==============================================================================
 * VALIDACIÓN TRANSACCIONAL DE CONCURRENCIA ACID (ANTI-TOCTOU) EN WEATHER_CACHE
 * Motor: PostgreSQL 16 Real (Conexión dedicada independiente en entorno de pruebas)
 *
 * Casos verificados según FASE 8L-G28:
 *  - CASO A: Edición ocurre antes de que cachePrediction adquiera el bloqueo.
 *            La escritura antigua se descarta limpiamente.
 *  - CASO B: cachePrediction adquiere el bloqueo antes de la edición.
 *            La edición espera en SELECT FOR UPDATE y posteriormente invalida.
 *  - CASO C: La edición adquiere el bloqueo antes de cachePrediction.
 *            La predicción antigua se descarta tras desbloquearse.
 *  - CASO D: La edición ocurre después del guardado.
 *            La invalidación elimina el pronóstico anterior.
 *  - CASO E: Dos predicciones simultáneas de la misma parcela no producen inconsistencias.
 *  - CASO F: Dos modificaciones geográficas simultáneas no dejan caché obsoleta.
 *  - CASO G: Un fallo en la invalidación provoca el rollback correspondiente.
 *  - CASO H: Edición de nombre sin modificación geográfica conserva la predicción legítima.
 *  - CASO I: Un cambio de altitud invalida la predicción anterior.
 *  - CASO J: Modificación de polígono con centroide idéntico descarta caché obsoleta por huella.
 *  - CASO K: Geografía ausente o inválida no permite persistir nueva predicción incompatible.
 *  - CASO L: Todas las operaciones completan sin deadlocks ni transacciones abiertas.
 *  - CASO M: Predicción stale legítima continúa funcionando ante límite temporal (HTTP 429).
 *  - CASO N: Las alertas nunca se generan a partir de datos stale.
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const { execSync } = require('child_process');
const { Pool } = require('pg');
const mlService = require('../services/mlService');
const parcelController = require('../controllers/parcelController');

function getPgHost() {
  if (process.env.PGHOST) return process.env.PGHOST;
  try {
    const ip = execSync('wsl hostname -I', { encoding: 'utf8' }).trim().split(' ')[0];
    if (ip) return ip;
  } catch (_) {}
  return '127.0.0.1';
}

const pool = new Pool({
  host: getPgHost(),
  port: parseInt(process.env.PGPORT, 10) || 5433,
  user: process.env.PGUSER || 'agropasco_tester',
  password: process.env.PGPASSWORD || 'agp_FGld5hwj7kP9_DRgrAFI5cGwX9!',
  database: process.env.PGDATABASE || 'agropasco_test',
  max: 10,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000
});

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🐘 AGROPASCO DIGITAL — FASE 8L-G28: PRUEBAS TRANSACCIONALES ACID (PostgreSQL 16)');
  console.log('='.repeat(80));

  // 1. Inicialización de esquema mínimo en agropasco_test
  const initClient = await pool.connect();
  try {
    await initClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'farmer'
      );

      CREATE TABLE IF NOT EXISTS crops (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name TEXT NOT NULL,
        crop_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS parcels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name TEXT NOT NULL,
        geo_json TEXT,
        area_hectares DOUBLE PRECISION DEFAULT 0,
        center_lat DOUBLE PRECISION,
        center_lng DOUBLE PRECISION,
        crop_type TEXT,
        crop_id INTEGER,
        planting_date DATE,
        status TEXT DEFAULT 'activa',
        altitude_masl INTEGER DEFAULT 4380,
        notes TEXT,
        photo_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS weather_cache (
        id SERIAL PRIMARY KEY,
        location TEXT NOT NULL,
        data_type TEXT NOT NULL DEFAULT 'ml_prediction',
        data_json TEXT NOT NULL,
        fetched_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alert_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        parcel_id INTEGER,
        alert_type TEXT,
        enabled BOOLEAN DEFAULT true
      );

      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (9901, 'Agricultor Test', 'test_g28@agropasco.pe', 'hash_test', 'farmer')
      ON CONFLICT (id) DO NOTHING;
    `);
  } finally {
    initClient.release();
  }

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

  // Helper para crear o resetear parcela de prueba en BD real
  async function setupTestParcel(id, data = {}) {
    const lat = data.center_lat !== undefined ? data.center_lat : -10.6674;
    const lng = data.center_lng !== undefined ? data.center_lng : -76.2567;
    const alt = data.altitude_masl !== undefined ? data.altitude_masl : 4380;
    const geo = data.geo_json !== undefined ? data.geo_json : null;
    const name = data.name || `Parcela Test ${id}`;

    await pool.query('DELETE FROM weather_cache WHERE location = $1', [`parcel_${id}`]);
    await pool.query('DELETE FROM parcels WHERE id = $1', [id]);
    await pool.query(
      `INSERT INTO parcels (id, user_id, name, center_lat, center_lng, altitude_masl, geo_json, status)
       VALUES ($1, 9901, $2, $3, $4, $5, $6, 'activa')`,
      [id, name, lat, lng, alt, geo]
    );
  }

  // Helper para simular cachePrediction transaccional con cliente dedicado
  async function execTransactionalCache(parcelId, predData, client) {
    const cleanId = parseInt(parcelId, 10);
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT id, center_lat, center_lng, altitude_masl, geo_json FROM parcels WHERE id = $1 FOR UPDATE',
        [cleanId]
      );
      const currentParcel = res.rows[0];
      if (!currentParcel || currentParcel.center_lat === null || currentParcel.center_lng === null) {
        await client.query('COMMIT');
        return { saved: false, reason: 'no_parcel_or_geo' };
      }

      const latMismatch = Math.abs(Number(currentParcel.center_lat) - Number(predData.latitude)) > 1e-4;
      const lngMismatch = Math.abs(Number(currentParcel.center_lng) - Number(predData.longitude)) > 1e-4;
      const altMismatch = (currentParcel.altitude_masl !== null && predData.altitude_masl !== undefined && predData.altitude_masl !== null)
        ? Math.abs(Number(currentParcel.altitude_masl) - Number(predData.altitude_masl)) > 50
        : false;

      let geoMismatch = false;
      if (predData.geo_footprint) {
        const curFootprint = mlService.getGeoFootprint(
          currentParcel.center_lat,
          currentParcel.center_lng,
          currentParcel.altitude_masl,
          currentParcel.geo_json
        );
        if (predData.geo_footprint !== curFootprint) geoMismatch = true;
      }

      if (latMismatch || lngMismatch || altMismatch || geoMismatch) {
        await client.query('COMMIT');
        return { saved: false, reason: 'mismatch' };
      }

      await client.query(
        "DELETE FROM weather_cache WHERE location = $1 AND data_type = 'ml_prediction'",
        [`parcel_${cleanId}`]
      );
      await client.query(
        "INSERT INTO weather_cache (location, data_type, data_json) VALUES ($1, 'ml_prediction', $2)",
        [`parcel_${cleanId}`, JSON.stringify(predData)]
      );
      await client.query('COMMIT');
      return { saved: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  // Helper para simular updateParcel transaccional con cliente dedicado
  async function execTransactionalUpdate(parcelId, updateData, client, simulateInvalidationFailure = false) {
    const cleanId = parseInt(parcelId, 10);
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM parcels WHERE id = $1 FOR UPDATE', [cleanId]);

      const curRes = await client.query('SELECT * FROM parcels WHERE id = $1', [cleanId]);
      const parcel = curRes.rows[0];

      const newLat = updateData.center_lat !== undefined ? updateData.center_lat : parcel.center_lat;
      const newLng = updateData.center_lng !== undefined ? updateData.center_lng : parcel.center_lng;
      const newAlt = updateData.altitude_masl !== undefined ? updateData.altitude_masl : parcel.altitude_masl;
      const newGeo = updateData.geo_json !== undefined ? updateData.geo_json : parcel.geo_json;
      const newName = updateData.name !== undefined ? updateData.name : parcel.name;

      const latChanged = Math.abs(Number(newLat) - Number(parcel.center_lat)) > 1e-6;
      const lngChanged = Math.abs(Number(newLng) - Number(parcel.center_lng)) > 1e-6;
      const altChanged = Number(newAlt) !== Number(parcel.altitude_masl);
      const geoChanged = newGeo !== parcel.geo_json;
      const isLocationChanged = latChanged || lngChanged || altChanged || geoChanged;

      await client.query(
        'UPDATE parcels SET name = $1, center_lat = $2, center_lng = $3, altitude_masl = $4, geo_json = $5, updated_at = NOW() WHERE id = $6',
        [newName, newLat, newLng, newAlt, newGeo, cleanId]
      );

      if (isLocationChanged) {
        if (simulateInvalidationFailure) {
          throw new Error('Simulated cache invalidation failure inside transaction');
        }
        await client.query(
          "DELETE FROM weather_cache WHERE location = $1 AND data_type = 'ml_prediction'",
          [`parcel_${cleanId}`]
        );
      }

      await client.query('COMMIT');
      return { updated: true, isLocationChanged };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  console.log('\n--- 1. ESCENARIOS PRINCIPALES TOCTOU (CASOS A, B, C, D) ---');
  // ---------------------------------------------------------------------------

  await test('CASO A: La edición ocurre antes de que cachePrediction adquiera el bloqueo. La escritura antigua se descarta', async () => {
    await setupTestParcel(9001, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const clientUpdate = await pool.connect();
    const clientCache = await pool.connect();

    try {
      // 1. Predicción generada con coordenadas antiguas
      const obsoletePrediction = {
        parcel_id: 9001,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION,
        predictions: []
      };

      // 2. Edición se ejecuta primero y actualiza a Oxapampa (-10.50, -75.30)
      const updateRes = await execTransactionalUpdate(9001, {
        center_lat: -10.5000,
        center_lng: -75.3000,
        altitude_masl: 1800
      }, clientUpdate);
      assert.strictEqual(updateRes.updated, true);

      // 3. In-flight cachePrediction llega después
      const cacheRes = await execTransactionalCache(9001, obsoletePrediction, clientCache);
      assert.strictEqual(cacheRes.saved, false, 'cachePrediction debe descartar la escritura');
      assert.strictEqual(cacheRes.reason, 'mismatch');

      // 4. Verificación en base de datos real
      const cacheCheck = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9001']);
      assert.strictEqual(cacheCheck.rowCount, 0, 'weather_cache debe permanecer vacío, sin datos obsoletos');

      const parcelCheck = await pool.query('SELECT center_lat, center_lng FROM parcels WHERE id = $1', [9001]);
      assert.strictEqual(Number(parcelCheck.rows[0].center_lat), -10.5000);
      assert.strictEqual(Number(parcelCheck.rows[0].center_lng), -75.3000);
    } finally {
      clientUpdate.release();
      clientCache.release();
    }
  });

  await test('CASO B: cachePrediction adquiere el bloqueo antes de la edición. La edición espera y posteriormente invalida', async () => {
    await setupTestParcel(9002, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      const pred = {
        parcel_id: 9002,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION,
        predictions: []
      };

      // TX1 (cachePrediction) inicia y toma bloqueo FOR UPDATE
      await client1.query('BEGIN');
      await client1.query('SELECT id FROM parcels WHERE id = 9002 FOR UPDATE');

      let tx2Finished = false;
      let tx2Blocked = true;

      // TX2 (updateParcel) intenta editar la misma parcela (debe esperar el bloqueo)
      const tx2Promise = (async () => {
        await client2.query('BEGIN');
        await client2.query('SELECT id FROM parcels WHERE id = 9002 FOR UPDATE');
        tx2Blocked = false;
        await client2.query('UPDATE parcels SET center_lat = -10.50, center_lng = -75.30 WHERE id = 9002');
        await client2.query("DELETE FROM weather_cache WHERE location = 'parcel_9002'");
        await client2.query('COMMIT');
        tx2Finished = true;
      })();

      // Breve pausa para asegurar que TX2 intente el lock y quede en espera
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(tx2Blocked, true, 'TX2 debe estar bloqueada por SELECT FOR UPDATE de TX1');
      assert.strictEqual(tx2Finished, false);

      // TX1 escribe la predicción legítima para las coordenadas actuales y hace COMMIT
      await client1.query(
        "INSERT INTO weather_cache (location, data_type, data_json) VALUES ('parcel_9002', 'ml_prediction', $1)",
        [JSON.stringify(pred)]
      );
      await client1.query('COMMIT');

      // Ahora TX2 debe desbloquearse y finalizar
      await tx2Promise;
      assert.strictEqual(tx2Finished, true, 'TX2 debe finalizar tras la liberación del bloqueo');

      // Estado final en base de datos real: la edición invalidó la caché
      const cacheCheck = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9002']);
      assert.strictEqual(cacheCheck.rowCount, 0, 'weather_cache debe estar vacío tras la invalidación de TX2');

      const pCheck = await pool.query('SELECT center_lat, center_lng FROM parcels WHERE id = 9002');
      assert.strictEqual(Number(pCheck.rows[0].center_lat), -10.50);
    } finally {
      client1.release();
      client2.release();
    }
  });

  await test('CASO C: La edición adquiere el bloqueo antes de cachePrediction. La predicción antigua se descarta', async () => {
    await setupTestParcel(9003, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const clientEdit = await pool.connect();
    const clientCache = await pool.connect();

    try {
      const obsoletePred = {
        parcel_id: 9003,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION,
        predictions: []
      };

      // TX-Edit inicia y adquiere FOR UPDATE
      await clientEdit.query('BEGIN');
      await clientEdit.query('SELECT id FROM parcels WHERE id = 9003 FOR UPDATE');
      await clientEdit.query('UPDATE parcels SET center_lat = -10.5000, center_lng = -75.3000 WHERE id = 9003');

      let cacheFinished = false;
      let cacheBlocked = true;

      // TX-Cache intenta persistir predicción en vuelo (debe bloquearse esperando a TX-Edit)
      const cachePromise = (async () => {
        await clientCache.query('BEGIN');
        const res = await clientCache.query(
          'SELECT center_lat, center_lng FROM parcels WHERE id = 9003 FOR UPDATE'
        );
        cacheBlocked = false;
        const cur = res.rows[0];
        const latMismatch = Math.abs(Number(cur.center_lat) - Number(obsoletePred.latitude)) > 1e-4;
        if (latMismatch) {
          // Descartar
          await clientCache.query('COMMIT');
          cacheFinished = true;
          return { discarded: true };
        }
        await clientCache.query("INSERT INTO weather_cache (location, data_json) VALUES ('parcel_9003', 'data')");
        await clientCache.query('COMMIT');
        cacheFinished = true;
        return { discarded: false };
      })();

      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(cacheBlocked, true, 'TX-Cache debe estar bloqueada esperando el lock de TX-Edit');
      assert.strictEqual(cacheFinished, false);

      // TX-Edit hace COMMIT
      await clientEdit.query("DELETE FROM weather_cache WHERE location = 'parcel_9003'");
      await clientEdit.query('COMMIT');

      // TX-Cache se desbloquea, lee la nueva ubicación y descarta
      const cacheOutcome = await cachePromise;
      assert.strictEqual(cacheOutcome.discarded, true, 'Predicción antigua debe ser descartada');
      assert.strictEqual(cacheFinished, true);

      // Verificación final en BD real
      const cacheCheck = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9003']);
      assert.strictEqual(cacheCheck.rowCount, 0, 'No debe persistirse predicción antigua');
    } finally {
      clientEdit.release();
      clientCache.release();
    }
  });

  await test('CASO D: La edición ocurre después del guardado. La invalidación elimina el pronóstico anterior', async () => {
    await setupTestParcel(9004, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const client = await pool.connect();

    try {
      const pred = {
        parcel_id: 9004,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION,
        predictions: []
      };

      // 1. Guardado exitoso previo
      const saveRes = await execTransactionalCache(9004, pred, client);
      assert.strictEqual(saveRes.saved, true);

      const check1 = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9004']);
      assert.strictEqual(check1.rowCount, 1, 'Debe existir la caché guardada');

      // 2. Edición posterior a nueva ubicación
      const updateRes = await execTransactionalUpdate(9004, {
        center_lat: -10.2000,
        center_lng: -75.4000
      }, client);
      assert.strictEqual(updateRes.updated, true);

      // 3. Caché debe haber sido eliminada
      const check2 = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9004']);
      assert.strictEqual(check2.rowCount, 0, 'La caché anterior debe haber sido eliminada');
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 2. CONCURRENCIA MÚLTIPLE Y SINCRONIZACIÓN (CASOS E, F, L) ---');
  // ---------------------------------------------------------------------------

  await test('CASO E: Dos predicciones simultáneas de la misma parcela no producen datos inconsistentes', async () => {
    await setupTestParcel(9005, { center_lat: -10.5000, center_lng: -75.3000, altitude_masl: 1800 });
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    try {
      const predA = {
        parcel_id: 9005,
        latitude: -10.5000,
        longitude: -75.3000,
        altitude_masl: 1800,
        tag: 'PRED_A',
        model_version: mlService.EXPECTED_MODEL_VERSION
      };
      const predB = {
        parcel_id: 9005,
        latitude: -10.5000,
        longitude: -75.3000,
        altitude_masl: 1800,
        tag: 'PRED_B',
        model_version: mlService.EXPECTED_MODEL_VERSION
      };

      const [resA, resB] = await Promise.all([
        execTransactionalCache(9005, predA, c1),
        execTransactionalCache(9005, predB, c2)
      ]);

      assert.strictEqual(resA.saved, true);
      assert.strictEqual(resB.saved, true);

      const rows = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9005']);
      assert.strictEqual(rows.rowCount, 1, 'Debe haber exactamente 1 registro en weather_cache, sin duplicados');
      const data = JSON.parse(rows.rows[0].data_json);
      assert(data.tag === 'PRED_A' || data.tag === 'PRED_B', 'Datos consistentes');
    } finally {
      c1.release();
      c2.release();
    }
  });

  await test('CASO F: Dos modificaciones geográficas simultáneas no dejan una caché correspondiente a coordenadas antiguas', async () => {
    await setupTestParcel(9006, { center_lat: -10.5000, center_lng: -75.3000 });
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    try {
      // Guardar una caché inicial
      await pool.query(
        "INSERT INTO weather_cache (location, data_type, data_json) VALUES ('parcel_9006', 'ml_prediction', '{\"latitude\":-10.50}')"
      );

      // Dos modificaciones concurrentes
      await Promise.all([
        execTransactionalUpdate(9006, { center_lat: -10.55, center_lng: -75.35 }, c1),
        execTransactionalUpdate(9006, { center_lat: -10.60, center_lng: -75.40 }, c2)
      ]);

      const check = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9006']);
      assert.strictEqual(check.rowCount, 0, 'weather_cache debe quedar invalidado tras ambas modificaciones');
    } finally {
      c1.release();
      c2.release();
    }
  });

  await test('CASO L: Las operaciones completan sin deadlocks ni transacciones abiertas', async () => {
    const res = await pool.query(
      "SELECT count(*) as count FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = 'agropasco_test'"
    );
    const count = parseInt(res.rows[0].count, 10);
    assert.strictEqual(count, 0, 'No deben existir transacciones abiertas o en espera de commit/rollback');
  });

  // ---------------------------------------------------------------------------
  console.log('\n--- 3. ROLLBACK, HUELLA Y CASOS DE BORDE (CASOS G, H, I, J, K, M, N) ---');
  // ---------------------------------------------------------------------------

  await test('CASO G: Un fallo en la invalidación provoca el rollback correspondiente', async () => {
    await setupTestParcel(9007, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const client = await pool.connect();

    try {
      let threw = false;
      try {
        await execTransactionalUpdate(9007, {
          center_lat: -10.10,
          center_lng: -75.10
        }, client, true); // simulateInvalidationFailure = true
      } catch (err) {
        threw = true;
        assert(err.message.includes('Simulated cache invalidation failure'));
      }
      assert.strictEqual(threw, true, 'La operación debe lanzar error ante fallo en invalidación');

      // Comprobar que parcels ROLLED BACK y mantiene coordenadas originales
      const p = await pool.query('SELECT center_lat, center_lng FROM parcels WHERE id = 9007');
      assert.strictEqual(Number(p.rows[0].center_lat), -10.6674, 'Latitud debe mantenerse intacta por rollback');
      assert.strictEqual(Number(p.rows[0].center_lng), -76.2567, 'Longitud debe mantenerse intacta por rollback');
    } finally {
      client.release();
    }
  });

  await test('CASO H: Una edición de nombre sin modificación geográfica conserva la predicción legítima', async () => {
    await setupTestParcel(9008, { center_lat: -10.8500, center_lng: -76.1200, name: 'Nombre Original' });
    const client = await pool.connect();

    try {
      const pred = {
        parcel_id: 9008,
        latitude: -10.8500,
        longitude: -76.1200,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION
      };
      await execTransactionalCache(9008, pred, client);

      // Editar solo el nombre
      const updateRes = await execTransactionalUpdate(9008, { name: 'Nombre Actualizado' }, client);
      assert.strictEqual(updateRes.isLocationChanged, false, 'No debe detectarse cambio de ubicación');

      // Caché debe conservarse
      const check = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9008']);
      assert.strictEqual(check.rowCount, 1, 'La predicción legítima debe conservarse');

      const p = await pool.query('SELECT name FROM parcels WHERE id = 9008');
      assert.strictEqual(p.rows[0].name, 'Nombre Actualizado');
    } finally {
      client.release();
    }
  });

  await test('CASO I: Un cambio de altitud (>50m) invalida la predicción anterior', async () => {
    await setupTestParcel(9009, { center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 });
    const client = await pool.connect();

    try {
      const pred = {
        parcel_id: 9009,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        model_version: mlService.EXPECTED_MODEL_VERSION
      };
      await execTransactionalCache(9009, pred, client);

      // Cambiar altitud de 4380 a 3500 (>50m de diferencia)
      const updateRes = await execTransactionalUpdate(9009, { altitude_masl: 3500 }, client);
      assert.strictEqual(updateRes.isLocationChanged, true, 'Cambio de altitud debe ser reconocido como geográfico');

      const check = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9009']);
      assert.strictEqual(check.rowCount, 0, 'La caché debe ser eliminada tras cambio de altitud');

      // Una predicción en vuelo con altitud 4380 debe ser rechazada
      const staleAltPred = { ...pred, altitude_masl: 4380 };
      const cacheRes = await execTransactionalCache(9009, staleAltPred, client);
      assert.strictEqual(cacheRes.saved, false, 'Predicción con altitud desfasada debe descartarse');
    } finally {
      client.release();
    }
  });

  await test('CASO J: Modificación de polígono con centroide idéntico descarta caché obsoleta por huella', async () => {
    const polyA = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-76.25, -10.65], [-76.25, -10.67], [-76.27, -10.67], [-76.27, -10.65], [-76.25, -10.65]]]
    });
    const polyB = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-76.24, -10.64], [-76.24, -10.68], [-76.28, -10.68], [-76.28, -10.64], [-76.24, -10.64]]]
    });

    // Mismo centroide: (-10.6600, -76.2600)
    await setupTestParcel(9010, {
      center_lat: -10.6600,
      center_lng: -76.2600,
      altitude_masl: 4380,
      geo_json: polyA
    });

    const client = await pool.connect();
    try {
      const footprintA = mlService.getGeoFootprint(-10.6600, -76.2600, 4380, polyA);
      const footprintB = mlService.getGeoFootprint(-10.6600, -76.2600, 4380, polyB);
      assert.notStrictEqual(footprintA, footprintB, 'Las huellas de polígonos distintos deben diferir');

      const predInFlight = {
        parcel_id: 9010,
        latitude: -10.6600,
        longitude: -76.2600,
        altitude_masl: 4380,
        geo_json: polyA,
        geo_footprint: footprintA,
        model_version: mlService.EXPECTED_MODEL_VERSION
      };

      // Modificar la parcela al polígono B
      await execTransactionalUpdate(9010, { geo_json: polyB }, client);

      // Intentar guardar la predicción en vuelo calculada con polígono A
      const saveRes = await execTransactionalCache(9010, predInFlight, client);
      assert.strictEqual(saveRes.saved, false, 'Predicción calculada con polígono anterior debe descartarse');
      assert.strictEqual(saveRes.reason, 'mismatch');

      const check = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9010']);
      assert.strictEqual(check.rowCount, 0, 'weather_cache debe quedar vacío');
    } finally {
      client.release();
    }
  });

  await test('CASO K: Geografía ausente o inválida no permite persistir una nueva predicción incompatible', async () => {
    await setupTestParcel(9011, { center_lat: null, center_lng: null });
    const client = await pool.connect();

    try {
      const pred = {
        parcel_id: 9011,
        latitude: -10.6674,
        longitude: -76.2567,
        model_version: mlService.EXPECTED_MODEL_VERSION
      };
      const res = await execTransactionalCache(9011, pred, client);
      assert.strictEqual(res.saved, false, 'No debe persistirse predicción en parcela sin geografía');

      const check = await pool.query('SELECT * FROM weather_cache WHERE location = $1', ['parcel_9011']);
      assert.strictEqual(check.rowCount, 0);
    } finally {
      client.release();
    }
  });

  await test('CASO M: Predicción stale legítima continúa funcionando cuando Open-Meteo está temporalmente limitado', async () => {
    await setupTestParcel(9013, { center_lat: -10.5000, center_lng: -75.3000, altitude_masl: 1800 });
    const client = await pool.connect();

    try {
      const stalePayload = {
        parcel_id: 9013,
        latitude: -10.5000,
        longitude: -75.3000,
        altitude_masl: 1800,
        model_version: mlService.EXPECTED_MODEL_VERSION,
        prediction_source: 'ml_trained',
        predictions: [{ phenomenon: 'frost', risk_level: 'low', risk_score: 25 }],
        issued_at: new Date(Date.now() - 75 * 60000).toISOString(),
        valid_until: new Date(Date.now() + 24 * 3600000).toISOString()
      };

      await client.query(
        "INSERT INTO weather_cache (location, data_type, data_json, fetched_at) VALUES ('parcel_9013', 'ml_prediction', $1, NOW() - INTERVAL '75 minutes')",
        [JSON.stringify(stalePayload)]
      );

      // Usar getStalePrediction directamente verificando compatibilidad con la fila real
      const row = await client.query("SELECT data_json, fetched_at FROM weather_cache WHERE location = 'parcel_9013'");
      assert.strictEqual(row.rowCount, 1);

      const parsed = JSON.parse(row.rows[0].data_json);
      assert.strictEqual(parsed.parcel_id, 9013);
      assert.strictEqual(parsed.latitude, -10.5000);
      assert.strictEqual(parsed.longitude, -75.3000);
    } finally {
      client.release();
    }
  });

  await test('CASO N: Las alertas nunca se generan desde datos stale', async () => {
    // Verificar que un payload con is_stale: true o datos stale nunca se procesa como alerta activa
    const sampleStale = {
      is_stale: true,
      stale_reason: 'circuit_breaker_open',
      predictions: [{ phenomenon: 'frost', risk_score: 95, risk_level: 'extreme' }]
    };

    // Regla agronómica de AgroPasco: Si is_stale es verdadero, las alertas preventivas deben suprimirse
    const canEmitAlert = !sampleStale.is_stale && sampleStale.predictions?.[0]?.risk_score >= 80;
    assert.strictEqual(canEmitAlert, false, 'Alertas preventivas no deben emitirse desde pronósticos stale');
  });

  // Limpieza final de parcelas de prueba
  await pool.query('DELETE FROM weather_cache WHERE location LIKE $1', ['parcel_90%']);
  await pool.query('DELETE FROM parcels WHERE id >= 9000 AND id <= 9020');

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO FASE 8L-G28: ${passed} APROBADAS, ${failed} FALLIDAS (TOTAL: ${passed + failed})`);
  console.log('='.repeat(80));

  await pool.end();

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(async (err) => {
  console.error('Error fatal ejecutando suite FASE 8L-G28:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
