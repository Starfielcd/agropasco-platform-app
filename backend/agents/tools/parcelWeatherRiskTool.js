/**
 * AgroPasco Digital — Herramienta del Agente: get_parcel_weather_risk
 * ==============================================================================
 * Herramienta de solo lectura que consulta información meteorológica y riesgos
 * agroclimáticos evaluados para una parcela autorizada del agricultor autenticado.
 *
 * Principios:
 *  - Cero escrituras en BD (solo lectura)
 *  - Control de acceso RBAC estricto (anti-IDOR: solo parcelas propias o supervisadas)
 *  - Cero inventiva de datos: reporta estado 'fresh', 'stale' o 'missing_weather'
 *  - Cero PII: no expone nombres personales, DNI, teléfono ni coordenadas GPS exactas
 */

'use strict';

const { buildAgriculturalContext } = require('../../services/aiContextBuilder');

const PARCEL_WEATHER_RISK_DECLARATION = {
  name: 'get_parcel_weather_risk',
  description: 'Consulta los datos meteorológicos recientes, nivel de frescura y riesgos agroclimáticos evaluados (helada, nieve, lluvia intensa) para una parcela autorizada del agricultor.',
  parameters: {
    type: 'OBJECT',
    properties: {
      parcel_id: {
        type: 'INTEGER',
        description: 'Identificador numérico de la parcela a consultar (ejemplo: 101).'
      }
    },
    required: ['parcel_id']
  }
};

/**
 * Ejecuta de forma segura y validada la herramienta de consulta meteorológica.
 *
 * @param {object} args Argumentos recibidos de Gemini (debe incluir parcel_id)
 * @param {object} authContext Contexto de autenticación del usuario { userId, userRole }
 * @param {object} [options] Inyecciones para pruebas aisladas
 * @returns {Promise<object>} Datos estructurados del pronóstico y riesgos
 */
async function executeParcelWeatherRiskTool(args = {}, authContext = {}, options = {}) {
  const { userId, userRole } = authContext;

  // 1. Validación estricta de argumentos (Anti-Injection)
  const rawId = args.parcel_id !== undefined ? args.parcel_id : args.parcelId;
  const parcelId = parseInt(rawId, 10);

  if (isNaN(parcelId) || parcelId <= 0 || !Number.isInteger(Number(rawId))) {
    return {
      success: false,
      error_code: 'INVALID_PARCEL_ARGUMENT',
      error: 'El argumento "parcel_id" es obligatorio y debe ser un número entero positivo.'
    };
  }

  // 2. Consulta de contexto con RBAC multi-tenant estricto
  const contextBuilderFn = options.buildContextFn || buildAgriculturalContext;
  let contextResult;
  try {
    contextResult = await contextBuilderFn({
      userId,
      userRole,
      parcelId
    });
  } catch (err) {
    return {
      success: false,
      error_code: 'CONTEXT_BUILDER_ERROR',
      error: `Error interno al consultar la parcela: ${err.message}`
    };
  }

  if (!contextResult || !contextResult.success) {
    const status = contextResult?.status || 404;
    return {
      success: false,
      error_code: status === 404 ? 'PARCEL_NOT_FOUND_OR_UNAUTHORIZED' : 'PARCEL_ACCESS_ERROR',
      error: contextResult?.error || 'Parcela no encontrada o no autorizada para el usuario actual.',
      authorized: false
    };
  }

  const llmCtx = contextResult.llm_context || {};
  const internalCtx = contextResult.internal_context || {};

  // 3. Estructuración normalizada para el Agente (sin PII)
  return {
    success: true,
    authorized: true,
    parcel_id: parcelId,
    parcel_name: internalCtx.parcel_name || ('Parcela #' + parcelId),
    crop_type: llmCtx.crop_type || 'general',
    variety: llmCtx.variety || 'no_especificada',
    phenological_stage: llmCtx.phenological_stage || null,
    altitude_masl: llmCtx.altitude_masl || null,
    approximate_zone: llmCtx.approximate_zone || 'Región Pasco',
    weather_status: llmCtx.weather_status,
    is_stale: Boolean(llmCtx.is_stale),
    forecast_date: llmCtx.forecast_fetched_at || null,
    forecast_valid_until: llmCtx.forecast_valid_until || null,
    temperature_current: llmCtx.temperature_current,
    temperature_min: llmCtx.temperature_min,
    temperature_max: llmCtx.temperature_max,
    risks: {
      frost_risk_percent: llmCtx.ml_frost_risk !== null ? Number(llmCtx.ml_frost_risk) : null,
      snow_risk_percent: llmCtx.ml_snow_risk !== null ? Number(llmCtx.ml_snow_risk) : null,
      heavy_rain_risk_percent: llmCtx.ml_heavy_rain_risk !== null ? Number(llmCtx.ml_heavy_rain_risk) : null,
      hail_risk_percent: llmCtx.ml_hail_risk !== null ? Number(llmCtx.ml_hail_risk) : null
    },
    data_source: llmCtx.weather_status === 'fresh'
      ? 'open_meteo_verified_cache'
      : (llmCtx.weather_status === 'stale' ? 'open_meteo_stale_cache' : 'no_cached_data'),
    warnings: contextResult.warnings || [],
    retrieved_at: new Date().toISOString()
  };
}

module.exports = {
  PARCEL_WEATHER_RISK_DECLARATION,
  executeParcelWeatherRiskTool
};
