/**
 * AgroPasco Digital — Módulo de Estrategias de Mitigación y Respuesta (Fase 5)
 * ==============================================================================
 * Sistema interactivo de apoyo a decisiones agronómicas (DSS):
 *  - Presenta estrategias preventivas priorizadas por fenómeno, cultivo y fenología.
 *  - Distingue pronóstico operativo, inferencia ML, simulación Monte Carlo y acción real.
 *  - Permite al agricultor registrar el estado de la acción (Pendiente, En Proceso, Realizada, No Aplicable).
 *  - Permite al asesor técnico añadir observaciones y recomendaciones de campo.
 */

const mitigationState = {
  parcelId: null,
  crop: 'papa',
  phenologicalStage: 'tuberizacion',
  phenomenon: 'frost',
  horizon: '24h',
  strategies: [],
  context: null,
  isLoading: false,
  lastUpdated: null,
};

/**
 * Renderiza la sección completa de Estrategias de Mitigación para el Dashboard
 */
function renderMitigationStrategiesSection() {
  return `
    <div class="card" id="section-mitigation-strategies" style="margin-bottom: 24px; padding: 22px; border: 1px solid #BBF7D0; background: linear-gradient(180deg, #FFFFFF 0%, #F0FDF4 100%); box-shadow: var(--shadow-sm);">
      <!-- 1. Encabezado de la Sección -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; border-bottom: 1px solid rgba(22, 163, 74, 0.2); padding-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 800; color: #166534; margin: 0;">
              🛡️ Estrategias de Mitigación & Respuesta Agroclimática
            </h3>
            <span class="badge badge-green" style="font-size: 11px; font-weight: 700;">
              Fase 5 Operativa
            </span>
          </div>
          <p class="text-sm text-muted" style="margin: 4px 0 0;">
            Planes de acción preventivos basados en normas técnicas INIA y SENAMHI, adaptados a la altitud y fenología de Pasco.
          </p>
        </div>

        <!-- Controles Rápidos de Filtro -->
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 12px; font-weight: 700; color: #166534;">Fenómeno:</label>
            <select id="mitig-select-phenomenon" class="form-control" style="font-size: 12px; padding: 5px 10px; border-radius: 6px; font-weight: 600;" onchange="onMitigationFilterChanged()">
              <option value="frost" ${mitigationState.phenomenon === 'frost' ? 'selected' : ''}>❄️ Heladas</option>
              <option value="heavy_rain" ${mitigationState.phenomenon === 'heavy_rain' ? 'selected' : ''}>🌧️ Lluvias Intensas</option>
              <option value="snow" ${mitigationState.phenomenon === 'snow' ? 'selected' : ''}>🌨️ Nevadas</option>
              <option value="hail" ${mitigationState.phenomenon === 'hail' ? 'selected' : ''}>🌩️ Granizadas</option>
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 12px; font-weight: 700; color: #166534;">Horizonte:</label>
            <select id="mitig-select-horizon" class="form-control" style="font-size: 12px; padding: 5px 10px; border-radius: 6px; font-weight: 600;" onchange="onMitigationFilterChanged()">
              <option value="24h" ${mitigationState.horizon === '24h' ? 'selected' : ''}>24 Horas</option>
              <option value="48h" ${mitigationState.horizon === '48h' ? 'selected' : ''}>48 Horas</option>
              <option value="72h" ${mitigationState.horizon === '72h' ? 'selected' : ''}>72 Horas</option>
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 12px; font-weight: 700; color: #166534;">Etapa Cultivo:</label>
            <select id="mitig-select-stage" class="form-control" style="font-size: 12px; padding: 5px 10px; border-radius: 6px; font-weight: 600;" onchange="onMitigationFilterChanged()">
              <option value="emergencia" ${mitigationState.phenologicalStage === 'emergencia' ? 'selected' : ''}>Emergencia</option>
              <option value="vegetativo" ${mitigationState.phenologicalStage === 'vegetativo' ? 'selected' : ''}>Vegetativo</option>
              <option value="floracion" ${mitigationState.phenologicalStage === 'floracion' ? 'selected' : ''}>Floración</option>
              <option value="tuberizacion" ${mitigationState.phenologicalStage === 'tuberizacion' ? 'selected' : ''}>Tuberización / Fructificación</option>
              <option value="maduracion" ${mitigationState.phenologicalStage === 'maduracion' ? 'selected' : ''}>Maduración / Cosecha</option>
            </select>
          </div>

          <button class="btn btn-secondary btn-sm" style="font-size: 12px;" onclick="loadMitigationStrategies(null, true)">
            🔄 Actualizar
          </button>
        </div>
      </div>

      <!-- 2. Tarjeta Resumen de Amenaza y Sensibilidad Estocástica -->
      <div id="mitigation-threat-summary" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin-bottom: 20px; box-shadow: var(--shadow-sm);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">Contexto Agrícola Evaluado</div>
            <div style="font-size: 16px; font-weight: 800; color: #1E293B; margin-top: 2px;" id="mitig-summary-parcel-title">
              Cargando parcela...
            </div>
          </div>

          <!-- Nivel de Riesgo Operativo -->
          <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
            <div style="text-align: right;">
              <div style="font-size: 11px; font-weight: 700; color: #64748B;">Riesgo Operativo ML:</div>
              <div id="mitig-summary-risk-badge" style="font-weight: 800; font-size: 14px;">--</div>
            </div>
            <div style="text-align: right; border-left: 1px solid #E2E8F0; padding-left: 14px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748B;">Ventana de Alerta:</div>
              <div id="mitig-summary-hours" style="font-weight: 800; font-size: 14px; color: #0284C7;">-- horas</div>
            </div>
            <div style="text-align: right; border-left: 1px solid #E2E8F0; padding-left: 14px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748B;">Sensibilidad Monte Carlo (P90):</div>
              <div id="mitig-summary-p90" style="font-weight: 800; font-size: 14px; color: #7C3AED;">--</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Contenedor Dinámico de Tarjetas de Estrategias -->
      <div id="mitigation-cards-container" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="text-align: center; padding: 30px; color: #64748B;">
          <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
          Cargando recomendaciones técnicas para la parcela...
        </div>
      </div>

      <!-- 4. Pie de Transparencia y Gobernanza Técnica -->
      <div style="margin-top: 20px; padding: 14px 18px; background: #F8FAFC; border-radius: 10px; border: 1px solid #E2E8F0; font-size: 11.5px; color: #475569; line-height: 1.5;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #334155; margin-bottom: 4px;">
          <span>⚖️</span> Marco de Gobernanza Técnica y Distinción Metodológica:
        </div>
        <p style="margin: 0;">
          <strong>1. Pronóstico Meteorológico:</strong> Procede de Open-Meteo / ERA5 calibrado. &nbsp;|&nbsp;
          <strong>2. Predicción ML:</strong> Probabilidad continua estimada por modelos nativos supervisados. &nbsp;|&nbsp;
          <strong>3. Simulación Monte Carlo:</strong> Ensayo de dispersión estocástica ante variabilidad andina. &nbsp;|&nbsp;
          <strong>4. Estrategia Agronómica:</strong> Medida consultiva preventiva basada en guías INIA. &nbsp;|&nbsp;
          <strong>5. Acción en Campo:</strong> Ejecutada y validada exclusivamente bajo confirmación del agricultor.
        </p>
      </div>
    </div>
  `;
}

/**
 * Carga las estrategias para la parcela activa desde el backend
 */
async function loadMitigationStrategies(targetParcelId = null, isManualTrigger = false) {
  const parcelId = targetParcelId || predictiveDashboardState?.selectedParcelId || mitigationState.parcelId;
  if (!parcelId) return;

  mitigationState.parcelId = parcelId;
  mitigationState.isLoading = true;

  const phenSelect = document.getElementById('mitig-select-phenomenon');
  if (phenSelect) mitigationState.phenomenon = phenSelect.value;

  const horizSelect = document.getElementById('mitig-select-horizon');
  if (horizSelect) mitigationState.horizon = horizSelect.value;

  const stageSelect = document.getElementById('mitig-select-stage');
  if (stageSelect) mitigationState.phenologicalStage = stageSelect.value;

  try {
    const res = await api.getMitigationStrategies(parcelId, {
      phenomenon: mitigationState.phenomenon,
      horizon: mitigationState.horizon,
      stage: mitigationState.phenologicalStage,
    });

    if (res && res.success) {
      mitigationState.strategies = res.strategies || [];
      mitigationState.context = res.context || {};
      mitigationState.lastUpdated = new Date();
      renderMitigationCardsUI();
      if (isManualTrigger) {
        showToast('Estrategias de mitigación actualizadas con éxito', 'success');
      }
    }
  } catch (err) {
    console.error('Error al cargar estrategias de mitigación:', err);
    const container = document.getElementById('mitigation-cards-container');
    if (container) {
      container.innerHTML = `
        <div style="background: #FEF2F2; border: 1px solid #FCA5A5; padding: 18px; border-radius: 10px; color: #991B1B;">
          <strong>⚠️ Error al consultar estrategias:</strong> ${err.message || 'Error de conexión'}.
        </div>
      `;
    }
  } finally {
    mitigationState.isLoading = false;
  }
}

/**
 * Renderiza las tarjetas de estrategias en el DOM
 */
function renderMitigationCardsUI() {
  const container = document.getElementById('mitigation-cards-container');
  if (!container) return;

  // Actualizar Tarjeta Resumen
  const parcelTitle = document.getElementById('mitig-summary-parcel-title');
  const riskBadge = document.getElementById('mitig-summary-risk-badge');
  const hoursEl = document.getElementById('mitig-summary-hours');
  const p90El = document.getElementById('mitig-summary-p90');

  const currentParcel = predictiveDashboardState?.parcels?.find(p => p.id === Number(mitigationState.parcelId));
  const parcelName = currentParcel?.name || `Parcela #${mitigationState.parcelId}`;
  const cropName = currentParcel?.crop_type || mitigationState.context?.crop || 'Papa';
  const altitude = currentParcel?.altitude_masl || mitigationState.context?.altitude_masl || 4000;

  if (parcelTitle) {
    parcelTitle.innerHTML = `
      ${parcelName} &bull; <span style="color: #166534;">Cultivo: ${cropName.toUpperCase()}</span> (${mitigationState.phenologicalStage}) &bull; ${altitude} msnm
    `;
  }

  const riskLevel = mitigationState.context?.operational_risk?.level || 'none';
  const riskScore = mitigationState.context?.operational_risk?.score || 0;
  const levelColors = {
    high: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', label: 'ALTO' },
    moderate: { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', label: 'MODERADO' },
    low: { bg: '#DCFCE7', border: '#22C55E', text: '#15803D', label: 'BAJO' },
    none: { bg: '#F1F5F9', border: '#94A3B8', text: '#475569', label: 'SIN RIESGO' },
  };
  const c = levelColors[riskLevel] || levelColors.none;

  if (riskBadge) {
    riskBadge.innerHTML = `<span style="padding: 2px 8px; border-radius: 6px; background: ${c.bg}; color: ${c.text}; border: 1px solid ${c.border};">${c.label} (${riskScore} pts)</span>`;
  }
  if (hoursEl) {
    hoursEl.textContent = `~${mitigationState.context?.hours_to_event || 24} h`;
  }
  if (p90El) {
    const p90 = mitigationState.context?.monte_carlo_sensitivity?.p90;
    p90El.textContent = p90 !== undefined ? `${(p90 * 100).toFixed(1)}%` : 'No simulado';
  }

  const strategies = mitigationState.strategies || [];

  if (strategies.length === 0) {
    container.innerHTML = `
      <div style="background: #F8FAFC; border: 1px dashed #CBD5E1; padding: 24px; border-radius: 10px; text-align: center; color: #64748B;">
        <div style="font-size: 26px; margin-bottom: 6px;">🌱</div>
        <strong>No se requieren medidas urgentes para este nivel de riesgo.</strong>
        <p class="text-xs" style="margin: 4px 0 0;">El nivel actual es bajo o sin riesgo. Continúe con las labores agrícolas regulares.</p>
      </div>
    `;
    return;
  }

  const priorityMeta = {
    critica: { label: 'CRÍTICA', color: '#DC2626', bg: '#FEE2E2', icon: '🚨' },
    alta: { label: 'ALTA', color: '#D97706', bg: '#FEF3C7', icon: '⚠️' },
    media: { label: 'MEDIA', color: '#2563EB', bg: '#DBEAFE', icon: 'ℹ️' },
    baja: { label: 'BAJA', color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
  };

  const statusMeta = {
    pendiente: { label: 'Pendiente', color: '#64748B', bg: '#F1F5F9', icon: '⏳' },
    en_proceso: { label: 'En Proceso', color: '#D97706', bg: '#FEF3C7', icon: '🔄' },
    realizada: { label: 'Realizada', color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
    no_aplicable: { label: 'No Aplicable', color: '#475569', bg: '#E2E8F0', icon: '🚫' },
  };

  container.innerHTML = strategies.map(strat => {
    const pMeta = priorityMeta[strat.priority] || priorityMeta.media;
    const currentStatus = strat.status || 'pendiente';
    const sMeta = statusMeta[currentStatus] || statusMeta.pendiente;

    const instructionsHtml = strat.instructions.map(inst => `<li style="margin-bottom: 4px;">${inst}</li>`).join('');

    return `
      <div class="card" style="padding: 18px; border-left: 5px solid ${pMeta.color}; background: #FFFFFF; box-shadow: var(--shadow-sm); transition: transform 0.2s ease;">
        <!-- Cabecera de Estrategia -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
          <div style="flex: 1; min-width: 280px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: ${pMeta.bg}; color: ${pMeta.color}; border: 1px solid ${pMeta.color};">
                ${pMeta.icon} PRIORIDAD ${pMeta.label}
              </span>
              <span class="badge badge-gray" style="font-size: 10px; text-transform: uppercase;">
                ${strat.category.replace('_', ' ')}
              </span>
              <span style="font-size: 11px; color: #64748B;">
                Código: <code>${strat.strategy_id}</code>
              </span>
            </div>
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 800; color: #1E293B; margin: 6px 0 2px;">
              ${strat.title}
            </h4>
            <div class="text-xs" style="color: #0284C7; font-weight: 600;">
              ⏱️ Ventana Recomendada: ${strat.time_window} (${strat.lead_time_desc})
            </div>
          </div>

          <!-- Estado de Seguimiento Interactivo -->
          <div style="text-align: right;">
            <div style="font-size: 11px; font-weight: 700; color: #64748B; margin-bottom: 4px;">Estado de Seguimiento:</div>
            <div style="display: inline-flex; background: #F1F5F9; padding: 3px; border-radius: 8px; border: 1px solid #CBD5E1; gap: 4px;">
              <button class="btn btn-xs ${currentStatus === 'pendiente' ? 'btn-secondary' : 'btn-outline-secondary'}" style="font-size: 10.5px; padding: 3px 7px; ${currentStatus === 'pendiente' ? 'background: #94A3B8; color: white;' : ''}" onclick="changeMitigationActionStatus('${strat.strategy_id}', 'pendiente', '${strat.phenomenon}', '${strat.title}')">
                ⏳ Pendiente
              </button>
              <button class="btn btn-xs ${currentStatus === 'en_proceso' ? 'btn-warning' : 'btn-outline-secondary'}" style="font-size: 10.5px; padding: 3px 7px; ${currentStatus === 'en_proceso' ? 'background: #D97706; color: white;' : ''}" onclick="changeMitigationActionStatus('${strat.strategy_id}', 'en_proceso', '${strat.phenomenon}', '${strat.title}')">
                🔄 En Proceso
              </button>
              <button class="btn btn-xs ${currentStatus === 'realizada' ? 'btn-success' : 'btn-outline-secondary'}" style="font-size: 10.5px; padding: 3px 7px; ${currentStatus === 'realizada' ? 'background: #16A34A; color: white;' : ''}" onclick="changeMitigationActionStatus('${strat.strategy_id}', 'realizada', '${strat.phenomenon}', '${strat.title}')">
                ✅ Realizada
              </button>
              <button class="btn btn-xs ${currentStatus === 'no_aplicable' ? 'btn-secondary' : 'btn-outline-secondary'}" style="font-size: 10.5px; padding: 3px 7px;" onclick="changeMitigationActionStatus('${strat.strategy_id}', 'no_aplicable', '${strat.phenomenon}', '${strat.title}')">
                🚫 N/A
              </button>
            </div>
          </div>
        </div>

        <!-- Instrucciones y Recursos -->
        <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; margin-bottom: 12px; font-size: 12.5px;" class="mitig-body-grid">
          <div>
            <div style="font-weight: 700; color: #334155; margin-bottom: 4px;">📋 Procedimiento Técnico Recomendado:</div>
            <ul style="margin: 0; padding-left: 18px; line-height: 1.45; color: #1E293B;">
              ${instructionsHtml}
            </ul>

            ${strat.agronomic_context_note ? `
              <div style="margin-top: 8px; font-size: 11px; color: #166534; background: #DCFCE7; padding: 6px 10px; border-radius: 6px; border-left: 3px solid #22C55E;">
                🌱 <strong>Contexto Agronómico:</strong> ${strat.agronomic_context_note}
              </div>
            ` : ''}
          </div>

          <div style="background: #F8FAFC; padding: 12px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <div style="font-weight: 700; color: #334155; margin-bottom: 4px;">🧰 Recursos & Herramientas:</div>
            <div style="font-size: 12px; color: #475569; margin-bottom: 8px;">
              ${strat.resources_needed}
            </div>

            <div style="font-weight: 700; color: #D97706; margin-bottom: 2px;">⚠️ Precauciones Críticas:</div>
            <div style="font-size: 11.5px; color: #92400E; line-height: 1.35;">
              ${strat.precautions}
            </div>
          </div>
        </div>

        <!-- Justificación Técnica y Sensibilidad Monte Carlo -->
        <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 10px 14px; font-size: 11.5px; margin-bottom: 8px; color: #1E40AF;">
          <strong>🔬 Justificación Agronómica (${strat.source_standard}):</strong> ${strat.technical_rationale}
          <div style="margin-top: 4px; color: #6D28D9;">
            <strong>🎲 Sensibilidad Monte Carlo:</strong> ${strat.stochastic_sensitivity}
          </div>
        </div>

        <!-- Notas de Seguimiento y Notas de Asesor Técnico -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 11px; color: #64748B; border-top: 1px dashed #CBD5E1; padding-top: 8px;">
          <div>
            <span>Última actualización: <strong>${strat.tracking?.last_updated ? new Date(strat.tracking.last_updated).toLocaleString() : 'Reciente'}</strong></span>
            ${strat.tracking?.notes ? `<span style="margin-left: 10px; color: #1E293B;">📝 Nota: "${strat.tracking.notes}"</span>` : ''}
            ${strat.tracking?.advisor_notes ? `<span style="margin-left: 10px; color: #166534; font-weight: 700;">👨‍🌾 Observación Asesor: "${strat.tracking.advisor_notes}"</span>` : ''}
          </div>
          <button class="btn btn-outline-secondary btn-xs" style="font-size: 10.5px;" onclick="openMitigationActionModal('${strat.strategy_id}', '${strat.title}')">
            ✏️ Añadir Nota de Campo
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Evento al cambiar filtros de fenómeno, horizonte o fenología
 */
function onMitigationFilterChanged() {
  loadMitigationStrategies(null, false);
}

/**
 * Cambia el estado de una acción preventiva en el backend
 */
async function changeMitigationActionStatus(strategyId, status, phenomenon, actionName) {
  const parcelId = mitigationState.parcelId;
  if (!parcelId) return;

  try {
    const res = await api.recordMitigationAction({
      parcel_id: parcelId,
      strategy_id: strategyId,
      phenomenon,
      action_name: actionName,
      status,
      horizon: mitigationState.horizon,
      risk_level: mitigationState.context?.operational_risk?.level || 'moderate',
    });

    if (res && res.success) {
      showToast(`Estado actualizado: ${status.toUpperCase()}`, 'success');
      // Actualizar estado local
      const strat = mitigationState.strategies.find(s => s.strategy_id === strategyId);
      if (strat) strat.status = status;
      renderMitigationCardsUI();
    }
  } catch (err) {
    showToast(`Error al actualizar estado: ${err.message}`, 'error');
  }
}

/**
 * Abre modal para registrar nota de campo u observación técnica de asesor
 */
function openMitigationActionModal(strategyId, actionName) {
  const user = getUser();
  const isAdvisorOrAdmin = user?.role === 'advisor' || user?.role === 'admin';

  const modalHtml = `
    <div class="modal-backdrop" id="mitig-note-modal" onclick="closeMitigationActionModal()">
      <div class="modal-card" style="max-width: 500px;" onclick="event.stopPropagation()">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
          <h3 style="font-size: 15px; font-weight: 800; color: #166534; margin: 0;">
            📝 Registro de Seguimiento en Campo
          </h3>
          <button class="btn-icon" onclick="closeMitigationActionModal()">✕</button>
        </div>
        <div class="modal-body" style="padding: 14px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">
            ${actionName}
          </div>
          <div class="text-xs text-muted" style="margin-bottom: 12px;">Código: <code>${strategyId}</code></div>

          <label style="font-size: 12px; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">
            ${isAdvisorOrAdmin ? 'Observación Técnica del Asesor Agrario:' : 'Nota de Ejecución del Agricultor:'}
          </label>
          <textarea id="mitig-input-note" class="form-control" rows="3" style="width: 100%; font-size: 12.5px; border-radius: 8px;" placeholder="Ej: Se instalaron 50m² de manta térmica sobre camellones de papa a las 17:30h..."></textarea>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px;">
          <button class="btn btn-secondary btn-sm" onclick="closeMitigationActionModal()">Cancelar</button>
          <button class="btn btn-primary btn-sm" onclick="submitMitigationActionNote('${strategyId}', ${isAdvisorOrAdmin})">Guardar Nota</button>
        </div>
      </div>
    </div>
  `;

  const existing = document.getElementById('mitig-note-modal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeMitigationActionModal() {
  const m = document.getElementById('mitig-note-modal');
  if (m) m.remove();
}

async function submitMitigationActionNote(strategyId, isAdvisor) {
  const noteEl = document.getElementById('mitig-input-note');
  const noteText = noteEl?.value?.trim();
  if (!noteText) {
    showToast('Ingrese una nota antes de guardar', 'warning');
    return;
  }

  const parcelId = mitigationState.parcelId;

  try {
    if (isAdvisor) {
      await api.addAdvisorMitigationNote({
        parcel_id: parcelId,
        strategy_id: strategyId,
        notes: noteText,
      });
      showToast('Observación técnica de asesor guardada', 'success');
    } else {
      await api.recordMitigationAction({
        parcel_id: parcelId,
        strategy_id: strategyId,
        action_name: strategyId,
        notes: noteText,
        status: 'en_proceso',
      });
      showToast('Nota de agricultor guardada en el historial', 'success');
    }

    closeMitigationActionModal();
    loadMitigationStrategies(parcelId, false);
  } catch (err) {
    showToast(`Error al guardar nota: ${err.message}`, 'error');
  }
}
