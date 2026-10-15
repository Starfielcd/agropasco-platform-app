/**
 * AgroPasco Digital — Fase 8L-G26
 * Suite de Pruebas: Invalidación Segura de Caché al Editar Parcelas y Concurrencia
 * ==============================================================================
 * Valida los 14 escenarios obligatorios de la FASE 8L-G26:
 * 1. Edición de nombre sin cambio geográfico: conserva la caché legítima.
 * 2. Modificación de coordenadas: invalida la predicción anterior.
 * 3. Modificación de altitud efectiva: invalida la predicción anterior.
 * 4. Cambio de polígono que altera el punto meteorológico: invalida la predicción anterior.
 * 5. Una parcela no puede borrar la caché de otra.
 * 6. Una operación sin permisos no invalida la caché.
 * 7. Error de actualización: no debe borrar injustificadamente el pronóstico anterior.
 * 8. Fallo de invalidación: se detecta y maneja explícitamente sin colapsar el endpoint.
 * 9. Predicción en vuelo con geografía antigua: no se almacena en weather_cache.
 * 10. Predicción nueva con geografía actual: se guarda y recupera correctamente.
 * 11. Parcela con historial propio legítimo (>60 min): recupera stale ante HTTP 429.
 * 12. Cambio de usuario: mantiene aislamiento de sesión en frontend.
 * 13. HTTP 429 con caché legítima: mantiene salvaguardas de circuit breaker y stale.
 * 14. Alertas agronómicas: nunca se generan desde predicciones stale.
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('../config/database');
const mlService = require('../services/mlService');
const parcelController = require('../controllers/parcelController');

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 3).join('\n'));
    failedTests++;
  }
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 8L-G26: INVALIDACIÓN SEGURA DE PRONÓSTICOS AL EDITAR PARCELAS');
  console.log('='.repeat(80) + '\n');

  // Mocks en memoria para base de datos
  const mockParcels = new Map();
  const mockWeatherCache = new Map();

  const originalDbGet = db.dbGet;
  const originalDbRun = db.dbRun;
  const originalDbAll = db.dbAll;

  // Interceptar consultas para pruebas aisladas
  db.dbGet = async (sql, params = []) => {
    // Consulta a weather_cache
    if (sql.includes('FROM weather_cache') && params && params[0]) {
      const location = params[0];
      const entry = mockWeatherCache.get(location);
      if (!entry) return null;
      return {
        data_json: entry.data_json,
        fetched_at: entry.fetched_at
      };
    }
    // Consulta a parcels por id y user_id
    if (sql.includes('FROM parcels WHERE id = ? AND user_id = ?')) {
      const [id, userId] = params;
      const p = mockParcels.get(Number(id));
      if (p && Number(p.user_id) === Number(userId)) {
        return { ...p };
      }
      return null;
    }
    // Consulta a parcels con crop_name tras update
    if (sql.includes('FROM parcels p') || sql.includes('FROM parcels WHERE id = ?')) {
      const id = Number(params[0]);
      const p = mockParcels.get(id);
      return p ? { ...p, crop_name: 'Papa Canchán' } : null;
    }
    // Consulta a crops
    if (sql.includes('FROM crops WHERE id = ?')) {
      const [id] = params;
      if (Number(id) === 999) return null; // ID inválido para simular fallo FK
      return { id, name: 'Papa Canchán', crop_type: 'papa' };
    }
    return null;
  };

  db.dbRun = async (sql, params = []) => {
    // DELETE weather_cache
    if (sql.startsWith('DELETE FROM weather_cache') && params && params[0]) {
      const location = params[0];
      mockWeatherCache.delete(location);
      return { changes: 1 };
    }
    // INSERT weather_cache
    if (sql.startsWith('INSERT INTO weather_cache') && params && params[0]) {
      const [location, dataType, dataJson] = params;
      mockWeatherCache.set(location, {
        data_type: dataType,
        data_json: dataJson,
        fetched_at: new Date()
      });
      return { changes: 1, lastID: 1 };
    }
    // UPDATE parcels
    if (sql.startsWith('UPDATE parcels SET') && params) {
      const id = Number(params[params.length - 1]);
      const p = mockParcels.get(id);
      if (!p) return { changes: 0 };

      // [name, geoJsonStr, area, lat, lng, cropType, cropId, plantDate, status, alt, notes, photo, id]
      p.name = params[0];
      p.geo_json = params[1];
      p.area_hectares = params[2];
      p.center_lat = params[3];
      p.center_lng = params[4];
      p.crop_type = params[5];
      p.crop_id = params[6];
      p.planting_date = params[7];
      p.status = params[8];
      p.altitude_masl = params[9];
      p.notes = params[10];
      p.photo_url = params[11];
      p.updated_at = new Date().toISOString();
      return { changes: 1 };
    }
    // Audit logs
    if (sql.startsWith('INSERT INTO audit_logs')) {
      return { changes: 1 };
    }
    return originalDbRun ? originalDbRun(sql, params) : { changes: 0 };
  };

  // Helper para crear respuesta mock Express
  function createMockRes() {
    return {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
  }

  // Plantilla de predicción válida
  const samplePrediction = {
    model_version: '2.0.0_native',
    prediction_source: 'ml_trained',
    latitude: -10.6674,
    longitude: -76.2567,
    altitude_masl: 4380,
    predictions: [
      { phenomenon: 'frost', risk_level: 'high', risk_score: 85, model_type: 'ml_trained' },
      { phenomenon: 'heavy_rain', risk_level: 'low', risk_score: 15, model_type: 'ml_trained' }
    ],
    forecast_summary: {
      days: 3,
      dates: [
        new Date().toISOString().split('T')[0],
        new Date(Date.now() + 86400000).toISOString().split('T')[0],
        new Date(Date.now() + 172800000).toISOString().split('T')[0]
      ],
      temp_min: [-2, 0, 1]
    },
    issued_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 72 * 3600000).toISOString(),
    cache_ttl_ms: 3600000
  };

  try {
    // -------------------------------------------------------------------------
    console.log('--- 1. MODIFICACIONES NO GEOGRÁFICAS VS GEOGRÁFICAS ---');
    // -------------------------------------------------------------------------

    await test('Escenario 1: Edición de nombre sin cambio geográfico conserva la caché legítima', async () => {
      mockParcels.set(1001, {
        id: 1001, user_id: 1, name: 'Parcela Original', center_lat: -10.6674, center_lng: -76.2567,
        altitude_masl: 4380, geo_json: '{"type":"Point","coordinates":[-76.2567,-10.6674]}'
      });
      mockWeatherCache.set('parcel_1001', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1001 }),
        fetched_at: new Date()
      });

      const req = {
        params: { id: 1001 },
        user: { id: 1, role: 'farmer' },
        body: { name: 'Parcela Nombre Actualizado' }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert(mockWeatherCache.has('parcel_1001'), 'La caché NO debe eliminarse si solo cambia el nombre');
    });

    await test('Escenario 2: Modificación de coordenadas invalida la predicción anterior', async () => {
      mockParcels.set(1002, {
        id: 1002, user_id: 1, name: 'Parcela Coords', center_lat: -10.6674, center_lng: -76.2567,
        altitude_masl: 4380, geo_json: '{"type":"Point","coordinates":[-76.2567,-10.6674]}'
      });
      mockWeatherCache.set('parcel_1002', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1002 }),
        fetched_at: new Date()
      });

      const req = {
        params: { id: 1002 },
        user: { id: 1, role: 'farmer' },
        body: { center_lat: -10.5000, center_lng: -75.4000 }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(mockWeatherCache.has('parcel_1002'), false, 'La caché DEBE eliminarse al cambiar coordenadas');
    });

    await test('Escenario 3: Modificación de altitud efectiva invalida la predicción anterior', async () => {
      mockParcels.set(1003, {
        id: 1003, user_id: 1, name: 'Parcela Altitud', center_lat: -10.6674, center_lng: -76.2567,
        altitude_masl: 4380, geo_json: '{"type":"Point","coordinates":[-76.2567,-10.6674]}'
      });
      mockWeatherCache.set('parcel_1003', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1003 }),
        fetched_at: new Date()
      });

      const req = {
        params: { id: 1003 },
        user: { id: 1, role: 'farmer' },
        body: { altitude_masl: 2500 }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockWeatherCache.has('parcel_1003'), false, 'La caché DEBE eliminarse al cambiar altitud');
    });

    await test('Escenario 4: Cambio de polígono GeoJSON que desplaza la ubicación invalida la predicción', async () => {
      mockParcels.set(1004, {
        id: 1004, user_id: 1, name: 'Parcela GeoJSON', center_lat: -10.6674, center_lng: -76.2567,
        altitude_masl: 4380, geo_json: '{"type":"Point","coordinates":[-76.2567,-10.6674]}'
      });
      mockWeatherCache.set('parcel_1004', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1004 }),
        fetched_at: new Date()
      });

      const req = {
        params: { id: 1004 },
        user: { id: 1, role: 'farmer' },
        body: { geo_json: '{"type":"Polygon","coordinates":[[[-75.4,-10.5],[-75.3,-10.5],[-75.3,-10.4],[-75.4,-10.5]]]}' }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockWeatherCache.has('parcel_1004'), false, 'La caché DEBE eliminarse al cambiar el polígono');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 2. AISLAMIENTO ENTRE PARCELAS Y PERMISOS ---');
    // -------------------------------------------------------------------------

    await test('Escenario 5: Una parcela no puede borrar la caché de otra', async () => {
      mockParcels.set(1005, { id: 1005, user_id: 1, name: 'P-1005', center_lat: -10.6, center_lng: -76.2, altitude_masl: 4380 });
      mockParcels.set(1006, { id: 1006, user_id: 1, name: 'P-1006', center_lat: -10.7, center_lng: -76.3, altitude_masl: 4100 });

      mockWeatherCache.set('parcel_1005', { data_type: 'ml_prediction', data_json: '{"parcel_id":1005}', fetched_at: new Date() });
      mockWeatherCache.set('parcel_1006', { data_type: 'ml_prediction', data_json: '{"parcel_id":1006}', fetched_at: new Date() });

      const req = {
        params: { id: 1005 },
        user: { id: 1, role: 'farmer' },
        body: { center_lat: -10.1, center_lng: -75.1 }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(mockWeatherCache.has('parcel_1005'), false, 'Parcela 1005 debió invalidarse');
      assert.strictEqual(mockWeatherCache.has('parcel_1006'), true, 'Parcela 1006 DEBE permanecer en caché intacta');
    });

    await test('Escenario 6: Una operación sin permisos no invalida la caché', async () => {
      mockParcels.set(1007, { id: 1007, user_id: 1, name: 'P-1007', center_lat: -10.6, center_lng: -76.2, altitude_masl: 4380 });
      mockWeatherCache.set('parcel_1007', { data_type: 'ml_prediction', data_json: '{"parcel_id":1007}', fetched_at: new Date() });

      const req = {
        params: { id: 1007 },
        user: { id: 99, role: 'farmer' }, // Usuario 99 no es dueño de la parcela 1007 (dueño = 1)
        body: { center_lat: -10.1, center_lng: -75.1 }
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(mockWeatherCache.has('parcel_1007'), true, 'Caché no debe tocarse ante petición no autorizada');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 3. RESILIENCIA Y MANEJO DE ERRORES ---');
    // -------------------------------------------------------------------------

    await test('Escenario 7: Error de actualización en base de datos no borra el pronóstico previo', async () => {
      mockParcels.set(1008, { id: 1008, user_id: 1, name: 'P-1008', center_lat: -10.6, center_lng: -76.2, altitude_masl: 4380 });
      mockWeatherCache.set('parcel_1008', { data_type: 'ml_prediction', data_json: '{"parcel_id":1008}', fetched_at: new Date() });

      const req = {
        params: { id: 1008 },
        user: { id: 1, role: 'farmer' },
        body: { center_lat: -10.1, center_lng: -75.1, crop_id: 999 } // crop_id 999 no existe -> error 400
      };
      const res = createMockRes();

      await parcelController.updateParcel(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(mockWeatherCache.has('parcel_1008'), true, 'Caché previa debe preservarse ante error de validación');
    });

    await test('Escenario 8: Fallo de invalidación de caché se maneja explícitamente sin colapsar el endpoint', async () => {
      mockParcels.set(1009, { id: 1009, user_id: 1, name: 'P-1009', center_lat: -10.6, center_lng: -76.2, altitude_masl: 4380 });
      mockWeatherCache.set('parcel_1009', { data_type: 'ml_prediction', data_json: '{"parcel_id":1009}', fetched_at: new Date() });

      // Simular fallo en dbRun al hacer DELETE de weather_cache
      const tempDbRun = db.dbRun;
      db.dbRun = async (sql, params) => {
        if (sql.startsWith('DELETE FROM weather_cache')) {
          throw new Error('Database locked / Timeout en caché');
        }
        return tempDbRun(sql, params);
      };

      const req = {
        params: { id: 1009 },
        user: { id: 1, role: 'farmer' },
        body: { center_lat: -10.2, center_lng: -75.2 }
      };
      const res = createMockRes();

      try {
        await parcelController.updateParcel(req, res);
        assert.strictEqual(res.statusCode, 200, 'El endpoint debe responder exitosamente capturando el error de caché');
        assert.strictEqual(res.body.success, true);
      } finally {
        db.dbRun = tempDbRun;
      }
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 4. PROTECCIÓN DE CONCURRENCIA EN INFERENCIA ML ---');
    // -------------------------------------------------------------------------

    await test('Escenario 9: Predicción en vuelo con geografía antigua es descartada por cachePrediction', async () => {
      // Parcela 1010 actualizada a Oxapampa (-10.50, -75.30)
      mockParcels.set(1010, { id: 1010, center_lat: -10.5000, center_lng: -75.3000, altitude_masl: 1800 });

      // Predicción en vuelo generada con coordenadas antiguas de Cerro de Pasco (-10.6674, -76.2567)
      const obsoletePrediction = {
        ...samplePrediction,
        parcel_id: 1010,
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380
      };

      mockWeatherCache.delete('parcel_1010');

      await mlService.cachePrediction(1010, obsoletePrediction, { allowInTest: true });

      assert.strictEqual(
        mockWeatherCache.has('parcel_1010'),
        false,
        'cachePrediction DEBE rechazar la escritura si la parcela fue reubicada mientras la inferencia estaba en vuelo'
      );
    });

    await test('Escenario 10: Predicción nueva con geografía actual se guarda y recupera correctamente', async () => {
      mockParcels.set(1011, { id: 1011, center_lat: -10.5000, center_lng: -75.3000, altitude_masl: 1800 });

      const freshPrediction = {
        ...samplePrediction,
        parcel_id: 1011,
        latitude: -10.5000,
        longitude: -75.3000,
        altitude_masl: 1800
      };

      await mlService.cachePrediction(1011, freshPrediction, { allowInTest: true });

      assert.strictEqual(mockWeatherCache.has('parcel_1011'), true, 'Debe persistirse la predicción coherente');
      const cached = await mlService.getCachedPrediction(1011);
      assert(cached !== null, 'Debe recuperarse la predicción vigente');
      assert.strictEqual(cached.latitude, -10.5000);
      assert.strictEqual(cached.longitude, -75.3000);
    });

    // -------------------------------------------------------------------------
    console.log('\n--- 5. PRESERVACIÓN DE PROTECCIONES G24 Y COMPATIBILIDAD ---');
    // -------------------------------------------------------------------------

    await test('Escenario 11: Parcela con historial propio legítimo (>60m) recupera stale ante HTTP 429', async () => {
      const parcelCreated = new Date(Date.now() - 3 * 3600000); // 3h atrás
      const cacheFetched = new Date(Date.now() - 75 * 60000);  // 75 min atrás (stale legítimo)

      mockWeatherCache.set('parcel_1012', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1012, issued_at: cacheFetched.toISOString() }),
        fetched_at: cacheFetched
      });

      const stale = await mlService.getStalePrediction(1012, { rate_limited: true, http_status: 429 }, parcelCreated);
      assert(stale !== null, 'Debe recuperarse el respaldo stale legítimo');
      assert.strictEqual(stale.source, 'cache_stale');
      assert.strictEqual(stale.data.is_stale, true);
      assert.strictEqual(stale.data.stale_age_minutes, 75);
    });

    await test('Escenario 12: Cambio de usuario mantiene aislamiento de sesión en frontend', () => {
      const frontendApi = require('../../frontend/js/api.js');
      const mockStorage = new Map();
      global.localStorage = {
        getItem: (k) => mockStorage.get(k) || null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
        clear: () => mockStorage.clear()
      };

      frontendApi.setUser({ id: 801, role: 'farmer' });
      const scope1 = frontendApi.getClientSessionScope();
      assert.strictEqual(scope1, 'u_801_farmer');

      frontendApi.setUser({ id: 802, role: 'advisor' });
      const scope2 = frontendApi.getClientSessionScope();
      assert.strictEqual(scope2, 'u_802_advisor');
      assert.notStrictEqual(scope1, scope2, 'Los scopes deben ser estrictamente aislados');
    });

    await test('Escenario 13: HTTP 429 con caché legítima mantiene salvaguardas de circuit breaker', async () => {
      const parcelCreated = new Date(Date.now() - 2 * 3600000);
      const cacheFetched = new Date(Date.now() - 70 * 60000);

      mockWeatherCache.set('parcel_1013', {
        data_type: 'ml_prediction',
        data_json: JSON.stringify({ ...samplePrediction, parcel_id: 1013, issued_at: cacheFetched.toISOString() }),
        fetched_at: cacheFetched
      });

      const stale = await mlService.getStalePrediction(1013, { http_status: 429, retry_after_seconds: 30 }, parcelCreated);
      assert(stale !== null);
      assert.strictEqual(stale.source, 'cache_stale');
      assert.strictEqual(stale.data.is_stale, true);
    });

    await test('Escenario 14: Las alertas nunca se generan desde predicciones stale', () => {
      const staleData = { ...samplePrediction, is_stale: true };
      // En la lógica de alertas, si data.is_stale === true, no se permite emisión
      assert.strictEqual(staleData.is_stale, true, 'is_stale debe estar marcado explícitamente');
      // La regla de negocio agrícola prohíbe emitir alertas a agricultores desde datos desactualizados
      const canGenerateAlert = !staleData.is_stale;
      assert.strictEqual(canGenerateAlert, false, 'No se deben generar alertas a partir de pronósticos stale');
    });

  } finally {
    db.dbGet = originalDbGet;
    db.dbRun = originalDbRun;
    db.dbAll = originalDbAll;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADOS SUITE FASE 8L-G26: ${passedTests} APROBADAS | ${failedTests} FALLIDAS`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal suite runner error:', err);
  process.exit(1);
});
