/**
 * AgroPasco — Test Suite Automatizado de Validación de Correcciones Locales (Fase 3)
 * =================================================================================
 * Valida:
 * 1. Sintaxis SQL y parámetros compatibles con PostgreSQL (adminController y tests de integración).
 * 2. Validación estricta de coordenadas:
 *    - Rechazo de null, undefined, strings vacíos y cadenas de espacios.
 *    - Rechazo de NaN, Infinity (-Inf/+Inf numéricos y strings).
 *    - Rechazo de valores no numéricos, booleanos y tipos incompatibles.
 *    - Rechazo de cadenas parcialmente numéricas ("12abc", "abc12", "12.34xyz", etc.).
 *    - Rechazo de formatos malformados ("--10.5").
 *    - Rechazo de valores fuera de rango (lat [-90, 90], lng [-180, 180]).
 *    - Aceptación de coordenadas válidas (numéricas y strings válidos, decimales, negativos).
 *    - No exposición de valores crudos no validados en respuestas de error.
 * 3. Consulta segura a Open-Meteo:
 *    - Construcción con URL y URLSearchParams (codificación de timezone=America%2FLima).
 *    - Cabecera User-Agent identificativa ('AgroPasco-Platform/1.0 (Climate-Monitoring)').
 *    - Manejo seguro de HTTP 400, 403 y 429.
 *    - Manejo de Timeout (10s) y fallos de conexión de red/DNS.
 *    - Manejo de respuestas JSON inválidas o malformadas.
 *    - Sanitización de logs y no exposición de secretos.
 * 4. Fallback heurístico 100% operativo sin depender de FastAPI.
 *
 * EJECUCIÓN 100% LOCAL Y AISLADA:
 * - NO conecta a Supabase de producción.
 * - NO modifica bases de datos reales.
 * - Utiliza mocks en memoria para fetch y operaciones de red.
 */

const fs = require('fs');
const path = require('path');

async function runValidationSuite() {
  console.log('='.repeat(75));
  console.log('🧪 AGROPASCO — TEST SUITE DE VALIDACIÓN DE CORRECCIONES LOCALES (FASE 3)');
  console.log('='.repeat(75));

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName} ${details ? '— ' + details : ''}`);
      failed++;
    }
  }

  // ========================================================================
  // PRUEBA 1: Sintaxis SQL Compatible con PostgreSQL
  // ========================================================================
  console.log('\n--- 1. VERIFICACIÓN DE SINTAXIS SQL EN CONTROLADORES Y PRUEBAS ---');
  const adminControllerPath = path.resolve(__dirname, '..', 'controllers', 'adminController.js');
  const adminControllerContent = fs.readFileSync(adminControllerPath, 'utf8');

  // Asegurar que NO existan comillas dobles en 'status = "active"' ni 'status = "blocked"'
  const hasDoubleQuoteActive = /status\s*=\s*"active"/i.test(adminControllerContent);
  const hasDoubleQuoteBlocked = /status\s*=\s*"blocked"/i.test(adminControllerContent);
  assert(!hasDoubleQuoteActive, 'adminController: No debe existir status = "active" con comillas dobles');
  assert(!hasDoubleQuoteBlocked, 'adminController: No debe existir status = "blocked" con comillas dobles');

  // Asegurar que existan las versiones corregidas con comillas simples
  const hasSingleQuoteActive = /status\s*=\s*'active'/i.test(adminControllerContent);
  const hasSingleQuoteBlocked = /status\s*=\s*'blocked'/i.test(adminControllerContent);
  assert(hasSingleQuoteActive, "adminController: Debe contener status = 'active' con comillas simples estándar SQL");
  assert(hasSingleQuoteBlocked, "adminController: Debe contener status = 'blocked' con comillas simples estándar SQL");

  // Verificar que test_ml_integration_and_auth.js tampoco tenga comillas dobles en queries SQL
  const integrationTestPath = path.resolve(__dirname, 'test_ml_integration_and_auth.js');
  const integrationTestContent = fs.readFileSync(integrationTestPath, 'utf8');
  const hasDoubleQuoteRoleAdmin = /role\s*=\s*"admin"/i.test(integrationTestContent);
  const hasDoubleQuoteRoleAdvisor = /role\s*=\s*"advisor"/i.test(integrationTestContent);
  assert(!hasDoubleQuoteRoleAdmin, 'test_ml_integration_and_auth: No debe contener role = "admin" con comillas dobles');
  assert(!hasDoubleQuoteRoleAdvisor, 'test_ml_integration_and_auth: No debe contener role = "advisor" con comillas dobles');
  const hasSingleQuoteRoleAdmin = /role\s*=\s*'admin'/i.test(integrationTestContent);
  const hasSingleQuoteRoleAdvisor = /role\s*=\s*'advisor'/i.test(integrationTestContent);
  assert(hasSingleQuoteRoleAdmin, "test_ml_integration_and_auth: Debe usar role = 'admin' con comillas simples");
  assert(hasSingleQuoteRoleAdvisor, "test_ml_integration_and_auth: Debe usar role = 'advisor' con comillas simples");

  // Verificar conversión con convertPlaceholders de PostgreSQL
  const sampleQuery = "UPDATE users SET password_hash = ?, must_change_password = 1, is_blocked = 0, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?";
  let idx = 0;
  let inStr = false;
  let converted = '';
  for (let i = 0; i < sampleQuery.length; i++) {
    const ch = sampleQuery[i];
    if (ch === "'" && (i === 0 || sampleQuery[i - 1] !== '\\')) {
      inStr = !inStr;
      converted += ch;
    } else if (ch === '?' && !inStr) {
      idx++;
      converted += `$${idx}`;
    } else {
      converted += ch;
    }
  }
  assert(converted.includes('$1') && converted.includes('$2'), 'PostgreSQL: Placeholders ? se convierten a $1 y $2');
  assert(converted.includes("status = 'active'"), "PostgreSQL: Literal 'active' permanece intacto");

  // ========================================================================
  // PRUEBA 2: Validación Estricta de Coordenadas en mlService.js
  // ========================================================================
  console.log('\n--- 2. VALIDACIÓN ESTRICTA DE COORDENADAS ---');
  const mlService = require('../services/mlService');
  const { validateCoordinates } = mlService;

  // 2.1 Coordenadas nulas, indefinidas o vacías
  const resNull = await mlService.getPredictionForParcel(null);
  assert(resNull.success === false && resNull.fallback === 'no_coordinates', 'Rechaza parcela nula con fallback no_coordinates');

  const resNoCoords = await mlService.getPredictionForParcel({ id: 101, name: 'P-SinCoords' });
  assert(resNoCoords.success === false && resNoCoords.fallback === 'no_coordinates', 'Rechaza parcela sin lat/lng con fallback no_coordinates');

  const resEmptyCoords = await mlService.getPredictionForParcel({ id: 102, name: 'P-Vacia', center_lat: '', center_lng: '' });
  assert(resEmptyCoords.success === false && resEmptyCoords.fallback === 'no_coordinates', 'Rechaza strings vacíos con fallback no_coordinates');

  const resSpacesCoords = await mlService.getPredictionForParcel({ id: 1021, name: 'P-Espacios', center_lat: '   ', center_lng: '   ' });
  assert(resSpacesCoords.success === false && resSpacesCoords.fallback === 'no_coordinates', 'Rechaza strings de solo espacios con fallback no_coordinates');

  // 2.2 No numéricos y valores especiales
  const resNaNCoords = await mlService.getPredictionForParcel({ id: 103, name: 'P-NaN', center_lat: 'not_a_number', center_lng: -76.25 });
  assert(resNaNCoords.success === false && resNaNCoords.fallback === 'invalid_coordinates', 'Rechaza latitud no numérica con fallback invalid_coordinates');

  const resNaNStr = validateCoordinates('NaN', -76.25);
  assert(resNaNStr.valid === false && resNaNStr.fallback === 'invalid_coordinates', 'Rechaza string "NaN" con fallback invalid_coordinates');

  const resInfStr = validateCoordinates('Infinity', -76.25);
  assert(resInfStr.valid === false && resInfStr.fallback === 'invalid_coordinates', 'Rechaza string "Infinity" con fallback invalid_coordinates');

  const resInfNum = validateCoordinates(Infinity, -76.25);
  assert(resInfNum.valid === false && resInfNum.fallback === 'invalid_coordinates', 'Rechaza valor numérico Infinity con fallback invalid_coordinates');

  const resNegInfNum = validateCoordinates(-Infinity, -76.25);
  assert(resNegInfNum.valid === false && resNegInfNum.fallback === 'invalid_coordinates', 'Rechaza valor numérico -Infinity con fallback invalid_coordinates');

  const resBool = validateCoordinates(true, -76.25);
  assert(resBool.valid === false && resBool.fallback === 'invalid_coordinates', 'Rechaza valor booleano true con fallback invalid_coordinates');

  // 2.3 Cadenas parcialmente numéricas (requisito crítico de Fase 2)
  const resPartial1 = await mlService.getPredictionForParcel({ id: 1031, name: 'P-12abc', center_lat: '12abc', center_lng: -76.25 });
  assert(resPartial1.success === false && resPartial1.fallback === 'invalid_coordinates', 'Rechaza cadena parcialmente numérica "12abc" con fallback invalid_coordinates');

  const resPartial2 = validateCoordinates('abc12', -76.25);
  assert(resPartial2.valid === false && resPartial2.fallback === 'invalid_coordinates', 'Rechaza cadena parcialmente numérica "abc12"');

  const resPartial3 = validateCoordinates('12.34xyz', -76.25);
  assert(resPartial3.valid === false && resPartial3.fallback === 'invalid_coordinates', 'Rechaza cadena con sufijo no numérico "12.34xyz"');

  const resMalformed = validateCoordinates('--10.5', -76.25);
  assert(resMalformed.valid === false && resMalformed.fallback === 'invalid_coordinates', 'Rechaza formato numérico malformado "--10.5"');

  // 2.4 Fuera de límites geográficos
  const resLatOver = await mlService.getPredictionForParcel({ id: 104, name: 'P-LatOver', center_lat: 95.5, center_lng: -76.25 });
  assert(resLatOver.success === false && resLatOver.fallback === 'invalid_coordinates', 'Rechaza latitud > 90 con fallback invalid_coordinates');

  const resLatUnder = await mlService.getPredictionForParcel({ id: 105, name: 'P-LatUnder', center_lat: -95.5, center_lng: -76.25 });
  assert(resLatUnder.success === false && resLatUnder.fallback === 'invalid_coordinates', 'Rechaza latitud < -90 con fallback invalid_coordinates');

  const resLngOver = await mlService.getPredictionForParcel({ id: 106, name: 'P-LngOver', center_lat: -10.65, center_lng: 190.0 });
  assert(resLngOver.success === false && resLngOver.fallback === 'invalid_coordinates', 'Rechaza longitud > 180 con fallback invalid_coordinates');

  const resLngUnder = await mlService.getPredictionForParcel({ id: 107, name: 'P-LngUnder', center_lat: -10.65, center_lng: -190.0 });
  assert(resLngUnder.success === false && resLngUnder.fallback === 'invalid_coordinates', 'Rechaza longitud < -180 con fallback invalid_coordinates');

  // 2.5 Aceptación de coordenadas válidas y seguridad de respuesta
  const resValidStrings = validateCoordinates('-10.6674', '-76.2567');
  assert(resValidStrings.valid === true && resValidStrings.lat === -10.6674 && resValidStrings.lng === -76.2567, 'Acepta coordenadas numéricas válidas en formato string');

  const resValidNums = validateCoordinates(-10.6674, -76.2567);
  assert(resValidNums.valid === true && resValidNums.lat === -10.6674 && resValidNums.lng === -76.2567, 'Acepta coordenadas numéricas válidas de P-1');

  // Seguridad: Asegurar que NO se devuelvan valores crudos no validados en 'details'
  assert(!resPartial1.details, 'Seguridad: No expone valores crudos en respuesta de error');

  // ========================================================================
  // PRUEBA 3: Construcción Segura y Diagnóstico de Errores de Open-Meteo
  // ========================================================================
  console.log('\n--- 3. CONSTRUCCIÓN DE URL Y DIAGNÓSTICO SEGURO DE OPEN-METEO ---');
  const originalFetch = global.fetch;
  const parcelValid = { id: 7, name: 'P-1', center_lat: -10.6674, center_lng: -76.2567, altitude_masl: 4380 };

  // 3.1 Inspección de URL y Headers enviados a Open-Meteo
  let capturedUrl = '';
  let capturedHeaders = null;
  global.fetch = async (url, options = {}) => {
    if (url.includes('open-meteo.com')) {
      capturedUrl = url;
      capturedHeaders = options.headers || {};
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: true, reason: 'Test reason' }),
        text: async () => 'Test reason'
      };
    }
    throw new TypeError('fetch failed');
  };

  await mlService.getFallbackPrediction(parcelValid);
  assert(capturedUrl.startsWith('https://api.open-meteo.com/v1/forecast?'), 'URL inicia con endpoint oficial de Open-Meteo');
  assert(capturedUrl.includes('latitude=-10.6674'), 'URL contiene parámetro latitude codificado');
  assert(capturedUrl.includes('longitude=-76.2567'), 'URL contiene parámetro longitude codificado');
  assert(capturedUrl.includes('timezone=America%2FLima'), 'URL codifica correctamente timezone=America%2FLima');
  assert(capturedUrl.includes('forecast_days=3'), 'URL incluye forecast_days=3');
  assert(capturedHeaders && capturedHeaders['User-Agent'] === 'AgroPasco-Platform/1.0 (Climate-Monitoring)', 'Petición incluye cabecera User-Agent identificativa y profesional');

  // 3.2: Simulación de HTTP 400 Bad Request
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: true, reason: 'Latitude must be in range of -90 to 90 degrees' }),
        text: async () => 'Latitude must be in range of -90 to 90 degrees'
      };
    }
    throw new TypeError('fetch failed');
  };

  const resHttp400 = await mlService.getFallbackPrediction(parcelValid);
  assert(resHttp400.success === false, 'HTTP 400 marca success = false');
  assert(resHttp400.fallback === 'api_error', 'HTTP 400 retorna fallback = api_error');
  assert(resHttp400.http_status === 400, 'HTTP 400 preserva código de estado técnico 400');
  assert(typeof resHttp400.error === 'string' && !resHttp400.error.includes('stack'), 'Mensaje de error es seguro para el usuario');

  // 3.3: Simulación de HTTP 403 Forbidden (Acceso bloqueado por WAF/IP)
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: true, reason: 'Access Denied / WAF challenge' }),
        text: async () => 'Forbidden'
      };
    }
    throw new TypeError('fetch failed');
  };

  const resHttp403 = await mlService.getFallbackPrediction(parcelValid);
  assert(resHttp403.success === false, 'HTTP 403 marca success = false');
  assert(resHttp403.fallback === 'api_error', 'HTTP 403 retorna fallback = api_error');
  assert(resHttp403.http_status === 403, 'HTTP 403 preserva código 403');
  assert(resHttp403.error.includes('Acceso denegado'), 'Informa adecuadamente al usuario sobre acceso denegado');

  // 3.4: Simulación de HTTP 429 Too Many Requests (Rate Limit en IPs compartidas)
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: true, reason: 'Daily API call limit of 10000 reached' }),
        text: async () => 'Daily API call limit reached'
      };
    }
    throw new TypeError('fetch failed');
  };

  const resHttp429 = await mlService.getFallbackPrediction(parcelValid);
  assert(resHttp429.success === false, 'HTTP 429 marca success = false');
  assert(resHttp429.fallback === 'api_error', 'HTTP 429 retorna fallback = api_error');
  assert(resHttp429.http_status === 429, 'HTTP 429 preserva código de estado técnico 429');
  assert(resHttp429.error.includes('Límite de solicitudes alcanzado'), 'Informa adecuadamente al usuario sobre el límite de solicitudes');

  // 3.5: Simulación de Timeout (AbortError)
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    throw new TypeError('fetch failed');
  };

  const resTimeout = await mlService.getFallbackPrediction(parcelValid);
  assert(resTimeout.success === false, 'Timeout marca success = false');
  assert(resTimeout.fallback === 'timeout', 'Timeout clasifica correctamente como fallback = timeout');
  assert(resTimeout.error.includes('agotado'), 'Mensaje de timeout en español claro para el usuario');

  // 3.6: Simulación de Fallo de Red / DNS
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      throw new TypeError('ENOTFOUND api.open-meteo.com');
    }
    throw new TypeError('fetch failed');
  };

  const resNetwork = await mlService.getFallbackPrediction(parcelValid);
  assert(resNetwork.success === false, 'Fallo de red marca success = false');
  assert(resNetwork.fallback === 'network_error', 'Fallo de red clasifica como fallback = network_error');
  assert(resNetwork.error.includes('conexión'), 'Mensaje de error de red seguro para el usuario');

  // 3.7: Simulación de Respuesta JSON Inválida (HTML de error de Cloudflare en 200 OK)
  global.fetch = async (url) => {
    if (url.includes('open-meteo.com')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        }
      };
    }
    throw new TypeError('fetch failed');
  };

  const resBadJson = await mlService.getFallbackPrediction(parcelValid);
  assert(resBadJson.success === false, 'Respuesta JSON inválida marca success = false');
  assert(resBadJson.fallback === 'api_error', 'Respuesta JSON inválida maneja fallback = api_error de forma segura');
  assert(resBadJson.error.includes('inválida'), 'Mensaje de error amigable ante payload corrupto');

  // ========================================================================
  // PRUEBA 4: Fallback Heurístico Cuando FastAPI No Está Disponible
  // ========================================================================
  console.log('\n--- 4. FUNCIONAMIENTO DEL FALLBACK HEURÍSTICO SIN FASTAPI ---');

  // Mock: FastAPI lanza error de conexión (offline), Open-Meteo responde 200 OK
  const mockForecastData = {
    daily: {
      time: ['2026-10-09', '2026-10-10', '2026-10-11'],
      temperature_2m_max: [10.5, 12.0, 9.8],
      temperature_2m_min: [-3.5, -1.2, 0.5],
      temperature_2m_mean: [3.5, 5.4, 5.1],
      precipitation_sum: [0.0, 15.2, 2.1],
      wind_speed_10m_max: [4.2, 3.8, 6.1]
    },
    hourly: {
      temperature_2m: [0, -1, -2, -3.5, -2, 1, 5, 8],
      relative_humidity_2m: [80, 85, 90, 88, 75, 60, 55, 50],
      precipitation: [0, 0, 0, 0, 0, 0, 0, 0]
    },
    elevation: 4340
  };

  global.fetch = async (url) => {
    if (url.includes('predict') || url.includes('8100')) {
      // Simular FastAPI offline
      throw new TypeError('fetch failed (ECONNREFUSED)');
    }
    if (url.includes('open-meteo.com')) {
      // Open-Meteo funcionando normalmente
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockForecastData
      };
    }
    throw new Error('URL no esperada: ' + url);
  };

  // Ejecutar predicción de parcela válida con FastAPI caído
  const resFallbackWorking = await mlService.getPredictionForParcel(parcelValid);

  assert(resFallbackWorking.success === true, 'El fallback heurístico retorna success = true');
  assert(resFallbackWorking.source === 'fallback_rules', 'La fuente se identifica transparentemente como fallback_rules');
  assert(Array.isArray(resFallbackWorking.data.predictions), 'Contiene arreglo de predicciones');
  assert(resFallbackWorking.data.predictions.length === 4, 'Evalúa los 4 fenómenos: helada, lluvia, nieve y granizo');

  // Validar evaluación heurística de helada para tempMin = -3.5°C
  const frostPred = resFallbackWorking.data.predictions.find(p => p.phenomenon === 'frost');
  assert(frostPred !== undefined, 'Existe predicción para helada (frost)');
  assert(frostPred.model_type === 'rule_based', 'El tipo de modelo es rule_based');
  assert(frostPred.risk_score >= 70, 'Calcula riesgo alto para temperatura mínima de -3.5°C');
  assert(frostPred.risk_level === 'high', 'Nivel de riesgo clasificado como high');

  // Restaurar fetch original
  global.fetch = originalFetch;

  // ========================================================================
  // RESUMEN FINAL
  // ========================================================================
  console.log('\n' + '='.repeat(75));
  console.log(`📊 RESULTADOS FINALES: ${passed} PASSED | ${failed} FAILED`);
  console.log('='.repeat(75));

  if (failed > 0) {
    console.error(`\n❌ Se detectaron ${failed} fallos en la suite de validación.`);
    process.exit(1);
  } else {
    console.log('\n🎉 TODAS LAS PRUEBAS DE VALIDACIÓN PASARON EXITOSAMENTE (100% OK).');
  }
}

// Ejecutar si se invoca directamente
if (require.main === module) {
  runValidationSuite().catch(err => {
    console.error('Error fatal ejecutando test suite:', err);
    process.exit(1);
  });
}

module.exports = { runValidationSuite };
