/**
 * AgroPasco — Dashboard Principal
 */

async function renderDashboard() {
  const user = getUser();
  const [weatherRes, liveWeatherRes, cropsRes, alertsRes, productsRes, frostRes] = await Promise.all([
    api.getCurrentWeather(),
    api.getLiveWeather(),
    api.getCrops(),
    api.getAlerts(),
    api.getProducts(),
    api.getFrostRisk()
  ]);

  const weather = weatherRes.data || {};
  const live = liveWeatherRes.data || {};
  const crops = cropsRes.data || [];
  const alerts = alertsRes.data || {};
  const products = productsRes.data || [];
  const frost = frostRes.data || {};

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

      <!-- Recent Crops -->
      <div class="card mt-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🌿</span> Mis Cultivos</div>
          <button class="btn btn-primary btn-sm" onclick="window.location.hash='#/crops'">+ Nuevo Cultivo</button>
        </div>
        ${crops.length > 0 ? `
          <div class="grid-3">
            ${crops.slice(0, 6).map(crop => renderCropCard(crop)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">🌱</div>
            <div class="empty-state-title">No tienes cultivos registrados</div>
            <div class="empty-state-text">Registra tu primer cultivo para recibir asesoría personalizada.</div>
            <button class="btn btn-primary" onclick="window.location.hash='#/crops'">Registrar mi primer cultivo</button>
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
          <div class="crop-card-stat-value">${crop.total_logs || 0}</div>
          <div class="crop-card-stat-label">Registros</div>
        </div>
      </div>
    </div>
  `;
}
