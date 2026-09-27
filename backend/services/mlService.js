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
 * Solicita predicción ML para una parcela
 */
async function getPredictionForParcel(parcel) {
  if (!parcel || !parcel.center_lat || !parcel.center_lng) {
    return {
      success: false,
      error: 'Parcela sin coordenadas válidas.',
      fallback: 'no_coordinates'
    };
  }

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
        latitude: parcel.center_lat,
        longitude: parcel.center_lng,
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
    const lat = parcel.center_lat;
    const lng = parcel.center_lng;
    const altitude = parcel.altitude_masl || null;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,wind_speed_10m_max` +
      `&hourly=temperature_2m,relative_humidity_2m,precipitation` +
      `&timezone=America/Lima&forecast_days=3`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: 'No se pudo obtener pronóstico de Open-Meteo',
        fallback: 'api_error'
      };
    }

    const forecast = await response.json();
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
};
