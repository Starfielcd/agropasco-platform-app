/**
 * AgroPasco Digital — Registro Centralizado y Versionado de Modelos ML
 * ====================================================================
 * Fuente única de verdad para la selección, algoritmos y versiones
 * de modelos de Machine Learning meteorológico por parcela.
 *
 * Justificación de selección:
 *  - Heladas (frost): LogisticRegression (v2.0.0_audited_no_leak).
 *    Seleccionado por su comportamiento parsimonioso, estabilidad numérica en
 *    datos normalizados y excelente calibración de probabilidades en split temporal
 *    sin riesgo de sobreajuste ante amplitudes térmicas extremas (>20°C).
 *  - Lluvias Intensas (heavy_rain): RandomForestClassifier (v2.0.0_audited_no_leak).
 *    Seleccionado por capturar umbrales abruptos de precipitación no lineales.
 *  - Nevadas (snow): LogisticRegression (v2.0.0_audited_no_leak).
 *    Seleccionado por su frontera sigmoidal clara en función de altitud y punto de congelación.
 *  - Granizadas (hail): DeterministicPhysicalRule (v1.0.0_provisional_rule).
 *    Regla física determinista debido a que el reanálisis ERA5 no registra horas de granizo
 *    (códigos WMO 96-99) en la serie histórica 2019-2025 para Cerro de Pasco.
 */

const MODEL_REGISTRY = {
  frost: {
    phenomenon: 'frost',
    name: 'Heladas Radiantes y Advectivas',
    algorithm: 'LogisticRegression',
    model_family: 'linear_model',
    version: '2.0.0_audited_no_leak',
    is_supervised_ml: true,
    file_artifact: 'frost_model.json',
    n_features: 18,
    scaler_type: 'StandardScaler',
    calibration_method: 'Sigmoid Logistic Loss',
    selection_rationale: 'Modelo parsimonioso seleccionado en Fase 2 tras comparación rigurosa de 5 algoritmos. Evita el sobreajuste de modelos complejos en la sierra altoandina y garantiza estabilidad en inferencia.',
    risk_thresholds: { high: 0.70, moderate: 0.40, low: 0.15 },
  },
  heavy_rain: {
    phenomenon: 'heavy_rain',
    name: 'Lluvias Intensas y Torrenciales',
    algorithm: 'RandomForestClassifier',
    model_family: 'ensemble_trees',
    version: '2.0.0_audited_no_leak',
    is_supervised_ml: true,
    file_artifact: 'heavy_rain_model.json',
    n_features: 18,
    scaler_type: 'StandardScaler',
    calibration_method: 'Tree Voting Probability',
    selection_rationale: 'Ensamble de árboles de decisión que captura interacciones no lineales entre humedad relativa y precipitación acumulada en microcuencas.',
    risk_thresholds: { high: 0.70, moderate: 0.40, low: 0.15 },
  },
  snow: {
    phenomenon: 'snow',
    name: 'Nevadas en Puna Altoandina',
    algorithm: 'LogisticRegression',
    model_family: 'linear_model',
    version: '2.0.0_audited_no_leak',
    is_supervised_ml: true,
    file_artifact: 'snow_model.json',
    n_features: 18,
    scaler_type: 'StandardScaler',
    calibration_method: 'Sigmoid Logistic Loss',
    selection_rationale: 'Frontera de decisión robusta anclada a la cota de congelación (>3,800 msnm) y presencia simultánea de precipitación.',
    risk_thresholds: { high: 0.70, moderate: 0.40, low: 0.15 },
  },
  hail: {
    phenomenon: 'hail',
    name: 'Granizadas Convectivas',
    algorithm: 'DeterministicPhysicalRule',
    model_family: 'heuristic_rule',
    version: '1.0.0_provisional_rule',
    is_supervised_ml: false,
    file_artifact: null,
    n_features: 4,
    scaler_type: 'None',
    calibration_method: 'Atmospheric Convective Instability Index',
    selection_rationale: 'Reglas físicas deterministas provisionales basadas en inestabilidad térmica vertical y alta humedad. No existe modelo supervisado validado por ausencia de eventos WMO 96-99 en ERA5 para Pasco.',
    risk_thresholds: { high: 0.60, moderate: 0.30, low: 0.15 },
  },
};

/**
 * Obtiene la configuración oficial del modelo para un fenómeno
 * @param {string} phenomenon
 * @returns {object}
 */
function getActiveModel(phenomenon) {
  return MODEL_REGISTRY[phenomenon] || null;
}

/**
 * Obtiene el inventario completo de modelos registrados
 * @returns {object}
 */
function getAllActiveModels() {
  return { ...MODEL_REGISTRY };
}

module.exports = {
  MODEL_REGISTRY,
  getActiveModel,
  getAllActiveModels,
  getModelMetadata: getActiveModel,
};

