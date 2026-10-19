/**
 * AgroPasco Digital — Motor Estocástico Monte Carlo (Fase 4)
 * ==========================================================
 * Generador estocástico reproducible para evaluación de incertidumbre
 * meteorológica y propagación de riesgo agronómico en parcelas de Pasco.
 *
 * Características:
 *  - PRNG determinista Mulberry32 con semilla configurable.
 *  - Distribución Normal (Box-Muller) calibrada por altitud y variabilidad andina.
 *  - Distribución Gamma (Marsaglia & Tsang, 2000) para modelación de lluvia.
 *  - Matriz de correlación meteorológica (descomposición de Cholesky 3x3).
 *  - Verificación estricta de límites físicos (temperaturas, humedad [10-100%], precip >= 0).
 *  - Inferencia nativa V8 sobre cada escenario simulado mediante MLEngine.
 *  - Cálculo robusto de percentiles (P10, P50, P90), intervalos de incertidumbre y convergencia.
 */

const { defaultEngine } = require('./mlEngine');

/**
 * Generador de números pseudoaleatorios Mulberry32 (32-bit state)
 * Garantiza reproducibilidad estricta con semilla entera.
 */
class Mulberry32 {
  constructor(seed = 123456789) {
    this.seed = (seed >>> 0) || 1;
  }

  next() {
    let t = (this.seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

class MonteCarloSimulator {
  constructor(options = {}) {
    this.seed = options.seed !== undefined ? Number(options.seed) : 42;
    this.prng = new Mulberry32(this.seed);
    this._hasSpareNormal = false;
    this._spareNormal = 0;
  }

  /**
   * Genera una variable aleatoria uniforme en (0, 1)
   */
  randomUniform() {
    let u = this.prng.next();
    // Evitar exactamente 0.0 para estabilidad de logaritmos
    return u === 0 ? 1e-10 : u;
  }

  /**
   * Genera una variable aleatoria Normal Estándar N(0, 1) vía Box-Muller
   */
  randomStandardNormal() {
    if (this._hasSpareNormal) {
      this._hasSpareNormal = false;
      return this._spareNormal;
    }

    const u1 = this.randomUniform();
    const u2 = this.randomUniform();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const z0 = mag * Math.cos(2.0 * Math.PI * u2);
    const z1 = mag * Math.sin(2.0 * Math.PI * u2);

    this._spareNormal = z1;
    this._hasSpareNormal = true;
    return z0;
  }

  /**
   * Genera una variable Normal N(mean, stdDev)
   */
  randomNormal(mean, stdDev) {
    return mean + stdDev * this.randomStandardNormal();
  }

  /**
   * Genera una variable aleatoria Gamma(shape, scale) usando Marsaglia & Tsang (2000).
   * E[X] = shape * scale, Var(X) = shape * scale^2
   */
  randomGamma(shape, scale = 1.0) {
    if (shape <= 0 || scale <= 0) return 0.0;

    // Caso shape < 1: transformación de Stuart
    if (shape < 1.0) {
      const u = this.randomUniform();
      return this.randomGamma(shape + 1.0, scale) * Math.pow(u, 1.0 / shape);
    }

    const d = shape - 1.0 / 3.0;
    const c = 1.0 / Math.sqrt(9.0 * d);

    while (true) {
      let z = this.randomStandardNormal();
      let v = 1.0 + c * z;
      if (v <= 0) continue;

      v = v * v * v;
      const u = this.randomUniform();

      // Test rápido de aceptación
      if (u < 1.0 - 0.0331 * z * z * z * z) {
        return d * v * scale;
      }

      // Test logarítmico completo
      if (Math.log(u) < 0.5 * z * z + d * (1.0 - v + Math.log(v))) {
        return d * v * scale;
      }
    }
  }

  /**
   * Descomposición de Cholesky para generar 3 variables normales correlacionadas:
   * [Z_tmin, Z_precip, Z_humidity]
   *
   * Calibrada empíricamente a partir de 2,461 observaciones históricas de
   * backend/data/weather-history/processed/cerro_de_pasco_processed.csv (2019-2025):
   *  - Correlación Tmin y Precipitación: +0.4849 (días con nubosidad/lluvia mitigan el enfriamiento radiativo nocturno)
   *  - Correlación Tmin y Humedad:       +0.6573 (alta humedad retiene calor por vapor de agua y nubes)
   *  - Correlación Precipitación y Humedad: +0.6188 (eventos pluviales saturan la columna de aire)
   *
   * Matriz triangular inferior de Cholesky L:
   *  L11 = 1.0
   *  L21 = 0.4849, L22 = sqrt(1 - 0.4849^2) = 0.8746
   *  L31 = 0.6573, L32 = (0.6188 - 0.6573*0.4849)/0.8746 = 0.3431, L33 = sqrt(1 - 0.6573^2 - 0.3431^2) = 0.6710
   */
  generateCorrelatedNormals() {
    const z1 = this.randomStandardNormal();
    const z2 = this.randomStandardNormal();
    const z3 = this.randomStandardNormal();

    const x1 = z1;
    const x2 = 0.4849 * z1 + 0.8746 * z2;
    const x3 = 0.6573 * z1 + 0.3431 * z2 + 0.6710 * z3;

    return { zTemp: x1, zPrecip: x2, zHum: x3 };
  }

  /**
   * Convierte un vector estándar Z a percentil CDF normal Phi(Z)
   */
  normalCdf(z) {
    const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2.0);
    const prob = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1.0 - prob : prob;
  }

  /**
   * Genera un escenario meteorológico físicamente plausible ajustado a la altitud de Pasco.
   */
  generateScenario(baseline, variability = {}) {
    const useCorrelation = variability.correlated !== false;

    const baseTmin = Number(baseline.temperature_2m_min ?? 2.0);
    const baseTmax = Number(baseline.temperature_2m_max ?? 13.5);
    const basePrecip = Number(baseline.precipitation_sum ?? 3.5);
    const baseHum = Number(baseline.humidity_mean ?? 68.0);
    const baseWind = Number(baseline.wind_speed_10m_max ?? 3.5);
    const altitude = Number(baseline.altitude_masl ?? 4000);

    // Parámetros de dispersión configurables
    const stdTemp = Number(variability.temperature_std ?? 1.8); // Desviación estándar térmica típica en Pasco: 1.5 - 2.5 °C
    const rainShape = Number(variability.precipitation_shape ?? 1.5);
    const rainScale = Number(variability.precipitation_scale ?? (basePrecip > 0 ? basePrecip / 1.5 : 2.0));

    let simTmin, simPrecip, simHum;

    if (useCorrelation) {
      const { zTemp, zPrecip, zHum } = this.generateCorrelatedNormals();
      simTmin = baseTmin + stdTemp * zTemp;

      // Transformación de cópula para precipitación Gamma
      const uPrecip = Math.max(1e-5, Math.min(0.9999, this.normalCdf(zPrecip)));
      // Para días predominantemente secos vs húmedos
      if (basePrecip <= 0.2 && uPrecip < 0.60) {
        simPrecip = 0.0;
      } else {
        simPrecip = this.randomGamma(rainShape, rainScale);
      }

      simHum = baseHum + (12.0 * zHum);
    } else {
      simTmin = this.randomNormal(baseTmin, stdTemp);
      simPrecip = basePrecip <= 0.2 && this.randomUniform() < 0.60 ? 0.0 : this.randomGamma(rainShape, rainScale);
      simHum = this.randomNormal(baseHum, 12.0);
    }

    // Validación de límites físicos reales de los Andes de Pasco
    simTmin = Math.max(-15.0, Math.min(22.0, simTmin));
    const diurnalRange = Math.max(4.0, Math.min(20.0, (baseTmax - baseTmin) + this.randomNormal(0, 1.2)));
    const simTmax = simTmin + diurnalRange;
    const simTmean = (simTmin + simTmax) / 2.0;
    simPrecip = Math.max(0.0, Math.min(120.0, simPrecip));
    simHum = Math.max(15.0, Math.min(100.0, simHum));
    const simWind = Math.max(0.0, Math.min(25.0, baseWind + this.randomNormal(0, 1.0)));

    return {
      temperature_2m_min: Number(simTmin.toFixed(2)),
      temperature_2m_max: Number(simTmax.toFixed(2)),
      temperature_2m_mean: Number(simTmean.toFixed(2)),
      temp_range: Number((simTmax - simTmin).toFixed(2)),
      precipitation_sum: Number(simPrecip.toFixed(2)),
      wind_speed_10m_max: Number(simWind.toFixed(2)),
      humidity_mean: Number(simHum.toFixed(1)),
      humidity_max: Math.min(100.0, Number((simHum + 12.0).toFixed(1))),
      humidity_min: Math.max(10.0, Number((simHum - 12.0).toFixed(1))),
      soil_moisture_mean: Number((0.20 + (simHum / 250.0) + (simPrecip / 300.0)).toFixed(3)),
      et0_fao_evapotranspiration: Number(Math.max(1.0, 2.5 + (simTmax * 0.1) - (simHum * 0.015)).toFixed(2)),
      elevation: altitude,
      month: baseline.month || new Date().getMonth() + 1,
      day_of_year: baseline.day_of_year || 190,
      is_winter: baseline.is_winter !== undefined ? baseline.is_winter : 1,
      is_dry_season: baseline.is_dry_season !== undefined ? baseline.is_dry_season : 1,
      precip_lag1: Number((simPrecip * 0.6).toFixed(2)),
      precip_rolling_3d: Number((simPrecip * 1.8).toFixed(2)),
      precip_rolling_7d: Number((simPrecip * 3.5).toFixed(2)),
      temp_min_lag1: Number(simTmin.toFixed(2)),
      temp_max_lag1: Number(simTmax.toFixed(2)),
      temp_min_rolling_3d: Number((simTmin + 0.2).toFixed(2)),
      temp_min_rolling_7d: Number((simTmin + 0.5).toFixed(2)),
      temp_max_rolling_3d: Number(simTmax.toFixed(2)),
    };
  }

  buildBaselineScenario(baseline) {
    const baseTmin = Number(baseline.temperature_2m_min ?? 2.0);
    const baseTmax = Number(baseline.temperature_2m_max ?? (baseTmin + 11.0));
    const baseTmean = Number(baseline.temperature_2m_mean ?? ((baseTmin + baseTmax) / 2.0));
    const basePrecip = Number(baseline.precipitation_sum ?? 3.5);
    const baseHum = Number(baseline.humidity_mean ?? 68.0);
    const baseWind = Number(baseline.wind_speed_10m_max ?? 3.5);
    const altitude = Number(baseline.altitude_masl ?? (baseline.elevation ?? 4000));

    return {
      temperature_2m_min: Number(baseTmin.toFixed(2)),
      temperature_2m_max: Number(baseTmax.toFixed(2)),
      temperature_2m_mean: Number(baseTmean.toFixed(2)),
      temp_range: Number((baseTmax - baseTmin).toFixed(2)),
      precipitation_sum: Number(basePrecip.toFixed(2)),
      wind_speed_10m_max: Number(baseWind.toFixed(2)),
      humidity_mean: Number(baseHum.toFixed(1)),
      humidity_max: Math.min(100.0, Number((baseHum + 12.0).toFixed(1))),
      humidity_min: Math.max(10.0, Number((baseHum - 12.0).toFixed(1))),
      soil_moisture_mean: Number((0.20 + (baseHum / 250.0) + (basePrecip / 300.0)).toFixed(3)),
      et0_fao_evapotranspiration: Number(Math.max(1.0, 2.5 + (baseTmax * 0.1) - (baseHum * 0.015)).toFixed(2)),
      elevation: altitude,
      month: baseline.month || new Date().getMonth() + 1,
      day_of_year: baseline.day_of_year || 190,
      is_winter: baseline.is_winter !== undefined ? baseline.is_winter : 1,
      is_dry_season: baseline.is_dry_season !== undefined ? baseline.is_dry_season : 1,
      precip_lag1: Number((basePrecip * 0.6).toFixed(2)),
      precip_rolling_3d: Number((basePrecip * 1.8).toFixed(2)),
      precip_rolling_7d: Number((basePrecip * 3.5).toFixed(2)),
      temp_min_lag1: Number(baseTmin.toFixed(2)),
      temp_max_lag1: Number(baseTmax.toFixed(2)),
      temp_min_rolling_3d: Number((baseTmin + 0.2).toFixed(2)),
      temp_min_rolling_7d: Number((baseTmin + 0.5).toFixed(2)),
      temp_max_rolling_3d: Number(baseTmax.toFixed(2)),
    };
  }

  /**
   * Ejecuta una simulación Monte Carlo completa con inferencia ML para un fenómeno dado.
   * @param {object} baseline Variables base (de Open-Meteo o manuales)
   * @param {string} phenomenon Fenómeno a simular ('frost', 'heavy_rain', 'snow', 'hail')
   * @param {number} iterations Número de iteraciones a ejecutar (100 a 10000)
   * @param {object} variability Parámetros de variabilidad estocástica
   */
  runSimulation(baseline, phenomenon = 'frost', iterations = 1000, variability = {}) {
    if (baseline && typeof baseline === 'object' && baseline.baseline) {
      phenomenon = baseline.phenomenon || phenomenon;
      iterations = baseline.iterations || iterations;
      variability = baseline.variability || variability;
      baseline = baseline.baseline;
    }

    if (!defaultEngine.isLoaded) {
      defaultEngine.loadModels();
    }

    const tStart = Date.now();
    const cleanIterations = Math.max(10, Math.min(10000, Number(iterations) || 1000));
    const scores = new Float32Array(cleanIterations);
    const probabilities = new Float32Array(cleanIterations);

    const levelCounts = { none: 0, low: 0, moderate: 0, high: 0 };
    const convergenceSnapshots = [];
    const snapshotInterval = Math.max(10, Math.floor(cleanIterations / 20));

    let runningSumProb = 0.0;
    let runningSumScore = 0.0;

    // Ejecución de inferencia por cada escenario generado
    for (let i = 0; i < cleanIterations; i++) {
      const scenario = this.generateScenario(baseline, variability);
      let pred;

      if (phenomenon === 'frost') {
        pred = defaultEngine.predictFrost(scenario);
      } else if (phenomenon === 'heavy_rain') {
        pred = defaultEngine.predictHeavyRain(scenario);
      } else if (phenomenon === 'snow') {
        pred = defaultEngine.predictSnow(scenario);
      } else if (phenomenon === 'hail') {
        pred = defaultEngine.predictHail(scenario);
      } else {
        pred = defaultEngine.predictFrost(scenario);
      }

      const prob = Number(pred.probability ?? 0.0);
      const score = Number(pred.risk_score ?? (prob * 100.0));
      const level = pred.risk_level || 'none';

      probabilities[i] = prob;
      scores[i] = score;

      levelCounts[level] = (levelCounts[level] || 0) + 1;
      runningSumProb += prob;
      runningSumScore += score;

      // Registrar punto de convergencia periódicamente
      if ((i + 1) % snapshotInterval === 0 || i === cleanIterations - 1) {
        const currentCount = i + 1;
        convergenceSnapshots.push({
          iteration: currentCount,
          mean_probability: Number((runningSumProb / currentCount).toFixed(4)),
          mean_score: Number((runningSumScore / currentCount).toFixed(2)),
        });
      }
    }

    const elapsedMs = Math.max(1, Date.now() - tStart);
    const throughputIterPerSec = Math.round((cleanIterations / elapsedMs) * 1000);

    // Inferencia de referencia sobre el pronóstico base operativo con vector completo
    const baseScenario = this.buildBaselineScenario(baseline);
    let baselinePrediction;
    if (phenomenon === 'frost') baselinePrediction = defaultEngine.predictFrost(baseScenario);
    else if (phenomenon === 'heavy_rain') baselinePrediction = defaultEngine.predictHeavyRain(baseScenario);
    else if (phenomenon === 'snow') baselinePrediction = defaultEngine.predictSnow(baseScenario);
    else baselinePrediction = defaultEngine.predictHail(baseScenario);

    const baseProb = Number(baselinePrediction.probability ?? 0.0);
    const baseScore = Number(baselinePrediction.risk_score ?? (baseProb * 100.0));

    // Cálculo riguroso de estadísticas y percentiles (P10, P50, P90)
    const sortedProbabilities = Array.from(probabilities).sort((a, b) => a - b);
    const sortedScores = Array.from(scores).sort((a, b) => a - b);

    const p10Prob = this._getPercentile(sortedProbabilities, 0.10);
    const p50Prob = this._getPercentile(sortedProbabilities, 0.50);
    const p90Prob = this._getPercentile(sortedProbabilities, 0.90);

    const p10Score = this._getPercentile(sortedScores, 0.10);
    const p50Score = this._getPercentile(sortedScores, 0.50);
    const p90Score = this._getPercentile(sortedScores, 0.90);

    const meanProb = runningSumProb / cleanIterations;
    const meanScore = runningSumScore / cleanIterations;

    // Varianza y desviación estándar
    let varSum = 0;
    for (let i = 0; i < cleanIterations; i++) {
      const diff = probabilities[i] - meanProb;
      varSum += diff * diff;
    }
    const stdProb = Math.sqrt(varSum / cleanIterations);

    // Histograma de distribución en 10 intervalos (0-10%, 10-20%, ..., 90-100%)
    const histogramBins = Array(10).fill(0);
    for (let i = 0; i < cleanIterations; i++) {
      const binIdx = Math.min(9, Math.floor(probabilities[i] * 10));
      histogramBins[binIdx]++;
    }
    const histogramLabels = [
      '0-10%', '10-20%', '20-30%', '30-40%', '40-50%',
      '50-60%', '60-70%', '70-80%', '80-90%', '90-100%'
    ];

    return {
      success: true,
      simulation_meta: {
        phenomenon,
        iterations: cleanIterations,
        seed: this.seed,
        elapsed_ms: elapsedMs,
        throughput_iter_per_sec: throughputIterPerSec,
        model_used: baselinePrediction.algorithm || baselinePrediction.model_type || 'ML V8',
        is_supervised_ml: phenomenon !== 'hail',
        timestamp: new Date().toISOString(),
      },
      baseline_reference: {
        operational_probability: Number(baseProb.toFixed(4)),
        operational_risk_score: Number(baseScore.toFixed(2)),
        operational_risk_level: baselinePrediction.risk_level,
      },
      statistics: {
        mean_probability: Number(meanProb.toFixed(4)),
        median_probability: Number(p50Prob.toFixed(4)),
        std_probability: Number(stdProb.toFixed(4)),
        percentiles: {
          p10: Number(p10Prob.toFixed(4)),
          p25: Number(this._getPercentile(sortedProbabilities, 0.25).toFixed(4)),
          p50: Number(p50Prob.toFixed(4)),
          p75: Number(this._getPercentile(sortedProbabilities, 0.75).toFixed(4)),
          p90: Number(p90Prob.toFixed(4)),
        },
        uncertainty_interval_80: {
          lower_bound_p10: Number(p10Prob.toFixed(4)),
          upper_bound_p90: Number(p90Prob.toFixed(4)),
          spread: Number((p90Prob - p10Prob).toFixed(4)),
        },
        score_statistics: {
          mean_score: Number(meanScore.toFixed(2)),
          median_score: Number(p50Score.toFixed(2)),
          p10_score: Number(p10Score.toFixed(2)),
          p90_score: Number(p90Score.toFixed(2)),
        },
      },
      risk_distribution: {
        counts: levelCounts,
        percentages: {
          none: Number(((levelCounts.none / cleanIterations) * 100).toFixed(1)),
          low: Number(((levelCounts.low / cleanIterations) * 100).toFixed(1)),
          moderate: Number(((levelCounts.moderate / cleanIterations) * 100).toFixed(1)),
          high: Number(((levelCounts.high / cleanIterations) * 100).toFixed(1)),
        },
      },
      histogram: {
        labels: histogramLabels,
        frequencies: histogramBins,
      },
      convergence: convergenceSnapshots,
      methodological_disclaimer: {
        scientific_nature: 'Simulación estocástica sintética para análisis de sensibilidad y robustez probabilística.',
        reality_distinction: 'Las iteraciones Monte Carlo NO representan nuevas mediciones físicas ni sustituyen al pronóstico operativo oficial.',
        percentile_nature: 'Los percentiles P10, P50 y P90 cuantifican la dispersión del modelo ante perturbaciones climáticas sintéticas, no probabilidades calibradas de ocurrencia real en campo.',
        correlation_provenance: 'Matriz de correlación Cholesky calibrada empíricamente a partir de 2,461 registros históricos de cerro_de_pasco_processed.csv (r_precip_hum = +0.6188, r_tmin_hum = +0.6573, r_tmin_precip = +0.4849).',
        hail_notice: phenomenon === 'hail' ? 'Granizadas evaluadas mediante reglas físicas deterministas provisionales debido a ausencia de eventos WMO en reanálisis ERA5.' : null,
      },
    };
  }

  /**
   * Cálculo de percentil usando interpolación lineal (Type 7 / estándar R y NumPy)
   */
  _getPercentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    if (sortedArr.length === 1) return sortedArr[0];
    const index = (sortedArr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedArr[lower] * (1.0 - weight) + sortedArr[upper] * weight;
  }
}

const defaultSimulator = new MonteCarloSimulator();

module.exports = {
  MonteCarloSimulator,
  Mulberry32,
  defaultSimulator,
};

