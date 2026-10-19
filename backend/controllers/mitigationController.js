/**
 * AgroPasco Digital — Controlador de Estrategias de Mitigación Agrícola (Fase 5)
 * ==============================================================================
 * Endpoints seguros para consulta, priorización agronómica y seguimiento
 * trazable de acciones preventivas por parcela.
 */

const db = require('../config/database');
const { defaultMitigationService } = require('../services/mitigationService');
const mlService = require('../services/mlService');
const { MonteCarloSimulator } = require('../services/monteCarloService');

/**
 * 1. Consulta de estrategias recomendadas para una parcela
 * GET /api/ml/mitigation/strategies/:parcelId
 */
async function getMitigationStrategiesForParcel(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    if (!parcelId || isNaN(parcelId)) {
      return res.status(400).json({ success: false, error: 'ID de parcela inválido.' });
    }

    const parcel = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    // Control de acceso por rol y propiedad
    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acceso no autorizado a esta parcela.' });
    }

    const horizon = req.query.horizon || '24h';
    const phenomenon = req.query.phenomenon || 'frost';
    const stage = req.query.stage || 'tuberizacion';

    // 1. Obtener predicción operativa y ML nativo
    let mlPrediction = { risk_level: 'none', risk_score: 0, probability: 0 };
    let operationalForecast = {
      altitude_masl: parcel.altitude_masl || 4000,
      temperature_2m_min: 2.0,
      temperature_2m_max: 13.5,
      precipitation_sum: 3.5,
      humidity_mean: 68.0,
    };

    try {
      const predResult = await mlService.getPredictionForParcel(parcel);
      if (predResult?.data) {
        const predictions = predResult.data.predictions || [];
        const matchedPred = predictions.find(p => p.phenomenon === phenomenon) || predictions[0];
        if (matchedPred) {
          mlPrediction = {
            risk_level: matchedPred.risk_level || 'none',
            risk_score: matchedPred.risk_score || 0,
            probability: matchedPred.probability || (matchedPred.risk_score / 100),
          };
        }
        const summary = predResult.data.forecast_summary || {};
        const dayIdx = horizon === '72h' ? 2 : horizon === '48h' ? 1 : 0;
        operationalForecast = {
          altitude_masl: parcel.altitude_masl || 4000,
          temperature_2m_min: summary.temp_min?.[dayIdx] ?? 2.0,
          temperature_2m_max: summary.temp_max?.[dayIdx] ?? 13.5,
          precipitation_sum: summary.precipitation?.[dayIdx] ?? 3.5,
          humidity_mean: 68.0,
        };
      }
    } catch (err) {
      console.warn(`[MITIGATION_WARN] Usando valores base para parcela ${parcelId}: ${err.message}`);
    }

    // 2. Ejecutar simulación Monte Carlo ligera (200 iteraciones) para sensibilidad estocástica
    let monteCarloSummary = null;
    try {
      const sim = new MonteCarloSimulator({ seed: 42 });
      monteCarloSummary = sim.runSimulation(operationalForecast, phenomenon, 200);
    } catch (_) {}

    // 3. Generar recomendaciones a través del motor agronómico
    const cropName = parcel.crop_type || parcel.crop_name || 'papa';
    const recommendationResult = defaultMitigationService.generateRecommendations({
      parcel_id: parcelId,
      crop: cropName,
      phenological_stage: stage,
      phenomenon,
      horizon,
      operational_forecast: operationalForecast,
      ml_prediction: mlPrediction,
      monte_carlo_results: monteCarloSummary,
    });

    // 4. Cruzar con el historial persistido de seguimiento en la base de datos
    try {
      const trackedActions = await defaultMitigationService.getParcelActions(parcelId);
      const trackedMap = new Map();
      for (const act of trackedActions) {
        trackedMap.set(act.strategy_id, act);
      }

      for (const strat of recommendationResult.strategies) {
        const existing = trackedMap.get(strat.strategy_id);
        if (existing) {
          strat.status = existing.status;
          strat.tracking = {
            last_updated: existing.updated_at,
            executed_by: existing.farmer_name || 'Agricultor',
            notes: existing.notes,
            advisor_notes: existing.advisor_notes,
            advisor_name: existing.advisor_name,
            executed_at: existing.executed_at,
          };
        }
      }
    } catch (_) {}

    res.json(recommendationResult);
  } catch (err) {
    console.error('Error al generar estrategias de mitigación:', err);
    res.status(500).json({ success: false, error: 'Error al generar estrategias de mitigación.' });
  }
}

/**
 * 2. Registro o actualización de estado de una acción preventiva (Agricultor / Asesor)
 * POST /api/ml/mitigation/actions
 */
async function recordMitigationAction(req, res) {
  try {
    const {
      parcel_id,
      strategy_id,
      phenomenon,
      action_name,
      status = 'pendiente',
      horizon = '24h',
      risk_level = 'moderate',
      priority = 'alta',
      notes = null,
      resources_needed = null,
      precautions = null,
      time_window = null,
    } = req.body;

    const parcelId = parseInt(parcel_id, 10);
    if (!parcelId || isNaN(parcelId) || !strategy_id) {
      return res.status(400).json({ success: false, error: 'parcel_id y strategy_id son obligatorios.' });
    }

    const parcel = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acceso no autorizado a esta parcela.' });
    }

    const updatedAction = await defaultMitigationService.updateActionStatus(parcelId, req.user.id, {
      strategy_id,
      phenomenon,
      action_name,
      status,
      horizon,
      risk_level,
      priority,
      notes,
      resources_needed,
      precautions,
      time_window,
    });

    // Auditoría de acción registrada
    try {
      await db.dbRun(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'UPDATE_MITIGATION_ACTION', 'parcel', parcelId, `Acción ${strategy_id} cambiada a estado: ${status}`]
      );
    } catch (_) {}

    res.json({
      success: true,
      message: `Acción actualizada a estado: ${status}`,
      data: updatedAction,
    });
  } catch (err) {
    console.error('Error al registrar acción de mitigación:', err);
    res.status(500).json({ success: false, error: err.message || 'Error al actualizar acción de mitigación.' });
  }
}

/**
 * 3. Consulta de historial de acciones de una parcela
 * GET /api/ml/mitigation/actions/:parcelId
 */
async function getParcelActionHistory(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    if (!parcelId || isNaN(parcelId)) {
      return res.status(400).json({ success: false, error: 'ID de parcela inválido.' });
    }

    const parcel = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acceso no autorizado a esta parcela.' });
    }

    const actions = await defaultMitigationService.getParcelActions(parcelId);
    res.json({ success: true, parcel_id: parcelId, count: actions.length, data: actions });
  } catch (err) {
    console.error('Error al consultar historial de acciones:', err);
    res.status(500).json({ success: false, error: 'Error al consultar historial de acciones.' });
  }
}

/**
 * 4. Asesor técnico agrega nota u observación a una acción
 * POST /api/ml/mitigation/advisor-note
 */
async function addAdvisorMitigationNote(req, res) {
  try {
    if (req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo asesores técnicos o administradores pueden agregar notas de supervisión.' });
    }

    const { parcel_id, strategy_id, notes } = req.body;
    const parcelId = parseInt(parcel_id, 10);
    if (!parcelId || !strategy_id || !notes) {
      return res.status(400).json({ success: false, error: 'parcel_id, strategy_id y notes son obligatorios.' });
    }

    const updated = await defaultMitigationService.addAdvisorNote(parcelId, strategy_id, req.user.id, notes);
    res.json({ success: true, message: 'Nota técnica registrada con éxito.', data: updated });
  } catch (err) {
    console.error('Error al agregar nota técnica de asesor:', err);
    res.status(500).json({ success: false, error: 'Error al agregar nota técnica de asesor.' });
  }
}

module.exports = {
  getMitigationStrategiesForParcel,
  recordMitigationAction,
  getParcelActionHistory,
  addAdvisorMitigationNote,
};
