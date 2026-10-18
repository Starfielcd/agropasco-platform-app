/**
 * AgroPasco — Controlador de Machine Learning Meteorológico
 * ===========================================================
 * Endpoints para predicciones ML por parcela, estado de modelos,
 * y panel administrativo del sistema ML.
 */

const { dbGet, dbAll, dbRun } = require('../config/database');
const mlService = require('../services/mlService');
const { getPredictionForParcel, getPredictionsForUser, checkMLServiceHealth, getModelsStatus, mapWithConcurrency } = mlService;
const { createNotification, createWeatherAlertAtomically } = require('../services/notificationService');

/**
 * GET /api/ml/predict/:parcelId
 * Predicción ML para una parcela específica
 */
async function predictForParcel(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    
    // Verificar que la parcela existe y el usuario tiene acceso
    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    // Check access: owner, advisor, or admin
    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'No tienes permiso para consultar esta parcela.' });
    }

    if (!parcel.center_lat || !parcel.center_lng) {
      return res.status(400).json({
        success: false,
        error: 'La parcela no tiene coordenadas registradas. Edita la parcela para agregar su ubicación en el mapa.',
      });
    }

    const result = await getPredictionForParcel(parcel);

    if (!result.success) {
      return res.status(502).json({
        success: false,
        error: result.error || 'No se pudo generar la predicción.',
        fallback: result.fallback,
      });
    }

    res.json({
      success: true,
      data: result.data,
      source: result.source,
    });
  } catch (err) {
    console.error('Error en predicción ML:', err);
    res.status(500).json({ success: false, error: 'Error al generar predicción meteorológica.' });
  }
}

/**
 * GET /api/ml/predictions
 * Predicciones ML para todas las parcelas del usuario autenticado
 */
async function predictionsForUser(req, res) {
  try {
    const userId = req.user.id;
    const results = await getPredictionsForUser(userId);

    res.json({
      success: true,
      data: results,
      total: results.length,
    });
  } catch (err) {
    console.error('Error en predicciones del usuario:', err);
    res.status(500).json({ success: false, error: 'Error al obtener predicciones.' });
  }
}

/**
 * GET /api/ml/predictions/all
 * Predicciones para todas las parcelas (advisor/admin)
 */
async function allPredictions(req, res) {
  try {
    const parcels = await dbAll(`
      SELECT p.*, u.name as farmer_name, u.location as farmer_location
      FROM parcels p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.status = 'activa' AND p.center_lat IS NOT NULL AND p.center_lng IS NOT NULL
      ORDER BY p.updated_at DESC
    `);

    const predictions = await mlService.mapWithConcurrency(parcels, 2, async (parcel) => {
      const result = await mlService.getPredictionForParcel(parcel);
      return {
        parcel_id: parcel.id,
        parcel_name: parcel.name,
        farmer_name: parcel.farmer_name,
        farmer_location: parcel.farmer_location,
        altitude_masl: parcel.altitude_masl,
        crop_type: parcel.crop_type,
        ...result,
      };
    });

    res.json({
      success: true,
      data: predictions,
      total: predictions.length,
    });
  } catch (err) {
    console.error('Error en predicciones globales:', err);
    res.status(500).json({ success: false, error: 'Error al obtener predicciones.' });
  }
}

/**
 * GET /api/ml/models/status
 * Estado de los modelos ML
 */
async function modelsStatusEndpoint(req, res) {
  try {
    const health = await checkMLServiceHealth();
    const models = await getModelsStatus();
    const rateLimit = mlService.getRateLimitStatus ? mlService.getRateLimitStatus() : { active: false };

    res.json({
      success: true,
      data: {
        ml_service: health ? 'online' : 'offline',
        ml_service_details: health,
        rate_limit: rateLimit,
        models: models || {
          frost: { available: false, fallback: 'rule_based', reason: 'Servicio ML no disponible' },
          heavy_rain: { available: false, fallback: 'rule_based', reason: 'Servicio ML no disponible' },
          snow: { available: false, fallback: 'rule_based', reason: 'Datos insuficientes' },
          hail: { available: false, fallback: 'rule_based', reason: 'No viable con datos actuales' },
        },
      },
    });
  } catch (err) {
    console.error('Error consultando estado ML:', err);
    res.status(500).json({ success: false, error: 'Error al consultar estado del servicio ML.' });
  }
}

/**
 * POST /api/ml/alerts/generate
 * Genera alertas meteorológicas para todas las parcelas activas
 * Solo admin puede ejecutar este endpoint
 */
async function generateAlerts(req, res) {
  try {
    const parcels = await dbAll(`
      SELECT p.*, u.id as user_id, u.name as farmer_name
      FROM parcels p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.status = 'activa' AND p.center_lat IS NOT NULL AND p.center_lng IS NOT NULL
    `);

    let alertsCreated = 0;
    let alertsSkipped = 0;
    let alertsSkippedStale = 0;

    const evaluatedParcels = await mlService.mapWithConcurrency(parcels, 2, async (parcel) => {
      const result = await mlService.getPredictionForParcel(parcel);
      return { parcel, result };
    });

    for (const { parcel, result } of evaluatedParcels) {
      if (!result.success || !result.data?.predictions) continue;

      // FASE 8L-G16: Salvaguarda de seguridad H-01
      // Nunca generar alertas agronómicas nuevas desde pronósticos desactualizados (stale)
      const isStale = Boolean(
        result.source === 'cache_stale' ||
        result.data?.source === 'cache_stale' ||
        result.data?.is_stale === true
      );

      if (isStale) {
        // Contabilizar cada alerta individual de riesgo alto o moderado descartada por obsolescencia
        // para no confundir parcelas omitidas con alertas individuales
        for (const pred of result.data.predictions) {
          if (pred.risk_level === 'high' || pred.risk_level === 'moderate') {
            alertsSkippedStale++;
          }
        }
        continue;
      }

      for (const pred of result.data.predictions) {
        if (pred.risk_level === 'high' || pred.risk_level === 'moderate') {
          // Map phenomenon to notification type
          const typeMap = {
            frost: 'alerta_helada',
            heavy_rain: 'alerta_lluvia',
            snow: 'alerta_helada', // Closest existing type
            hail: 'alerta_granizo',
          };
          const notifType = typeMap[pred.phenomenon] || 'sistema';

          // Verificar preferencias del usuario si están configuradas
          const userPrefs = await dbGet('SELECT * FROM alert_preferences WHERE user_id = ?', [parcel.user_id]);
          if (userPrefs) {
            if (pred.phenomenon === 'frost' && !userPrefs.frost_enabled) continue;
            if (pred.phenomenon === 'heavy_rain' && !userPrefs.heavy_rain_enabled) continue;
            if (pred.phenomenon === 'snow' && !userPrefs.snow_enabled) continue;
            if (pred.phenomenon === 'hail' && !userPrefs.hail_enabled) continue;
            if (userPrefs.min_risk_level === 'high' && pred.risk_level !== 'high') continue;
          }

          const severityMap = {
            high: 'critical',
            moderate: 'warning',
          };

          const phenomenonNames = {
            frost: 'Helada',
            heavy_rain: 'Lluvia Intensa',
            snow: 'Nevada',
            hail: 'Granizada',
          };

          const title = `⚠️ Alerta: Riesgo de ${phenomenonNames[pred.phenomenon] || pred.phenomenon} — ${parcel.name}`;
          
          const variables = pred.variables_used || {};
          let details = '';
          if (variables.temperature_2m_min !== undefined) {
            details += `Temp. mínima prevista: ${variables.temperature_2m_min}°C. `;
          }
          if (variables.precipitation_sum !== undefined) {
            details += `Precipitación prevista: ${variables.precipitation_sum}mm. `;
          }

          const message = [
            `Parcela: ${parcel.name}`,
            parcel.altitude_masl ? `Altitud: ${parcel.altitude_masl} msnm` : '',
            `Nivel de riesgo: ${pred.risk_level === 'high' ? 'Alto' : 'Moderado'}`,
            `Puntuación: ${pred.risk_score}/100`,
            details,
            `Tipo de evaluación: ${pred.model_type === 'ml_trained' ? 'Modelo ML' : 'Reglas meteorológicas'}`,
            `Periodo: ${pred.period}`,
            pred.confidence_note,
          ].filter(Boolean).join('\n');

          // Creación atómica protegida por pg_advisory_xact_lock en PostgreSQL
          const alertResult = await createWeatherAlertAtomically({
            userId: parcel.user_id,
            type: notifType,
            title,
            message,
            severity: severityMap[pred.risk_level] || 'info',
            parcelId: parcel.id,
            parcelName: parcel.name,
            phenomenon: pred.phenomenon,
            modelType: pred.model_type,
            windowHours: 6
          });

          if (alertResult.created) {
            alertsCreated++;
          } else if (alertResult.skipped) {
            alertsSkipped++;
          } else if (alertResult.error) {
            console.warn(`[ML_ALERT_GENERATE] Alerta no generada por error controlado: ${alertResult.error} (${alertResult.reason})`);
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        parcels_evaluated: parcels.length,
        alerts_created: alertsCreated,
        alerts_skipped_duplicate: alertsSkipped,
        alerts_skipped_stale: alertsSkippedStale,
        alerts_skipped: alertsSkipped + alertsSkippedStale,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Error generando alertas ML:', err);
    res.status(500).json({ success: false, error: 'Error al generar alertas.' });
  }
}

/**
 * GET /api/ml/admin/dashboard
 * Panel administrativo del sistema ML
 */
async function adminDashboard(req, res) {
  try {
    const health = await checkMLServiceHealth();
    const models = await getModelsStatus();

    // Count predictions cached
    const predictionCount = await dbGet(
      "SELECT COUNT(*) as count FROM weather_cache WHERE data_type = 'ml_prediction'"
    );

    // Count recent alerts
    const recentAlerts = await dbGet(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE type IN ('alerta_helada', 'alerta_lluvia', 'alerta_granizo')
       AND created_at > NOW() - INTERVAL '24 hours'`
    );

    // Count active parcels with coords
    const activeParcels = await dbGet(
      `SELECT COUNT(*) as count FROM parcels 
       WHERE status = 'activa' AND center_lat IS NOT NULL AND center_lng IS NOT NULL`
    );

    res.json({
      success: true,
      data: {
        ml_service_status: health ? 'online' : 'offline',
        ml_service_details: health,
        models: models,
        statistics: {
          cached_predictions: predictionCount?.count || 0,
          alerts_last_24h: recentAlerts?.count || 0,
          active_parcels_with_coords: activeParcels?.count || 0,
        },
        last_check: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Error en dashboard ML admin:', err);
    res.status(500).json({ success: false, error: 'Error al obtener estado del sistema ML.' });
  }
}

/**
 * GET /api/ml/alerts
 * Obtiene las alertas meteorológicas del usuario autenticado
 */
async function getUserAlerts(req, res) {
  try {
    const userId = req.user.id;
    const unreadOnly = req.query.unread === 'true';
    const limit = parseInt(req.query.limit, 10) || 20;

    const whereClause = unreadOnly ? 'AND read = 0' : '';
    const alerts = await dbAll(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND type ILIKE 'alerta_%' ${whereClause} 
       ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );

    res.json({
      success: true,
      data: alerts,
      total: alerts.length,
      unread_count: alerts.filter(a => !a.read).length,
    });
  } catch (err) {
    console.error('Error al obtener alertas del usuario:', err);
    res.status(500).json({ success: false, error: 'Error al obtener alertas meteorológicas.' });
  }
}

/**
 * PUT /api/ml/alerts/:id/read
 * Marca una alerta como leída (solo si pertenece al usuario)
 */
async function markAlertAsRead(req, res) {
  try {
    const alertId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const result = await dbRun(
      'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
      [alertId, userId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alerta no encontrada o no autorizada.' });
    }

    res.json({ success: true, message: 'Alerta marcada como leída.' });
  } catch (err) {
    console.error('Error al marcar alerta como leída:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar alerta.' });
  }
}

/**
 * GET /api/ml/preferences
 * Obtiene las preferencias de alertas del usuario autenticado
 */
async function getUserPreferences(req, res) {
  try {
    const userId = req.user.id;
    let prefs = await dbGet('SELECT * FROM alert_preferences WHERE user_id = ?', [userId]);
    if (!prefs) {
      await dbRun('INSERT INTO alert_preferences (user_id) VALUES (?)', [userId]);
      prefs = await dbGet('SELECT * FROM alert_preferences WHERE user_id = ?', [userId]);
    }
    res.json({ success: true, data: prefs });
  } catch (err) {
    console.error('Error al obtener preferencias:', err);
    res.status(500).json({ success: false, error: 'Error al obtener preferencias de alerta.' });
  }
}

/**
 * PUT /api/ml/preferences
 * Actualiza las preferencias de alertas del usuario autenticado
 */
async function updateUserPreferences(req, res) {
  try {
    const userId = req.user.id;
    const {
      frost_enabled,
      heavy_rain_enabled,
      snow_enabled,
      hail_enabled,
      min_risk_level,
      in_app_enabled,
      email_enabled,
    } = req.body;

    const exists = await dbGet('SELECT id FROM alert_preferences WHERE user_id = ?', [userId]);
    if (!exists) {
      await dbRun('INSERT INTO alert_preferences (user_id) VALUES (?)', [userId]);
    }

    await dbRun(`
      UPDATE alert_preferences SET
        frost_enabled = COALESCE(?, frost_enabled),
        heavy_rain_enabled = COALESCE(?, heavy_rain_enabled),
        snow_enabled = COALESCE(?, snow_enabled),
        hail_enabled = COALESCE(?, hail_enabled),
        min_risk_level = COALESCE(?, min_risk_level),
        in_app_enabled = COALESCE(?, in_app_enabled),
        email_enabled = COALESCE(?, email_enabled),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [
      frost_enabled !== undefined ? (frost_enabled ? 1 : 0) : null,
      heavy_rain_enabled !== undefined ? (heavy_rain_enabled ? 1 : 0) : null,
      snow_enabled !== undefined ? (snow_enabled ? 1 : 0) : null,
      hail_enabled !== undefined ? (hail_enabled ? 1 : 0) : null,
      min_risk_level || null,
      in_app_enabled !== undefined ? (in_app_enabled ? 1 : 0) : null,
      email_enabled !== undefined ? (email_enabled ? 1 : 0) : null,
      userId,
    ]);

    const updated = await dbGet('SELECT * FROM alert_preferences WHERE user_id = ?', [userId]);
    res.json({ success: true, data: updated, message: 'Preferencias actualizadas correctamente.' });
  } catch (err) {
    console.error('Error al actualizar preferencias:', err);
    res.status(500).json({ success: false, error: 'Error al guardar preferencias.' });
  }
}

/**
 * GET /api/ml/observations
 * Lista observaciones de campo verificadas
 */
async function getGroundTruthObservations(req, res) {
  try {
    const { phenomenon, limit = 50 } = req.query;
    let query = `
      SELECT o.*, u.name as observer_name, p.name as parcel_name
      FROM ground_truth_observations o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN parcels p ON o.parcel_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (phenomenon) {
      query += ' AND o.phenomenon = ?';
      params.push(phenomenon);
    }
    query += ' ORDER BY o.observed_at DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const rows = await dbAll(query, params);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('Error al listar observaciones:', err);
    res.status(500).json({ success: false, error: 'Error al obtener observaciones de campo.' });
  }
}

/**
 * POST /api/ml/observations
 * Registra una observación de campo verificada
 */
async function createGroundTruthObservation(req, res) {
  try {
    const userId = req.user.id;
    const {
      parcel_id,
      observed_at,
      latitude,
      longitude,
      altitude_masl,
      phenomenon,
      severity,
      source,
      verification_method,
      station_id,
      temperature_recorded,
      precipitation_recorded_mm,
      crop_damage_percentage,
      notes,
      photo_url,
    } = req.body;

    if (!observed_at || !phenomenon) {
      return res.status(400).json({ success: false, error: 'observed_at y phenomenon son obligatorios.' });
    }

    const validPhenomena = ['frost', 'heavy_rain', 'snow', 'hail', 'drought', 'strong_winds'];
    if (!validPhenomena.includes(phenomenon)) {
      return res.status(400).json({ success: false, error: `Fenómeno no válido. Permitidos: ${validPhenomena.join(', ')}` });
    }

    const result = await dbRun(`
      INSERT INTO ground_truth_observations (
        user_id, parcel_id, observed_at, latitude, longitude, altitude_masl,
        phenomenon, severity, source, verification_method, station_id,
        temperature_recorded, precipitation_recorded_mm, crop_damage_percentage,
        notes, photo_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      parcel_id || null,
      observed_at,
      latitude || null,
      longitude || null,
      altitude_masl || null,
      phenomenon,
      severity || 'moderado',
      source || 'farmer_report',
      verification_method || 'visual_inspection',
      station_id || null,
      temperature_recorded !== undefined ? temperature_recorded : null,
      precipitation_recorded_mm !== undefined ? precipitation_recorded_mm : null,
      crop_damage_percentage !== undefined ? crop_damage_percentage : null,
      notes || null,
      photo_url || null,
    ]);

    const inserted = await dbGet('SELECT * FROM ground_truth_observations WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, data: inserted, message: 'Observación de campo registrada exitosamente.' });
  } catch (err) {
    console.error('Error al crear observación:', err);
    res.status(500).json({ success: false, error: 'Error al registrar observación de campo.' });
  }
}

/**
 * GET /api/ml/models/comparison
 * Comparativa técnica de los 5 algoritmos de ML requerida por Fase 2 y Dashboard
 */
async function get5ModelsComparison(req, res) {
  try {
    const fs = require('fs');
    const path = require('path');
    const comparisonPath = path.resolve(__dirname, '../data/models-json/model_comparison_5_algorithms.json');
    const reportsPath = path.resolve(__dirname, '../data/weather-history/reports/model_comparison_5_algorithms.json');

    let data = null;
    if (fs.existsSync(comparisonPath)) {
      data = JSON.parse(fs.readFileSync(comparisonPath, 'utf-8'));
    } else if (fs.existsSync(reportsPath)) {
      data = JSON.parse(fs.readFileSync(reportsPath, 'utf-8'));
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Matriz comparativa de 5 algoritmos no encontrada. Ejecute el pipeline de entrenamiento.',
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error('Error al obtener comparativa de 5 modelos:', err);
    res.status(500).json({ success: false, error: 'Error al cargar la comparativa de modelos.' });
  }
}

/**
 * POST /api/ml/predict/manual
 * Predicción meteorológica manual / interactiva para el Dashboard
 */
async function predictManualSimulation(req, res) {
  try {
    const {
      altitude_masl,
      temperature_2m_mean,
      temperature_2m_min,
      temperature_2m_max,
      precipitation_sum,
      wind_speed_10m_max,
      humidity_mean,
      humidity_max,
      humidity_min,
      soil_moisture_mean,
      et0_fao_evapotranspiration,
      month,
      day_of_year,
      is_winter,
      is_dry_season,
    } = req.body;

    // Validación básica de variables mínimas
    if (temperature_2m_min === undefined || temperature_2m_max === undefined) {
      return res.status(400).json({
        success: false,
        status: 'insufficient_data',
        error: 'Variables térmicas mínimas (temperature_2m_min, temperature_2m_max) son obligatorias.',
      });
    }

    const { defaultEngine } = require('../services/mlEngine');
    if (!defaultEngine.isLoaded) {
      defaultEngine.loadModels();
    }

    const tMin = Number(temperature_2m_min);
    const tMax = Number(temperature_2m_max);
    const tMean = temperature_2m_mean !== undefined ? Number(temperature_2m_mean) : (tMin + tMax) / 2.0;
    const precip = precipitation_sum !== undefined ? Number(precipitation_sum) : 0.0;
    const elevation = altitude_masl !== undefined ? Number(altitude_masl) : 3500.0;
    const wind = wind_speed_10m_max !== undefined ? Number(wind_speed_10m_max) : 2.5;
    const humMean = humidity_mean !== undefined ? Number(humidity_mean) : 65.0;
    const humMax = humidity_max !== undefined ? Number(humidity_max) : Math.min(100.0, humMean + 15.0);
    const humMin = humidity_min !== undefined ? Number(humidity_min) : Math.max(10.0, humMean - 15.0);
    const soilMoist = soil_moisture_mean !== undefined ? Number(soil_moisture_mean) : 0.25;
    const et0 = et0_fao_evapotranspiration !== undefined ? Number(et0_fao_evapotranspiration) : 2.5;
    const m = month !== undefined ? Number(month) : new Date().getMonth() + 1;
    const doy = day_of_year !== undefined ? Number(day_of_year) : 180;
    const winter = is_winter !== undefined ? Number(is_winter) : (m >= 6 && m <= 8 ? 1 : 0);
    const dry = is_dry_season !== undefined ? Number(is_dry_season) : (m >= 5 && m <= 9 ? 1 : 0);

    const inputFeatures = {
      temperature_2m_min: tMin,
      temperature_2m_max: tMax,
      temperature_2m_mean: tMean,
      temp_range: tMax - tMin,
      precipitation_sum: precip,
      wind_speed_10m_max: wind,
      humidity_mean: humMean,
      humidity_max: humMax,
      humidity_min: humMin,
      soil_moisture_mean: soilMoist,
      et0_fao_evapotranspiration: et0,
      elevation: elevation,
      month: m,
      day_of_year: doy,
      is_winter: winter,
      is_dry_season: dry,
      precip_lag1: precip * 0.7,
      precip_rolling_3d: precip * 2.0,
      precip_rolling_7d: precip * 3.5,
      temp_min_lag1: tMin,
      temp_max_lag1: tMax,
      temp_min_rolling_3d: tMin,
      temp_min_rolling_7d: tMin + 0.5,
      temp_max_rolling_3d: tMax,
    };

    const frostResult = defaultEngine.predictFrost(inputFeatures);
    const heavyRainResult = defaultEngine.predictHeavyRain(inputFeatures);
    const snowResult = defaultEngine.predictSnow(inputFeatures);
    const hailResult = defaultEngine.predictHail(inputFeatures);

    res.json({
      success: true,
      simulation_type: 'manual_input',
      input_variables: inputFeatures,
      predictions: {
        frost: frostResult,
        heavy_rain: heavyRainResult,
        snow: snowResult,
        hail: hailResult,
      },
      evaluation_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error en predicción manual:', err);
    res.status(500).json({ success: false, error: 'Error al ejecutar predicción manual.' });
  }
}

/**
 * GET /api/ml/predict/:parcelId/horizons
 * Predicción horaria estructurada en horizontes 24h, 48h y 72h para gráficos del Dashboard
 */
async function getParcelHorizonsPrediction(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acceso no autorizado a esta parcela.' });
    }

    if (!parcel.center_lat || !parcel.center_lng) {
      return res.status(400).json({
        success: false,
        status: 'insufficient_data',
        error: 'Parcela sin coordenadas geográficas válidas.',
      });
    }

    const predictionResult = await mlService.getPredictionForParcel(parcel);
    if (!predictionResult.success) {
      return res.status(502).json({
        success: false,
        status: 'prediction_unavailable',
        error: predictionResult.error || 'No se pudo obtener pronóstico meteorológico.',
      });
    }

    const baseData = predictionResult.data;
    const summary = baseData.forecast_summary || {};
    const dates = summary.dates || [];
    const tempMinArr = summary.temp_min || [];
    const tempMaxArr = summary.temp_max || [];
    const precipArr = summary.precipitation || [];

    // Estructurar horizontes 24h, 48h, 72h
    const horizons = {
      horizon_24h: {
        label: '24 Horas (Día 1)',
        date: dates[0] || null,
        temp_min: tempMinArr[0] ?? null,
        temp_max: tempMaxArr[0] ?? null,
        precipitation_sum: precipArr[0] ?? null,
        risk_summary: (baseData.predictions || []).map(p => ({
          phenomenon: p.phenomenon,
          risk_level: p.risk_level,
          risk_score: p.risk_score !== undefined ? p.risk_score : 0,
          probability: p.probability !== undefined ? p.probability : (p.risk_score !== undefined ? p.risk_score / 100.0 : 0.0),
        })),
      },
      horizon_48h: {
        label: '48 Horas (Día 2)',
        date: dates[1] || null,
        temp_min: tempMinArr[1] ?? null,
        temp_max: tempMaxArr[1] ?? null,
        precipitation_sum: precipArr[1] ?? null,
      },
      horizon_72h: {
        label: '72 Horas (Día 3)',
        date: dates[2] || null,
        temp_min: tempMinArr[2] ?? null,
        temp_max: tempMaxArr[2] ?? null,
        precipitation_sum: precipArr[2] ?? null,
      },
    };

    res.json({
      success: true,
      parcel: {
        id: parcel.id,
        name: parcel.name,
        latitude: parcel.center_lat,
        longitude: parcel.center_lng,
        altitude_masl: parcel.altitude_masl,
        crop_type: parcel.crop_type,
      },
      horizons,
      raw_predictions: (baseData.predictions || []).map(p => ({
        ...p,
        probability: p.probability !== undefined ? p.probability : (p.risk_score !== undefined ? p.risk_score / 100.0 : 0.0),
      })),
      source: predictionResult.source,
      is_stale: baseData.is_stale || false,
      issued_at: baseData.issued_at || new Date().toISOString(),
      valid_until: baseData.valid_until,
    });
  } catch (err) {
    console.error('Error al generar horizontes 24/48/72h:', err);
    res.status(500).json({ success: false, error: 'Error al generar horizontes predictivos.' });
  }
}

/**
 * GET /api/ml/evaluation/predictions-vs-observations
 * Comparación entre predicciones generadas y observaciones de campo reales
 */
async function getPredictionsVsObservationsEvaluation(req, res) {
  try {
    let observations = [];
    try {
      observations = await dbAll(`
        SELECT o.*, p.name as parcel_name
        FROM ground_truth_observations o
        LEFT JOIN parcels p ON o.parcel_id = p.id
        ORDER BY o.observed_at DESC
        LIMIT 100
      `);
    } catch (dbErr) {
      console.warn('[ML Evaluation] Base de datos no disponible para observaciones históricas:', dbErr.message);
      observations = [];
    }

    // Resumen estadístico de observaciones de campo
    const phenomenonCounts = {};
    (observations || []).forEach(obs => {
      phenomenonCounts[obs.phenomenon] = (phenomenonCounts[obs.phenomenon] || 0) + 1;
    });

    res.json({
      success: true,
      total_observations_recorded: (observations || []).length,
      phenomenon_distribution: phenomenonCounts,
      observations: observations || [],
      evaluation_protocol: {
        source_real: 'ground_truth_observations (Reportes de agricultores, técnicos y estaciones SENAMHI)',
        source_predictive: 'Motor ML AgroPasco (ERA5 / Open-Meteo)',
        matching_window_hours: 24,
        metrics_computed_on_availability: ['Accuracy', 'Precision', 'Recall', 'Matriz de Confusión'],
      },
    });
  } catch (err) {
    console.error('Error al evaluar predicciones vs observaciones:', err);
    res.status(500).json({ success: false, error: 'Error al evaluar predicciones contra observaciones.' });
  }
}

/**
 * GET /api/ml/simulation/contract
 * Contrato formal para integración del Simulador Monte Carlo (Fase 3/4)
 */
async function getMonteCarloSimulationContract(req, res) {
  res.json({
    success: true,
    contract_version: '1.0.0_monte_carlo',
    status: 'ready_for_phase3',
    endpoint: '/api/ml/simulation/monte-carlo',
    specification: {
      description: 'Simulador estocástico Monte Carlo para evaluar incertidumbre de variables meteorológicas en horizontes de 24h a 72h.',
      input_schema: {
        type: 'object',
        required: ['parcel_id', 'iterations'],
        properties: {
          parcel_id: { type: 'integer', description: 'ID de la parcela a simular' },
          iterations: { type: 'integer', default: 1000, minimum: 100, maximum: 10000 },
          confidence_levels: { type: 'array', items: { type: 'number' }, default: [0.10, 0.50, 0.90] },
          stochastic_variables: {
            type: 'array',
            items: { type: 'string' },
            default: ['temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max'],
          },
          distribution_assumptions: {
            temperature_2m_min: 'Normal (μ estimada por ERA5, σ calibrada por altitud regional de Pasco)',
            precipitation_sum: 'Gamma / Lognormal truncada en 0.0 mm',
            wind_speed_10m_max: 'Weibull / Gumbel para ráfagas extremas',
          },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          percentile_p10: { description: 'Escenario optimista' },
          percentile_p50: { description: 'Escenario mediano más probable' },
          percentile_p90: { description: 'Escenario crítico de riesgo agronómico' },
          probability_of_frost_loss: { type: 'number' },
          probability_of_heavy_rain_flooding: { type: 'number' },
        },
      },
    },
  });
}

/**
 * GET /api/ml/agents/status
 * Contrato y estado operacional de los 5 agentes inteligentes de AgroPasco
 */
async function getAgentsStatusContract(req, res) {
  res.json({
    success: true,
    system: 'AgroPasco Multi-Agent Intelligence System',
    architecture: '5 Autonomous Specialized Agricultural Agents',
    status: 'contracts_prepared',
    agents: [
      {
        id: 'agent_meteorological',
        name: 'Agente Meteorológico y Alerta Temprana',
        role: 'Monitoreo continuo de reanálisis, satélite y pronósticos de 72h para detección anticipada de heladas y lluvias torrenciales.',
        inputs: ['Open-Meteo', 'weather_cache', 'mlEngine (4 modelos)'],
        outputs: ['alert_notifications', 'risk_curves_24_72h'],
        status: 'active_engine_ready',
      },
      {
        id: 'agent_irrigation',
        name: 'Agente de Gestión del Riego y Balance Hídrico',
        role: 'Optimización de láminas de agua basada en evapotranspiración FAO-56 (ET0) y pronóstico de precipitaciones.',
        inputs: ['et0_fao_evapotranspiration', 'soil_moisture_mean', 'precipitation_sum'],
        outputs: ['irrigation_schedule_recommendation', 'water_savings_estimate'],
        status: 'contract_ready',
      },
      {
        id: 'agent_phytosanitary',
        name: 'Agente de Vigilancia Fitosanitaria y Plagas',
        role: 'Modelación de brotes fúngicos (Rancha de la papa - Phytophthora infestans) mediante ventanas térmicas y de humedad.',
        inputs: ['humidity_max', 'temp_range', 'crop_type', 'elevation'],
        outputs: ['pest_risk_index', 'fungicide_application_window'],
        status: 'contract_ready',
      },
      {
        id: 'agent_harvest',
        name: 'Agente de Planificación de Cosecha y Postcosecha',
        role: 'Determinación de ventanas óptimas de cosecha seca para evitar pudrición por humedad en tubérculos y granos.',
        inputs: ['dry_window_days', 'rain_forecast_72h', 'crop_calendar'],
        outputs: ['optimal_harvest_dates', 'post_harvest_risk'],
        status: 'contract_ready',
      },
      {
        id: 'agent_agronomic_advisory',
        name: 'Agente Asesor Agronómico y Económico',
        role: 'Generación de recomendaciones personalizadas de mitigación (mantas térmicas, riego nocturno, bioestimulantes) según altitud y cultivo.',
        inputs: ['risk_level', 'crop_type', 'altitude_masl', 'knowledge_base'],
        outputs: ['actionable_recommendations_checklist'],
        status: 'contract_ready',
      },
    ],
  });
}

/**
 * POST /api/ml/simulation/monte-carlo
 * Ejecuta simulación estocástica Monte Carlo de incertidumbre climática
 */
async function runMonteCarloSimulation(req, res) {
  try {
    const {
      parcel_id,
      phenomenon = 'frost',
      horizon = '24h',
      iterations = 1000,
      seed = 42,
      variability = {},
      manual_baseline = null,
    } = req.body;

    const validPhenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
    if (!validPhenomena.includes(phenomenon)) {
      return res.status(400).json({
        success: false,
        error: `Fenómeno inválido. Permitidos: ${validPhenomena.join(', ')}`,
      });
    }

    let baseline = null;

    if (manual_baseline && typeof manual_baseline === 'object') {
      baseline = {
        temperature_2m_min: Number(manual_baseline.temperature_2m_min ?? 2.0),
        temperature_2m_max: Number(manual_baseline.temperature_2m_max ?? 13.0),
        precipitation_sum: Number(manual_baseline.precipitation_sum ?? 3.5),
        humidity_mean: Number(manual_baseline.humidity_mean ?? 68.0),
        wind_speed_10m_max: Number(manual_baseline.wind_speed_10m_max ?? 3.5),
        altitude_masl: Number(manual_baseline.altitude_masl ?? 4000),
      };
    } else {
      const parcelId = parseInt(parcel_id, 10);
      if (!parcelId || isNaN(parcelId)) {
        return res.status(400).json({
          success: false,
          error: 'parcel_id o manual_baseline es requerido para simular.',
        });
      }

      const parcel = await dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
      if (!parcel) {
        return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
      }

      if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Acceso no autorizado a esta parcela.' });
      }

      const predictionResult = await mlService.getPredictionForParcel(parcel);
      const summary = predictionResult?.data?.forecast_summary || {};
      const dayIdx = horizon === '72h' ? 2 : horizon === '48h' ? 1 : 0;

      baseline = {
        temperature_2m_min: summary.temp_min?.[dayIdx] ?? 2.0,
        temperature_2m_max: summary.temp_max?.[dayIdx] ?? 13.5,
        precipitation_sum: summary.precipitation?.[dayIdx] ?? 3.5,
        humidity_mean: 68.0,
        wind_speed_10m_max: 3.5,
        altitude_masl: parcel.altitude_masl || 4000,
      };
    }

    const { MonteCarloSimulator } = require('../services/monteCarloService');
    const simulator = new MonteCarloSimulator({ seed });
    const result = simulator.runSimulation(baseline, phenomenon, iterations, variability);

    res.json(result);
  } catch (err) {
    console.error('Error en simulación Monte Carlo:', err);
    res.status(500).json({ success: false, error: 'Error al ejecutar simulación Monte Carlo.' });
  }
}

module.exports = {
  predictForParcel,
  predictionsForUser,
  allPredictions,
  modelsStatusEndpoint,
  generateAlerts,
  adminDashboard,
  getUserAlerts,
  markAlertAsRead,
  getUserPreferences,
  updateUserPreferences,
  getGroundTruthObservations,
  createGroundTruthObservation,
  get5ModelsComparison,
  predictManualSimulation,
  getParcelHorizonsPrediction,
  getPredictionsVsObservationsEvaluation,
  getMonteCarloSimulationContract,
  getAgentsStatusContract,
  runMonteCarloSimulation,
};

