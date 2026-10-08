/**
 * AgroPasco — Servicio de Machine Learning (Cliente Node.js)
 * ============================================================
 * Se comunica con el servicio Python FastAPI para obtener predicciones ML.
 * Incluye fallback a sistema de reglas si el servicio ML no está disponible.
 * Cache por parcela para evitar consultas repetidas.
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8100';
const ML_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hora
const ML_REQUEST_TIMEOUT_MS = 15000; // 15 segundos

/**
 * Verifica si el servicio ML está disponible
 */
async function checkMLServiceHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${ML_SERVICE_URL}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Obtiene el estado de los modelos ML
 */
async function getModelsStatus() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${ML_SERVICE_URL}/models/status`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (err) {
    console.warn('⚠️ ML Service no disponible para consulta de modelos:', err.message);
    return null;
  }
}

/**
 * Valida estrictamente un par de coordenadas geográficas (latitud, longitud).
 * Rechaza null, undefined, cadenas vacías o con espacios, NaN, Infinity, tipos no numéricos,
 * cadenas parcialmente numéricas (ej. "12abc", "abc12") y valores fuera de rangos geográficos.
 * Acepta números finitos y cadenas numéricas válidas (positivos, negativos, decimales).
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
      // Rechazar NaN, Infinity, cadenas con caracteres alfabéticos o parcialmente numéricos como "12abc"
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

/**
 * Solicita predicción ML para una parcela
 */
async function getPredictionForParcel(parcel) {
  if (!parcel) {
    return {
      success: false,
      error: 'Datos de parcela no proporcionados.',
      fallback: 'no_coordinates'
    };
  }

  // Validación estricta de coordenadas (sin retornar valores crudos no validados)
  const coordValidation = validateCoordinates(parcel.center_lat, parcel.center_lng);
  if (!coordValidation.valid) {
    return {
      success: false,
      error: coordValidation.error,
      fallback: coordValidation.fallback
    };
  }
  const { lat, lng } = coordValidation;

  // Check cache first
  const cached = await getCachedPrediction(parcel.id);
  if (cached) {
    return { success: true, data: cached, source: 'cache' };
  }

  // Try ML service
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);

    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel_id: parcel.id,
        parcel_name: parcel.name || '',
        latitude: lat,
        longitude: lng,
        altitude_masl: parcel.altitude_masl || null,
        crop_type: parcel.crop_type || null,
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      
      // Cache the result
      await cachePrediction(parcel.id, data);
      
      return { success: true, data, source: 'ml_service' };
    } else {
      const errBody = await response.json().catch(() => ({}));
      console.warn(`⚠️ ML Service error for parcel ${parcel.id}:`, errBody);
      return {
        success: false,
        error: errBody.detail || 'Error del servicio ML',
        fallback: 'ml_error'
      };
    }
  } catch (err) {
    console.warn(`⚠️ ML Service no disponible para parcela ${parcel.id}:`, err.message);
    
    // Fallback: reglas básicas usando Open-Meteo directo
    return await getFallbackPrediction(parcel);
  }
}

/**
 * Predicción de fallback basada en reglas cuando el servicio ML no está disponible.
 * Consulta Open-Meteo directamente desde Node.js.
 */
async function getFallbackPrediction(parcel) {
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

    const altitude = parcel.altitude_masl || null;

    // Construcción segura de URL con codificación adecuada de parámetros
    const openMeteoUrl = new URL('https://api.open-meteo.com/v1/forecast');
    openMeteoUrl.searchParams.set('latitude', String(lat));
    openMeteoUrl.searchParams.set('longitude', String(lng));
    openMeteoUrl.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,wind_speed_10m_max'
    );
    openMeteoUrl.searchParams.set(
      'hourly',
      'temperature_2m,relative_humidity_2m,precipitation'
    );
    openMeteoUrl.searchParams.set('timezone', 'America/Lima');
    openMeteoUrl.searchParams.set('forecast_days', '3');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;

    try {
      response = await fetch(openMeteoUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AgroPasco-Platform/1.0 (Climate-Monitoring)'
        }
      });
    } catch (netErr) {
      clearTimeout(timeout);
      const isTimeout = netErr.name === 'AbortError';
      const errorTag = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
      console.error(`[OPEN_METEO_${errorTag}] Parcela ${parcel.id}: ${isTimeout ? 'Tiempo de espera de 10s agotado' : netErr.message}`);
      return {
        success: false,
        error: isTimeout
          ? 'Tiempo de espera agotado al consultar el pronóstico meteorológico.'
          : 'Error de conexión con el servicio meteorológico externo.',
        fallback: isTimeout ? 'timeout' : 'network_error'
      };
    }
    clearTimeout(timeout);

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

      console.error(`[OPEN_METEO_HTTP_ERROR] Parcela ${parcel.id} — HTTP ${response.status} (${response.statusText}): ${technicalReason}`);

      return {
        success: false,
        error: response.status === 429
          ? 'Límite de solicitudes alcanzado en el servicio meteorológico. Intente más tarde.'
          : response.status === 403
            ? 'Acceso denegado por el servicio meteorológico externo.'
            : response.status >= 500
              ? 'Servicio meteorológico externo no disponible temporalmente.'
              : 'No se pudo obtener pronóstico meteorológico para esta ubicación.',
        fallback: 'api_error',
        http_status: response.status
      };
    }

    let forecast;
    try {
      forecast = await response.json();
    } catch (parseErr) {
      console.error(`[OPEN_METEO_PARSE_ERROR] Parcela ${parcel.id}: Error al parsear JSON de respuesta.`);
      return {
        success: false,
        error: 'Respuesta inválida recibida del servicio meteorológico externo.',
        fallback: 'api_error'
      };
    }
    const daily = forecast.daily || {};
    const dates = daily.time || [];
    
    const predictions = [];

    // Evaluate each day
    for (let i = 0; i < dates.length; i++) {
      const tempMin = daily.temperature_2m_min?.[i] ?? 999;
      const tempMax = daily.temperature_2m_max?.[i] ?? 0;
      const precip = daily.precipitation_sum?.[i] ?? 0;
      const wind = daily.wind_speed_10m_max?.[i] ?? 0;

      // Frost risk (rule-based)
      let frostScore = 0;
      if (tempMin <= -5) frostScore = 90;
      else if (tempMin <= -2) frostScore = 70;
      else if (tempMin <= 0) frostScore = 50;
      else if (tempMin <= 3) frostScore = 25;
      if (wind < 5) frostScore += 10;

      // Heavy rain risk (rule-based)
      let rainScore = 0;
      if (precip >= 50) rainScore = 85;
      else if (precip >= 20) rainScore = 55;
      else if (precip >= 10) rainScore = 30;

      predictions.push({
        date: dates[i],
        frost: {
          score: Math.min(frostScore, 100),
          level: frostScore >= 60 ? 'high' : frostScore >= 30 ? 'moderate' : frostScore >= 10 ? 'low' : 'none',
        },
        heavy_rain: {
          score: Math.min(rainScore, 100),
          level: rainScore >= 60 ? 'high' : rainScore >= 30 ? 'moderate' : rainScore >= 10 ? 'low' : 'none',
        },
        snow: {
          score: tempMin <= 0 && precip > 0 && altitude > 4000 ? 30 : 0,
          level: tempMin <= 0 && precip > 0 && altitude > 4000 ? 'moderate' : 'none',
        },
        hail: {
          score: 0,
          level: 'model_unavailable',
        },
        raw: { tempMin, tempMax, precip, wind },
      });
    }

    const result = {
      parcel_id: parcel.id,
      parcel_name: parcel.name || '',
      latitude: lat,
      longitude: lng,
      altitude_masl: altitude,
      predictions: formatFallbackPredictions(predictions),
      forecast_summary: {
        days: dates.length,
        dates: dates,
        temp_min: daily.temperature_2m_min || [],
        temp_max: daily.temperature_2m_max || [],
        precipitation: daily.precipitation_sum || [],
        elevation_model: forecast.elevation || null,
      },
      issued_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      data_source: 'Open-Meteo Forecast + Reglas AgroPasco (ML no disponible)',
      coverage_warning: null,
    };

    await cachePrediction(parcel.id, result);

    return { success: true, data: result, source: 'fallback_rules' };
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
 * Formatea las predicciones de fallback al formato estándar
 */
function formatFallbackPredictions(dailyPredictions) {
  const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
  const result = [];

  for (const phenomenon of phenomena) {
    // Get worst case across forecast days
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

    // Collect relevant variables from first day
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
        'Los umbrales son configurables y documentados.',
      ],
    });
  }

  return result;
}

/**
 * Obtiene predicciones para todas las parcelas de un usuario
 */
async function getPredictionsForUser(userId) {
  const parcels = await dbAll(
    'SELECT * FROM parcels WHERE user_id = ? AND status = ?',
    [userId, 'activa']
  );

  const predictions = [];
  for (const parcel of parcels) {
    const result = await getPredictionForParcel(parcel);
    predictions.push({
      parcel_id: parcel.id,
      parcel_name: parcel.name,
      ...result,
    });
  }

  return predictions;
}

/**
 * Cache de predicciones en weather_cache
 */
async function cachePrediction(parcelId, data) {
  try {
    // Delete old cache for this parcel
    await dbRun(
      "DELETE FROM weather_cache WHERE location = ? AND data_type = 'ml_prediction'",
      [`parcel_${parcelId}`]
    );
    
    await dbRun(
      'INSERT INTO weather_cache (location, data_type, data_json) VALUES (?, ?, ?)',
      [`parcel_${parcelId}`, 'ml_prediction', JSON.stringify(data)]
    );
  } catch (err) {
    console.warn('⚠️ Error cacheando predicción ML:', err.message);
  }
}

async function getCachedPrediction(parcelId) {
  try {
    const row = await dbGet(
      "SELECT data_json, fetched_at FROM weather_cache WHERE location = ? AND data_type = 'ml_prediction' ORDER BY fetched_at DESC LIMIT 1",
      [`parcel_${parcelId}`]
    );
    if (!row || !row.fetched_at || !row.data_json) {
      return null;
    }
    const dateStr = row.fetched_at.includes('T')
      ? (row.fetched_at.endsWith('Z') ? row.fetched_at : row.fetched_at + 'Z')
      : row.fetched_at.replace(' ', 'T') + 'Z';
    const fetchedAt = new Date(dateStr).getTime();
    if (!isNaN(fetchedAt) && (Date.now() - fetchedAt) >= 0 && (Date.now() - fetchedAt) < ML_CACHE_DURATION_MS) {
      return JSON.parse(row.data_json);
    }
  } catch (err) {
    // Cache miss is ok
  }
  return null;
}

module.exports = {
  checkMLServiceHealth,
  getModelsStatus,
  getPredictionForParcel,
  getPredictionsForUser,
  getFallbackPrediction,
  validateCoordinates,
};
