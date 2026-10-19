/**
 * AgroPasco Digital — Servicio Planificador y Automatizador Multiagente (Fase 7)
 * ==============================================================================
 * Responsabilidad:
 *  - Orquestar la automatización programada en entornos distribuidos (Node.js / Render).
 *  - Gestionar bloqueos distribuidos (leases) en PostgreSQL mediante la tabla scheduler_locks.
 *  - Identificar parcelas con pronósticos desactualizados (> 6 horas) o sin inferencias.
 *  - Ejecutar el flujo de 5 agentes sin intervención manual.
 *  - Persistir predicciones históricas en ml_predictions_log.
 *  - Generar y despachar notificaciones inteligentes deduplicadas a notifications.
 *  - Evaluar periódicamente predicciones vencidas contra observaciones de campo.
 *  - Recuperar tareas huérfanas tras reinicios.
 *  - Control de seguridad: AUTO_SCHEDULER_ENABLED=false por defecto para evitar ejecuciones
 *    prematuras en producción sin autorización explícita.
 */

const os = require('os');
const db = require('../config/database');
const { orchestratorAgent, agentTaskManager } = require('./multiAgent');
const predictionPersistenceService = require('./predictionPersistenceService');
const notificationService = require('./notificationService');

class SchedulerService {
  constructor() {
    this.instanceId = `${os.hostname()}_pid${process.pid}_${Math.random().toString(36).substring(2, 7)}`;
    this.intervalId = null;
    this.isRunningCycle = false;
    this.config = {
      enabled: process.env.AUTO_SCHEDULER_ENABLED === 'true',
      intervalMinutes: parseInt(process.env.SCHEDULER_INTERVAL_MINUTES, 10) || 15,
      staleThresholdHours: parseInt(process.env.SCHEDULER_PREDICTION_STALE_HOURS, 10) || 6,
      maxParcelsPerCycle: parseInt(process.env.SCHEDULER_MAX_PARCELS_CYCLE, 10) || 10,
    };
    this.telemetry = {
      total_cycles: 0,
      successful_cycles: 0,
      failed_cycles: 0,
      parcels_updated_count: 0,
      alerts_emitted_count: 0,
      last_run_at: null,
      last_duration_ms: 0,
      last_error: null,
      next_scheduled_run: null,
    };
  }

  /**
   * Intenta adquirir un bloqueo distribuido (lease) en PostgreSQL para un trabajo
   * @param {string} jobName Nombre del trabajo
   * @param {number} ttlSeconds Tiempo de vida del bloqueo en segundos
   * @returns {Promise<boolean>} true si se adquirió el bloqueo, false si está ocupado
   */
  async acquireLease(jobName, ttlSeconds = 300) {
    try {
      const selectSql = 'SELECT * FROM scheduler_locks WHERE job_name = ?';
      const lock = await db.dbGet(selectSql, [jobName]);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

      if (!lock) {
        // Crear bloqueo inicial
        const insertSql = `
          INSERT INTO scheduler_locks (job_name, locked_by, locked_at, expires_at, last_run_at, last_status)
          VALUES (?, ?, NOW(), ?, NOW(), 'running')
          RETURNING job_name
        `;
        const res = await db.dbGet(insertSql, [jobName, this.instanceId, expiresAt]);
        return Boolean(res);
      }

      // Si existe, verificar si ha expirado o si está libre (idle/completed/failed)
      const lockExpired = new Date(lock.expires_at) < now;
      const isFree = lock.last_status !== 'running' || lockExpired;

      if (isFree) {
        const updateSql = `
          UPDATE scheduler_locks
          SET locked_by = ?,
              locked_at = NOW(),
              expires_at = ?,
              last_status = 'running'
          WHERE job_name = ?
            AND (last_status != 'running' OR expires_at < NOW())
          RETURNING job_name
        `;
        const res = await db.dbGet(updateSql, [this.instanceId, expiresAt, jobName]);
        return Boolean(res);
      }

      // Bloqueo retenido por otra instancia activa
      return false;
    } catch (err) {
      console.warn(`[SchedulerService.acquireLease] Error de bloqueo para ${jobName}:`, err.message);
      return false;
    }
  }

  /**
   * Renueva activamente el tiempo de vida (TTL) del lease distribuido (Heartbeat).
   * Evita que tareas prolongadas pierdan el bloqueo frente a instancias competidoras
   * mientras el ciclo se encuentre en ejecución activa.
   * @param {string} jobName
   * @param {number} ttlSeconds
   * @returns {Promise<boolean>}
   */
  async renewLease(jobName, ttlSeconds = 600) {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      const sql = `
        UPDATE scheduler_locks
        SET expires_at = ?
        WHERE job_name = ? AND locked_by = ? AND last_status = 'running'
        RETURNING job_name
      `;
      const res = await db.dbGet(sql, [expiresAt, jobName, this.instanceId]);
      return Boolean(res);
    } catch (err) {
      console.warn(`[SchedulerService.renewLease] Error renovando lease para ${jobName}:`, err.message);
      return false;
    }
  }

  /**
   * Libera el bloqueo distribuido registrando el estado final
   * @param {string} jobName
   * @param {string} status 'idle' | 'completed' | 'failed'
   * @param {string} [error=null]
   */
  async releaseLease(jobName, status = 'idle', error = null) {
    try {
      const sql = `
        UPDATE scheduler_locks
        SET last_status = ?,
            last_run_at = NOW(),
            last_error = ?,
            expires_at = NOW()
        WHERE job_name = ? AND locked_by = ?
      `;
      await db.dbRun(sql, [status, error, jobName, this.instanceId]);
    } catch (err) {
      console.warn(`[SchedulerService.releaseLease] Error al liberar bloqueo de ${jobName}:`, err.message);
    }
  }

  /**
   * Inicia el planificador periódico en segundo plano
   */
  start() {
    if (this.intervalId) return;

    console.log(`[SchedulerService] Inicializando planificador (Instancia: ${this.instanceId}, Activo: ${this.config.enabled}, Intervalo: ${this.config.intervalMinutes}m)`);

    if (this.config.enabled) {
      const ms = this.config.intervalMinutes * 60 * 1000;
      this.telemetry.next_scheduled_run = new Date(Date.now() + ms).toISOString();

      this.intervalId = setInterval(async () => {
        await this.runScheduledCycle();
        this.telemetry.next_scheduled_run = new Date(Date.now() + ms).toISOString();
      }, ms);
    }
  }

  /**
   * Detiene el planificador
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.telemetry.next_scheduled_run = null;
    console.log('[SchedulerService] Planificador detenido.');
  }

  /**
   * Ejecuta un ciclo de automatización completo (llamado programado o manual)
   * @param {object} [options={}]
   * @param {boolean} [options.forceAllParcels=false]
   * @param {boolean} [options.skipLease=false]
   * @returns {Promise<object>}
   */
  async runScheduledCycle(options = {}) {
    const { forceAllParcels = false, skipLease = false } = options;
    const tStart = Date.now();
    const jobName = 'multiagent_automated_cycle';

    if (this.isRunningCycle) {
      return { skipped: true, reason: 'cycle_already_in_progress_locally' };
    }

    let heartbeatInterval = null;

    if (!skipLease) {
      const acquired = await this.acquireLease(jobName, 600); // 10 minutos TTL
      if (!acquired) {
        return { skipped: true, reason: 'distributed_lease_locked_by_another_worker' };
      }

      // Heartbeat activo periódico: renueva el lease cada 30 segundos durante toda la ejecución del ciclo.
      // Garantiza que si una sola tarea o llamada de red supera los 10 minutos, el lease permanezca retenido.
      heartbeatInterval = setInterval(async () => {
        try {
          await this.renewLease(jobName, 600);
        } catch (_) {}
      }, 30000);
      if (heartbeatInterval.unref) {
        heartbeatInterval.unref();
      }
    }

    this.isRunningCycle = true;
    this.telemetry.total_cycles++;
    const cycleReport = {
      cycle_id: `cycle_${Date.now()}`,
      instance_id: this.instanceId,
      started_at: new Date().toISOString(),
      parcels_processed: 0,
      tasks_executed: [],
      alerts_generated: [],
      evaluations_performed: 0,
      stale_tasks_recovered: 0,
      errors: [],
    };

    try {
      // 1. Recuperación de tareas huérfanas
      const recovered = await agentTaskManager.recoverStaleTasks();
      cycleReport.stale_tasks_recovered = recovered;

      // 2. Identificar parcelas que requieren actualización
      const parcelsToUpdate = await this.getParcelsRequiringUpdate(forceAllParcels);

      for (const parcel of parcelsToUpdate.slice(0, this.config.maxParcelsPerCycle)) {
        try {
          // Heartbeat: renovar el lease distribuido para evitar expiración en lotes grandes
          if (!skipLease) {
            await this.renewLease(jobName, 600);
          }

          // Ejecutar flujo multiagente para la parcela
          const task = await orchestratorAgent.executeWorkflow({
            parcel_id: parcel.id,
            user_id: parcel.user_id,
            workflow_type: 'automated_scheduled_risk_assessment',
            include_monte_carlo: true,
            monte_carlo_iterations: 300,
            force_refresh: false,
          });

          cycleReport.tasks_executed.push({
            parcel_id: parcel.id,
            task_id: task.id,
            status: task.status,
            duration_ms: task.duration_ms,
          });

          // 3. Persistir predicciones en ml_predictions_log
          const meteoStep = task.steps?.meteorological || {};
          const mlStep = task.steps?.predictive_ml || {};
          const weatherSource = meteoStep.provenance?.source || 'Open-Meteo ERA5 / Forecast API';

          await predictionPersistenceService.persistWorkflowPredictions(
            task.id,
            parcel.id,
            mlStep,
            weatherSource
          );

          // 4. Preparar y entregar alertas inteligentes deduplicadas
          const alertsCreated = await this.dispatchSmartAlertsForTask(parcel, task);
          cycleReport.alerts_generated.push(...alertsCreated);

          cycleReport.parcels_processed++;
          this.telemetry.parcels_updated_count++;

          // Pausa preventiva de 300ms entre parcelas para respetar límites HTTP
          await new Promise(r => setTimeout(r, 300));
        } catch (parcelErr) {
          console.error(`[SchedulerService] Error procesando parcela ${parcel.id}:`, parcelErr.message);
          cycleReport.errors.push({
            parcel_id: parcel.id,
            error: parcelErr.message,
          });
        }
      }

      // 5. Comparar predicciones vencidas contra observaciones de campo
      const evalResult = await predictionPersistenceService.evaluatePredictionsAgainstObservations();
      cycleReport.evaluations_performed = evalResult.evaluated_count + evalResult.expired_count;

      const durationMs = Date.now() - tStart;
      this.telemetry.last_run_at = new Date().toISOString();
      this.telemetry.last_duration_ms = durationMs;
      this.telemetry.successful_cycles++;
      this.telemetry.last_error = null;

      if (!skipLease) {
        await this.releaseLease(jobName, 'completed');
      }

      return {
        success: true,
        duration_ms: durationMs,
        ...cycleReport,
      };
    } catch (cycleErr) {
      const failDurationMs = Date.now() - tStart;
      console.error('[SchedulerService] Error general en ciclo automatizado:', cycleErr.message);

      this.telemetry.failed_cycles++;
      this.telemetry.last_error = cycleErr.message;
      this.telemetry.last_duration_ms = failDurationMs;

      if (!skipLease) {
        await this.releaseLease(jobName, 'failed', cycleErr.message);
      }

      throw cycleErr;
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      this.isRunningCycle = false;
    }
  }

  /**
   * Obtiene la lista de parcelas que requieren actualización
   * @param {boolean} forceAll
   */
  async getParcelsRequiringUpdate(forceAll = false) {
    if (forceAll) {
      return await db.dbAll("SELECT id, user_id, name, crop_type, latitude, longitude, altitude_masl FROM parcels WHERE status = 'activa' OR status IS NULL");
    }

    // Busca parcelas cuya última predicción tenga más de STALE_THRESHOLD_HOURS horas o no exista
    const sql = `
      SELECT p.id, p.user_id, p.name, p.crop_type, p.latitude, p.longitude, p.altitude_masl,
             MAX(l.emitted_at) as last_prediction_at
      FROM parcels p
      LEFT JOIN ml_predictions_log l ON p.id = l.parcel_id
      WHERE (p.status = 'activa' OR p.status IS NULL)
      GROUP BY p.id, p.user_id, p.name, p.crop_type, p.latitude, p.longitude, p.altitude_masl
      HAVING MAX(l.emitted_at) IS NULL
          OR MAX(l.emitted_at) < NOW() - (? * INTERVAL '1 hour')
      ORDER BY last_prediction_at ASC NULLS FIRST
    `;

    return await db.dbAll(sql, [this.config.staleThresholdHours]);
  }

  /**
   * Despacha alertas inteligentes deduplicadas respetando preferencias del usuario
   * @param {object} parcel
   * @param {object} task
   * @returns {Promise<Array<object>>}
   */
  async dispatchSmartAlertsForTask(parcel, task) {
    const alertsDispatched = [];
    const userId = parcel.user_id;
    const parcelId = parcel.id;

    // 1. Obtener preferencias de alerta del usuario
    const prefs = await db.dbGet('SELECT * FROM alert_preferences WHERE user_id = ?', [userId]) || {
      frost_enabled: 1,
      heavy_rain_enabled: 1,
      snow_enabled: 1,
      hail_enabled: 1,
      min_risk_level: 'moderate',
    };

    const mlStep = task.steps?.predictive_ml || {};
    const agriStep = task.steps?.agricultural_operative || {};
    const p24 = mlStep.predictions_by_horizon?.['24h'] || {};
    const strategies = agriStep.mitigation_strategies || [];

    const phenomenaMap = {
      frost: { enabled: prefs.frost_enabled !== 0, name: 'Helada', type: 'alerta_helada' },
      heavy_rain: { enabled: prefs.heavy_rain_enabled !== 0, name: 'Lluvia Intensa', type: 'alerta_lluvia' },
      snow: { enabled: prefs.snow_enabled !== 0, name: 'Nevada', type: 'alerta_nevada' },
      hail: { enabled: prefs.hail_enabled !== 0, name: 'Granizada', type: 'alerta_granizo' },
    };

    for (const [phen, config] of Object.entries(phenomenaMap)) {
      if (!config.enabled) continue;

      const pred = p24[phen];
      if (!pred) continue;

      const riskLevel = pred.risk_level || 'none';
      const riskScore = pred.risk_score || 0;

      // Verificar umbral mínimo de riesgo
      const isEligible = (riskLevel === 'high') || (riskLevel === 'moderate' && prefs.min_risk_level !== 'high');
      if (!isEligible) continue;

      // Buscar estrategias preventivas asociadas a este fenómeno
      const matchedStrat = strategies.find(s => s.phenomenon === phen || (s.strategy_id || '').toLowerCase().includes(phen));
      const stratNote = matchedStrat ? ` Medida recomendada: ${matchedStrat.title}.` : '';

      const severity = riskLevel === 'high' ? 'critical' : 'warning';
      const title = `Alerta Agroclimática: ${config.name} — ${parcel.name}`;
      const message = `Se anticipa ${config.name.toLowerCase()} en las próximas 24 horas para ${parcel.name} con riesgo ${riskLevel.toUpperCase()} (${riskScore}%).${stratNote}`;

      // Enviar de forma atómica y deduplicada
      const alertResult = await notificationService.createWeatherAlertAtomically({
        userId,
        type: config.type,
        title,
        message,
        severity,
        parcelId,
        parcelName: parcel.name,
        phenomenon: phen,
        modelType: pred.algorithm || 'ml_trained',
        windowHours: 6, // Deduplica si ya se envió en las últimas 6 horas
      });

      if (alertResult && alertResult.created) {
        alertsDispatched.push({
          alert_id: alertResult.id,
          parcel_id: parcelId,
          phenomenon: phen,
          risk_level: riskLevel,
          title,
        });
        this.telemetry.alerts_emitted_count++;
      }
    }

    return alertsDispatched;
  }

  /**
   * Obtiene el estado y telemetría operativa del planificador
   */
  async getStatus() {
    const lock = await db.dbGet("SELECT * FROM scheduler_locks WHERE job_name = 'multiagent_automated_cycle'") || {};

    return {
      scheduler: {
        instance_id: this.instanceId,
        enabled: this.config.enabled,
        active_interval_running: Boolean(this.intervalId),
        interval_minutes: this.config.intervalMinutes,
        stale_threshold_hours: this.config.staleThresholdHours,
        max_parcels_per_cycle: this.config.maxParcelsPerCycle,
      },
      distributed_lock: {
        job_name: lock.job_name || 'multiagent_automated_cycle',
        status: lock.last_status || 'idle',
        locked_by: lock.locked_by || null,
        expires_at: lock.expires_at || null,
        last_run_at: lock.last_run_at || this.telemetry.last_run_at,
        last_error: lock.last_error || this.telemetry.last_error,
      },
      telemetry: {
        ...this.telemetry,
        uptime_seconds: Math.round(process.uptime()),
      },
    };
  }
}

module.exports = new SchedulerService();
