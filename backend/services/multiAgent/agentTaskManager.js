/**
 * AgroPasco Digital — Gestor Persistente de Tareas Multiagente (Fase 6)
 * =====================================================================
 * Administra el ciclo de vida, persistencia y recuperación de tareas encadenadas
 * en PostgreSQL con tolerancia a fallos, reintentos controlados y control de estados.
 */

const db = require('../../config/database');

class AgentTaskManager {
  /**
   * Genera un ID determinista y trazable para la tarea
   */
  generateTaskId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${timestamp}_${random}`;
  }

  /**
   * Crea una nueva tarea persistente en estado 'pending'
   */
  async createTask(params) {
    const {
      workflow_type = 'agroclimatic_risk_assessment',
      parcel_id,
      user_id,
      max_retries = 2,
    } = params;

    const taskId = this.generateTaskId();
    const initialSteps = JSON.stringify({});

    const sql = `
      INSERT INTO agent_tasks (
        id, workflow_type, parcel_id, user_id, status,
        current_agent, steps, retries, max_retries, created_at
      )
      VALUES (?, ?, ?, ?, 'pending', 'orchestrator', ?, 0, ?, NOW())
      RETURNING *
    `;

    return await db.dbGet(sql, [taskId, workflow_type, parcel_id, user_id, initialSteps, max_retries]);
  }

  /**
   * Inicia la ejecución de una tarea
   */
  async markRunning(taskId, currentAgent = 'orchestrator') {
    const sql = `
      UPDATE agent_tasks
      SET status = 'running', current_agent = ?, started_at = COALESCE(started_at, NOW())
      WHERE id = ?
      RETURNING *
    `;
    return await db.dbGet(sql, [currentAgent, taskId]);
  }

  /**
   * Registra el resultado parcial de un agente en el campo steps (JSON serializado)
   */
  async updateStep(taskId, agentName, stepOutput) {
    const task = await db.dbGet('SELECT steps FROM agent_tasks WHERE id = ?', [taskId]);
    let currentSteps = {};
    if (task && task.steps) {
      try {
        currentSteps = typeof task.steps === 'string' ? JSON.parse(task.steps) : task.steps;
      } catch (_) {
        currentSteps = {};
      }
    }

    currentSteps[agentName] = {
      ...stepOutput,
      timestamp: new Date().toISOString(),
    };

    const sql = `
      UPDATE agent_tasks
      SET steps = ?, current_agent = ?
      WHERE id = ?
      RETURNING *
    `;

    return await db.dbGet(sql, [JSON.stringify(currentSteps), agentName, taskId]);
  }

  /**
   * Completa exitosamente la tarea consolidando el resumen final
   */
  async completeTask(taskId, resultSummary, durationMs = 0) {
    const summaryStr = typeof resultSummary === 'string' ? resultSummary : JSON.stringify(resultSummary);
    const sql = `
      UPDATE agent_tasks
      SET status = 'completed', current_agent = 'orchestrator', result_summary = ?, duration_ms = ?, completed_at = NOW()
      WHERE id = ?
      RETURNING *
    `;
    return await db.dbGet(sql, [summaryStr, durationMs, taskId]);
  }

  /**
   * Marca la tarea como fallida registrando el error
   */
  async failTask(taskId, errorMessage, durationMs = 0) {
    const sql = `
      UPDATE agent_tasks
      SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = NOW()
      WHERE id = ?
      RETURNING *
    `;
    return await db.dbGet(sql, [errorMessage, durationMs, taskId]);
  }

  /**
   * Incrementa el contador de reintentos
   */
  async incrementRetry(taskId) {
    const sql = `
      UPDATE agent_tasks
      SET retries = retries + 1, status = 'pending'
      WHERE id = ?
      RETURNING *
    `;
    return await db.dbGet(sql, [taskId]);
  }

  /**
   * Obtiene una tarea por su ID con parsing automático de JSON
   */
  async getTaskById(taskId) {
    const task = await db.dbGet('SELECT * FROM agent_tasks WHERE id = ?', [taskId]);
    if (!task) return null;
    return this._formatTask(task);
  }

  /**
   * Obtiene las tareas recientes asociadas a una parcela
   */
  async getTasksByParcel(parcelId, limit = 10) {
    const sql = `
      SELECT t.*, u.name as user_name
      FROM agent_tasks t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.parcel_id = ?
      ORDER BY t.created_at DESC
      LIMIT ?
    `;
    const tasks = await db.dbAll(sql, [parcelId, limit]);
    return tasks.map(t => this._formatTask(t));
  }

  /**
   * Obtiene todas las tareas recientes para el panel administrativo
   */
  async getAllRecentTasks(limit = 20) {
    const sql = `
      SELECT t.*, p.name as parcel_name, p.crop_type, u.name as user_name
      FROM agent_tasks t
      LEFT JOIN parcels p ON t.parcel_id = p.id
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT ?
    `;
    const tasks = await db.dbAll(sql, [limit]);
    return tasks.map(t => this._formatTask(t));
  }

  /**
   * Recupera tareas huérfanas en estado 'running' tras un reinicio de servidor
   */
  async recoverStaleTasks(maxAgeMs = 300000) {
    try {
      const sql = `
        UPDATE agent_tasks
        SET status = 'failed', error_message = 'Tarea interrumpida por reinicio o tiempo de espera excedido'
        WHERE status = 'running' AND started_at < NOW() - INTERVAL '5 minutes'
        RETURNING id
      `;
      const recovered = await db.dbAll(sql);
      return recovered.length;
    } catch (_) {
      return 0;
    }
  }

  _formatTask(task) {
    let parsedSteps = {};
    let parsedSummary = null;

    if (task.steps) {
      try {
        parsedSteps = typeof task.steps === 'string' ? JSON.parse(task.steps) : task.steps;
      } catch (_) {}
    }

    if (task.result_summary) {
      try {
        parsedSummary = typeof task.result_summary === 'string' ? JSON.parse(task.result_summary) : task.result_summary;
      } catch (_) {
        parsedSummary = task.result_summary;
      }
    }

    return {
      ...task,
      steps: parsedSteps,
      result_summary: parsedSummary,
    };
  }
}

module.exports = new AgentTaskManager();
