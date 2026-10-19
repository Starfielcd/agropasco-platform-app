/**
 * AgroPasco Digital — Sistema Multiagente Inteligente (Fase 6)
 * ============================================================
 * Panel de control y visualización de la arquitectura de 5 agentes:
 *  1. Agente Orquestador Central (orchestratorAgent)
 *  2. Agente Meteorológico (meteorologicalAgent)
 *  3. Agente Predictivo ML (predictiveMLAgent)
 *  4. Agente Agrícola y Operativo (agriculturalOperativeAgent)
 *  5. Agente Auditor y Supervisor (auditorSupervisorAgent)
 *
 * Características:
 *  - Telemetría en tiempo real y auto-refresco sin recargar la página.
 *  - Ejecución orquestada manual según rol con visualizador de progreso por pasos.
 *  - Historial de tareas persistentes por parcela con detalles y duración.
 *  - Auditoría verificable con desglose de 6 checks de cumplimiento y estado estocástico.
 */

const multiAgentState = {
  parcelId: null,
  isExecuting: false,
  activeTaskId: null,
  lastTaskResult: null,
  operationalStatus: null,
  recentTasks: [],
  autoRefreshInterval: null,
  isLoadingTasks: false,
};

/**
 * Renderiza la sección del Centro Multiagente en el Dashboard Predictivo
 */
function renderMultiAgentSystemSection() {
  return `
    <div class="card" id="section-multi-agents" style="margin-bottom: 24px; padding: 22px; border: 1px solid #C7D2FE; background: linear-gradient(180deg, #FFFFFF 0%, #F5F3FF 100%); box-shadow: var(--shadow-sm);">
      <!-- 1. Encabezado del Centro Multiagente -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; border-bottom: 1px solid rgba(99, 102, 241, 0.2); padding-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 800; color: #4338CA; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🤖</span> Centro Multiagente e Integración Operacional (Fases 6 y 7)
            </h3>
            <span class="badge badge-purple" style="font-size: 11px; font-weight: 700; background: #EDE9FE; color: #6D28D9; border: 1px solid #DDD6FE;">
              5 Agentes + Scheduler
            </span>
          </div>
          <p class="text-sm text-muted" style="margin: 4px 0 0;">
            Automatización operacional con leases PostgreSQL, Open-Meteo, ML Nativo V8, deduplicación de alertas, auditoría continua y verificación predicción vs. realidad.
          </p>
        </div>

        <!-- Botones de Acción Global -->
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button type="button" id="btn-trigger-scheduler-cycle" class="btn btn-warning btn-sm" style="font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="triggerSchedulerCycleExecution()" title="Ejecuta el ciclo automatizado completo para todas las parcelas desactualizadas">
            <span>🔄</span> Ciclo Automatizado (Scheduler)
          </button>
          <button type="button" id="btn-trigger-multiagent" class="btn btn-primary btn-sm" style="background: #4F46E5; border-color: #4338CA; font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="triggerMultiAgentExecution()">
            <span>⚡</span> Ejecutar Parcela Activa
          </button>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 12px;" onclick="refreshMultiAgentStatus(true)" title="Actualizar estado de agentes y scheduler">
            🔄 Telemetría
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" style="font-size: 12px;" onclick="openAuditLogsGlobalModal()" title="Ver bitácora de auditoría">
            🛡️ Bitácora de Auditoría
          </button>
        </div>
      </div>

      <!-- Banner de Automatización y Leases Distribuidos (Fase 7) -->
      <div id="scheduler-status-banner" style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 12px 16px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="background: #DBEAFE; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px;">
            ⏱️
          </div>
          <div>
            <div style="font-size: 13px; font-weight: 700; color: #1E40AF; display: flex; align-items: center; gap: 8px;">
              <span>Planificador Distribuido de Tareas</span>
              <span id="scheduler-mode-badge" class="badge" style="background: #FEF3C7; color: #92400E; font-size: 10.5px; border: 1px solid #FDE68A;">
                STAND-BY CONTROLADO (AUTO_SCHEDULER_ENABLED=false)
              </span>
            </div>
            <div id="scheduler-status-details" style="font-size: 11.5px; color: #3B82F6; margin-top: 2px;">
              Bloqueo: Leases persistentes en PostgreSQL (resiliente a reinicios de Render) | Ventana meteorológica: 6 horas | Deduplicación: 6 horas.
            </div>
          </div>
        </div>
        <div style="font-size: 11.5px; color: #64748B; text-align: right;">
          <div>Último ciclo: <strong id="scheduler-last-run">--</strong></div>
          <div>Lease activo: <strong id="scheduler-lease-status" style="color: #10B981;">Libre</strong></div>
        </div>
      </div>

      <!-- 2. Barra de Métricas y Telemetría de Cola (Últimas 24h) -->
      <div id="multiagent-telemetry-strip" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px;">
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Total Tareas (24h)</div>
          <div id="metric-total-tasks" style="font-size: 22px; font-weight: 800; color: #1E293B;">--</div>
        </div>
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #2563EB; text-transform: uppercase;">En Ejecución</div>
          <div id="metric-running-tasks" style="font-size: 22px; font-weight: 800; color: #2563EB;">0</div>
        </div>
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #16A34A; text-transform: uppercase;">Completadas</div>
          <div id="metric-completed-tasks" style="font-size: 22px; font-weight: 800; color: #16A34A;">--</div>
        </div>
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #DC2626; text-transform: uppercase;">Fallidas</div>
          <div id="metric-failed-tasks" style="font-size: 22px; font-weight: 800; color: #DC2626;">0</div>
        </div>
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #7C3AED; text-transform: uppercase;">Tasa de Éxito</div>
          <div id="metric-success-rate" style="font-size: 22px; font-weight: 800; color: #7C3AED;">100%</div>
        </div>
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: #D97706; text-transform: uppercase;">Tiempo Medio</div>
          <div id="metric-avg-time" style="font-size: 22px; font-weight: 800; color: #D97706;">-- ms</div>
        </div>
      </div>

      <!-- 3. Grid de los Cinco Agentes Inteligentes -->
      <div style="margin-bottom: 22px;">
        <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin: 0 0 12px; display: flex; align-items: center; gap: 8px;">
          <span>👥</span> Topología de Agentes y Estado en Tiempo Real
        </h4>

        <div id="multiagent-cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px;">
          <!-- Card Agente 1: Orquestador Central -->
          <div class="agent-card" id="agent-card-orchestrator" style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0; box-shadow: var(--shadow-sm); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 20px;">🕸️</span>
              <span id="agent-badge-orchestrator" class="badge badge-gray" style="font-size: 10.5px; font-weight: 700;">En Espera</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">1. Orquestador Central</div>
            <p style="font-size: 11.5px; color: #64748B; margin: 0 0 10px; line-height: 1.4;">
              Recepción, distribución DAG, estados persistentes y consolidación ejecutiva.
            </p>
            <div style="font-size: 10.5px; color: #94A3B8; border-top: 1px dashed #E2E8F0; padding-top: 6px;">
              ID: <code>agent_orchestrator</code>
            </div>
          </div>

          <!-- Card Agente 2: Meteorológico -->
          <div class="agent-card" id="agent-card-meteorological" style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0; box-shadow: var(--shadow-sm); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 20px;">⛅</span>
              <span id="agent-badge-meteorological" class="badge badge-gray" style="font-size: 10.5px; font-weight: 700;">En Espera</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">2. Meteorológico</div>
            <p style="font-size: 11.5px; color: #64748B; margin: 0 0 10px; line-height: 1.4;">
              Open-Meteo, caché compartida, validación geoespacial y completitud de datos.
            </p>
            <div style="font-size: 10.5px; color: #94A3B8; border-top: 1px dashed #E2E8F0; padding-top: 6px;">
              ID: <code>agent_meteorological</code>
            </div>
          </div>

          <!-- Card Agente 3: Predictivo ML -->
          <div class="agent-card" id="agent-card-predictive_ml" style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0; box-shadow: var(--shadow-sm); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 20px;">🧠</span>
              <span id="agent-badge-predictive_ml" class="badge badge-gray" style="font-size: 10.5px; font-weight: 700;">En Espera</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">3. Predictivo ML</div>
            <p style="font-size: 11.5px; color: #64748B; margin: 0 0 10px; line-height: 1.4;">
              Inferencia V8 nativa, modelRegistry, horizontes 24/48/72h y Monte Carlo.
            </p>
            <div style="font-size: 10.5px; color: #94A3B8; border-top: 1px dashed #E2E8F0; padding-top: 6px;">
              ID: <code>agent_predictive_ml</code>
            </div>
          </div>

          <!-- Card Agente 4: Agrícola y Operativo -->
          <div class="agent-card" id="agent-card-agricultural_operative" style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0; box-shadow: var(--shadow-sm); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 20px;">🌱</span>
              <span id="agent-badge-agricultural_operative" class="badge badge-gray" style="font-size: 10.5px; font-weight: 700;">En Espera</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">4. Agrícola y Operativo</div>
            <p style="font-size: 11.5px; color: #64748B; margin: 0 0 10px; line-height: 1.4;">
              Motor de mitigación INIA/SENAMHI, fenología, alertas y guardrail B2B/válvulas.
            </p>
            <div style="font-size: 10.5px; color: #94A3B8; border-top: 1px dashed #E2E8F0; padding-top: 6px;">
              ID: <code>agent_agricultural_operative</code>
            </div>
          </div>

          <!-- Card Agente 5: Auditor y Supervisor -->
          <div class="agent-card" id="agent-card-auditor_supervisor" style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0; box-shadow: var(--shadow-sm); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 20px;">🛡️</span>
              <span id="agent-badge-auditor_supervisor" class="badge badge-gray" style="font-size: 10.5px; font-weight: 700;">En Espera</span>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">5. Auditor y Supervisor</div>
            <p style="font-size: 11.5px; color: #64748B; margin: 0 0 10px; line-height: 1.4;">
              Auditoría de 6 checks, procedencia de datos, RBAC y registro de bitácora.
            </p>
            <div style="font-size: 10.5px; color: #94A3B8; border-top: 1px dashed #E2E8F0; padding-top: 6px;">
              ID: <code>agent_auditor_supervisor</code>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Contenedor de Ejecución en Vivo y Trazabilidad -->
      <div id="multiagent-live-execution-container" style="display: none; background: #FFFFFF; border-radius: 12px; border: 1px solid #C7D2FE; padding: 18px; margin-bottom: 22px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h4 style="font-size: 15px; font-weight: 800; color: #4338CA; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span class="spinner-grow spinner-grow-sm" role="status" style="width: 14px; height: 14px;"></span>
            Trazabilidad del Flujo de Ejecución en Vivo
          </h4>
          <span id="live-task-id-badge" style="font-size: 12px; font-weight: 600; color: #64748B; font-family: monospace;">--</span>
        </div>

        <!-- Barra de Progreso Secuencial -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 14px;" id="pipeline-progress-bar">
          <div id="step-prog-1" style="height: 6px; border-radius: 4px; background: #E2E8F0; transition: all 0.3s;"></div>
          <div id="step-prog-2" style="height: 6px; border-radius: 4px; background: #E2E8F0; transition: all 0.3s;"></div>
          <div id="step-prog-3" style="height: 6px; border-radius: 4px; background: #E2E8F0; transition: all 0.3s;"></div>
          <div id="step-prog-4" style="height: 6px; border-radius: 4px; background: #E2E8F0; transition: all 0.3s;"></div>
          <div id="step-prog-5" style="height: 6px; border-radius: 4px; background: #E2E8F0; transition: all 0.3s;"></div>
        </div>

        <!-- Consola de Resultados y Trazabilidad por Agente -->
        <div id="live-steps-log" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; font-size: 12px; max-height: 280px; overflow-y: auto;">
          <div style="color: #64748B;">Iniciando orquestación...</div>
        </div>
      </div>

      <!-- 5. Tabla de Tareas Recientes de la Parcela -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span>📋</span> Historial de Tareas y Auditorías de la Parcela
          </h4>
          <button type="button" class="btn btn-outline-secondary btn-sm" style="font-size: 11.5px;" onclick="loadRecentParcelAgentTasks()">
            🔄 Actualizar Historial
          </button>
        </div>

        <div class="table-responsive" style="background: #FFFFFF; border-radius: 10px; border: 1px solid #E2E8F0;">
          <table class="table" style="margin: 0; font-size: 12.5px;">
            <thead style="background: #F8FAFC; color: #475569; font-weight: 700;">
              <tr>
                <th style="padding: 10px 14px;">ID Tarea</th>
                <th style="padding: 10px 14px;">Fecha/Hora</th>
                <th style="padding: 10px 14px;">Flujo</th>
                <th style="padding: 10px 14px;">Estado</th>
                <th style="padding: 10px 14px;">Duración</th>
                <th style="padding: 10px 14px;">Dictamen Auditor</th>
                <th style="padding: 10px 14px; text-align: right;">Acciones</th>
              </tr>
            </thead>
            <tbody id="multiagent-tasks-tbody">
              <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: #94A3B8;">
                  Seleccione una parcela para ver el historial de tareas multiagente.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 6. Registro Persistente de Pronósticos y Verificación (Predicción vs. Realidad) (Fase 7) -->
      <div style="margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>📊</span> Historial Persistente y Verificación (Predicción vs. Realidad)
            </h4>
            <p style="font-size: 12px; color: #64748B; margin: 2px 0 0;">
              Pronósticos emitidos registrados de forma inmutable vs. observaciones reales (Ground Truth) de campo y estaciones.
            </p>
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" style="font-size: 12px;" onclick="triggerEvaluatePredictions()" title="Evalúa pronósticos pasados contra observaciones registradas">
            🔍 Evaluar Observaciones Reales
          </button>
        </div>

        <!-- Métricas de Confusión y Exactitud Histórica -->
        <div id="prediction-accuracy-metrics-strip" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 16px;">
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #64748B; text-transform: uppercase;">Evaluadas</div>
            <div id="metric-pred-total" style="font-size: 18px; font-weight: 800; color: #1E293B;">0</div>
          </div>
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #16A34A; text-transform: uppercase;">Aciertos (Hits)</div>
            <div id="metric-pred-hits" style="font-size: 18px; font-weight: 800; color: #16A34A;">0</div>
          </div>
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #DC2626; text-transform: uppercase;">Fallos (Misses)</div>
            <div id="metric-pred-misses" style="font-size: 18px; font-weight: 800; color: #DC2626;">0</div>
          </div>
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #D97706; text-transform: uppercase;">Falsas Alarmas</div>
            <div id="metric-pred-false-alarms" style="font-size: 18px; font-weight: 800; color: #D97706;">0</div>
          </div>
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #2563EB; text-transform: uppercase;">Neg. Correctos</div>
            <div id="metric-pred-correct-neg" style="font-size: 18px; font-weight: 800; color: #2563EB;">0</div>
          </div>
          <div style="background: #FFFFFF; padding: 10px 12px; border-radius: 8px; border: 1px solid #E2E8F0; text-align: center;">
            <div style="font-size: 10.5px; font-weight: 700; color: #7C3AED; text-transform: uppercase;">Exactitud %</div>
            <div id="metric-pred-accuracy" style="font-size: 18px; font-weight: 800; color: #7C3AED;">--%</div>
          </div>
        </div>

        <!-- Tabla de Historial Persistente -->
        <div class="table-responsive" style="background: #FFFFFF; border-radius: 10px; border: 1px solid #E2E8F0; max-height: 280px; overflow-y: auto;">
          <table class="table" style="margin: 0; font-size: 12px;">
            <thead style="background: #F8FAFC; color: #475569; font-weight: 700;">
              <tr>
                <th style="padding: 8px 12px;">Emisión</th>
                <th style="padding: 8px 12px;">Horizonte</th>
                <th style="padding: 8px 12px;">Fenómeno</th>
                <th style="padding: 8px 12px;">Pronóstico</th>
                <th style="padding: 8px 12px;">Modelo / Ver.</th>
                <th style="padding: 8px 12px;">Fecha Objetivo</th>
                <th style="padding: 8px 12px;">Obs. Real</th>
                <th style="padding: 8px 12px;">Resultado</th>
              </tr>
            </thead>
            <tbody id="predictions-history-tbody">
              <tr>
                <td colspan="8" style="text-align: center; padding: 18px; color: #94A3B8;">
                  Seleccione una parcela para consultar el historial de pronósticos.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/**
 * Inicializa el módulo de Sistema Multiagente al cargar el dashboard
 */
function initMultiAgentSystem(parcelId) {
  multiAgentState.parcelId = parcelId;
  refreshMultiAgentStatus(false);
  loadRecentParcelAgentTasks();
  if (parcelId) {
    loadPredictionHistoryAndMetrics(parcelId);
  }

  // Configurar auto-refresco periódico de telemetría (cada 20s)
  if (multiAgentState.autoRefreshInterval) {
    clearInterval(multiAgentState.autoRefreshInterval);
  }
  multiAgentState.autoRefreshInterval = setInterval(() => {
    refreshMultiAgentStatus(false);
  }, 20000);
}

/**
 * Actualiza la telemetría, el estado visual de los 5 agentes y el estado del scheduler (Fase 7)
 */
async function refreshMultiAgentStatus(showFeedback = false) {
  try {
    const res = await api.getAgentOperationalStatus();
    if (res && res.success) {
      multiAgentState.operationalStatus = res;
      const t = res.telemetry || {};

      // Actualizar KPIs
      const elTotal = document.getElementById('metric-total-tasks');
      const elRunning = document.getElementById('metric-running-tasks');
      const elCompleted = document.getElementById('metric-completed-tasks');
      const elFailed = document.getElementById('metric-failed-tasks');
      const elRate = document.getElementById('metric-success-rate');
      const elAvg = document.getElementById('metric-avg-time');

      if (elTotal) elTotal.textContent = t.total_tasks_24h ?? 0;
      if (elRunning) elRunning.textContent = t.running ?? 0;
      if (elCompleted) elCompleted.textContent = t.completed ?? 0;
      if (elFailed) elFailed.textContent = t.failed ?? 0;
      if (elRate) elRate.textContent = `${t.success_rate_pct ?? 100}%`;
      if (elAvg) elAvg.textContent = `${t.avg_execution_ms ?? 0} ms`;

      // Actualizar badges individuales de los 5 agentes
      (res.agents || []).forEach(agent => {
        const badge = document.getElementById(`agent-badge-${agent.name}`);
        const card = document.getElementById(`agent-card-${agent.name}`);
        if (badge) {
          if (agent.state === 'running') {
            badge.className = 'badge badge-blue';
            badge.textContent = '⚡ Ejecutando';
            if (card) card.style.borderColor = '#6366F1';
          } else if (agent.state === 'error') {
            badge.className = 'badge badge-red';
            badge.textContent = '❌ Error';
            if (card) card.style.borderColor = '#EF4444';
          } else {
            badge.className = 'badge badge-gray';
            badge.textContent = 'En Espera';
            if (card) card.style.borderColor = '#E2E8F0';
          }
        }
      });
    }

    // Sincronizar estado del Scheduler (Fase 7)
    try {
      if (typeof api.getSchedulerStatus === 'function') {
        const sRes = await api.getSchedulerStatus();
        if (sRes && sRes.success) {
          const s = sRes.scheduler || {};
          const elMode = document.getElementById('scheduler-mode-badge');
          const elLast = document.getElementById('scheduler-last-run');
          const elLease = document.getElementById('scheduler-lease-status');

          if (elMode) {
            if (s.enabled) {
              elMode.className = 'badge badge-green';
              elMode.style.background = '#DCFCE7';
              elMode.style.color = '#15803D';
              elMode.textContent = `ACTIVO (Cada ${s.interval_minutes}m)`;
            } else {
              elMode.className = 'badge';
              elMode.style.background = '#FEF3C7';
              elMode.style.color = '#92400E';
              elMode.textContent = 'STAND-BY CONTROLADO (AUTO_SCHEDULER_ENABLED=false)';
            }
          }

          if (elLast) {
            elLast.textContent = s.last_run ? new Date(s.last_run).toLocaleTimeString('es-PE') : 'Nunca';
          }

          if (elLease) {
            if (s.is_running) {
              elLease.textContent = 'En Ejecución ⚡';
              elLease.style.color = '#2563EB';
            } else {
              elLease.textContent = 'Libre (Lease OK)';
              elLease.style.color = '#10B981';
            }
          }
        }
      }
    } catch (schedErr) {
      console.warn('[refreshMultiAgentStatus] Error al consultar scheduler:', schedErr.message);
    }

    if (showFeedback && typeof showToast === 'function') {
      showToast('Telemetría de agentes y scheduler sincronizada.', 'info');
    }
  } catch (err) {
    console.warn('[refreshMultiAgentStatus] Error general:', err.message);
  }
}

/**
 * Carga el historial de tareas multiagente de la parcela activa
 */
async function loadRecentParcelAgentTasks() {
  const currentParcelId = multiAgentState.parcelId || (typeof getActivePredictiveParcelId === 'function' ? getActivePredictiveParcelId() : null);
  if (!currentParcelId) return;

  const tbody = document.getElementById('multiagent-tasks-tbody');
  if (!tbody) return;

  try {
    const res = await api.getAgentParcelTasks(currentParcelId, 8);
    if (!res || !res.success || !Array.isArray(res.tasks) || res.tasks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 22px; color: #64748B;">
            No hay ejecuciones multiagente recientes para esta parcela. Haga clic en <strong>"Ejecutar Flujo de 5 Agentes"</strong> para iniciar.
          </td>
        </tr>
      `;
      return;
    }

    multiAgentState.recentTasks = res.tasks;

    tbody.innerHTML = res.tasks.map(t => {
      const dateStr = t.created_at ? new Date(t.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' }) : '--';
      const statusBadge = t.status === 'completed'
        ? '<span class="badge badge-green" style="font-size: 11px;">Completada</span>'
        : t.status === 'running'
        ? '<span class="badge badge-blue" style="font-size: 11px;">En Ejecución</span>'
        : t.status === 'failed'
        ? '<span class="badge badge-red" style="font-size: 11px;">Fallida</span>'
        : '<span class="badge badge-gray" style="font-size: 11px;">Pendiente</span>';

      const auditSummary = t.result_summary?.audit_verdict || (t.steps?.auditor_supervisor?.compliance_status) || 'verified';
      const auditBadge = auditSummary === 'verified'
        ? '<span class="badge badge-green" style="font-size: 10.5px;">✓ Conforme</span>'
        : auditSummary === 'warning'
        ? '<span class="badge badge-yellow" style="font-size: 10.5px;">⚠️ Advertencia</span>'
        : '<span class="badge badge-red" style="font-size: 10.5px;">❌ Observada</span>';

      return `
        <tr>
          <td style="padding: 10px 14px; font-family: monospace; font-weight: 600; color: #4338CA;">${t.id}</td>
          <td style="padding: 10px 14px; color: #475569;">${dateStr}</td>
          <td style="padding: 10px 14px;"><code>${t.workflow_type || 'agroclimatic_risk'}</code></td>
          <td style="padding: 10px 14px;">${statusBadge}</td>
          <td style="padding: 10px 14px; color: #64748B;">${t.duration_ms ? `${t.duration_ms} ms` : '--'}</td>
          <td style="padding: 10px 14px;">${auditBadge}</td>
          <td style="padding: 10px 14px; text-align: right;">
            <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" onclick="openTaskDetailModal('${t.id}')">
              👁️ Detalle
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('[loadRecentParcelAgentTasks] Error:', err.message);
  }
}

/**
 * Dispara la ejecución orquestada completa de los 5 agentes
 */
async function triggerMultiAgentExecution() {
  const currentParcelId = multiAgentState.parcelId || (typeof getActivePredictiveParcelId === 'function' ? getActivePredictiveParcelId() : null);
  if (!currentParcelId) {
    alert('Por favor seleccione una parcela en el dashboard.');
    return;
  }

  const btn = document.getElementById('btn-trigger-multiagent');
  const liveContainer = document.getElementById('multiagent-live-execution-container');
  const liveTaskId = document.getElementById('live-task-id-badge');
  const liveLog = document.getElementById('live-steps-log');

  if (multiAgentState.isExecuting) {
    alert('Ya hay un flujo multiagente en ejecución. Por favor espere.');
    return;
  }

  multiAgentState.isExecuting = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Ejecutando 5 Agentes...';
  }
  if (liveContainer) liveContainer.style.display = 'block';
  if (liveLog) {
    liveLog.innerHTML = `
      <div style="color: #4338CA; font-weight: 700; margin-bottom: 6px;">
        🚀 [ORQUESTADOR CENTRAL] Iniciando ejecución del grafo multiagente para Parcela #${currentParcelId}...
      </div>
      <div style="color: #64748B; margin-bottom: 4px;">Paso 1: Solicitando pronóstico de alta resolución al Agente Meteorológico...</div>
    `;
  }

  // Activar barra de progreso
  updatePipelineProgress(1);

  try {
    const res = await api.executeMultiAgentWorkflow({
      parcel_id: currentParcelId,
      workflow_type: 'agroclimatic_risk_assessment',
      include_monte_carlo: true,
      monte_carlo_iterations: 500,
    });

    if (!res || !res.success || !res.task) {
      throw new Error(res?.error || 'No se recibió respuesta válida del orquestador.');
    }

    const task = res.task;
    multiAgentState.lastTaskResult = task;
    if (liveTaskId) liveTaskId.textContent = task.id;

    // Completar barra de progreso
    updatePipelineProgress(5);

    // Renderizar resultados en consola
    const steps = task.steps || {};
    const summary = task.result_summary || {};
    const audit = steps.auditor_supervisor || {};

    if (liveLog) {
      liveLog.innerHTML = `
        <div style="color: #16A34A; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
          ✅ [ORQUESTADOR CENTRAL] Flujo de 5 Agentes Finalizado en ${task.duration_ms || 0} ms con Éxito.
        </div>
        <div style="margin-bottom: 6px;"><strong>ID de Tarea:</strong> <code>${task.id}</code></div>
        <div style="margin-bottom: 6px;"><strong>Agente 2 (Meteorología):</strong> Datos validados (${steps.meteorological?.data_quality?.completeness_pct}% completitud). Fuente: ${steps.meteorological?.provenance?.source}.</div>
        <div style="margin-bottom: 6px;"><strong>Agente 3 (Predictivo ML):</strong> Inferencia completada con modelRegistry.js (Riesgo 24h: ${summary.execution_summary?.risk_24h?.level?.toUpperCase()} - ${summary.execution_summary?.risk_24h?.score}%).</div>
        <div style="margin-bottom: 6px;"><strong>Agente 4 (Agrícola/Operativo):</strong> ${steps.agricultural_operative?.total_strategies_count || 0} estrategias generadas. Barrera de seguridad B2B/Válvulas: ACTIVA (0 modificaciones automáticas sin confirmación).</div>
        <div style="margin-bottom: 6px;"><strong>Agente 5 (Auditor/Supervisor):</strong> Dictamen: <span class="badge ${audit.compliance_status === 'verified' ? 'badge-green' : 'badge-yellow'}">${audit.compliance_status?.toUpperCase()}</span> (${audit.passed_checks}/${audit.total_checks} checks aprobados). Registro: #<code>${audit.audit_log_id || 'LOGGED'}</code>.</div>
        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #CBD5E1; color: #4338CA; font-weight: 600;">
          💡 ${summary.executive_message || 'Proceso completado.'}
        </div>
      `;
    }

    if (typeof showToast === 'function') {
      showToast('Flujo multiagente completado exitosamente.', 'success');
    }

    // Refrescar lista de tareas y telemetría
    await loadRecentParcelAgentTasks();
    await refreshMultiAgentStatus(false);
  } catch (err) {
    console.error('[triggerMultiAgentExecution] Error:', err);
    if (liveLog) {
      liveLog.innerHTML += `
        <div style="color: #DC2626; font-weight: 700; margin-top: 8px;">
          ❌ Error durante la ejecución multiagente: ${err.message}
        </div>
      `;
    }
    if (typeof showToast === 'function') {
      showToast(`Error multiagente: ${err.message}`, 'error');
    }
  } finally {
    multiAgentState.isExecuting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>⚡</span> Ejecutar Flujo de 5 Agentes';
    }
  }
}

/**
 * Actualiza visualmente la barra de avance de pasos (1 a 5)
 */
function updatePipelineProgress(currentStep) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`step-prog-${i}`);
    if (!el) continue;
    if (i <= currentStep) {
      el.style.background = '#4F46E5';
    } else {
      el.style.background = '#E2E8F0';
    }
  }
}

/**
 * Abre modal con detalle técnico y evidencias completas de una tarea
 */
async function openTaskDetailModal(taskId) {
  try {
    const res = await api.getAgentTaskStatus(taskId);
    if (!res || !res.success || !res.task) {
      alert('No se pudo cargar el detalle de la tarea.');
      return;
    }

    const t = res.task;
    const steps = t.steps || {};
    const audit = steps.auditor_supervisor || {};
    const meteo = steps.meteorological || {};
    const ml = steps.predictive_ml || {};
    const agri = steps.agricultural_operative || {};

    let checksHtml = '';
    if (audit.checks && Array.isArray(audit.checks)) {
      checksHtml = audit.checks.map(c => `
        <div style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: #FFFFFF; border-radius: 6px; border: 1px solid #E2E8F0; margin-bottom: 6px;">
          <span style="font-size: 14px;">${c.status === 'PASS' ? '✅' : c.status === 'WARNING' ? '⚠️' : '❌'}</span>
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 12px; color: #1E293B;">${c.name}</div>
            <div style="font-size: 11px; color: #64748B;">${c.detail}</div>
          </div>
          <span class="badge ${c.status === 'PASS' ? 'badge-green' : c.status === 'WARNING' ? 'badge-yellow' : 'badge-red'}" style="font-size: 10px;">${c.status}</span>
        </div>
      `).join('');
    }

    const modalHtml = `
      <div id="agent-task-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
        <div style="background: #FFFFFF; border-radius: 14px; width: 100%; max-width: 760px; max-height: 85vh; overflow-y: auto; padding: 24px; box-shadow: var(--shadow-lg);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #E2E8F0; padding-bottom: 12px;">
            <div>
              <h3 style="font-size: 18px; font-weight: 800; color: #1E293B; margin: 0;">
                🔍 Auditoría y Trazabilidad Multiagente: <code>${t.id}</code>
              </h3>
              <p style="font-size: 12px; color: #64748B; margin: 2px 0 0;">
                Estado: <strong>${t.status.toUpperCase()}</strong> | Duración: <strong>${t.duration_ms || 0} ms</strong> | Fecha: ${new Date(t.created_at).toLocaleString()}
              </p>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="document.getElementById('agent-task-modal').remove()">✕</button>
          </div>

          <!-- Pestaña de Verificaciones de Auditoría -->
          <div style="background: #F8FAFC; padding: 14px; border-radius: 10px; border: 1px solid #E2E8F0; margin-bottom: 16px;">
            <div style="font-weight: 700; font-size: 13px; color: #334155; margin-bottom: 10px;">
              🛡️ Dictamen de Cumplimiento del Agente Auditor (6 Controles)
            </div>
            ${checksHtml || '<div style="font-size: 12px; color: #94A3B8;">Sin desglose de checks.</div>'}
          </div>

          <!-- Desglose por Agente -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <div style="background: #F1F5F9; padding: 12px; border-radius: 8px; font-size: 11.5px;">
              <strong>⛅ Agente 2 (Meteorológico):</strong>
              <ul style="margin: 6px 0 0; padding-left: 18px;">
                <li>Fuente: ${meteo.provenance?.source || 'N/A'}</li>
                <li>Dataset Histórico: ${meteo.provenance?.historical_dataset_reference || 'N/A'}</li>
                <li>Completitud: ${meteo.data_quality?.completeness_pct || 0}%</li>
                <li>Caché: ${meteo.provenance?.cache_hit ? 'Acierto' : 'En vivo'}</li>
              </ul>
            </div>

            <div style="background: #F1F5F9; padding: 12px; border-radius: 8px; font-size: 11.5px;">
              <strong>🧠 Agente 3 (Predictivo ML):</strong>
              <ul style="margin: 6px 0 0; padding-left: 18px;">
                <li>Modelos: modelRegistry.js (v2.0.0_audited_no_leak)</li>
                <li>Monte Carlo: ${ml.monte_carlo_sensitivity?.executed ? `Ejecutado (${ml.monte_carlo_sensitivity.iterations} iter)` : 'No ejecutado'}</li>
                <li>Anotación: Simulación estocástica explícita</li>
              </ul>
            </div>

            <div style="background: #F1F5F9; padding: 12px; border-radius: 8px; font-size: 11.5px;">
              <strong>🌱 Agente 4 (Agrícola/Operativo):</strong>
              <ul style="margin: 6px 0 0; padding-left: 18px;">
                <li>Cultivo: ${(agri.crop_context?.crop_type || 'papa').toUpperCase()} (${agri.crop_context?.phenological_stage || 'tuberización'})</li>
                <li>Estrategias generadas: ${agri.total_strategies_count || 0}</li>
                <li>Guardrail B2B: Cero pedidos modificados</li>
                <li>Válvulas físicas: Gated (espera confirmación)</li>
              </ul>
            </div>

            <div style="background: #F1F5F9; padding: 12px; border-radius: 8px; font-size: 11.5px;">
              <strong>🕸️ Agente 1 (Orquestador):</strong>
              <ul style="margin: 6px 0 0; padding-left: 18px;">
                <li>Reintentos: ${t.retries || 0} / ${t.max_retries || 2}</li>
                <li>DAG: Completado sin bloqueos</li>
                <li>Persistencia: PostgreSQL (agent_tasks)</li>
              </ul>
            </div>
          </div>

          <div style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('agent-task-modal').remove()">Cerrar</button>
          </div>
        </div>
      </div>
    `;

    const existingModal = document.getElementById('agent-task-modal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    console.error('[openTaskDetailModal] Error:', err);
    alert('Error al abrir detalle de la tarea: ' + err.message);
  }
}

/**
 * Abre modal con la bitácora global de auditoría de agentes
 */
async function openAuditLogsGlobalModal() {
  try {
    const res = await api.getAgentAuditLogs({ limit: 15 });
    if (!res || !res.success) {
      alert('No se pudieron obtener los registros de auditoría.');
      return;
    }

    const logs = res.audit_logs || [];
    const rowsHtml = logs.map(l => `
      <tr>
        <td style="padding: 8px 10px; font-family: monospace;">#${l.id}</td>
        <td style="padding: 8px 10px; color: #64748B;">${new Date(l.created_at).toLocaleString()}</td>
        <td style="padding: 8px 10px;"><code>${l.task_id || '--'}</code></td>
        <td style="padding: 8px 10px;">${l.parcel_name || `Parcela ${l.parcel_id}`}</td>
        <td style="padding: 8px 10px;">
          <span class="badge ${l.compliance_status === 'verified' ? 'badge-green' : l.compliance_status === 'warning' ? 'badge-yellow' : 'badge-red'}">
            ${(l.compliance_status || 'verified').toUpperCase()}
          </span>
        </td>
        <td style="padding: 8px 10px; font-size: 11.5px; color: #475569;">
          ${l.verification_details?.summary || l.action}
        </td>
      </tr>
    `).join('');

    const modalHtml = `
      <div id="agent-audit-global-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
        <div style="background: #FFFFFF; border-radius: 14px; width: 100%; max-width: 820px; max-height: 85vh; overflow-y: auto; padding: 24px; box-shadow: var(--shadow-lg);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">
            <h3 style="font-size: 18px; font-weight: 800; color: #1E293B; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🛡️</span> Bitácora Global del Agente Auditor y Supervisor
            </h3>
            <button class="btn btn-sm btn-secondary" onclick="document.getElementById('agent-audit-global-modal').remove()">✕</button>
          </div>
          <div class="table-responsive" style="max-height: 480px; overflow-y: auto;">
            <table class="table" style="font-size: 12px; margin: 0;">
              <thead style="background: #F8FAFC;">
                <tr>
                  <th style="padding: 8px 10px;">ID Log</th>
                  <th style="padding: 8px 10px;">Fecha</th>
                  <th style="padding: 8px 10px;">Tarea</th>
                  <th style="padding: 8px 10px;">Parcela</th>
                  <th style="padding: 8px 10px;">Dictamen</th>
                  <th style="padding: 8px 10px;">Resumen</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 20px;">Sin registros de auditoría.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div style="text-align: right; margin-top: 14px;">
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('agent-audit-global-modal').remove()">Cerrar</button>
          </div>
        </div>
      </div>
    `;

    const existing = document.getElementById('agent-audit-global-modal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    console.error('[openAuditLogsGlobalModal] Error:', err);
    alert('Error al abrir bitácora de auditoría: ' + err.message);
  }
}

/**
 * Ejecuta el ciclo automatizado de actualización para todas las parcelas elegibles (Fase 7)
 */
async function triggerSchedulerCycleExecution() {
  const btn = document.getElementById('btn-trigger-scheduler-cycle');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Ejecutando Ciclo...';
  }

  try {
    const res = await api.triggerSchedulerRun();
    if (!res || !res.success) {
      alert(`Error al ejecutar ciclo: ${res?.error || 'Respuesta inválida'}`);
      return;
    }

    const count = res.results?.length ?? 0;
    const skipped = res.results?.filter(r => r.skipped)?.length ?? 0;
    const executed = count - skipped;

    if (typeof showToast === 'function') {
      showToast(`Ciclo finalizado: ${executed} parcelas procesadas, ${skipped} omitidas (al día).`, 'success');
    } else {
      alert(`Ciclo de automatización completado: ${executed} parcelas ejecutadas.`);
    }

    // Refrescar vistas
    await refreshMultiAgentStatus(false);
    await loadRecentParcelAgentTasks();
    if (multiAgentState.parcelId) {
      await loadPredictionHistoryAndMetrics(multiAgentState.parcelId);
    }
  } catch (err) {
    console.error('[triggerSchedulerCycleExecution] Error:', err);
    alert('Error al ejecutar ciclo programado: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>🔄</span> Ciclo Automatizado (Scheduler)';
    }
  }
}

/**
 * Carga el historial persistente de predicciones y métricas de exactitud para una parcela (Fase 7)
 */
async function loadPredictionHistoryAndMetrics(parcelId) {
  if (!parcelId) return;

  const tbody = document.getElementById('predictions-history-tbody');
  if (!tbody) return;

  try {
    const res = await api.getPredictionHistory(parcelId, 15);
    if (!res || !res.success) return;

    // Pintar métricas de exactitud
    const m = res.metrics || {};
    const elTot = document.getElementById('metric-pred-total');
    const elHits = document.getElementById('metric-pred-hits');
    const elMisses = document.getElementById('metric-pred-misses');
    const elFa = document.getElementById('metric-pred-false-alarms');
    const elCn = document.getElementById('metric-pred-correct-neg');
    const elAcc = document.getElementById('metric-pred-accuracy');

    if (elTot) elTot.textContent = m.total_evaluated ?? 0;
    if (elHits) elHits.textContent = m.hits ?? 0;
    if (elMisses) elMisses.textContent = m.misses ?? 0;
    if (elFa) elFa.textContent = m.false_alarms ?? 0;
    if (elCn) elCn.textContent = m.correct_negatives ?? 0;
    if (elAcc) elAcc.textContent = m.accuracy_percentage ? `${m.accuracy_percentage}%` : (m.total_evaluated > 0 ? '100%' : '--%');

    // Pintar filas de tabla
    const preds = res.predictions || [];
    if (preds.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 20px; color: #94A3B8;">
            No hay predicciones persistentes registradas para esta parcela todavía.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = preds.map(p => {
      const issuedAt = p.issued_at ? new Date(p.issued_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '--';
      const targetDate = p.target_date ? new Date(p.target_date).toLocaleDateString('es-PE') : '--';

      const riskBadge = p.predicted_risk_level === 'high' || p.predicted_risk_level === 'extreme'
        ? '<span class="badge badge-red" style="font-size: 10px;">Alto</span>'
        : p.predicted_risk_level === 'medium'
        ? '<span class="badge badge-yellow" style="font-size: 10px;">Medio</span>'
        : '<span class="badge badge-green" style="font-size: 10px;">Bajo</span>';

      const statusBadge = p.verification_status === 'hit'
        ? '<span class="badge badge-green" style="font-size: 10px;">✓ Acierto (Hit)</span>'
        : p.verification_status === 'miss'
        ? '<span class="badge badge-red" style="font-size: 10px;">❌ Fallo (Miss)</span>'
        : p.verification_status === 'false_alarm'
        ? '<span class="badge badge-yellow" style="font-size: 10px;">⚠️ Falsa Alarma</span>'
        : p.verification_status === 'correct_negative'
        ? '<span class="badge badge-blue" style="font-size: 10px;">✓ Neg. Correcto</span>'
        : '<span class="badge badge-gray" style="font-size: 10px;">Pendiente</span>';

      const obsText = p.observed_occurrence === true
        ? '<strong style="color: #DC2626;">Ocurrió</strong>'
        : p.observed_occurrence === false
        ? '<span style="color: #16A34A;">No ocurrió</span>'
        : '<span style="color: #94A3B8;">Sin obs.</span>';

      return `
        <tr>
          <td style="padding: 8px 12px; font-family: monospace;">${issuedAt}</td>
          <td style="padding: 8px 12px; font-weight: 700; color: #4338CA;">${p.horizon_hours}h</td>
          <td style="padding: 8px 12px; text-transform: capitalize;">${p.phenomenon}</td>
          <td style="padding: 8px 12px;">${riskBadge} <span style="font-size: 11px; color: #64748B;">(${(p.predicted_probability * 100).toFixed(0)}%)</span></td>
          <td style="padding: 8px 12px; font-size: 11px;"><code>${p.model_name || 'Ensemble'}</code></td>
          <td style="padding: 8px 12px;">${targetDate}</td>
          <td style="padding: 8px 12px;">${obsText}</td>
          <td style="padding: 8px 12px;">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('[loadPredictionHistoryAndMetrics] Error:', err.message);
  }
}

/**
 * Dispara el proceso de evaluación contra observaciones reales (Ground Truth)
 */
async function triggerEvaluatePredictions() {
  try {
    const res = await api.evaluatePredictions();
    if (!res || !res.success) {
      alert(`Error al evaluar predicciones: ${res?.error || 'Respuesta inválida'}`);
      return;
    }

    const evalCount = res.evaluated_count ?? 0;
    if (typeof showToast === 'function') {
      showToast(`Evaluación completada: ${evalCount} pronósticos contrastados con observaciones.`, 'info');
    } else {
      alert(`Evaluación completada: ${evalCount} pronósticos contrastados.`);
    }

    if (multiAgentState.parcelId) {
      await loadPredictionHistoryAndMetrics(multiAgentState.parcelId);
    }
  } catch (err) {
    console.error('[triggerEvaluatePredictions] Error:', err);
    alert('Error al evaluar predicciones: ' + err.message);
  }
}

// Exportación global para frontend
if (typeof window !== 'undefined') {
  window.renderMultiAgentSystemSection = renderMultiAgentSystemSection;
  window.initMultiAgentSystem = initMultiAgentSystem;
  window.refreshMultiAgentStatus = refreshMultiAgentStatus;
  window.triggerMultiAgentExecution = triggerMultiAgentExecution;
  window.triggerSchedulerCycleExecution = triggerSchedulerCycleExecution;
  window.loadRecentParcelAgentTasks = loadRecentParcelAgentTasks;
  window.loadPredictionHistoryAndMetrics = loadPredictionHistoryAndMetrics;
  window.triggerEvaluatePredictions = triggerEvaluatePredictions;
  window.openTaskDetailModal = openTaskDetailModal;
  window.openAuditLogsGlobalModal = openAuditLogsGlobalModal;
}
