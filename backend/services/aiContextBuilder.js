/**
 * AgroPasco Digital — Constructor de Contexto Agrícola para LLM
 * ==============================================================================
 * FASE 9-L04: Integración Segura de Parcelas, Cultivos y Predicciones ML
 *
 * Responsabilidades:
 *  - Recuperar información autorizada desde la base de datos (PostgreSQL/SQLite).
 *  - Aplicar control de acceso multi-tenant estricto (agricultor solo a lo suyo,
 *    asesores y administradores según la política vigente).
 *  - Consultar exclusivamente caché meteorológica preexistente de solo lectura
 *    (getCachedPrediction / getStalePrediction) respetando las garantías G24/G26/G28.
 *  - CERO llamadas a Open-Meteo, CERO inserciones/eliminaciones en weather_cache,
 *    CERO generación de alertas.
 *  - Tratar pronósticos stale con transparencia e incluir advertencia de frescura.
 *  - Minimización estricta de datos (exclusión de PII, DNI, teléfono, coordenadas
 *    exactas, nombres personales o tokens).
 *  - Soporte integral para todos los pisos ecológicos y distritos de Pasco
 *    (Cerro de Pasco, Yanahuanca, Oxapampa, Villa Rica, etc.).
 */

const db = require('../config/database');
const mlService = require('./mlService');
const pascoAdminGeo = require('./pascoAdminGeoService');

/**
 * Determina la zona geográfica/ecológica aproximada sin inventar datos ni usar coordenadas exactas.
 */
function resolveApproximateZone(parcel, userLocation = '') {
  // 1. Si la parcela cuenta con coordenadas o centroide, clasificar por límites territoriales oficiales
  const lat = parcel.center_lat ?? parcel.latitude;
  const lng = parcel.center_lng ?? parcel.longitude;
  const altitude = parcel.altitude_masl !== undefined && parcel.altitude_masl !== null
    ? Number(parcel.altitude_masl)
    : null;

  if (lat !== null && lng !== null && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
    const geoClas = pascoAdminGeo.classifyProvinceByCoordinates(Number(lat), Number(lng));
    if (geoClas.province === 'Oxapampa') {
      return 'Provincia de Oxapampa (Selva Alta / Valles Subtropicales)';
    } else if (geoClas.province === 'Daniel Alcides Carrión') {
      return 'Provincia Daniel Alcides Carrión (Valles Interandinos / Quechua)';
    } else if (geoClas.province === 'Pasco') {
      if (altitude !== null && altitude >= 3900) {
        return 'Cerro de Pasco y Altiplano Central (Meseta del Bombón, >3,900 msnm)';
      }
      return 'Provincia de Pasco (Valles y Quebradas Interandinas)';
    }
  }

  const textSources = `${parcel.name || ''} ${parcel.notes || ''} ${userLocation || ''}`.toLowerCase();

  // 2. Detección por topónimo conocido (evitando coincidencia espuria de 'paucar' con 'paucartambo')
  if (textSources.includes('oxapampa') || textSources.includes('villa rica') || textSources.includes('pozuzo') || textSources.includes('chontabamba')) {
    return 'Provincia de Oxapampa (Selva Alta / Valles Subtropicales)';
  }
  if (textSources.includes('paucartambo')) {
    return 'Cuencas y Valles Interandinos de Pasco (Paucartambo, Pasco)';
  }
  if (textSources.includes('yanahuanca') || textSources.includes('chacayán') || textSources.includes('chacayan') || textSources.includes('tusi') || textSources.includes('tapuc') || textSources.includes('tápuc')) {
    return 'Provincia Daniel Alcides Carrión (Valles Interandinos / Quechua)';
  }
  if (textSources.includes('huayllay') || textSources.includes('vicco') || textSources.includes('tinyahuarco') || textSources.includes('ninacaca')) {
    return 'Meseta del Bombón / Puna Alta (Pasco)';
  }
  if (textSources.includes('cerro de pasco') || textSources.includes('chaupimarca') || textSources.includes('yanacancha')) {
    return 'Cerro de Pasco y alrededores (Altiplano >4,000 msnm)';
  }
  if (textSources.includes('huariaca')) {
    return 'Cuencas y Valles Interandinos de Pasco (~2,800 - 3,200 msnm)';
  }

  // 3. Clasificación ecológica aproximada por altitud (si está disponible)
  if (altitude !== null) {
    if (altitude < 2200) {
      return 'Zona de Ceja de Selva / Selva Alta (<2,200 msnm, Pasco)';
    }
    if (altitude < 3800) {
      return 'Zona Quechua / Valles Interandinos (2,200 - 3,799 msnm, Pasco)';
    }
    if (altitude >= 3800) {
      return 'Zona Suni / Puna Altoandina (≥3,800 msnm, Pasco)';
    }
  }

  return 'Zona no determinada de la región Pasco';
}

/**
 * Normaliza y extrae las métricas numéricas de la predicción en caché (soporta Arrays y Objetos).
 */
function extractPredictionMetrics(rawCache) {
  if (!rawCache || typeof rawCache !== 'object') return null;

  const payload = rawCache.data && typeof rawCache.data === 'object' ? rawCache.data : rawCache;

  let frostRisk = null;
  let snowRisk = null;
  let rainRisk = null;
  let hailRisk = null;

  // Caso 1: predictions es un Array (formato estándar emitido por mlService)
  if (Array.isArray(payload.predictions)) {
    const frostPred = payload.predictions.find(p => p.phenomenon === 'frost');
    const snowPred = payload.predictions.find(p => p.phenomenon === 'snow');
    const rainPred = payload.predictions.find(p => p.phenomenon === 'heavy_rain');
    const hailPred = payload.predictions.find(p => p.phenomenon === 'hail');

    if (frostPred && frostPred.risk_score !== undefined) frostRisk = Number(frostPred.risk_score);
    if (snowPred && snowPred.risk_score !== undefined) snowRisk = Number(snowPred.risk_score);
    if (rainPred && rainPred.risk_score !== undefined) rainRisk = Number(rainPred.risk_score);
    if (hailPred && hailPred.risk_score !== undefined) hailRisk = Number(hailPred.risk_score);
  } else if (payload.predictions && typeof payload.predictions === 'object') {
    // Caso 2: predictions es un objeto con subobjetos por fenómeno
    frostRisk = payload.predictions.frost?.risk_score !== undefined ? Number(payload.predictions.frost.risk_score) : null;
    snowRisk = payload.predictions.snow?.risk_score !== undefined ? Number(payload.predictions.snow.risk_score) : null;
    rainRisk = payload.predictions.heavy_rain?.risk_score !== undefined ? Number(payload.predictions.heavy_rain.risk_score) : null;
    hailRisk = payload.predictions.hail?.risk_score !== undefined ? Number(payload.predictions.hail.risk_score) : null;
  }

  // Fallbacks para campos directos
  if (frostRisk === null && payload.frost_risk !== undefined) frostRisk = Number(payload.frost_risk);
  if (snowRisk === null && payload.snow_risk !== undefined) snowRisk = Number(payload.snow_risk);
  if (rainRisk === null && payload.heavy_rain_risk !== undefined) rainRisk = Number(payload.heavy_rain_risk);
  if (hailRisk === null && payload.hail_risk !== undefined) hailRisk = Number(payload.hail_risk);

  const snapshot = payload.weather_snapshot || {};
  const forecastSummary = payload.forecast_summary || {};

  const tempMin = snapshot.temp_min !== undefined
    ? snapshot.temp_min
    : (Array.isArray(forecastSummary.temp_min) && forecastSummary.temp_min.length > 0 ? forecastSummary.temp_min[0] : null);

  const tempMax = snapshot.temp_max !== undefined
    ? snapshot.temp_max
    : (Array.isArray(forecastSummary.temp_max) && forecastSummary.temp_max.length > 0 ? forecastSummary.temp_max[0] : null);

  const precip = snapshot.precipitation !== undefined
    ? snapshot.precipitation
    : (Array.isArray(forecastSummary.precipitation) && forecastSummary.precipitation.length > 0 ? forecastSummary.precipitation[0] : null);

  return {
    ml_frost_risk: frostRisk,
    ml_snow_risk: snowRisk,
    ml_heavy_rain_risk: rainRisk,
    ml_hail_risk: hailRisk,
    frost_risk_pct: frostRisk,
    frost_risk_level: frostRisk !== null ? (frostRisk >= 60 ? 'high' : frostRisk >= 30 ? 'moderate' : 'low') : null,
    heavy_rain_risk_pct: rainRisk,
    snow_risk_pct: snowRisk,
    hail_risk_pct: hailRisk,
    min_temp_c: tempMin,
    max_temp_c: tempMax,
    temperature_current: snapshot.temperature !== undefined ? snapshot.temperature : null,
    temperature_min: tempMin,
    temperature_max: tempMax,
    precipitation_sum: precip,
    valid_until: payload.valid_until || null,
    fetched_at: payload.fetched_at || payload.last_updated || payload.issued_at || null,
    prediction_source: payload.prediction_source || payload.source || (payload.is_stale ? 'cache_stale' : 'ml_trained')
  };
}

/**
 * Construye el contexto agronómico seguro a partir de las fuentes autorizadas de AgroPasco.
 *
 * @param {object} params
 * @param {number} params.userId ID del usuario procedente del JWT autenticado
 * @param {string} params.userRole Rol del usuario procedente del JWT autenticado
 * @param {number|null} [params.parcelId] ID de la parcela (opcional para consultas generales)
 * @returns {Promise<object>} Objeto de contexto validado y estructurado
 */
async function buildAgriculturalContext({ userId, userRole, parcelId = null }) {
  // 1. Caso de consulta general sin parcela asociada
  if (parcelId === null || parcelId === undefined) {
    return {
      success: true,
      has_parcel: false,
      parcel_id: null,
      data_adequacy: 'general_regional_query',
      weather_status: 'no_parcel_specified',
      warnings: [],
      internal_context: {
        user_id: userId,
        user_role: userRole,
        scope: 'regional_general'
      },
      llm_context: {
        crop_type: 'general',
        variety: 'no_especificada',
        phenological_stage: null,
        altitude_masl: null,
        approximate_zone: 'Región Pasco (general)',
        weather_status: 'no_parcel_specified',
        is_stale: false,
        metrics: null
      }
    };
  }

  // 2. Validación de identificador de parcela
  const cleanParcelId = parseInt(parcelId, 10);
  if (isNaN(cleanParcelId) || cleanParcelId <= 0) {
    return {
      success: false,
      error: 'ID de parcela inválido.',
      status: 400
    };
  }

  // 3. Consulta de parcela con RBAC multi-tenant estricto
  let parcelRow;
  const selectQuery = `
    SELECT p.*,
           c.id as linked_crop_id, c.name as crop_name, c.crop_type as crop_crop_type,
           c.variety, c.status as phenological_stage, c.area_hectares as crop_area,
           c.planting_date as crop_planting_date, c.altitude_masl as crop_altitude,
           u.location as farmer_location
    FROM parcels p
    LEFT JOIN crops c ON p.crop_id = c.id AND c.user_id = p.user_id
    LEFT JOIN users u ON p.user_id = u.id
  `;

  if (userRole === 'admin' || userRole === 'advisor') {
    // Administrador y Asesor Técnico acceden a parcelas regionales para supervisión
    parcelRow = await db.dbGet(`${selectQuery} WHERE p.id = ?`, [cleanParcelId]);
  } else {
    // Agricultor: acceso exclusivo a sus propias parcelas
    parcelRow = await db.dbGet(`${selectQuery} WHERE p.id = ? AND p.user_id = ?`, [cleanParcelId, userId]);
  }

  if (!parcelRow) {
    // 404 seguro: no divulga existencia ni permite enumeración de recursos ajenos
    return {
      success: false,
      error: 'Parcela no encontrada.',
      status: 404
    };
  }

  // 4. Normalización de atributos agronómicos
  const cropType = (parcelRow.crop_type || parcelRow.crop_crop_type || 'general').toLowerCase().trim();
  const variety = parcelRow.variety && parcelRow.variety.trim() ? parcelRow.variety.trim() : 'no_especificada';

  // Reglas estrictas de etapa fenológica (Fase 9-L05B):
  // Solo aceptar etapas fenológicas biológicas reales de cultivo ('sembrado', 'crecimiento', 'floracion', 'maduracion', 'cosechado').
  // Estados no fenológicos ('planificado', 'cancelado', 'activa') o ausencia de etapa se normalizan estrictamente a null.
  // PROHIBIDO inferir 'desarrollo_vegetativo', 'crecimiento' o usar el estado administrativo de la parcela como etapa.
  const VALID_PHENOLOGICAL_STAGES = new Set(['sembrado', 'crecimiento', 'floracion', 'maduracion', 'cosechado']);
  const rawStage = (parcelRow.phenological_stage || '').toLowerCase().trim();
  const phenologicalStage = VALID_PHENOLOGICAL_STAGES.has(rawStage) ? rawStage : null;
  const altitudeMasl = parcelRow.altitude_masl || parcelRow.altitude || parcelRow.crop_altitude || 4380;
  const approximateZone = resolveApproximateZone(parcelRow, parcelRow.farmer_location);

  // 5. Consulta meteorológica de SOLO LECTURA (garantías G24/G26/G28)
  const currentGeo = {
    lat: parcelRow.center_lat !== undefined && parcelRow.center_lat !== null ? parcelRow.center_lat : parcelRow.latitude,
    lng: parcelRow.center_lng !== undefined && parcelRow.center_lng !== null ? parcelRow.center_lng : parcelRow.longitude,
    altitude: altitudeMasl,
    geo_json: parcelRow.geo_json
  };

  const warnings = [];
  let weatherStatus = 'missing_weather';
  let isStale = false;
  let rawPrediction = null;

  // Intento 1: Caché meteorológica fresca vigente (1h ML / 5min reglas)
  try {
    rawPrediction = await mlService.getCachedPrediction(cleanParcelId, parcelRow.created_at, currentGeo);
    if (rawPrediction) {
      weatherStatus = 'fresh';
      isStale = false;
    }
  } catch (err) {
    rawPrediction = null;
  }

  // Intento 2: Si no hay fresca, intentar respaldo stale (hasta 24h, horizonte válido)
  if (!rawPrediction) {
    try {
      rawPrediction = await mlService.getStalePrediction(
        cleanParcelId,
        { fallback: 'ai_context_builder' },
        parcelRow.created_at,
        currentGeo
      );
      if (rawPrediction) {
        weatherStatus = 'stale';
        isStale = true;
        warnings.push('Atención: La información meteorológica utilizada corresponde a un respaldo previo en caché y debe tomarse con cautela.');
      }
    } catch (err) {
      rawPrediction = null;
    }
  }

  // Intento 2b: Si no hay predicción específica previa, verificar si el grid geográfico dispone de pronóstico compartido
  if (!rawPrediction && currentGeo.lat && currentGeo.lng) {
    try {
      const weatherCacheService = require('./weatherCacheService');
      const shared = await weatherCacheService.getSharedForecast(currentGeo.lat, currentGeo.lng, { allowStale: true });
      if (shared && shared.forecast) {
        weatherStatus = shared.isStale ? 'stale' : 'fresh';
        isStale = shared.isStale;
        const curr = shared.forecast.current || {};
        const daily = shared.forecast.daily || {};
        rawPrediction = {
          predictions: {},
          weather_snapshot: {
            temperature: curr.temperature_2m ?? null,
            temp_min: daily.temperature_2m_min?.[0] ?? null,
            temp_max: daily.temperature_2m_max?.[0] ?? null
          },
          valid_until: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          last_updated: shared.fetchedAt
        };
        if (shared.isStale) {
          warnings.push('Atención: La información meteorológica utilizada corresponde a un respaldo regional previo y debe tomarse con cautela.');
        }
      }
    } catch (_) {
      // Degradación silenciosa si la caché no está disponible
    }
  }

  // Intento 3: Sin información meteorológica válida
  if (!rawPrediction) {
    weatherStatus = 'missing_weather';
    isStale = false;
    warnings.push('No hay información meteorológica reciente en caché para esta parcela (estamos preparando la información). Las sugerencias se basan únicamente en pautas agronómicas generales.');
  }

  const metrics = extractPredictionMetrics(rawPrediction);
  const dataAdequacy = (weatherStatus === 'fresh' || weatherStatus === 'stale') ? 'complete' : 'missing_weather';

  // 6. Contexto Interno Autorizado (permanece en servidor)
  const internalContext = {
    parcel_id: parcelRow.id,
    parcel_name: parcelRow.name,
    user_id: parcelRow.user_id,
    user_role: userRole,
    created_at: parcelRow.created_at,
    altitude_masl: altitudeMasl,
    phenological_stage: phenologicalStage,
    weather_status: weatherStatus,
    is_stale: isStale
  };

  // 7. Contexto Sanitizado para el LLM (Minimización estricta de PII)
  // CERO nombres personales, CERO coordenadas exactas, CERO DNI, CERO teléfonos, CERO tokens
  const llmContext = {
    crop_type: cropType,
    variety,
    phenological_stage: phenologicalStage,
    altitude_masl: altitudeMasl,
    approximate_zone: approximateZone,
    weather_status: weatherStatus,
    is_stale: isStale,
    forecast_fetched_at: metrics ? metrics.fetched_at : null,
    forecast_valid_until: metrics ? metrics.valid_until : null,
    ml_frost_risk: metrics ? metrics.ml_frost_risk : null,
    ml_snow_risk: metrics ? metrics.ml_snow_risk : null,
    ml_heavy_rain_risk: metrics ? metrics.ml_heavy_rain_risk : null,
    ml_hail_risk: metrics ? metrics.ml_hail_risk : null,
    temperature_current: metrics ? metrics.temperature_current : null,
    temperature_min: metrics ? metrics.temperature_min : null,
    temperature_max: metrics ? metrics.temperature_max : null
  };

  return {
    success: true,
    has_parcel: true,
    parcel_id: parcelRow.id,
    data_adequacy: dataAdequacy,
    weather_status: weatherStatus,
    warnings,
    internal_context: internalContext,
    llm_context: llmContext
  };
}

module.exports = {
  buildAgriculturalContext,
  resolveApproximateZone,
  extractPredictionMetrics
};
