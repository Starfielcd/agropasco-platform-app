/**
 * AgroPasco Digital — Sistema Multiagente Inteligente (Fase 6)
 * ============================================================
 * Exportación centralizada de la arquitectura de 5 agentes y gestor de tareas:
 *  - Agente 1: Orquestador Central (orchestratorAgent)
 *  - Agente 2: Meteorológico (meteorologicalAgent)
 *  - Agente 3: Predictivo ML (predictiveMLAgent)
 *  - Agente 4: Agrícola y Operativo (agriculturalOperativeAgent)
 *  - Agente 5: Auditor y Supervisor (auditorSupervisorAgent)
 *  - Gestor de Tareas Persistentes (agentTaskManager)
 */

const orchestratorAgent = require('./orchestratorAgent');
const meteorologicalAgent = require('./meteorologicalAgent');
const predictiveMLAgent = require('./predictiveMLAgent');
const agriculturalOperativeAgent = require('./agriculturalOperativeAgent');
const auditorSupervisorAgent = require('./auditorSupervisorAgent');
const agentTaskManager = require('./agentTaskManager');

module.exports = {
  orchestratorAgent,
  meteorologicalAgent,
  predictiveMLAgent,
  agriculturalOperativeAgent,
  auditorSupervisorAgent,
  agentTaskManager,
};
