/**
 * AgroPasco — Dashboard Principal
 */

async function renderDashboard() {
  const user = getUser();
  const [weatherRes, liveWeatherRes, cropsRes, alertsRes, productsRes, frostRes, mlPredRes] = await Promise.all([
    api.getCurrentWeather(),
    api.getLiveWeather(),
    api.getCrops(),
    api.getAlerts(),
    api.getProducts(),
    api.getFrostRisk(),
    api.getMLPredictions().catch(() => ({ data: [] })),
  ]);

  const weather = weatherRes.data || {};
  const live = liveWeatherRes.data || {};
  const crops = cropsRes.data || [];
  const alerts = alertsRes.data || {};
  const products = productsRes.data || [];
  const frost = frostRes.data || {};
  const mlPredictions = mlPredRes.data || [];

  const temp = live.temp_2m ?? weather.main?.temp ?? '--';
  const humidity = live.humidity ?? weather.main?.humidity ?? '--';
  const condition = live.condition || weather.weather?.[0]?.description || 'Tiempo estable';
  const alertCount = alerts.alerts?.length || 0;

  return `
    <div class="page-content">
      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">🌱</div>
          <div class="stat-card-value">${crops.length}</div>
          <div class="stat-card-label">Cultivos Activos</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">🌡️</div>
          <div class="stat-card-value">${typeof temp === 'number' ? temp.toFixed(1) : temp}°</div>
          <div class="stat-card-label">Temperatura Actual</div>
        </div>
        <div class="stat-card" style="--stat-color: ${alertCount > 0 ? 'var(--red-500)' : 'var(--amber-500)'}">
          <div class="stat-card-icon">${alertCount > 0 ? '🚨' : '✅'}</div>
          <div class="stat-card-value">${alertCount}</div>
          <div class="stat-card-label">Alertas Activas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--purple-400)">
          <div class="stat-card-icon">📦</div>
          <div class="stat-card-value">${products.length}</div>
          <div class="stat-card-label">Productos en Catálogo</div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Weather Summary -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">⛅</span> Clima — Cerro de Pasco</div>
            <a href="#/weather" class="btn btn-sm btn-secondary">Ver más</a>
          </div>
          <div class="flex items-center gap-lg">
            <div>
              <div style="font-size: 48px; font-weight: 800; line-height: 1;">${typeof temp === 'number' ? temp.toFixed(1) : temp}°C</div>
              <div class="text-muted mt-sm">${condition}</div>
            </div>
            <div style="flex: 1;">
              <div class="weather-meta" style="flex-direction: column; gap: 8px;">
                <div class="weather-meta-item">💧 Humedad: <strong>${humidity}%</strong></div>
                <div class="weather-meta-item">🌬️ Viento: <strong>${weather.wind?.speed ?? '--'} m/s</strong></div>
                <div class="weather-meta-item">📍 Altitud: <strong>4,380 msnm</strong></div>
              </div>
            </div>
          </div>
          ${frost.risk_level ? `
            <div class="alert-card ${frost.risk_level === 'critico' ? 'critical' : frost.risk_level === 'alto' ? 'warning' : 'info'}" style="margin-top: 16px;">
              <span class="alert-icon">${frost.risk_level === 'critico' ? '🥶' : frost.risk_level === 'alto' ? '⚠️' : '🌡️'}</span>
              <div class="alert-content">
                <div class="alert-title">Riesgo de Helada: ${frost.risk_level.toUpperCase()} (${frost.risk_score}/100)</div>
                <div class="alert-message">${frost.recommendation}</div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Active Alerts -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">🚨</span> Alertas Climáticas</div>
          </div>
          ${alertCount > 0 ? alerts.alerts.map(a => `
            <div class="alert-card ${a.severity}">
              <span class="alert-icon">${a.severity === 'critical' ? '⛔' : '⚠️'}</span>
              <div class="alert-content">
                <div class="alert-title">${a.title}</div>
                <div class="alert-message">${a.message}</div>
                ${a.actions ? `<div class="alert-actions">${a.actions.slice(0,2).map(act => `<span class="alert-action-tag">${act}</span>`).join('')}</div>` : ''}
              </div>
            </div>
          `).join('') : `
            <div class="empty-state" style="padding: 24px;">
              <div class="empty-state-icon">✅</div>
              <div class="empty-state-title">Sin alertas activas</div>
              <div class="empty-state-text">Las condiciones climáticas son favorables.</div>
            </div>
          `}
        </div>
      </div>

      <!-- ML Risk Summary -->
      ${renderDashboardMLWidget(mlPredictions)}

      <!-- Recent Crops Section -->
      <div class="card mt-lg">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">🌿</span> 
            ${user?.role === 'supermarket' ? 'Cultivos en Producción' : (user?.role === 'advisor' || user?.role === 'admin') ? 'Cultivos Registrados en la Región' : 'Mis Cultivos'}
          </div>
          ${user?.role === 'supermarket' ? `
            <button class="btn btn-primary btn-sm" onclick="window.location.hash='#/supermarket'">Ver Catálogo</button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="window.location.hash='#/crops?action=new'">+ Nuevo Cultivo</button>
          `}
        </div>
        ${crops.length > 0 ? `
          <div class="grid-3">
            ${crops.slice(0, 6).map(crop => renderCropCard(crop)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">🌱</div>
            <div class="empty-state-title">No hay cultivos registrados</div>
            <div class="empty-state-text">Registra cultivos para habilitar recomendaciones satelitales y trazabilidad digital.</div>
            ${user?.role !== 'supermarket' ? `
              <button class="btn btn-primary" onclick="window.location.hash='#/crops?action=new'">Registrar nuevo cultivo</button>
            ` : `
              <button class="btn btn-primary" onclick="window.location.hash='#/supermarket'">Explorar productos disponibles</button>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderCropCard(crop) {
  const icons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡', mashua: '🟠', oca: '🔴', trigo: '🌾', cebada: '🌾' };
  const statusColors = { planificado: 'blue', sembrado: 'green', crecimiento: 'green', floracion: 'amber', maduracion: 'amber', cosechado: 'purple', cancelado: 'red' };

  return `
    <div class="crop-card" onclick="window.location.hash='#/crops/${crop.id}'">
      <div class="crop-card-header">
        <div>
          <div class="crop-card-name">${crop.name}</div>
          <div class="crop-card-type">${crop.crop_type}${crop.variety ? ' — ' + crop.variety : ''}</div>
          ${crop.farmer_name ? `<div class="text-xs text-muted" style="margin-top: 2px;">👤 ${crop.farmer_name}</div>` : ''}
        </div>
        <div class="crop-card-icon">${icons[crop.crop_type] || '🌱'}</div>
      </div>
      <div>
        <span class="badge badge-${statusColors[crop.status] || 'blue'}">${crop.status}</span>
      </div>
      <div class="crop-card-stats">
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${crop.area_hectares || 0} ha</div>
          <div class="crop-card-stat-label">Área</div>
        </div>
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${crop.altitude_masl || 4380} m</div>
          <div class="crop-card-stat-label">Altitud</div>
        </div>
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${crop.total_logs || 0}</div>
          <div class="crop-card-stat-label">Registros</div>
        </div>
      </div>
    </div>
  `;
}

// ===== ML RISK WIDGET FOR DASHBOARD =====
function renderDashboardMLWidget(mlPredictions) {
  // Collect highest risks across parcels
  const successPreds = mlPredictions.filter(p => p.success && p.data?.predictions);
  if (successPreds.length === 0) {
    return `
      <div class="card mt-lg" style="border-left: 4px solid var(--purple-400);">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🔬</span> Predicción ML Meteorológica</div>
          <a href="#/ml-monitor" class="btn btn-sm btn-secondary">Ver Panel ML</a>
        </div>
        <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔬</div>
          Registra parcelas con coordenadas para activar predicciones ML personalizadas.
        </div>
      </div>
    `;
  }

  const phenomenonEmoji = { frost: '🥶', heavy_rain: '🌧️', snow: '❄️', hail: '🌩️' };
  const phenomenonName = { frost: 'Helada', heavy_rain: 'Lluvia', snow: 'Nieve', hail: 'Granizo' };
  const riskColors = { high: 'var(--red-400)', moderate: 'var(--amber-400)', low: 'var(--green-400)', none: 'var(--green-500)' };

  // Aggregate highest risk per phenomenon across all parcels
  const riskSummary = {};
  let highestRisk = { score: 0, level: 'none', phenomenon: '', parcel: '' };

  for (const p of successPreds) {
    for (const pred of (p.data.predictions || [])) {
      const ph = pred.phenomenon;
      if (!riskSummary[ph] || pred.risk_score > riskSummary[ph].score) {
        riskSummary[ph] = { score: pred.risk_score || 0, level: pred.risk_level || 'none', model: pred.model_type };
      }
      if ((pred.risk_score || 0) > highestRisk.score) {
        highestRisk = { score: pred.risk_score, level: pred.risk_level, phenomenon: ph, parcel: p.data.parcel_name || p.parcel_name };
      }
    }
  }

  const riskBadgeClass = highestRisk.level === 'high' ? 'red' : highestRisk.level === 'moderate' ? 'amber' : 'green';

  return `
    <div class="card mt-lg" style="border-left: 4px solid ${riskColors[highestRisk.level] || 'var(--purple-400)'};">
      <div class="card-header">
        <div class="card-title"><span class="card-title-icon">🔬</span> Predicción ML Meteorológica</div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="badge badge-${riskBadgeClass}" style="font-size: 11px; font-weight: 700;">
            ${highestRisk.level === 'high' ? '🔴 Riesgo Alto' : highestRisk.level === 'moderate' ? '🟡 Riesgo Moderado' : '🟢 Sin Riesgo'}
          </span>
          <a href="#/ml-monitor" class="btn btn-sm btn-secondary">Ver Detalle</a>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 8px;">
        ${Object.entries(riskSummary).map(([ph, r]) => `
          <div style="background: var(--bg-glass); border-radius: 10px; padding: 12px; text-align: center; cursor: pointer;" onclick="window.location.hash='#/ml-monitor'">
            <div style="font-size: 24px;">${phenomenonEmoji[ph] || '❓'}</div>
            <div style="font-weight: 700; font-size: 12px; margin: 4px 0;">${phenomenonName[ph] || ph}</div>
            <div style="font-size: 20px; font-weight: 800; color: ${riskColors[r.level]};">${r.score.toFixed(0)}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${r.model === 'ml_trained' ? '🔬 ML' : '⚙️ Reglas'}</div>
          </div>
        `).join('')}
      </div>
      ${highestRisk.score >= 30 ? `
        <div style="margin-top: 10px; font-size: 12px; color: var(--text-secondary); background: rgba(251,191,36,0.08); padding: 8px 12px; border-radius: 8px;">
          ⚠️ Mayor riesgo: <strong>${phenomenonName[highestRisk.phenomenon]}</strong> (${highestRisk.score.toFixed(0)}/100) en <strong>${highestRisk.parcel}</strong>
        </div>
      ` : ''}
      <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
        ${successPreds.length} parcela${successPreds.length !== 1 ? 's' : ''} evaluada${successPreds.length !== 1 ? 's' : ''} · ${successPreds[0]?.source === 'ml_service' ? '🔬 Servicio ML activo' : '⚙️ Modo reglas'}
      </div>
    </div>
  `;
}
