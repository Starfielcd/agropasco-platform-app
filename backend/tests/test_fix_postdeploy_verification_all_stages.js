/**
 * Verification Test Suite for Post-Deploy Functional & UX Fixes (Stages 1-6)
 * AgroPasco Digital
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('================================================================');
console.log('🚀 INICIANDO VERIFICACIÓN FUNCIONAL Y DE UX (ETAPAS 1 A 6)');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// ETAPA 1: Mapa sin 'API KEY REQUIRED' (Leaflet + Esri / OSM Fallback)
// -----------------------------------------------------------------------------
console.log('📌 ETAPA 1: Mapa de Recogida y Rutas Logísticas');

runTest('1.1 MapsConfig utiliza Esri World Street Map y OSM sin CartoDB deprecated', () => {
  const configPath = path.join(ROOT_DIR, 'frontend/services/maps/config.js');
  const content = fs.readFileSync(configPath, 'utf8');

  assert.ok(content.includes('server.arcgisonline.com'), 'Debe incluir servidor de Esri ArcGIS');
  assert.ok(!content.includes('basemaps.cartocdn.com'), 'No debe incluir la URL obsoleta de CartoDB sin key');
  assert.ok(content.includes('tile.openstreetmap.org'), 'Debe incluir OSM como fallback');
});

runTest('1.2 LeafletMap implementa fallback automático de tilelayer con tileerror', () => {
  const leafletMapPath = path.join(ROOT_DIR, 'frontend/services/maps/leafletMap.js');
  const content = fs.readFileSync(leafletMapPath, 'utf8');

  assert.ok(content.includes(".on('tileerror'"), 'Debe registrar listener de error en tiles');
  assert.ok(content.includes('OSM_FALLBACK_URL'), 'Debe cambiar a OSM_FALLBACK_URL ante fallo de proveedor principal');
});

runTest('1.3 Backend server y .env predeterminan leaflet sobre google', () => {
  const serverPath = path.join(ROOT_DIR, 'backend/server.js');
  const content = fs.readFileSync(serverPath, 'utf8');

  assert.ok(content.includes("process.env.MAPS_PROVIDER || 'leaflet'"), 'El default debe ser leaflet');
});

// -----------------------------------------------------------------------------
// ETAPA 2: Dashboard Predictivo del Asesor (Sin Redirección Forzada a Login)
// -----------------------------------------------------------------------------
console.log('\n📌 ETAPA 2: Dashboard Predictivo y Roles de Asesor');

runTest('2.1 parcelAuthService autoriza tanto "advisor" como "asesor"', () => {
  const authPath = path.join(ROOT_DIR, 'backend/services/parcelAuthService.js');
  const content = fs.readFileSync(authPath, 'utf8');

  assert.ok(content.includes("userRole === 'asesor' || userRole === 'advisor'"), 'Debe aceptar tanto advisor como asesor');
});

runTest('2.2 api.js NO borra localStorage ni redirige al login en HTTP 403', () => {
  const apiPath = path.join(ROOT_DIR, 'frontend/js/api.js');
  const content = fs.readFileSync(apiPath, 'utf8');

  // Asegurar que 403 no está en el if de logout destructivo
  const logoutBlockMatch = content.match(/if\s*\(\s*response\.status\s*===\s*401\s*\)\s*\{([^}]+)\}/);
  assert.ok(logoutBlockMatch, 'Debe existir bloque exclusivo para status 401');
  assert.ok(!content.includes('response.status === 401 || response.status === 403'), '403 no debe desencadenar borrado de token');
});

runTest('2.3 App.js restringe predictive-dashboard a roles autorizados excluyendo supermarket', () => {
  const appPath = path.join(ROOT_DIR, 'frontend/js/app.js');
  const content = fs.readFileSync(appPath, 'utf8');

  const routeMatch = content.match(/'\/predictive-dashboard':\s*\{[^}]*roles:\s*\[([^\]]+)\]/);
  assert.ok(routeMatch, 'Debe existir definición de /predictive-dashboard en routes');
  assert.ok(!routeMatch[1].includes("'supermarket'"), 'Supermarket no debe tener acceso a parcelas privadas');
  assert.ok(routeMatch[1].includes("'advisor'"), 'Advisor debe estar permitido');
  assert.ok(routeMatch[1].includes("'farmer'"), 'Farmer debe estar permitido');
});

// -----------------------------------------------------------------------------
// ETAPA 3: Interpretación Meteorológica y Asesoría IA Multi-Fenómeno
// -----------------------------------------------------------------------------
console.log('\n📌 ETAPA 3: Interpretación Meteorológica y Formato IA');

runTest('3.1 aiContextBuilder evalúa los 4 fenómenos (nevada, helada, lluvia fuerte, granizo)', () => {
  const contextBuilder = require('../services/aiContextBuilder');
  assert.ok(typeof contextBuilder.extractPredictionMetrics === 'function', 'extractPredictionMetrics debe ser una función');

  const mockPredictionRecord = {
    frost_risk_pct: 12.0,
    snow_risk_pct: 84.2,
    heavy_rain_risk_pct: 0.0,
    hail_risk_pct: 25.0,
    min_temp_c: -1.2,
    max_temp_c: 6.4,
    phenomenon_risks: {
      snow: { risk_pct: 84.2, level: 'high' },
      frost: { risk_pct: 12.0, level: 'low' },
      hail: { risk_pct: 25.0, level: 'low' },
      heavy_rain: { risk_pct: 0.0, level: 'low' }
    }
  };

  const metrics = contextBuilder.extractPredictionMetrics(mockPredictionRecord);
  assert.strictEqual(metrics.max_risk_pct, 84.2, 'El riesgo máximo debe ser 84.2%');
  assert.strictEqual(metrics.overall_risk_level, 'high', 'El nivel de riesgo general debe ser high');
  assert.strictEqual(metrics.primary_phenomenon, 'snow', 'El fenómeno primario debe ser snow');
  assert.strictEqual(metrics.primary_phenomenon_label, 'Nevada', 'La etiqueta del fenómeno primario debe ser Nevada');
});

runTest('3.2 advisory.js no concatena números con texto en acciones sugeridas (usa listas semánticas)', () => {
  const advPath = path.join(ROOT_DIR, 'frontend/js/advisory.js');
  const content = fs.readFileSync(advPath, 'utf8');

  assert.ok(content.includes('chat-actions-list'), 'Debe usar clase chat-actions-list para listas ordenadas');
  assert.ok(content.includes("document.createElement('ol')"), 'Debe crear elemento <ol> para preservar separación auditiva y visual');
  assert.ok(content.includes('chat-parcel-chips-grid'), 'Debe emplear contenedor grid para chips de parcela');
});

// -----------------------------------------------------------------------------
// ETAPA 4: Identificación Real del Asesor Validador
// -----------------------------------------------------------------------------
console.log('\n📌 ETAPA 4: Identificación de Asesores Validadores de Productos');

runTest('4.1 supermarketController selecciona val.name y val.role en SQL', () => {
  const smCtrlPath = path.join(ROOT_DIR, 'backend/controllers/supermarketController.js');
  const content = fs.readFileSync(smCtrlPath, 'utf8');

  assert.ok(content.includes('val.name as validator_name'), 'Debe proyectar validator_name');
  assert.ok(content.includes('val.role as validator_role'), 'Debe proyectar validator_role');
});

runTest('4.2 supermarket.js formatProductValidator no inventa títulos y usa nombres reales', () => {
  const smPath = path.join(ROOT_DIR, 'frontend/js/supermarket.js');
  const content = fs.readFileSync(smPath, 'utf8');

  assert.ok(content.includes('function formatProductValidator'), 'Debe existir la función de formateo de validador');
  assert.ok(content.includes('validator_name'), 'Debe chequear validator_name');
  assert.ok(content.includes('Asesor técnico validador'), 'Debe usar descripción institucional');
});

// -----------------------------------------------------------------------------
// ETAPA 5: Panel Principal por Defecto por Cada Rol
// -----------------------------------------------------------------------------
console.log('\n📌 ETAPA 5: Panel por Defecto por Rol');

runTest('5.1 app.js define defaultRoutes correctamente para cada rol con Dashboard General para asesor', () => {
  const appPath = path.join(ROOT_DIR, 'frontend/js/app.js');
  const content = fs.readFileSync(appPath, 'utf8');

  assert.ok(content.includes("farmer: '/dashboard'"), 'Farmer debe ir a /dashboard');
  assert.ok(content.includes("advisor: '/dashboard'"), 'Advisor debe ir a /dashboard');
  assert.ok(content.includes("supermarket: '/supermarket'"), 'Supermarket debe ir a /supermarket');
  assert.ok(content.includes("admin: '/admin'"), 'Admin debe ir a /admin');
});

runTest('5.2 app.js autoriza al asesor técnico en /dashboard (Panel General)', () => {
  const appPath = path.join(ROOT_DIR, 'frontend/js/app.js');
  const content = fs.readFileSync(appPath, 'utf8');

  const routeMatch = content.match(/'\/dashboard':\s*\{[^}]*roles:\s*\[([^\]]+)\]/);
  assert.ok(routeMatch, 'Debe existir definición de /dashboard');
  assert.ok(routeMatch[1].includes("'advisor'"), 'Advisor debe tener acceso a /dashboard');
});

// -----------------------------------------------------------------------------
// ETAPA 6: Contraste y Legibilidad WCAG AA en CSS
// -----------------------------------------------------------------------------
console.log('\n📌 ETAPA 6: Contraste y Legibilidad WCAG AA');

runTest('6.1 styles.css tiene overlay de alto contraste para el hero banner', () => {
  const cssPath = path.join(ROOT_DIR, 'frontend/css/styles.css');
  const content = fs.readFileSync(cssPath, 'utf8');

  assert.ok(content.includes('rgba(15, 23, 42, 0.88)'), 'El overlay debe tener opacidad >= 0.88 para garantizar legibilidad de texto blanco');
  assert.ok(content.includes('rgba(15, 23, 42, 0.75)'), 'La tarjeta de clima en hero debe tener fondo oscuro con blur');
});

runTest('6.2 styles.css define tokens accesibles y estilos de componentes de chat', () => {
  const cssPath = path.join(ROOT_DIR, 'frontend/css/styles.css');
  const content = fs.readFileSync(cssPath, 'utf8');

  assert.ok(content.includes('--text-secondary: #334155;'), 'Token text-secondary debe ser #334155');
  assert.ok(content.includes('--text-muted: #475569;'), 'Token text-muted debe ser #475569');
  assert.ok(content.includes('.chat-parcel-card'), 'Debe existir .chat-parcel-card');
  assert.ok(content.includes('.chat-weather-banner'), 'Debe existir .chat-weather-banner');
  assert.ok(content.includes('.chat-reply-card'), 'Debe existir .chat-reply-card');
  assert.ok(content.includes('.chat-actions-container'), 'Debe existir .chat-actions-container');
});

console.log('\n================================================================');
console.log(`📊 RESULTADO FINAL: ${passedTests} de ${totalTests} pruebas pasaron exitosamente.`);
if (passedTests === totalTests) {
  console.log('🎉 TODAS LAS ETAPAS ESTÁN VERIFICADAS Y VALIDAS.');
  process.exit(0);
} else {
  console.error('⚠️ ALGUNAS PRUEBAS FALLARON.');
  process.exit(1);
}
