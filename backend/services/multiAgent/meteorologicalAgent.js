/**
 * AgroPasco Digital — Agente 2: Meteorológico (Fase 6)
 * ====================================================
 * Responsabilidad:
 *  - Consultar pronósticos de alta resolución en Open-Meteo API.
 *  - Validar coordenadas geográficas, altitud y coherencia temporal en la Región Pasco.
 *  - Administrar caché persistente para respetar límites de tasa y optimizar costos.
 *  - Detectar datos meteorológicos incompletos, faltantes o desactualizados.
 *  - Estructurar vectores de variables diarias para la inferencia de Machine Learning.
 *  - Registrar la procedencia de datos, fuentes y marcas de tiempo de consulta.
 */

const db = require('../../config/database');
const mlService = require('../mlService');
const weatherCacheService = require('../weatherCacheService');
const { buildDailyFeatures } = require('../mlFeaturePipeline');

class MeteorologicalAgent {
  constructor() {
    this.id = 'agent_meteorological';
    this.name = 'meteorological';
    this.displayName = 'Agente Meteorológico';
    this.version = '1.0.0';
    this.responsibility = 'Consulta y validación de pronósticos numéricos de alta resolución vía Open-Meteo API y caché compartida, verificación de coordenadas, altitud y frescura.';
  }

  /**
   * Ejecuta la tarea meteorológica para una parcela determinada
   * @param {object} params
   * @param {number} params.parcel_id ID de la parcela
   * @param {string} [params.task_id] ID de la tarea orquestada
   * @param {boolean} [params.force_refresh=false]
   * @returns {Promise<object>} Vector meteorológico estructurado y validado
   */
  async execute(params) {
    const { parcel_id, task_id = null, force_refresh = false } = params;
    const tStart = Date.now();

    if (!parcel_id) {
      throw new Error('[MeteorologicalAgent] Se requiere el parámetro parcel_id.');
    }

    // 1. Obtener y validar datos de la parcela
    const parcel = await db.dbGet(
      'SELECT id, user_id, name, center_lat AS latitude, center_lng AS longitude, altitude_masl, crop_type, created_at FROM parcels WHERE id = ?',
      [parcel_id]
    );

    if (!parcel) {
      throw new Error(`[MeteorologicalAgent] Parcela con ID ${parcel_id} no encontrada.`);
    }

    const lat = Number(parcel.latitude);
    const lng = Number(parcel.longitude);
    const altitude = Number(parcel.altitude_masl || 4337.0);

    // Validación geográfica de la Región Pasco (Límites aproximados: Lat [-11.5, -9.5], Lon [-77.0, -74.5])
    const isPascoGeo = lat >= -11.5 && lat <= -9.5 && lng >= -77.0 && lng <= -74.5;
    const isAltitudeValid = altitude >= 1000 && altitude <= 5200;

    const geoValidation = {
      parcel_id: parcel.id,
      parcel_name: parcel.name,
      crop_type: parcel.crop_type,
      latitude: lat,
      longitude: lng,
      altitude_masl: altitude,
      is_pasco_region: isPascoGeo,
      is_altitude_valid: isAltitudeValid,
      validation_passed: isPascoGeo && isAltitudeValid,
    };

    if (!geoValidation.validation_passed) {
      console.warn(`[MeteorologicalAgent] Advertencia: Coordenadas o altitud fuera de rango para Parcela ${parcel.id}: Lat ${lat}, Lng ${lng}, Alt ${altitude}m`);
    }

    // 2. Consulta resiliente con caché a Open-Meteo
    let forecastResult = null;
    let isCached = false;
    let cacheSource = 'open-meteo-live';

    if (!force_refresh) {
      const cached = await weatherCacheService.getSharedForecast(lat, lng, {
        allowStale: true,
        altitude,
        requireMlFeatures: true,
      });

      if (cached && cached.forecast && cached.forecast.hourly) {
        forecastResult = {
          success: true,
          forecast: cached.forecast,
          fromCache: true,
          isStale: cached.isStale || false,
        };
        isCached = true;
        cacheSource = cached.isStale ? 'open-meteo-shared-stale' : 'open-meteo-shared-cache';
      }
    }

    if (!forecastResult || !forecastResult.success) {
      // Consulta directa vía mlService con circuit breaker y retry
      forecastResult = await mlService.fetchOpenMeteoForecast(lat, lng, {
        includeHistory: true,
        parcelId: parcel.id,
      });
      isCached = false;
      cacheSource = 'open-meteo-live-api';
    }

    if (!forecastResult || !forecastResult.success || !forecastResult.forecast) {
      throw new Error(`[MeteorologicalAgent] No se pudo obtener datos meteorológicos para la parcela ${parcel.id}: ${forecastResult?.error || 'Respuesta vacía'}`);
    }

    const forecast = forecastResult.forecast;
    const hourly = forecast.hourly || {};
    const totalHourlyPoints = Array.isArray(hourly.time) ? hourly.time.length : 0;

    // 3. Verificación de integridad y completitud de datos
    const missingValues = {
      temperature_2m: (hourly.temperature_2m || []).filter(v => v === null || v === undefined || isNaN(v)).length,
      relative_humidity_2m: (hourly.relative_humidity_2m || []).filter(v => v === null || v === undefined || isNaN(v)).length,
      precipitation: (hourly.precipitation || []).filter(v => v === null || v === undefined || isNaN(v)).length,
    };

    const totalMissing = missingValues.temperature_2m + missingValues.relative_humidity_2m + missingValues.precipitation;
    const completenessPct = totalHourlyPoints > 0 
      ? Number((((totalHourlyPoints * 3 - totalMissing) / (totalHourlyPoints * 3)) * 100).toFixed(2))
      : 0;

    // 4. Construcción de vectores de características diarias (24h, 48h, 72h)
    let dailyFeatures = [];
    try {
      dailyFeatures = buildDailyFeatures(forecast, altitude);
    } catch (err) {
      console.warn('[MeteorologicalAgent] Error al construir características diarias:', err.message);
      dailyFeatures = [];
    }

    const durationMs = Date.now() - tStart;

    return {
      agent: this.name,
      agent_id: this.id,
      task_id,
      status: 'success',
      execution_time_ms: durationMs,
      timestamp: new Date().toISOString(),
      provenance: {
        source: 'Open-Meteo ERA5 / High-Resolution Numerical Forecast API',
        historical_dataset_reference: 'cerro_de_pasco_processed.csv (Periodo 2020-01-01 a 2026-09-26)',
        queried_at: new Date().toISOString(),
        cache_hit: isCached,
        cache_source: cacheSource,
      },
      parcel_validation: geoValidation,
      data_quality: {
        total_hourly_points: totalHourlyPoints,
        missing_values: missingValues,
        completeness_pct: completenessPct,
        freshness: isCached ? 'cached' : 'live_realtime',
        status: completenessPct >= 95 ? 'optimal' : 'degraded',
      },
      weather_features: {
        available_days: dailyFeatures.length,
        daily_features: dailyFeatures,
        current_observation: {
          temperature_2m: hourly.temperature_2m ? hourly.temperature_2m[hourly.temperature_2m.length - 1] : null,
          relative_humidity_2m: hourly.relative_humidity_2m ? hourly.relative_humidity_2m[hourly.relative_humidity_2m.length - 1] : null,
          precipitation: hourly.precipitation ? hourly.precipitation[hourly.precipitation.length - 1] : null,
        },
      },
    };
  }
}

module.exports = new MeteorologicalAgent();
