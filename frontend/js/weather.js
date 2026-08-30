/**
 * AgroPasco — Módulo de Clima, Alertas en Vivo y Protocolo de Acción Interactivo
 * Integración con Open-Meteo API (Cerro de Pasco) y Motor de Protocolos Multi-Escenario
 */

let activeWeatherSim = '';

// ===== MOTOR DE PROTOCOLOS MULTI-ESCENARIO DE EMERGENCIA =====
const EMERGENCY_PROTOCOLS = {
  helada: {
    key: 'helada',
    title: '🥶 PROTOCOLO DE EMERGENCIA ANTI-HELADA (<0°C)',
    risk_level: '🔴 PELIGRO EXTREMO DE CONGELAMIENTO',
    timer: '⏱️ Tiempo sugerido para actuar: 4 horas antes del amanecer (o 4:00 AM)',
    btn_type: 'helada',
    btn_label: '🚨 Ejecutar Protocolo Anti-Helada Ahora',
    steps: [
      { id: 0, title: 'Encender Riego por Aspersión a las 4 AM', img: FIELD_IMAGES.riego_aspersion, desc: 'Aplica agua sobre el cultivo antes del alba. Al congelarse el agua sobre la hoja, libera calor latente y protege las células vegetativas.' },
      { id: 1, title: 'Colocar Cobertura Térmica o Paja Seca', img: FIELD_IMAGES.mantas_termicas, desc: 'Cubre los surcos de papa o maca con agrotela, plástico agrícola o paja seca al atardecer para evitar la fuga de calor del suelo.' },
      { id: 2, title: 'Encender Fogatas de Humo en Bordes', img: FIELD_IMAGES.fogatas_humo, desc: 'Enciende paja húmeda en los bordes del terreno a las 4 AM. La manta de humo evita la radiación nocturna del suelo hacia el espacio.' },
      { id: 3, title: 'Fumigación Foliar de Bioestimulantes', img: FIELD_IMAGES.bioestimulantes, desc: 'Al salir el sol tras la helada, fumiga aminoácidos y fósforo soluble para regenerar y reactivar el metabolismo de la planta.' }
    ]
  },
  radiacion: {
    key: 'radiacion',
    title: '☀️ PROTOCOLO DE PROTECCIÓN ANTI-RADIACIÓN / UV (>10)',
    risk_level: '🟡 GOLPE DE CALOR Y ESTRÉS UV',
    timer: '⏱️ Tiempo sugerido para actuar: Entre 9:00 AM y 2:00 PM',
    btn_type: 'radiacion',
    btn_label: '☀️ Ejecutar Protocolo Anti-Radiación Ahora',
    steps: [
      { id: 0, title: 'Instalar Mallas Sombra al 50%', img: FIELD_IMAGES.malla_sombra, desc: 'Protege las platabandas y plantas jóvenes con mallas sombra para reducir la radiación ultravioleta directa de la altura.' },
      { id: 1, title: 'Riego de Refresco al Amanecer', img: FIELD_IMAGES.riego, desc: 'Riega ligeramente temprano en la mañana para mantener las células turgentes y reducir la evapotranspiración extrema.' },
      { id: 2, title: 'Aplicar Protectores Solares Foliares', img: FIELD_IMAGES.bioestimulantes, desc: 'Asperja caolín (arcilla blanca) o fertilizantes con silicio para reflejar el exceso de rayos UV.' }
    ]
  },
  sequia: {
    key: 'sequia',
    title: '🏜️ PROTOCOLO DE EMERGENCIA ANTI-SEQUÍA DE SUELO',
    risk_level: '🟡 ESTRÉS HÍDRICO CRÍTICO',
    timer: '⏱️ Tiempo sugerido para actuar: Acción diaria prioritaria',
    btn_type: 'sequia',
    btn_label: '🏜️ Ejecutar Protocolo Anti-Sequía Ahora',
    steps: [
      { id: 0, title: 'Colocar Cobertura Muerta (Mulching)', img: FIELD_IMAGES.mulch_cobertura, desc: 'Cubre el suelo alrededor del tallo con paja seca o rastrojo para reducir la evaporación del agua del suelo.' },
      { id: 1, title: 'Riego por Surcos Intercalados', img: FIELD_IMAGES.riego, desc: 'Regar surco por medio cada 4-5 días para optimizar el volumen de agua de riego disponible.' },
      { id: 2, title: 'Incorporar Compost de Alta Retención', img: FIELD_IMAGES.fertilizacion, desc: 'Abonar con materia orgánica madura que incrementa la capacidad de retención de humedad en la raíz.' }
    ]
  },
  granizo: {
    key: 'granizo',
    title: '🌩️ PROTOCOLO DE EMERGENCIA ANTI-GRANIZO Y LLUVIAS',
    risk_level: '🔴 TORMENTA Y EROSIÓN',
    timer: '⏱️ Tiempo sugerido para actuar: Previo al desarrollo nuboso',
    btn_type: 'granizo',
    btn_label: '🌩️ Ejecutar Protocolo Anti-Granizo Ahora',
    steps: [
      { id: 0, title: 'Despejar Zanjas y Canales de Drenaje', img: FIELD_IMAGES.zanjas_drenaje, desc: 'Limpia canales para encauzar el agua de lluvia intensa y evitar encharcamiento en la raíz.' },
      { id: 1, title: 'Desplegar Mallas Antigranizo', img: FIELD_IMAGES.malla_sombra, desc: 'Extiende mallas de monofilamento sobre las parcelas de mayor valor comercial.' },
      { id: 2, title: 'Fumigación Cicatrizante Post-Tormenta', img: FIELD_IMAGES.bioestimulantes, desc: 'Aplica caldo bordelés o sulfato de cobre inmediatamente después del granizo para desinfectar heridas.' }
    ]
  }
};

// ESTADO DE PASOS COMPLETADOS DEL CHECKLIST
let protocolState = {
  helada: [false, false, false, false],
  radiacion: [false, false, false],
  sequia: [false, false, false],
  granizo: [false, false, false]
};

async function renderWeatherPage() {
  const [liveRes, forecastRes, alertsRes, frostRes] = await Promise.all([
    api.getLiveWeather(),
    api.getForecast(),
    api.getAlerts(activeWeatherSim),
    api.getFrostRisk()
  ]);

  const live = liveRes.data || {};
  const forecast = forecastRes.data || [];
  const alerts = alertsRes.data || {};
  const frost = frostRes.data || {};

  const temp = live.temp_2m ?? live.main?.temp ?? 4.5;
  const humidity = live.humidity ?? live.main?.humidity ?? 75;
  const soilTemp = live.soil_temp_0cm ?? live.soil?.temp ?? 5.2;
  const soilMoisture = live.soil_moisture_1cm ?? live.soil?.moisture ?? 0.35;
  const uvIndex = live.uv_index ?? 9.5;

  return `
    <div class="page-content">
      <!-- Open-Meteo Live Header Badge -->
      <div style="margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.25); padding: 10px 16px; border-radius: var(--radius-sm);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">📡</span>
          <div>
            <strong style="font-size: 13.5px; color: var(--green-400);">Estación Meteorológica en Vivo — Open-Meteo API</strong>
            <div class="text-sm text-muted">Coordenadas: Lat -10.6674, Lon -76.2567 (Cerro de Pasco — 4,380 msnm)</div>
          </div>
        </div>
        <span class="badge badge-green">⚡ En vivo</span>
      </div>

      <!-- Weather Hero Widget -->
      <div class="weather-hero">
        <div class="weather-main">
          <div class="weather-temp">
            ${typeof temp === 'number' ? temp.toFixed(1) : temp}<span class="weather-temp-unit">°C</span>
          </div>
          <div class="weather-details">
            <h3>📍 Cerro de Pasco</h3>
            <p style="font-size: 16px; color: var(--green-300); font-weight: 600;">
              ${temp <= 0 ? '🥶 Helada Severa / Descenso Térmico' : temp <= 3 ? '⚠️ Frío Intenso' : '⛅ Tiempo Estable'}
            </p>

            <!-- Grid de Indicadores Clave en Vivo -->
            <div class="weather-meta" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 16px;">
              <div style="background: rgba(255,255,255,0.06); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--blue-400);">
                <div class="text-sm text-muted">💧 Humedad Aire</div>
                <strong style="font-size: 16px;">${humidity}%</strong>
              </div>
              <div style="background: rgba(255,255,255,0.06); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--amber-400);">
                <div class="text-sm text-muted">🌱 Temp. Suelo</div>
                <strong style="font-size: 16px;">${typeof soilTemp === 'number' ? soilTemp.toFixed(1) : soilTemp}°C</strong>
              </div>
              <div style="background: rgba(255,255,255,0.06); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--cyan-400);">
                <div class="text-sm text-muted">🌧️ Humedad Suelo</div>
                <strong style="font-size: 16px;">${(soilMoisture * 100).toFixed(0)}%</strong>
              </div>
              <div style="background: rgba(255,255,255,0.06); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--purple-400);">
                <div class="text-sm text-muted">☀️ Índice UV</div>
                <strong style="font-size: 16px; color: ${uvIndex > 10 ? 'var(--red-400)' : 'var(--amber-400)'};">${typeof uvIndex === 'number' ? uvIndex.toFixed(1) : uvIndex}</strong>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 5-Day Forecast -->
        <div class="weather-forecast">
          ${forecast.map(day => `
            <div class="forecast-day">
              <div class="forecast-day-name">${day.date}</div>
              <div class="forecast-day-icon">${day.icon || '⛅'}</div>
              <div class="forecast-day-temp">${day.temp_max?.toFixed(0) ?? '--'}° <span>${day.temp_min?.toFixed(0) ?? '--'}°</span></div>
              <div class="forecast-day-rain">💧 ${day.rain_prob ?? 0}%</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Barra de Simulación de Riesgo Climático -->
      <div class="card mb-lg" style="border-left: 4px solid var(--purple-400);">
        <div class="flex items-center justify-between gap-md" style="flex-wrap: wrap;">
          <div>
            <div style="font-weight: 700; font-size: 15px;">🧪 Prueba Visual de Eventos Climáticos Extremos</div>
            <div class="text-sm text-muted">Haz clic en una amenaza para probar el módulo de respuesta en vivo:</div>
          </div>
          <div class="filter-bar" style="margin-bottom: 0;">
            <button class="filter-chip ${!activeWeatherSim ? 'active' : ''}" onclick="setWeatherSim('')">Medición Real</button>
            <button class="filter-chip ${activeWeatherSim === 'helada' ? 'active' : ''}" onclick="setWeatherSim('helada')">🥶 Helada (&lt;0°C)</button>
            <button class="filter-chip ${activeWeatherSim === 'radiacion' ? 'active' : ''}" onclick="setWeatherSim('radiacion')">☀️ Radiación Alta</button>
            <button class="filter-chip ${activeWeatherSim === 'granizo' ? 'active' : ''}" onclick="setWeatherSim('granizo')">🌩️ Granizo / Lluvia</button>
            <button class="filter-chip ${activeWeatherSim === 'sequia' ? 'active' : ''}" onclick="setWeatherSim('sequia')">🏜️ Sequía de Suelo</button>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <!-- MÓDULO DE EVALUACIÓN Y ACCIÓN INTERACTIVA -->
        ${renderFrostRisk(frost, temp)}

        <!-- Tarjetas Ilustradas de Alertas y Mitigación -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">🚨</span> Detector de Alertas y Guía de Mitigación Ilustrada</div>
            <span class="badge badge-${(alerts.alerts?.length || 0) > 0 ? 'red' : 'green'}">${alerts.alerts?.length || 0} Alertas</span>
          </div>

          ${(alerts.alerts?.length || 0) > 0 ? alerts.alerts.map(a => renderVisualAlertCard(a)).join('') : `
            <div class="empty-state" style="padding: 32px;">
              <div class="empty-state-icon">✅</div>
              <div class="empty-state-title" style="color: var(--green-400);">Condiciones Seguras</div>
              <div class="empty-state-text">Sin amenazas extremas detectadas. Puedes simular eventos climáticos arriba.</div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ===== RENDERIZADO DEL MÓDULO CON BOTÓN DE ACCIÓN DINÁMICO =====
function renderFrostRisk(frost, currentTemp = 4) {
  let scenarioKey = 'helada';
  if (activeWeatherSim) {
    scenarioKey = activeWeatherSim;
  } else if (currentTemp <= 0) {
    scenarioKey = 'helada';
  } else if (currentTemp > 18) {
    scenarioKey = 'radiacion';
  }

  const protocol = EMERGENCY_PROTOCOLS[scenarioKey] || EMERGENCY_PROTOCOLS.helada;
  const level = frost.risk_level || (currentTemp <= 0 ? 'critico' : currentTemp <= 3 ? 'alto' : 'bajo');
  const score = frost.risk_score ?? (currentTemp <= 0 ? 88 : currentTemp <= 3 ? 65 : 20);

  const levelText = {
    critico: '🔴 PELIGRO EXTREMO (<0°C)',
    alto: '🟡 CUIDADO / PRECAUCIÓN',
    medio: '🟡 CUIDADO / PRECAUCIÓN',
    bajo: '🟢 SEGURO / NORMAL'
  };

  const badgeClass = { critico: 'red', alto: 'amber', medio: 'amber', bajo: 'green' };

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="card-title-icon">🥶</span> Evaluación de Riesgo de Helada</div>
        <span class="badge badge-${badgeClass[level]}" style="font-size: 13px; font-weight: 800; padding: 6px 14px;">
          ${levelText[level]}
        </span>
      </div>

      <div style="text-align: center; padding: 16px 0;">
        <div style="font-size: 64px; font-weight: 900; line-height: 1; color: ${level === 'critico' ? 'var(--red-400)' : level === 'alto' ? 'var(--amber-400)' : 'var(--green-400)'};">
          ${score} <span style="font-size: 20px; font-weight: 500; color: var(--text-muted);">/ 100</span>
        </div>
        <div style="font-size: 13.5px; color: var(--text-secondary); margin-top: 6px;">Puntuación de Riesgo de Congelamiento</div>
      </div>

      <!-- Desglose Visual de Factores -->
      <div style="display: grid; gap: 8px; margin-top: 12px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 8px; border-left: 3px solid ${currentTemp <= 0 ? 'var(--red-500)' : 'var(--green-500)'};">
          <div>
            <strong style="font-size: 13px;">🌡️ Temp. Aire (2m):</strong>
            <div class="text-sm text-muted">${currentTemp}°C</div>
          </div>
          <span class="badge badge-${currentTemp <= 0 ? 'red' : 'green'}">${currentTemp <= 0 ? 'Congelante' : 'Seguro'}</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 8px; border-left: 3px solid var(--blue-400);">
          <div>
            <strong style="font-size: 13px;">🏔️ Altitud Campo:</strong>
            <div class="text-sm text-muted">4,380 msnm</div>
          </div>
          <span class="badge badge-blue">Alta Puna</span>
        </div>
      </div>

      <!-- BOTÓN DE ACCIÓN DINÁMICO E INTERACTIVO -->
      <div style="margin-top: 16px;">
        <button class="btn-emergency-action ${protocol.btn_type}" onclick="openProtocolModal('${scenarioKey}')">
          ${protocol.btn_label}
        </button>
      </div>
    </div>
  `;
}

function renderVisualAlertCard(alert) {
  const isCritical = alert.severity === 'critical';

  let scenarioKey = 'helada';
  if (alert.type.includes('radiacion')) scenarioKey = 'radiacion';
  if (alert.type.includes('sequia')) scenarioKey = 'sequia';
  if (alert.type.includes('granizo')) scenarioKey = 'granizo';

  const protocol = EMERGENCY_PROTOCOLS[scenarioKey] || EMERGENCY_PROTOCOLS.helada;

  return `
    <div class="alert-card ${alert.severity}" style="margin-bottom: 20px; flex-direction: column; align-items: stretch;">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span class="alert-icon" style="font-size: 28px;">${isCritical ? '⛔' : '⚠️'}</span>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div class="alert-title" style="font-size: 16px; font-weight: 800;">${alert.title}</div>
            <span class="badge badge-${isCritical ? 'red' : 'amber'}" style="font-weight: 800;">
              ${isCritical ? '🔴 PELIGRO' : '🟡 PRECAUCIÓN'}
            </span>
          </div>
          <div class="alert-message mt-sm" style="font-size: 14px; line-height: 1.5;">${alert.message}</div>
        </div>
      </div>

      <!-- Botón directo de acción -->
      <div style="margin-top: 12px;">
        <button class="btn-emergency-action ${protocol.btn_type}" style="padding: 10px 16px; font-size: 13.5px;" onclick="openProtocolModal('${scenarioKey}')">
          ⚡ Abrir Checklist interactivo de mitigación
        </button>
      </div>
    </div>
  `;
}

// ===== MODAL INTERACTIVO DE PROTOCOLO CON CHECKLIST Y PROGRESO =====
function openProtocolModal(scenarioKey) {
  const protocol = EMERGENCY_PROTOCOLS[scenarioKey] || EMERGENCY_PROTOCOLS.helada;
  const state = protocolState[scenarioKey] || [false, false, false, false];

  const totalSteps = protocol.steps.length;
  const completedSteps = state.filter(Boolean).length;
  const percentage = Math.round((completedSteps / totalSteps) * 100);

  const existingModal = document.getElementById('protocol-modal-overlay');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'protocol-modal-overlay';
  modal.onclick = (e) => { if (e.target === modal) closeProtocolModal(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; padding: 24px;">
      <!-- Cabecera de Alerta -->
      <div class="modal-header" style="align-items: flex-start;">
        <div>
          <h3 style="font-size: 18px; font-weight: 800; color: var(--green-400);">${protocol.title}</h3>
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap;">
            <span class="badge badge-red">${protocol.risk_level}</span>
            <span style="font-size: 12.5px; color: var(--amber-400); font-weight: 600;">${protocol.timer}</span>
          </div>
        </div>
        <button class="modal-close" onclick="closeProtocolModal()">✕</button>
      </div>

      <!-- Barra de Progreso de Protección -->
      <div style="margin-top: 16px;">
        <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 700;">
          <span>Estado de Protección de la Parcela:</span>
          <span style="color: var(--green-400);">${completedSteps} de ${totalSteps} Pasos — ${percentage}% Protegida</span>
        </div>
        <div class="protocol-progress-track">
          <div class="protocol-progress-fill" id="protocol-progress-bar" style="width: ${percentage}%;"></div>
        </div>
      </div>

      <!-- Lista de Chequeo Ilustrada (Checklist) -->
      <div style="font-weight: 800; font-size: 14px; color: var(--text-primary); margin-bottom: 12px;">
        📸 Marca las acciones completadas en el campo:
      </div>

      <div id="checklist-container">
        ${protocol.steps.map((step, idx) => {
          const isDone = state[idx];
          return `
            <div class="checklist-card ${isDone ? 'done' : ''}" onclick="toggleProtocolStep('${scenarioKey}', ${idx})">
              <img src="${step.img}" alt="${step.title}" style="width: 84px; height: 84px; border-radius: 8px; object-fit: cover; flex-shrink: 0;">
              <div style="flex: 1;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                  <strong style="font-size: 14px; color: var(--text-primary);">Paso ${idx + 1}: ${step.title}</strong>
                  <button class="checklist-check-btn" type="button">
                    ${isDone ? '✅ HECHO' : ' Touch / Hecho '}
                  </button>
                </div>
                <p class="text-sm text-muted" style="font-size: 12.5px; line-height: 1.4; margin: 0;">${step.desc}</p>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Botón de Soporte Comunitario / Agencia Agraria -->
      <div class="support-call-card">
        <div>
          <strong style="font-size: 14px; display: block; color: var(--text-primary);">📞 ¿Necesitas auxilio o maquinaria?</strong>
          <span class="text-sm text-muted">Central de Riego y Agencia Agraria Pasco (Atención 24h)</span>
        </div>
        <a href="tel:063421234" class="btn btn-primary btn-sm" style="font-weight: 800;">
          📞 Llama al (063) 421234
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function toggleProtocolStep(scenarioKey, stepIndex) {
  if (!protocolState[scenarioKey]) protocolState[scenarioKey] = [];
  protocolState[scenarioKey][stepIndex] = !protocolState[scenarioKey][stepIndex];

  // Refresh modal interior UI seamlessly
  openProtocolModal(scenarioKey);

  const protocol = EMERGENCY_PROTOCOLS[scenarioKey];
  const state = protocolState[scenarioKey];
  const completed = state.filter(Boolean).length;
  const total = protocol.steps.length;

  if (completed === total) {
    showToast(`🎉 ¡Excelente! Parcela 100% Protegida ante ${protocol.key.toUpperCase()}.`, 'success');
  } else {
    showToast(`Paso ${stepIndex + 1} marcado como completado. (${completed}/${total})`, 'info');
  }
}

function closeProtocolModal() {
  document.getElementById('protocol-modal-overlay')?.remove();
}

function setWeatherSim(simType) {
  activeWeatherSim = simType;
  navigateTo('/weather');
}
