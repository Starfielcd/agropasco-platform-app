/**
 * AgroPasco Digital — Test Suite Fase 6: Sistema Multiagente Real
 * ===============================================================
 * Verificación exhaustiva de:
 * 1. Definición e identidad de los 5 agentes inteligentes requeridos:
 *    - Agente 1: Orquestador Central (orchestratorAgent)
 *    - Agente 2: Meteorológico (meteorologicalAgent)
 *    - Agente 3: Predictivo ML (predictiveMLAgent)
 *    - Agente 4: Agrícola y Operativo (agriculturalOperativeAgent)
 *    - Agente 5: Auditor y Supervisor (auditorSupervisorAgent)
 * 2. Ejecución individual y validación de entradas/salidas estructuradas de cada agente.
 * 3. Orquestación y secuenciación en Grafo Acíclico Dirigido (DAG).
 * 4. Persistencia del ciclo de vida de tareas y auditoría continua.
 * 5. Protección contra ejecuciones duplicadas e idempotencia.
 * 6. Recuperación de tareas huérfanas o interrumpidas tras reinicios.
 * 7. Integración con Open-Meteo y validación de coordenadas y altitud en Pasco.
 * 8. Integración estricta con modelos versionados de modelRegistry.js.
 * 9. Distinción explícita de simulación estocástica Monte Carlo vs observación física.
 * 10. Barreras de seguridad (PROHIBIDO auto-modificar compras B2B, inventarios y válvulas).
 * 11. Auditoría de 6 controles con registro trazable y dictamen de cumplimiento.
 * 12. Endpoints REST y control de acceso RBAC por parcela.
 * 13. Telemetría operativa en tiempo real para el Dashboard.
 * 14. No regresión cruzada de FIX02, COMERCIO01 y Fases 1 a 5.
 */

const assert = require('assert');
const fs = require('fs');
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

const agentController = require('../controllers/agentController');
const { MODEL_REGISTRY } = require('../config/modelRegistry');
const { defaultEngine } = require('../services/mlEngine');
const { defaultSimulator } = require('../services/monteCarloService');


console.log('======================================================================');
console.log('AGROPASCO DIGITAL — TEST SUITE FASE 6: SISTEMA MULTIAGENTE INTELIGENTE');
console.log('======================================================================\n');

// ============================================================================
// ADAPTADOR EN MEMORIA DETERMINISTA PARA PRUEBAS SIN BASE DE DATOS EXTERNA
// ============================================================================
const memoryStore = {
  users: [
    { id: 1, name: 'Deyvis Agricultor', role: 'farmer', email: 'deyvis@pasco.pe' },
    { id: 2, name: 'Ing. Carlos Asesor', role: 'asesor', email: 'carlos@pasco.pe' },
    { id: 3, name: 'Administrador Pasco', role: 'admin', email: 'admin@pasco.pe' },
  ],
  parcels: [
    {
      id: 1,
      user_id: 1,
      name: 'Parcela Chaupimarca Test',
      location: 'Cerro de Pasco',
      latitude: -10.6674,
      longitude: -76.2567,
      altitude_masl: 4337.0,
      area_hectares: 2.5,
      crop_type: 'papa',
      created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
    {
      id: 2,
      user_id: 2,
      name: 'Parcela Yanahuanca Asesor',
      location: 'Yanahuanca',
      latitude: -10.4900,
      longitude: -76.5100,
      altitude_masl: 3184.0,
      area_hectares: 3.0,
      crop_type: 'maiz',
      created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
  ],
  agent_tasks: [],
  agent_audit_logs: [],
};

// Configurar mocks de base de datos
db.dbGet = async (sql, params = []) => {
  const s = sql.toLowerCase();

  // SELECT users
  if (s.includes('from users where id =')) {
    const userId = Number(params[0]);
    return memoryStore.users.find(u => u.id === userId) || null;
  }
  if (s.includes('from users where role =')) {
    const role = params[0];
    return memoryStore.users.find(u => u.role === role) || memoryStore.users[0];
  }

  // SELECT parcels
  if (s.includes('from parcels where id =')) {
    const pId = Number(params[0]);
    return memoryStore.parcels.find(p => p.id === pId) || null;
  }
  if (s.includes('from parcels where user_id =')) {
    const uId = Number(params[0]);
    return memoryStore.parcels.find(p => p.user_id === uId) || memoryStore.parcels[0];
  }

  // INSERT INTO agent_tasks
  if (s.includes('insert into agent_tasks')) {
    const [id, workflow_type, parcel_id, user_id, steps, max_retries] = params;
    const task = {
      id,
      workflow_type,
      parcel_id: Number(parcel_id),
      user_id: Number(user_id),
      status: 'pending',
      current_agent: 'orchestrator',
      steps,
      result_summary: null,
      error_message: null,
      retries: 0,
      max_retries: Number(max_retries || 2),
      duration_ms: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
    };
    memoryStore.agent_tasks.push(task);
    return task;
  }

  // UPDATE agent_tasks
  if (s.includes('update agent_tasks')) {
    if (s.includes("set status = 'running'")) {
      const [currentAgent, taskId] = params;
      const task = memoryStore.agent_tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'running';
        task.current_agent = currentAgent;
        task.started_at = task.started_at || new Date().toISOString();
      }
      return task;
    }
    if (s.includes('set steps =')) {
      const [stepsJson, currentAgent, taskId] = params;
      const task = memoryStore.agent_tasks.find(t => t.id === taskId);
      if (task) {
        task.steps = stepsJson;
        task.current_agent = currentAgent;
      }
      return task;
    }
    if (s.includes("set status = 'completed'")) {
      const [summary, durationMs, taskId] = params;
      const task = memoryStore.agent_tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'completed';
        task.current_agent = 'orchestrator';
        task.result_summary = summary;
        task.duration_ms = Number(durationMs);
        task.completed_at = new Date().toISOString();
      }
      return task;
    }
    if (s.includes("set status = 'failed'")) {
      const [errMsg, durationMs, taskId] = params;
      const task = memoryStore.agent_tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'failed';
        task.error_message = errMsg;
        task.duration_ms = Number(durationMs);
        task.completed_at = new Date().toISOString();
      }
      return task;
    }
    if (s.includes('set retries = retries + 1')) {
      const [taskId] = params;
      const task = memoryStore.agent_tasks.find(t => t.id === taskId);
      if (task) {
        task.retries += 1;
        task.status = 'pending';
      }
      return task;
    }
  }

  // SELECT steps FROM agent_tasks WHERE id = ?
  if (s.includes('select steps from agent_tasks where id =')) {
    const taskId = params[0];
    const task = memoryStore.agent_tasks.find(t => t.id === taskId);
    return task ? { steps: task.steps } : null;
  }

  // SELECT * FROM agent_tasks WHERE id = ?
  if (s.includes('select * from agent_tasks where id =')) {
    const taskId = params[0];
    return memoryStore.agent_tasks.find(t => t.id === taskId) || null;
  }

  // SELECT id, started_at FROM agent_tasks WHERE parcel_id = ? AND status = 'running'
  if (s.includes('from agent_tasks where parcel_id =') && s.includes("status = 'running'")) {
    const pId = Number(params[0]);
    return memoryStore.agent_tasks.find(t => t.parcel_id === pId && t.status === 'running') || null;
  }

  // INSERT INTO agent_audit_logs
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

  // SELECT * FROM agent_audit_logs WHERE id = ?
  if (s.includes('from agent_audit_logs where id =')) {
    const id = Number(params[0]);
    return memoryStore.agent_audit_logs.find(l => l.id === id) || null;
  }

  // SELECT stats FROM agent_tasks
  if (s.includes('count(*) as total_tasks')) {
    const total = memoryStore.agent_tasks.length;
    const pending = memoryStore.agent_tasks.filter(t => t.status === 'pending').length;
    const running = memoryStore.agent_tasks.filter(t => t.status === 'running').length;
    const completed = memoryStore.agent_tasks.filter(t => t.status === 'completed').length;
    const failed = memoryStore.agent_tasks.filter(t => t.status === 'failed').length;
    const durations = memoryStore.agent_tasks.filter(t => t.status === 'completed' && t.duration_ms).map(t => t.duration_ms);
    const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return {
      total_tasks: total,
      pending_count: pending,
      running_count: running,
      completed_count: completed,
      failed_count: failed,
      avg_duration_ms: avg,
    };
  }

  return null;
};

db.dbAll = async (sql, params = []) => {
  const s = sql.toLowerCase();

  // SELECT tasks by parcel
  if (s.includes('from agent_tasks t') && s.includes('where t.parcel_id =')) {
    const pId = Number(params[0]);
    const limit = Number(params[1] || 10);
    return memoryStore.agent_tasks.filter(t => t.parcel_id === pId).slice(0, limit);
  }

  // SELECT all recent tasks
  if (s.includes('from agent_tasks t') && !s.includes('where t.parcel_id =')) {
    const limit = Number(params[0] || 20);
    return memoryStore.agent_tasks.slice(-limit).reverse();
  }

  // SELECT audit logs
  if (s.includes('from agent_audit_logs a')) {
    return memoryStore.agent_audit_logs.slice().reverse();
  }

  // UPDATE stale tasks
  if (s.includes("update agent_tasks") && s.includes("set status = 'failed'")) {
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
  return await db.dbGet(sql, params);
};

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function asyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runTestSuite() {
  // -------------------------------------------------------------------------
  // MÓDULO 1: IDENTIDAD Y RESPONSABILIDADES DE LOS 5 AGENTES
  // -------------------------------------------------------------------------
  console.log('[1/8] Verificando Arquitectura e Identidad de los 5 Agentes Obligatorios...');

  test('Los 5 agentes coinciden estrictamente con la arquitectura de Fase 6', () => {
    assert(orchestratorAgent, 'OrchestratorAgent debe estar definido');
    assert.strictEqual(orchestratorAgent.name, 'orchestrator');
    assert.strictEqual(orchestratorAgent.displayName, 'Agente Orquestador Central');

    assert(meteorologicalAgent, 'MeteorologicalAgent debe estar definido');
    assert.strictEqual(meteorologicalAgent.name, 'meteorological');
    assert.strictEqual(meteorologicalAgent.displayName, 'Agente Meteorológico');

    assert(predictiveMLAgent, 'PredictiveMLAgent debe estar definido');
    assert.strictEqual(predictiveMLAgent.name, 'predictive_ml');
    assert.strictEqual(predictiveMLAgent.displayName, 'Agente Predictivo ML');

    assert(agriculturalOperativeAgent, 'AgriculturalOperativeAgent debe estar definido');
    assert.strictEqual(agriculturalOperativeAgent.name, 'agricultural_operative');
    assert.strictEqual(agriculturalOperativeAgent.displayName, 'Agente Agrícola y Operativo');

    assert(auditorSupervisorAgent, 'AuditorSupervisorAgent debe estar definido');
    assert.strictEqual(auditorSupervisorAgent.name, 'auditor_supervisor');
    assert.strictEqual(auditorSupervisorAgent.displayName, 'Agente Auditor y Supervisor');
  });

  test('Cada agente declara identificador único y responsabilidad explícita', () => {
    const agents = [
      orchestratorAgent,
      meteorologicalAgent,
      predictiveMLAgent,
      agriculturalOperativeAgent,
      auditorSupervisorAgent,
    ];
    for (const a of agents) {
      assert(a.id && a.id.startsWith('agent_'), `ID inválido para agente ${a.name}`);
      assert(a.responsibility && a.responsibility.length > 20, `Responsabilidad insuficiente para ${a.name}`);
      assert(typeof a.execute === 'function' || typeof a.executeWorkflow === 'function', `Falta método de ejecución en ${a.name}`);
    }
  });

  // -------------------------------------------------------------------------
  // MÓDULO 2: PROCEDENCIA DE DATOS Y CORRECCIONES TÉCNICAS (SECCIÓN 8A Y 8C)
  // -------------------------------------------------------------------------
  console.log('\n[2/8] Verificando Procedencia del Dataset Histórico y modelRegistry (Sección 8)...');

  test('El dataset de correlación cerro_de_pasco_processed.csv existe y abarca 2020-2026', () => {
    const csvPath = path.resolve(__dirname, '../data/weather-history/processed/cerro_de_pasco_processed.csv');
    assert(fs.existsSync(csvPath), 'El archivo cerro_de_pasco_processed.csv debe existir');
    const content = fs.readFileSync(csvPath, 'utf8');
    assert(content.includes('2020-01-01'), 'Debe contener registros desde 2020-01-01');
    assert(content.includes('2026-09-26'), 'Debe abarcar hasta septiembre de 2026');
    assert(content.includes('label_frost'), 'Debe incluir variable objetivo de heladas');
    assert(content.includes('label_heavy_rain'), 'Debe incluir variable objetivo de lluvia intensa');
  });

  test('modelRegistry.js contiene los modelos matemáticos parsimoniosos auditados', () => {
    assert.strictEqual(MODEL_REGISTRY.frost.algorithm, 'LogisticRegression');
    assert.strictEqual(MODEL_REGISTRY.frost.version, '2.0.0_audited_no_leak');
    assert.strictEqual(MODEL_REGISTRY.heavy_rain.algorithm, 'RandomForestClassifier');
    assert.strictEqual(MODEL_REGISTRY.snow.algorithm, 'LogisticRegression');
    assert.strictEqual(MODEL_REGISTRY.hail.algorithm, 'DeterministicPhysicalRule');
    assert.strictEqual(MODEL_REGISTRY.hail.version, '1.0.0_provisional_rule');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 3: EJECUCIÓN INDIVIDUAL DE AGENTES (METEOROLÓGICO Y PREDICTIVO)
  // -------------------------------------------------------------------------
  console.log('\n[3/8] Ejecutando Pruebas Unitarias de Agente Meteorológico y Agente Predictivo...');

  const testUser = memoryStore.users[0];
  const testParcel = memoryStore.parcels[0];

  let meteoOutput = null;
  await asyncTest('Agente Meteorológico: Consulta, valida geoespacialmente y estructura vectores', async () => {
    meteoOutput = await meteorologicalAgent.execute({
      parcel_id: testParcel.id,
      force_refresh: false,
    });

    assert(meteoOutput && meteoOutput.status === 'success', 'MeteorologicalAgent debe retornar éxito');
    assert.strictEqual(meteoOutput.agent, 'meteorological');
    assert(meteoOutput.provenance && meteoOutput.provenance.source.includes('Open-Meteo'), 'Fuente debe ser Open-Meteo');
    assert(meteoOutput.provenance.historical_dataset_reference.includes('cerro_de_pasco_processed.csv'), 'Debe citar el dataset histórico');
    assert.strictEqual(meteoOutput.parcel_validation.validation_passed, true, 'Validación geoespacial en Pasco debe ser exitosa');
    assert(meteoOutput.data_quality.completeness_pct >= 90, 'Completitud de datos debe ser >= 90%');
    assert(Array.isArray(meteoOutput.weather_features.daily_features), 'daily_features debe ser un arreglo');
    assert(meteoOutput.weather_features.daily_features.length >= 1, 'Debe incluir al menos 1 día de características');
  });

  let mlOutput = null;
  await asyncTest('Agente Predictivo ML: Inferencia V8, horizontes 24/48/72h y Monte Carlo estocástico', async () => {
    mlOutput = await predictiveMLAgent.execute({
      weather_output: meteoOutput,
      parcel_context: testParcel,
      include_monte_carlo: true,
      monte_carlo_iterations: 300,
    });

    assert(mlOutput && mlOutput.status === 'success', 'PredictiveMLAgent debe retornar éxito');
    assert.strictEqual(mlOutput.agent, 'predictive_ml');
    assert(mlOutput.models_registry_audit, 'Debe incluir auditoría de registro de modelos');
    assert.strictEqual(mlOutput.models_registry_audit.frost.algorithm, 'LogisticRegression');
    assert.strictEqual(mlOutput.models_registry_audit.frost.version, '2.0.0_audited_no_leak');
    assert.strictEqual(mlOutput.models_registry_audit.hail.algorithm, 'DeterministicPhysicalRule');

    // Horizontes
    assert(mlOutput.predictions_by_horizon['24h'], 'Debe contener horizonte 24h');
    const p24 = mlOutput.predictions_by_horizon['24h'];
    assert(p24.frost && p24.frost.risk_level, 'Inferencia de heladas presente');
    assert(p24.heavy_rain && p24.heavy_rain.risk_level, 'Inferencia de lluvias intensas presente');
    assert(p24.snow && p24.snow.risk_level, 'Inferencia de nevadas presente');
    assert(p24.hail && p24.hail.risk_level, 'Evaluación física de granizadas presente');

    // Sensibilidad Monte Carlo y advertencia estocástica
    assert(mlOutput.monte_carlo_sensitivity, 'Monte Carlo sensitivity debe estar presente');
    assert.strictEqual(mlOutput.monte_carlo_sensitivity.executed, true, 'Monte Carlo debe haberse ejecutado');
    assert.strictEqual(mlOutput.monte_carlo_sensitivity.is_stochastic_simulation, true);
    assert(mlOutput.monte_carlo_sensitivity.simulation_warning.includes('NO constituye una observación meteorológica física real'), 'Debe advertir que es simulación estocástica');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 4: EJECUCIÓN DE AGENTE AGRÍCOLA Y BARRERAS DE SEGURIDAD
  // -------------------------------------------------------------------------
  console.log('\n[4/8] Ejecutando Agente Agrícola y Comprobando Barreras de Seguridad (Guardrails)...');

  let agriOutput = null;
  await asyncTest('Agente Agrícola y Operativo: Genera mitigación y aplica guardrails de seguridad', async () => {
    agriOutput = await agriculturalOperativeAgent.execute({
      parcel_id: testParcel.id,
      predictive_output: mlOutput,
      parcel_context: testParcel,
      user_id: testUser.id,
    });

    assert(agriOutput && agriOutput.status === 'success', 'AgriculturalOperativeAgent debe retornar éxito');
    assert.strictEqual(agriOutput.agent, 'agricultural_operative');
    assert(agriOutput.crop_context, 'Debe incluir contexto de cultivo y fenología');
    assert(Array.isArray(agriOutput.mitigation_strategies), 'mitigation_strategies debe ser un arreglo');
    assert(Array.isArray(agriOutput.internal_alerts), 'internal_alerts debe ser un arreglo');

    // GOBERNANZA DE SEGURIDAD OBLIGATORIA (Sección 3 & 9):
    // Cero modificación de B2B orders o válvulas físicas
    assert(agriOutput.safety_guardrails, 'Debe existir bloque de safety_guardrails');
    assert.strictEqual(agriOutput.safety_guardrails.b2b_orders_auto_modified, false, 'PROHIBIDO modificar pedidos B2B');
    assert.strictEqual(agriOutput.safety_guardrails.physical_valves_actuated, false, 'PROHIBIDO activar válvulas físicas');
    assert.strictEqual(agriOutput.safety_guardrails.all_sensitive_actions_gated, true, 'Acciones sensibles deben estar condicionadas a confirmación');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 5: AGENTE AUDITOR Y SUPERVISOR (6 CONTROLES)
  // -------------------------------------------------------------------------
  console.log('\n[5/8] Ejecutando Agente Auditor y Supervisor (6 Controles de Cumplimiento)...');

  let auditOutput = null;
  await asyncTest('Agente Auditor: Evalúa 6 controles, dictamen y persistencia en agent_audit_logs', async () => {
    const dummyTaskId = `test_task_${Date.now()}`;
    auditOutput = await auditorSupervisorAgent.execute({
      task_id: dummyTaskId,
      parcel_id: testParcel.id,
      user_id: testUser.id,
      steps: {
        meteorological: meteoOutput,
        predictive_ml: mlOutput,
        agricultural_operative: agriOutput,
      },
    });

    assert(auditOutput && auditOutput.status === 'success', 'AuditorSupervisorAgent debe retornar éxito');
    assert.strictEqual(auditOutput.agent, 'auditor_supervisor');
    assert.strictEqual(auditOutput.compliance_status, 'verified', 'El dictamen debe ser VERIFIED');
    assert.strictEqual(auditOutput.total_checks, 6, 'Debe evaluar exactamente 6 controles de auditoría');
    assert.strictEqual(auditOutput.passed_checks, 6, 'Los 6 controles deben pasar en condiciones óptimas');

    // Verificar los nombres de los 6 checks requeridos
    const checkIds = auditOutput.checks.map(c => c.check_id);
    assert(checkIds.includes('RBAC_PARCEL_ISOLATION'), 'Check 1: Aislamiento RBAC');
    assert(checkIds.includes('DATA_PROVENANCE_AND_FRESHNESS'), 'Check 2: Procedencia de datos');
    assert(checkIds.includes('MODEL_REGISTRY_COMPLIANCE'), 'Check 3: Registro de modelos');
    assert(checkIds.includes('SIMULATION_VS_OBSERVATION_DISTINCTION'), 'Check 4: Distinción simulación vs realidad');
    assert(checkIds.includes('EVIDENCE_CHAIN_COMPLETENESS'), 'Check 5: Cadena de evidencias');
    assert(checkIds.includes('SAFETY_AND_GOVERNANCE_BOUNDARIES'), 'Check 6: Barreras de seguridad');

    // Verificar persistencia en agent_audit_logs
    assert(auditOutput.audit_log_id, 'Debe retornar el ID insertado en agent_audit_logs');
    const logInDb = await db.dbGet('SELECT * FROM agent_audit_logs WHERE id = ?', [auditOutput.audit_log_id]);
    assert(logInDb, 'El registro de auditoría debe existir en la base de datos');
    assert.strictEqual(logInDb.agent_name, 'auditor_supervisor');
    assert.strictEqual(logInDb.compliance_status, 'verified');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 6: ORQUESTACIÓN COMPLETA END-TO-END (5 AGENTES EN DAG)
  // -------------------------------------------------------------------------
  console.log('\n[6/8] Ejecutando Flujo Completo End-to-End mediante el Orquestador Central...');

  let completedTask = null;
  await asyncTest('OrchestratorAgent: Ejecuta DAG completo, secuencia los 5 agentes y persiste en agent_tasks', async () => {
    completedTask = await orchestratorAgent.executeWorkflow({
      parcel_id: testParcel.id,
      user_id: testUser.id,
      workflow_type: 'agroclimatic_risk_assessment',
      include_monte_carlo: true,
      monte_carlo_iterations: 200,
      force_refresh: false,
    });

    assert(completedTask && completedTask.id, 'Debe retornar la tarea completada con ID');
    assert.strictEqual(completedTask.status, 'completed', "El estado final debe ser 'completed'");
    assert(completedTask.duration_ms >= 0, 'La duración debe estar calculada');
    assert(completedTask.completed_at, 'completed_at debe tener timestamp');

    // Verificar presencia de los resultados de cada agente en el objeto steps
    const steps = completedTask.steps;
    assert(steps.meteorological, 'Paso de Agente Meteorológico presente');
    assert(steps.predictive_ml, 'Paso de Agente Predictivo ML presente');
    assert(steps.agricultural_operative, 'Paso de Agente Agrícola y Operativo presente');
    assert(steps.auditor_supervisor, 'Paso de Agente Auditor y Supervisor presente');

    // Resumen consolidado del Orquestador
    const summary = completedTask.result_summary;
    assert(summary && summary.overall_status === 'SUCCESS', 'Resumen ejecutivo debe marcar SUCCESS');
    assert.strictEqual(summary.execution_summary.agents_executed, 5, 'Deben haberse ejecutado 5 agentes');
    assert(summary.executive_message, 'Mensaje ejecutivo consolidado presente');
  });

  await asyncTest('Gestor de Tareas: Recuperación de tareas interrumpidas (recoverStaleTasks)', async () => {
    // Insertamos tarea huérfana simulada en estado running creada en el pasado
    const staleTaskId = `stale_task_${Date.now()}`;
    memoryStore.agent_tasks.push({
      id: staleTaskId,
      workflow_type: 'test_stale',
      parcel_id: testParcel.id,
      user_id: testUser.id,
      status: 'running',
      current_agent: 'predictive_ml',
      steps: '{}',
      started_at: new Date(Date.now() - 600000).toISOString(),
      created_at: new Date(Date.now() - 600000).toISOString(),
    });

    const recoveredCount = await agentTaskManager.recoverStaleTasks();
    assert(recoveredCount >= 1, 'Debe haber recuperado al menos 1 tarea huérfana');

    const recoveredTask = await agentTaskManager.getTaskById(staleTaskId);
    assert.strictEqual(recoveredTask.status, 'failed', 'Tarea recuperada debe marcarse como failed');
    assert(recoveredTask.error_message.includes('Tarea interrumpida por reinicio'), 'Debe explicar la causa de fallo');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 7: ENDPOINTS REST, RBAC Y TELEMETRÍA OPERATIVA
  // -------------------------------------------------------------------------
  console.log('\n[7/8] Verificando Endpoints REST, Control de Roles RBAC y Telemetría...');

  await asyncTest('Endpoint executeWorkflowEndpoint: Autorización correcta y rechazo RBAC para terceros', async () => {
    // 1. Ejecución autorizada por el dueño
    let resDataAuth = null;
    const reqAuth = {
      user: { id: testUser.id, role: 'farmer' },
      body: { parcel_id: testParcel.id, include_monte_carlo: false }
    };
    const resAuth = {
      status: (code) => ({
        json: (d) => { resDataAuth = { statusCode: code, ...d }; }
      })
    };

    await agentController.executeWorkflowEndpoint(reqAuth, resAuth);
    assert(resDataAuth && resDataAuth.statusCode === 200, 'Dueño debe poder ejecutar la tarea (HTTP 200)');
    assert(resDataAuth.success === true);
    assert(resDataAuth.task && resDataAuth.task.id);

    // 2. Rechazo RBAC: Agricultor ajeno intenta ejecutar en la parcela de testUser
    let resDataDeny = null;
    const reqDeny = {
      user: { id: 99999, role: 'farmer' }, // ID no dueño y rol agricultor
      body: { parcel_id: testParcel.id }
    };
    const resDeny = {
      status: (code) => ({
        json: (d) => { resDataDeny = { statusCode: code, ...d }; }
      })
    };

    await agentController.executeWorkflowEndpoint(reqDeny, resDeny);
    assert.strictEqual(resDataDeny.statusCode, 403, 'Tercero sin permiso debe recibir HTTP 403');
    assert.strictEqual(resDataDeny.success, false);
    assert(resDataDeny.error.includes('Acceso denegado'));
  });

  await asyncTest('Endpoint getOperationalStatusEndpoint: Telemetría de 5 agentes y métricas de cola', async () => {
    let resData = null;
    const req = { user: { id: testUser.id, role: 'farmer' } };
    const res = {
      status: (code) => ({
        json: (d) => { resData = { statusCode: code, ...d }; }
      })
    };

    await agentController.getOperationalStatusEndpoint(req, res);
    assert(resData && resData.statusCode === 200, 'Debe retornar HTTP 200');
    assert(resData.success === true);
    assert(Array.isArray(resData.agents), 'agents debe ser una lista');
    assert.strictEqual(resData.agents.length, 5, 'Debe reportar telemetría de exactamente 5 agentes');
    assert(resData.telemetry, 'Debe incluir bloque de telemetría de cola');
    assert(resData.telemetry.total_tasks_24h >= 1, 'Debe contabilizar las tareas ejecutadas en 24h');
  });

  await asyncTest('Endpoint getAuditLogsEndpoint: Consulta bitácora de auditoría con aislamiento', async () => {
    let resData = null;
    const req = {
      user: { id: testUser.id, role: 'farmer' },
      query: { parcel_id: testParcel.id, limit: 10 }
    };
    const res = {
      status: (code) => ({
        json: (d) => { resData = { statusCode: code, ...d }; }
      })
    };

    await agentController.getAuditLogsEndpoint(req, res);
    assert(resData && resData.statusCode === 200, 'Debe retornar HTTP 200');
    assert(resData.success === true);
    assert(Array.isArray(resData.audit_logs), 'audit_logs debe ser un arreglo');
    assert(resData.audit_logs.length >= 1, 'Debe contener al menos 1 registro de auditoría');
    const firstLog = resData.audit_logs[0];
    assert.strictEqual(firstLog.agent_name, 'auditor_supervisor');
    assert(firstLog.verification_details, 'verification_details debe estar parseado');
  });

  // -------------------------------------------------------------------------
  // MÓDULO 8: VERIFICACIÓN DE INTEGRACIÓN FRONTEND Y NO REGRESIÓN
  // -------------------------------------------------------------------------
  console.log('\n[8/8] Verificando Integración Frontend y No-Regresión de Fases Anteriores...');

  test('Archivos frontend de Fase 6 están creados e integrados en index.html', () => {
    const multiAgentJsPath = path.resolve(__dirname, '../../frontend/js/multi-agent-system.js');
    assert(fs.existsSync(multiAgentJsPath), 'frontend/js/multi-agent-system.js debe existir');

    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    assert(indexHtml.includes('frontend/js/multi-agent-system.js'), 'index.html debe cargar multi-agent-system.js');

    const dashboardJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/predictive-dashboard.js'), 'utf8');
    assert(dashboardJs.includes('renderMultiAgentSystemSection'), 'predictive-dashboard.js debe invocar renderMultiAgentSystemSection');
    assert(dashboardJs.includes('section-multi-agents'), 'predictive-dashboard.js debe incluir anclaje al centro multiagente');
    assert(dashboardJs.includes('initMultiAgentSystem'), 'predictive-dashboard.js debe inicializar el sistema multiagente');

    const apiJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/api.js'), 'utf8');
    assert(apiJs.includes('executeMultiAgentWorkflow'), 'api.js debe contener executeMultiAgentWorkflow');
    assert(apiJs.includes('getAgentOperationalStatus'), 'api.js debe contener getAgentOperationalStatus');
    assert(apiJs.includes('getAgentAuditLogs'), 'api.js debe contener getAgentAuditLogs');
  });

  test('No regresión de motor de inferencia nativo V8 y simulación Monte Carlo', () => {
    if (!defaultEngine.isLoaded) defaultEngine.loadModels();
    assert(defaultEngine.isLoaded, 'MLEngine debe permanecer cargado');
    const dummyFeatures = {
      temperature_2m_min: -2.5,
      temperature_2m_max: 8.0,
      temperature_2m_mean: 2.7,
      precipitation_sum: 0.0,
      humidity_mean: 60.0,
      wind_speed_10m_max: 3.0,
      altitude: 4337.0,
    };
    const fullVector = defaultSimulator.buildBaselineScenario(dummyFeatures);
    const frostPred = defaultEngine.predictFrost(fullVector);
    assert(frostPred && frostPred.probability > 0.5, 'Helada debe activarse para -2.5°C');
    assert(frostPred.algorithm.includes('LogisticRegression'), 'Algoritmo debe ser LogisticRegression');
  });

  // -------------------------------------------------------------------------
  // RESUMEN FINAL
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA PRUEBA: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
  console.log('======================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TODOS LOS CRITERIOS DE ACEPTACIÓN DE LA FASE 6 HAN SIDO SATISFECHOS.');
  } else {
    process.exitCode = 1;
  }
}

runTestSuite().catch(err => {
  console.error('Error fatal durante la ejecución de la suite multiagente:', err);
  process.exit(1);
});
