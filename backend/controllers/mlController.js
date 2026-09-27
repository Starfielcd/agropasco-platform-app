/**
 * AgroPasco — Controlador de Machine Learning Meteorológico
 * ===========================================================
 * Endpoints para predicciones ML por parcela, estado de modelos,
 * y panel administrativo del sistema ML.
 */

const { dbGet, dbAll, dbRun } = require('../config/database');
const { getPredictionForParcel, getPredictionsForUser, checkMLServiceHealth, getModelsStatus } = require('../services/mlService');
const { createNotification } = require('../services/notificationService');

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

    const predictions = [];
    for (const parcel of parcels) {
      const result = await getPredictionForParcel(parcel);
      predictions.push({
        parcel_id: parcel.id,
        parcel_name: parcel.name,
        farmer_name: parcel.farmer_name,
        farmer_location: parcel.farmer_location,
        altitude_masl: parcel.altitude_masl,
        crop_type: parcel.crop_type,
        ...result,
      });
    }

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

    res.json({
      success: true,
      data: {
        ml_service: health ? 'online' : 'offline',
        ml_service_details: health,
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

    for (const parcel of parcels) {
      const result = await getPredictionForParcel(parcel);
      
      if (!result.success || !result.data?.predictions) continue;

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

          // Check for duplicate alert specifically for this parcel and phenomenon within 6 hours
          const existing = await dbGet(
            `SELECT id FROM notifications 
             WHERE user_id = ? AND type = ? AND title LIKE ?
             AND created_at > datetime('now', '-6 hours')`,
            [parcel.user_id, notifType, `%${parcel.name}%`]
          );

          if (existing) {
            alertsSkipped++;
            continue;
          }

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

          await createNotification(
            parcel.user_id,
            typeMap[pred.phenomenon] || 'sistema',
            title,
            message,
            severityMap[pred.risk_level] || 'info'
          );

          alertsCreated++;
        }
      }
    }

    res.json({
      success: true,
      data: {
        parcels_evaluated: parcels.length,
        alerts_created: alertsCreated,
        alerts_skipped_duplicate: alertsSkipped,
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
       AND created_at > datetime('now', '-24 hours')`
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
       WHERE user_id = ? AND type LIKE 'alerta_%' ${whereClause} 
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
};
