/**
 * AgroPasco Digital — Controlador del Sistema Multiagente (Fase 6)
 * ===============================================================
 * Expone endpoints REST para ejecución orquestada, seguimiento de tareas,
 * auditoría y telemetría de los 5 agentes inteligentes.
 */

const db = require('../config/database');
const {
  orchestratorAgent,
  agentTaskManager,
} = require('../services/multiAgent');
const parcelAuthService = require('../services/parcelAuthService');
const predictionPersistenceService = require('../services/predictionPersistenceService');

/**
 * Ejecuta el flujo multiagente completo (5 agentes) sobre una parcela
 * POST /api/ml/agents/workflow/execute
 */
async function executeWorkflowEndpoint(req, res) {
  try {
    const {
      parcel_id,
      workflow_type = 'agroclimatic_risk_assessment',
      include_monte_carlo = true,
      monte_carlo_iterations = 500,
      force_refresh = false,
    } = req.body;

    if (!parcel_id) {
      return res.status(400).json({
        success: false,
        error: 'El campo parcel_id es obligatorio.',
      });
    }

    const parcelId = parseInt(parcel_id, 10);
    const userId = req.user.id;
    const userRole = req.user.role;

    // Control de Aislamiento RBAC estricto: Agricultores sus parcelas, Asesores solo asignadas
    const authResult = await parcelAuthService.checkParcelAccess(userId, userRole, parcelId);
    if (!authResult.authorized) {
      const isNotFound = authResult.reason && authResult.reason.includes('no encontrada');
      return res.status(isNotFound ? 404 : 403).json({
        success: false,
        error: `Acceso denegado: ${authResult.reason || 'No tiene permisos para esta parcela.'}`,
      });
    }

    // Ejecutar el orquestador
    const taskResult = await orchestratorAgent.executeWorkflow({
      parcel_id: parcelId,
      user_id: userId,
      workflow_type,
      include_monte_carlo: Boolean(include_monte_carlo),
      monte_carlo_iterations: Number(monte_carlo_iterations) || 500,
      force_refresh: Boolean(force_refresh),
    });

    // Persistir predicciones en ml_predictions_log
    const meteoStep = taskResult.steps?.meteorological || {};
    const mlStep = taskResult.steps?.predictive_ml || {};
    const weatherSource = meteoStep.provenance?.source || 'Open-Meteo ERA5 / Forecast API';

    await predictionPersistenceService.persistWorkflowPredictions(
      taskResult.id,
      parcelId,
      mlStep,
      weatherSource
    );

    return res.status(200).json({
      success: true,
      message: 'Flujo multiagente completado exitosamente por los 5 agentes.',
      task: taskResult,
    });
  } catch (err) {
    console.error('[agentController.executeWorkflowEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Consulta el estado y detalle por pasos de una tarea específica
 * GET /api/ml/agents/tasks/:taskId
 */
async function getTaskStatusEndpoint(req, res) {
  try {
    const { taskId } = req.params;
    const task = await agentTaskManager.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: `Tarea ${taskId} no encontrada.`,
      });
    }

    // Validación RBAC estricta (Sección 10)
    const userRole = req.user.role;
    const userId = req.user.id;

    const authResult = await parcelAuthService.checkParcelAccess(userId, userRole, task.parcel_id);
    if (!authResult.authorized) {
      return res.status(403).json({
        success: false,
        error: authResult.reason || 'No tiene permisos para consultar esta tarea.',
      });
    }

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (err) {
    console.error('[agentController.getTaskStatusEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Obtiene las tareas recientes de una parcela
 * GET /api/ml/agents/tasks/parcel/:parcelId
 */
async function getParcelTasksEndpoint(req, res) {
  try {
    const parcelId = parseInt(req.params.parcelId, 10);
    const limit = parseInt(req.query.limit, 10) || 10;
    const userRole = req.user.role;
    const userId = req.user.id;

    // Validación RBAC estricta (Sección 10)
    const authResult = await parcelAuthService.checkParcelAccess(userId, userRole, parcelId);
    if (!authResult.authorized) {
      return res.status(403).json({
        success: false,
        error: authResult.reason || 'No tiene permisos para ver las tareas de esta parcela.',
      });
    }

    const tasks = await agentTaskManager.getTasksByParcel(parcelId, limit);

    return res.status(200).json({
      success: true,
      parcel_id: parcelId,
      total: tasks.length,
      tasks,
    });
  } catch (err) {
    console.error('[agentController.getParcelTasksEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Telemetría operativa en tiempo real de los 5 agentes y cola de tareas
 * GET /api/ml/agents/operational-status
 */
async function getOperationalStatusEndpoint(req, res) {
  try {
    const status = await orchestratorAgent.getOperationalStatus();
    return res.status(200).json({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error('[agentController.getOperationalStatusEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * Consulta registros persistentes de auditoría
 * GET /api/ml/agents/audit-logs
 */
async function getAuditLogsEndpoint(req, res) {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const parcelId = req.query.parcel_id ? parseInt(req.query.parcel_id, 10) : null;
    const limit = parseInt(req.query.limit, 10) || 20;

    let sql = `
      SELECT a.*, p.name as parcel_name, u.name as user_name
      FROM agent_audit_logs a
      LEFT JOIN parcels p ON a.parcel_id = p.id
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const params = [];

    if (userRole !== 'admin' && userRole !== 'asesor' && userRole !== 'advisor') {
      // Agricultores solo ven auditorías de sus parcelas
      sql += ' WHERE a.parcel_id IN (SELECT id FROM parcels WHERE user_id = ?)';
      params.push(userId);
      if (parcelId) {
        sql += ' AND a.parcel_id = ?';
        params.push(parcelId);
      }
    } else if (parcelId) {
      sql += ' WHERE a.parcel_id = ?';
      params.push(parcelId);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await db.dbAll(sql, params);
    const parsedLogs = rows.map(r => {
      let details = {};
      if (r.verification_details) {
        try {
          details = typeof r.verification_details === 'string' ? JSON.parse(r.verification_details) : r.verification_details;
        } catch (_) {
          details = { raw: r.verification_details };
        }
      }
      return {
        ...r,
        verification_details: details,
      };
    });

    return res.status(200).json({
      success: true,
      total: parsedLogs.length,
      audit_logs: parsedLogs,
    });
  } catch (err) {
    console.error('[agentController.getAuditLogsEndpoint] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

module.exports = {
  executeWorkflowEndpoint,
  getTaskStatusEndpoint,
  getParcelTasksEndpoint,
  getOperationalStatusEndpoint,
  getAuditLogsEndpoint,
};
