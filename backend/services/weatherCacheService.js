/**
 * AgroPasco Digital — Servicio de Caché Meteorológica Compartida y Observabilidad
 * ==============================================================================
 * Centraliza la gestión de datos meteorológicos de Open-Meteo para toda la plataforma:
 *  - Deduplicación espacial por celdas geográficas (grid rounding ~1.1 km)
 *  - Reutilización de pronósticos compartidos entre Monitoreo ML, Clima y Asesoría
 *  - Deduplicación de peticiones concurrentes idénticas (Single-Flight Pattern)
 *  - Persistencia en tabla weather_cache existente (sin migraciones de BD)
 *  - Telemetría y observabilidad de consumo, aciertos de caché y errores 429
 *  - Mensajería amigable para el agricultor (sin fuga de errores técnicos internos)
 */

'use strict';

const db = require('../config/database');

// ===== CONFIGURACIÓN Y CONSTANTES =====
const SHARED_WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutos de vigencia para pronóstico compartido
const SHARED_WEATHER_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Hasta 24 horas como respaldo stale seguro
const GRID_PRECISION_DECIMALS = 2; // ~1.1 km a latitud -10° (precisión óptima para modelos ERA5/GFS)
const MAX_COMPATIBLE_ALTITUDE_DIFF_METERS = 150; // Umbral agronómico de seguridad (~1.0 °C gradiente vertical andino)

// ===== CONTROL DE ENTORNO DE PRUEBAS =====
let _testModeOverride = false;

function setTestModeOverride(val) {
  _testModeOverride = Boolean(val);
}

// ===== ALMACENES EN MEMORIA =====
const _sharedMemoryCache = new Map(); // key -> { forecast, fetchedAt, lat, lng, altitude, scope }
const _inFlightGridPromises = new Map(); // key -> Promise

// ===== OBSERVABILIDAD Y TELEMETRÍA INTERNA =====
const _metrics = {
  outgoingRequests: 0,
  cacheHits: 0,
  inFlightCoalesced: 0,
  http429Errors: 0,
  circuitBreakerBlocks: 0,
  staleFallbacksServed: 0,
  altitudeIncompatibleCount: 0,
  requestsByModule: {
    ml: 0,
    weather: 0,
    advisory: 0,
    parcels: 0,
    other: 0
  },
  lastSuccessTimestamp: null,
  lastFailureTimestamp: null,
  lastFailureReason: null
};

/**
 * Calcula la clave espacial de celda geográfica y banda altitudinal a partir de coordenadas, altitud y alcance.
 * @param {number|string} lat
 * @param {number|string} lng
 * @param {number|string|null} [altitude=null] Altitud en msnm para segmentación topográfica
 * @param {string} [scope='standard'] Tipo o alcance de variables requeridas
 * @returns {string} Clave normalizada e.g. "geo_-10.67_-76.26_alt4350"
 */
function getGridKey(lat, lng, altitude = null, scope = 'standard') {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) {
    return 'geo_default_pasco';
  }
  const baseKey = `geo_${numLat.toFixed(GRID_PRECISION_DECIMALS)}_${numLng.toFixed(GRID_PRECISION_DECIMALS)}`;

  let altSuffix = '';
  if (altitude !== null && altitude !== undefined && !isNaN(Number(altitude))) {
    const numAlt = Number(altitude);
    const altBand = Math.round(numAlt / MAX_COMPATIBLE_ALTITUDE_DIFF_METERS) * MAX_COMPATIBLE_ALTITUDE_DIFF_METERS;
    altSuffix = `_alt${altBand}`;
  }

  const scopeSuffix = (scope && scope !== 'standard') ? `_${scope}` : '';
  return `${baseKey}${altSuffix}${scopeSuffix}`;
}

/**
 * Comprueba si un pronóstico crudo posee la estructura y variables mínimas para ML.
 */
function isForecastCompatibleWithMl(forecast) {
  if (!forecast || typeof forecast !== 'object') return false;
  const daily = forecast.daily;
  const hourly = forecast.hourly;
  if (!daily || !hourly) return false;
  if (!Array.isArray(daily.time) || daily.time.length < 3) return false;
  if (!Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min)) return false;
  if (!Array.isArray(hourly.temperature_2m)) return false;
  return true;
}

/**
 * Evalúa si la diferencia altitudinal entre parcela y referencia es segura.
 */
function checkAltitudeCompatibility(targetAlt, refAlt, maxDiff = MAX_COMPATIBLE_ALTITUDE_DIFF_METERS) {
  if (targetAlt === null || targetAlt === undefined || isNaN(Number(targetAlt))) {
    return { compatible: true, diff: 0 };
  }
  if (refAlt === null || refAlt === undefined || isNaN(Number(refAlt))) {
    return { compatible: true, diff: 0 };
  }
  const diff = Math.abs(Number(targetAlt) - Number(refAlt));
  return {
    compatible: diff <= maxDiff,
    diff: Math.round(diff)
  };
}

/**
 * Registra una métrica de consumo u observabilidad meteorológica.
 * @param {string} metricName
 * @param {object} [details]
 */
function recordMetric(metricName, details = {}) {
  if (metricName === 'outgoing') {
    _metrics.outgoingRequests++;
    if (details.module && _metrics.requestsByModule[details.module] !== undefined) {
      _metrics.requestsByModule[details.module]++;
    }
  } else if (metricName === 'cache_hit') {
    _metrics.cacheHits++;
  } else if (metricName === 'coalesced') {
    _metrics.inFlightCoalesced++;
  } else if (metricName === 'http_429') {
    _metrics.http429Errors++;
    _metrics.lastFailureTimestamp = new Date().toISOString();
    _metrics.lastFailureReason = details.reason || 'HTTP 429 Too Many Requests';
  } else if (metricName === 'circuit_breaker_block') {
    _metrics.circuitBreakerBlocks++;
  } else if (metricName === 'stale_served') {
    _metrics.staleFallbacksServed++;
  } else if (metricName === 'altitude_incompatible') {
    _metrics.altitudeIncompatibleCount++;
  } else if (metricName === 'success') {
    _metrics.lastSuccessTimestamp = new Date().toISOString();
  }
}

/**
 * Retorna una copia de solo lectura de las métricas de telemetría.
 * Seguro para inspección diagnóstica interna (cero PII, cero credenciales).
 */
function getWeatherMetrics() {
  return {
    ..._metrics,
    requestsByModule: { ..._metrics.requestsByModule },
    activeInFlightCount: _inFlightGridPromises.size,
    memoryCacheEntriesCount: _sharedMemoryCache.size,
    timestamp: new Date().toISOString()
  };
}

/**
 * Restablece las métricas en memoria (útil en suites de pruebas).
 */
function resetWeatherMetrics() {
  _metrics.outgoingRequests = 0;
  _metrics.cacheHits = 0;
  _metrics.inFlightCoalesced = 0;
  _metrics.http429Errors = 0;
  _metrics.circuitBreakerBlocks = 0;
  _metrics.staleFallbacksServed = 0;
  _metrics.altitudeIncompatibleCount = 0;
  _metrics.requestsByModule = { ml: 0, weather: 0, advisory: 0, parcels: 0, other: 0 };
  _metrics.lastSuccessTimestamp = null;
  _metrics.lastFailureTimestamp = null;
  _metrics.lastFailureReason = null;
  _sharedMemoryCache.clear();
  _inFlightGridPromises.clear();
}

/**
 * Parsea un timestamp de forma robusta soportando Date de PostgreSQL, strings SQLite o ISO.
 */
function parseTimestamp(val) {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? null : parsed;
}

/**
 * Consulta el pronóstico crudo compartido desde memoria o base de datos PostgreSQL/SQLite,
 * verificando rigurosamente compatibilidad de altitud y completitud de variables para ML.
 *
 * @param {number|string} lat
 * @param {number|string} lng
 * @param {object} [options]
 * @param {boolean} [options.allowStale=false] Permitir respaldo stale hasta 24h
 * @param {number} [options.customTtlMs] TTL personalizado en milisegundos
 * @param {number|null} [options.altitude] Altitud de la parcela en msnm
 * @param {number} [options.maxElevationDiff=150] Máxima diferencia de elevación permitida
 * @param {boolean} [options.requireMlFeatures=false] Exige variables completas para ML
 * @param {string} [options.scope] 'standard' o 'ml_full'
 * @returns {Promise<object|null>} Pronóstico validado con metadatos de altitud o null
 */
async function getSharedForecast(lat, lng, options = {}) {
  // En entorno de prueba aislado (NODE_ENV=test), no reutilizar caché compartida a menos que el test lo autorice
  if (process.env.NODE_ENV === 'test' && !options.allowInTest && !_testModeOverride) {
    return null;
  }

  const targetAltitude = options.altitude !== undefined && options.altitude !== null && !isNaN(Number(options.altitude))
    ? Number(options.altitude)
    : null;
  const maxElevationDiff = options.maxElevationDiff || MAX_COMPATIBLE_ALTITUDE_DIFF_METERS;
  const requireMl = Boolean(options.requireMlFeatures);
  const scope = options.scope || (requireMl ? 'ml_full' : 'standard');

  const ttlMs = options.customTtlMs || SHARED_WEATHER_CACHE_TTL_MS;
  const allowStale = Boolean(options.allowStale);
  const now = Date.now();

  // Candidatas en orden de especificidad: 1) específica con altitud y scope, 2) específica solo con altitud, 3) base regional
  const keysToTry = [];
  if (targetAltitude !== null) {
    keysToTry.push(getGridKey(lat, lng, targetAltitude, scope));
    if (scope !== 'standard') {
      keysToTry.push(getGridKey(lat, lng, targetAltitude, 'standard'));
    }
  }
  keysToTry.push(getGridKey(lat, lng, null, scope));
  keysToTry.push(getGridKey(lat, lng));

  const uniqueKeys = Array.from(new Set(keysToTry));

  function evaluateEntry(entry, sourceName) {
    if (!entry || !entry.forecast) return null;
    const forecast = entry.forecast;

    // 1. Si se requieren features de ML, comprobar completitud
    if (requireMl && !isForecastCompatibleWithMl(forecast)) {
      return null;
    }

    // 2. Comprobar compatibilidad de altitud
    const refElevation = (typeof forecast.elevation === 'number' && Number.isFinite(forecast.elevation))
      ? forecast.elevation
      : entry.altitude;

    if (targetAltitude !== null && refElevation !== undefined && refElevation !== null) {
      const altCheck = checkAltitudeCompatibility(targetAltitude, refElevation, maxElevationDiff);
      if (!altCheck.compatible) {
        recordMetric('altitude_incompatible', { targetAlt: targetAltitude, refAlt: refElevation, diff: altCheck.diff });
        return null;
      }
    }

    // 3. Comprobar vigencia temporal
    const ageMs = now - entry.fetchedAt;
    if (ageMs < 0) return null;

    const diff = (targetAltitude !== null && refElevation !== undefined && refElevation !== null)
      ? Math.abs(targetAltitude - refElevation)
      : 0;

    if (ageMs < ttlMs) {
      recordMetric('cache_hit');
      return {
        valid: true,
        isStale: false,
        forecast: forecast,
        ageMinutes: Math.round(ageMs / 60000),
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        source: sourceName + '_fresh',
        reference_elevation: refElevation,
        altitude_diff: Math.round(diff)
      };
    } else if (allowStale && ageMs < SHARED_WEATHER_STALE_MAX_AGE_MS) {
      recordMetric('stale_served');
      return {
        valid: true,
        isStale: true,
        forecast: forecast,
        ageMinutes: Math.round(ageMs / 60000),
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        source: sourceName + '_stale',
        reference_elevation: refElevation,
        altitude_diff: Math.round(diff)
      };
    }
    return null;
  }

  // 1. Consulta en caché de memoria rápida (Nivel 1)
  for (const k of uniqueKeys) {
    if (_sharedMemoryCache.has(k)) {
      const memEntry = _sharedMemoryCache.get(k);
      const evaluated = evaluateEntry(memEntry, 'shared_memory');
      if (evaluated) return evaluated;
    }
  }

  // 2. Consulta en base de datos PostgreSQL / SQLite (Nivel 2)
  for (const k of uniqueKeys) {
    try {
      const row = await db.dbGet(
        "SELECT data_json, fetched_at FROM weather_cache WHERE location = ? AND data_type = 'raw_forecast' ORDER BY fetched_at DESC LIMIT 1",
        [k]
      );

      if (row && row.data_json) {
        const fetchedAtMs = parseTimestamp(row.fetched_at);
        if (fetchedAtMs !== null) {
          let parsedForecast;
          try {
            parsedForecast = JSON.parse(row.data_json);
          } catch (_) {
            parsedForecast = null;
          }

          if (parsedForecast && typeof parsedForecast === 'object') {
            const dbEntry = {
              forecast: parsedForecast,
              fetchedAt: fetchedAtMs,
              lat: Number(lat),
              lng: Number(lng),
              altitude: parsedForecast.elevation || targetAltitude,
              scope
            };
            _sharedMemoryCache.set(k, dbEntry);
            const evaluated = evaluateEntry(dbEntry, 'shared_db');
            if (evaluated) return evaluated;
          }
        }
      }
    } catch (_) {
      // Degradación silenciosa a cache miss
    }
  }

  return null;
}

/**
 * Guarda el pronóstico crudo compartido en memoria y en la tabla weather_cache,
 * indexando tanto por cuadrícula regional como por celda topográfica altitudinal.
 *
 * @param {number|string} lat
 * @param {number|string} lng
 * @param {object} forecast Datos JSON crudos de Open-Meteo
 * @param {object} [options]
 * @param {boolean} [options.allowInTest=false]
 * @param {number|null} [options.altitude]
 * @param {string} [options.scope]
 */
async function saveSharedForecast(lat, lng, forecast, options = {}) {
  if (!forecast || typeof forecast !== 'object') return;
  // En entorno de prueba aislado (NODE_ENV=test), no persistir ni en memoria ni en BD salvo autorización explícita
  if (process.env.NODE_ENV === 'test' && !options.allowInTest && !_testModeOverride) {
    return;
  }
  const now = Date.now();
  const altitude = options.altitude || forecast.elevation || null;
  const scope = options.scope || (isForecastCompatibleWithMl(forecast) ? 'ml_full' : 'standard');

  const baseKey = getGridKey(lat, lng);
  const altKey = altitude !== null ? getGridKey(lat, lng, altitude, scope) : null;

  const entryData = {
    forecast,
    fetchedAt: now,
    lat: Number(lat),
    lng: Number(lng),
    altitude: altitude !== null ? Number(altitude) : null,
    scope
  };

  // 1. Guardar en memoria (ambas claves si aplica)
  _sharedMemoryCache.set(baseKey, entryData);
  if (altKey && altKey !== baseKey) {
    _sharedMemoryCache.set(altKey, entryData);
  }

  // 2. Persistir en tabla weather_cache existente
  const keysToSave = altKey && altKey !== baseKey ? [baseKey, altKey] : [baseKey];
  for (const k of keysToSave) {
    try {
      await db.dbRun(
        "DELETE FROM weather_cache WHERE location = ? AND data_type = 'raw_forecast'",
        [k]
      );

      await db.dbRun(
        "INSERT INTO weather_cache (location, data_type, data_json) VALUES (?, 'raw_forecast', ?)",
        [k, JSON.stringify(forecast)]
      );
    } catch (dbErr) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[SHARED_WEATHER_CACHE_WRITE_WARN] Error al persistir en weather_cache: ${dbErr.message}`);
      }
    }
  }
}

/**
 * Ejecuta una consulta asíncrona con coalescencia en vuelo (Single-Flight Pattern).
 * Si ya hay una promesa idéntica ejecutándose para el mismo grid, todas las llamadas
 * concurrentes esperan y comparten el mismo resultado, evitando ráfagas HTTP a Open-Meteo.
 *
 * @param {string} inFlightKey Clave única de la operación en vuelo
 * @param {Function} fetchFn Función asíncrona que ejecuta la solicitud externa
 * @returns {Promise<any>}
 */
async function singleFlight(inFlightKey, fetchFn) {
  if (_inFlightGridPromises.has(inFlightKey)) {
    recordMetric('coalesced');
    return _inFlightGridPromises.get(inFlightKey);
  }

  const promise = (async () => {
    try {
      return await fetchFn();
    } finally {
      _inFlightGridPromises.delete(inFlightKey);
    }
  })();

  _inFlightGridPromises.set(inFlightKey, promise);
  return promise;
}

/**
 * Transforma errores técnicos de cuotas o límites a un estado amigable para el agricultor,
 * sin exponer códigos HTTP ni nombres de circuit breaker.
 *
 * @param {object} errorObj
 * @returns {object} { isPending: boolean, userMessage: string, technicalDetails: string }
 */
function formatWeatherStateForFarmer(errorObj = {}) {
  const is429 = errorObj.http_status === 429 || errorObj.rate_limited || (errorObj.error || '').includes('Límite de solicitudes');
  const isTimeout = errorObj.fallback === 'timeout' || (errorObj.error || '').includes('Tiempo de espera');

  if (is429) {
    return {
      status: 'pending',
      isPending: true,
      userTitle: 'Información en preparación',
      userMessage: 'Estamos preparando la información meteorológica de esta parcela. Estará disponible en cuanto se complete la sincronización.',
      friendlyBadge: '🌱 Preparando datos',
      technicalReason: errorObj.error || 'Proveedor meteorológico con límite temporal activo.'
    };
  }

  if (isTimeout) {
    return {
      status: 'temporary_unavailable',
      isPending: false,
      userTitle: 'Reintentando conexión',
      userMessage: 'El servicio meteorológico está tardando más de lo habitual en responder. Se reintentará en la siguiente actualización programada.',
      friendlyBadge: '⏳ Reintentando',
      technicalReason: errorObj.error || 'Tiempo de espera agotado.'
    };
  }

  return {
    status: 'unavailable',
    isPending: false,
    userTitle: 'Información no disponible',
    userMessage: 'No se pudo obtener el pronóstico meteorológico para esta ubicación en este momento.',
    friendlyBadge: '⚠️ No disponible',
    technicalReason: errorObj.error || 'Error no especificado al consultar servicio meteorológico.'
  };
}

function clearSharedCache() {
  _sharedMemoryCache.clear();
  _inFlightGridPromises.clear();
}

module.exports = {
  getGridKey,
  getSharedForecast,
  saveSharedForecast,
  singleFlight,
  recordMetric,
  getWeatherMetrics,
  resetWeatherMetrics,
  formatWeatherStateForFarmer,
  setTestModeOverride,
  checkAltitudeCompatibility,
  isForecastCompatibleWithMl,
  clearSharedCache,
  MAX_COMPATIBLE_ALTITUDE_DIFF_METERS,
  SHARED_WEATHER_CACHE_TTL_MS,
  SHARED_WEATHER_STALE_MAX_AGE_MS,
  GRID_PRECISION_DECIMALS
};
