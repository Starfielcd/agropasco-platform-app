/**
 * AgroPasco Digital — Agente 1: Orquestador Central (Fase 6)
 * ==========================================================
 * Responsabilidad:
 *  - Recibir solicitudes de agricultores, asesores y administradores.
 *  - Identificar el tipo de flujo de trabajo y crear tareas persistentes.
 *  - Distribuir secuencialmente el grafo de dependencias (DAG):
 *      Meteorológico -> Predictivo ML -> Agrícola/Operativo -> Auditor -> Consolidación.
 *  - Controlar estados (pending, running, completed, failed) con persistencia en PostgreSQL.
 *  - Manejar reintentos controlados, tiempos de espera y protección contra ejecuciones duplicadas.
 *  - Consolidar resultados en un resumen ejecutivo accionable.
 *  - Proveer telemetría operativa en tiempo real de los cinco agentes.
 */

const db = require('../../config/database');
const agentTaskManager = require('./agentTaskManager');
const meteorologicalAgent = require('./meteorologicalAgent');
const predictiveMLAgent = require('./predictiveMLAgent');
const agriculturalOperativeAgent = require('./agriculturalOperativeAgent');
const auditorSupervisorAgent = require('./auditorSupervisorAgent');

class OrchestratorAgent {
  constructor() {
    this.id = 'agent_orchestrator';
    this.name = 'orchestrator';
    this.displayName = 'Agente Orquestador Central';
    this.version = '1.0.0';
    this.responsibility = 'Recepción de solicitudes, secuenciación en grafo acíclico dirigido (DAG), control de estados persistentes, reintentos idempotentes y consolidación ejecutiva.';
    this.activeAgents = {
      orchestrator: { status: 'idle', current_task: null, last_active: null },
      meteorological: { status: 'idle', current_task: null, last_active: null },
      predictive_ml: { status: 'idle', current_task: null, last_active: null },
      agricultural_operative: { status: 'idle', current_task: null, last_active: null },
      auditor_supervisor: { status: 'idle', current_task: null, last_active: null },
    };
  }

  /**
   * Ejecuta el flujo multiagente completo para una parcela
   * @param {object} params
   * @param {number} params.parcel_id ID de la parcela a evaluar
   * @param {number} params.user_id ID del usuario solicitante
   * @param {string} [params.workflow_type='agroclimatic_risk_assessment']
   * @param {boolean} [params.include_monte_carlo=true]
   * @param {number} [params.monte_carlo_iterations=500]
   * @param {boolean} [params.force_refresh=false]
   * @returns {Promise<object>} Tarea completada con resumen y trazabilidad de los 5 agentes
   */
  async executeWorkflow(params) {
    const {
      parcel_id,
      user_id,
      workflow_type = 'agroclimatic_risk_assessment',
      include_monte_carlo = true,
      monte_carlo_iterations = 500,
      force_refresh = false,
    } = params;

    if (!parcel_id || !user_id) {
      throw new Error('[OrchestratorAgent] Se requieren los parámetros parcel_id y user_id.');
    }

    const tStart = Date.now();

    // 1. Protección contra ejecución duplicada (concurrencia simultánea en la misma parcela)
    const existingRunning = await db.dbGet(
      "SELECT id, started_at FROM agent_tasks WHERE parcel_id = ? AND status = 'running' AND started_at > NOW() - INTERVAL '30 seconds'",
      [parcel_id]
    );

    if (existingRunning) {
      throw new Error(`[OrchestratorAgent] Ya existe una tarea en ejecución (${existingRunning.id}) para la parcela ${parcel_id}. Espere a que finalice.`);
    }

    // 2. Crear tarea persistente en agent_tasks
    const task = await agentTaskManager.createTask({
      workflow_type,
      parcel_id,
      user_id,
      max_retries: 2,
    });

    const taskId = task.id;
    this._setAgentStatus('orchestrator', 'running', taskId);

    try {
      // 3. Marcar tarea en estado 'running'
      await agentTaskManager.markRunning(taskId, 'orchestrator');

      // Obtener datos iniciales de la parcela
      const parcel = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcel_id]);
      if (!parcel) {
        throw new Error(`Parcela ${parcel_id} no existe.`);
      }

      // -----------------------------------------------------------------------
      // PASO 1: AGENTE METEOROLÓGICO
      // -----------------------------------------------------------------------
      this._setAgentStatus('meteorological', 'running', taskId);
      await agentTaskManager.markRunning(taskId, 'meteorological');

      const meteoResult = await meteorologicalAgent.execute({
        parcel_id,
        task_id: taskId,
        force_refresh,
      });

      await agentTaskManager.updateStep(taskId, 'meteorological', meteoResult);
      this._setAgentStatus('meteorological', 'idle', null);

      // -----------------------------------------------------------------------
      // PASO 2: AGENTE PREDICTIVO ML
      // -----------------------------------------------------------------------
      this._setAgentStatus('predictive_ml', 'running', taskId);
      await agentTaskManager.markRunning(taskId, 'predictive_ml');

      const mlResult = await predictiveMLAgent.execute({
        weather_output: meteoResult,
        parcel_context: parcel,
        include_monte_carlo,
        monte_carlo_iterations,
      });

      await agentTaskManager.updateStep(taskId, 'predictive_ml', mlResult);
      this._setAgentStatus('predictive_ml', 'idle', null);

      // -----------------------------------------------------------------------
      // PASO 3: AGENTE AGRÍCOLA Y OPERATIVO
      // -----------------------------------------------------------------------
      this._setAgentStatus('agricultural_operative', 'running', taskId);
      await agentTaskManager.markRunning(taskId, 'agricultural_operative');

      const agriResult = await agriculturalOperativeAgent.execute({
        parcel_id,
        predictive_output: mlResult,
        parcel_context: parcel,
        user_id,
      });

      await agentTaskManager.updateStep(taskId, 'agricultural_operative', agriResult);
      this._setAgentStatus('agricultural_operative', 'idle', null);

      // -----------------------------------------------------------------------
      // PASO 4: AGENTE AUDITOR Y SUPERVISOR
      // -----------------------------------------------------------------------
      this._setAgentStatus('auditor_supervisor', 'running', taskId);
      await agentTaskManager.markRunning(taskId, 'auditor_supervisor');

      const stepsAccumulated = {
        meteorological: meteoResult,
        predictive_ml: mlResult,
        agricultural_operative: agriResult,
      };

      const auditResult = await auditorSupervisorAgent.execute({
        task_id: taskId,
        parcel_id,
        user_id,
        steps: stepsAccumulated,
      });

      await agentTaskManager.updateStep(taskId, 'auditor_supervisor', auditResult);
      this._setAgentStatus('auditor_supervisor', 'idle', null);

      // -----------------------------------------------------------------------
      // PASO 5: CONSOLIDACIÓN POR EL ORQUESTADOR CENTRAL
      // -----------------------------------------------------------------------
      const totalDurationMs = Date.now() - tStart;

      // Extraer indicadores clave para el resumen ejecutivo
      const p24 = mlResult.predictions_by_horizon?.['24h'] || {};
      const highest24hRisk = p24.max_risk_level || 'none';
      const highest24hScore = p24.max_risk_score || 0;

      const summaryPayload = {
        workflow_type,
        parcel_id,
        parcel_name: parcel.name,
        crop_type: parcel.crop_type,
        overall_status: 'SUCCESS',
        audit_verdict: auditResult.compliance_status,
        execution_summary: {
          total_duration_ms: totalDurationMs,
          agents_executed: 5,
          weather_source: meteoResult.provenance?.source,
          completeness_pct: meteoResult.data_quality?.completeness_pct,
          risk_24h: { level: highest24hRisk, score: highest24hScore },
          mitigation_strategies_count: agriResult.total_strategies_count,
          sensitive_actions_gated: agriResult.safety_guardrails?.sensitive_actions_pending_approval?.length || 0,
          audit_checks_passed: `${auditResult.passed_checks}/${auditResult.total_checks}`,
        },
        executive_message: `Evaluación multiagente exitosa para Parcela '${parcel.name}'. Riesgo predominante a 24h: ${highest24hRisk.toUpperCase()} (${highest24hScore}%). ${agriResult.total_strategies_count} estrategias preventivas listas. Dictamen de auditoría: ${auditResult.compliance_status.toUpperCase()}.`,
      };

      await agentTaskManager.completeTask(taskId, summaryPayload, totalDurationMs);
      this._setAgentStatus('orchestrator', 'idle', null);

      // Retornar tarea completa
      return await agentTaskManager.getTaskById(taskId);
    } catch (err) {
      const failDurationMs = Date.now() - tStart;
      console.error(`[OrchestratorAgent] Fallo en tarea ${taskId}:`, err.message);

      this._setAgentStatus('orchestrator', 'error', null);
      this._setAgentStatus('meteorological', 'idle', null);
      this._setAgentStatus('predictive_ml', 'idle', null);
      this._setAgentStatus('agricultural_operative', 'idle', null);
      this._setAgentStatus('auditor_supervisor', 'idle', null);

      await agentTaskManager.failTask(taskId, err.message, failDurationMs);
      throw err;
    }
  }

  /**
   * Obtiene la telemetría operativa en tiempo real de los 5 agentes
   */
  async getOperationalStatus() {
    // 1. Tareas en las últimas 24 horas por estado
    const statsSql = `
      SELECT
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'running' THEN 1 END) as running_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        AVG(CASE WHEN status = 'completed' THEN duration_ms END) as avg_duration_ms
      FROM agent_tasks
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    const stats = await db.dbGet(statsSql) || {
      total_tasks: 0,
      pending_count: 0,
      running_count: 0,
      completed_count: 0,
      failed_count: 0,
      avg_duration_ms: 0,
    };

    // 2. Información de los 5 agentes
    const agentsList = [
      {
        id: 'agent_orchestrator',
        name: 'orchestrator',
        displayName: 'Agente Orquestador Central',
        role: 'Coordinación, secuenciación en grafo y control de estados',
        state: this.activeAgents.orchestrator.status,
        current_task: this.activeAgents.orchestrator.current_task,
        last_active: this.activeAgents.orchestrator.last_active,
        icon: 'network-wired',
      },
      {
        id: 'agent_meteorological',
        name: 'meteorological',
        displayName: 'Agente Meteorológico',
        role: 'Open-Meteo, validación geoespacial, caché y calidad de datos',
        state: this.activeAgents.meteorological.status,
        current_task: this.activeAgents.meteorological.current_task,
        last_active: this.activeAgents.meteorological.last_active,
        icon: 'cloud-sun-rain',
      },
      {
        id: 'agent_predictive_ml',
        name: 'predictive_ml',
        displayName: 'Agente Predictivo ML',
        role: 'Inferencia V8 nativa, registro versionado y simulación Monte Carlo',
        state: this.activeAgents.predictive_ml.status,
        current_task: this.activeAgents.predictive_ml.current_task,
        last_active: this.activeAgents.predictive_ml.last_active,
        icon: 'brain',
      },
      {
        id: 'agent_agricultural_operative',
        name: 'agricultural_operative',
        displayName: 'Agente Agrícola y Operativo',
        role: 'Recomendaciones expertas, alertas y guardrails de seguridad',
        state: this.activeAgents.agricultural_operative.status,
        current_task: this.activeAgents.agricultural_operative.current_task,
        last_active: this.activeAgents.agricultural_operative.last_active,
        icon: 'seedling',
      },
      {
        id: 'agent_auditor_supervisor',
        name: 'auditor_supervisor',
        displayName: 'Agente Auditor y Supervisor',
        role: 'Auditoría continua, RBAC, consistencia de modelos y trazabilidad',
        state: this.activeAgents.auditor_supervisor.status,
        current_task: this.activeAgents.auditor_supervisor.current_task,
        last_active: this.activeAgents.auditor_supervisor.last_active,
        icon: 'shield-check',
      },
    ];

    return {
      system: 'AgroPasco Multi-Agent Intelligent Core (Fase 6)',
      timestamp: new Date().toISOString(),
      agents: agentsList,
      telemetry: {
        total_tasks_24h: Number(stats.total_tasks || 0),
        pending: Number(stats.pending_count || 0),
        running: Number(stats.running_count || 0),
        completed: Number(stats.completed_count || 0),
        failed: Number(stats.failed_count || 0),
        avg_execution_ms: Math.round(Number(stats.avg_duration_ms || 0)),
        success_rate_pct: stats.total_tasks > 0 
          ? Number(((Number(stats.completed_count || 0) / Number(stats.total_tasks)) * 100).toFixed(1))
          : 100,
      },
    };
  }

  _setAgentStatus(agentName, status, taskId) {
    if (this.activeAgents[agentName]) {
      this.activeAgents[agentName].status = status;
      this.activeAgents[agentName].current_task = taskId;
      this.activeAgents[agentName].last_active = new Date().toISOString();
    }
  }
}

module.exports = new OrchestratorAgent();
