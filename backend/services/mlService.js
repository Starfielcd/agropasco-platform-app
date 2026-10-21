/**
 * AgroPasco — Servicio de Machine Learning (Inferencia Nativa Node.js)
 * =====================================================================
 * FASE 8D: Inferencia local mediante modelos scikit-learn exportados a JSON
 * integrados directamente con datos meteorológicos de Open-Meteo.
 *
 * Características:
 *  - Inferencia ML nativa pura en Node.js (GradientBoosting, RandomForest, LogisticRegression).
 *  - Ingeniería de características meteorológicas sin fuga temporal (7 días pasados + 72h futuro).
 *  - Transparencia total de origen: 'ml_trained', 'rule_based', 'datos_insuficientes'.
 *  - Respaldo automático mediante reglas meteorológicas agronómicas si el motor ML
 *    o variables requeridas no están disponibles.
 *  - Validación estricta de coordenadas geográficas.
 *  - Cache de predicciones por parcela en weather_cache (1 hora).
 */

const db = require('../config/database');
const { defaultEngine } = require('./mlEngine');
const { buildDailyFeatures, checkFeatureCompleteness } = require('./mlFeaturePipeline');
const weatherCacheService = require('./weatherCacheService');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8100';
const EXPECTED_MODEL_VERSION = '2.0.0_native';
const FALLBACK_RULES_VERSION = '2.0.0_fallback_rules';
const ML_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hora (60 minutos)
const RULE_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos
const ML_STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas máximo para respaldo stale
const ML_RATE_LIMIT_DEFAULT_COOLDOWN_MS = process.env.NODE_ENV === 'test' ? 500 : 60 * 1000; // 60s en producción, 500ms en pruebas
const ML_RATE_LIMIT_MAX_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos máximo de enfriamiento
const ML_MAX_RETRY_WAIT_MS = 2000; // Máximo 2 segundos de espera para reintento síncrono
const ML_REQUEST_TIMEOUT_MS = 12000; // 12 segundos (optimizado para latencia en frío)
const ML_RETRY_TIMEOUT_MS = 10000; // 10 segundos para el reintento
const ML_MAX_RETRIES = 1; // Máximo 1 reintento para errores transitorios
const ML_RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 10 : 1000; // 1s en producción, 10ms en pruebas
const DEFAULT_CONCURRENCY_LIMIT = 2; // Máximo 2 consultas simultáneas por lote de parcelas

/**
 * Verifica si el servicio / motor ML está disponible.
 * Reporta el estado del motor nativo Node.js.
 */
async function checkMLServiceHealth() {
  try {
    if (!defaultEngine.isLoaded) {
      defaultEngine.loadModels();
    }
    return {
      status: 'ok',
      engine: 'native_node_js',
      version: '2.0.0_native',
      models_count: 3,
      models_loaded: ['frost', 'heavy_rain', 'snow'],
      models: ['frost', 'heavy_rain', 'snow', 'hail (rule_based)'],
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    // Si el motor nativo tiene problemas, verificar si existe un servicio externo
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${ML_SERVICE_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return await response.json();
    } catch (_) {}
    return null;
  }
}

/**
 * Obtiene el estado y metadatos de los modelos ML nativos.
 */
async function getModelsStatus() {
  try {
    if (!defaultEngine.isLoaded) {
      defaultEngine.loadModels();
    }
    const modelRegistry = require('../config/modelRegistry');
    const frostAlgo = defaultEngine.models?.frost?.algorithm || modelRegistry.getActiveModel('frost').algorithm;
    const frostVersion = defaultEngine.models?.frost?.version || modelRegistry.getActiveModel('frost').version;

    let frostMetaMetrics = null;
    try {
      const fs = require('fs');
      const path = require('path');
      const frostMetaPath = path.resolve(__dirname, '../data/weather-history/models/frost/metadata.json');
      if (fs.existsSync(frostMetaPath)) {
        frostMetaMetrics = JSON.parse(fs.readFileSync(frostMetaPath, 'utf8')).test_metrics;
      }
    } catch (_) {}

    return {
      frost: {
        available: true,
        model_type: `${frostAlgo} (Nativo)`,
        algorithm: frostAlgo,
        version: frostVersion,
        n_features: 18,
        label_type: 'proxy_rule_based_era5',
        evaluation_note: 'Evaluación histórica en split test (ERA5/Open-Meteo, >2025-06-30). No representa validación meteorológica de campo SENAMHI ni garantía de exactitud a 72h.',
        test_metrics: frostMetaMetrics || {
          split: 'test',
          n_samples: 906,
          f1: 0.9003,
          precision: 0.8227,
          recall: 0.994,
          pr_auc: 0.9938,
          roc_auc: 0.9985,
          brier_score: 0.0252,
          expected_calibration_error: 0.0447
        }
      },
      heavy_rain: {
        available: true,
        model_type: 'RandomForest (Nativo)',
        algorithm: 'RandomForestClassifier',
        version: '2.0.0_audited_no_leak',
        n_features: 16,
        label_type: 'proxy_rule_based_era5',
        evaluation_note: 'Evaluación histórica en split test (ERA5/Open-Meteo, >2025-06-30). Precisión moderada (46.5%) por desbalance de clases (5.37% positivos en test). No representa validación de campo SENAMHI ni garantía a 72h.',
        test_metrics: {
          split: 'test',
          n_samples: 1359,
          f1: 0.59,
          precision: 0.4646,
          recall: 0.8082,
          pr_auc: 0.6288,
          roc_auc: 0.9689,
          brier_score: 0.0411,
          expected_calibration_error: 0.0534
        }
      },
      snow: {
        available: true,
        model_type: 'LogisticRegression (Nativo)',
        algorithm: 'LogisticRegression',
        version: '2.0.0_audited_no_leak',
        n_features: 13,
        label_type: 'proxy_rule_based_era5',
        evaluation_note: 'Evaluación histórica en split test (ERA5/Open-Meteo, >2025-06-30). No representa validación meteorológica de campo SENAMHI ni garantía a 72h.',
        test_metrics: {
          split: 'test',
          n_samples: 906,
          f1: 0.7575,
          precision: 0.7904,
          recall: 0.7273,
          pr_auc: 0.8491,
          roc_auc: 0.8931,
          brier_score: 0.1304,
          expected_calibration_error: 0.0274
        }
      },
      hail: {
        available: false,
        model_type: 'Reglas Heurísticas Físicas',
        fallback: 'rule_based',
        reason: '0 horas WMO de granizo en reanálisis ERA5; evaluado mediante reglas meteorológicas físicas.'
      }
    };
  } catch (err) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${ML_SERVICE_URL}/models/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return await response.json();
    } catch (_) {}
    console.warn('⚠️ Motor ML nativo no disponible para consulta de modelos:', err.message);
    return null;
  }
}

/**
 * Valida estrictamente un par de coordenadas geográficas (latitud, longitud).
 * Rechaza null, undefined, cadenas vacías o con espacios, NaN, Infinity, tipos no numéricos,
 * cadenas parcialmente numéricas (ej. "12abc", "abc12") y valores fuera de rangos geográficos.
 */
function validateCoordinates(rawLat, rawLng) {
  if (
    rawLat === null || rawLat === undefined || (typeof rawLat === 'string' && rawLat.trim() === '') ||
    rawLng === null || rawLng === undefined || (typeof rawLng === 'string' && rawLng.trim() === '')
  ) {
    return {
      valid: false,
      fallback: 'no_coordinates',
      error: 'La parcela no tiene coordenadas registradas. Edita la parcela para agregar su ubicación en el mapa.'
    };
  }

  const isValidNumber = (val) => {
    if (typeof val === 'number') {
      return Number.isFinite(val) && !Number.isNaN(val);
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
        return false;
      }
      const num = Number(trimmed);
      return Number.isFinite(num) && !Number.isNaN(num);
    }
    return false;
  };

  if (!isValidNumber(rawLat) || !isValidNumber(rawLng)) {
    return {
      valid: false,
      fallback: 'invalid_coordinates',
      error: 'La parcela tiene coordenadas geográficas inválidas o fuera de límites.'
    };
  }

  const lat = typeof rawLat === 'number' ? rawLat : Number(String(rawLat).trim());
  const lng = typeof rawLng === 'number' ? rawLng : Number(String(rawLng).trim());

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      valid: false,
      fallback: 'invalid_coordinates',
      error: 'La parcela tiene coordenadas geográficas inválidas o fuera de límites.'
    };
  }

  return { valid: true, lat, lng };
}

// Deduplicación en memoria de solicitudes idénticas en vuelo (coalescing)
const inFlightRequests = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Interpreta la cabecera Retry-After según RFC 7231 (segundos o fecha HTTP).
 * Retorna el retardo en milisegundos, o null si no es válida.
 * @param {string|null} headerValue Valor de la cabecera Retry-After
 * @returns {number|null} Milisegundos de espera o null
 */
function parseRetryAfter(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  // Formato 1: Entero en segundos (e.g., "30" o "1")
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  // Formato 2: Fecha HTTP (IMF-fixdate / RFC 2822 / ISO)
  const dateTimestamp = Date.parse(trimmed);
  if (!isNaN(dateTimestamp)) {
    const diffMs = dateTimestamp - Date.now();
    return Math.max(0, diffMs);
  }

  return null;
}

/**
 * FASE 8L-G20: Normaliza y valida timestamps de caché meteorológica.
 * Compatible con:
 *  - Objetos Date nativos de JavaScript (entregados por el driver 'pg' para columnas TIMESTAMPTZ en PostgreSQL).
 *  - Cadenas ISO 8601 con 'Z' o con huso horario explícito (+/-HH:mm).
 *  - Cadenas UTC de SQLite en formato 'YYYY-MM-DD HH:mm:ss' (o con milisegundos).
 *  - Números enteros/flotantes positivos (Unix epoch ms).
 * Retorna milisegundos Unix (UTC) o null si la entrada es nula, vacía o inválida.
 * NUNCA genera fechas artificiales ni asume Date.now() ante fallos.
 * @param {Date|string|number|null|undefined} val Valor de timestamp a normalizar
 * @returns {number|null} Milisegundos UTC o null
 */
function parseCacheTimestamp(val) {
  if (val === null || val === undefined) return null;

  // 1. Objeto Date nativo (PostgreSQL TIMESTAMPTZ vía driver pg)
  if (val instanceof Date) {
    const time = val.getTime();
    return isNaN(time) ? null : time;
  }

  // 2. Número (milisegundos Unix)
  if (typeof val === 'number') {
    return (Number.isFinite(val) && val > 0) ? val : null;
  }

  // 3. Cadena de texto
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    // Formato SQLite del proyecto: 'YYYY-MM-DD HH:mm:ss' (almacenado como UTC en SQLite)
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      const parsedUtc = Date.parse(trimmed.replace(' ', 'T') + 'Z');
      return !isNaN(parsedUtc) ? parsedUtc : null;
    }

    // Verificar si ya contiene zona horaria explícita ('Z' o '+/-HH:mm' o '+/-HHmm' o '+/-HH')
    const hasTimezone = trimmed.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(trimmed);
    if (hasTimezone) {
      const parsed = Date.parse(trimmed);
      return !isNaN(parsed) ? parsed : null;
    }

    // Si contiene 'T' pero carece de zona horaria explícita, interpretar como UTC
    if (trimmed.includes('T')) {
      const parsedUtc = Date.parse(trimmed + 'Z');
      return !isNaN(parsedUtc) ? parsedUtc : null;
    }

    // Intento genérico para otros formatos parseables
    const generic = Date.parse(trimmed);
    return !isNaN(generic) ? generic : null;
  }

  return null;
}

/**
 * FASE 8L-G28: Genera una huella geográfica determinista y canónica a partir de las coordenadas,
 * altitud y geometría GeoJSON realmente utilizadas para la inferencia meteorológica.
 */
function getGeoFootprint(lat, lng, altitude, geoJson) {
  const normLat = (lat !== null && lat !== undefined && !isNaN(Number(lat)))
    ? Number(lat).toFixed(6)
    : '';
  const normLng = (lng !== null && lng !== undefined && !isNaN(Number(lng)))
    ? Number(lng).toFixed(6)
    : '';
  const normAlt = (altitude !== null && altitude !== undefined && !isNaN(Number(altitude)))
    ? String(parseInt(altitude, 10))
    : '';
  let normGeo = '';
  if (geoJson) {
    if (typeof geoJson === 'string') {
      try {
        normGeo = JSON.stringify(JSON.parse(geoJson));
      } catch (_) {
        normGeo = geoJson.trim();
      }
    } else {
      normGeo = JSON.stringify(geoJson);
    }
  }
  return `${normLat}|${normLng}|${normAlt}|${normGeo}`;
}

/**
 * Extrae una cabecera de forma insensible a mayúsculas/minúsculas.
 * Compatible con Map, Headers de Fetch y objetos planos.
 */
function getHeaderCaseInsensitive(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null;
  }
  if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === name.toLowerCase()) return v;
    }
  }
  return null;
}

// Circuit Breaker / Enfriamiento en memoria para Open-Meteo (proceso Node.js)
const rateLimitCircuitBreaker = {
  active: false,
  until: 0,
  reason: null,
  retryAfterMs: 0,
  trippedAt: 0,
  trippedCount: 0
};

/**
 * Comprueba si el circuit breaker está activo debido a un HTTP 429 reciente.
 * Se recupera automáticamente una vez transcurrido el tiempo de enfriamiento.
 */
function isRateLimitActive() {
  if (!rateLimitCircuitBreaker.active) return false;
  if (Date.now() >= rateLimitCircuitBreaker.until) {
    rateLimitCircuitBreaker.active = false;
    rateLimitCircuitBreaker.until = 0;
    rateLimitCircuitBreaker.reason = null;
    rateLimitCircuitBreaker.retryAfterMs = 0;
    return false;
  }
  return true;
}

/**
 * Activa el enfriamiento global de solicitudes a Open-Meteo.
 * @param {number} cooldownMs Duración del enfriamiento en milisegundos
 * @param {string} reason Causa del enfriamiento
 */
function tripRateLimit(cooldownMs, reason = 'HTTP 429 Too Many Requests') {
  const now = Date.now();
  const minFloor = process.env.NODE_ENV === 'test' ? 10 : 100;
  const safeCooldownMs = Math.max(
    minFloor,
    Math.min(cooldownMs || ML_RATE_LIMIT_DEFAULT_COOLDOWN_MS, ML_RATE_LIMIT_MAX_COOLDOWN_MS)
  );
  rateLimitCircuitBreaker.active = true;
  // FASE 8L-G16: Preservación monótona del enfriamiento (H-03)
  // Múltiples respuestas HTTP 429 concurrentes nunca disminuyen el tiempo de enfriamiento activo
  rateLimitCircuitBreaker.until = Math.max(
    rateLimitCircuitBreaker.until || 0,
    now + safeCooldownMs
  );
  rateLimitCircuitBreaker.reason = reason;
  rateLimitCircuitBreaker.retryAfterMs = Math.max(
    rateLimitCircuitBreaker.retryAfterMs || 0,
    safeCooldownMs
  );
  rateLimitCircuitBreaker.trippedAt = rateLimitCircuitBreaker.trippedAt || now;
  rateLimitCircuitBreaker.trippedCount++;
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[CIRCUIT_BREAKER_OPEN]: Enfriamiento activo de Open-Meteo por ${Math.round(safeCooldownMs / 1000)}s.`);
  }
}

/**
 * Limpia el estado de rate limit y restablece el circuit breaker.
 */
function clearRateLimit() {
  rateLimitCircuitBreaker.active = false;
  rateLimitCircuitBreaker.until = 0;
  rateLimitCircuitBreaker.reason = null;
  rateLimitCircuitBreaker.retryAfterMs = 0;
  rateLimitCircuitBreaker.trippedAt = 0;
}

/**
 * Retorna el estado actual del circuit breaker de rate limit.
 */
function getRateLimitStatus() {
  const active = isRateLimitActive();
  const remainingMs = active ? Math.max(0, rateLimitCircuitBreaker.until - Date.now()) : 0;
  return {
    active,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    reason: active ? rateLimitCircuitBreaker.reason : null,
    trippedCount: rateLimitCircuitBreaker.trippedCount
  };
}

function clearInFlightRequests() {
  inFlightRequests.clear();
  clearRateLimit();
}

/**
 * Ejecuta una consulta HTTP hacia Open-Meteo con manejo de timeout por AbortController,
 * circuit breaker ante rate limits y reintentos controlados según Retry-After.
 * @param {URL|string} openMeteoUrl URL completa con parámetros
 * @param {object} options Opciones de ejecución (timeoutMs, retryTimeoutMs, maxRetries, retryDelayMs, parcelId)
 */
async function executeOpenMeteoRequest(openMeteoUrl, options = {}) {
  const primaryTimeoutMs = options.timeoutMs || ML_REQUEST_TIMEOUT_MS;
  const retryTimeoutMs = options.retryTimeoutMs || ML_RETRY_TIMEOUT_MS;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : ML_MAX_RETRIES;
  const baseRetryDelayMs = options.retryDelayMs !== undefined ? options.retryDelayMs : ML_RETRY_DELAY_MS;
  const contextLabel = options.parcelId ? `Parcela ${options.parcelId}` : 'Open-Meteo';

  // Si el circuit breaker está activo, retornar de inmediato sin saturar la red externa
  if (isRateLimitActive()) {
    const status = getRateLimitStatus();
    return {
      success: false,
      error: 'Límite de solicitudes alcanzado en el servicio meteorológico. Intente más tarde.',
      fallback: 'api_error',
      http_status: 429,
      rate_limited: true,
      circuit_breaker_open: true,
      retry_after_ms: status.remainingMs,
      attempts: 0,
      durationMs: 0
    };
  }

  let attempt = 0;
  const startTime = Date.now();

  while (attempt <= maxRetries) {
    attempt++;
    const currentTimeoutMs = attempt === 1 ? primaryTimeoutMs : retryTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), currentTimeoutMs);
    const attemptStart = Date.now();
    let response;

    try {
      response = await fetch(openMeteoUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AgroPasco-Platform/1.0 (Climate-Monitoring)'
        }
      });
    } catch (netErr) {
      clearTimeout(timer);
      const attemptDuration = Date.now() - attemptStart;
      const isTimeout = netErr.name === 'AbortError';
      const errorTag = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
      console.error(`[OPEN_METEO_${errorTag}]: ${isTimeout ? `Tiempo de espera de ${Math.round(currentTimeoutMs / 1000)}s agotado` : netErr.message}`);

      // Reintentar solo si es transitorio y quedan intentos
      if (attempt <= maxRetries) {
        console.warn(`[OPEN_METEO_RETRY] ${contextLabel}: Reintentando conexión tras ${errorTag} en ${baseRetryDelayMs}ms... (intento ${attempt + 1}/${maxRetries + 1})`);
        await sleep(baseRetryDelayMs);
        continue;
      }

      return {
        success: false,
        error: isTimeout
          ? 'Tiempo de espera agotado al consultar el pronóstico meteorológico.'
          : 'Error de conexión con el servicio meteorológico externo.',
        fallback: isTimeout ? 'timeout' : 'network_error',
        attempts: attempt,
        durationMs: Date.now() - startTime
      };
    }
    clearTimeout(timer);

    const attemptDuration = Date.now() - attemptStart;

    if (!response.ok) {
      let technicalReason = '';
      try {
        const errJson = await response.json();
        technicalReason = (typeof errJson.reason === 'string' ? errJson.reason : JSON.stringify(errJson)).slice(0, 150);
      } catch (_) {
        const errText = await response.text().catch(() => '');
        technicalReason = errText.slice(0, 150);
      }
      technicalReason = technicalReason.replace(/[\r\n\t]/g, ' ').trim();
      console.error(`[OPEN_METEO_HTTP_ERROR] ${contextLabel} — HTTP ${response.status} (${response.statusText}): ${technicalReason}`);

      // Manejo especializado para HTTP 429 Too Many Requests
      if (response.status === 429) {
        const retryHeader = getHeaderCaseInsensitive(response.headers, 'retry-after');
        const parsedRetryAfterMs = parseRetryAfter(retryHeader);
        const cooldownMs = parsedRetryAfterMs !== null && parsedRetryAfterMs > 0
          ? parsedRetryAfterMs
          : ML_RATE_LIMIT_DEFAULT_COOLDOWN_MS;

        // FASE 8L-G20: Solo permitir reintento síncrono si el proveedor especificó un Retry-After
        // explícito y acotado dentro del presupuesto (<= 2000ms).
        // Si no se proporcionó Retry-After (parsedRetryAfterMs === null), NUNCA realizar un reintento ciego;
        // activar de inmediato el circuit breaker y abortar reintentos para no duplicar llamadas en saturación.
        const canRetrySync = (
          attempt <= maxRetries &&
          parsedRetryAfterMs !== null &&
          parsedRetryAfterMs > 0 &&
          parsedRetryAfterMs <= ML_MAX_RETRY_WAIT_MS
        );

        if (canRetrySync) {
          console.warn(`[OPEN_METEO_RETRY] ${contextLabel}: Reintentando tras HTTP 429 en ${parsedRetryAfterMs}ms (según Retry-After)... (intento ${attempt + 1}/${maxRetries + 1})`);
          await sleep(parsedRetryAfterMs);
          continue;
        }

        // Si excede el presupuesto, falta Retry-After o no quedan intentos, activar circuit breaker y abortar reintentos
        tripRateLimit(cooldownMs, `HTTP 429 de Open-Meteo (${contextLabel})`);

        return {
          success: false,
          error: 'Límite de solicitudes alcanzado en el servicio meteorológico. Intente más tarde.',
          fallback: 'api_error',
          http_status: 429,
          rate_limited: true,
          circuit_breaker_open: true,
          retry_after_ms: cooldownMs,
          attempts: attempt,
          durationMs: Date.now() - startTime
        };
      }

      // Reintentar para errores de servidor 5xx
      const isRetryableHttp = (response.status >= 500);
      if (isRetryableHttp && attempt <= maxRetries) {
        console.warn(`[OPEN_METEO_RETRY] ${contextLabel}: Reintentando tras HTTP ${response.status} en ${baseRetryDelayMs}ms... (intento ${attempt + 1}/${maxRetries + 1})`);
        await sleep(baseRetryDelayMs);
        continue;
      }

      return {
        success: false,
        error: response.status === 403
          ? 'Acceso denegado por el servicio meteorológico externo.'
          : response.status >= 500
            ? 'Servicio meteorológico externo no disponible temporalmente.'
            : 'No se pudo obtener pronóstico meteorológico para esta ubicación.',
        fallback: 'api_error',
        http_status: response.status,
        attempts: attempt,
        durationMs: Date.now() - startTime
      };
    }

    try {
      const forecast = await response.json();
      if (attempt > 1) {
        console.log(`[OPEN_METEO] ${contextLabel}: Recuperado con éxito en reintento ${attempt} (${attemptDuration}ms)`);
      }
      return {
        success: true,
        forecast,
        attempts: attempt,
        durationMs: Date.now() - startTime
      };
    } catch (parseErr) {
      console.error('[OPEN_METEO_PARSE_ERROR]: Error al parsear JSON de respuesta.');
      return {
        success: false,
        error: 'Respuesta inválida recibida del servicio meteorológico externo.',
        fallback: 'api_error',
        attempts: attempt,
        durationMs: Date.now() - startTime
      };
    }
  }
}

/**
 * Consulta la API de Open-Meteo con manejo exhaustivo de timeouts, reintentos,
 * circuit breaker y deduplicación en vuelo.
 * @param {number} lat Latitud validada
 * @param {number} lng Longitud validada
 * @param {object} options Opciones de consulta (includeHistory: boolean, timeoutMs: number, parcelId: number)
 */
async function fetchOpenMeteoForecast(lat, lng, options = {}) {
  // Comprobación temprana de circuit breaker
  if (isRateLimitActive()) {
    weatherCacheService.recordMetric('circuit_breaker_block');
    const status = getRateLimitStatus();
    return {
      success: false,
      error: 'Límite de solicitudes alcanzado en el servicio meteorológico. Intente más tarde.',
      fallback: 'api_error',
      http_status: 429,
      rate_limited: true,
      circuit_breaker_open: true,
      retry_after_ms: status.remainingMs,
      attempts: 0,
      durationMs: 0
    };
  }

  const includeHistory = options.includeHistory !== false;

  // 1. Comprobar si existe un pronóstico crudo reciente en la caché compartida de celda geográfica
  const shared = await weatherCacheService.getSharedForecast(lat, lng, { allowStale: false });
  if (shared && shared.forecast && shared.forecast.hourly && shared.forecast.daily) {
    const hasHistory = !includeHistory || (shared.forecast.past_days_available !== false && (shared.forecast.hourly?.time?.length || 0) >= 168);
    if (hasHistory) {
      return {
        success: true,
        forecast: shared.forecast,
        attempts: 0,
        durationMs: 0,
        source: 'shared_cache'
      };
    }
  }

  const inFlightKey = `${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}_${includeHistory ? 'hist' : 'nohist'}`;

  // Si ya existe una petición idéntica en vuelo, reutilizar la misma promesa
  if (inFlightRequests.has(inFlightKey)) {
    weatherCacheService.recordMetric('coalesced');
    return inFlightRequests.get(inFlightKey);
  }

  const openMeteoUrl = new URL('https://api.open-meteo.com/v1/forecast');
  openMeteoUrl.searchParams.set('latitude', String(lat));
  openMeteoUrl.searchParams.set('longitude', String(lng));
  openMeteoUrl.searchParams.set(
    'daily',
    includeHistory
      ? 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,wind_speed_10m_max,et0_fao_evapotranspiration'
      : 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,wind_speed_10m_max'
  );
  openMeteoUrl.searchParams.set(
    'hourly',
    includeHistory
      ? 'temperature_2m,relative_humidity_2m,precipitation,soil_moisture_0_to_7cm'
      : 'temperature_2m,relative_humidity_2m,precipitation'
  );
  openMeteoUrl.searchParams.set('timezone', 'America/Lima');
  if (includeHistory) {
    openMeteoUrl.searchParams.set('past_days', '7');
  }
  openMeteoUrl.searchParams.set('forecast_days', '3');

  const requestPromise = (async () => {
    try {
      weatherCacheService.recordMetric('outgoing', { module: 'ml' });
      const result = await executeOpenMeteoRequest(openMeteoUrl, {
        parcelId: options.parcelId,
        timeoutMs: options.timeoutMs,
        retryTimeoutMs: options.retryTimeoutMs,
        maxRetries: options.maxRetries,
        retryDelayMs: options.retryDelayMs
      });

      if (result.success && result.forecast) {
        weatherCacheService.recordMetric('success');
        await weatherCacheService.saveSharedForecast(lat, lng, result.forecast, {
          allowInTest: options.allowInTest,
          altitude: options.altitude || result.forecast?.elevation,
          scope: 'ml_full'
        });
      } else if (result.http_status === 429) {
        weatherCacheService.recordMetric('http_429', { reason: result.error });
      }

      return result;
    } finally {
      inFlightRequests.delete(inFlightKey);
    }
  })();

  inFlightRequests.set(inFlightKey, requestPromise);
  return requestPromise;
}


/**
 * Solicita predicción meteorológica para una parcela.
 * Ejecuta inferencia local con el motor nativo de Machine Learning.
 * Si el motor o las variables no están disponibles, activa el sistema de reglas de respaldo.
 */
async function getPredictionForParcel(parcel) {
  if (!parcel || !parcel.id) {
    return {
      success: false,
      error: 'Datos de parcela no proporcionados o ID de parcela ausente.',
      fallback: 'no_coordinates'
    };
  }

  const parcelId = parseInt(parcel.id, 10);
  if (isNaN(parcelId) || parcelId <= 0) {
    return {
      success: false,
      error: 'ID de parcela inválido.',
      fallback: 'invalid_parcel'
    };
  }

  // Validación estricta de coordenadas geográficas
  const coordValidation = validateCoordinates(parcel.center_lat, parcel.center_lng);
  if (!coordValidation.valid) {
    return {
      success: false,
      error: coordValidation.error,
      fallback: coordValidation.fallback
    };
  }
  const { lat, lng } = coordValidation;

  const currentGeo = {
    lat,
    lng,
    altitude: parcel.altitude_masl,
    geo_json: parcel.geo_json
  };

  // Consultar cache en primer lugar, verificando que no preceda la creación de la parcela
  const cached = await getCachedPrediction(parcelId, parcel.created_at);
  if (cached) {
    return { success: true, data: cached, source: 'cache' };
  }

  // Carga o verificación del motor nativo ML
  let isEngineReady = false;
  try {
    if (!defaultEngine.isLoaded) {
      defaultEngine.loadModels();
    }
    isEngineReady = defaultEngine.isLoaded;
  } catch (engineLoadErr) {
    console.warn('⚠️ Motor ML nativo no pudo cargar modelos:', engineLoadErr.message);
    isEngineReady = false;
  }

  // Obtener pronóstico de Open-Meteo con historial de 7 días para variables lag/rolling
  const fetchResult = await fetchOpenMeteoForecast(lat, lng, { includeHistory: true, parcelId: parcelId });
  if (!fetchResult.success) {
    // Si la llamada meteorológica falló (timeout, red, límite HTTP 429, circuit breaker),
    // intentar recuperación controlada de la última predicción en caché (stale cache),
    // verificando estrictamente identidad de la parcela y que no preceda su creación
    const staleResult = await getStalePrediction(parcelId, fetchResult, parcel.created_at);
    if (staleResult) {
      return staleResult;
    }

    // Si no hay datos previos para esta parcela, comprobar si existe un pronóstico compartido compatible en el grid (hasta 24h)
    const sharedStale = await weatherCacheService.getSharedForecast(lat, lng, {
      allowStale: true,
      altitude: parcel.altitude_masl,
      requireMlFeatures: true
    });
    if (sharedStale && sharedStale.forecast && sharedStale.forecast.hourly && sharedStale.forecast.daily) {
      try {
        const dailyFeaturesList = buildDailyFeatures(sharedStale.forecast, parcel.altitude_masl);
        if (dailyFeaturesList && dailyFeaturesList.length > 0) {
          const dailyPredictions = [];
          for (const dayFeat of dailyFeaturesList) {
            const dayPred = {
              date: dayFeat.date,
              raw: {
                tempMin: dayFeat.temperature_2m_min,
                tempMax: dayFeat.temperature_2m_max,
                precip: dayFeat.precipitation_sum,
                wind: dayFeat.wind_speed_10m_max
              }
            };
            const frostCheck = checkFeatureCompleteness(dayFeat, defaultEngine.models?.frost?.features || []);
            if (frostCheck.complete && defaultEngine.isLoaded) {
              dayPred.frost = defaultEngine.predictFrost(dayFeat);
            } else {
              const tempMin = dayFeat.temperature_2m_min ?? 999;
              let frostScore = tempMin <= -2 ? 70 : tempMin <= 0 ? 50 : tempMin <= 3 ? 25 : 0;
              dayPred.frost = { phenomenon: 'frost', risk_level: frostScore >= 60 ? 'high' : frostScore >= 30 ? 'moderate' : 'none', risk_score: frostScore };
            }
            const rainCheck = checkFeatureCompleteness(dayFeat, defaultEngine.models?.heavy_rain?.features || []);
            if (rainCheck.complete && defaultEngine.isLoaded) {
              dayPred.heavy_rain = defaultEngine.predictHeavyRain(dayFeat);
            } else {
              const precip = dayFeat.precipitation_sum ?? 0;
              let rainScore = precip >= 15 ? 80 : precip >= 8 ? 50 : precip >= 3 ? 25 : 0;
              dayPred.heavy_rain = { phenomenon: 'heavy_rain', risk_level: rainScore >= 60 ? 'high' : rainScore >= 30 ? 'moderate' : 'none', risk_score: rainScore };
            }
            dayPred.snow = defaultEngine.isLoaded ? defaultEngine.predictSnow(dayFeat) : { phenomenon: 'snow', risk_level: 'none', risk_score: 0 };
            dayPred.hail = defaultEngine.isLoaded ? defaultEngine.predictHail(dayFeat) : { phenomenon: 'hail', risk_level: 'none', risk_score: 0 };
            dailyPredictions.push(dayPred);
          }
          const formattedPredictions = formatConsolidatedPredictions(dailyPredictions, dailyFeaturesList);
          const forecastSummary = {
            days: dailyFeaturesList.length,
            dates: dailyFeaturesList.map(d => d.date),
            temp_min: dailyFeaturesList.map(d => d.temperature_2m_min),
            temp_max: dailyFeaturesList.map(d => d.temperature_2m_max),
            precipitation: dailyFeaturesList.map(d => d.precipitation_sum),
            elevation_model: sharedStale.forecast.elevation || sharedStale.reference_elevation || null
          };
          const staleData = {
            parcel_id: parcelId,
            parcel_name: parcel.name || '',
            latitude: lat,
            longitude: lng,
            altitude_masl: parcel.altitude_masl || null,
            geo_json: parcel.geo_json || null,
            geo_footprint: getGeoFootprint(lat, lng, parcel.altitude_masl, parcel.geo_json),
            model_version: EXPECTED_MODEL_VERSION,
            prediction_source: 'ml_trained',
            predictions: formattedPredictions,
            forecast_summary: forecastSummary,
            issued_at: sharedStale.fetchedAt,
            valid_until: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            is_stale: true,
            source: 'cache_stale',
            last_updated: sharedStale.fetchedAt,
            stale_age_minutes: sharedStale.ageMinutes || 1,
            stale_reason: 'shared_grid_stale',
            grid_reuse: true,
            reference_elevation: sharedStale.reference_elevation || null,
            altitude_diff: sharedStale.altitude_diff !== undefined ? sharedStale.altitude_diff : null,
            coverage_warning: `Pronóstico regional recuperado desde cuadrícula compatible (${sharedStale.ageMinutes || 1} min atrás, altitud ref: ${sharedStale.reference_elevation || 'N/A'} msnm). Servicio meteorológico con alta demanda.`,
            data_source: 'Motor ML Nativo AgroPasco + Open-Meteo (Caché Compartida)'
          };
          return { success: true, data: staleData, source: 'cache_stale' };
        }
      } catch (_) {}
    }

    // Si no hay datos previos en caché, reportar estado amigable para el agricultor
    if (fetchResult.rate_limited || fetchResult.http_status === 429) {
      return {
        ...fetchResult,
        status: 'pending',
        user_status: 'pending',
        fallback: fetchResult.fallback || 'api_error',
        error: fetchResult.error || 'Límite de solicitudes alcanzado en el servicio meteorológico. Intente más tarde.',
        user_message: 'Estamos preparando la información meteorológica de esta parcela. Estará disponible en cuanto se complete la sincronización.'
      };
    }
    return fetchResult;
  }

  const forecast = fetchResult.forecast;

  // Si los modelos no cargaron o faltan datos mínimos, activar fallback de reglas sobre el pronóstico obtenido
  if (!isEngineReady) {
    return formatAndCacheRuleFallback(parcel, lat, lng, forecast);
  }

  // Procesar características meteorológicas para los modelos
  try {
    const dailyFeaturesList = buildDailyFeatures(forecast, parcel.altitude_masl);
    if (!dailyFeaturesList || dailyFeaturesList.length === 0) {
      return formatAndCacheRuleFallback(parcel, lat, lng, forecast);
    }

    // Evaluar cada día de pronóstico (horizonte de hasta 72 horas)
    const dailyPredictions = [];
    let anyMLTrainedEvaluated = false;

    for (const dayFeat of dailyFeaturesList) {
      const dayPred = {
        date: dayFeat.date,
        raw: {
          tempMin: dayFeat.temperature_2m_min,
          tempMax: dayFeat.temperature_2m_max,
          precip: dayFeat.precipitation_sum,
          wind: dayFeat.wind_speed_10m_max
        }
      };

      // 1. Helada (GradientBoosting)
      const frostReq = defaultEngine.models.frost.features;
      const frostCheck = checkFeatureCompleteness(dayFeat, frostReq);
      if (frostCheck.complete) {
        dayPred.frost = defaultEngine.predictFrost(dayFeat);
        anyMLTrainedEvaluated = true;
      } else {
        // Fallback específico de regla para helada
        const tempMin = dayFeat.temperature_2m_min ?? 999;
        const wind = dayFeat.wind_speed_10m_max ?? 0;
        let frostScore = 0;
        if (tempMin <= -5) frostScore = 90;
        else if (tempMin <= -2) frostScore = 70;
        else if (tempMin <= 0) frostScore = 50;
        else if (tempMin <= 3) frostScore = 25;
        if (wind < 5) frostScore += 10;
        frostScore = Math.min(frostScore, 100);

        dayPred.frost = {
          phenomenon: 'frost',
          risk_level: frostScore >= 60 ? 'high' : frostScore >= 30 ? 'moderate' : frostScore >= 10 ? 'low' : 'none',
          risk_score: frostScore,
          model_type: 'rule_based',
          missing_features: frostCheck.missing
        };
      }

      // 2. Lluvia Intensa (RandomForest)
      const rainReq = defaultEngine.models.heavy_rain.features;
      const rainCheck = checkFeatureCompleteness(dayFeat, rainReq);
      if (rainCheck.complete) {
        dayPred.heavy_rain = defaultEngine.predictHeavyRain(dayFeat);
        anyMLTrainedEvaluated = true;
      } else {
        // Fallback de regla para lluvia intensa
        const precip = dayFeat.precipitation_sum ?? 0;
        let rainScore = 0;
        if (precip >= 50) rainScore = 85;
        else if (precip >= 20) rainScore = 55;
        else if (precip >= 10) rainScore = 30;

        dayPred.heavy_rain = {
          phenomenon: 'heavy_rain',
          risk_level: rainScore >= 60 ? 'high' : rainScore >= 30 ? 'moderate' : rainScore >= 10 ? 'low' : 'none',
          risk_score: rainScore,
          model_type: 'rule_based',
          missing_features: rainCheck.missing
        };
      }

      // 3. Nieve (LogisticRegression)
      const snowReq = defaultEngine.models.snow.features;
      const snowCheck = checkFeatureCompleteness(dayFeat, snowReq);
      if (snowCheck.complete) {
        dayPred.snow = defaultEngine.predictSnow(dayFeat);
        anyMLTrainedEvaluated = true;
      } else {
        const altitude = dayFeat.elevation || parcel.altitude_masl || 0;
        const tempMin = dayFeat.temperature_2m_min ?? 999;
        const precip = dayFeat.precipitation_sum ?? 0;
        const snowActive = tempMin <= 0 && precip > 0 && altitude > 4000;

        dayPred.snow = {
          phenomenon: 'snow',
          risk_level: snowActive ? 'moderate' : 'none',
          risk_score: snowActive ? 30 : 0,
          model_type: 'rule_based',
          missing_features: snowCheck.missing
        };
      }

      // 4. Granizo (Reglas meteorológicas físicas)
      dayPred.hail = defaultEngine.evaluateHailRules(dayFeat);

      dailyPredictions.push(dayPred);
    }

    // Si ninguna inferencia supervisada pudo ejecutarse por falta de historial, aplicar fallback general
    if (!anyMLTrainedEvaluated) {
      return formatAndCacheRuleFallback(parcel, lat, lng, forecast);
    }

    // Formatear predicciones seleccionando el peor caso del horizonte
    const formattedPredictions = formatConsolidatedPredictions(dailyPredictions, dailyFeaturesList);

    const forecastSummary = {
      days: dailyPredictions.length,
      dates: dailyPredictions.map(d => d.date),
      temp_min: dailyPredictions.map(d => d.raw.tempMin),
      temp_max: dailyPredictions.map(d => d.raw.tempMax),
      precipitation: dailyPredictions.map(d => d.raw.precip),
      elevation_model: forecast.elevation || null
    };

    const result = {
      parcel_id: parcel.id,
      parcel_name: parcel.name || '',
      latitude: lat,
      longitude: lng,
      altitude_masl: parcel.altitude_masl || forecast.elevation || null,
      geo_json: parcel.geo_json || null,
      geo_footprint: getGeoFootprint(lat, lng, parcel.altitude_masl || forecast.elevation || null, parcel.geo_json),
      model_version: EXPECTED_MODEL_VERSION,
      prediction_source: 'ml_trained',
      predictions: formattedPredictions,
      forecast_summary: forecastSummary,
      issued_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      cache_ttl_ms: ML_CACHE_DURATION_MS,
      cache_expires_at: new Date(Date.now() + ML_CACHE_DURATION_MS).toISOString(),
      data_source: 'Motor ML Nativo AgroPasco (Node.js) + Open-Meteo Forecast',
      coverage_warning: null
    };

    await cachePrediction(parcel.id, result);

    return { success: true, data: result, source: 'ml_service' };
  } catch (procErr) {
    console.warn(`⚠️ Error procesando inferencia nativa para parcela ${parcel.id}: ${procErr.message}. Activando fallback.`);
    return formatAndCacheRuleFallback(parcel, lat, lng, forecast);
  }
}

/**
 * Consolida predicciones diarias en la estructura de peor caso esperada por el contrato JSON.
 */
function formatConsolidatedPredictions(dailyPredictions, dailyFeaturesList) {
  const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
  const result = [];

  const rankLevel = { high: 3, moderate: 2, low: 1, none: 0, model_unavailable: -1 };

  for (const phenomenon of phenomena) {
    let maxScore = 0;
    let worstLevel = 'none';
    let worstDayIdx = 0;
    let modelType = 'ml_trained';

    for (let i = 0; i < dailyPredictions.length; i++) {
      const pred = dailyPredictions[i][phenomenon] || {};
      const score = typeof pred.risk_score === 'number' ? pred.risk_score : 0;
      const level = pred.risk_level || 'none';

      if (score > maxScore || (score === maxScore && (rankLevel[level] || 0) > (rankLevel[worstLevel] || 0))) {
        maxScore = score;
        worstLevel = level;
        worstDayIdx = i;
      }

      if (pred.model_type === 'rule_based') {
        modelType = 'rule_based';
      } else if (pred.model_type === 'datos_insuficientes') {
        modelType = 'datos_insuficientes';
      }
    }

    if (phenomenon === 'hail') {
      modelType = 'rule_based';
    }

    // Extraer variables representativas del día de mayor riesgo
    const bestFeat = dailyFeaturesList[worstDayIdx] || dailyFeaturesList[0] || {};
    const variablesUsed = {};

    if (phenomenon === 'frost') {
      variablesUsed.temperature_2m_min = bestFeat.temperature_2m_min;
      variablesUsed.temperature_2m_mean = bestFeat.temperature_2m_mean;
      variablesUsed.temp_min_rolling_3d = bestFeat.temp_min_rolling_3d;
      variablesUsed.wind_speed_10m_max = bestFeat.wind_speed_10m_max;
      variablesUsed.soil_moisture_mean = bestFeat.soil_moisture_mean;
    } else if (phenomenon === 'heavy_rain') {
      variablesUsed.precipitation_sum = bestFeat.precipitation_sum;
      variablesUsed.precip_rolling_3d = bestFeat.precip_rolling_3d;
      variablesUsed.humidity_mean = bestFeat.humidity_mean;
      variablesUsed.soil_moisture_mean = bestFeat.soil_moisture_mean;
    } else if (phenomenon === 'snow') {
      variablesUsed.temperature_2m_min = bestFeat.temperature_2m_min;
      variablesUsed.temperature_2m_mean = bestFeat.temperature_2m_mean;
      variablesUsed.elevation = bestFeat.elevation;
      variablesUsed.humidity_max = bestFeat.humidity_max;
    } else if (phenomenon === 'hail') {
      variablesUsed.temperature_2m_mean = bestFeat.temperature_2m_mean;
      variablesUsed.precipitation_sum = bestFeat.precipitation_sum;
      variablesUsed.humidity_max = bestFeat.humidity_max;
    }

    let confidenceNote = '';
    let limitations = [];

    if (modelType === 'ml_trained') {
      confidenceNote = 'Inferencia de modelo supervisado entrenado con reanálisis ERA5/Open-Meteo. Puntuación de riesgo relativa; no representa probabilidad calibrada con estaciones en campo.';
      limitations = [
        'Modelo entrenado con proxy meteorológico histórico (ERA5/Open-Meteo), no con observaciones de campo SENAMHI.',
        'Las puntuaciones indican nivel de riesgo relativo dentro de la ventana de pronóstico.',
        'Rendimiento validado offline; sujeto a la precisión del pronóstico numérico de Open-Meteo.'
      ];
    } else if (modelType === 'rule_based') {
      confidenceNote = phenomenon === 'hail'
        ? 'Evaluación física basada en reglas agronómicas (0 horas WMO de granizo en histórico ERA5).'
        : 'Evaluación basada en reglas meteorológicas agronómicas (servicio ML en modo de respaldo). NO es una probabilidad calibrada.';
      limitations = [
        'Evaluación mediante reglas meteorológicas y umbrales de dominio.',
        'No sustituye el monitoreo directo en campo.'
      ];
    } else {
      confidenceNote = 'Datos meteorológicos insuficientes para generar una inferencia confiable.';
      limitations = ['Faltan variables meteorológicas indispensables para este fenómeno.'];
    }

    result.push({
      phenomenon,
      risk_level: worstLevel,
      risk_score: maxScore,
      confidence_note: confidenceNote,
      model_type: modelType,
      variables_used: variablesUsed,
      period: dailyPredictions.length > 0
        ? `${dailyPredictions[0].date} a ${dailyPredictions[dailyPredictions.length - 1].date}`
        : '',
      limitations
    });
  }

  return result;
}

/**
 * Aplica reglas de respaldo a un pronóstico ya obtenido y cachea el resultado.
 */
async function formatAndCacheRuleFallback(parcel, lat, lng, forecast) {
  const daily = forecast.daily || {};
  const dates = daily.time || [];
  const altitude = parcel.altitude_masl || forecast.elevation || null;
  const predictions = [];

  for (let i = 0; i < dates.length; i++) {
    const tempMin = daily.temperature_2m_min?.[i] ?? 999;
    const tempMax = daily.temperature_2m_max?.[i] ?? 0;
    const precip = daily.precipitation_sum?.[i] ?? 0;
    const wind = daily.wind_speed_10m_max?.[i] ?? 0;

    let frostScore = 0;
    if (tempMin <= -5) frostScore = 90;
    else if (tempMin <= -2) frostScore = 70;
    else if (tempMin <= 0) frostScore = 50;
    else if (tempMin <= 3) frostScore = 25;
    if (wind < 5) frostScore += 10;

    let rainScore = 0;
    if (precip >= 50) rainScore = 85;
    else if (precip >= 20) rainScore = 55;
    else if (precip >= 10) rainScore = 30;

    predictions.push({
      date: dates[i],
      frost: {
        score: Math.min(frostScore, 100),
        level: frostScore >= 60 ? 'high' : frostScore >= 30 ? 'moderate' : frostScore >= 10 ? 'low' : 'none'
      },
      heavy_rain: {
        score: Math.min(rainScore, 100),
        level: rainScore >= 60 ? 'high' : rainScore >= 30 ? 'moderate' : rainScore >= 10 ? 'low' : 'none'
      },
      snow: {
        score: tempMin <= 0 && precip > 0 && altitude > 4000 ? 30 : 0,
        level: tempMin <= 0 && precip > 0 && altitude > 4000 ? 'moderate' : 'none'
      },
      hail: {
        score: 0,
        level: 'model_unavailable'
      },
      raw: { tempMin, tempMax, precip, wind }
    });
  }

  const result = {
    parcel_id: parcel.id,
    parcel_name: parcel.name || '',
    latitude: lat,
    longitude: lng,
    altitude_masl: altitude,
    geo_json: parcel.geo_json || null,
    geo_footprint: getGeoFootprint(lat, lng, altitude, parcel.geo_json),
    model_version: FALLBACK_RULES_VERSION,
    prediction_source: 'fallback_rules',
    predictions: formatFallbackPredictions(predictions),
    forecast_summary: {
      days: dates.length,
      dates: dates,
      temp_min: daily.temperature_2m_min || [],
      temp_max: daily.temperature_2m_max || [],
      precipitation: daily.precipitation_sum || [],
      elevation_model: forecast.elevation || null
    },
    issued_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    cache_ttl_ms: RULE_CACHE_DURATION_MS,
    cache_expires_at: new Date(Date.now() + RULE_CACHE_DURATION_MS).toISOString(),
    data_source: 'Open-Meteo Forecast + Reglas AgroPasco (ML no disponible)',
    coverage_warning: null
  };

  await cachePrediction(parcel.id, result);

  return { success: true, data: result, source: 'fallback_rules' };
}

/**
 * Predicción de fallback basada en reglas cuando el servicio ML no está disponible.
 * Consulta Open-Meteo directamente desde Node.js con parámetros estándar de 3 días.
 */
async function getFallbackPrediction(parcel, options = {}) {
  try {
    const coordValidation = validateCoordinates(parcel?.center_lat, parcel?.center_lng);
    if (!coordValidation.valid) {
      return {
        success: false,
        error: coordValidation.fallback === 'no_coordinates'
          ? 'La parcela no tiene coordenadas registradas.'
          : coordValidation.error,
        fallback: coordValidation.fallback
      };
    }
    const { lat, lng } = coordValidation;

    const fetchResult = await fetchOpenMeteoForecast(lat, lng, {
      includeHistory: false,
      parcelId: parcel?.id,
      timeoutMs: options.timeoutMs || ML_REQUEST_TIMEOUT_MS,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : ML_MAX_RETRIES,
      retryDelayMs: options.retryDelayMs !== undefined ? options.retryDelayMs : ML_RETRY_DELAY_MS
    });

    if (!fetchResult.success) {
      return fetchResult;
    }

    const forecast = fetchResult.forecast;
    return formatAndCacheRuleFallback(parcel, lat, lng, forecast);
  } catch (err) {
    console.error('Error en fallback prediction:', err.message);
    return {
      success: false,
      error: 'No se pudo generar predicción de fallback',
      fallback: 'complete_failure'
    };
  }
}

/**
 * Formatea las predicciones de fallback al formato estándar del contrato JSON.
 */
function formatFallbackPredictions(dailyPredictions) {
  const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
  const result = [];

  for (const phenomenon of phenomena) {
    let maxScore = 0;
    let worstLevel = 'none';
    const variables = {};

    for (const day of dailyPredictions) {
      const pred = day[phenomenon] || {};
      if ((pred.score || 0) > maxScore) {
        maxScore = pred.score || 0;
        worstLevel = pred.level || 'none';
      }
    }

    if (dailyPredictions.length > 0) {
      const raw = dailyPredictions[0].raw || {};
      if (phenomenon === 'frost') {
        variables.temperature_2m_min = raw.tempMin;
        variables.wind_speed_10m_max = raw.wind;
      } else if (phenomenon === 'heavy_rain') {
        variables.precipitation_sum = raw.precip;
      }
    }

    result.push({
      phenomenon,
      risk_level: worstLevel,
      risk_score: maxScore,
      confidence_note: 'Evaluación basada en reglas meteorológicas (servicio ML no disponible). NO es una probabilidad calibrada.',
      model_type: 'rule_based',
      variables_used: variables,
      period: dailyPredictions.length > 0
        ? `${dailyPredictions[0].date} a ${dailyPredictions[dailyPredictions.length - 1].date}`
        : '',
      limitations: [
        'Servicio ML no disponible. Usando reglas meteorológicas de fallback.',
        'Los umbrales son configurables y documentados.'
      ]
    });
  }

  return result;
}

/**
 * Procesa un arreglo de elementos de forma asíncrona con un límite estricto de concurrencia.
 * Garantiza la preservación del orden original y evita que el fallo de un elemento interrumpa los demás.
 * @param {Array} items Elementos a procesar
 * @param {number} limit Máximo de promesas simultáneas (por defecto 2)
 * @param {Function} asyncFn Función asíncrona a ejecutar por elemento (item, index)
 */
async function mapWithConcurrency(items, limit = DEFAULT_CONCURRENCY_LIMIT, asyncFn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit || DEFAULT_CONCURRENCY_LIMIT, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        results[idx] = await asyncFn(items[idx], idx);
      } catch (workerErr) {
        results[idx] = {
          success: false,
          error: 'Error inesperado procesando la predicción de la parcela.',
          fallback: 'system_error'
        };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < safeLimit; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Obtiene predicciones para todas las parcelas activas de un usuario con concurrencia controlada.
 * @param {number} userId ID del usuario
 * @param {object} options Opciones de ejecución (concurrency: number)
 */
async function getPredictionsForUser(userId, options = {}) {
  const parcels = await db.dbAll(
    'SELECT * FROM parcels WHERE user_id = ? AND status = ?',
    [userId, 'activa']
  );
  if (!parcels || parcels.length === 0) return [];

  const concurrency = options.concurrency || DEFAULT_CONCURRENCY_LIMIT;
  return mapWithConcurrency(parcels, concurrency, async (parcel) => {
    const result = await getPredictionForParcel(parcel);
    return {
      parcel_id: parcel.id,
      parcel_name: parcel.name,
      ...result
    };
  });
}

/**
 * Cache de predicciones en weather_cache.
 */
async function cachePrediction(parcelId, data, options = {}) {
  // Protección estricta: ninguna escritura en base de datos durante pruebas a menos que se autorice explícitamente
  if (process.env.NODE_ENV === 'test' && !options.allowInTest) {
    return;
  }
  const cleanId = parseInt(parcelId, 10);
  if (isNaN(cleanId) || cleanId <= 0) return;

  if (!data || typeof data !== 'object') return;

  // Validación previa de metadatos geográficos indispensables
  if (data.latitude === undefined || data.longitude === undefined ||
      isNaN(Number(data.latitude)) || isNaN(Number(data.longitude))) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[CACHE_INVALID_COORDS] Parcela ${cleanId}: Coordenadas ausentes o inválidas en predicción.`);
    }
    return;
  }

  data.parcel_id = cleanId;

  // FASE 8L-G28: Coordinación transaccional con SELECT ... FOR UPDATE (anti-TOCTOU)
  try {
    await db.withTransaction(async (tx) => {
      const currentParcel = await tx.dbGet(
        'SELECT id, center_lat, center_lng, altitude_masl, geo_json FROM parcels WHERE id = ? FOR UPDATE',
        [cleanId]
      );

      // Si la parcela no existe (ej. eliminada de forma concurrente), descartar escritura
      if (!currentParcel) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_PARCEL_NOT_FOUND] Parcela ${cleanId}: Parcela inexistente. Escritura descartada.`);
        }
        return;
      }

      // Si la parcela carece de coordenadas válidas en base de datos, descartar escritura
      if (currentParcel.center_lat === null || currentParcel.center_lng === null ||
          isNaN(Number(currentParcel.center_lat)) || isNaN(Number(currentParcel.center_lng))) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_PARCEL_NO_GEO] Parcela ${cleanId}: Parcela sin coordenadas en base de datos. Escritura descartada.`);
        }
        return;
      }

      // Validación de identidad geográfica completa
      const latMismatch = Math.abs(Number(currentParcel.center_lat) - Number(data.latitude)) > 1e-4;
      const lngMismatch = Math.abs(Number(currentParcel.center_lng) - Number(data.longitude)) > 1e-4;
      const altMismatch = (currentParcel.altitude_masl !== null && currentParcel.altitude_masl !== undefined &&
                           data.altitude_masl !== null && data.altitude_masl !== undefined)
        ? Math.abs(Number(currentParcel.altitude_masl) - Number(data.altitude_masl)) > 50
        : false;

      // Validación de huella geográfica (polígono y geometría)
      let geoMismatch = false;
      if (data.geo_footprint) {
        const currentFootprint = getGeoFootprint(
          currentParcel.center_lat,
          currentParcel.center_lng,
          currentParcel.altitude_masl,
          currentParcel.geo_json
        );
        if (data.geo_footprint !== currentFootprint) {
          geoMismatch = true;
        }
      } else if (data.geo_json !== undefined && data.geo_json !== null) {
        const strDataGeo = typeof data.geo_json === 'string' ? data.geo_json : JSON.stringify(data.geo_json);
        const strCurrentGeo = typeof currentParcel.geo_json === 'string' ? currentParcel.geo_json : JSON.stringify(currentParcel.geo_json);
        if (strDataGeo !== strCurrentGeo) {
          geoMismatch = true;
        }
      }

      if (latMismatch || lngMismatch || altMismatch || geoMismatch) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_OBSOLETE_GEOGRAPHY] Parcela ${cleanId}: Predicción en vuelo descartada por desfase geográfico transaccional.`);
        }
        return; // Salir de la transacción sin persistir en weather_cache
      }

      // Geografía vigente confirmada bajo bloqueo exclusivo: persistir en weather_cache
      await tx.dbRun(
        "DELETE FROM weather_cache WHERE location = ? AND data_type = 'ml_prediction'",
        [`parcel_${cleanId}`]
      );

      await tx.dbRun(
        'INSERT INTO weather_cache (location, data_type, data_json) VALUES (?, ?, ?)',
        [`parcel_${cleanId}`, 'ml_prediction', JSON.stringify(data)]
      );
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('⚠️ Error transaccional cacheando predicción ML:', err.message);
    }
  }
}

/**
 * Consulta la predicción en caché verificando versión del modelo, identidad estricta y TTL diferenciado.
 * FASE 8L-G20: Compatible con objetos Date de PostgreSQL (TIMESTAMPTZ) y cadenas SQLite.
 * FASE 8L-G24: Valida coincidencia exacta de parcel_id y rechaza cachés que precedan la creación de la parcela.
 */
async function getCachedPrediction(parcelId, parcelCreatedAt = null, currentGeo = null) {
  const cleanId = parseInt(parcelId, 10);
  if (isNaN(cleanId) || cleanId <= 0) return null;

  let row;
  try {
    row = await db.dbGet(
      "SELECT data_json, fetched_at FROM weather_cache WHERE location = ? AND data_type = 'ml_prediction' ORDER BY fetched_at DESC LIMIT 1",
      [`parcel_${cleanId}`]
    );
  } catch (dbErr) {
    console.error(`[CACHE_DB_ERROR] Parcela ${cleanId}: Fallo al consultar weather_cache: ${dbErr.message}`);
    return null;
  }

  if (!row) {
    return null; // Registro inexistente (cache miss legítimo)
  }

  if (!row.data_json) {
    console.warn(`[CACHE_EMPTY_DATA] Parcela ${cleanId}: Registro sin data_json en weather_cache.`);
    return null;
  }

  let cachedData;
  try {
    cachedData = JSON.parse(row.data_json);
  } catch (jsonErr) {
    console.warn(`[CACHE_JSON_CORRUPT] Parcela ${cleanId}: JSON corrupto en weather_cache: ${jsonErr.message}`);
    return null;
  }

  if (!cachedData || typeof cachedData !== 'object') {
    console.warn(`[CACHE_INVALID_OBJECT] Parcela ${cleanId}: Payload de caché inválido.`);
    return null;
  }

  // Validación estricta de identidad de la parcela: si el payload tiene parcel_id, debe coincidir exactamente
  if (cachedData.parcel_id !== undefined && cachedData.parcel_id !== null) {
    if (Number(cachedData.parcel_id) !== cleanId) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[CACHE_PARCEL_MISMATCH] Parcela ${cleanId}: payload en caché pertenece a parcela ${cachedData.parcel_id}.`);
      }
      return null;
    }
  }

  // FASE 8L-G26 y FASE 8L-G28: Validación estricta de coherencia geográfica y de polígono.
  // Si se proveen coordenadas geográficas actuales, verificar que la predicción no pertenezca a otra ubicación
  if (currentGeo && (currentGeo.lat !== undefined || currentGeo.lng !== undefined)) {
    if (cachedData.latitude !== undefined && cachedData.longitude !== undefined) {
      const latDiff = Math.abs(Number(cachedData.latitude) - Number(currentGeo.lat));
      const lngDiff = Math.abs(Number(cachedData.longitude) - Number(currentGeo.lng));
      if (latDiff > 1e-4 || lngDiff > 1e-4) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_GEOGRAPHY_MISMATCH] Parcela ${cleanId}: Registro en caché (${cachedData.latitude}, ${cachedData.longitude}) no coincide con ubicación actual (${currentGeo.lat}, ${currentGeo.lng}). Descartando caché.`);
        }
        return null;
      }
    }
    if (currentGeo.altitude !== undefined && currentGeo.altitude !== null && cachedData.altitude_masl !== undefined && cachedData.altitude_masl !== null) {
      if (Math.abs(Number(cachedData.altitude_masl) - Number(currentGeo.altitude)) > 50) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_ALTITUDE_MISMATCH] Parcela ${cleanId}: Altitud en caché (${cachedData.altitude_masl}) difiere de altitud actual (${currentGeo.altitude}). Descartando caché.`);
        }
        return null;
      }
    }
    // FASE 8L-G28: Comprobación de huella de polígono GeoJSON
    if (currentGeo.geo_json !== undefined && cachedData.geo_footprint) {
      const expectedFootprint = getGeoFootprint(currentGeo.lat, currentGeo.lng, currentGeo.altitude, currentGeo.geo_json);
      if (cachedData.geo_footprint !== expectedFootprint) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[CACHE_FOOTPRINT_MISMATCH] Parcela ${cleanId}: Huella de polígono en caché difiere de geometría actual. Descartando caché.`);
        }
        return null;
      }
    }
  }

  // PASO 3: Validación estricta de versión del modelo
  // Se rechazan entradas sin versionado o con versiones antiguas/incompatibles (cache miss)
  const isNativeML = cachedData.model_version === EXPECTED_MODEL_VERSION;
  const isRuleFallback = cachedData.model_version === FALLBACK_RULES_VERSION;

  if (!isNativeML && !isRuleFallback) {
    if (process.env.NODE_ENV !== 'test') {
      console.info(`[CACHE_VERSION_MISMATCH] Parcela ${cleanId}: Versión incompatible (${cachedData.model_version || 'sin versión'}).`);
    }
    return null; // Versión incompatible o ausente -> cache miss sin borrar el registro SQL
  }

  // Parsear timestamp de fetched_at con normalización robusta (PostgreSQL Date, SQLite string, ISO 8601)
  const fetchedAt = parseCacheTimestamp(row.fetched_at);
  if (fetchedAt === null) {
    console.warn(`[CACHE_INVALID_DATE] Parcela ${cleanId}: Timestamp fetched_at inválido o no reconocido.`);
    return null;
  }

  // Validación estricta de creación de la parcela: la caché no puede preceder a la creación de la parcela
  if (parcelCreatedAt) {
    const parcelCreatedMs = parseCacheTimestamp(parcelCreatedAt);
    if (parcelCreatedMs !== null && fetchedAt < (parcelCreatedMs - 2000)) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[CACHE_PREDATES_PARCEL] Parcela ${cleanId}: Registro en caché (${new Date(fetchedAt).toISOString()}) precede la creación de la parcela (${new Date(parcelCreatedMs).toISOString()}). Descartando caché previa ajena.`);
      }
      return null;
    }
  }

  const ageMs = Date.now() - fetchedAt;
  if (ageMs < 0) {
    console.warn(`[CACHE_CLOCK_SKEW] Parcela ${cleanId}: Timestamp en el futuro detectado.`);
    return null; // Desviación de reloj
  }

  // PASO 4: TTL diferenciado
  // Inferencia ML nativa: máximo 60 minutos
  // Reglas de fallback: máximo 5 minutos
  const allowedTtlMs = isRuleFallback ? RULE_CACHE_DURATION_MS : ML_CACHE_DURATION_MS;

  if (ageMs >= allowedTtlMs) {
    return null; // Expirado por TTL -> cache miss legítimo
  }

  return cachedData;
}

/**
 * Recupera de forma segura el último registro de predicción en caché para una parcela,
 * verificando compatibilidad de versión, horizonte restante y antigüedad máxima (24h).
 * FASE 8L-G20: Compatible con objetos Date de PostgreSQL (TIMESTAMPTZ) y cadenas SQLite.
 * FASE 8L-G24: Valida coincidencia exacta de parcel_id y rechaza respaldos que precedan la creación de la parcela.
 * @param {number} parcelId ID de la parcela
 * @param {object} triggerError Error original que motivó el fallback (e.g. 429, timeout)
 * @param {string|Date|null} parcelCreatedAt Timestamp de creación de la parcela
 * @returns {object|null} Resultado formateado con is_stale: true o null si no es recuperable
 */
async function getStalePrediction(parcelId, triggerError = {}, parcelCreatedAt = null, currentGeo = null) {
  const cleanId = parseInt(parcelId, 10);
  if (isNaN(cleanId) || cleanId <= 0) return null;

  let row;
  try {
    row = await db.dbGet(
      "SELECT data_json, fetched_at FROM weather_cache WHERE location = ? AND data_type = 'ml_prediction' ORDER BY fetched_at DESC LIMIT 1",
      [`parcel_${cleanId}`]
    );
  } catch (dbErr) {
    console.error(`[STALE_CACHE_DB_ERROR] Parcela ${cleanId}: Error consultando weather_cache para respaldo: ${dbErr.message}`);
    return null;
  }

  if (!row) {
    return null; // Registro inexistente en base de datos
  }

  if (!row.data_json) {
    console.warn(`[STALE_CACHE_EMPTY] Parcela ${cleanId}: Registro sin data_json en respaldo.`);
    return null;
  }

  let cachedData;
  try {
    cachedData = JSON.parse(row.data_json);
  } catch (jsonErr) {
    console.warn(`[STALE_CACHE_JSON_CORRUPT] Parcela ${cleanId}: JSON corrupto en respaldo: ${jsonErr.message}`);
    return null;
  }

  if (!cachedData || typeof cachedData !== 'object') {
    return null;
  }

  // Validación estricta de identidad: si el payload tiene parcel_id, debe coincidir exactamente
  if (cachedData.parcel_id !== undefined && cachedData.parcel_id !== null) {
    if (Number(cachedData.parcel_id) !== cleanId) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[STALE_CACHE_PARCEL_MISMATCH] Parcela ${cleanId}: payload en respaldo pertenece a parcela ${cachedData.parcel_id}.`);
      }
      return null;
    }
  }

  // FASE 8L-G26 y FASE 8L-G28: Validación estricta de coherencia geográfica y de polígono en respaldo stale.
  if (currentGeo && (currentGeo.lat !== undefined || currentGeo.lng !== undefined)) {
    if (cachedData.latitude !== undefined && cachedData.longitude !== undefined) {
      const latDiff = Math.abs(Number(cachedData.latitude) - Number(currentGeo.lat));
      const lngDiff = Math.abs(Number(cachedData.longitude) - Number(currentGeo.lng));
      if (latDiff > 1e-4 || lngDiff > 1e-4) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[STALE_CACHE_GEOGRAPHY_MISMATCH] Parcela ${cleanId}: Respaldo en caché (${cachedData.latitude}, ${cachedData.longitude}) no coincide con ubicación actual (${currentGeo.lat}, ${currentGeo.lng}). Descartando respaldo.`);
        }
        return null;
      }
    }
    if (currentGeo.altitude !== undefined && currentGeo.altitude !== null && cachedData.altitude_masl !== undefined && cachedData.altitude_masl !== null) {
      if (Math.abs(Number(cachedData.altitude_masl) - Number(currentGeo.altitude)) > 50) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[STALE_CACHE_ALTITUDE_MISMATCH] Parcela ${cleanId}: Altitud en respaldo (${cachedData.altitude_masl}) difiere de altitud actual (${currentGeo.altitude}). Descartando respaldo.`);
        }
        return null;
      }
    }
    // FASE 8L-G28: Comprobación de huella de polígono GeoJSON
    if (currentGeo.geo_json !== undefined && cachedData.geo_footprint) {
      const expectedFootprint = getGeoFootprint(currentGeo.lat, currentGeo.lng, currentGeo.altitude, currentGeo.geo_json);
      if (cachedData.geo_footprint !== expectedFootprint) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[STALE_CACHE_FOOTPRINT_MISMATCH] Parcela ${cleanId}: Huella de polígono en respaldo difiere de geometría actual. Descartando respaldo.`);
        }
        return null;
      }
    }
  }

  // 1. Validación estricta de compatibilidad de versión del modelo
  const isNativeML = cachedData.model_version === EXPECTED_MODEL_VERSION;
  const isRuleFallback = cachedData.model_version === FALLBACK_RULES_VERSION;
  if (!isNativeML && !isRuleFallback) {
    if (process.env.NODE_ENV !== 'test') {
      console.info(`[STALE_CACHE_VERSION_REJECTED] Parcela ${cleanId}: Versión incompatible (${cachedData.model_version || 'sin versión'}).`);
    }
    return null; // Versión obsoleta o ausente -> rechazar
  }

  // 2. Parsear timestamp fetched_at con soporte universal (PostgreSQL Date, SQLite string, ISO 8601)
  const fetchedAt = parseCacheTimestamp(row.fetched_at);
  if (fetchedAt === null) {
    console.warn(`[STALE_CACHE_INVALID_DATE] Parcela ${cleanId}: Timestamp fetched_at inválido en respaldo.`);
    return null;
  }

  // Validación estricta de creación de la parcela: el respaldo no puede preceder a la creación de la parcela
  if (parcelCreatedAt) {
    const parcelCreatedMs = parseCacheTimestamp(parcelCreatedAt);
    if (parcelCreatedMs !== null && fetchedAt < (parcelCreatedMs - 2000)) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[STALE_CACHE_PREDATES_PARCEL] Parcela ${cleanId}: Respaldo en caché (${new Date(fetchedAt).toISOString()}) precede la creación de la parcela (${new Date(parcelCreatedMs).toISOString()}). Descartando respaldo ajeno.`);
      }
      return null;
    }
  }

  const ageMs = Date.now() - fetchedAt;
  if (ageMs < 0) {
    console.warn(`[STALE_CACHE_CLOCK_SKEW] Parcela ${cleanId}: Timestamp en el futuro detectado.`);
    return null; // Desviación de reloj
  }

  // 3. Antigüedad máxima absoluta (24 horas)
  if (ageMs > ML_STALE_CACHE_MAX_AGE_MS) {
    if (process.env.NODE_ENV !== 'test') {
      console.info(`[STALE_CACHE_EXPIRED_AGE] Parcela ${cleanId}: Antigüedad excede 24h (${Math.round(ageMs / 3600000)}h).`);
    }
    return null; // Excede 24 horas -> completamente vencido
  }

  // 4. Verificación de horizonte futuro restante
  if (cachedData.valid_until) {
    const validUntilMs = parseCacheTimestamp(cachedData.valid_until);
    if (validUntilMs !== null && Date.now() >= validUntilMs) {
      if (process.env.NODE_ENV !== 'test') {
        console.info(`[STALE_CACHE_HORIZON_EXPIRED] Parcela ${parcelId}: Horizonte valid_until vencido.`);
      }
      return null; // Horizonte vencido
    }
  }

  // Comprobar que en el horizonte aún haya fechas válidas (hoy o futuras)
  const todayStr = new Date().toISOString().split('T')[0];
  const summaryDates = cachedData.forecast_summary?.dates || [];
  if (summaryDates.length > 0) {
    const hasFutureOrToday = summaryDates.some(d => d >= todayStr);
    if (!hasFutureOrToday) {
      if (process.env.NODE_ENV !== 'test') {
        console.info(`[STALE_CACHE_NO_FUTURE_DATES] Parcela ${parcelId}: Todas las fechas del pronóstico son anteriores a hoy.`);
      }
      return null; // Todas las fechas corresponden a días transcurridos
    }
  }

  const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
  const ageHours = (ageMs / 3600000).toFixed(1);
  const staleReason = triggerError.rate_limited || triggerError.http_status === 429
    ? 'rate_limit_fallback'
    : triggerError.fallback === 'timeout'
      ? 'timeout_fallback'
      : 'service_unavailable';

  const timeLabel = ageMinutes < 60 ? `${ageMinutes} min` : `${ageHours} h`;
  const warningMessage = `Pronóstico emitido previamente (${timeLabel} atrás). Servicio meteorológico externo con alta demanda temporal.`;

  // Normalizar last_updated en formato ISO string
  const lastUpdatedStr = row.fetched_at instanceof Date
    ? row.fetched_at.toISOString()
    : (typeof row.fetched_at === 'string' ? row.fetched_at : new Date(fetchedAt).toISOString());

  const staleData = {
    ...cachedData,
    is_stale: true,
    source: 'cache_stale',
    last_updated: lastUpdatedStr,
    stale_age_minutes: ageMinutes,
    stale_reason: staleReason,
    coverage_warning: warningMessage
  };

  return {
    success: true,
    data: staleData,
    source: 'cache_stale'
  };
}

module.exports = {
  checkMLServiceHealth,
  getModelsStatus,
  getPredictionForParcel,
  getPredictionsForUser,
  getFallbackPrediction,
  validateCoordinates,
  fetchOpenMeteoForecast,
  executeOpenMeteoRequest,
  mapWithConcurrency,
  clearInFlightRequests,
  formatFallbackPredictions,
  cachePrediction,
  getCachedPrediction,
  getStalePrediction,
  getGeoFootprint,
  parseCacheTimestamp,
  parseRetryAfter,
  tripRateLimit,
  clearRateLimit,
  isRateLimitActive,
  getRateLimitStatus,
  EXPECTED_MODEL_VERSION,
  FALLBACK_RULES_VERSION,
  ML_CACHE_DURATION_MS,
  RULE_CACHE_DURATION_MS,
  ML_STALE_CACHE_MAX_AGE_MS,
  ML_RATE_LIMIT_DEFAULT_COOLDOWN_MS,
  ML_RATE_LIMIT_MAX_COOLDOWN_MS,
  ML_MAX_RETRY_WAIT_MS,
  ML_REQUEST_TIMEOUT_MS,
  ML_RETRY_TIMEOUT_MS,
  ML_MAX_RETRIES,
  DEFAULT_CONCURRENCY_LIMIT,
  getWeatherMetrics: weatherCacheService.getWeatherMetrics,
  resetWeatherMetrics: weatherCacheService.resetWeatherMetrics
};
