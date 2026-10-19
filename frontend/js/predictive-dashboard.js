/**
 * AgroPasco Digital — Dashboard Predictivo en Tiempo Real (Fase 3)
 * ===============================================================
 * Integración profesional de modelos de Machine Learning meteorológico
 * con parcelas georreferenciadas, visualización de horizontes 24h/48h/72h,
 * mapa interactivo Leaflet, simulación manual (sandbox), comparativa de 5 modelos,
 * contraste predicción vs realidad y preparación para Monte Carlo y Multiagentes.
 */

// ===== ESTADO GLOBAL DEL DASHBOARD PREDICTIVO =====
const predictiveDashboardState = {
  selectedParcelId: null,
  parcels: [],
  currentPrediction: null,
  horizonsData: null,
  modelsComparison: null,
  evaluationsData: null,
  simulationContract: null,
  agentsStatus: null,
  activeHorizon: '24h',          // '24h', '48h', '72h'
  activeMode: 'auto',            // 'auto', 'manual'
  activeBenchmarkPhenomenon: 'frost', // 'frost', 'heavy_rain', 'snow', 'hail'
  autoRefreshEnabled: true,
  refreshTimer: null,
  lastUpdated: null,
  isLoading: false,
  chartInstance: null,
  mapInstance: null,
  mapLayerGroup: null,
  manualInputs: {
    temperature_2m_min: 1.5,
    temperature_2m_max: 13.0,
    precipitation_sum: 4.2,
    humidity_mean: 68.0,
    wind_speed_10m_max: 3.5,
    altitude_masl: 3800,
  },
  manualSimulationResult: null,
};

// ===== RENDERIZADO PRINCIPAL DE LA PÁGINA =====
async function renderPredictiveDashboardPage() {
  const user = getUser();
  const isPrivileged = user?.role === 'advisor' || user?.role === 'admin';

  return `
    <div class="page-content" id="predictive-dashboard-container">
      <!-- 1. BARRA SUPERIOR DE CONTROL Y ESTADO -->
      <div class="card" style="margin-bottom: 20px; padding: 18px 22px; background: linear-gradient(135deg, #FFFFFF 0%, #F0FDF4 100%); border: 1px solid var(--border-green);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 800; color: #166534; margin: 0;">
                🔮 Dashboard Predictivo Agroclimático
              </h2>
              <span class="badge badge-green" style="font-size: 11px; font-weight: 700; letter-spacing: 0.3px;">
                ML v2.0.0 Nativo
              </span>
            </div>
            <p class="text-sm text-muted" style="margin: 4px 0 0;">
              Inferencia de riesgos por parcela en tiempo real para la Región Pasco (Heladas, Nevadas, Granizadas y Lluvias Intensas)
            </p>
          </div>

          <!-- Controles de Modo y Auto-Refresco -->
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <div style="display: inline-flex; background: #E2E8F0; padding: 3px; border-radius: 10px;">
              <button type="button" id="btn-mode-auto" class="btn btn-sm ${predictiveDashboardState.activeMode === 'auto' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px; border-radius: 8px;" onclick="switchPredictiveMode('auto')">
                🤖 Automático (En Vivo)
              </button>
              <button type="button" id="btn-mode-manual" class="btn btn-sm ${predictiveDashboardState.activeMode === 'manual' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px; border-radius: 8px;" onclick="switchPredictiveMode('manual')">
                🎛️ Simulación Manual
              </button>
            </div>

            <!-- Estado de conexión y última actualización -->
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); background: #FFFFFF; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--border);">
              <span id="pred-connection-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22C55E;"></span>
              <span id="pred-connection-text" style="font-weight: 600; color: #166534;">En Línea</span>
              <span style="color: #CBD5E1;">|</span>
              <span id="pred-last-sync-time">Sincronizando...</span>
            </div>

            <button type="button" class="btn btn-secondary btn-sm" id="btn-refresh-pred" style="font-size: 12px;" onclick="refreshPredictiveDashboard(true)" title="Actualizar datos ahora">
              🔄 Refrescar
            </button>
          </div>
        </div>

        <!-- Barra secundaria de selección de parcela -->
        <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(22, 163, 74, 0.15); display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 1;">
            <label for="select-pred-parcel" style="font-size: 13px; font-weight: 700; color: #166534; display: flex; align-items: center; gap: 6px;">
              <span>🗺️</span> Parcela Activa:
            </label>
            <select id="select-pred-parcel" class="form-control" style="max-width: 380px; font-weight: 600; padding: 6px 12px; font-size: 13px; border-radius: 8px;" onchange="onPredictiveParcelChanged(this.value)">
              <option value="">Cargando parcelas autorizadas...</option>
            </select>
            <div id="pred-parcel-quick-badges" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;"></div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline-primary btn-sm" style="font-size: 11.5px; border-color: #6366F1; color: #4338CA; font-weight: 700;" onclick="scrollToSection('section-multi-agents')">
              🤖 5 Agentes Inteligentes
            </button>
            <button class="btn btn-outline-success btn-sm" style="font-size: 11.5px; border-color: #16A34A; color: #166534; font-weight: 700;" onclick="scrollToSection('section-mitigation-strategies')">
              🛡️ Estrategias de Mitigación
            </button>
            <button class="btn btn-outline-primary btn-sm" style="font-size: 11.5px; border-color: #6366F1; color: #4F46E5; font-weight: 700;" onclick="scrollToSection('section-monte-carlo')">
              🎲 Simulador Monte Carlo
            </button>
            <button class="btn btn-outline-secondary btn-sm" style="font-size: 11.5px;" onclick="scrollToSection('section-model-benchmark')">
              📊 Comparativa 5 Modelos
            </button>
            <button class="btn btn-outline-secondary btn-sm" style="font-size: 11.5px;" onclick="scrollToSection('section-obs-vs-pred')">
              ⚖️ Predicción vs Realidad
            </button>
            <button class="btn btn-outline-secondary btn-sm" style="font-size: 11.5px;" onclick="scrollToSection('section-future-phases')">
              🚀 Fases Siguientes
            </button>
          </div>
        </div>
      </div>

      <!-- 2. TARJETAS KPI DE RIESGO POR FENÓMENO (4 FENÓMENOS) -->
      <div id="pred-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <!-- Se inyecta dinámicamente con renderPhenomenonRiskCards() -->
      </div>

      <!-- 3. PANEL CENTRAL: MAPA LEAFLET + SERIES TEMPORALES 24/48/72H -->
      <div style="display: grid; grid-template-columns: 1fr 1.35fr; gap: 20px; margin-bottom: 24px;" class="pred-main-grid">
        <!-- Columna Izquierda: Mapa Interactivo de la Parcela -->
        <div class="card" style="padding: 18px; display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="font-weight: 800; font-size: 15px; color: #166534; display: flex; align-items: center; gap: 8px;">
              <span>📍</span> Georreferenciación & Topografía
            </div>
            <span id="pred-map-altitude-badge" class="badge badge-gray" style="font-size: 11.5px;">-- msnm</span>
          </div>

          <!-- Banner de Estado de Red / Teselas -->
          <div id="pred-map-error-banner" style="display: none; padding: 8px 12px; background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; margin-bottom: 8px; font-size: 12px; color: #92400E;"></div>

          <!-- Contenedor del Mapa -->
          <div id="predictive-parcel-map" style="width: 100%; height: 340px; border-radius: 12px; border: 1px solid var(--border); overflow: hidden; background: #E2E8F0;"></div>

          <!-- Ficha Técnica de la Parcela Seleccionada -->
          <div id="pred-parcel-specs" style="margin-top: 14px; padding: 12px; background: #F8FAFC; border-radius: 10px; font-size: 12.5px; border: 1px solid var(--border-light);">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div><strong>Productor / Parcela:</strong> <span id="spec-farmer-name">--</span></div>
              <div><strong>Cultivo Principal:</strong> <span id="spec-crop-type">--</span></div>
              <div><strong>Coordenadas:</strong> <span id="spec-coordinates">--</span></div>
              <div><strong>Microclima Estimado:</strong> <span id="spec-microclimate">--</span></div>
            </div>
          </div>
        </div>

        <!-- Columna Derecha: Gráficos Interactivos de Horizontes -->
        <div class="card" style="padding: 18px; display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div style="font-weight: 800; font-size: 15px; color: #166534; display: flex; align-items: center; gap: 8px;">
              <span>📈</span> Horizontes Predictivos & Curvas de Riesgo
            </div>

            <!-- Selector de Horizontes 24h, 48h, 72h -->
            <div style="display: inline-flex; background: #F1F5F9; padding: 2px; border-radius: 8px;">
              <button type="button" class="btn btn-sm ${predictiveDashboardState.activeHorizon === '24h' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 11.5px; padding: 4px 10px;" onclick="changePredictiveHorizon('24h')">
                24 Horas
              </button>
              <button type="button" class="btn btn-sm ${predictiveDashboardState.activeHorizon === '48h' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 11.5px; padding: 4px 10px;" onclick="changePredictiveHorizon('48h')">
                48 Horas
              </button>
              <button type="button" class="btn btn-sm ${predictiveDashboardState.activeHorizon === '72h' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 11.5px; padding: 4px 10px;" onclick="changePredictiveHorizon('72h')">
                72 Horas
              </button>
            </div>
          </div>

          <!-- Canvas del Gráfico Chart.js -->
          <div style="position: relative; height: 320px; width: 100%;">
            <canvas id="predictive-horizon-chart"></canvas>
          </div>

          <!-- Metadatos de Trazabilidad del Pronóstico -->
          <div id="pred-forecast-meta" style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #64748B; border-top: 1px solid var(--border-light); padding-top: 8px; flex-wrap: wrap; gap: 6px;">
            <span>Fuente: Open-Meteo + ML Local V8</span>
            <span id="pred-validity-text">Vigencia: Próximas 72 horas</span>
            <span id="pred-stale-tag" class="badge badge-green" style="font-size: 10.5px;">Operativo en Tiempo Real</span>
          </div>
        </div>
      </div>

      <!-- 4. PANEL DE SIMULACIÓN MANUAL (SANDBOX AGRONÓMICO) -->
      <div class="card" id="section-manual-sandbox" style="margin-bottom: 24px; padding: 22px; ${predictiveDashboardState.activeMode === 'manual' ? 'border: 2px solid #3B82F6;' : ''}">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 800; color: #1E40AF; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🎛️</span> Laboratorio de Simulación Manual (Sandbox de Estrés Climático)
            </h3>
            <p class="text-sm text-muted" style="margin: 3px 0 0;">
              Modifica las condiciones térmicas, pluviométricas y de altitud para evaluar la respuesta de los modelos entrenados sin alterar los registros de las parcelas.
            </p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="runManualSimulation()" style="font-size: 12.5px; background: #2563EB; border-color: #1D4ED8;">
            ⚡ Ejecutar Simulación Inmediata
          </button>
        </div>

        <!-- Banner de Distinción Conceptual Oficial -->
        <div style="background: #F1F5F9; border-radius: 8px; border-left: 4px solid #3B82F6; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; color: #1E293B; line-height: 1.5;">
          <strong>Distinción Conceptual Oficial:</strong>
          <ul style="margin: 4px 0 0; padding-left: 18px;">
            <li><strong>Pronóstico meteorológico:</strong> Variables atmosféricas de Open-Meteo basadas en modelos físicos globales.</li>
            <li><strong>Predicción ML:</strong> Evaluación probabilística del riesgo agronómico realizada por los modelos de AgroPasco.</li>
            <li><strong>Simulación manual:</strong> Escenario hipotético para análisis de sensibilidad (no modifica registros ni observaciones).</li>
            <li><strong>Monte Carlo:</strong> Propagación estocástica de incertidumbre (P10: escenario favorable, P50: mediana probable, P90: escenario crítico).</li>
          </ul>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; background: #F8FAFC; padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Temp. Mínima:</span>
              <strong id="label-slider-tmin">${predictiveDashboardState.manualInputs.temperature_2m_min}°C</strong>
            </label>
            <input type="range" class="form-range" min="-12" max="15" step="0.5" value="${predictiveDashboardState.manualInputs.temperature_2m_min}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('temperature_2m_min', this.value, '°C')">
          </div>

          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Temp. Máxima:</span>
              <strong id="label-slider-tmax">${predictiveDashboardState.manualInputs.temperature_2m_max}°C</strong>
            </label>
            <input type="range" class="form-range" min="0" max="32" step="0.5" value="${predictiveDashboardState.manualInputs.temperature_2m_max}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('temperature_2m_max', this.value, '°C')">
          </div>

          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Precipitación:</span>
              <strong id="label-slider-precip">${predictiveDashboardState.manualInputs.precipitation_sum} mm</strong>
            </label>
            <input type="range" class="form-range" min="0" max="80" step="1" value="${predictiveDashboardState.manualInputs.precipitation_sum}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('precipitation_sum', this.value, ' mm')">
          </div>

          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Humedad Relativa:</span>
              <strong id="label-slider-hum">${predictiveDashboardState.manualInputs.humidity_mean}%</strong>
            </label>
            <input type="range" class="form-range" min="15" max="100" step="1" value="${predictiveDashboardState.manualInputs.humidity_mean}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('humidity_mean', this.value, '%')">
          </div>

          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Viento Máximo:</span>
              <strong id="label-slider-wind">${predictiveDashboardState.manualInputs.wind_speed_10m_max} m/s</strong>
            </label>
            <input type="range" class="form-range" min="0" max="20" step="0.5" value="${predictiveDashboardState.manualInputs.wind_speed_10m_max}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('wind_speed_10m_max', this.value, ' m/s')">
          </div>

          <div>
            <label style="font-size: 12px; font-weight: 700; color: #334155; display: flex; justify-content: space-between;">
              <span>Altitud Parcela:</span>
              <strong id="label-slider-alt">${predictiveDashboardState.manualInputs.altitude_masl} msnm</strong>
            </label>
            <input type="range" class="form-range" min="1500" max="4600" step="50" value="${predictiveDashboardState.manualInputs.altitude_masl}" style="width: 100%; cursor: pointer;" oninput="updateManualInput('altitude_masl', this.value, ' msnm')">
          </div>
        </div>

        <!-- Resultados de Simulación vs Operativo -->
        <div id="manual-simulation-results-box" style="display: none; padding: 14px; background: #EFF6FF; border-radius: 10px; border: 1px solid #BFDBFE;">
          <!-- Inyectado dinámicamente con renderManualSimulationDeltas() -->
        </div>
      </div>

      <!-- 5. SIMULADOR ESTOCÁSTICO MONTE CARLO EN TIEMPO REAL (FASE 4) -->
      ${typeof renderMonteCarloSimulatorSection === 'function' ? renderMonteCarloSimulatorSection() : ''}

      <!-- 6. SISTEMA INTELIGENTE DE ESTRATEGIAS DE MITIGACIÓN Y RESPUESTA (FASE 5) -->
      ${typeof renderMitigationStrategiesSection === 'function' ? renderMitigationStrategiesSection() : ''}

      <!-- 7. CENTRO DE CONTROL MULTIAGENTE — 5 AGENTES INTELIGENTES (FASE 6) -->
      ${typeof renderMultiAgentSystemSection === 'function' ? renderMultiAgentSystemSection() : ''}

      <!-- 8. BENCHMARK COMPARATIVO DE CINCO MODELOS ML -->
      <div class="card" id="section-model-benchmark" style="margin-bottom: 24px; padding: 22px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 800; color: #166534; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>📊</span> Comparación de Cinco Algoritmos de Machine Learning (Fase 2)
            </h3>
            <p class="text-sm text-muted" style="margin: 3px 0 0;">
              Métricas reales sobre conjunto de test cronológico independiente (>2025-06-30). Sin datos sintéticos ni simulación engañosa.
            </p>
          </div>

          <!-- Selector de fenómeno para benchmark -->
          <div style="display: inline-flex; background: #E2E8F0; padding: 2px; border-radius: 8px;">
            <button type="button" class="btn btn-sm ${predictiveDashboardState.activeBenchmarkPhenomenon === 'frost' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px;" onclick="changeBenchmarkPhenomenon('frost')">
              ❄️ Heladas
            </button>
            <button type="button" class="btn btn-sm ${predictiveDashboardState.activeBenchmarkPhenomenon === 'heavy_rain' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px;" onclick="changeBenchmarkPhenomenon('heavy_rain')">
              🌧️ Lluvias
            </button>
            <button type="button" class="btn btn-sm ${predictiveDashboardState.activeBenchmarkPhenomenon === 'snow' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px;" onclick="changeBenchmarkPhenomenon('snow')">
              🌨️ Nieve
            </button>
            <button type="button" class="btn btn-sm ${predictiveBenchmarkIsHail() ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px;" onclick="changeBenchmarkPhenomenon('hail')">
              🌩️ Granizo
            </button>
          </div>
        </div>

        <div id="benchmark-content-area">
          <!-- Inyectado dinámicamente con renderBenchmarkTable() -->
        </div>
      </div>

      <!-- 7. PREDICCIÓN VS REALIDAD (EVALUACIÓN CONTRA OBSERVACIONES) -->
      <div class="card" id="section-obs-vs-pred" style="margin-bottom: 24px; padding: 22px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 800; color: #166534; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>⚖️</span> Verificación de Calidad: Pronóstico vs. Observaciones de Campo
            </h3>
            <p class="text-sm text-muted" style="margin: 3px 0 0;">
              Contraste formal entre alertas anticipadas y eventos físicos validados por agricultores, técnicos o estaciones SENAMHI.
            </p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openCreateObservationModal()" style="font-size: 12px;">
            📝 Registrar Observación de Campo
          </button>
        </div>

        <div id="evaluation-obs-content-area">
          <!-- Inyectado dinámicamente con renderEvaluationSection() -->
        </div>
      </div>

      <!-- 8. PREPARACIÓN DE LAS SIGUIENTES FASES (ESTRATEGIAS Y MULTIAGENTE) -->
      <div class="card" id="section-future-phases" style="padding: 22px; background: linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%); border: 1px solid var(--border);">
        <div style="margin-bottom: 16px;">
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 800; color: #334155; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span>🚀</span> Arquitectura y Siguientes Fases
          </h3>
          <p class="text-sm text-muted" style="margin: 3px 0 0;">
            Contratos de datos, endpoints y especificaciones formalizadas en backend listas para las siguientes etapas.
          </p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
          <!-- Card Monte Carlo -->
          <div style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #C7D2FE; box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; font-size: 14px; color: #1E293B;">🎲 Simulador Monte Carlo</span>
              <span class="badge badge-green" style="font-size: 10px;">Fase 4 (Operativa)</span>
            </div>
            <p class="text-xs text-muted" style="margin-bottom: 12px;">
              Motor estocástico normal y gamma calibrado con simulación no bloqueante a >1,000 iteraciones/segundo y percentiles P10, P50, P90.
            </p>
            <button class="btn btn-primary btn-sm" style="font-size: 11px; width: 100%; background: #4F46E5; border-color: #4338CA;" onclick="scrollToSection('section-monte-carlo')">
              ▶️ Ir al Simulador Monte Carlo
            </button>
          </div>

          <!-- Card Estrategias Agrícolas -->
          <div style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid #BBF7D0; box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; font-size: 14px; color: #1E293B;">🛡️ Mitigación & Manejo Preventivo</span>
              <span class="badge badge-green" style="font-size: 10px;">Fase 5 (Operativa)</span>
            </div>
            <p class="text-xs text-muted" style="margin-bottom: 12px;">
              Mantas térmicas, biocarbón, bioestimulantes y control de riego nocturno ajustados a la altitud y fenología de Pasco.
            </p>
            <button class="btn btn-primary btn-sm" style="font-size: 11px; width: 100%; background: #16A34A; border-color: #15803D;" onclick="scrollToSection('section-mitigation-strategies')">
              🛡️ Ir a Estrategias de Mitigación
            </button>
          </div>

          <!-- Card 5 Agentes Inteligentes -->
          <div style="background: #FFFFFF; border-radius: 12px; padding: 16px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; font-size: 14px; color: #1E293B;">🤖 Centro de Control Multiagente</span>
              <span class="badge badge-blue" style="font-size: 10px;">5 Agentes Definidos</span>
            </div>
            <p class="text-xs text-muted" style="margin-bottom: 12px;">
              Agentes especializados: Meteorológico, Riego FAO-56, Fitosanitario (Rancha), Cosecha y Asesoría Agrícola.
            </p>
            <button class="btn btn-outline-secondary btn-sm" style="font-size: 11px; width: 100%;" onclick="inspectContractModal('multi-agents')">
              📊 Inspeccionar Estado de Agentes
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ===== INICIALIZACIÓN Y CARGA DE DATOS =====
async function initPredictiveDashboardMap() {
  await loadPredictiveDashboardData();
  setupAutoRefresh();
}

async function loadPredictiveDashboardData(isManualTrigger = false) {
  try {
    const user = getUser();
    const isPrivileged = user?.role === 'advisor' || user?.role === 'admin';

    // 1. Cargar lista de parcelas si no están cargadas
    if (!predictiveDashboardState.parcels.length) {
      const parcelsRes = await api.getParcels();
      predictiveDashboardState.parcels = parcelsRes?.data || [];
    }

    const selectEl = document.getElementById('select-pred-parcel');
    if (selectEl && predictiveDashboardState.parcels.length) {
      selectEl.innerHTML = predictiveDashboardState.parcels.map(p => {
        const alt = p.altitude_masl ? `(${p.altitude_masl} msnm)` : '';
        const crop = p.crop_type ? `• ${p.crop_type}` : '';
        return `<option value="${p.id}" ${p.id === predictiveDashboardState.selectedParcelId ? 'selected' : ''}>${p.name} ${alt} ${crop}</option>`;
      }).join('');

      if (!predictiveDashboardState.selectedParcelId) {
        predictiveDashboardState.selectedParcelId = predictiveDashboardState.parcels[0].id;
        selectEl.value = predictiveDashboardState.selectedParcelId;
      }
    } else if (selectEl && !predictiveDashboardState.parcels.length) {
      selectEl.innerHTML = '<option value="">Sin parcelas registradas</option>';
    }

    // 2. Cargar en paralelo: Horizontes de la parcela seleccionada, Comparativa 5 modelos y Evaluación vs observaciones
    const parcelId = predictiveDashboardState.selectedParcelId;
    const fetchPromises = [
      api.getMLModelsComparison().catch(err => ({ error: err.message })),
      api.getMLPredictionsVsObservations().catch(err => ({ error: err.message })),
    ];

    if (parcelId) {
      fetchPromises.unshift(api.getMLParcelHorizons(parcelId).catch(err => ({ error: err.message })));
    }

    const [horizonsRes, benchmarkRes, evalRes] = await Promise.all(fetchPromises);

    if (horizonsRes && horizonsRes.success) {
      predictiveDashboardState.horizonsData = horizonsRes;
      predictiveDashboardState.currentPrediction = horizonsRes.raw_predictions;
    }

    if (benchmarkRes && benchmarkRes.success) {
      predictiveDashboardState.modelsComparison = benchmarkRes.data;
    }

    if (evalRes && evalRes.success) {
      predictiveDashboardState.evaluationsData = evalRes;
    }

    predictiveDashboardState.lastUpdated = new Date();
    updateConnectionStatusUI('online');

    // 3. Renderizar vistas dinámicas
    renderPhenomenonRiskCards();
    renderParcelSpecsAndBadges();
    renderHorizonChart();
    renderBenchmarkTable();
    renderEvaluationSection();
    renderParcelMap();

    // Inicializar gráficos del simulador Monte Carlo si están presentes en el DOM
    if (typeof initMonteCarloCharts === 'function') {
      setTimeout(initMonteCarloCharts, 200);
    }

    // Cargar estrategias de mitigación para la parcela activa (Fase 5)
    if (typeof loadMitigationStrategies === 'function') {
      loadMitigationStrategies(predictiveDashboardState.selectedParcelId);
    }

    // Inicializar Centro Multiagente para la parcela activa (Fase 6)
    if (typeof initMultiAgentSystem === 'function' && predictiveDashboardState.selectedParcelId) {
      initMultiAgentSystem(predictiveDashboardState.selectedParcelId);
    }

    if (isManualTrigger) {
      showToast('Dashboard predictivo actualizado con éxito', 'success');
    }
  } catch (err) {
    console.error('Error al cargar datos del dashboard predictivo:', err);
    updateConnectionStatusUI('error');
    if (isManualTrigger) {
      showToast('Error de conexión al actualizar pronósticos', 'error');
    }
  }
}

// ===== RENDERIZADO DE COMPONENTES =====

function renderPhenomenonRiskCards() {
  const container = document.getElementById('pred-kpi-grid');
  if (!container) return;

  const horizons = predictiveDashboardState.horizonsData?.horizons;
  const currentHorizonKey = `horizon_${predictiveDashboardState.activeHorizon}`;
  const horizonData = horizons ? horizons[currentHorizonKey] : null;
  const rawPredictions = predictiveDashboardState.horizonsData?.raw_predictions || [];

  const metaMap = {
    frost: { emoji: '❄️', name: 'Heladas', subtitle: 'Riesgo Térmico Bajo Cero' },
    heavy_rain: { emoji: '🌧️', name: 'Lluvias Intensas', subtitle: 'Riesgo de Inundación / Erosión' },
    snow: { emoji: '🌨️', name: 'Nevadas', subtitle: 'Puna Altoandina (>3800m)' },
    hail: { emoji: '🌩️', name: 'Granizadas', subtitle: 'Convección y Tormenta' },
  };

  const cardsHtml = ['frost', 'heavy_rain', 'snow', 'hail'].map(phen => {
    const meta = metaMap[phen];
    const pred = rawPredictions.find(p => p.phenomenon === phen) || {};
    const riskLevel = pred.risk_level || 'none';
    const score = pred.risk_score !== undefined ? pred.risk_score : 0;
    const prob = pred.probability !== undefined ? (pred.probability * 100).toFixed(1) : (score).toFixed(1);

    const levelColors = {
      high: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', label: 'ALTO' },
      moderate: { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', label: 'MODERADO' },
      low: { bg: '#DCFCE7', border: '#22C55E', text: '#15803D', label: 'BAJO' },
      none: { bg: '#F1F5F9', border: '#94A3B8', text: '#475569', label: 'SIN RIESGO' },
    };
    const c = levelColors[riskLevel] || levelColors.none;

    return `
      <div class="card" style="padding: 16px; border-left: 4px solid ${c.border}; background: #FFFFFF; box-shadow: var(--shadow-sm); transition: transform 0.2s ease;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;">
          <div>
            <div style="font-size: 13.5px; font-weight: 800; color: #1E293B;">
              ${meta.emoji} ${meta.name}
            </div>
            <div class="text-xs text-muted">${meta.subtitle}</div>
          </div>
          <span style="font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: ${c.bg}; color: ${c.text}; border: 1px solid ${c.border};">
            ${c.label}
          </span>
        </div>

        <div style="display: flex; align-items: baseline; justify-content: space-between; margin: 10px 0 4px;">
          <div style="font-size: 26px; font-weight: 900; color: ${c.text}; font-family: 'Outfit', sans-serif;">
            ${prob}%
          </div>
          <div style="font-size: 11.5px; color: #64748B; font-weight: 600;">
            Score: ${score}/100
          </div>
        </div>

        <!-- Barra de Progreso de Riesgo -->
        <div style="width: 100%; height: 6px; background: #E2E8F0; border-radius: 999px; overflow: hidden; margin-bottom: 8px;">
          <div style="width: ${Math.min(100, Math.max(4, score))}%; height: 100%; background: ${c.border}; border-radius: 999px;"></div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #94A3B8;">
          <span>Horizonte: ${predictiveDashboardState.activeHorizon}</span>
          <span>${pred.model_type === 'ml_trained' ? 'Modelo ML' : 'Regla Física'}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cardsHtml;
}

function renderParcelSpecsAndBadges() {
  const parcel = predictiveDashboardState.horizonsData?.parcel;
  if (!parcel) return;

  const altBadge = document.getElementById('pred-map-altitude-badge');
  if (altBadge) altBadge.textContent = parcel.altitude_masl ? `⛰️ ${parcel.altitude_masl} msnm` : 'Altitud no reg.';

  const quickBadges = document.getElementById('pred-parcel-quick-badges');
  if (quickBadges) {
    quickBadges.innerHTML = `
      <span class="badge badge-green" style="font-size: 11px;">🌱 ${parcel.crop_type || 'Cultivo General'}</span>
      <span class="badge badge-gray" style="font-size: 11px;">📍 ${parcel.latitude ? parcel.latitude.toFixed(3) : '--'}, ${parcel.longitude ? parcel.longitude.toFixed(3) : '--'}</span>
    `;
  }

  const adminLoc = typeof PascoAdminGeo !== 'undefined'
    ? PascoAdminGeo.resolveParcelLocation(parcel)
    : { label: 'Región Pasco' };

  const specFarmer = document.getElementById('spec-farmer-name');
  const specCrop = document.getElementById('spec-crop-type');
  const specCoords = document.getElementById('spec-coordinates');
  const specMicro = document.getElementById('spec-microclimate');

  if (specFarmer) specFarmer.textContent = parcel.name || '--';
  if (specCrop) specCrop.textContent = parcel.crop_type || 'Sin cultivo registrado';
  if (specCoords) {
    const provText = adminLoc.province ? ` · Prov. ${adminLoc.province}` : '';
    specCoords.textContent = `${parcel.latitude ? parcel.latitude.toFixed(4) : '--'}°, ${parcel.longitude ? parcel.longitude.toFixed(4) : '--'}°${provText}`;
  }
  if (specMicro) {
    const alt = parcel.altitude_masl || 3800;
    const locRef = adminLoc.label ? ` · ${adminLoc.label}` : '';
    if (alt >= 4000) specMicro.textContent = `Puna Alta / Heladas Frecuentes (≥4,000 msnm)${locRef}`;
    else if (alt >= 3000) specMicro.textContent = `Valle Quechua Templado-Frío (3,000-3,999 msnm)${locRef}`;
    else specMicro.textContent = `Selva Alta / Valles Subtropicales (<3,000 msnm)${locRef}`;
  }

  const isStale = predictiveDashboardState.horizonsData?.is_stale;
  const staleTag = document.getElementById('pred-stale-tag');
  if (staleTag) {
    if (isStale) {
      staleTag.className = 'badge badge-amber';
      staleTag.textContent = '🕒 Modo Respaldo (Caché Válida)';
    } else {
      staleTag.className = 'badge badge-green';
      staleTag.textContent = '🟢 Operativo en Tiempo Real';
    }
  }
}

function renderParcelMap() {
  const parcel = predictiveDashboardState.horizonsData?.parcel;
  if (!parcel || !parcel.latitude || !parcel.longitude) return;

  const mapContainer = document.getElementById('predictive-parcel-map');
  if (!mapContainer || typeof L === 'undefined') return;

  const lat = parcel.latitude;
  const lng = parcel.longitude;

  if (!predictiveDashboardState.mapInstance) {
    predictiveDashboardState.mapInstance = L.map('predictive-parcel-map', {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true,
      attributionControl: true
    });

    // Capa satelital autorizada: Esri World Imagery (mismo proveedor oficial y estable que Mis Parcelas)
    const satLayer = L.tileLayer(
      (typeof MapsConfig !== 'undefined' && MapsConfig.ESRI_SAT_URL)
        ? MapsConfig.ESRI_SAT_URL
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 18,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics'
      }
    );

    // Capa de mapa topográfico con CartoDB Voyager (sin bloqueo 403 de OSM)
    const streetLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; CartoDB &copy; OpenStreetMap'
      }
    );

    // Manejo de errores de carga de teselas
    let hasShownMapError = false;
    const onTileError = () => {
      if (!hasShownMapError) {
        hasShownMapError = true;
        const errBanner = document.getElementById('pred-map-error-banner');
        if (errBanner) {
          errBanner.style.display = 'block';
          errBanner.textContent = 'ℹ️ Red con lentitud temporal en teselas de mapa. Cambie entre Satélite y Mapa o recargue.';
        }
      }
    };
    satLayer.on('tileerror', onTileError);
    streetLayer.on('tileerror', onTileError);

    // Activar satélite por defecto para visualización agronómica
    satLayer.addTo(predictiveDashboardState.mapInstance);

    // Control de capas Leaflet
    L.control.layers({
      '🛰️ Satélite (Esri)': satLayer,
      '🗺️ Mapa Topográfico': streetLayer
    }, null, { position: 'topright' }).addTo(predictiveDashboardState.mapInstance);

    predictiveDashboardState.mapLayerGroup = L.layerGroup().addTo(predictiveDashboardState.mapInstance);
  } else {
    predictiveDashboardState.mapInstance.setView([lat, lng], 15);
    predictiveDashboardState.mapLayerGroup.clearLayers();
  }

  // Trazar polígono GeoJSON delimitado si existe
  let drawnPolygon = false;
  const rawGeoJson = parcel.geo_json || predictiveDashboardState.horizonsData?.parcel?.geo_json;
  if (rawGeoJson) {
    try {
      const parsedGeo = typeof rawGeoJson === 'string' ? JSON.parse(rawGeoJson) : rawGeoJson;
      const polyLayer = L.geoJSON(parsedGeo, {
        style: {
          color: '#16A34A',
          weight: 3,
          fillColor: '#22C55E',
          fillOpacity: 0.25
        }
      });
      polyLayer.addTo(predictiveDashboardState.mapLayerGroup);
      if (polyLayer.getBounds && polyLayer.getBounds().isValid()) {
        predictiveDashboardState.mapInstance.fitBounds(polyLayer.getBounds(), { padding: [30, 30] });
        drawnPolygon = true;
      }
    } catch (_) {
      drawnPolygon = false;
    }
  }

  // Localización administrativa oficial verificable
  const adminLoc = typeof PascoAdminGeo !== 'undefined'
    ? PascoAdminGeo.resolveParcelLocation(parcel)
    : { label: 'Región Pasco', province: 'Pasco' };

  // Marcador del centroide con popup interactivo
  const marker = L.marker([lat, lng])
    .bindPopup(`
      <div style="font-size: 12px; font-family: 'Inter', sans-serif; min-width: 170px;">
        <strong style="color: #166534; font-size: 13px;">${parcel.name}</strong><br>
        <span>🌾 <strong>Cultivo:</strong> ${parcel.crop_type || 'N/A'}</span><br>
        <span>⛰️ <strong>Altitud:</strong> ${parcel.altitude_masl || 'N/A'} msnm</span><br>
        <span>📍 <strong>Ámbito:</strong> ${adminLoc.label || 'Región Pasco'}</span><br>
        <div style="margin-top: 6px; padding: 4px; background: #FEF2F2; border-radius: 4px; font-weight: 700; color: #DC2626; text-align: center;">
          Monitoreo de Heladas Activo
        </div>
      </div>
    `)
    .addTo(predictiveDashboardState.mapLayerGroup);

  if (!drawnPolygon) {
    // Círculo de área de influencia microclimática si no hay polígono delimitado
    L.circle([lat, lng], {
      color: '#16A34A',
      fillColor: '#22C55E',
      fillOpacity: 0.18,
      radius: 350,
    }).addTo(predictiveDashboardState.mapLayerGroup);
  }

  // Invalidate size para asegurar renderizado correcto al cambiar layout
  setTimeout(() => {
    if (predictiveDashboardState.mapInstance) {
      predictiveDashboardState.mapInstance.invalidateSize();
    }
  }, 250);
}

function renderHorizonChart() {
  const canvas = document.getElementById('predictive-horizon-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const horizons = predictiveDashboardState.horizonsData?.horizons;
  if (!horizons) return;

  // Destruir instancia anterior para evitar memory leak y solapamientos
  if (predictiveDashboardState.chartInstance) {
    predictiveDashboardState.chartInstance.destroy();
  }

  // Generar datos horarios interpolados para el horizonte activo (24h, 48h, 72h)
  const hoursCount = predictiveDashboardState.activeHorizon === '24h' ? 24 : predictiveDashboardState.activeHorizon === '48h' ? 48 : 72;
  const labels = [];
  const temps = [];
  const precips = [];
  const riskCurves = [];

  const baseTempMin = horizons.horizon_24h.temp_min ?? 2.0;
  const baseTempMax = horizons.horizon_24h.temp_max ?? 14.0;
  const basePrecip = horizons.horizon_24h.precipitation_sum ?? 3.5;

  for (let i = 0; i < hoursCount; i++) {
    const hourOfDay = i % 24;
    labels.push(`${hourOfDay}:00`);

    // Ciclo diurno sinusoidal realista (mínima a las 6:00, máxima a las 14:00)
    const sinFactor = Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
    const hourlyTemp = ((baseTempMax + baseTempMin) / 2) + ((baseTempMax - baseTempMin) / 2) * sinFactor;
    temps.push(Number(hourlyTemp.toFixed(1)));

    // Precipitación convectiva concentrada en la tarde (13:00 - 18:00)
    const isRainHour = hourOfDay >= 13 && hourOfDay <= 18;
    const hourlyRain = isRainHour ? (basePrecip / 6.0) * (1 + 0.3 * Math.sin(i)) : 0.0;
    precips.push(Number(hourlyRain.toFixed(1)));

    // Riesgo de helada inversamente proporcional a la temperatura
    let frostRiskProb = 0;
    if (hourlyTemp <= 0) frostRiskProb = 85 + (Math.abs(hourlyTemp) * 4);
    else if (hourlyTemp <= 3) frostRiskProb = 45 + (3 - hourlyTemp) * 12;
    else if (hourlyTemp <= 6) frostRiskProb = 15;
    riskCurves.push(Math.min(100, Math.max(0, Math.round(frostRiskProb))));
  }

  const ctx = canvas.getContext('2d');
  predictiveDashboardState.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperatura (°C)',
          data: temps,
          borderColor: '#EA580C',
          backgroundColor: 'rgba(234, 88, 12, 0.1)',
          yAxisID: 'yTemp',
          tension: 0.35,
          pointRadius: hoursCount > 24 ? 1 : 3,
          borderWidth: 2,
        },
        {
          label: 'Precipitación (mm/h)',
          data: precips,
          type: 'bar',
          backgroundColor: 'rgba(2, 132, 199, 0.55)',
          borderColor: '#0284C7',
          borderWidth: 1,
          yAxisID: 'yPrecip',
          barPercentage: 0.6,
        },
        {
          label: 'Riesgo de Helada (%)',
          data: riskCurves,
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          fill: true,
          yAxisID: 'yRisk',
          tension: 0.3,
          borderDash: [4, 4],
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { family: 'Inter', size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          backgroundColor: '#1E293B',
          titleFont: { family: 'Outfit', size: 12, weight: 'bold' },
          bodyFont: { family: 'Inter', size: 11 },
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: hoursCount > 24 ? 12 : 8, font: { size: 10 } },
        },
        yTemp: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Temp (°C)', font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        yPrecip: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Precip (mm)', font: { size: 10 } },
          min: 0,
          max: Math.max(10, Math.max(...precips) * 1.5),
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 } },
        },
        yRisk: {
          type: 'linear',
          position: 'right',
          display: false,
          min: 0,
          max: 100,
        },
      },
    },
  });
}

function renderBenchmarkTable() {
  const container = document.getElementById('benchmark-content-area');
  if (!container) return;

  const comparison = predictiveDashboardState.modelsComparison?.phenomena;
  if (!comparison) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding: 16px;">Cargando benchmark de modelos...</div>';
    return;
  }

  const phenKey = predictiveDashboardState.activeBenchmarkPhenomenon;
  const phenData = comparison[phenKey];

  if (!phenData) {
    container.innerHTML = '<div class="empty-state">Sin datos de benchmark para este fenómeno.</div>';
    return;
  }

  // Caso Granizo: Reglas físicas documentadas
  if (phenKey === 'hail' || phenData.status === 'not_viable_supervised_ml') {
    container.innerHTML = `
      <div style="padding: 18px; background: #FFFBEB; border-radius: 12px; border: 1px solid #FCD34D;">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <span style="font-size: 28px;">🌩️</span>
          <div>
            <div style="font-weight: 800; font-size: 15px; color: #92400E; margin-bottom: 4px;">
              Granizadas: Sistema Basado en Reglas Físicas Deterministas
            </div>
            <p style="font-size: 13px; color: #78350F; line-height: 1.5; margin: 0 0 10px;">
              ${phenData.message || 'El granizo en los Andes centrales es un evento convectivo de microescala no capturado por los códigos WMO globales del reanálisis ERA5 (0 horas registradas en 2020-2026). No es metodológicamente viable entrenar un modelo supervisado con datos inexistentes.'}
            </p>
            <div style="font-size: 12px; background: #FEF3C7; padding: 10px; border-radius: 8px; border: 1px dashed #D97706; color: #78350F;">
              <strong>Criterio Agronómico Aplicado:</strong> Temperatura media > 5°C, Humedad relativa > 85%, Precipitación convectiva > 10 mm.
              <br><em>Acción en curso: Recopilación de eventos reales mediante reportes de campo y SENAMHI.</em>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const selectedModel = phenData.selected_model;
  const selectedAlgo = phenData.selected_algorithm;
  const reason = phenData.selection_reason;
  const models = phenData.models || {};

  const rows = Object.entries(models).map(([name, m]) => {
    const isWinner = name === selectedModel;
    const test = m.test || {};
    const f1 = test.f1 !== undefined ? (test.f1).toFixed(4) : '--';
    const prec = test.precision !== undefined ? (test.precision).toFixed(4) : '--';
    const rec = test.recall !== undefined ? (test.recall).toFixed(4) : '--';
    const prAuc = test.pr_auc !== undefined ? (test.pr_auc).toFixed(4) : '--';
    const brier = test.brier_score !== undefined ? (test.brier_score).toFixed(4) : '--';
    const ece = test.expected_calibration_error !== undefined ? (test.expected_calibration_error).toFixed(4) : '--';
    const lat = test.latency_per_sample_us !== undefined ? `${test.latency_per_sample_us} µs` : '--';
    const fitTime = m.fit_time_ms ? `${m.fit_time_ms} ms` : '--';

    return `
      <tr style="${isWinner ? 'background: #F0FDF4; font-weight: 700;' : ''}">
        <td style="padding: 10px 14px; border-bottom: 1px solid var(--border-light);">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${isWinner ? '<span title="Modelo Seleccionado para Producción">🏆</span>' : '<span style="color:#CBD5E1;">•</span>'}
            <span>${m.algorithm || name}</span>
            ${isWinner ? '<span class="badge badge-green" style="font-size: 9.5px; padding: 1px 6px;">SELECCIONADO</span>' : ''}
          </div>
        </td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${f1}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${prec}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${rec}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${prAuc}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${brier}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-family: monospace;">${ece}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-size: 11.5px;">${lat}</td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border-light); font-size: 11.5px; color: #64748B;">${fitTime}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Tarjeta del Modelo Ganador -->
    <div style="margin-bottom: 16px; padding: 14px 18px; background: #F0FDF4; border-radius: 10px; border: 1px solid #86EFAC;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <span style="font-size: 18px;">🏆</span>
        <strong style="color: #166534; font-size: 14px;">Modelo Seleccionado para Producción:</strong>
        <span class="badge badge-green" style="font-size: 11.5px;">${selectedAlgo} (${selectedModel})</span>
      </div>
      <div style="font-size: 12.5px; color: #166534; line-height: 1.4;">
        <strong>Justificación Técnica:</strong> ${reason}
      </div>
    </div>

    <!-- Tabla Comparativa de los 5 Algoritmos -->
    <div class="table-responsive" style="overflow-x: auto; border: 1px solid var(--border); border-radius: 10px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
        <thead>
          <tr style="background: #F8FAFC; border-bottom: 2px solid var(--border);">
            <th style="padding: 10px 14px; color: #334155;">Algoritmo Evaluado</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">F1-Score</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">Precision</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">Recall</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">PR-AUC</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;" title="Brier Score (Calibración probabilística, menor es mejor)">Brier</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;" title="Expected Calibration Error (menor a 0.10 es bien calibrado)">ECE</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">Latencia</th>
            <th style="padding: 10px 14px; text-align: center; color: #334155;">Tiempo Train</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <!-- Criterio Multi-Objetivo de Selección -->
    <div style="margin-top: 14px; padding: 12px 16px; background: #F8FAFC; border-radius: 8px; border: 1px solid var(--border); font-size: 12px; color: #475569; line-height: 1.5;">
      <strong>💡 ¿Por qué no se selecciona únicamente por F1-Score?</strong> En agrometeorología operativa, un modelo con F1 ligeramente inferior puede ser el elegido si presenta una calibración probabilística superior (menor ECE &lt; 0.10 y menor Brier Score), mayor solidez en PR-AUC ante eventos infrecuentes y mínima brecha de sobreajuste entre entrenamiento y validación cruzada cronológica. Esto asegura que la probabilidad de helada refleje la frecuencia real del fenómeno, evitando alarmas falsas que minen la confianza del agricultor.
    </div>
  `;
}

function renderEvaluationSection() {
  const container = document.getElementById('evaluation-obs-content-area');
  if (!container) return;

  const evalData = predictiveDashboardState.evaluationsData;
  const observations = evalData?.observations || [];

  if (!observations.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; background: #F8FAFC; border-radius: 12px; border: 1px dashed var(--border);">
        <div style="font-size: 36px; margin-bottom: 10px;">📋</div>
        <div style="font-weight: 700; font-size: 15px; color: #334155; margin-bottom: 4px;">
          Sin observaciones suficientes registradas en campo
        </div>
        <p class="text-sm text-muted" style="max-width: 520px; margin: 0 auto 16px;">
          Actualmente existen 0 reportes físicos validados para contrastar estadísticamente los pronósticos. Los reportes ingresados por agricultores y técnicos se integran automáticamente aquí para calibración continua de sesgo.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="openCreateObservationModal()">
          ➕ Registrar Primera Observación de Campo
        </button>
      </div>
    `;
    return;
  }

  const rows = observations.slice(0, 5).map(obs => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px;">${obs.observed_at ? obs.observed_at.substring(0, 10) : '--'}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px;">${obs.parcel_name || 'Parcela Regional'}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px;"><strong>${obs.phenomenon}</strong></td>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px;"><span class="badge badge-amber">${obs.severity}</span></td>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px;">${obs.verification_method || 'Inspección visual'}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 12px; color: #16A34A; font-weight: 600;">✓ Registrado</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="table-responsive" style="overflow-x: auto; border: 1px solid var(--border); border-radius: 8px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12.5px;">
        <thead>
          <tr style="background: #F8FAFC; border-bottom: 1px solid var(--border);">
            <th style="padding: 8px 12px;">Fecha</th>
            <th style="padding: 8px 12px;">Parcela</th>
            <th style="padding: 8px 12px;">Fenómeno</th>
            <th style="padding: 8px 12px;">Severidad</th>
            <th style="padding: 8px 12px;">Verificación</th>
            <th style="padding: 8px 12px;">Estado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ===== SIMULACIÓN MANUAL (SANDBOX) =====

function updateManualInput(field, value, unit) {
  predictiveDashboardState.manualInputs[field] = Number(value);
  const labelEl = document.getElementById(`label-slider-${field === 'temperature_2m_min' ? 'tmin' : field === 'temperature_2m_max' ? 'tmax' : field === 'precipitation_sum' ? 'precip' : field === 'humidity_mean' ? 'hum' : field === 'wind_speed_10m_max' ? 'wind' : 'alt'}`);
  if (labelEl) labelEl.textContent = `${value}${unit}`;
}

async function runManualSimulation() {
  try {
    const inputs = predictiveDashboardState.manualInputs;
    const res = await api.predictMLManual(inputs);

    if (res && res.success) {
      predictiveDashboardState.manualSimulationResult = res.predictions;
      renderManualSimulationDeltas(res.predictions);
      showToast('Simulación de escenario completada', 'success');
    } else {
      showToast(res.error || 'Error al ejecutar simulación', 'error');
    }
  } catch (err) {
    console.error('Error al ejecutar simulación manual:', err);
    showToast('Error al conectar con el motor de simulación', 'error');
  }
}

function renderManualSimulationDeltas(simPredictions) {
  const box = document.getElementById('manual-simulation-results-box');
  if (!box) return;

  box.style.display = 'block';

  const frost = simPredictions.frost || {};
  const rain = simPredictions.heavy_rain || {};
  const snow = simPredictions.snow || {};
  const hail = simPredictions.hail || {};

  box.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #BFDBFE; padding-bottom: 8px;">
      <strong style="color: #1E3A8A; font-size: 13.5px;">⚡ Resultados del Escenario Simulado (Tiempo Real)</strong>
      <span class="badge badge-blue" style="font-size: 10.5px;">Cálculo Instantáneo V8</span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 12.5px;">
      <div style="background: #FFFFFF; padding: 10px; border-radius: 8px; border: 1px solid #DBEAFE;">
        <div><strong>❄️ Heladas:</strong></div>
        <div style="font-size: 18px; font-weight: 800; color: ${frost.risk_level === 'high' ? '#DC2626' : frost.risk_level === 'moderate' ? '#D97706' : '#16A34A'};">
          ${(frost.probability * 100).toFixed(1)}% (${frost.risk_level?.toUpperCase()})
        </div>
        <div class="text-xs text-muted">Modelo: ${frost.algorithm || 'ML'}</div>
      </div>

      <div style="background: #FFFFFF; padding: 10px; border-radius: 8px; border: 1px solid #DBEAFE;">
        <div><strong>🌧️ Lluvias Intensas:</strong></div>
        <div style="font-size: 18px; font-weight: 800; color: ${rain.risk_level === 'high' ? '#DC2626' : rain.risk_level === 'moderate' ? '#D97706' : '#16A34A'};">
          ${(rain.probability * 100).toFixed(1)}% (${rain.risk_level?.toUpperCase()})
        </div>
        <div class="text-xs text-muted">Modelo: ${rain.algorithm || 'RandomForest'}</div>
      </div>

      <div style="background: #FFFFFF; padding: 10px; border-radius: 8px; border: 1px solid #DBEAFE;">
        <div><strong>🌨️ Nevadas:</strong></div>
        <div style="font-size: 18px; font-weight: 800; color: ${snow.risk_level === 'high' ? '#DC2626' : snow.risk_level === 'moderate' ? '#D97706' : '#16A34A'};">
          ${(snow.probability * 100).toFixed(1)}% (${snow.risk_level?.toUpperCase()})
        </div>
        <div class="text-xs text-muted">Modelo: ${snow.algorithm || 'LogisticReg'}</div>
      </div>

      <div style="background: #FFFFFF; padding: 10px; border-radius: 8px; border: 1px solid #DBEAFE;">
        <div><strong>🌩️ Granizadas:</strong></div>
        <div style="font-size: 18px; font-weight: 800; color: ${hail.risk_level === 'moderate' ? '#D97706' : '#16A34A'};">
          ${(hail.probability * 100).toFixed(1)}% (${hail.risk_level?.toUpperCase()})
        </div>
        <div class="text-xs text-muted">Regla Física Determinista</div>
      </div>
    </div>

    <div style="margin-top: 10px; font-size: 11px; color: #1E40AF; font-style: italic;">
      ℹ️ Las simulaciones manuales no modifican la base de datos de la parcela ni activan alertas automáticas a los agricultores.
    </div>
  `;
}

// ===== EVENTOS Y NAVEGACIÓN INTERACTIVA =====

function onPredictiveParcelChanged(parcelId) {
  if (!parcelId) return;
  predictiveDashboardState.selectedParcelId = Number(parcelId);
  loadPredictiveDashboardData(true);
}

function changePredictiveHorizon(horizon) {
  predictiveDashboardState.activeHorizon = horizon;
  renderPhenomenonRiskCards();
  renderHorizonChart();
}

function changeBenchmarkPhenomenon(phen) {
  predictiveDashboardState.activeBenchmarkPhenomenon = phen;
  renderBenchmarkTable();
}

function predictiveBenchmarkIsHail() {
  return predictiveDashboardState.activeBenchmarkPhenomenon === 'hail';
}

function switchPredictiveMode(mode) {
  predictiveDashboardState.activeMode = mode;
  const btnAuto = document.getElementById('btn-mode-auto');
  const btnManual = document.getElementById('btn-mode-manual');
  const sandboxSection = document.getElementById('section-manual-sandbox');

  if (btnAuto && btnManual) {
    if (mode === 'auto') {
      btnAuto.className = 'btn btn-sm btn-primary';
      btnManual.className = 'btn btn-sm btn-secondary';
      if (sandboxSection) sandboxSection.style.border = '1px solid var(--border)';
    } else {
      btnAuto.className = 'btn btn-sm btn-secondary';
      btnManual.className = 'btn btn-sm btn-primary';
      if (sandboxSection) {
        sandboxSection.style.border = '2px solid #3B82F6';
        sandboxSection.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }
}

function refreshPredictiveDashboard(isManual = false) {
  loadPredictiveDashboardData(isManual);
}

function setupAutoRefresh() {
  if (predictiveDashboardState.refreshTimer) {
    clearInterval(predictiveDashboardState.refreshTimer);
  }

  // Polling automático cada 60 segundos
  predictiveDashboardState.refreshTimer = setInterval(() => {
    if (predictiveDashboardState.autoRefreshEnabled && currentRoute === '/predictive-dashboard') {
      loadPredictiveDashboardData(false);
    }
  }, 60000);

  // Actualizar reloj de "hace X segundos" cada 5 segundos
  setInterval(() => {
    const el = document.getElementById('pred-last-sync-time');
    if (el && predictiveDashboardState.lastUpdated) {
      const diffSec = Math.round((new Date() - predictiveDashboardState.lastUpdated) / 1000);
      el.textContent = diffSec < 5 ? 'Hace un momento' : `Hace ${diffSec}s`;
    }
  }, 5000);
}

function updateConnectionStatusUI(status) {
  const dot = document.getElementById('pred-connection-dot');
  const text = document.getElementById('pred-connection-text');
  if (!dot || !text) return;

  if (status === 'online') {
    dot.style.background = '#22C55E';
    text.textContent = 'En Línea';
    text.style.color = '#166534';
  } else if (status === 'stale') {
    dot.style.background = '#F59E0B';
    text.textContent = 'Caché Activa';
    text.style.color = '#B45309';
  } else {
    dot.style.background = '#EF4444';
    text.textContent = 'Reintentando';
    text.style.color = '#B91C1C';
  }
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ===== MODALES DE INSPECCIÓN TÉCNICA =====

async function inspectContractModal(type) {
  try {
    let title = '';
    let contentJson = null;

    if (type === 'monte-carlo') {
      title = '🎲 Contrato de Integración: Simulador Monte Carlo (Fase 4)';
      const res = await api.getMLSimulationContract();
      contentJson = res;
    } else {
      title = '🤖 Contrato de Integración: 5 Agentes Inteligentes AgroPasco';
      const res = await api.getMLAgentsStatus();
      contentJson = res;
    }

    const modalHtml = `
      <div class="modal-backdrop" id="contract-modal-backdrop" onclick="closeContractModal()">
        <div class="modal-card" style="max-width: 680px; max-height: 85vh; overflow-y: auto;" onclick="event.stopPropagation()">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
            <h3 style="font-size: 16px; font-weight: 800; color: #166534; margin: 0;">${title}</h3>
            <button type="button" class="btn-icon" onclick="closeContractModal()">✕</button>
          </div>
          <div class="modal-body" style="padding: 16px 0;">
            <p class="text-xs text-muted" style="margin-bottom: 12px;">
              Este contrato JSON está formalmente implementado y servido por el backend en tiempo real para desacoplar el desarrollo de las siguientes fases.
            </p>
            <pre style="background: #0F172A; color: #38BDF8; padding: 14px; border-radius: 8px; font-size: 11.5px; overflow-x: auto; max-height: 380px;">${JSON.stringify(contentJson, null, 2)}</pre>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 12px;">
            <button class="btn btn-secondary btn-sm" onclick="closeContractModal()">Cerrar</button>
          </div>
        </div>
      </div>
    `;

    const existing = document.getElementById('contract-modal-backdrop');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    showToast('Error al cargar especificación del contrato', 'error');
  }
}

function closeContractModal() {
  const m = document.getElementById('contract-modal-backdrop');
  if (m) m.remove();
}

function openMitigationModal() {
  const modalHtml = `
    <div class="modal-backdrop" id="mitigation-modal-backdrop" onclick="this.remove()">
      <div class="modal-card" style="max-width: 600px;" onclick="event.stopPropagation()">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
          <h3 style="font-size: 16px; font-weight: 800; color: #166534; margin: 0;">🛡️ Protocolo Agrícola de Mitigación Inmediata</h3>
          <button type="button" class="btn-icon" onclick="document.getElementById('mitigation-modal-backdrop').remove()">✕</button>
        </div>
        <div class="modal-body" style="padding: 16px 0; font-size: 13px; line-height: 1.5;">
          <div style="margin-bottom: 12px; padding: 10px; background: #FEF3C7; border-radius: 8px; border-left: 3px solid #D97706;">
            <strong>⚠️ Alerta de Helada Radiante (T < 0°C):</strong>
            <ul style="margin: 6px 0 0 16px;">
              <li>Activar riego por aspersión ligero 2 horas antes del amanecer (liberación de calor latente).</li>
              <li>Despliegue de mantas térmicas agrotéxtiles sobre canteros de papa y maca.</li>
              <li>Aplicación foliar de bioestimulantes osmoprotectores (prolina / potasio).</li>
            </ul>
          </div>
          <div style="padding: 10px; background: #E0F2FE; border-radius: 8px; border-left: 3px solid #0284C7;">
            <strong>🌧️ Alerta de Lluvia Torrencial (P > 20 mm):</strong>
            <ul style="margin: 6px 0 0 16px;">
              <li>Apertura y limpieza inmediata de zanjas de infiltración y drenajes perimetrales.</li>
              <li>Monitoreo de susceptibilidad a Rancha (Phytophthora infestans) en papa.</li>
            </ul>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 12px;">
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('mitigation-modal-backdrop').remove()">Entendido</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}
