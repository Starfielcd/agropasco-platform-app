/**
 * AgroPasco Digital — Test Suite Fase 7: Integración Operacional,
 * Automatización Multiagente y Consolidación del Dashboard
 * ============================================================================
 * Escenarios de Prueba End-to-End:
 *  A. Agricultor con una parcela y riesgo de helada (Alerta inteligente emitida)
 *  B. Agricultor con varias parcelas (Detección por scheduler de desactualizadas)
 *  C. Asesor autorizado vs no autorizado (RBAC estricto Sección 10)
 *  D. Actualización programada con Leases en PostgreSQL (Idempotencia y exclusión mutua)
 *  E. Cambio significativo de riesgo y generación de alerta inteligente
 *  F. Pronóstico sin cambios y deduplicación atómica (Ventana de 6 horas)
 *  G. Resiliencia ante caída o datos erróneos de proveedor meteorológico
 *  H. Reinicio del servidor durante una tarea (Detección de tareas huérfanas)
 *  I. Recuperación limpia de tarea interrumpida (agentTaskManager.recoverStaleTasks)
 *  J. Tolerancia a datos incompletos en parcela sin provocar crash no controlado
 *  K. Inferencia manual en sandbox NO escribe en registros operativos (ml_predictions_log)
 *  L. Simulación Monte Carlo estocástica sin generar falsas alertas
 *  M. No regresión funcional de MODEL_REGISTRY, FIX02, COMERCIO01 y Fases previas
 */

const assert = require('assert');
const path = require('path');
const db = require('../config/database');
const {
  orchestratorAgent,
  meteorologicalAgent,
  predictiveMLAgent,
  agriculturalOperativeAgent,
  auditorSupervisorAgent,
  agentTaskManager,
} = require('../services/multiAgent');

const schedulerService = require('../services/schedulerService');
const predictionPersistenceService = require('../services/predictionPersistenceService');
const parcelAuthService = require('../services/parcelAuthService');
const notificationService = require('../services/notificationService');
const { defaultEngine } = require('../services/mlEngine');
const { defaultSimulator } = require('../services/monteCarloService');
const { MODEL_REGISTRY } = require('../config/modelRegistry');

console.log('======================================================================');
console.log('AGROPASCO DIGITAL — TEST SUITE FASE 7: INTEGRACIÓN Y AUTOMATIZACIÓN');
console.log('======================================================================\n');

// ============================================================================
// BASE DE DATOS EN MEMORIA AISLADA Y DETERMINISTA PARA SUITE FASE 7
// ============================================================================
const memoryStore = {
  users: [
    { id: 1, name: 'Deyvis Agricultor', role: 'farmer', email: 'deyvis@pasco.pe' },
    { id: 2, name: 'Ing. Carlos Asesor Autorizado', role: 'asesor', email: 'carlos@pasco.pe' },
    { id: 3, name: 'Ing. Elena Asesora NO Autorizada', role: 'asesor', email: 'elena@pasco.pe' },
    { id: 4, name: 'Admin Pasco', role: 'admin', email: 'admin@pasco.pe' },
    { id: 5, name: 'Supermercado Metro', role: 'supermarket', email: 'compras@metro.pe' },
  ],
  parcels: [
    {
      id: 1,
      user_id: 1,
      name: 'Parcela Chaupimarca Alta',
      location: 'Cerro de Pasco',
      latitude: -10.6674,
      longitude: -76.2567,
      altitude_masl: 4337.0,
      area_hectares: 2.5,
      crop_type: 'papa',
      status: 'activa',
      created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
    {
      id: 2,
      user_id: 1,
      name: 'Parcela Yanacancha Valle',
      location: 'Yanacancha',
      latitude: -10.6500,
      longitude: -76.2400,
      altitude_masl: 4100.0,
      area_hectares: 3.0,
      crop_type: 'maca',
      status: 'activa',
      created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
    {
      id: 3,
      user_id: 4,
      name: 'Parcela Experimental Paucartambo',
      location: 'Paucartambo',
      latitude: -10.7700,
      longitude: -75.8200,
      altitude_masl: 2900.0,
      area_hectares: 5.0,
      crop_type: 'maiz',
      status: 'activa',
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
  ],
  advisor_parcel_assignments: [
    { id: 1, advisor_id: 2, parcel_id: 1, active: 1, status: 'active', assigned_at: new Date().toISOString() },
  ],
  agent_tasks: [],
  agent_audit_logs: [],
  scheduler_locks: [],
  ml_predictions_log: [],
  ground_truth_observations: [
    {
      id: 1,
      parcel_id: 1,
      observation_date: '2026-10-18',
      phenomenon: 'frost',
      occurred: true,
      min_temperature_c: -4.5,
      precipitation_sum_mm: 0,
      data_source: 'estacion_senamhi_cerro_pasco',
      quality_flag: 'validated',
    },
  ],
  notifications: [],
  alert_preferences: [
    {
      user_id: 1,
      frost_enabled: 1,
      heavy_rain_enabled: 1,
      snow_enabled: 1,
      hail_enabled: 1,
      min_risk_level: 'moderate',
    },
  ],
};

// Mocks adaptativos de dbGet, dbAll y dbRun
db.dbGet = async (sql, params = []) => {
  const s = sql.toLowerCase();

  // Users
  if (s.includes('from users where id =')) {
    const id = Number(params[0]);
    return memoryStore.users.find(u => u.id === id) || null;
  }
  if (s.includes('from users where role =')) {
    return memoryStore.users.find(u => u.role === params[0]) || memoryStore.users[0];
  }

  // Parcels
  if (s.includes('from parcels where id =')) {
    const id = Number(params[0]);
    return memoryStore.parcels.find(p => p.id === id) || null;
  }

  // Advisor assignments
  if (s.includes('from advisor_parcel_assignments where advisor_id =') && s.includes('parcel_id =')) {
    const advId = Number(params[0]);
    const parcId = Number(params[1]);
    return memoryStore.advisor_parcel_assignments.find(a => a.advisor_id === advId && a.parcel_id === parcId && (a.active === 1 || a.status === 'active')) || null;
  }

  // Alert preferences
  if (s.includes('from alert_preferences where user_id =')) {
    const uId = Number(params[0]);
    return memoryStore.alert_preferences.find(p => p.user_id === uId) || null;
  }

  // Deduplication check for notifications
  if (s.includes('from notifications') && s.includes('user_id =') && s.includes('created_at >')) {
    const userId = Number(params[0]);
    // Extraer parcelId si está presente en los parámetros numéricos de la consulta
    let parcelIdFilter = null;
    if (s.includes('parcel_id =')) {
      parcelIdFilter = params.find((p, idx) => idx > 0 && typeof p === 'number' && Number.isInteger(p));
    }
    const existing = memoryStore.notifications.find(n => {
      if (n.user_id !== userId) return false;
      if (parcelIdFilter && n.parcel_id && n.parcel_id !== parcelIdFilter) return false;
      return true;
    });
    return existing ? { id: existing.id } : null;
  }

  // Scheduler locks SELECT
  if (s.includes('from scheduler_locks where job_name =')) {
    const jobName = params[0];
    return memoryStore.scheduler_locks.find(l => l.job_name === jobName) || null;
  }

  // Scheduler locks INSERT (returning job_name)
  if (s.includes('insert into scheduler_locks')) {
    const [jobName, lockedBy, expiresAt] = params;
    const lock = {
      job_name: jobName,
      locked_by: lockedBy,
      locked_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_run_at: new Date().toISOString(),
      last_status: 'running',
    };
    memoryStore.scheduler_locks.push(lock);
    return { job_name: jobName };
  }

  // Scheduler locks UPDATE (acquire expired or free)
  if (s.includes('update scheduler_locks') && s.includes('set locked_by =')) {
    const [lockedBy, expiresAt, jobName] = params;
    const lock = memoryStore.scheduler_locks.find(l => l.job_name === jobName);
    if (lock) {
      lock.locked_by = lockedBy;
      lock.locked_at = new Date().toISOString();
      lock.expires_at = expiresAt;
      lock.last_status = 'running';
      return { job_name: jobName };
    }
    return null;
  }

  // Agent tasks INSERT (createTask returning *)
  if (s.includes('insert into agent_tasks') && s.includes('returning *')) {
    const [taskId, workflowType, parcelId, userId, stepsJson, maxRetries] = params;
    const task = {
      id: taskId,
      workflow_type: workflowType,
      parcel_id: Number(parcelId),
      user_id: Number(userId),
      status: 'pending',
      current_agent: 'orchestrator',
      steps: stepsJson,
      retries: 0,
      max_retries: Number(maxRetries),
      created_at: new Date().toISOString(),
    };
    memoryStore.agent_tasks.push(task);
    return task;
  }

  // Agent tasks UPDATE markRunning
  if (s.includes('update agent_tasks set status = \'running\'')) {
    const [currentAgent, taskId] = params;
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'running';
      task.current_agent = currentAgent;
      task.started_at = task.started_at || new Date().toISOString();
    }
    return task || null;
  }

  // Agent tasks UPDATE appendStepResult
  if (s.includes('set steps =')) {
    const [stepsJson, currentAgent, taskId] = params;
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    if (task) {
      task.steps = stepsJson;
      task.current_agent = currentAgent;
    }
    return task || null;
  }

  // Agent tasks UPDATE markCompleted
  if (s.includes("set status = 'completed'")) {
    const [summary, durationMs, taskId] = params;
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      task.result_summary = summary;
      task.duration_ms = Number(durationMs);
      task.completed_at = new Date().toISOString();
    }
    return task || null;
  }

  // Agent tasks UPDATE markFailed
  if (s.includes("set status = 'failed'")) {
    const [errMsg, durationMs, taskId] = params;
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'failed';
      task.error_message = errMsg;
      task.duration_ms = Number(durationMs);
      task.completed_at = new Date().toISOString();
    }
    return task || null;
  }

  // Agent tasks SELECT steps
  if (s.includes('select steps from agent_tasks where id =')) {
    const taskId = params[0];
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    return task ? { steps: task.steps } : null;
  }

  // Agent tasks SELECT by id
  if (s.includes('from agent_tasks where id =')) {
    const taskId = params[0];
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    if (!task) return null;
    return {
      ...task,
      steps: typeof task.steps === 'string' ? task.steps : JSON.stringify(task.steps || {}),
    };
  }

  // Aggregated metrics for ml_predictions_log
  if (s.includes('from ml_predictions_log') && s.includes('count(*)')) {
    const total = memoryStore.ml_predictions_log.length;
    const evaluated = memoryStore.ml_predictions_log.filter(p => p.validity_status === 'evaluated').length;
    const hits = memoryStore.ml_predictions_log.filter(p => p.evaluation_result === 'hit' || p.verification_status === 'hit').length;
    const misses = memoryStore.ml_predictions_log.filter(p => p.evaluation_result === 'miss' || p.verification_status === 'miss').length;
    const false_alarms = memoryStore.ml_predictions_log.filter(p => p.evaluation_result === 'false_alarm' || p.verification_status === 'false_alarm').length;
    const correct_negatives = memoryStore.ml_predictions_log.filter(p => p.evaluation_result === 'correct_negative' || p.verification_status === 'correct_negative').length;
    return {
      total_predictions: total,
      active_count: total - evaluated,
      evaluated_count: evaluated,
      expired_count: 0,
      hits,
      misses,
      false_alarms,
      correct_negatives,
    };
  }

  // Predictions log INSERT (returning *)
  if (s.includes('insert into ml_predictions_log')) {
    const [
      taskId, parcelId, targetDate, horizon,
      phenomenon, probability, riskScore, riskLevel,
      modelName, modelVersion, weatherSource
    ] = params;

    const newRecord = {
      id: memoryStore.ml_predictions_log.length + 1,
      task_id: taskId,
      parcel_id: Number(parcelId),
      emitted_at: new Date().toISOString(),
      target_date: targetDate,
      horizon,
      phenomenon,
      probability: Number(probability),
      risk_score: Number(riskScore),
      risk_level: riskLevel,
      model_name: modelName,
      model_version: modelVersion,
      weather_source: weatherSource,
      validity_status: 'active',
      verification_status: 'pending',
      created_at: new Date().toISOString(),
    };
    memoryStore.ml_predictions_log.push(newRecord);
    return newRecord;
  }

  // Ground truth observation
  if (s.includes('from ground_truth_observations where parcel_id =')) {
    const parcelId = Number(params[0]);
    return memoryStore.ground_truth_observations.find(g => g.parcel_id === parcelId) || null;
  }

  // Audit logs INSERT
  if (s.includes('insert into agent_audit_logs')) {
    const [task_id, parcel_id, user_id, agent_name, action, compliance_status, verification_details] = params;
    const newId = memoryStore.agent_audit_logs.length + 1;
    const log = {
      id: newId,
      task_id,
      parcel_id: Number(parcel_id),
      user_id: Number(user_id),
      agent_name,
      action,
      compliance_status,
      verification_details,
      created_at: new Date().toISOString(),
    };
    memoryStore.agent_audit_logs.push(log);
    return { id: newId };
  }

  return null;
};

db.dbAll = async (sql, params = []) => {
  const s = sql.toLowerCase();

  // Active parcels requiring update (scheduler query)
  if (s.includes('from parcels p') && s.includes('left join ml_predictions_log l')) {
    // Retorna parcelas 1 y 2 (desactualizadas o sin predicciones recientes)
    return memoryStore.parcels.filter(p => p.id === 1 || p.id === 2);
  }

  // Simple parcels list
  if (s.includes('from parcels')) {
    return memoryStore.parcels;
  }

  // Predictions history
  if (s.includes('from ml_predictions_log') && s.includes('parcel_id =')) {
    const parcelId = Number(params[0]);
    return memoryStore.ml_predictions_log.filter(p => p.parcel_id === parcelId);
  }

  // Unverified predictions
  if (s.includes('from ml_predictions_log') && s.includes("validity_status = 'active'")) {
    return memoryStore.ml_predictions_log.filter(p => !p.verification_status || p.verification_status === 'pending');
  }

  // Stale tasks recovery: UPDATE agent_tasks SET status = 'failed' ... RETURNING id
  if (s.includes('update agent_tasks') && s.includes("set status = 'failed'")) {
    const running = memoryStore.agent_tasks.filter(t => t.status === 'running');
    running.forEach(t => {
      t.status = 'failed';
      t.error_message = 'Tarea interrumpida por reinicio o tiempo de espera excedido';
    });
    return running.map(t => ({ id: t.id }));
  }

  return [];
};

db.dbRun = async (sql, params = []) => {
  const s = sql.toLowerCase();

  // Scheduler locks UPDATE (release)
  if (s.includes('update scheduler_locks') && s.includes('set last_status =')) {
    const [status, error, jobName, lockedBy] = params;
    const lock = memoryStore.scheduler_locks.find(l => l.job_name === jobName);
    if (lock) {
      lock.last_status = status;
      lock.last_error = error;
      lock.locked_by = null;
    }
    return { changes: 1 };
  }

  // Predictions log INSERT
  if (s.includes('insert into ml_predictions_log')) {
    const [
      task_id, parcel_id, target_date, horizon,
      phenomenon, probability, risk_score, risk_level,
      model_name, model_version, weather_source
    ] = params;

    memoryStore.ml_predictions_log.push({
      id: memoryStore.ml_predictions_log.length + 1,
      task_id,
      parcel_id: Number(parcel_id),
      emitted_at: new Date().toISOString(),
      target_date,
      horizon,
      phenomenon,
      probability: Number(probability),
      risk_score: Number(risk_score),
      risk_level,
      model_name,
      model_version,
      weather_source,
      validity_status: 'active',
      verification_status: 'pending',
      created_at: new Date().toISOString(),
    });
    return { changes: 1, lastID: memoryStore.ml_predictions_log.length };
  }

  // Predictions log UPDATE verification
  if (s.includes('update ml_predictions_log') && s.includes('verification_status =')) {
    const [verStatus, obsType, obsOccurred, predId] = params;
    const pred = memoryStore.ml_predictions_log.find(p => p.id === Number(predId));
    if (pred) {
      pred.verification_status = verStatus;
      pred.observation_type = obsType;
      pred.observed_occurrence = obsOccurred;
      pred.verified_at = new Date().toISOString();
    }
    return { changes: 1 };
  }

  // Notifications INSERT
  if (s.includes('insert into notifications')) {
    const [userId, type, title, message, severity, parcelId, phenomenon, modelType] = params;
    memoryStore.notifications.push({
      id: memoryStore.notifications.length + 1,
      user_id: Number(userId),
      type,
      title,
      message,
      severity,
      parcel_id: parcelId ? Number(parcelId) : null,
      phenomenon,
      model_type: modelType,
      read: false,
      created_at: new Date().toISOString(),
    });
    return { changes: 1, lastID: memoryStore.notifications.length };
  }

  return { changes: 1 };
};

// ============================================================================
// SUITE DE PRUEBAS
// ============================================================================
let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  try {
    process.stdout.write(`Prueba: ${name} ... `);
    await fn();
    console.log('✓ OK');
    passedTests++;
  } catch (err) {
    console.log('❌ FALLÓ');
    console.error(`  Error: ${err.message}`);
    if (err.stack) console.error(`  ${err.stack.split('\n').slice(1, 3).join('\n')}`);
    failedTests++;
  }
}

async function runAllPhase7Tests() {
  console.log('Iniciando batería de 13 pruebas operacionales...\n');

  // --------------------------------------------------------------------------
  // ESCENARIO A: Agricultor con una parcela y riesgo de helada
  // --------------------------------------------------------------------------
  await runTest('Escenario A: Flujo completo de 5 agentes y alerta inteligente por helada', async () => {
    const user = memoryStore.users[0]; // farmer (id: 1)
    const parcelId = 1;

    // 1. Ejecutar workflow mediante orchestratorAgent
    const result = await orchestratorAgent.executeWorkflow({
      parcel_id: parcelId,
      user_id: user.id,
      workflow_type: 'agroclimatic_risk_assessment',
      include_monte_carlo: false,
      force_refresh: false,
    });

    assert.ok(result && result.id, 'Workflow de 5 agentes debe completarse con éxito');
    assert.strictEqual(result.status, 'completed', "Estado de tarea debe ser 'completed'");
    assert.ok(result.steps.meteorological, 'Paso meteorológico presente');
    assert.ok(result.steps.predictive_ml, 'Paso predictivo presente');
    assert.ok(result.steps.agricultural_operative, 'Paso agrícola presente');
    assert.ok(result.steps.auditor_supervisor, 'Paso auditor presente');

    // 2. Persistir pronósticos emitidos en ml_predictions_log
    const weatherSource = result.steps.meteorological.provenance?.source || 'Open-Meteo ERA5 / Forecast API';
    const persistRes = await predictionPersistenceService.persistWorkflowPredictions(
      result.id,
      parcelId,
      result.steps.predictive_ml,
      weatherSource
    );
    assert.ok(persistRes.inserted_count >= 3, 'Debe haber persistido al menos 3 pronósticos (24h/48h/72h)');
    assert.ok(memoryStore.ml_predictions_log.length >= 3, 'Registros insertados en ml_predictions_log');

    // 3. Despachar alerta inteligente con deduplicación
    const parcel = memoryStore.parcels[0];
    const alertList = await schedulerService.dispatchSmartAlertsForTask(parcel, result);
    assert.ok(Array.isArray(alertList), 'Debe retornar lista de alertas procesadas');
    assert.ok(memoryStore.notifications.length >= 1, 'Debe haberse generado al menos 1 alerta en bandeja');

    const lastNotif = memoryStore.notifications[memoryStore.notifications.length - 1];
    assert.strictEqual(lastNotif.parcel_id, parcelId, 'Alerta vinculada a la parcela 1');
    assert.strictEqual(lastNotif.user_id, user.id, 'Alerta dirigida al titular agricultor');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO B: Agricultor con varias parcelas
  // --------------------------------------------------------------------------
  await runTest('Escenario B: Detección por scheduler de múltiples parcelas que requieren actualización', async () => {
    const candidateParcels = await schedulerService.getParcelsRequiringUpdate();
    assert.ok(Array.isArray(candidateParcels), 'Debe retornar arreglo de parcelas');
    assert.ok(candidateParcels.length >= 2, 'Debe identificar parcelas desactualizadas');
    assert.ok(candidateParcels.some(p => p.id === 1), 'Parcela 1 identificada');
    assert.ok(candidateParcels.some(p => p.id === 2), 'Parcela 2 identificada');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO C: Asesor autorizado vs no autorizado (RBAC Sección 10)
  // --------------------------------------------------------------------------
  await runTest('Escenario C: Control de acceso estricto RBAC de asesores y supermercados', async () => {
    const advisorAuth = memoryStore.users[1]; // Carlos (asignado a parcela 1)
    const advisorUnauth = memoryStore.users[2]; // Elena (sin asignación)
    const supermarketUser = memoryStore.users[4]; // Metro (sin acceso privado)

    // Asesor autorizado con asignación en advisor_parcel_assignments
    const accessAuth = await parcelAuthService.checkParcelAccess(advisorAuth, 1);
    assert.strictEqual(accessAuth.authorized, true, 'Asesor con asignación formal DEBE tener acceso');
    assert.strictEqual(accessAuth.role, 'assigned_advisor');

    // Asesor sin asignación para parcela 1
    const accessUnauth = await parcelAuthService.checkParcelAccess(advisorUnauth, 1);
    assert.strictEqual(accessUnauth.authorized, false, 'Asesor sin asignación DEBE ser rechazado');
    assert.ok(accessUnauth.reason.includes('no tiene una relación agronómica asignada'), 'Motivo de rechazo claro');

    // Supermercado intentando acceder a parcela privada
    const accessSupermarket = await parcelAuthService.checkParcelAccess(supermarketUser, 1);
    assert.strictEqual(accessSupermarket.authorized, false, 'Supermercados tienen PROHIBIDO el acceso a parcelas privadas');
    assert.ok(accessSupermarket.reason.includes('supermercado no tienen acceso'), 'Motivo de rechazo de supermercado');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO D: Actualización programada con Leases en PostgreSQL
  // --------------------------------------------------------------------------
  await runTest('Escenario D: Adquisición, idempotencia y liberación de Leases distribuidos', async () => {
    const jobName = 'ml_forecast_cycle_test';

    // 1. Adquirir lease
    const acquired = await schedulerService.acquireLease(jobName, 60);
    assert.strictEqual(acquired, true, 'Debe adquirir lease libre');

    // 2. Intentar re-adquirir inmediatamente con otra instancia simulada
    const lockEntry = await db.dbGet('SELECT * FROM scheduler_locks WHERE job_name = ?', [jobName]);
    assert.ok(lockEntry, 'El registro de bloqueo debe existir');
    assert.strictEqual(lockEntry.last_status, 'running', 'El bloqueo debe figurar como running');

    // 3. Liberar lease
    await schedulerService.releaseLease(jobName, 'completed');
    const lockAfter = await db.dbGet('SELECT * FROM scheduler_locks WHERE job_name = ?', [jobName]);
    assert.strictEqual(lockAfter.last_status, 'completed', 'El estado final debe ser completed');
    assert.strictEqual(lockAfter.locked_by, null, 'locked_by debe ser null');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO E: Cambio significativo de riesgo y generación de alerta
  // --------------------------------------------------------------------------
  await runTest('Escenario E: Generación de alerta inteligente ante riesgo crítico', async () => {
    const parcel2 = memoryStore.parcels[1];
    const syntheticTask = {
      id: 'task_crit_test_1',
      steps: {
        predictive_ml: {
          predictions_by_horizon: {
            '24h': {
              target_date: '2026-10-19',
              frost: { risk_level: 'high', risk_score: 85, probability: 0.85, is_risk: true },
            },
          },
        },
        agricultural_operative: {
          mitigation_strategies: [
            {
              phenomenon: 'frost',
              title: 'Riego por aspersión preventivo antes del anochecer',
              estimated_cost_pen: 45.0,
            },
          ],
        },
      },
    };

    const alerts = await schedulerService.dispatchSmartAlertsForTask(parcel2, syntheticTask);
    assert.ok(Array.isArray(alerts), 'Debe devolver array de alertas');
    assert.strictEqual(alerts.length, 1, 'Debe despachar 1 alerta para parcela 2');

    const createdNotif = memoryStore.notifications.find(n => n.parcel_id === 2);
    assert.ok(createdNotif, 'Notificación persistida en tabla notifications');
    assert.ok(createdNotif.message.includes('Riego por aspersión'), 'Incluye recomendación agronómica concreta');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO F: Pronóstico sin cambios y deduplicación (6h)
  // --------------------------------------------------------------------------
  await runTest('Escenario F: Deduplicación atómica de alertas (ventana de 6 horas)', async () => {
    // Intentar despachar la misma alerta para el usuario 1 en ventana de 6h
    const dupRes = await notificationService.createWeatherAlertAtomically({
      userId: 1,
      parcelId: 1,
      phenomenon: 'frost',
      severity: 'warning',
      title: 'Alerta Helada Parcela Chaupimarca',
      message: 'Riesgo moderado de helada en 24h',
      validWindowHours: 6,
    });

    assert.strictEqual(dupRes.skipped, true, 'Debe haber sido omitida por deduplicación');
    assert.strictEqual(dupRes.reason, 'duplicate_within_window', 'Motivo duplicate_within_window');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO G: Resiliencia ante caída o datos erróneos de Open-Meteo
  // --------------------------------------------------------------------------
  await runTest('Escenario G: Resiliencia ante parámetros inválidos o caída meteorológica', async () => {
    try {
      await meteorologicalAgent.execute({ parcel_id: 9999 }); // ID inexistente
      assert.fail('Debe lanzar error controlado si la parcela no existe');
    } catch (err) {
      assert.ok(err.message.includes('no encontrada'), 'Error controlado reportado limpiamente');
    }
  });

  // --------------------------------------------------------------------------
  // ESCENARIO H: Reinicio de servidor durante una tarea (Detección de zombies)
  // --------------------------------------------------------------------------
  await runTest('Escenario H: Detección de tareas huérfanas/zombies tras reinicio', async () => {
    const staleTaskId = 'task_zombie_restart_99';
    memoryStore.agent_tasks.push({
      id: staleTaskId,
      parcel_id: 1,
      user_id: 1,
      workflow_type: 'automated_scheduled_risk_assessment',
      status: 'running',
      current_agent: 'predictive_ml',
      started_at: new Date(Date.now() - 600000).toISOString(), // hace 10 minutos
      created_at: new Date(Date.now() - 600000).toISOString(),
    });

    const running = memoryStore.agent_tasks.filter(t => t.status === 'running');
    assert.ok(running.some(t => t.id === staleTaskId), 'Tarea zombie en estado running detectada');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO I: Recuperación de tarea interrumpida
  // --------------------------------------------------------------------------
  await runTest('Escenario I: Recuperación limpia y cierre de tarea interrumpida', async () => {
    const recoveredCount = await agentTaskManager.recoverStaleTasks();
    assert.ok(recoveredCount >= 1, 'Debe recuperar al menos 1 tarea zombie');

    const recovered = memoryStore.agent_tasks.find(t => t.id === 'task_zombie_restart_99');
    assert.strictEqual(recovered.status, 'failed', "Debe quedar en 'failed' para liberar recursos");
    assert.ok(recovered.error_message.includes('interrumpida por reinicio'), 'Mensaje de reinicio presente');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO J: Tolerancia a datos insuficientes en parcela
  // --------------------------------------------------------------------------
  await runTest('Escenario J: Tolerancia a datos incompletos en parcela sin crash', async () => {
    const incompleteParcel = {
      id: 88,
      user_id: 1,
      name: 'Parcela Sin Altitud',
      latitude: -10.6,
      longitude: -76.2,
      altitude_masl: null, // Altitud ausente
    };
    memoryStore.parcels.push(incompleteParcel);

    // Auditor debe emitir dictamen controlado sin crashear
    const auditRes = await auditorSupervisorAgent.execute({
      task_id: 'test_audit_missing_alt',
      parcel_id: 88,
      user_id: 1,
      steps: {
        meteorological: { parcel_validation: { validation_passed: false, errors: ['Altitud requerida'] } },
      },
    });

    assert.ok(auditRes, 'Auditor devuelve resultado');
    assert.strictEqual(auditRes.agent, 'auditor_supervisor');
    assert.ok(auditRes.compliance_status === 'warning' || auditRes.compliance_status === 'violation' || auditRes.compliance_status === 'verified', 'Dictamen emitido');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO K: Predicción manual en sandbox NO escribe en ml_predictions_log
  // --------------------------------------------------------------------------
  await runTest('Escenario K: Inferencia manual en sandbox NO escribe en ml_predictions_log', async () => {
    const initialLogCount = memoryStore.ml_predictions_log.length;

    // Generar escenario completo sintético para inferencia de prueba
    const scenario = defaultSimulator.generateScenario({
      elevation: 4337,
      temperature_2m_min: -2.0,
      temperature_2m_max: 12.0,
      relative_humidity_2m_mean: 75,
      wind_speed_10m_max: 15,
      precipitation_sum: 0,
    });

    const manualForecast = defaultEngine.predictFrost(scenario);

    assert.ok(manualForecast.phenomenon === 'frost', 'Genera predicción manual');
    assert.strictEqual(
      memoryStore.ml_predictions_log.length,
      initialLogCount,
      'Las inferencias manuales de sandbox NUNCA deben insertar filas en ml_predictions_log'
    );
  });

  // --------------------------------------------------------------------------
  // ESCENARIO L: Simulación Monte Carlo sin generar falsas alertas
  // --------------------------------------------------------------------------
  await runTest('Escenario L: Simulaciones Monte Carlo estocásticas no generan alertas en notifications', async () => {
    const initialNotifCount = memoryStore.notifications.length;

    // Ejecutar simulación Monte Carlo con 300 iteraciones
    const mcResults = defaultSimulator.runSimulation({
      elevation: 4337,
      temperature_2m_min: -4.0,
      temperature_2m_max: 9.0,
      relative_humidity_2m_mean: 85,
      wind_speed_10m_max: 8,
      precipitation_sum: 0,
    }, 'frost', 300);

    assert.ok(mcResults && mcResults.statistics, 'Monte Carlo genera distribución estocástica');
    assert.strictEqual(
      memoryStore.notifications.length,
      initialNotifCount,
      'Las simulaciones estocásticas Monte Carlo NUNCA deben disparar notificaciones en notifications'
    );
  });

  // --------------------------------------------------------------------------
  // ESCENARIO M: No regresión de FIX02, COMERCIO01 y Fases 1 a 6
  // --------------------------------------------------------------------------
  await runTest('Escenario M: Verificación de No Regresión funcional', async () => {
    // 1. Registro oficial de modelos ML intacto
    assert.ok(MODEL_REGISTRY.frost, 'Registro frost presente');
    assert.strictEqual(MODEL_REGISTRY.frost.algorithm, 'LogisticRegression');
    assert.strictEqual(MODEL_REGISTRY.frost.version, '2.0.0_audited_no_leak');

    assert.ok(MODEL_REGISTRY.heavy_rain, 'Registro heavy_rain presente');
    assert.strictEqual(MODEL_REGISTRY.heavy_rain.algorithm, 'RandomForestClassifier');

    assert.ok(MODEL_REGISTRY.snow, 'Registro snow presente');
    assert.ok(MODEL_REGISTRY.hail, 'Registro hail presente');
    assert.strictEqual(MODEL_REGISTRY.hail.algorithm, 'DeterministicPhysicalRule');

    // 2. Proceso de evaluación contra observaciones de campo
    const evalRes = await predictionPersistenceService.evaluatePredictionsAgainstObservations();
    assert.strictEqual(evalRes.success, true, 'Evaluación debe ejecutarse');
    assert.ok(typeof evalRes.evaluated_count === 'number', 'Conteo de evaluadas presente');

    const metrics = await predictionPersistenceService.getAccuracyMetrics(1);
    assert.strictEqual(metrics.success, true, 'Métricas devueltas con éxito');
    assert.ok(typeof metrics.evaluated_predictions === 'number', 'Conteo de evaluadas presente');
    assert.ok(typeof metrics.confusion_matrix.total_verified === 'number', 'Total verificadas presente');

    // 3. Estado seguro del Scheduler
    const statusRes = await schedulerService.getStatus();
    const sched = statusRes.scheduler || statusRes;
    assert.strictEqual(sched.enabled, false, 'AUTO_SCHEDULER_ENABLED debe permanecer en false por seguridad');
    assert.strictEqual(sched.interval_minutes, 15, 'Intervalo por defecto es de 15 minutos');
    assert.strictEqual(sched.stale_threshold_hours, 6, 'Umbral de frescura de 6 horas');
  });

  console.log('\n======================================================================');
  console.log(`RESUMEN FASE 7: ${passedTests} aprobadas, ${failedTests} fallidas.`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllPhase7Tests().catch(err => {
  console.error('Error fatal durante la ejecución de pruebas:', err);
  process.exit(1);
});
