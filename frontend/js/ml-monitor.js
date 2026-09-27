/**
 * AgroPasco — Panel de Monitoreo Meteorológico Inteligente (ML)
 * ==============================================================
 * Vista de predicciones ML por parcela para agricultores, asesores y admin.
 * Muestra: predicciones de heladas, lluvias, nieve; estado de modelos;
 * transparencia sobre origen de las predicciones (ML vs reglas).
 */

// ===== CONSTANTES VISUALES =====
const ML_PHENOMENON_META = {
  frost: { emoji: '🥶', name: 'Helada', color: '#60a5fa', gradient: 'linear-gradient(135deg, #1e3a5f, #2563eb)' },
  heavy_rain: { emoji: '🌧️', name: 'Lluvia Intensa', color: '#34d399', gradient: 'linear-gradient(135deg, #064e3b, #059669)' },
  snow: { emoji: '❄️', name: 'Nevada', color: '#a78bfa', gradient: 'linear-gradient(135deg, #312e81, #7c3aed)' },
  hail: { emoji: '🌩️', name: 'Granizo', color: '#fbbf24', gradient: 'linear-gradient(135deg, #78350f, #d97706)' },
};

const ML_RISK_LEVELS = {
  high:     { label: 'ALTO',     badge: 'red',    bar: 'var(--red-400)',    icon: '🔴' },
  moderate: { label: 'MODERADO', badge: 'amber',  bar: 'var(--amber-400)',  icon: '🟡' },
  low:      { label: 'BAJO',     badge: 'green',  bar: 'var(--green-400)',  icon: '🟢' },
  none:     { label: 'SIN RIESGO', badge: 'green', bar: 'var(--green-500)', icon: '✅' },
  model_unavailable: { label: 'NO DISPONIBLE', badge: 'gray', bar: 'var(--text-muted)', icon: '⚪' },
};

// ===== RENDER PRINCIPAL =====
async function renderMLMonitorPage() {
  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const isAdvisor = user?.role === 'advisor';

  // Fetch data in parallel
  const [predictionsRes, modelsRes] = await Promise.all([
    (isAdmin || isAdvisor) ? api.getMLPredictionsAll() : api.getMLPredictions(),
    api.getMLModelsStatus(),
  ]);

  const predictions = predictionsRes?.data || [];
  const modelsData = modelsRes?.data || {};
  const mlStatus = modelsData.ml_service || 'offline';
  const modelsList = modelsData.models || {};

  return `
    <div class="page-content">
      <!-- Header -->
      <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; margin: 0;">🔬 Monitoreo Meteorológico Inteligente</h2>
          <p class="text-sm text-muted" style="margin: 4px 0 0;">Predicciones validadas y soporte a la decisión agrícola en Pasco</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick="openMLPreferencesModal()" style="font-size: 12px;">
            ⚙️ Mis Preferencias
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openObservationsListModal()" style="font-size: 12px;">
            📋 Observaciones (${user?.role === 'admin' || user?.role === 'advisor' ? 'Campo/SENAMHI' : 'Verificadas'})
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openCreateObservationModal()" style="font-size: 12px;">
            📝 Registrar Evento
          </button>
          <span class="badge badge-${mlStatus === 'online' ? 'green' : 'amber'}" style="font-size: 12px;">
            ${mlStatus === 'online' ? '⚡ Servicio ML Activo' : '⚙️ Modo Reglas'}
          </span>
          ${isAdmin ? `
            <button class="btn btn-primary btn-sm" onclick="triggerMLAlerts()" id="btn-generate-alerts" style="font-size: 12px;">
              🔔 Generar Alertas
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Models Status Cards -->
      ${renderModelsStatusBar(modelsList)}

      <!-- Predictions Grid -->
      <div style="margin-top: 24px;">
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 14px;">
          📊 Predicciones por Parcela ${predictions.length > 0 ? `(${predictions.length})` : ''}
        </div>
        ${predictions.length > 0
          ? predictions.map(p => renderParcelPredictionCard(p)).join('')
          : renderNoPredictions()
        }
      </div>

      <!-- Transparency Note -->
      <div class="card" style="margin-top: 24px; border-left: 4px solid var(--purple-400); opacity: 0.85;">
        <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px;">📖 Transparencia del Sistema ML</div>
        <ul style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; margin: 0; padding-left: 18px;">
          <li><strong>Etiquetas proxy:</strong> Los modelos se entrenaron con reglas meteorológicas documentadas (WMO/SENAMHI), NO con observaciones verificadas en campo.</li>
          <li><strong>Datos de reanálisis:</strong> La fuente es Open-Meteo (ERA5/GFS), no estaciones meteorológicas locales.</li>
          <li><strong>Cobertura limitada:</strong> Modelos entrenados con datos de Cerro de Pasco (4337m), Yanahuanca (3219m) y Oxapampa (1817m).</li>
          <li><strong>No son probabilidades calibradas:</strong> Las puntuaciones indican nivel de riesgo relativo, no probabilidad exacta.</li>
          <li>Cada predicción indica si proviene de un <span class="badge badge-blue" style="font-size: 10px;">Modelo ML</span> o de <span class="badge badge-amber" style="font-size: 10px;">Reglas</span>.</li>
        </ul>
      </div>
    </div>
  `;
}

// ===== BARRA DE ESTADO DE MODELOS =====
function renderModelsStatusBar(modelsList) {
  const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];

  return `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
      ${phenomena.map(p => {
        const meta = ML_PHENOMENON_META[p];
        const model = modelsList[p] || {};
        const available = model.available;
        const modelType = available ? model.model_type : 'Reglas';
        const metrics = model.validation_metrics || {};

        return `
          <div class="card" style="padding: 14px; background: ${meta.gradient}; border: none; position: relative; overflow: hidden;">
            <div style="position: absolute; top: -10px; right: -10px; font-size: 48px; opacity: 0.15;">${meta.emoji}</div>
            <div style="font-size: 22px; margin-bottom: 4px;">${meta.emoji}</div>
            <div style="font-weight: 700; font-size: 14px;">${meta.name}</div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">
              <span class="badge badge-${available ? 'green' : 'amber'}" style="font-size: 10px;">
                ${available ? '✓ ML' : '⚙ Reglas'}
              </span>
              <span style="font-size: 11px; color: rgba(255,255,255,0.7);">${modelType}</span>
            </div>
            ${available ? `
              <div style="margin-top: 8px; font-size: 11px; color: rgba(255,255,255,0.85);">
                Test F1: <strong>${(model.test_metrics?.f1 ?? model.audited_metrics_without_target_leakage?.f1 ?? metrics.f1 ?? 'N/A')}</strong> | Rec: ${(model.test_metrics?.recall ?? model.audited_metrics_without_target_leakage?.recall ?? metrics.recall ?? 'N/A')}
              </div>
              <div style="font-size: 10px; color: rgba(255,255,255,0.7); margin-top: 2px;">
                PR-AUC: <strong>${(model.test_metrics?.pr_auc ?? 'N/A')}</strong> | ECE: ${(model.test_metrics?.expected_calibration_error ?? 'N/A')}
              </div>
            ` : `
              <div style="margin-top: 8px; font-size: 10.5px; color: rgba(255,255,255,0.85); line-height: 1.3;">
                Reglas heurísticas físicas documentadas (0 eventos en ERA5)
              </div>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===== CARD DE PREDICCIÓN POR PARCELA =====
function renderParcelPredictionCard(parcelPred) {
  const pred = parcelPred.data || parcelPred;
  const predictions = pred?.predictions || [];
  const summary = pred?.forecast_summary || {};
  const warning = pred?.coverage_warning;
  const source = parcelPred.source || 'unknown';
  const parcelName = pred?.parcel_name || parcelPred.parcel_name || 'Parcela';
  const altitude = pred?.altitude_masl || parcelPred.altitude_masl;
  const farmerName = parcelPred.farmer_name;

  if (!parcelPred.success && parcelPred.success !== undefined) {
    return `
      <div class="card" style="margin-bottom: 12px; border-left: 4px solid var(--red-400); opacity: 0.7;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">⚠️</span>
          <div>
            <div style="font-weight: 700;">${parcelName}</div>
            <div class="text-sm text-muted">${parcelPred.error || 'No se pudo obtener predicción'}</div>
          </div>
        </div>
      </div>
    `;
  }

  // Determine highest risk
  let maxRisk = 'none';
  let maxScore = 0;
  predictions.forEach(p => {
    const score = p.risk_score || 0;
    if (score > maxScore) {
      maxScore = score;
      maxRisk = p.risk_level || 'none';
    }
  });

  const riskMeta = ML_RISK_LEVELS[maxRisk] || ML_RISK_LEVELS.none;

  return `
    <div class="card" style="margin-bottom: 14px; border-left: 4px solid ${riskMeta.bar};">
      <!-- Parcel Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 800; font-size: 15px;">🗺️ ${parcelName}</div>
          <div class="text-sm text-muted" style="margin-top: 2px;">
            ${altitude ? `${altitude} msnm` : ''}
            ${farmerName ? ` — ${farmerName}` : ''}
            ${pred?.latitude ? ` · (${pred.latitude.toFixed(4)}, ${pred.longitude.toFixed(4)})` : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="badge badge-${riskMeta.badge}" style="font-weight: 800; font-size: 12px;">
            ${riskMeta.icon} Riesgo ${riskMeta.label}
          </span>
          <span class="badge badge-${source === 'ml_service' ? 'blue' : 'amber'}" style="font-size: 10px;">
            ${source === 'ml_service' ? '🔬 ML' : source === 'cache' ? '📦 Cache' : '⚙️ Reglas'}
          </span>
        </div>
      </div>

      ${warning ? `
        <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 12px; color: var(--amber-400);">
          ⚠️ ${warning}
        </div>
      ` : ''}

      <!-- Risk Predictions Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
        ${predictions.map(p => renderPhenomenonCard(p)).join('')}
      </div>

      <!-- Forecast Summary -->
      ${summary.dates && summary.dates.length > 0 ? `
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-color);">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: var(--text-secondary);">📅 Pronóstico (${summary.days || 0} días)</div>
          <div style="display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px;">
            ${(summary.dates || []).map((date, i) => `
              <div style="flex-shrink: 0; text-align: center; padding: 6px 10px; background: var(--bg-glass); border-radius: 8px; min-width: 80px;">
                <div style="font-size: 11px; color: var(--text-muted);">${date}</div>
                <div style="font-size: 14px; font-weight: 700; margin: 2px 0;">
                  ${summary.temp_max?.[i]?.toFixed(0) ?? '--'}° / <span style="color: var(--blue-400);">${summary.temp_min?.[i]?.toFixed(0) ?? '--'}°</span>
                </div>
                <div style="font-size: 11px; color: var(--cyan-400);">💧 ${summary.precipitation?.[i]?.toFixed(1) ?? '0'}mm</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Metadata -->
      <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted); display: flex; gap: 12px; flex-wrap: wrap;">
        ${pred?.issued_at ? `<span>Emitido: ${new Date(pred.issued_at).toLocaleString('es-PE')}</span>` : ''}
        ${pred?.valid_until ? `<span>Válido hasta: ${new Date(pred.valid_until).toLocaleString('es-PE')}</span>` : ''}
        ${pred?.data_source ? `<span>Fuente: ${pred.data_source}</span>` : ''}
      </div>
    </div>
  `;
}

// ===== CARD DE FENÓMENO INDIVIDUAL =====
function renderPhenomenonCard(pred) {
  const meta = ML_PHENOMENON_META[pred.phenomenon] || { emoji: '❓', name: pred.phenomenon, color: '#999' };
  const risk = ML_RISK_LEVELS[pred.risk_level] || ML_RISK_LEVELS.none;
  const score = pred.risk_score || 0;
  const isML = pred.model_type === 'ml_trained';

  return `
    <div style="background: var(--bg-glass); border-radius: 10px; padding: 12px; position: relative; overflow: hidden; cursor: pointer;"
         onclick="showMLPredictionDetail('${pred.phenomenon}', ${JSON.stringify(pred).replace(/'/g, "\\'")})">
      <div style="position: absolute; top: -5px; right: -5px; font-size: 32px; opacity: 0.1;">${meta.emoji}</div>
      <div style="font-size: 18px; margin-bottom: 2px;">${meta.emoji}</div>
      <div style="font-weight: 700; font-size: 13px;">${meta.name}</div>
      
      <!-- Score Bar -->
      <div style="margin: 8px 0 4px; background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; overflow: hidden;">
        <div style="width: ${Math.min(score, 100)}%; height: 100%; background: ${risk.bar}; border-radius: 4px; transition: width 0.5s;"></div>
      </div>
      
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 800; font-size: 16px; color: ${risk.bar};">${score.toFixed(0)}</span>
        <span class="badge badge-${risk.badge}" style="font-size: 9px;">${risk.label}</span>
      </div>
      <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
        ${isML ? '🔬 ML' : '⚙️ Reglas'}
      </div>
    </div>
  `;
}

// ===== MODAL DE DETALLE DE PREDICCIÓN =====
function showMLPredictionDetail(phenomenon, predData) {
  const meta = ML_PHENOMENON_META[phenomenon] || { emoji: '❓', name: phenomenon };
  const risk = ML_RISK_LEVELS[predData.risk_level] || ML_RISK_LEVELS.none;
  const variables = predData.variables_used || {};
  const limitations = predData.limitations || [];

  const existingModal = document.getElementById('ml-detail-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ml-detail-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 520px; padding: 24px;">
      <div class="modal-header">
        <div>
          <h3 style="font-size: 18px; font-weight: 800; margin: 0;">
            ${meta.emoji} Detalle: ${meta.name}
          </h3>
          <div style="margin-top: 4px; display: flex; gap: 6px; align-items: center;">
            <span class="badge badge-${risk.badge}" style="font-weight: 800;">${risk.icon} ${risk.label}</span>
            <span class="badge badge-${predData.model_type === 'ml_trained' ? 'blue' : 'amber'}" style="font-size: 10px;">
              ${predData.model_type === 'ml_trained' ? '🔬 Modelo ML Entrenado' : '⚙️ Sistema de Reglas'}
            </span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('ml-detail-modal').remove()">✕</button>
      </div>

      <!-- Score -->
      <div style="text-align: center; padding: 20px 0;">
        <div style="font-size: 56px; font-weight: 900; color: ${risk.bar}; line-height: 1;">
          ${(predData.risk_score || 0).toFixed(1)}
          <span style="font-size: 18px; color: var(--text-muted); font-weight: 500;">/ 100</span>
        </div>
        <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Puntuación de Riesgo</div>
      </div>

      <!-- Variables Used -->
      ${Object.keys(variables).length > 0 ? `
        <div style="margin-bottom: 16px;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px;">📊 Variables del Pronóstico</div>
          <div style="display: grid; gap: 6px;">
            ${Object.entries(variables).map(([key, val]) => `
              <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: var(--bg-glass); border-radius: 6px;">
                <span style="font-size: 12px; color: var(--text-secondary);">${formatVariableName(key)}</span>
                <span style="font-weight: 700; font-size: 12px;">${val}${getVariableUnit(key)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Period -->
      ${predData.period ? `
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          📅 Periodo evaluado: <strong>${predData.period}</strong>
        </div>
      ` : ''}

      <!-- Confidence Note -->
      <div style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.2); padding: 10px 14px; border-radius: 8px; font-size: 12px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 12px;">
        📖 ${predData.confidence_note || 'Sin información adicional de confianza.'}
      </div>

      <!-- Limitations -->
      ${limitations.length > 0 ? `
        <div style="font-size: 11px; color: var(--text-muted);">
          <div style="font-weight: 600; margin-bottom: 4px;">⚠️ Limitaciones:</div>
          <ul style="margin: 0; padding-left: 16px; line-height: 1.6;">
            ${limitations.map(l => `<li>${l}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  document.body.appendChild(modal);
}

function formatVariableName(key) {
  const names = {
    temperature_2m_min: 'Temp. Mínima (2m)',
    temperature_2m_max: 'Temp. Máxima (2m)',
    temperature_2m_mean: 'Temp. Media (2m)',
    precipitation_sum: 'Precipitación Total',
    humidity_mean: 'Humedad Media',
    humidity_max: 'Humedad Máxima',
    wind_speed_10m_max: 'Viento Máximo (10m)',
    soil_moisture_mean: 'Humedad del Suelo',
    elevation: 'Elevación',
  };
  return names[key] || key.replace(/_/g, ' ');
}

function getVariableUnit(key) {
  if (key.includes('temperature') || key.includes('temp')) return '°C';
  if (key.includes('precipitation') || key.includes('rain')) return ' mm';
  if (key.includes('humidity') || key.includes('moisture')) return '%';
  if (key.includes('wind')) return ' km/h';
  if (key.includes('elevation')) return ' m';
  return '';
}

// ===== ESTADO VACÍO =====
function renderNoPredictions() {
  return `
    <div class="card" style="text-align: center; padding: 48px 24px;">
      <div style="font-size: 48px; margin-bottom: 12px;">🔬</div>
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">Sin Predicciones Disponibles</div>
      <div class="text-sm text-muted" style="max-width: 400px; margin: 0 auto;">
        Registra parcelas con coordenadas en el mapa para recibir predicciones meteorológicas
        personalizadas basadas en Machine Learning.
      </div>
    </div>
  `;
}

// ===== GENERAR ALERTAS (Admin) =====
async function triggerMLAlerts() {
  const btn = document.getElementById('btn-generate-alerts');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Generando...';
  }

  try {
    const res = await api.generateMLAlerts();
    if (res.success) {
      const d = res.data;
      showToast(`✅ ${d.alerts_created} alertas generadas (${d.parcels_evaluated} parcelas, ${d.alerts_skipped_duplicate} duplicados omitidos)`, 'success');
    } else {
      showToast(`❌ ${res.error || 'Error al generar alertas'}`, 'error');
    }
  } catch (err) {
    showToast('❌ Error de conexión', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔔 Generar Alertas';
    }
  }
}

// ===== MODAL: PREFERENCIAS DE ALERTAS METEOROLÓGICAS =====
async function openMLPreferencesModal() {
  const existing = document.getElementById('ml-pref-modal');
  if (existing) existing.remove();

  let prefs = { frost_enabled: 1, heavy_rain_enabled: 1, snow_enabled: 1, hail_enabled: 1, min_risk_level: 'moderate', in_app_enabled: 1 };
  try {
    const res = await api.getMLPreferences();
    if (res.success && res.data) prefs = res.data;
  } catch (e) {
    console.warn('Usando preferencias por defecto:', e);
  }

  const modal = document.createElement('div');
  modal.id = 'ml-pref-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 480px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 17px; font-weight: 800;">⚙️ Mis Preferencias de Alertas</h3>
        <button class="btn btn-icon" onclick="document.getElementById('ml-pref-modal').remove()">✕</button>
      </div>

      <p class="text-sm text-muted" style="margin-bottom: 16px;">
        Selecciona qué fenómenos meteorológicos deseas monitorear y a partir de qué nivel de riesgo recibir notificaciones automáticas.
      </p>

      <form id="form-ml-preferences" onsubmit="saveMLPreferences(event)">
        <div style="display: grid; gap: 10px; margin-bottom: 18px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 12px; background: var(--bg-glass); border-radius: 8px;">
            <input type="checkbox" id="pref-frost" ${prefs.frost_enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
            <div>
              <div style="font-weight: 600; font-size: 13px;">🥶 Alertas de Heladas</div>
              <div class="text-xs text-muted">Avisos de descenso térmico crítico (&le;0°C en puna y valles)</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 12px; background: var(--bg-glass); border-radius: 8px;">
            <input type="checkbox" id="pref-rain" ${prefs.heavy_rain_enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
            <div>
              <div style="font-weight: 600; font-size: 13px;">🌧️ Alertas de Lluvias Intensas</div>
              <div class="text-xs text-muted">Avisos de precipitaciones extraordinarias (&ge;20mm/día)</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 12px; background: var(--bg-glass); border-radius: 8px;">
            <input type="checkbox" id="pref-snow" ${prefs.snow_enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
            <div>
              <div style="font-weight: 600; font-size: 13px;">❄️ Alertas de Nevadas</div>
              <div class="text-xs text-muted">Avisos de acumulación de nieve en zonas altoandinas (&gt;3800 msnm)</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 12px; background: var(--bg-glass); border-radius: 8px;">
            <input type="checkbox" id="pref-hail" ${prefs.hail_enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
            <div>
              <div style="font-weight: 600; font-size: 13px;">🌩️ Alertas de Granizo</div>
              <div class="text-xs text-muted">Estimación heurística de riesgo de tormentas graniceras</div>
            </div>
          </label>
        </div>

        <div class="form-group" style="margin-bottom: 18px;">
          <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">Nivel mínimo de riesgo para alertar:</label>
          <select id="pref-min-level" class="form-control" style="width: 100%;">
            <option value="low" ${prefs.min_risk_level === 'low' ? 'selected' : ''}>🟢 Bajo o superior (todas las alertas)</option>
            <option value="moderate" ${prefs.min_risk_level === 'moderate' ? 'selected' : ''}>🟡 Moderado o superior (Recomendado)</option>
            <option value="high" ${prefs.min_risk_level === 'high' ? 'selected' : ''}>🔴 Solo Alto (Riesgo inminente/severo)</option>
          </select>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('ml-pref-modal').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-save-pref">Guardar Preferencias</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveMLPreferences(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-pref');
  if (btn) btn.disabled = true;

  const data = {
    frost_enabled: document.getElementById('pref-frost')?.checked ? 1 : 0,
    heavy_rain_enabled: document.getElementById('pref-rain')?.checked ? 1 : 0,
    snow_enabled: document.getElementById('pref-snow')?.checked ? 1 : 0,
    hail_enabled: document.getElementById('pref-hail')?.checked ? 1 : 0,
    min_risk_level: document.getElementById('pref-min-level')?.value || 'moderate',
  };

  try {
    const res = await api.updateMLPreferences(data);
    if (res.success) {
      showToast('✅ Preferencias guardadas correctamente', 'success');
      document.getElementById('ml-pref-modal')?.remove();
    } else {
      showToast(`❌ ${res.error || 'Error al guardar'}`, 'error');
    }
  } catch (err) {
    showToast('❌ Error de conexión al guardar preferencias', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===== MODAL: REGISTRAR OBSERVACIÓN DE CAMPO VERIFICADA =====
function openCreateObservationModal() {
  const existing = document.getElementById('ml-obs-modal');
  if (existing) existing.remove();

  const nowIso = new Date().toISOString().slice(0, 16);

  const modal = document.createElement('div');
  modal.id = 'ml-obs-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 520px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h3 style="margin: 0; font-size: 17px; font-weight: 800;">📝 Registrar Observación Meteorológica Real</h3>
        <button class="btn btn-icon" onclick="document.getElementById('ml-obs-modal').remove()">✕</button>
      </div>

      <p class="text-sm text-muted" style="margin-bottom: 14px;">
        Registra un evento observado en campo para alimentar la base de validación física de AgroPasco y calibrar los modelos.
      </p>

      <form id="form-create-obs" onsubmit="saveMLObservation(event)">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Fecha y Hora del Evento *</label>
            <input type="datetime-local" id="obs-time" class="form-control" value="${nowIso}" required>
          </div>
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Fenómeno Observado *</label>
            <select id="obs-phenomenon" class="form-control" required>
              <option value="frost">🥶 Helada (Escarcha/Congelación)</option>
              <option value="heavy_rain">🌧️ Lluvia Torrencial</option>
              <option value="snow">❄️ Nevada</option>
              <option value="hail">🌩️ Granizada</option>
              <option value="drought">☀️ Sequía Severa</option>
              <option value="strong_winds">💨 Vientos Fuertes</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Severidad</label>
            <select id="obs-severity" class="form-control">
              <option value="leve">Leve (sin daños notables)</option>
              <option value="moderado" selected>Moderado (daño foliar parcial)</option>
              <option value="severo">Severo (daño significativo a cultivo)</option>
              <option value="extremo">Extremo (pérdida total)</option>
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Fuente de la Observación</label>
            <select id="obs-source" class="form-control">
              <option value="farmer_report" selected>Reporte Agricultor en Parcela</option>
              <option value="field_advisor">Inspección de Asesor Técnico</option>
              <option value="senamhi_station">Estación Local SENAMHI</option>
              <option value="satellite_validated">Validación Satelital/Radar</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Método de Verificación</label>
            <select id="obs-method" class="form-control">
              <option value="visual_inspection" selected>Inspección Visual en Campo</option>
              <option value="thermometer">Termómetro de Mínima/Digital</option>
              <option value="pluviometer">Pluviómetro Manual</option>
              <option value="official_report">Boletín Oficial</option>
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 12px; font-weight: 600;">Temp. Registrada (°C) (opcional)</label>
            <input type="number" step="0.1" id="obs-temp" class="form-control" placeholder="Ej: -2.5">
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 14px;">
          <label style="font-size: 12px; font-weight: 600;">Notas y Observaciones de Campo</label>
          <textarea id="obs-notes" class="form-control" rows="2" placeholder="Detalles del evento: impacto en el cultivo, hora punta, espesor de hielo..."></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('ml-obs-modal').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-save-obs">Guardar Observación</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveMLObservation(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-obs');
  if (btn) btn.disabled = true;

  const tempVal = document.getElementById('obs-temp')?.value;

  const data = {
    observed_at: document.getElementById('obs-time')?.value || new Date().toISOString(),
    phenomenon: document.getElementById('obs-phenomenon')?.value,
    severity: document.getElementById('obs-severity')?.value,
    source: document.getElementById('obs-source')?.value,
    verification_method: document.getElementById('obs-method')?.value,
    temperature_recorded: tempVal !== '' && tempVal !== undefined ? parseFloat(tempVal) : null,
    notes: document.getElementById('obs-notes')?.value || '',
  };

  try {
    const res = await api.createMLObservation(data);
    if (res.success) {
      showToast('✅ Observación de campo registrada con éxito', 'success');
      document.getElementById('ml-obs-modal')?.remove();
    } else {
      showToast(`❌ ${res.error || 'Error al registrar'}`, 'error');
    }
  } catch (err) {
    showToast('❌ Error de conexión al registrar observación', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===== MODAL: HISTORIAL DE OBSERVACIONES DE CAMPO =====
async function openObservationsListModal() {
  const existing = document.getElementById('ml-obs-list-modal');
  if (existing) existing.remove();

  let observations = [];
  try {
    const res = await api.getMLObservations();
    if (res.success) observations = res.data || [];
  } catch (e) {
    console.error('Error cargando observaciones:', e);
  }

  const modal = document.createElement('div');
  modal.id = 'ml-obs-list-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 720px; max-height: 85vh; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 17px; font-weight: 800;">📋 Registro de Observaciones de Campo Verificadas</h3>
        <button class="btn btn-icon" onclick="document.getElementById('ml-obs-list-modal').remove()">✕</button>
      </div>

      <p class="text-sm text-muted" style="margin-bottom: 14px;">
        Eventos reales registrados por agricultores y técnicos para contrastar y validar la precisión de los modelos meteorológicos.
      </p>

      <div style="overflow-y: auto; flex: 1;">
        ${observations.length === 0 ? `
          <div style="text-align: center; padding: 36px; color: var(--text-muted);">
            No hay observaciones registradas aún. ¡Sé el primero en reportar un evento verificado!
          </div>
        ` : `
          <table class="table" style="width: 100%; font-size: 12px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                <th style="padding: 8px;">Fecha/Hora</th>
                <th style="padding: 8px;">Fenómeno</th>
                <th style="padding: 8px;">Severidad</th>
                <th style="padding: 8px;">Fuente / Método</th>
                <th style="padding: 8px;">Registro</th>
                <th style="padding: 8px;">Notas</th>
              </tr>
            </thead>
            <tbody>
              ${observations.map(o => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                  <td style="padding: 8px; white-space: nowrap;">${o.observed_at ? o.observed_at.slice(0, 16).replace('T', ' ') : '-'}</td>
                  <td style="padding: 8px; font-weight: 700;">${o.phenomenon}</td>
                  <td style="padding: 8px;"><span class="badge badge-${o.severity === 'extremo' || o.severity === 'severo' ? 'red' : 'amber'}">${o.severity}</span></td>
                  <td style="padding: 8px;">${o.source}<br><span class="text-muted" style="font-size: 10.5px;">${o.verification_method}</span></td>
                  <td style="padding: 8px;">${o.temperature_recorded !== null ? `${o.temperature_recorded}°C` : (o.precipitation_recorded_mm !== null ? `${o.precipitation_recorded_mm}mm` : '-')}</td>
                  <td style="padding: 8px; max-width: 200px; color: var(--text-secondary);">${o.notes || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-color);">
        <span class="text-xs text-muted">Total eventos registrados: <strong>${observations.length}</strong></span>
        <button class="btn btn-secondary" onclick="document.getElementById('ml-obs-list-modal').remove()">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
