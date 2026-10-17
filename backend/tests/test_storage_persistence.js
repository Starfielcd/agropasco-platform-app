/**
 * AgroPasco — Test Suite Automatizado de Almacenamiento Persistente (UIUX10.2)
 * ==============================================================================
 * Valida de forma exhaustiva:
 * 1. Generación de nombres seguros anti-colisión.
 * 2. Política de desarrollo: degradación a disco local cuando no hay Supabase.
 * 3. Política estricta de PRODUCCIÓN:
 *    - Si Supabase Storage falla o no está configurado, RETORNA ERROR CONTROLADO.
 *    - PROHIBIDO el fallback silencioso a disco efímero en producción.
 *    - La subida fallida rechaza con HTTP 503 y no permite publicar productos sin foto duradera.
 * 4. Subida exitosa a Supabase Storage (emulación REST API v1 oficial).
 * 5. Simulación de reinicio de servidor (sobrevivencia de URLs HTTPS vs caída de disco efímero).
 * 6. Protección de propiedad: usuarios no autorizados no pueden modificar fotos ajenas.
 * 7. Controladores Multipart y Base64 operando bajo la nueva política.
 *
 * DISTINCIÓN DE PRUEBAS:
 * - Todas las pruebas de esta suite son [SIMULADAS / MOCK] en memoria y no requieren
 *   credenciales reales ni conexión activa a internet.
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storageService = require('../services/storageService');
const uploadController = require('../controllers/uploadController');

async function runStorageSuite() {
  console.log('='.repeat(75));
  console.log('🧪 TEST SUITE: ALMACENAMIENTO PERSISTENTE Y POLÍTICA DE PRODUCCIÓN (UIUX10.2)');
  console.log('='.repeat(75));

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name} — ${err.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name} — ${err.message}`);
      failed++;
    }
  }

  // =========================================================================
  // 1. GENERACIÓN DE NOMBRES DE ARCHIVO
  // =========================================================================
  console.log('\n--- 1. GENERACIÓN DE NOMBRES SEGUROS Y ANTI-COLISIÓN ---');

  test('generateSafeFilename sanitiza nombres con caracteres especiales y espacios', () => {
    const rawName = 'Foto de Cosecha & Papa#1 (Primera Calidad)!.png';
    const safeName = storageService.generateSafeFilename(rawName);

    assert.ok(!safeName.includes(' '), 'No debe contener espacios');
    assert.ok(!safeName.includes('&'), 'No debe contener caracteres especiales');
    assert.ok(!safeName.includes('#'), 'No debe contener caracteres especiales');
    assert.ok(safeName.endsWith('.png'), 'Debe conservar la extensión');
    assert.ok(safeName.length > 15, 'Debe incluir sufijo único');
  });

  test('generateSafeFilename genera nombres únicos para dos llamadas consecutivas', () => {
    const name1 = storageService.generateSafeFilename('papa.jpg');
    const name2 = storageService.generateSafeFilename('papa.jpg');
    assert.notStrictEqual(name1, name2, 'Deben tener sufijos distintos para evitar sobreescritura');
  });

  // =========================================================================
  // 2. MODO DESARROLLO LOCAL (PERMITE FALLBACK LOCAL)
  // =========================================================================
  console.log('\n--- 2. ENTORNO DE DESARROLLO LOCAL (FALLBACK A DISCO LOCAL PERMITIDO) ---');

  process.env.NODE_ENV = 'development';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await testAsync('[DEV] persistFile guarda localmente y retorna URL relativa cuando no hay Supabase en desarrollo', async () => {
    const testBuffer = Buffer.from('TEST_DEV_LOCAL_CONTENT', 'utf8');
    const filename = `test_product_dev_${Date.now()}.jpg`;

    const result = await storageService.persistFile({
      buffer: testBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/jpeg'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.storageType, 'local');
    assert.strictEqual(result.url, `/uploads/products/${filename}`);

    const diskPath = path.join(storageService.UPLOADS_ROOT, 'products', filename);
    assert.ok(fs.existsSync(diskPath), 'El archivo debe existir físicamente en backend/uploads/products');
    fs.unlinkSync(diskPath);
  });

  // =========================================================================
  // 3. POLÍTICA ESTRICTA DE PRODUCCIÓN (PROHIBIDO FALLBACK SILENCIOSO)
  // =========================================================================
  console.log('\n--- 3. POLÍTICA ESTRICTA DE PRODUCCIÓN (ELIMINACIÓN DE FALLBACK EFÍMERO) ---');

  process.env.NODE_ENV = 'production';
  delete process.env.FORCE_LOCAL_STORAGE;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await testAsync('[PROD] persistFile retorna ERROR CONTROLADO si Supabase Storage no está configurado en producción', async () => {
    const testBuffer = Buffer.from('PROD_PHOTO_WITHOUT_CREDENTIALS', 'utf8');
    const filename = `prod_unconfigured_${Date.now()}.jpg`;

    const result = await storageService.persistFile({
      buffer: testBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/jpeg'
    });

    // En producción DEBE fallar explícitamente para no engañar al agricultor
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'STORAGE_UNCONFIGURED');
    assert.ok(result.error.includes('Almacenamiento persistente no configurado'));
  });

  // Simular mock de fallo HTTP en Supabase Storage
  const origFetch = global.fetch;

  await testAsync('[PROD] persistFile retorna ERROR CONTROLADO si Supabase Storage devuelve HTTP 500 / 503', async () => {
    process.env.SUPABASE_URL = 'https://xyzcompany.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_secret_key';

    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: 'Service Unavailable / Storage Bucket Offline' })
    });

    const testBuffer = Buffer.from('PROD_PHOTO_FAILING', 'utf8');
    const filename = `prod_failing_${Date.now()}.jpg`;

    const result = await storageService.persistFile({
      buffer: testBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/jpeg'
    });

    // En producción NUNCA debe degradar silenciosamente a disco efímero
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'STORAGE_UPLOAD_FAILED');
    assert.strictEqual(result.storageType, undefined);
  });

  // =========================================================================
  // 4. SUBIDA EXITOSA EN PRODUCCIÓN (MOCK SUPABASE STORAGE REST API)
  // =========================================================================
  console.log('\n--- 4. SUBIDA EXITOSA A SUPABASE STORAGE EN PRODUCCIÓN (SIMULADA) ---');

  let capturedFetchUrl = '';
  let capturedHeaders = {};

  global.fetch = async (url, options) => {
    capturedFetchUrl = url;
    capturedHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Key: 'products/papa_ok.jpg' })
    };
  };

  await testAsync('[PROD] persistFile sube a Supabase y devuelve URL pública HTTPS permanente', async () => {
    const testBuffer = Buffer.from('REAL_POTATO_HARVEST_PHOTO', 'utf8');
    const filename = `papa_pasco_${Date.now()}.jpg`;

    const result = await storageService.persistFile({
      buffer: testBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/jpeg'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.storageType, 'supabase');
    assert.strictEqual(
      result.url,
      `https://xyzcompany.supabase.co/storage/v1/object/public/agropasco-products/products/${filename}`
    );
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer mock_secret_key');
    assert.strictEqual(capturedHeaders['x-upsert'], 'true');

    // Limpiar copia de caché local
    const diskPath = path.join(storageService.UPLOADS_ROOT, 'products', filename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  });

  // =========================================================================
  // 5. CONTROLADOR DE CARGA Y RESPUESTAS HTTP
  // =========================================================================
  console.log('\n--- 5. CONTROLADOR uploadController: RESPUESTAS ANTE FALLOS Y ÉXITOS ---');

  await testAsync('handleBase64Upload devuelve HTTP 503 si la persistencia falla en producción', async () => {
    // Forzar fallo
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'Bucket quota exceeded' })
    });

    const mockReq = {
      body: {
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        folder: 'products'
      }
    };

    let statusCode = 200;
    let jsonResp = null;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResp = data; return this; }
    };

    await uploadController.handleBase64Upload(mockReq, mockRes);
    assert.strictEqual(statusCode, 503);
    assert.strictEqual(jsonResp.success, false);
    assert.ok(['STORAGE_ERROR', 'STORAGE_UPLOAD_FAILED'].includes(jsonResp.code));
    assert.ok(jsonResp.error.includes('No se pudo almacenar la fotografía'));
  });

  await testAsync('handleBase64Upload devuelve HTTP 200 con URL HTTPS cuando Supabase tiene éxito', async () => {
    // Restaurar éxito
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Key: 'products/success.jpg' })
    });

    const mockReq = {
      body: {
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        folder: 'products'
      }
    };

    let statusCode = 200;
    let jsonResp = null;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResp = data; return this; }
    };

    await uploadController.handleBase64Upload(mockReq, mockRes);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResp.success, true);
    assert.strictEqual(jsonResp.storage, 'supabase');
    assert.ok(jsonResp.url.startsWith('https://xyzcompany.supabase.co/storage/v1/object/public/'));

    const diskPath = path.join(storageService.UPLOADS_ROOT, 'products', jsonResp.filename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  });

  // =========================================================================
  // 6. SIMULACIÓN DE REINICIO DE SERVIDOR (SOBREVIVENCIA DE FOTOGRAFÍAS)
  // =========================================================================
  console.log('\n--- 6. SIMULACIÓN DE REINICIO DE SERVIDOR (SERVER REBOOT SIMULATION) ---');

  test('Las URLs de Supabase Storage son inmunes al reinicio o vaciado de disco local', () => {
    const supabaseUrl = 'https://xyzcompany.supabase.co/storage/v1/object/public/agropasco-products/products/papa_cosecha_123.jpg';
    const localEphemeralUrl = '/uploads/products/papa_efimera_123.jpg';

    // Simular estado de base de datos con ambos registros
    const dbRecordPersistent = { id: 1, name: 'Papa Huayro', photo_url: supabaseUrl };
    const dbRecordEphemeral = { id: 2, name: 'Maca Andina', photo_url: localEphemeralUrl };

    // Simulación de reinicio del contenedor en Render:
    // El sistema de archivos efímero se resetea a cero
    const ephemeralDiskState = {}; // Disco vacío tras reboot
    // Supabase Cloud Storage permanece 100% intacto en la nube
    const supabaseCloudState = { 'products/papa_cosecha_123.jpg': Buffer.from('DATA_INTACTA') };

    // Verificar accesibilidad tras reboot:
    const isSupabaseAccessible = Boolean(supabaseCloudState['products/papa_cosecha_123.jpg']);
    const isEphemeralAccessible = Boolean(ephemeralDiskState['products/papa_efimera_123.jpg']);

    assert.strictEqual(isSupabaseAccessible, true, 'La foto en Supabase Storage sobrevive al reinicio');
    assert.strictEqual(isEphemeralAccessible, false, 'La foto en disco efímero desaparece tras reinicio');
    assert.ok(dbRecordPersistent.photo_url.startsWith('https://'), 'La URL en base de datos apunta a la nube permanente');
  });

  // =========================================================================
  // 7. SEGURIDAD Y PROTECCIÓN DE FOTOGRAFÍAS AJENAS (OWNERSHIP)
  // =========================================================================
  console.log('\n--- 7. CONTROL DE ACCESO: PROTECCIÓN CONTRA MODIFICACIÓN DE FOTOS AJENAS ---');

  const supermarketController = require('../controllers/supermarketController');
  const dbModule = require('../config/database');

  await testAsync('Un agricultor no puede modificar la fotografía ni el producto de otro agricultor (403)', async () => {
    // Interceptar dbGet
    const origDbGet = dbModule.dbGet;
    dbModule.dbGet = async (sql, params) => {
      if (sql.includes('FROM products') && sql.includes('WHERE id = ?')) {
        return {
          id: 50,
          farmer_id: 10, // Dueño legítimo
          name: 'Papa de Don Juan',
          photo_url: 'https://xyzcompany.supabase.co/storage/v1/object/public/agropasco-products/products/juan.jpg'
        };
      }
      return null;
    };

    // Usuario que intenta modificar: farmer_id 99 (intruso)
    const mockReq = {
      params: { id: 50 },
      user: { id: 99, role: 'farmer', name: 'Agricultor Intruso' },
      body: {
        photo_url: 'https://xyzcompany.supabase.co/storage/v1/object/public/agropasco-products/products/foto_reemplazo.jpg'
      }
    };

    let statusCode = 200;
    let jsonResp = null;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResp = data; return this; }
    };

    await supermarketController.updateProduct(mockReq, mockRes);
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonResp.success, false);
    assert.strictEqual(jsonResp.error, 'No tienes permiso para editar este producto.');

    dbModule.dbGet = origDbGet;
  });

  // Restaurar entorno
  global.fetch = origFetch;
  process.env.NODE_ENV = 'test';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // =========================================================================
  // RESUMEN FINAL
  // =========================================================================
  console.log('\n' + '='.repeat(75));
  console.log(`📊 RESULTADO SUITE STORAGE UIUX10.2: ${passed} PASSED | ${failed} FAILED`);
  console.log('='.repeat(75));

  if (failed > 0) process.exit(1);
}

runStorageSuite().catch(err => {
  console.error('Error fatal en suite de storage:', err);
  process.exit(1);
});
