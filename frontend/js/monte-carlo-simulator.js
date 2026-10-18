/**
 * AgroPasco Digital — Módulo de Simulación Monte Carlo en Tiempo Real (Fase 4)
 * ============================================================================
 * Motor estocástico interactivo en el navegador con ejecución no bloqueante,
 * actualización de gráficos a 60 FPS, cálculo de percentiles (P10, P50, P90),
 * histograma de frecuencias y curvas de convergencia probabilística.
 */

// ===== ESTADO GLOBAL DEL SIMULADOR MONTE CARLO =====
const monteCarloState = {
  isRunning: false,
  isPaused: false,
  currentIteration: 0,
  targetIterations: 1000,
  batchSize: 50,           // Iteraciones por tick
  timerId: null,
  startTime: null,
  elapsedMs: 0,
  seed: 42,
  prng: null,
  phenomenon: 'frost',     // 'frost', 'heavy_rain', 'snow', 'hail'
  horizon: '24h',          // '24h', '48h', '72h'
  mode: 'auto',            // 'auto' (usa pronóstico parcela), 'manual' (custom)
  useCorrelation: true,
  distributionType: 'calibrated_pasco', // Normal para temp, Gamma para lluvia
  params: {
    temperature_std: 1.8,
    precipitation_shape: 1.5,
    precipitation_scale: 2.2,
  },
  baseline: {
    temperature_2m_min: 1.8,
    temperature_2m_max: 13.5,
    precipitation_sum: 3.5,
    humidity_mean: 68.0,
    wind_speed_10m_max: 3.5,
    altitude_masl: 4380,
    month: 7,
    day_of_year: 195,
    is_winter: 1,
    is_dry_season: 1,
  },
  baselinePrediction: null,
  samples: [],             // { prob, score, level }
  probabilities: [],       // Float array for percentile sorting
  scores: [],
  levelCounts: { none: 0, low: 0, moderate: 0, high: 0 },
  convergenceHistory: [],  // { iteration, mean, p10, p90 }
  chartHistogram: null,
  chartConvergence: null,
  chartBreakdown: null,
};

// PRNG Mulberry32 para cliente
class ClientMulberry32 {
  constructor(seed = 42) {
    this.seed = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ===== MOTOR ESTOCÁSTICO EN CLIENTE =====

function initMonteCarloPrng(seed) {
  monteCarloState.seed = Number(seed) || 42;
  monteCarloState.prng = new ClientMulberry32(monteCarloState.seed);
}

function mcRandomUniform() {
  if (!monteCarloState.prng) initMonteCarloPrng(monteCarloState.seed);
  let u = monteCarloState.prng.next();
  return u === 0 ? 1e-10 : u;
}

function mcRandomNormal(mean = 0, stdDev = 1) {
  const u1 = mcRandomUniform();
  const u2 = mcRandomUniform();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + stdDev * z0;
}

function mcRandomGamma(shape, scale = 1.0) {
  if (shape <= 0 || scale <= 0) return 0.0;
  if (shape < 1.0) {
    const u = mcRandomUniform();
    return mcRandomGamma(shape + 1.0, scale) * Math.pow(u, 1.0 / shape);
  }
  const d = shape - 1.0 / 3.0;
  const c = 1.0 / Math.sqrt(9.0 * d);
  while (true) {
    const u1 = mcRandomUniform();
    const u2 = mcRandomUniform();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const v = 1.0 + c * z;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = mcRandomUniform();
    if (u < 1.0 - 0.0331 * z * z * z * z) return d * v3 * scale;
    if (Math.log(u) < 0.5 * z * z + d * (1.0 - v3 + Math.log(v3))) return d * v3 * scale;
  }
}

// Inferencia simplificada en cliente compatible con los pesos y umbrales ML
function mcEvaluateScenario(scenario, phenomenon) {
  const tMin = scenario.temperature_2m_min;
  const tMax = scenario.temperature_2m_max;
  const precip = scenario.precipitation_sum;
  const hum = scenario.humidity_mean;
  const alt = scenario.elevation || 4000;

  if (phenomenon === 'frost') {
    // Modelo logístico de heladas calibrado con altitud de Pasco
    const z = -1.65 - (1.15 * tMin) + (0.0018 * (alt - 3500)) - (0.012 * hum);
    const prob = 1.0 / (1.0 + Math.exp(-z));
    const score = Math.round(prob * 100);
    const level = score >= 60 ? 'high' : score >= 30 ? 'moderate' : score >= 10 ? 'low' : 'none';
    return { probability: prob, risk_score: score, risk_level: level, model_type: 'ml_trained' };
  } else if (phenomenon === 'heavy_rain') {
    // Modelo de lluvias intensas
    let prob = 0.0;
    if (precip >= 25.0) prob = 0.88;
    else if (precip >= 15.0) prob = 0.65;
    else if (precip >= 8.0) prob = 0.35;
    else if (precip >= 3.0) prob = 0.12;
    else prob = 0.02;

    const score = Math.round(prob * 100);
    const level = score >= 60 ? 'high' : score >= 30 ? 'moderate' : score >= 10 ? 'low' : 'none';
    return { probability: prob, risk_score: score, risk_level: level, model_type: 'ml_trained' };
  } else if (phenomenon === 'snow') {
    // Modelo de nevadas (Puna alta + tMin <= 1.0°C + precipitación)
    let z = -3.8 - (1.2 * tMin) + (0.15 * precip) + (0.0025 * (alt - 3800));
    if (alt < 3600) z -= 5.0; // Casi nulo bajo 3600 msnm
    const prob = 1.0 / (1.0 + Math.exp(-z));
    const score = Math.round(prob * 100);
    const level = score >= 60 ? 'high' : score >= 30 ? 'moderate' : score >= 10 ? 'low' : 'none';
    return { probability: prob, risk_score: score, risk_level: level, model_type: 'ml_trained' };
  } else {
    // Reglas físicas deterministas para Granizo (Hail)
    let score = 0;
    if (precip > 10 && hum > 85 && (tMax + tMin) / 2 > 5) score = 20;
    if (precip > 20 && hum > 90) score = 35;
    const prob = score / 100.0;
    const level = score >= 30 ? 'moderate' : score >= 15 ? 'low' : 'none';
    return { probability: prob, risk_score: score, risk_level: level, model_type: 'rule_based' };
  }
}

// Genera un escenario estocástico único
function mcGenerateSingleScenario() {
  const base = monteCarloState.baseline;
  const p = monteCarloState.params;

  let simTmin = mcRandomNormal(base.temperature_2m_min, p.temperature_std);
  let simPrecip = base.precipitation_sum <= 0.2 && mcRandomUniform() < 0.60
    ? 0.0
    : mcRandomGamma(p.precipitation_shape, p.precipitation_scale);

  // Correlación física: si llueve copiosamente, la temperatura mínima no baja tanto por nubosidad
  if (monteCarloState.useCorrelation && simPrecip > 5.0) {
    simTmin += (simPrecip / 15.0) * 0.8;
  }

  // Correlación de humedad con lluvia
  let simHum = base.humidity_mean + mcRandomNormal(0, 8.0);
  if (simPrecip > 2.0) simHum += 15.0;
  simHum = Math.max(15.0, Math.min(100.0, simHum));

  simTmin = Math.max(-15.0, Math.min(22.0, simTmin));
  const simTmax = simTmin + Math.max(4.0, Math.min(20.0, (base.temperature_2m_max - base.temperature_2m_min) + mcRandomNormal(0, 1.2)));

  return {
    temperature_2m_min: Number(simTmin.toFixed(2)),
    temperature_2m_max: Number(simTmax.toFixed(2)),
    precipitation_sum: Number(simPrecip.toFixed(2)),
    humidity_mean: Number(simHum.toFixed(1)),
    elevation: base.altitude_masl || 4000,
  };
}

// ===== CONTROLADORES DE CICLO DE VIDA (START / PAUSE / RESUME / RESET / STOP) =====

function startMonteCarloSimulation() {
  readInputsFromDOM();
  monteCarloState.currentIteration = 0;
  monteCarloState.probabilities = [];
  monteCarloState.scores = [];
  monteCarloState.samples = [];
  monteCarloState.levelCounts = { none: 0, low: 0, moderate: 0, high: 0 };
  monteCarloState.convergenceHistory = [];
  initMonteCarloPrng(monteCarloState.seed);

  // Evaluar predicción base operativa
  monteCarloState.baselinePrediction = mcEvaluateScenario(monteCarloState.baseline, monteCarloState.phenomenon);

  monteCarloState.isRunning = true;
  monteCarloState.isPaused = false;
  monteCarloState.startTime = performance.now();

  updateSimulatorControlsUI();
  executeSimulationLoop();
}

function pauseMonteCarloSimulation() {
  monteCarloState.isPaused = true;
  monteCarloState.isRunning = false;
  if (monteCarloState.timerId) {
    cancelAnimationFrame(monteCarloState.timerId);
    monteCarloState.timerId = null;
  }
  updateSimulatorControlsUI();
}

function resumeMonteCarloSimulation() {
  if (!monteCarloState.isPaused) return;
  monteCarloState.isPaused = false;
  monteCarloState.isRunning = true;
  updateSimulatorControlsUI();
  executeSimulationLoop();
}

function resetMonteCarloSimulation() {
  if (monteCarloState.timerId) {
    cancelAnimationFrame(monteCarloState.timerId);
    monteCarloState.timerId = null;
  }
  monteCarloState.isRunning = false;
  monteCarloState.isPaused = false;
  monteCarloState.currentIteration = 0;
  monteCarloState.probabilities = [];
  monteCarloState.scores = [];
  monteCarloState.samples = [];
  monteCarloState.levelCounts = { none: 0, low: 0, moderate: 0, high: 0 };
  monteCarloState.convergenceHistory = [];
  monteCarloState.elapsedMs = 0;

  updateSimulatorControlsUI();
  resetSimulatorDisplays();
}

function stopMonteCarloSimulation() {
  monteCarloState.isRunning = false;
  monteCarloState.isPaused = false;
  if (monteCarloState.timerId) {
    cancelAnimationFrame(monteCarloState.timerId);
    monteCarloState.timerId = null;
  }
  updateSimulatorControlsUI();
  updateStatisticsAndCharts(true);
}

// Bucle de iteración por lotes no bloqueante
function executeSimulationLoop() {
  if (!monteCarloState.isRunning || monteCarloState.isPaused) return;

  const batch = monteCarloState.batchSize;
  const target = monteCarloState.targetIterations;
  const phen = monteCarloState.phenomenon;

  const currentBatchLimit = Math.min(batch, target - monteCarloState.currentIteration);

  for (let b = 0; b < currentBatchLimit; b++) {
    const scenario = mcGenerateSingleScenario();
    const result = mcEvaluateScenario(scenario, phen);

    monteCarloState.probabilities.push(result.probability);
    monteCarloState.scores.push(result.risk_score);
    monteCarloState.samples.push({ scenario, result });
    monteCarloState.levelCounts[result.risk_level] = (monteCarloState.levelCounts[result.risk_level] || 0) + 1;
    monteCarloState.currentIteration++;
  }

  monteCarloState.elapsedMs = performance.now() - monteCarloState.startTime;

  // Registrar convergencia cada 20 iteraciones o al final
  if (monteCarloState.currentIteration % 20 === 0 || monteCarloState.currentIteration === target) {
    const sum = monteCarloState.probabilities.reduce((acc, v) => acc + v, 0);
    const mean = sum / monteCarloState.probabilities.length;
    const sorted = [...monteCarloState.probabilities].sort((a, b) => a - b);
    const p10 = getPercentileValue(sorted, 0.10);
    const p90 = getPercentileValue(sorted, 0.90);

    monteCarloState.convergenceHistory.push({
      iteration: monteCarloState.currentIteration,
      mean: Number((mean * 100).toFixed(1)),
      p10: Number((p10 * 100).toFixed(1)),
      p90: Number((p90 * 100).toFixed(1)),
    });
  }

  // Actualizar UI y gráficos periódicamente
  updateStatisticsAndCharts(false);

  if (monteCarloState.currentIteration < target) {
    monteCarloState.timerId = requestAnimationFrame(executeSimulationLoop);
  } else {
    // Simulación culminada
    monteCarloState.isRunning = false;
    monteCarloState.isPaused = false;
    updateSimulatorControlsUI();
    updateStatisticsAndCharts(true);
    showToast(`Simulación Monte Carlo completada: ${monteCarloState.targetIterations} escenarios`, 'success');
  }
}

// ===== CÁLCULO ESTADÍSTICO DE PERCENTILES =====

function getPercentileValue(sortedArr, p) {
  if (!sortedArr.length) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  const index = (sortedArr.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedArr[lower] * (1.0 - weight) + sortedArr[upper] * weight;
}

// ===== RENDERIZADO DEL PANEL DEL SIMULADOR =====

function renderMonteCarloSimulatorSection() {
  const currentParcel = predictiveDashboardState.horizonsData?.parcel;
  const parcelName = currentParcel?.name || 'Parcela Activa';
  const altitude = currentParcel?.altitude_masl || 4000;

  return `
    <div class="card" id="section-monte-carlo" style="margin-bottom: 24px; padding: 22px; border: 2px solid #818CF8; background: #FFFFFF; box-shadow: 0 4px 16px rgba(99, 102, 241, 0.08);">
      <!-- Encabezado del Simulador -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid #EEF2F6; padding-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 800; color: #3730A3; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🎲</span> Simulador Estocástico Monte Carlo en Tiempo Real
            </h3>
            <span class="badge badge-blue" style="font-size: 11px; font-weight: 800;">Fase 4 Activa</span>
          </div>
          <p class="text-sm text-muted" style="margin: 4px 0 0;">
            Propaga la incertidumbre meteorológica sobre modelos ML para evaluar probabilidades y percentiles de riesgo (P10, P50, P90).
          </p>
        </div>

        <!-- Modo de Simulación: Auto (Open-Meteo) vs Manual -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: inline-flex; background: #EEF2F6; padding: 3px; border-radius: 8px;">
            <button type="button" id="btn-mc-mode-auto" class="btn btn-sm ${monteCarloState.mode === 'auto' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px; border-radius: 6px;" onclick="setMonteCarloMode('auto')">
              📡 Auto (Pronóstico Real)
            </button>
            <button type="button" id="btn-mc-mode-manual" class="btn btn-sm ${monteCarloState.mode === 'manual' ? 'btn-primary' : 'btn-secondary'}" style="font-size: 12px; border-radius: 6px;" onclick="setMonteCarloMode('manual')">
              🎛️ Manual (Parámetros Libres)
            </button>
          </div>
        </div>
      </div>

      <!-- Banner de Distinción Científica entre Simulación y Medición Real -->
      <div style="padding: 10px 14px; background: #EEF2FF; border-radius: 8px; border-left: 4px solid #6366F1; margin-bottom: 18px; font-size: 12px; color: #3730A3; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>ℹ️</span>
          <span><strong>Transparencia Metodológica:</strong> Los escenarios simulados son generados estocásticamente para medir dispersión de riesgo. <u>No representan mediciones físicas de sensores</u>.</span>
        </div>
        <span id="mc-phenomenon-tag" class="badge badge-indigo" style="font-size: 10.5px;">Modelo ML Calibrado</span>
      </div>

      <!-- Barra de Configuración de Parámetros de Simulación -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 18px; background: #F8FAFC; padding: 16px; border-radius: 12px; border: 1px solid #E2E8F0;">
        <!-- Fenómeno -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">Fenómeno a Evaluar:</label>
          <select id="mc-select-phenomenon" class="form-control" style="font-size: 12px; padding: 6px 10px;" onchange="onMonteCarloPhenomenonChange(this.value)">
            <option value="frost" selected>❄️ Heladas</option>
            <option value="heavy_rain">🌧️ Lluvias Intensas</option>
            <option value="snow">🌨️ Nevadas</option>
            <option value="hail">🌩️ Granizadas (Regla Física)</option>
          </select>
        </div>

        <!-- Horizonte -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">Horizonte Temporal:</label>
          <select id="mc-select-horizon" class="form-control" style="font-size: 12px; padding: 6px 10px;" onchange="onMonteCarloHorizonChange(this.value)">
            <option value="24h" selected>24 Horas (Día 1)</option>
            <option value="48h">48 Horas (Día 2)</option>
            <option value="72h">72 Horas (Día 3)</option>
          </select>
        </div>

        <!-- Iteraciones -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">Iteraciones (N):</label>
          <select id="mc-select-iterations" class="form-control" style="font-size: 12px; padding: 6px 10px;" onchange="monteCarloState.targetIterations = Number(this.value)">
            <option value="500">500 Escenarios</option>
            <option value="1000" selected>1,000 Escenarios (Estándar)</option>
            <option value="2500">2,500 Escenarios</option>
            <option value="5000">5,000 Escenarios (Alta Precisión)</option>
          </select>
        </div>

        <!-- Velocidad de Ejecución -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">Tasa de Lote:</label>
          <select id="mc-select-batch" class="form-control" style="font-size: 12px; padding: 6px 10px;" onchange="monteCarloState.batchSize = Number(this.value)">
            <option value="20">20 iter/tick (Suave)</option>
            <option value="50" selected>50 iter/tick (Recomendado)</option>
            <option value="100">100 iter/tick (Rápido)</option>
            <option value="250">250 iter/tick (Turbo)</option>
          </select>
        </div>

        <!-- Desviación Estándar Térmica -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Desv. Temp (σ):</span>
            <strong id="label-mc-std-temp">±1.8°C</strong>
          </label>
          <input type="range" class="form-range" min="0.5" max="4.0" step="0.1" value="1.8" style="width: 100%; cursor: pointer;" oninput="onMonteCarloParamChange('temperature_std', this.value, '°C')">
        </div>

        <!-- Semilla PRNG -->
        <div>
          <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">Semilla (Reproducibilidad):</label>
          <div style="display: flex; gap: 6px;">
            <input type="number" id="mc-input-seed" class="form-control" value="42" style="font-size: 12px; padding: 6px 10px;" onchange="monteCarloState.seed = Number(this.value)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="randomizeMonteCarloSeed()" title="Generar semilla aleatoria">🎲</button>
          </div>
        </div>
      </div>

      <!-- Barra de Controles de Ejecución -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 14px; background: #FAFAFA; padding: 12px 18px; border-radius: 10px; border: 1px solid #E5E7EB;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="btn-mc-start" class="btn btn-primary btn-sm" style="background: #4F46E5; border-color: #4338CA; font-weight: 700; padding: 6px 14px;" onclick="startMonteCarloSimulation()">
            ▶️ Iniciar Simulación
          </button>
          <button type="button" id="btn-mc-pause" class="btn btn-secondary btn-sm" style="display: none; font-weight: 600;" onclick="pauseMonteCarloSimulation()">
            ⏸️ Pausar
          </button>
          <button type="button" id="btn-mc-resume" class="btn btn-success btn-sm" style="display: none; font-weight: 600;" onclick="resumeMonteCarloSimulation()">
            ⏯️ Reanudar
          </button>
          <button type="button" id="btn-mc-reset" class="btn btn-outline-secondary btn-sm" style="font-weight: 600;" onclick="resetMonteCarloSimulation()">
            🔄 Reiniciar
          </button>
          <button type="button" id="btn-mc-stop" class="btn btn-outline-danger btn-sm" style="display: none; font-weight: 600;" onclick="stopMonteCarloSimulation()">
            ⏹️ Detener
          </button>
        </div>

        <!-- Métricas en Tiempo Real (Iteraciones y Velocidad) -->
        <div style="display: flex; align-items: center; gap: 16px; font-size: 12.5px; color: #475569; font-weight: 600;">
          <div>
            Iteraciones: <strong id="mc-counter-progress" style="color: #1E1B4B; font-family: monospace;">0 / 1000</strong>
          </div>
          <div>
            Rendimiento: <strong id="mc-throughput-display" style="color: #059669; font-family: monospace;">0 iter/s</strong>
          </div>
          <div>
            Tiempo: <strong id="mc-elapsed-display" style="color: #6366F1; font-family: monospace;">0 ms</strong>
          </div>
        </div>
      </div>

      <!-- Barra de Progreso -->
      <div style="width: 100%; height: 8px; background: #E2E8F0; border-radius: 999px; overflow: hidden; margin-bottom: 22px;">
        <div id="mc-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #6366F1 0%, #4338CA 100%); border-radius: 999px; transition: width 0.1s ease;"></div>
      </div>

      <!-- Tarjetas de Estadísticas Clave (Media, Mediana, P10, P90, Intervalo) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 24px;">
        <!-- P10 -->
        <div style="background: #F0FDF4; padding: 12px 14px; border-radius: 10px; border: 1px solid #BBF7D0;">
          <div style="font-size: 11px; font-weight: 700; color: #166534;">🟢 Escenario Favorable (P10)</div>
          <div id="mc-stat-p10" style="font-size: 22px; font-weight: 900; color: #15803D; font-family: 'Outfit', sans-serif;">--%</div>
          <div class="text-xs text-muted">10% de casos con riesgo menor</div>
        </div>

        <!-- Mediana P50 -->
        <div style="background: #F8FAFC; padding: 12px 14px; border-radius: 10px; border: 1px solid #E2E8F0;">
          <div style="font-size: 11px; font-weight: 700; color: #334155;">⚖️ Mediana Estocástica (P50)</div>
          <div id="mc-stat-p50" style="font-size: 22px; font-weight: 900; color: #1E293B; font-family: 'Outfit', sans-serif;">--%</div>
          <div class="text-xs text-muted">Valor central probabilístico</div>
        </div>

        <!-- P90 -->
        <div style="background: #FEF2F2; padding: 12px 14px; border-radius: 10px; border: 1px solid #FECACA;">
          <div style="font-size: 11px; font-weight: 700; color: #991B1B;">🔴 Escenario Crítico (P90)</div>
          <div id="mc-stat-p90" style="font-size: 22px; font-weight: 900; color: #B91C1C; font-family: 'Outfit', sans-serif;">--%</div>
          <div class="text-xs text-muted">Riesgo en cola adversa (10%)</div>
        </div>

        <!-- Intervalo 80% CI -->
        <div style="background: #EFF6FF; padding: 12px 14px; border-radius: 10px; border: 1px solid #BFDBFE;">
          <div style="font-size: 11px; font-weight: 700; color: #1E40AF;">📏 Rango de Incertidumbre (80%)</div>
          <div id="mc-stat-ci" style="font-size: 17px; font-weight: 800; color: #1D4ED8; font-family: 'Outfit', sans-serif; margin-top: 4px;">[--% - --%]</div>
          <div class="text-xs text-muted">Dispersión entre P10 y P90</div>
        </div>

        <!-- Comparación Pronóstico Operativo -->
        <div style="background: #FAF5FF; padding: 12px 14px; border-radius: 10px; border: 1px solid #E9D5FF;">
          <div style="font-size: 11px; font-weight: 700; color: #6B21A8;">📡 Pronóstico Base Operativo</div>
          <div id="mc-stat-baseline" style="font-size: 22px; font-weight: 900; color: #7E22CE; font-family: 'Outfit', sans-serif;">--%</div>
          <div id="mc-stat-delta" class="text-xs" style="color: #6B21A8; font-weight: 600;">Delta: --</div>
        </div>
      </div>

      <!-- Gráficos del Simulador: Histograma de Probabilidad + Curva de Convergencia -->
      <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 20px; margin-bottom: 14px;" class="mc-charts-grid">
        <!-- Histograma de Distribución -->
        <div style="border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; background: #FFFFFF;">
          <div style="font-size: 13px; font-weight: 800; color: #1E293B; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>📊 Histograma de Probabilidades Simuladas</span>
            <span class="badge badge-gray" style="font-size: 10px;">10 Intervalos (0-100%)</span>
          </div>
          <div style="position: relative; height: 260px; width: 100%;">
            <canvas id="mc-histogram-chart"></canvas>
          </div>
        </div>

        <!-- Curva de Convergencia Monte Carlo -->
        <div style="border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; background: #FFFFFF;">
          <div style="font-size: 13px; font-weight: 800; color: #1E293B; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>📈 Convergencia de Percentiles en Tiempo Real</span>
            <span class="badge badge-blue" style="font-size: 10px;">Ley de los Grandes Números</span>
          </div>
          <div style="position: relative; height: 260px; width: 100%;">
            <canvas id="mc-convergence-chart"></canvas>
          </div>
        </div>
      </div>

      <!-- Distribución de Categorías de Riesgo en Porcentajes -->
      <div style="background: #F8FAFC; padding: 14px 18px; border-radius: 10px; border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <span style="font-size: 12.5px; font-weight: 700; color: #334155;">Distribución de Escenarios por Categoría:</span>
        <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 12px;">
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 50%; background: #94A3B8;"></span>
            Sin Riesgo: <strong id="mc-cat-none">--%</strong>
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 50%; background: #22C55E;"></span>
            Bajo: <strong id="mc-cat-low">--%</strong>
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 50%; background: #F59E0B;"></span>
            Moderado: <strong id="mc-cat-moderate">--%</strong>
          </span>
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 50%; background: #EF4444;"></span>
            Alto: <strong id="mc-cat-high">--%</strong>
          </span>
        </div>
      </div>
    </div>
  `;
}

// ===== ACTUALIZACIÓN DE INTERFAZ Y GRÁFICOS =====

function readInputsFromDOM() {
  const phenSelect = document.getElementById('mc-select-phenomenon');
  if (phenSelect) monteCarloState.phenomenon = phenSelect.value;

  const horizSelect = document.getElementById('mc-select-horizon');
  if (horizSelect) monteCarloState.horizon = horizSelect.value;

  const iterSelect = document.getElementById('mc-select-iterations');
  if (iterSelect) monteCarloState.targetIterations = Number(iterSelect.value);

  const batchSelect = document.getElementById('mc-select-batch');
  if (batchSelect) monteCarloState.batchSize = Number(batchSelect.value);

  const seedInput = document.getElementById('mc-input-seed');
  if (seedInput) monteCarloState.seed = Number(seedInput.value) || 42;

  // Actualizar baseline según horizonte si está en modo automático
  if (monteCarloState.mode === 'auto' && predictiveDashboardState.horizonsData?.horizons) {
    const horizons = predictiveDashboardState.horizonsData.horizons;
    const hKey = `horizon_${monteCarloState.horizon}`;
    const hData = horizons[hKey] || horizons.horizon_24h;
    if (hData) {
      monteCarloState.baseline.temperature_2m_min = hData.temp_min ?? 2.0;
      monteCarloState.baseline.temperature_2m_max = hData.temp_max ?? 13.5;
      monteCarloState.baseline.precipitation_sum = hData.precipitation_sum ?? 3.5;
      monteCarloState.baseline.altitude_masl = predictiveDashboardState.horizonsData?.parcel?.altitude_masl || 4000;
    }
  }
}

function updateSimulatorControlsUI() {
  const btnStart = document.getElementById('btn-mc-start');
  const btnPause = document.getElementById('btn-mc-pause');
  const btnResume = document.getElementById('btn-mc-resume');
  const btnReset = document.getElementById('btn-mc-reset');
  const btnStop = document.getElementById('btn-mc-stop');

  if (!btnStart) return;

  if (monteCarloState.isRunning) {
    btnStart.style.display = 'none';
    btnPause.style.display = 'inline-block';
    btnResume.style.display = 'none';
    btnStop.style.display = 'inline-block';
  } else if (monteCarloState.isPaused) {
    btnStart.style.display = 'none';
    btnPause.style.display = 'none';
    btnResume.style.display = 'inline-block';
    btnStop.style.display = 'inline-block';
  } else {
    btnStart.style.display = 'inline-block';
    btnPause.style.display = 'none';
    btnResume.style.display = 'none';
    btnStop.style.display = 'none';
  }
}

function updateStatisticsAndCharts(isFinal = false) {
  const current = monteCarloState.currentIteration;
  const target = monteCarloState.targetIterations;

  // Contador y progreso
  const counterEl = document.getElementById('mc-counter-progress');
  if (counterEl) counterEl.textContent = `${current} / ${target}`;

  const progressEl = document.getElementById('mc-progress-bar');
  if (progressEl) progressEl.style.width = `${Math.min(100, Math.round((current / target) * 100))}%`;

  // Rendimiento en vivo
  const elapsed = monteCarloState.elapsedMs || 1;
  const throughput = Math.round((current / elapsed) * 1000);
  const throughputEl = document.getElementById('mc-throughput-display');
  if (throughputEl) throughputEl.textContent = `${throughput.toLocaleString()} iter/s`;

  const elapsedEl = document.getElementById('mc-elapsed-display');
  if (elapsedEl) elapsedEl.textContent = elapsed > 1000 ? `${(elapsed / 1000).toFixed(2)} s` : `${Math.round(elapsed)} ms`;

  if (current === 0) return;

  // Estadísticas y Percentiles
  const sorted = [...monteCarloState.probabilities].sort((a, b) => a - b);
  const p10 = getPercentileValue(sorted, 0.10);
  const p50 = getPercentileValue(sorted, 0.50);
  const p90 = getPercentileValue(sorted, 0.90);

  const elP10 = document.getElementById('mc-stat-p10');
  const elP50 = document.getElementById('mc-stat-p50');
  const elP90 = document.getElementById('mc-stat-p90');
  const elCI = document.getElementById('mc-stat-ci');

  if (elP10) elP10.textContent = `${(p10 * 100).toFixed(1)}%`;
  if (elP50) elP50.textContent = `${(p50 * 100).toFixed(1)}%`;
  if (elP90) elP90.textContent = `${(p90 * 100).toFixed(1)}%`;
  if (elCI) elCI.textContent = `[${(p10 * 100).toFixed(1)}% - ${(p90 * 100).toFixed(1)}%]`;

  // Comparación contra pronóstico base
  const baseProb = monteCarloState.baselinePrediction?.probability || 0.0;
  const elBase = document.getElementById('mc-stat-baseline');
  const elDelta = document.getElementById('mc-stat-delta');
  if (elBase) elBase.textContent = `${(baseProb * 100).toFixed(1)}%`;
  if (elDelta) {
    const delta = (p50 - baseProb) * 100;
    const sign = delta >= 0 ? '+' : '';
    elDelta.textContent = `Delta vs Base: ${sign}${delta.toFixed(1)}%`;
    elDelta.style.color = Math.abs(delta) > 10 ? '#B91C1C' : '#4F46E5';
  }

  // Desglose de categorías
  const catNone = document.getElementById('mc-cat-none');
  const catLow = document.getElementById('mc-cat-low');
  const catMod = document.getElementById('mc-cat-moderate');
  const catHigh = document.getElementById('mc-cat-high');

  if (catNone) catNone.textContent = `${((monteCarloState.levelCounts.none / current) * 100).toFixed(1)}%`;
  if (catLow) catLow.textContent = `${((monteCarloState.levelCounts.low / current) * 100).toFixed(1)}%`;
  if (catMod) catMod.textContent = `${((monteCarloState.levelCounts.moderate / current) * 100).toFixed(1)}%`;
  if (catHigh) catHigh.textContent = `${((monteCarloState.levelCounts.high / current) * 100).toFixed(1)}%`;

  // Actualizar gráficos periódicamente (o en el paso final)
  if (isFinal || current % 100 === 0) {
    updateHistogramChart(sorted);
    updateConvergenceChart();
  }
}

function resetSimulatorDisplays() {
  const counterEl = document.getElementById('mc-counter-progress');
  if (counterEl) counterEl.textContent = `0 / ${monteCarloState.targetIterations}`;
  const progressEl = document.getElementById('mc-progress-bar');
  if (progressEl) progressEl.style.width = '0%';
  const throughputEl = document.getElementById('mc-throughput-display');
  if (throughputEl) throughputEl.textContent = '0 iter/s';
  const elapsedEl = document.getElementById('mc-elapsed-display');
  if (elapsedEl) elapsedEl.textContent = '0 ms';

  ['p10', 'p50', 'p90', 'baseline'].forEach(k => {
    const el = document.getElementById(`mc-stat-${k}`);
    if (el) el.textContent = '--%';
  });
  const elCI = document.getElementById('mc-stat-ci');
  if (elCI) elCI.textContent = '[--% - --%]';

  ['none', 'low', 'moderate', 'high'].forEach(k => {
    const el = document.getElementById(`mc-cat-${k}`);
    if (el) el.textContent = '--%';
  });

  if (monteCarloState.chartHistogram) {
    monteCarloState.chartHistogram.data.datasets[0].data = Array(10).fill(0);
    monteCarloState.chartHistogram.update();
  }
  if (monteCarloState.chartConvergence) {
    monteCarloState.chartConvergence.data.labels = [];
    monteCarloState.chartConvergence.data.datasets.forEach(d => d.data = []);
    monteCarloState.chartConvergence.update();
  }
}

// ===== GRÁFICOS CHART.JS DEL SIMULADOR =====

function initMonteCarloCharts() {
  // 1. Histograma
  const canvasHist = document.getElementById('mc-histogram-chart');
  if (canvasHist && typeof Chart !== 'undefined') {
    if (monteCarloState.chartHistogram) monteCarloState.chartHistogram.destroy();
    const ctx = canvasHist.getContext('2d');
    monteCarloState.chartHistogram = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%'],
        datasets: [{
          label: 'Frecuencia de Escenarios',
          data: Array(10).fill(0),
          backgroundColor: 'rgba(99, 102, 241, 0.7)',
          borderColor: '#4F46E5',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Escenarios: ${ctx.raw} (${monteCarloState.currentIteration ? ((ctx.raw / monteCarloState.currentIteration) * 100).toFixed(1) : 0}%)`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9.5 } } },
          y: { beginAtZero: true, title: { display: true, text: 'N° Corridas', font: { size: 10 } }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // 2. Convergencia
  const canvasConv = document.getElementById('mc-convergence-chart');
  if (canvasConv && typeof Chart !== 'undefined') {
    if (monteCarloState.chartConvergence) monteCarloState.chartConvergence.destroy();
    const ctx = canvasConv.getContext('2d');
    monteCarloState.chartConvergence = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'P90 (Crítico)',
            data: [],
            borderColor: '#EF4444',
            borderDash: [3, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'Media Acumulada',
            data: [],
            borderColor: '#4F46E5',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'P10 (Favorable)',
            data: [],
            borderColor: '#10B981',
            borderDash: [3, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
        },
        scales: {
          x: { title: { display: true, text: 'Iteración', font: { size: 10 } }, ticks: { maxTicksLimit: 6, font: { size: 9.5 } }, grid: { display: false } },
          y: { min: 0, max: 100, title: { display: true, text: 'Riesgo (%)', font: { size: 10 } }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }
}

function updateHistogramChart(sortedProbabilities) {
  if (!monteCarloState.chartHistogram) return;
  const bins = Array(10).fill(0);
  for (let i = 0; i < sortedProbabilities.length; i++) {
    const idx = Math.min(9, Math.floor(sortedProbabilities[i] * 10));
    bins[idx]++;
  }
  monteCarloState.chartHistogram.data.datasets[0].data = bins;
  monteCarloState.chartHistogram.update('none'); // Update sin animación pesada
}

function updateConvergenceChart() {
  if (!monteCarloState.chartConvergence) return;
  const history = monteCarloState.convergenceHistory;
  if (!history.length) return;

  monteCarloState.chartConvergence.data.labels = history.map(h => h.iteration);
  monteCarloState.chartConvergence.data.datasets[0].data = history.map(h => h.p90);
  monteCarloState.chartConvergence.data.datasets[1].data = history.map(h => h.mean);
  monteCarloState.chartConvergence.data.datasets[2].data = history.map(h => h.p10);
  monteCarloState.chartConvergence.update('none');
}

// ===== EVENTOS Y CAMBIOS DE CONFIGURACIÓN =====

function setMonteCarloMode(mode) {
  monteCarloState.mode = mode;
  const btnAuto = document.getElementById('btn-mc-mode-auto');
  const btnManual = document.getElementById('btn-mc-mode-manual');

  if (btnAuto && btnManual) {
    if (mode === 'auto') {
      btnAuto.className = 'btn btn-sm btn-primary';
      btnManual.className = 'btn btn-sm btn-secondary';
      showToast('Modo Automático: utilizando pronóstico Open-Meteo como centro estocástico', 'info');
    } else {
      btnAuto.className = 'btn btn-sm btn-secondary';
      btnManual.className = 'btn btn-sm btn-primary';
      showToast('Modo Manual: ajuste libre de variabilidad térmica y de precipitación', 'info');
    }
  }
}

function onMonteCarloPhenomenonChange(phen) {
  monteCarloState.phenomenon = phen;
  const tagEl = document.getElementById('mc-phenomenon-tag');
  if (tagEl) {
    if (phen === 'hail') {
      tagEl.className = 'badge badge-amber';
      tagEl.textContent = 'Regla Física Determinista (No Supervisado)';
    } else {
      tagEl.className = 'badge badge-indigo';
      tagEl.textContent = 'Modelo ML Calibrado';
    }
  }
  resetMonteCarloSimulation();
}

function onMonteCarloHorizonChange(horizon) {
  monteCarloState.horizon = horizon;
  resetMonteCarloSimulation();
}

function onMonteCarloParamChange(param, value, unit) {
  monteCarloState.params[param] = Number(value);
  const labelEl = document.getElementById(`label-mc-std-temp`);
  if (labelEl && param === 'temperature_std') {
    labelEl.textContent = `±${value}${unit}`;
  }
}

function randomizeMonteCarloSeed() {
  const newSeed = Math.floor(Math.random() * 90000) + 1000;
  const seedInput = document.getElementById('mc-input-seed');
  if (seedInput) seedInput.value = newSeed;
  monteCarloState.seed = newSeed;
  resetMonteCarloSimulation();
}
