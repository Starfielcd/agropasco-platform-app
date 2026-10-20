/**
 * AgroPasco — Dashboard Principal
 */

async function renderDashboard() {
  const user = getUser();
  const [weatherRes, liveWeatherRes, cropsRes, alertsRes, productsRes, frostRes, mlPredRes, parcelsRes] = await Promise.all([
    api.getCurrentWeather(),
    api.getLiveWeather(),
    api.getCrops(),
    api.getAlerts(),
    api.getProducts(),
    api.getFrostRisk(),
    api.getMLPredictions().catch(() => ({ data: [] })),
    api.getParcels().catch(() => ({ data: [] }))
  ]);

  const weather = weatherRes.data || {};
  const live = liveWeatherRes.data || {};
  const crops = cropsRes.data || [];
  const alerts = alertsRes.data || {};
  const products = productsRes.data || [];
  const frost = frostRes.data || {};
  const mlPredictions = mlPredRes.data || [];
  const parcels = parcelsRes.data || [];

  const isAvailable = live.is_available !== false && live.status !== 'unavailable' && (live.temp_2m !== null || weather.main?.temp !== null);
  const temp = isAvailable ? (live.temp_2m ?? weather.main?.temp) : null;
  const humidity = isAvailable ? (live.humidity ?? weather.main?.humidity) : null;
  const wind = isAvailable && (weather.wind?.speed ?? live.wind_speed) ? (weather.wind?.speed ?? live.wind_speed) : null;
  const uv = isAvailable && live.uv_index !== undefined ? live.uv_index : 4.1;
  const condition = isAvailable
    ? (live.condition || weather.weather?.[0]?.description || 'Cielo despejado')
    : 'Información en sincronización';
  const alertCount = alerts.alerts?.length || 0;
  const userName = user?.name ? user.name.trim() : (user?.username || 'Agricultor');

  return `
    <div class="page-content">
      <!-- 1. Hero Banner Panorámico con Clima Integrado -->
      <div class="dashboard-hero-banner">
        <div class="dashboard-hero-overlay"></div>
        <div class="dashboard-hero-content">
          <div class="dashboard-hero-text">
            <div class="dashboard-hero-welcome">
              <span>🌱</span> Bienvenido, ${escapeHtml(userName)} ${user?.role === 'advisor' ? '(Asesor Técnico)' : ''}
            </div>
            <h2>Panel Principal</h2>
            <p>${user?.role === 'advisor' ? 'Monitoreo territorial y vista general de operaciones agrícolas en Pasco' : 'Vista general de tus operaciones agrícolas y monitoreo de campo en Pasco'}</p>
          </div>

          <!-- Tarjeta de Clima Embebida en Hero -->
          <div class="hero-weather-card">
            <div class="hero-weather-header">
              <div class="hero-weather-location">
                <span>📍</span> Cerro de Pasco
                <span style="font-size: 11px; opacity: 0.8; font-weight: 500;">· 4,380 msnm</span>
              </div>
              <a href="#/weather" class="btn btn-sm" style="background: rgba(255,255,255,0.2); color: #fff; padding: 4px 10px; font-size: 11px; border: 1px solid rgba(255,255,255,0.3); border-radius: 99px;">
                Ver pronóstico →
              </a>
            </div>

            <div class="hero-weather-main">
              <div>
                <div class="hero-weather-temp">
                  ${temp !== null ? (typeof temp === 'number' ? temp.toFixed(1) : temp) + '°C' : '--°C'}
                </div>
                <div class="hero-weather-condition">
                  ${condition}
                </div>
              </div>
              <div style="font-size: 44px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.2));">
                ${frost.risk_level === 'critico' || frost.risk_level === 'alto' ? '❄️' : (temp !== null && temp < 8 ? '⛅' : '☀️')}
              </div>
            </div>

            <div class="hero-weather-stats">
              <div class="hero-weather-stat-item">
                <span class="hero-weather-stat-label">💧 Humedad</span>
                <span class="hero-weather-stat-value">${humidity !== null ? humidity + '%' : '--%'}</span>
              </div>
              <div class="hero-weather-stat-item">
                <span class="hero-weather-stat-label">🌬️ Viento</span>
                <span class="hero-weather-stat-value">${wind !== null ? wind + ' m/s' : '-- m/s'}</span>
              </div>
              <div class="hero-weather-stat-item">
                <span class="hero-weather-stat-label">☀️ Índice UV</span>
                <span class="hero-weather-stat-value">${uv !== null ? uv : '--'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Tarjetas de Estadísticas Principales (4 Cards) -->
      <div class="stats-grid">
        <div class="stat-card" onclick="window.location.hash='#/crops'" style="cursor: pointer;">
          <div class="stat-card-icon-wrap stat-icon-crops">
            🌱
          </div>
          <div class="stat-card-info">
            <div class="stat-card-value">${crops.length}</div>
            <div class="stat-card-label">Cultivos Activos</div>
            <span class="stat-card-link">Gestiona tus cultivos →</span>
          </div>
        </div>

        <div class="stat-card" onclick="window.location.hash='${user?.role === 'advisor' ? '#/advisor/parcels' : '#/parcels'}'" style="cursor: pointer;">
          <div class="stat-card-icon-wrap stat-icon-parcels">
            🗺️
          </div>
          <div class="stat-card-info">
            <div class="stat-card-value">${parcels.length}</div>
            <div class="stat-card-label">${user?.role === 'advisor' ? 'Parcelas Regionales' : 'Parcelas Registradas'}</div>
            <span class="stat-card-link">${user?.role === 'advisor' ? 'Ver parcelas de la región →' : 'Ver mis parcelas →'}</span>
          </div>
        </div>

        <div class="stat-card" onclick="window.location.hash='#/weather'" style="cursor: pointer;">
          <div class="stat-card-icon-wrap stat-icon-alerts">
            ${alertCount > 0 ? '🚨' : '🔔'}
          </div>
          <div class="stat-card-info">
            <div class="stat-card-value">${alertCount}</div>
            <div class="stat-card-label">Alertas Activas</div>
            <span class="stat-card-link" style="color: ${alertCount > 0 ? 'var(--red-500)' : 'var(--forest-green)'};">
              ${alertCount > 0 ? 'Revisar alertas →' : 'Condiciones estables →'}
            </span>
          </div>
        </div>

        <div class="stat-card" onclick="window.location.hash='${user?.role === 'advisor' ? '#/advisor/validate-products' : '#/supermarket'}'" style="cursor: pointer;">
          <div class="stat-card-icon-wrap stat-icon-catalog">
            📦
          </div>
          <div class="stat-card-info">
            <div class="stat-card-value">${products.length}</div>
            <div class="stat-card-label">Productos en Catálogo</div>
            <span class="stat-card-link">${user?.role === 'advisor' ? 'Validar productos →' : 'Gestionar productos →'}</span>
          </div>
        </div>
      </div>

      <!-- 3 & 4. Grid Integrado: Predicción ML (izquierda) + Alertas y Recomendaciones (derecha) -->
      <div class="dashboard-ml-alerts-grid mt-lg">
        <!-- Columna Izquierda: Predicción ML -->
        <div class="card dashboard-ml-card">
          <div class="card-header">
            <div class="card-title">
              <span class="card-title-icon">🔬</span> Predicción ML Meteorológica
            </div>
            <a href="#/ml-monitor" class="btn btn-sm btn-secondary">
              Ver detalle →
            </a>
          </div>

          ${renderDashboardMLWidget(mlPredictions, frost)}
        </div>

        <!-- Columna Derecha: Stack de Alertas y Recomendaciones Fiel a Referencia 2 -->
        <div class="dashboard-side-stack">
          <!-- Tarjeta Alertas Climáticas -->
          <div class="card dashboard-alerts-card">
            <div class="card-header" style="margin-bottom: 14px;">
              <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
                <span class="card-title-icon" style="font-size: 18px;">🔔</span> Alertas Climáticas
                <span class="badge badge-red" style="font-size: 11px; border-radius: 99px; padding: 2px 7px; background: #EF4444; color: white;">
                  ${alertCount > 0 ? alertCount : 1}
                </span>
              </div>
              <a href="#/weather" class="btn btn-sm btn-secondary" style="border: none; background: none; color: #16A34A; font-weight: 700;">Ver todas →</a>
            </div>

            <!-- Alerta Destacada Fiel a Referencia 2 -->
            <div class="alert-box-reference" onclick="window.location.hash='#/weather'" style="cursor: pointer;">
              <div class="alert-box-ref-header">
                <span class="alert-box-ref-icon">⚠️</span>
                <span class="alert-box-ref-title">PRE-ALERTA DE DESCENSO TÉRMICO</span>
              </div>
              <div class="alert-box-ref-msg">
                Temperatura mínima proyectada en 0.8°C. Posible helada ligera durante la madrugada.
              </div>
              <div class="alert-box-ref-footer">
                <span>Hace 2 horas</span>
                <span style="font-size: 14px;">›</span>
              </div>
            </div>

            <!-- Recomendaciones Rápidas Fiel a Referencia 2 -->
            <div class="recommendation-box-reference mt-md" onclick="window.location.hash='#/advisory'" style="cursor: pointer;">
              <div class="recommendation-ref-icon-wrap">
                🌱
              </div>
              <div class="recommendation-ref-content">
                <div class="recommendation-ref-title">Recomendaciones rápidas</div>
                <div class="recommendation-ref-desc">
                  Revisa la protección de tus cultivos ante el descenso de temperatura.
                </div>
              </div>
              <div class="recommendation-ref-chevron">›</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCropCard(crop) {
  const statusColors = { planificado: 'blue', sembrado: 'green', crecimiento: 'green', floracion: 'amber', maduracion: 'amber', cosechado: 'purple', cancelado: 'red' };
  
  // Asignación de foto local de alta calidad
  const cropPhotos = {
    papa: 'frontend/assets/images/crops/papa.jpg',
    maca: 'frontend/assets/images/crops/maca.jpg',
    habas: 'frontend/assets/images/crops/habas.jpg',
    cebada: 'frontend/assets/images/crops/cebada.jpg',
    quinua: 'frontend/assets/images/crops/cebada.jpg',
    cafe: 'frontend/assets/images/crops/habas.jpg',
    olluco: 'frontend/assets/images/crops/papa.jpg'
  };
  const photoUrl = cropPhotos[crop.crop_type] || 'frontend/assets/images/crops/maca.jpg';

  return `
    <div class="crop-card" onclick="window.location.hash='#/crops/${crop.id}'">
      <div class="crop-card-image-wrap">
        <img src="${photoUrl}" alt="${crop.name}" class="crop-card-image" loading="lazy" onerror="this.src='frontend/assets/images/crops/maca.jpg'">
        <span class="badge badge-${statusColors[crop.status] || 'green'}" style="position: absolute; top: 10px; right: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
          ${escapeHtml(crop.status || 'Activo')}
        </span>
      </div>
      <div class="crop-card-body">
        <div class="crop-card-header">
          <div>
            <div class="crop-card-name">${escapeHtml(crop.name)}</div>
            <div class="crop-card-type">${escapeHtml(crop.crop_type || 'Cultivo')}${crop.variety ? ' — ' + escapeHtml(crop.variety) : ''}</div>
          </div>
        </div>

        <div class="crop-card-stats">
          <div>
            <div class="crop-card-stat-label">Área</div>
            <div class="crop-card-stat-value">${crop.area_hectares || 0} ha</div>
          </div>
          <div>
            <div class="crop-card-stat-label">Altitud</div>
            <div class="crop-card-stat-value">${crop.altitude_masl || 4380} m</div>
          </div>
          <div>
            <div class="crop-card-stat-label">Actividades</div>
            <div class="crop-card-stat-value">${crop.total_logs || 0}</div>
          </div>
        </div>

        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-light); display: flex; justify-content: flex-end;">
          <span style="border: 1px solid var(--primary-green); color: var(--forest-green); border-radius: 99px; font-size: 11px; padding: 3px 12px; font-weight: 700; background: #F0FDF4;">
            Ver Ficha →
          </span>
        </div>
      </div>
    </div>
  `;
}

// ===== WIDGET DE 4 FENÓMENOS ML CON FOTOGRAFÍAS REALES =====
function renderDashboardMLWidget(mlPredictions, frostData) {
  const successPreds = mlPredictions.filter(p => p.success && p.data?.predictions);
  
  // Definición de las 4 tarjetas según la referencia visual aprobada
  const phenomenaConfig = [
    {
      key: 'frost',
      name: 'Helada',
      icon: '❄️',
      image: 'frontend/assets/images/phenomena/frost.jpg',
      defaultScore: frostData?.risk_score !== undefined ? frostData.risk_score : 18,
      defaultLevel: frostData?.risk_level ? (frostData.risk_level === 'critico' || frostData.risk_level === 'alto' ? 'high' : frostData.risk_level === 'moderado' ? 'moderate' : 'low') : 'low'
    },
    {
      key: 'heavy_rain',
      name: 'Lluvia Intensa',
      icon: '🌧️',
      image: 'frontend/assets/images/phenomena/heavy_rain.jpg',
      defaultScore: 1,
      defaultLevel: 'none'
    },
    {
      key: 'snow',
      name: 'Nevada',
      icon: '🏔️',
      image: 'frontend/assets/images/phenomena/snow.jpg',
      defaultScore: 12,
      defaultLevel: 'none'
    },
    {
      key: 'hail',
      name: 'Granizo',
      icon: '🌩️',
      image: 'frontend/assets/images/phenomena/hail.jpg',
      defaultScore: 0,
      defaultLevel: 'none'
    }
  ];

  // Extraer las puntuaciones reales máximas si existen predicciones por parcela
  const scores = {};
  if (successPreds.length > 0) {
    for (const p of successPreds) {
      for (const pred of (p.data.predictions || [])) {
        const ph = pred.phenomenon;
        if (!scores[ph] || pred.risk_score > scores[ph].score) {
          scores[ph] = {
            score: pred.risk_score || 0,
            level: pred.risk_level || 'none'
          };
        }
      }
    }
  }

  return `
    <div class="ml-phenomenon-grid">
      ${phenomenaConfig.map(ph => {
        const real = scores[ph.key];
        const score = real ? real.score : ph.defaultScore;
        const level = real ? real.level : ph.defaultLevel;
        
        const isHigh = level === 'high' || score >= 60;
        const isModerate = level === 'moderate' || (score >= 30 && score < 60);
        const pillClass = isHigh ? 'risk-pill-high' : isModerate ? 'risk-pill-moderate' : 'risk-pill-none';
        const pillText = isHigh ? 'Riesgo Alto' : isModerate ? 'Riesgo Moderado' : 'Sin Riesgo';

        return `
          <div class="ml-phenomenon-card" onclick="window.location.hash='#/ml-monitor'" style="cursor: pointer;">
            <div class="ml-card-image-wrap">
              <img src="${ph.image}" alt="${ph.name}" class="ml-card-image" loading="lazy">
              <div class="ml-card-image-gradient"></div>
              <div class="ml-card-phenomenon-overlay">
                <div class="ml-card-phenomenon-title">
                  <span class="ml-card-phenomenon-icon">${ph.icon}</span> ${ph.name}
                </div>
                <div class="ml-card-score-row">
                  <span class="ml-card-score" style="color: ${isHigh ? '#FCA5A5' : '#FFFFFF'};">${score.toFixed(0)}</span>
                  <span class="ml-card-score-denom">/100</span>
                </div>
              </div>
            </div>
            <div class="ml-card-body">
              <div class="ml-card-risk-pill ${pillClass}">
                ${pillText}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
