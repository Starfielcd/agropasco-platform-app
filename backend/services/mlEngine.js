/**
 * AgroPasco — Motor Independiente de Inferencia ML Nativo (JavaScript Puro)
 * =========================================================================
 * FASE 8C: Ejecuta modelos GradientBoosting, RandomForest y LogisticRegression
 * exportados a formato JSON estructurado, sin dependencias externas (sin Python, sin C++).
 *
 * Características de diseño:
 *  - Carga y valida la integridad de los artefactos JSON en memoria.
 *  - Validación estricta de entradas (rechaza variables faltantes o NaN sin imputación silenciosa).
 *  - Traversal de árboles binarios optimizado en bucle cerrado (sub-milisegundo en V8).
 *  - Mapeo determinista de probabilidades a niveles de riesgo.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MODELS_DIR = path.resolve(__dirname, '../data/models-json');

class MLEngine {
  constructor(modelsDir = DEFAULT_MODELS_DIR) {
    this.modelsDir = modelsDir;
    this.models = {
      frost: null,
      heavy_rain: null,
      snow: null
    };
    this.isLoaded = false;
  }

  /**
   * Carga y valida todos los modelos JSON en memoria.
   */
  loadModels() {
    try {
      const frostPath = path.join(this.modelsDir, 'frost_model.json');
      const heavyRainPath = path.join(this.modelsDir, 'heavy_rain_model.json');
      const snowPath = path.join(this.modelsDir, 'snow_model.json');

      if (!fs.existsSync(frostPath)) throw new Error(`Archivo no encontrado: ${frostPath}`);
      if (!fs.existsSync(heavyRainPath)) throw new Error(`Archivo no encontrado: ${heavyRainPath}`);
      if (!fs.existsSync(snowPath)) throw new Error(`Archivo no encontrado: ${snowPath}`);

      const frost = JSON.parse(fs.readFileSync(frostPath, 'utf-8'));
      const heavyRain = JSON.parse(fs.readFileSync(heavyRainPath, 'utf-8'));
      const snow = JSON.parse(fs.readFileSync(snowPath, 'utf-8'));

      this._validateArtifactSchema(frost, 'frost');
      this._validateArtifactSchema(heavyRain, 'heavy_rain');
      this._validateArtifactSchema(snow, 'snow');

      this.models.frost = frost;
      this.models.heavy_rain = heavyRain;
      this.models.snow = snow;
      this.isLoaded = true;

      return {
        loaded: true,
        models: ['frost', 'heavy_rain', 'snow'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      this.isLoaded = false;
      throw new Error(`[MLEngine] Error cargando modelos: ${err.message}`);
    }
  }

  /**
   * Valida la estructura interna del JSON de un modelo.
   */
  _validateArtifactSchema(model, expectedPhenomenon) {
    if (!model || typeof model !== 'object') {
      throw new Error(`Estructura inválida para ${expectedPhenomenon}`);
    }
    if (model.phenomenon !== expectedPhenomenon) {
      throw new Error(`Discrepancia en fenómeno: esperado ${expectedPhenomenon}, recibido ${model.phenomenon}`);
    }
    if (!Array.isArray(model.features) || model.features.length === 0) {
      throw new Error(`Lista de variables vacía en ${expectedPhenomenon}`);
    }
    if (model.n_features !== model.features.length) {
      throw new Error(`Inconsistencia en conteo de variables en ${expectedPhenomenon}`);
    }

    if (expectedPhenomenon === 'frost') {
      if (model.algorithm === 'LogisticRegression' || Array.isArray(model.coefficients)) {
        if (!Array.isArray(model.coefficients) || typeof model.intercept !== 'number') {
          throw new Error('Coeficientes o intercepto ausentes en modelo de heladas');
        }
        if (!model.scaler || !Array.isArray(model.scaler.mean) || !Array.isArray(model.scaler.scale)) {
          throw new Error('Parámetros de escalador ausentes en modelo de heladas');
        }
      } else {
        if (!Array.isArray(model.trees) || model.trees.length === 0) {
          throw new Error('Árboles ausentes en modelo de heladas');
        }
        if (typeof model.learning_rate !== 'number' || typeof model.init_raw_value !== 'number') {
          throw new Error('Parámetros de ensamble ausentes en modelo de heladas');
        }
      }
    } else if (expectedPhenomenon === 'heavy_rain') {
      if (!Array.isArray(model.trees) || model.trees.length === 0) {
        throw new Error('Árboles ausentes en modelo de lluvias intensas');
      }
    } else if (expectedPhenomenon === 'snow') {
      if (!Array.isArray(model.coefficients) || typeof model.intercept !== 'number') {
        throw new Error('Coeficientes o intercepto ausentes en modelo de nieve');
      }
      if (!model.scaler || !Array.isArray(model.scaler.mean) || !Array.isArray(model.scaler.scale)) {
        throw new Error('Parámetros de escalador ausentes en modelo de nieve');
      }
      if (model.coefficients.length !== model.features.length || model.scaler.mean.length !== model.features.length) {
        throw new Error('Dimensión de coeficientes o escalador no coincide con features en nieve');
      }
    }
  }

  /**
   * Valida estrictamente un diccionario de entrada contra la lista de características requeridas.
   * Rechaza nulos, indefinidos, NaN y omisiones. No sustituye silenciosamente por 0.
   */
  _prepareVector(inputDict, requiredFeatures) {
    if (!inputDict || typeof inputDict !== 'object') {
      throw new Error('El vector de entrada debe ser un objeto con variables meteorológicas.');
    }

    const vector = new Array(requiredFeatures.length);
    const missing = [];
    const invalid = [];

    for (let i = 0; i < requiredFeatures.length; i++) {
      const featName = requiredFeatures[i];
      const val = inputDict[featName];

      if (val === undefined || val === null) {
        missing.push(featName);
      } else if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
        invalid.push(`${featName} (valor=${val})`);
      } else {
        vector[i] = val;
      }
    }

    if (missing.length > 0) {
      throw new Error(`[MLEngine] Variables faltantes obligatorias: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      throw new Error(`[MLEngine] Variables con valores no numéricos o inválidos: ${invalid.join(', ')}`);
    }

    return vector;
  }

  /**
   * Mapea probabilidad continua a nivel de riesgo y score.
   */
  _mapRisk(probability, thresholds = { high: 0.70, moderate: 0.40, low: 0.15 }) {
    let level;
    if (probability >= thresholds.high) {
      level = 'high';
    } else if (probability >= thresholds.moderate) {
      level = 'moderate';
    } else if (probability >= thresholds.low) {
      level = 'low';
    } else {
      level = 'none';
    }
    const score = Math.round(probability * 1000) / 10;
    return { level, score };
  }

  /**
   * Inferencia para Heladas (LogisticRegression o GradientBoostingClassifier).
   */
  predictFrost(featuresInput) {
    if (!this.isLoaded) this.loadModels();
    const model = this.models.frost;
    const rawVector = this._prepareVector(featuresInput, model.features);

    if (model.algorithm === 'LogisticRegression' || Array.isArray(model.coefficients)) {
      const coefs = model.coefficients;
      const intercept = model.intercept;
      const mean = model.scaler.mean;
      const scale = model.scaler.scale;

      let z = intercept;
      const n = rawVector.length;
      for (let i = 0; i < n; i++) {
        const xScaled = (rawVector[i] - mean[i]) / scale[i];
        z += xScaled * coefs[i];
      }

      const probability = 1.0 / (1.0 + Math.exp(-z));
      const { level, score } = this._mapRisk(probability, model.risk_thresholds);

      return {
        phenomenon: 'frost',
        probability,
        raw_score: z,
        risk_level: level,
        risk_score: score,
        model_type: 'ml_trained',
        algorithm: model.algorithm,
        version: model.version
      };
    }

    const x = new Float32Array(rawVector);
    let sumTrees = 0.0;
    const trees = model.trees;
    const nTrees = trees.length;

    for (let t = 0; t < nTrees; t++) {
      const tree = trees[t];
      const left = tree.left;
      const right = tree.right;
      const feature = tree.feature;
      const threshold = tree.threshold;
      const value = tree.value;

      let node = 0;
      while (left[node] !== -1) {
        const featIdx = feature[node];
        if (x[featIdx] <= threshold[node]) {
          node = left[node];
        } else {
          node = right[node];
        }
      }
      sumTrees += value[node];
    }

    const rawScore = model.init_raw_value + model.learning_rate * sumTrees;
    const probability = 1.0 / (1.0 + Math.exp(-rawScore));
    const { level, score } = this._mapRisk(probability, model.risk_thresholds);

    return {
      phenomenon: 'frost',
      probability,
      raw_score: rawScore,
      risk_level: level,
      risk_score: score,
      model_type: 'ml_trained',
      algorithm: model.algorithm,
      version: model.version
    };
  }

  /**
   * Inferencia para Lluvias Intensas (RandomForestClassifier).
   */
  predictHeavyRain(featuresInput) {
    if (!this.isLoaded) this.loadModels();
    const model = this.models.heavy_rain;
    const rawVector = this._prepareVector(featuresInput, model.features);
    const x = new Float32Array(rawVector);

    let sumProb = 0.0;
    const trees = model.trees;
    const nTrees = trees.length;

    for (let t = 0; t < nTrees; t++) {
      const tree = trees[t];
      const left = tree.left;
      const right = tree.right;
      const feature = tree.feature;
      const threshold = tree.threshold;
      const probClass1 = tree.prob_class_1;

      let node = 0;
      while (left[node] !== -1) {
        const featIdx = feature[node];
        if (x[featIdx] <= threshold[node]) {
          node = left[node];
        } else {
          node = right[node];
        }
      }
      sumProb += probClass1[node];
    }

    const probability = sumProb / nTrees;
    const { level, score } = this._mapRisk(probability, model.risk_thresholds);

    return {
      phenomenon: 'heavy_rain',
      probability,
      risk_level: level,
      risk_score: score,
      model_type: 'ml_trained',
      algorithm: model.algorithm,
      version: model.version
    };
  }

  /**
   * Inferencia para Nevadas (LogisticRegression + StandardScaler).
   */
  predictSnow(featuresInput) {
    if (!this.isLoaded) this.loadModels();
    const model = this.models.snow;
    const x = this._prepareVector(featuresInput, model.features);

    const coefs = model.coefficients;
    const mean = model.scaler.mean;
    const scale = model.scaler.scale;
    const n = coefs.length;

    let z = model.intercept;
    for (let i = 0; i < n; i++) {
      const xScaled = (x[i] - mean[i]) / scale[i];
      z += coefs[i] * xScaled;
    }

    const probability = 1.0 / (1.0 + Math.exp(-z));
    const { level, score } = this._mapRisk(probability, model.risk_thresholds);

    return {
      phenomenon: 'snow',
      probability,
      z_score: z,
      risk_level: level,
      risk_score: score,
      model_type: 'ml_trained',
      algorithm: model.algorithm,
      version: model.version
    };
  }

  /**
   * Evaluación de Granizadas mediante reglas físicas documentadas
   * (Sin modelo supervisado debido a ausencia de eventos en reanálisis ERA5).
   */
  evaluateHailRules(featuresInput) {
    const tempMean = Number(featuresInput.temperature_2m_mean ?? 15);
    const precip = Number(featuresInput.precipitation_sum ?? featuresInput.precipitation ?? 0);
    const humidity = Number(featuresInput.humidity_max ?? featuresInput.humidity_mean ?? 50);

    let score = 0;
    if (precip > 10 && humidity > 85 && tempMean > 5) score = 20;
    if (precip > 20 && humidity > 90) score = 30;

    const level = score >= 30 ? 'moderate' : score >= 15 ? 'low' : 'none';

    return {
      phenomenon: 'hail',
      probability: score / 100.0,
      risk_level: level,
      risk_score: score,
      model_type: 'rule_based',
      confidence_note: 'Evaluación física basada en reglas agronómicas (0 horas WMO de granizo en histórico ERA5).'
    };
  }

  /**
   * Alias de predictHail para compatibilidad con la interfaz de 4 fenómenos.
   */
  predictHail(featuresInput) {
    return this.evaluateHailRules(featuresInput);
  }

  /**
   * Ejecuta todas las predicciones para una entrada completa.
   */
  predictAll(featuresInput) {
    if (!this.isLoaded) this.loadModels();

    const frost = this.predictFrost(featuresInput);
    const heavyRain = this.predictHeavyRain(featuresInput);
    const snow = this.predictSnow(featuresInput);
    const hail = this.evaluateHailRules(featuresInput);

    return {
      timestamp: new Date().toISOString(),
      predictions: [frost, heavyRain, snow, hail]
    };
  }
}

module.exports = {
  MLEngine,
  defaultEngine: new MLEngine()
};
