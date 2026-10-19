/**
 * AgroPasco Digital — Controlador del Planificador y Predicción vs Realidad (Fase 7)
 * =================================================================================
 * Expone endpoints REST para:
 *  - Consultar telemetría y bloqueos distribuidos del planificador (schedulerService).
 *  - Disparar ejecuciones automatizadas bajo demanda.
 *  - Consultar historial persistente de predicciones emitidas (ml_predictions_log).
 *  - Evaluar predicciones contra observaciones reales de campo (ground_truth_observations).
 *  - Gestionar asignaciones explícitas de parcelas para asesores técnicos.
 */

const schedulerService = require('../services/schedulerService');
const predictionPersistenceService = require('../services/predictionPersistenceService');
const parcelAuthService = require('../services/parcelAuthService');

/**
 * Consulta el estado del planificador, bloqueos distribuidos y telemetría
 * GET /api/ml/scheduler/status
 */
async function getSchedulerStatusEndpoint(req, res) {
  try {
    const status = await schedulerService.getStatus();
    return res.status(200).json({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error('[schedulerController.getSchedulerStatusEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Dispara un ciclo de automatización programada bajo demanda (admin o asesor)
 * POST /api/ml/scheduler/trigger
 */
async function triggerSchedulerRunEndpoint(req, res) {
  try {
    const userRole = req.user.role;
    if (userRole !== 'admin' && userRole !== 'asesor') {
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado: Solo administradores o asesores pueden forzar ciclos de automatización.',
      });
    }

    const { force_all = false, skip_lease = false } = req.body;

    const result = await schedulerService.runScheduledCycle({
      forceAllParcels: Boolean(force_all),
      skipLease: Boolean(skip_lease),
    });

    return res.status(200).json({
      success: true,
      message: 'Ciclo de automatización ejecutado correctamente.',
      result,
    });
  } catch (err) {
    console.error('[schedulerController.triggerSchedulerRunEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Consulta el historial persistente de predicciones emitidas para una parcela
 * GET /api/ml/predictions/history/:parcelId
 */
async function getPredictionHistoryEndpoint(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    const limit = parseInt(req.query.limit, 10) || 20;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Validación RBAC estricta (Sección 10)
    const authResult = await parcelAuthService.checkParcelAccess(userId, userRole, parcelId);
    if (!authResult.authorized) {
      return res.status(403).json({
        success: false,
        error: authResult.reason || 'No tiene permisos para ver las predicciones de esta parcela.',
      });
    }

    const predictions = await predictionPersistenceService.getPredictionsByParcel(parcelId, limit);
    const metrics = await predictionPersistenceService.getAccuracyMetrics(parcelId);

    return res.status(200).json({
      success: true,
      parcel_id: parcelId,
      total: predictions.length,
      predictions,
      metrics,
    });
  } catch (err) {
    console.error('[schedulerController.getPredictionHistoryEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Dispara el contraste de predicciones vencidas contra observaciones de campo
 * POST /api/ml/predictions/evaluate
 */
async function evaluatePredictionsEndpoint(req, res) {
  try {
    const parcelId = req.body.parcel_id ? parseInt(req.body.parcel_id, 10) : null;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (parcelId) {
      const authResult = await parcelAuthService.checkParcelAccess(userId, userRole, parcelId);
      if (!authResult.authorized) {
        return res.status(403).json({
          success: false,
          error: authResult.reason || 'No tiene permisos para evaluar esta parcela.',
        });
      }
    } else if (userRole !== 'admin' && userRole !== 'asesor') {
      return res.status(403).json({
        success: false,
        error: 'Solo administradores y asesores pueden evaluar globalmente predicciones contra observaciones.',
      });
    }

    const result = await predictionPersistenceService.evaluatePredictionsAgainstObservations(parcelId);
    const metrics = await predictionPersistenceService.getAccuracyMetrics(parcelId);

    return res.status(200).json({
      success: true,
      message: 'Evaluación de predicciones vs observaciones completada.',
      result,
      metrics,
    });
  } catch (err) {
    console.error('[schedulerController.evaluatePredictionsEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Asigna formalmente un asesor a una parcela para cumplir el control RBAC (Sección 10)
 * POST /api/ml/advisors/assign-parcel
 */
async function assignAdvisorParcelEndpoint(req, res) {
  try {
    const { advisor_id, parcel_id } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!advisor_id || !parcel_id) {
      return res.status(400).json({
        success: false,
        error: 'Los campos advisor_id y parcel_id son obligatorios.',
      });
    }

    const advisorId = parseInt(advisor_id, 10);
    const parcelId = parseInt(parcel_id, 10);

    // Solo el dueño de la parcela o un administrador pueden asignar un asesor
    if (userRole !== 'admin') {
      const parcel = await parcelAuthService.checkParcelAccess(userId, userRole, parcelId);
      if (!parcel.authorized || parcel.role !== 'owner') {
        return res.status(403).json({
          success: false,
          error: 'Solo el agricultor propietario o un administrador pueden autorizar un asesor en esta parcela.',
        });
      }
    }

    const assignment = await parcelAuthService.assignAdvisorToParcel(advisorId, parcelId, userId);

    return res.status(200).json({
      success: true,
      message: `Asesor #${advisorId} asignado correctamente a la parcela #${parcelId}.`,
      assignment,
    });
  } catch (err) {
    console.error('[schedulerController.assignAdvisorParcelEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

module.exports = {
  getSchedulerStatusEndpoint,
  triggerSchedulerRunEndpoint,
  getPredictionHistoryEndpoint,
  evaluatePredictionsEndpoint,
  assignAdvisorParcelEndpoint,
};
