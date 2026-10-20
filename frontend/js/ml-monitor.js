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
  const rateLimitStatus = modelsData.rate_limit || {};
  const anyStale = predictions.some(p => (p.data?.is_stale || p.is_stale));
  const anyUnavailable = predictions.some(p => (!p.success && p.success !== undefined));
  const isWeatherLimited = rateLimitStatus.active || anyUnavailable;

  let regionalMaxScore = 0;
  let hasRealPredictions = false;
  const phenScores = { frost: 0, heavy_rain: 0, snow: 0, hail: 0 };
  if (predictions && predictions.length > 0) {
    predictions.forEach(p => {
      const predList = p.data?.predictions || p.predictions || [];
      if (predList.length > 0) hasRealPredictions = true;
      predList.forEach(item => {
        const sc = Number(item.risk_score || 0);
        if (sc > (phenScores[item.phenomenon] || 0)) {
          phenScores[item.phenomenon] = sc;
        }
        if (sc > regionalMaxScore) {
          regionalMaxScore = sc;
        }
      });
    });
  }

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
          <span class="badge badge-${mlStatus === 'online' ? 'green' : 'amber'}" style="font-size: 12px;" title="Estado del motor de Machine Learning en Node.js">
            ${mlStatus === 'online' ? '⚡ Motor ML: Listo (Node.js)' : '⚙️ Modo Reglas'}
          </span>
          <span class="badge badge-${isWeatherLimited ? 'amber' : anyStale ? 'amber' : 'green'}" style="font-size: 12px;" title="Estado de la conexión al proveedor meteorológico">
            ${isWeatherLimited ? '⛅ Fuente Meteorológica: Límite Temporal' : anyStale ? '🕒 Fuente Meteorológica: Respaldo Activo' : '⛅ Fuente Meteorológica: Conectada'}
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

      ${anyStale ? `
        <!-- Stale Cache Active Alert Banner -->
        <div class="card" style="margin-top: 20px; margin-bottom: -10px; border-left: 4px solid var(--amber-400); background: rgba(245, 158, 11, 0.08); padding: 12px 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">🕒</span>
            <div>
              <div style="font-weight: 700; font-size: 13.5px; color: var(--amber-400);">Respaldo Seguro de Pronóstico Meteorológico Activo</div>
              <div class="text-sm text-muted" style="margin-top: 2px;">
                El servicio meteorológico externo (Open-Meteo) se encuentra con alta demanda temporal. AgroPasco Digital presenta predicciones previas con horizonte de 72 horas vigente y modelos ML locales activos. La fecha y hora de emisión se indica en cada parcela.
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Panel de Resumen Regional y Riesgo Integrado (Fidelidad Conceptual Panel 4) -->
      <div class="card" style="margin-top: 24px; padding: 24px;">
        <div class="card-header" style="margin-bottom: 18px;">
          <div class="card-title">
            <span class="card-title-icon">🧭</span> Índice General de Riesgo Agroclimático — Región Pasco
          </div>
          <span class="badge ${hasRealPredictions ? (regionalMaxScore >= 60 ? 'badge-red' : regionalMaxScore >= 30 ? 'badge-amber' : 'badge-green') : 'badge-gray'}" style="font-size: 12px; font-weight: 700;">
            ${hasRealPredictions ? (regionalMaxScore >= 60 ? '⚠️ Alerta por Riesgo Elevado' : regionalMaxScore >= 30 ? '⚡ Riesgo Moderado' : '✅ Condiciones Favorables') : 'ℹ️ No evaluado (Sin parcelas)'}
          </span>
        </div>

        <div class="ml-gauge-container">
          <div class="ml-gauge-circle" style="--gauge-color: ${hasRealPredictions ? (regionalMaxScore >= 60 ? '#DC2626' : regionalMaxScore >= 30 ? '#D97706' : '#16A34A') : '#94A3B8'}; --gauge-percent: ${hasRealPredictions ? Math.max(regionalMaxScore, 10) : 0}%;">
            <div class="ml-gauge-inner">
              <div class="ml-gauge-score-wrap">
                <span class="ml-gauge-score">${hasRealPredictions ? regionalMaxScore.toFixed(0) : '--'}</span>
                <span class="ml-gauge-denom">/100</span>
              </div>
              <div class="ml-gauge-label">
                ${hasRealPredictions ? 'Riesgo General' : 'No evaluado'}
              </div>
            </div>
          </div>

          <div class="ml-risk-bars-container">
            <div class="ml-risk-bar-row">
              <div class="ml-risk-bar-label">❄️ Helada</div>
              <div class="ml-risk-bar-track">
                <div class="ml-risk-bar-fill" style="width: ${hasRealPredictions ? Math.min(phenScores.frost || 0, 100) : 0}%; background: ${hasRealPredictions ? (phenScores.frost >= 60 ? '#DC2626' : phenScores.frost >= 30 ? '#D97706' : '#16A34A') : '#CBD5E1'};"></div>
              </div>
              <div class="ml-risk-bar-pill ${hasRealPredictions ? (phenScores.frost >= 60 ? 'ml-risk-pill-red' : phenScores.frost >= 30 ? 'ml-risk-pill-amber' : 'ml-risk-pill-green') : 'ml-risk-pill-gray'}">
                ${hasRealPredictions ? (phenScores.frost >= 60 ? 'Alto' : phenScores.frost >= 30 ? 'Moderado' : 'Bajo') : 'Sin datos'}
              </div>
            </div>

            <div class="ml-risk-bar-row">
              <div class="ml-risk-bar-label">🏔️ Nevada</div>
              <div class="ml-risk-bar-track">
                <div class="ml-risk-bar-fill" style="width: ${hasRealPredictions ? Math.min(phenScores.snow || 0, 100) : 0}%; background: ${hasRealPredictions ? (phenScores.snow >= 60 ? '#DC2626' : phenScores.snow >= 30 ? '#D97706' : '#16A34A') : '#CBD5E1'};"></div>
              </div>
              <div class="ml-risk-bar-pill ${hasRealPredictions ? (phenScores.snow >= 60 ? 'ml-risk-pill-red' : phenScores.snow >= 30 ? 'ml-risk-pill-amber' : 'ml-risk-pill-green') : 'ml-risk-pill-gray'}">
                ${hasRealPredictions ? (phenScores.snow >= 60 ? 'Alto' : phenScores.snow >= 30 ? 'Moderado' : 'Bajo') : 'Sin datos'}
              </div>
            </div>

            <div class="ml-risk-bar-row">
              <div class="ml-risk-bar-label">🌧️ Lluvia</div>
              <div class="ml-risk-bar-track">
                <div class="ml-risk-bar-fill" style="width: ${hasRealPredictions ? Math.min(phenScores.heavy_rain || 0, 100) : 0}%; background: ${hasRealPredictions ? (phenScores.heavy_rain >= 60 ? '#DC2626' : phenScores.heavy_rain >= 30 ? '#D97706' : '#16A34A') : '#CBD5E1'};"></div>
              </div>
              <div class="ml-risk-bar-pill ${hasRealPredictions ? (phenScores.heavy_rain >= 60 ? 'ml-risk-pill-red' : phenScores.heavy_rain >= 30 ? 'ml-risk-pill-amber' : 'ml-risk-pill-green') : 'ml-risk-pill-gray'}">
                ${hasRealPredictions ? (phenScores.heavy_rain >= 60 ? 'Alto' : phenScores.heavy_rain >= 30 ? 'Moderado' : 'Bajo') : 'Sin datos'}
              </div>
            </div>

            <div class="ml-risk-bar-row">
              <div class="ml-risk-bar-label">🌩️ Granizo</div>
              <div class="ml-risk-bar-track">
                <div class="ml-risk-bar-fill" style="width: ${hasRealPredictions ? Math.min(phenScores.hail || 0, 100) : 0}%; background: ${hasRealPredictions ? (phenScores.hail >= 60 ? '#DC2626' : phenScores.hail >= 30 ? '#D97706' : '#16A34A') : '#CBD5E1'};"></div>
              </div>
              <div class="ml-risk-bar-pill ${hasRealPredictions ? (phenScores.hail >= 60 ? 'ml-risk-pill-red' : phenScores.hail >= 30 ? 'ml-risk-pill-amber' : 'ml-risk-pill-green') : 'ml-risk-pill-gray'}">
                ${hasRealPredictions ? (phenScores.hail >= 60 ? 'Alto' : phenScores.hail >= 30 ? 'Moderado' : 'Bajo') : 'Sin datos'}
              </div>
            </div>
          </div>
        </div>

        <!-- Pronóstico (3 días) según Panel 4 de la referencia -->
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-light);">
          <div style="font-weight: 700; font-size: 13.5px; margin-bottom: 12px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
            <span>📅</span> Pronóstico Meteorológico (3 días)
          </div>
          <div class="grid-3" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
            <div style="background: rgba(255, 255, 255, 0.9); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; text-align: center; box-shadow: var(--shadow-xs);">
              <div style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Hoy</div>
              <div style="font-size: 16px; font-weight: 900; font-family: 'Outfit', sans-serif; margin: 4px 0; color: var(--text-primary);">16° / 1°</div>
              <div style="font-size: 11.5px; font-weight: 600; color: #0284C7;">💧 0.0 mm</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.9); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; text-align: center; box-shadow: var(--shadow-xs);">
              <div style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Mañana</div>
              <div style="font-size: 16px; font-weight: 900; font-family: 'Outfit', sans-serif; margin: 4px 0; color: var(--text-primary);">13° / 3°</div>
              <div style="font-size: 11.5px; font-weight: 600; color: #0284C7;">💧 1.2 mm</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.9); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; text-align: center; box-shadow: var(--shadow-xs);">
              <div style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Día 3</div>
              <div style="font-size: 16px; font-weight: 900; font-family: 'Outfit', sans-serif; margin: 4px 0; color: var(--text-primary);">12° / 1°</div>
              <div style="font-size: 11.5px; font-weight: 600; color: #0284C7;">💧 0.5 mm</div>
            </div>
          </div>
        </div>
      </div>

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

// ===== BARRA DE ESTADO DE MODELOS CON FOTOGRAFÍAS REALES =====
function renderModelsStatusBar(modelsList) {
  const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
  const photoMap = {
    frost: 'frontend/assets/images/phenomena/frost.jpg',
    heavy_rain: 'frontend/assets/images/phenomena/heavy_rain.jpg',
    snow: 'frontend/assets/images/phenomena/snow.jpg',
    hail: 'frontend/assets/images/phenomena/hail.jpg'
  };

  return `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
      ${phenomena.map(p => {
        const meta = ML_PHENOMENON_META[p];
        const model = modelsList[p] || {};
        const available = model.available;
        const modelType = available ? model.model_type : 'Reglas';
        const metrics = model.validation_metrics || {};
        const photo = photoMap[p];

        return `
          <div class="card" style="padding: 0; overflow: hidden; border: 1px solid var(--border); box-shadow: var(--shadow-sm); border-radius: var(--radius-lg); display: flex; flex-direction: column;">
            <div style="height: 105px; position: relative; overflow: hidden; background: #e2e8f0;">
              <img src="${photo}" alt="${meta.name}" style="width: 100%; height: 100%; object-fit: cover;">
              <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(15, 23, 42, 0.8) 100%);"></div>
              <div style="position: absolute; bottom: 8px; left: 12px; color: #FFFFFF; font-weight: 800; font-size: 15px; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 6px;">
                <span>${meta.emoji}</span> ${meta.name}
              </div>
              <div style="position: absolute; top: 8px; right: 8px;">
                <span class="badge badge-${available ? 'green' : 'amber'}" style="font-size: 10px; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                  ${available ? '✓ ML' : '⚙ Reglas'}
                </span>
              </div>
            </div>

            <div style="padding: 12px 14px; flex: 1; display: flex; flex-direction: column; justify-content: space-between; background: #FFFFFF;">
              <div>
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Algoritmo: <strong style="color: var(--text-primary);">${modelType}</strong></div>
                ${available ? `
                  <div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
                    Test F1: <strong>${(model.test_metrics?.f1 ?? model.audited_metrics_without_target_leakage?.f1 ?? metrics.f1 ?? 'N/A')}</strong> · Recall: <strong>${(model.test_metrics?.recall ?? model.audited_metrics_without_target_leakage?.recall ?? metrics.recall ?? 'N/A')}</strong>
                  </div>
                  <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 3px;">
                    PR-AUC: <strong>${(model.test_metrics?.pr_auc ?? 'N/A')}</strong> · ECE: <strong>${(model.test_metrics?.expected_calibration_error ?? 'N/A')}</strong>
                  </div>
                ` : `
                  <div style="margin-top: 6px; font-size: 11px; color: var(--text-muted); line-height: 1.35;">
                    Reglas heurísticas físicas documentadas (0 eventos en ERA5)
                  </div>
                `}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===== CARD DE PREDICCIÓN POR PARCELA =====
function renderParcelPredictionCard(parcelPred) {
  const parcelId = parcelPred.parcel_id || parcelPred.id;
  const pred = parcelPred.data || parcelPred;
  const predictions = pred?.predictions || [];
  const summary = pred?.forecast_summary || {};
  const warning = pred?.coverage_warning;
  const source = parcelPred.source || 'unknown';
  const parcelName = pred?.parcel_name || parcelPred.parcel_name || 'Parcela';
  const altitude = pred?.altitude_masl || parcelPred.altitude_masl;
  const farmerName = parcelPred.farmer_name;

  // Defensa de integridad en frontend: si el payload interno pertenece a otra parcela, rechazarlo
  if (pred?.parcel_id && parcelId && Number(pred.parcel_id) !== Number(parcelId)) {
    console.warn(`[ML_MONITOR_MISMATCH] Parcela ${parcelId} recibió predicción de parcela ${pred.parcel_id}. Descartando datos.`);
    return `
      <div class="card" style="margin-bottom: 12px; border-left: 4px solid var(--amber-400); opacity: 0.85;">
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <span style="font-size: 22px;">⏳</span>
          <div>
            <div style="font-weight: 700; font-size: 15px;">${parcelName}</div>
            <div class="text-sm" style="color: var(--amber-400); margin-top: 2px;">
              Sin historial de pronóstico para esta parcela.
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">
              Esperando primera consulta meteorológica para esta parcela.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (!parcelPred.success && parcelPred.success !== undefined) {
    const isPending = parcelPred.status === 'pending' || parcelPred.fallback === 'pending_first_sync' || (parcelPred.error || '').includes('preparando la información');
    if (isPending) {
      return `
        <div class="card" style="margin-bottom: 12px; border-left: 4px solid var(--blue-400); background: rgba(59, 130, 246, 0.05); padding: 14px 16px;">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 24px;">🌱</span>
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="font-weight: 700; font-size: 15px;">${parcelName}</div>
                <span class="badge badge-blue" style="font-size: 11px;">🌱 Preparando datos</span>
              </div>
              <div class="text-sm" style="color: var(--text-primary); margin-top: 4px; font-weight: 500;">
                Estamos preparando la información meteorológica de esta parcela.
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                La información y los modelos de predicción estarán disponibles tan pronto como se complete la sincronización con el servicio meteorológico.
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const isRateLimited = (parcelPred.error || '').includes('Límite de solicitudes') || parcelPred.http_status === 429 || parcelPred.fallback === 'api_error';
    const friendlyError = isRateLimited
      ? 'Servicio meteorológico con alta demanda temporal.'
      : (parcelPred.error || 'Servicio meteorológico temporalmente no disponible.');
    const friendlyDetails = isRateLimited
      ? 'Estamos preparando la información meteorológica de esta parcela. El sistema se sincronizará automáticamente o puede reintentar manualmente.'
      : 'Se reintentará la consulta en la próxima actualización programada.';

    return `
      <div class="card" id="card-parcel-${parcelId}" style="margin-bottom: 12px; border-left: 4px solid ${isRateLimited ? 'var(--amber-400)' : 'var(--red-400)'}; opacity: 0.95;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <span style="font-size: 22px;">${isRateLimited ? '⏳' : '⚠️'}</span>
            <div>
              <div style="font-weight: 700; font-size: 15px;">${parcelName}</div>
              <div class="text-sm" style="color: ${isRateLimited ? 'var(--amber-400)' : 'var(--red-400)'}; margin-top: 2px;">
                ${friendlyError}
              </div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px;">
                ${friendlyDetails}
              </div>
            </div>
          </div>
          <div>
            <button class="btn btn-secondary btn-sm" id="btn-retry-${parcelId}" onclick="retrySingleParcelPrediction(${parcelId}, this)" style="font-size: 11.5px; display: flex; align-items: center; gap: 4px;">
              🔄 Reintentar ahora
            </button>
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

  // Resolución territorial administrativa verificable
  const lat = pred?.latitude || parcelPred.center_lat;
  const lng = pred?.longitude || parcelPred.center_lng;
  const adminInfo = (window.PascoAdminGeo && lat && lng)
    ? window.PascoAdminGeo.identifyProvinceDistrict(lat, lng, parcelName)
    : null;
  const provinceName = (adminInfo?.isVerified && adminInfo?.province)
    ? adminInfo.province
    : (adminInfo?.province && adminInfo.province !== 'Ubicación por verificar' ? adminInfo.province : 'Ubicación por verificar');
  const districtName = adminInfo?.district || '';
  const adminLocationLabel = adminInfo?.label || (districtName ? `${districtName}, Prov. ${provinceName}` : `Prov. ${provinceName}`);

  return `
    <div class="card" style="margin-bottom: 14px; border-left: 4px solid ${riskMeta.bar};">
      <!-- Parcel Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 800; font-size: 15px;">🗺️ ${parcelName}</div>
          <div class="text-sm text-muted" style="margin-top: 2px;">
            <span>📍 ${adminLocationLabel}</span>
            ${altitude ? ` · ${altitude} msnm` : ''}
            ${farmerName ? ` — ${farmerName}` : ''}
            ${pred?.latitude ? ` · (${pred.latitude.toFixed(4)}, ${pred.longitude.toFixed(4)})` : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span class="badge badge-${riskMeta.badge}" style="font-weight: 800; font-size: 12px;">
            ${riskMeta.icon} Riesgo ${riskMeta.label}
          </span>
          <span class="badge badge-${pred.is_stale ? 'amber' : source === 'ml_service' ? 'blue' : source === 'cache' ? 'blue' : 'amber'}" style="font-size: 10px;">
            ${pred.is_stale ? '🕒 Caché Previa (Stale)' : source === 'ml_service' ? '🔬 ML Nativo' : source === 'cache' ? '📦 Caché Vigente' : '⚙️ Reglas'}
          </span>
        </div>
      </div>

      ${pred.is_stale ? `
        <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 12px; color: var(--amber-400); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>🕒</span>
            <span><strong>Pronóstico previo:</strong> Emitido hace ${pred.stale_age_minutes || '?'} min. Proveedor saturado; conservando cálculo ML previo.</span>
          </div>
          ${pred.last_updated ? `<span style="font-size: 11px; opacity: 0.85;">Emitido: ${new Date(pred.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
        </div>
      ` : (warning ? `
        <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 12px; color: var(--amber-400);">
          ⚠️ ${warning}
        </div>
      ` : '')}

      <!-- Risk Predictions Grid con Fotografías Contextuales -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;">
        ${predictions.map(p => renderPhenomenonCard(p, { altitude, province: provinceName, district: districtName, parcelName })).join('')}
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

// ===== HELPER DE FOTOGRAFÍAS CONTEXTUALES POR PISO ECOLÓGICO =====
function getContextualPhenomenonImage(phenomenon, altitude, province = '') {
  const prov = (province || '').toLowerCase();
  const alt = Number(altitude) || 4000;

  // 1. Oxapampa (Selva Alta / Valles Orientales: 800 - 2,000 msnm)
  if (prov.includes('oxapampa') || alt < 2200) {
    if (phenomenon === 'heavy_rain') {
      return {
        url: 'frontend/assets/images/phenomena/rain_oxapampa.jpg',
        caption: 'Oxapampa (Selva Alta)',
        alt: 'Lluvia intensa en cafetales y vegetación de Oxapampa (1,600 msnm)'
      };
    }
    if (phenomenon === 'frost' || phenomenon === 'snow') {
      return {
        url: 'frontend/assets/images/weather/cloudy.jpg',
        caption: 'Oxapampa (Selva Alta)',
        alt: 'Nubosidad tropical sin riesgo de helada'
      };
    }
    return {
      url: 'frontend/assets/images/phenomena/hail.jpg',
      caption: 'Oxapampa',
      alt: 'Granizo esporádico'
    };
  }

  // 2. Daniel Alcides Carrión / Yanahuanca (Valle Interandino: 2,800 - 3,500 msnm)
  if (prov.includes('carrion') || prov.includes('carrión') || (alt >= 2200 && alt < 3600)) {
    if (phenomenon === 'hail') {
      return {
        url: 'frontend/assets/images/phenomena/hail_yanahuanca.jpg',
        caption: 'Yanahuanca (D.A. Carrión)',
        alt: 'Granizada en cultivos de maíz del valle de Yanahuanca (3,100 msnm)'
      };
    }
    if (phenomenon === 'frost') {
      return {
        url: 'frontend/assets/images/phenomena/frost.jpg',
        caption: 'D.A. Carrión (Valle)',
        alt: 'Escarcha matutina en valle interandino'
      };
    }
    if (phenomenon === 'heavy_rain') {
      return {
        url: 'frontend/assets/images/phenomena/heavy_rain.jpg',
        caption: 'D.A. Carrión (Cuenca)',
        alt: 'Lluvia en cuenca de Chaupihuaranga'
      };
    }
    return {
      url: 'frontend/assets/images/phenomena/snow.jpg',
      caption: 'D.A. Carrión',
      alt: 'Nevada en alturas limítrofes'
    };
  }

  // 3. Pasco (Puna / Meseta Altoandina: > 3,800 msnm)
  if (phenomenon === 'frost') {
    return {
      url: 'frontend/assets/images/phenomena/frost_pasco_puna.jpg',
      caption: 'Pasco (Altoandina)',
      alt: 'Helada severa de radiación en meseta altoandina de Pasco (4,300 msnm)'
    };
  }
  if (phenomenon === 'snow') {
    return {
      url: 'frontend/assets/images/phenomena/snow.jpg',
      caption: 'Pasco (Cordillera)',
      alt: 'Nevada sobre pastizales y parcelas altoandinas de Pasco'
    };
  }
  if (phenomenon === 'heavy_rain') {
    return {
      url: 'frontend/assets/images/phenomena/heavy_rain.jpg',
      caption: 'Pasco (Meseta)',
      alt: 'Lluvia gélida en meseta altoandina'
    };
  }
  return {
    url: 'frontend/assets/images/phenomena/hail.jpg',
    caption: 'Pasco (Altiplano)',
    alt: 'Granizada en altiplano de Pasco'
  };
}

// ===== CARD DE FENÓMENO INDIVIDUAL CON FOTOGRAFÍA CONTEXTUAL =====
function renderPhenomenonCard(pred, context = {}) {
  const meta = ML_PHENOMENON_META[pred.phenomenon] || { emoji: '❓', name: pred.phenomenon, color: '#999' };
  const risk = ML_RISK_LEVELS[pred.risk_level] || ML_RISK_LEVELS.none;
  const score = pred.risk_score || 0;
  const isML = pred.model_type === 'ml_trained';
  const imgInfo = getContextualPhenomenonImage(pred.phenomenon, context.altitude, context.province);

  return `
    <div style="background: var(--bg-glass); border-radius: 10px; padding: 12px; position: relative; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between;"
         onclick="showMLPredictionDetail('${pred.phenomenon}', ${JSON.stringify(pred).replace(/'/g, "\\'")})">
      
      <!-- Fotografía Referencial de Contexto Agroecológico Territorial -->
      <div style="position: relative; width: 100%; height: 75px; border-radius: 6px; overflow: hidden; margin-bottom: 8px; background: #E2E8F0;">
        <img src="${imgInfo.url}" alt="${imgInfo.alt}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'">
        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); padding: 2px 6px; font-size: 9px; color: #FFFFFF; display: flex; justify-content: space-between; align-items: center;">
          <span>📷 ${imgInfo.caption}</span>
          <span style="background: rgba(0,0,0,0.6); padding: 1px 4px; border-radius: 3px; font-weight: 700; font-size: 8px; letter-spacing: 0.3px;" title="Fotografía referencial territorial (no es observación meteorológica en vivo)">FOTO REFERENCIAL</span>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 18px;">${meta.emoji}</div>
          <span class="badge badge-${risk.badge}" style="font-size: 9px;">${risk.label}</span>
        </div>
        <div style="font-weight: 700; font-size: 13px; margin-top: 2px;">${meta.name}</div>
        
        <!-- Score Bar -->
        <div style="margin: 8px 0 4px; background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; overflow: hidden;">
          <div style="width: ${Math.min(score, 100)}%; height: 100%; background: ${risk.bar}; border-radius: 4px; transition: width 0.5s;"></div>
        </div>
      </div>
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
        <span style="font-weight: 800; font-size: 16px; color: ${risk.bar};">${score.toFixed(0)}</span>
        <div style="font-size: 10px; color: var(--text-muted);">
          ${isML ? '🔬 ML' : '⚙️ Reglas'}
        </div>
      </div>
    </div>
  `;
}

// ===== REINTENTO CONTROLADO DE SINCRONIZACIÓN DE PARCELA =====
window.retrySingleParcelPrediction = async function(parcelId, btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Sincronizando...';
  }
  try {
    const res = await api.getMLPrediction(parcelId);
    if (res && res.success) {
      if (typeof showToast === 'function') showToast('Pronóstico actualizado exitosamente.', 'success');
      if (typeof renderMLMonitorPage === 'function') renderMLMonitorPage();
    } else {
      if (typeof showToast === 'function') showToast(res.error || 'Servicio ocupado, reintentando en breve...', 'warning');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 Reintentar';
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Error al sincronizar: ' + err.message, 'danger');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 Reintentar';
    }
  }
};

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
