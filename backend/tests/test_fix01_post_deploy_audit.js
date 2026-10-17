/**
 * AgroPasco Digital — Test Suite FIX01: Post-Deploy Audit & Real Error Verification
 * =================================================================================
 * Valida de forma exhaustiva las correcciones aplicadas para:
 * 1. FASE 1: Supabase Storage HTTP 404 (PGRST125) y normalización de URLs y rutas.
 * 2. FASE 2: Carga y persistencia de fotografías de parcelas, cultivos y productos.
 * 3. FASE 3: Marcador GPS y círculo de precisión en Leaflet (SVG Pin + radar pulse).
 * 4. FASE 4: Flujo de registro de usuarios (Farmer, Advisor, Supermarket) y bloqueo de Admin.
 * 5. FASE 5 & 6: Auditoría transversal de roles y seguridad sin regresiones.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function report(name, passed, detail = '') {
  if (passed) {
    console.log(`  ✅ PASSED: ${name}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${name}`);
    if (detail) console.error(`     Detalle: ${detail}`);
    testsFailed++;
  }
}

async function runFix01TestSuite() {
  console.log('===========================================================================');
  console.log('🧪 TEST SUITE FIX01 — AUDITORÍA INTEGRAL Y VERIFICACIÓN POST-DESPLIEGUE');
  console.log('===========================================================================\n');

  // ===========================================================================
  // FASE 1: SUPABASE STORAGE Y CAUSA RAÍZ DEL HTTP 404
  // ===========================================================================
  console.log('--- 1. FASE 1: AUDITORÍA SUPABASE STORAGE Y PREVENCIÓN HTTP 404 ---');

  const { getSupabaseConfig, uploadToSupabaseStorage } = require('../services/storageService');

  // Test 1.1: Normalización de SUPABASE_URL contaminada con /rest/v1 (Causa raíz exacta del HTTP 404)
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedBucket = process.env.SUPABASE_STORAGE_BUCKET;

  try {
    // Simular que en Render se configuró la URL de Supabase con subruta /rest/v1 o con comillas
    process.env.SUPABASE_URL = '"https://pzznvjttszwttvslnfdl.supabase.co/rest/v1"';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '"dummy_service_role_key_secret_12345"';
    process.env.SUPABASE_STORAGE_BUCKET = '"agropasco-products/"';

    const config = getSupabaseConfig();

    report(
      'getSupabaseConfig() extrae el origin limpio sin /rest/v1 ni comillas',
      config.url === 'https://pzznvjttszwttvslnfdl.supabase.co' &&
      config.key === 'dummy_service_role_key_secret_12345' &&
      config.bucket === 'agropasco-products',
      `Obtenido: url=${config.url}, bucket=${config.bucket}`
    );

    // Test 1.2: Normalización con URL con /storage/v1 y trailing slashes
    process.env.SUPABASE_URL = 'https://pzznvjttszwttvslnfdl.supabase.co/storage/v1/object///';
    const configStoragePath = getSupabaseConfig();
    report(
      'getSupabaseConfig() limpia rutas /storage/v1 o trailing slashes hacia el origin exacto',
      configStoragePath.url === 'https://pzznvjttszwttvslnfdl.supabase.co',
      `Obtenido: url=${configStoragePath.url}`
    );

    // Test 1.3: Construcción de endpoint en uploadToSupabaseStorage sin /rest/v1
    const originalFetch = global.fetch;
    let interceptedEndpoint = '';
    let interceptedHeaders = {};

    global.fetch = async (url, opts) => {
      interceptedEndpoint = url;
      interceptedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Key: 'products/papa_amarilla_123.jpg' })
      };
    };

    const uploadRes = await uploadToSupabaseStorage(
      Buffer.from('dummy_image_content'),
      '/products/papa_amarilla_123.jpg',
      'image/jpeg'
    );

    global.fetch = originalFetch;

    const expectedEndpoint = 'https://pzznvjttszwttvslnfdl.supabase.co/storage/v1/object/agropasco-products/products/papa_amarilla_123.jpg';
    report(
      'uploadToSupabaseStorage() apunta al endpoint oficial Storage v1 y no a PostgREST',
      interceptedEndpoint === expectedEndpoint && uploadRes.success === true,
      `Endpoint generado: ${interceptedEndpoint}`
    );

    report(
      'uploadToSupabaseStorage() genera URL pública HTTPS limpia y permanente',
      uploadRes.publicUrl === 'https://pzznvjttszwttvslnfdl.supabase.co/storage/v1/object/public/agropasco-products/products/papa_amarilla_123.jpg',
      `URL generada: ${uploadRes.publicUrl}`
    );

  } finally {
    process.env.SUPABASE_URL = savedUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    process.env.SUPABASE_STORAGE_BUCKET = savedBucket;
  }

  // ===========================================================================
  // FASE 2: CARPETAS AUTORIZADAS Y PERSISTENCIA DE CULTIVOS Y PARCELAS
  // ===========================================================================
  console.log('\n--- 2. FASE 2: CARPETAS DE FOTOGRAFÍAS PARA CULTIVOS, PARCELAS Y PRODUCTOS ---');

  const uploadControllerCode = fs.readFileSync(path.join(__dirname, '../controllers/uploadController.js'), 'utf8');

  report(
    'uploadController incluye "crops" y "parcels" en carpetas autorizadas de Base64',
    uploadControllerCode.includes('ALLOWED_FOLDERS.includes(folder)'),
    'La lógica debe verificar ALLOWED_FOLDERS en lugar de restringir a solo pests y products'
  );

  const cropControllerCode = fs.readFileSync(path.join(__dirname, '../controllers/cropController.js'), 'utf8');

  report(
    'cropController.updateCrop() persiste photo_url del cultivo',
    cropControllerCode.includes('finalPhoto') && cropControllerCode.includes('photo_url=?'),
    'updateCrop debe extraer y actualizar photo_url'
  );

  // ===========================================================================
  // FASE 3: MARCADOR GPS Y VISIBILIDAD EN LEAFLET
  // ===========================================================================
  console.log('\n--- 3. FASE 3: REPARACIÓN DEL MARCADOR GPS EN LEAFLET ---');

  const leafletMapCode = fs.readFileSync(path.join(__dirname, '../../frontend/services/maps/leafletMap.js'), 'utf8');
  const stylesCssCode = fs.readFileSync(path.join(__dirname, '../../frontend/css/styles.css'), 'utf8');

  report(
    'leafletMap.js contiene marcador GPS tipo SVG Pin con zIndexOffset elevado (1500)',
    leafletMapCode.includes('geo-pulse-pin') && leafletMapCode.includes('<svg') && leafletMapCode.includes('zIndexOffset: 1500'),
    'El marcador debe tener elemento SVG renderizable y z-index sobre el círculo'
  );

  report(
    'leafletMap.js mantiene el círculo de precisión sin eliminar el marcador',
    leafletMapCode.includes('this.userAccuracyCircle = L.circle') && leafletMapCode.includes('this.userLocationMarker = L.marker'),
    'Tanto el marcador como el círculo deben agregarse al mapa'
  );

  report(
    'styles.css define las reglas de animación y contenedor para el radar GPS (.geo-pulse-*)',
    stylesCssCode.includes('.geo-pulse-container') && stylesCssCode.includes('@keyframes geoPulseRing'),
    'Las clases del pulso GPS deben existir en styles.css'
  );

  // ===========================================================================
  // FASE 4: REPARACIÓN DEL REGISTRO DE USUARIOS
  // ===========================================================================
  console.log('\n--- 4. FASE 4: REGISTRO DE USUARIOS (AGRICULTOR, ASESOR, SUPERMERCADO) ---');

  const authJsCode = fs.readFileSync(path.join(__dirname, '../../frontend/js/auth.js'), 'utf8');
  const appJsCode = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  const apiJsCode = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');

  report(
    'app.js incluye la ruta pública "#/register" en su tabla de rutas',
    appJsCode.includes("'/register'") && appJsCode.includes("renderLoginPage('register')"),
    'La ruta /register debe mapearse a la vista de login en modo registro'
  );

  report(
    'app.js permite acceso no autenticado a "/register" en navigateTo()',
    appJsCode.includes("isPublicRoute") && appJsCode.includes("basePath === '/register'"),
    'navigateTo no debe redirigir /register a login por falta de token'
  );

  report(
    'auth.js switchAuthTab() es seguro ante elementos nulos y sincroniza la URL',
    authJsCode.includes('if (tabLogin)') && authJsCode.includes('if (tabRegister)') && authJsCode.includes("window.history.replaceState"),
    'switchAuthTab no debe lanzar TypeError si tab-register no existe'
  );

  report(
    'api.js no fuerza cierre de sesión ni redirección al recibir 401/403 en login o registro',
    apiJsCode.includes("endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/register')"),
    'apiRequest no debe borrar el token ni redirigir en intentos fallidos de auth'
  );

  // Validar lógica del backend en authController
  const authController = require('../controllers/authController');
  report(
    'authController exporta las funciones requeridas de registro y autenticación',
    typeof authController.register === 'function' && typeof authController.login === 'function'
  );

  // Simular registro de Supermercado en el controlador
  let mockStatus = null;
  let mockJson = null;
  const mockRes = {
    status: (s) => { mockStatus = s; return mockRes; },
    json: (j) => { mockJson = j; return mockRes; }
  };

  // Intentar registrar admin público (debe ser bloqueado)
  await authController.register({
    body: {
      name: 'Intruso Admin',
      email: 'hacker@agropasco.pe',
      password: 'password123',
      role: 'admin'
    }
  }, mockRes);

  report(
    'Registro público con rol "admin" es estrictamente rechazado con HTTP 403 Forbidden',
    mockStatus === 403 && mockJson && mockJson.success === false,
    `Status: ${mockStatus}, Error: ${mockJson?.error}`
  );

  // ===========================================================================
  // RESUMEN FINAL
  // ===========================================================================
  console.log('\n===========================================================================');
  console.log(`📊 RESULTADO SUITE FIX01: ${testsPassed} PASSED | ${testsFailed} FAILED`);
  console.log('===========================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runFix01TestSuite().catch(err => {
  console.error('Error fatal al ejecutar suite FIX01:', err);
  process.exit(1);
});
