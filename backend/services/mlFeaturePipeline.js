/**
 * AgroPasco — Módulo de Ingeniería de Características Meteorológicas
 * ====================================================================
 * FASE 8D: Procesa datos crudos de Open-Meteo (histórico de 7 días + pronóstico 72h)
 * y genera vectores de características idénticos a los utilizados durante el
 * entrenamiento de los modelos supervisados de heladas, lluvias intensas y nevadas.
 *
 * Principios estrictos:
 *  - Ausencia de fuga temporal (No Data Leakage): las variables lag y rolling se calculan
 *    exclusivamente sobre días estrictamente anteriores (t - 1, t - 2, ...).
 *  - Sin imputación silenciosa por cero: Si una variable indispensable no está disponible,
 *    se reporta explícitamente como faltante.
 *  - Unidades originales y zona horaria local (America/Lima).
 */

/**
 * Calcula el día del año (1 - 366) para una fecha dada en UTC.
 * @param {number} year
 * @param {number} month (1 - 12)
 * @param {number} day (1 - 31)
 * @returns {number}
 */
function calculateDayOfYear(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  return Math.floor((d.getTime() - startOfYear.getTime()) / 86400000) + 1;
}

/**
 * Agrega variables horarias por fecha (YYYY-MM-DD).
 * @param {object} hourlyData Objeto hourly de Open-Meteo
 * @returns {Map<string, object>} Mapa de fecha -> agregados diarios
 */
function aggregateHourlyByDate(hourlyData) {
  const map = new Map();
  if (!hourlyData || !Array.isArray(hourlyData.time)) {
    return map;
  }

  const times = hourlyData.time;
  const temps = hourlyData.temperature_2m || [];
  const humidities = hourlyData.relative_humidity_2m || [];
  const precips = hourlyData.precipitation || [];
  const soils = hourlyData.soil_moisture_0_to_7cm || [];

  const n = times.length;
  for (let i = 0; i < n; i++) {
    const rawTime = times[i];
    if (typeof rawTime !== 'string') continue;
    const dateStr = rawTime.slice(0, 10);

    let entry = map.get(dateStr);
    if (!entry) {
      entry = {
        temperatures: [],
        humidities: [],
        precipitations: [],
        soilMoistures: []
      };
      map.set(dateStr, entry);
    }

    const t = temps[i];
    if (typeof t === 'number' && Number.isFinite(t)) entry.temperatures.push(t);

    const h = humidities[i];
    if (typeof h === 'number' && Number.isFinite(h)) entry.humidities.push(h);

    const p = precips[i];
    if (typeof p === 'number' && Number.isFinite(p)) entry.precipitations.push(p);

    const s = soils[i];
    if (typeof s === 'number' && Number.isFinite(s)) entry.soilMoistures.push(s);
  }

  // Calcular agregados
  const aggregated = new Map();
  for (const [dateStr, entry] of map.entries()) {
    let humidity_mean = null;
    let humidity_min = null;
    let humidity_max = null;

    if (entry.humidities.length > 0) {
      let sumH = 0;
      let minH = Infinity;
      let maxH = -Infinity;
      for (const val of entry.humidities) {
        sumH += val;
        if (val < minH) minH = val;
        if (val > maxH) maxH = val;
      }
      humidity_mean = sumH / entry.humidities.length;
      humidity_min = minH;
      humidity_max = maxH;
    }

    let soil_moisture_mean = null;
    if (entry.soilMoistures.length > 0) {
      let sumS = 0;
      for (const val of entry.soilMoistures) {
        sumS += val;
      }
      soil_moisture_mean = sumS / entry.soilMoistures.length;
    }

    aggregated.set(dateStr, {
      humidity_mean,
      humidity_min,
      humidity_max,
      soil_moisture_mean
    });
  }

  return aggregated;
}

/**
 * Calcula ventanas móviles anteriores (shift 1).
 * IMPORTANTE: Para calcular la ventana de un día en índice k, se toman
 * estrictamente los días anteriores [k - windowSize ... k - 1].
 */
function calculateRollingWindow(array, startIdx, endIdx, mode = 'mean') {
  if (startIdx > endIdx || startIdx < 0 || endIdx >= array.length) {
    return null;
  }
  let sum = 0;
  let count = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const val = array[i];
    if (typeof val === 'number' && Number.isFinite(val)) {
      sum += val;
      count++;
    } else {
      return null; // Si falta algún valor dentro de la ventana, no inventar
    }
  }
  if (count === 0) return null;
  return mode === 'mean' ? sum / count : sum;
}

/**
 * Valida si un objeto de características cumple con los requisitos del modelo dado.
 * @param {object} features Dict de características
 * @param {string[]} requiredFeatures Lista de variables requeridas
 * @returns {{ complete: boolean, missing: string[] }}
 */
function checkFeatureCompleteness(features, requiredFeatures) {
  const missing = [];
  if (!features || typeof features !== 'object') {
    return { complete: false, missing: requiredFeatures.slice() };
  }

  for (const feat of requiredFeatures) {
    const val = features[feat];
    if (val === undefined || val === null || typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      missing.push(feat);
    }
  }

  return {
    complete: missing.length === 0,
    missing
  };
}

/**
 * Construye los vectores diarios de características para los días de pronóstico.
 *
 * @param {object} forecastData Respuesta JSON de Open-Meteo
 * @param {number|null} altitudeMasl Altitud de la parcela (si está registrada)
 * @returns {Array<object>} Lista de objetos con características por cada día de pronóstico
 */
function buildDailyFeatures(forecastData, altitudeMasl = null) {
  if (!forecastData || typeof forecastData !== 'object') {
    throw new Error('Respuesta meteorológica inválida o ausente.');
  }

  const daily = forecastData.daily || {};
  const dates = daily.time || [];
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new Error('No se encontraron fechas de pronóstico diario en la respuesta meteorológica.');
  }

  // Resolver elevación (prioridad: altitud de parcela > elevación del modelo topográfico Open-Meteo)
  let elevation = null;
  if (typeof altitudeMasl === 'number' && Number.isFinite(altitudeMasl) && altitudeMasl > 0) {
    elevation = altitudeMasl;
  } else if (typeof forecastData.elevation === 'number' && Number.isFinite(forecastData.elevation)) {
    elevation = forecastData.elevation;
  }

  const hourlyAgg = aggregateHourlyByDate(forecastData.hourly || {});

  // Identificar división entre días pasados y días futuros
  // Estándar Open-Meteo con past_days=7 y forecast_days=3:
  // dates.length suele ser 10 (7 pasados + 3 futuros).
  // Si se envían menos de 4 días en total, no hay histórico suficiente para ventanas de 7 días.
  const forecastDaysCount = Math.min(3, dates.length);
  const pastDaysCount = Math.max(0, dates.length - forecastDaysCount);

  const forecastFeaturesList = [];

  for (let k = pastDaysCount; k < dates.length; k++) {
    const dateStr = dates[k];
    const [year, month, day] = dateStr.split('-').map(Number);
    const day_of_year = calculateDayOfYear(year, month, day);
    const is_winter = (month === 6 || month === 7 || month === 8) ? 1.0 : 0.0;
    const is_dry_season = (month >= 5 && month <= 9) ? 1.0 : 0.0;

    const tMin = daily.temperature_2m_min?.[k] ?? null;
    const tMax = daily.temperature_2m_max?.[k] ?? null;
    let tMean = daily.temperature_2m_mean?.[k] ?? null;
    if (tMean === null && tMin !== null && tMax !== null) {
      tMean = (tMin + tMax) / 2.0;
    }

    const temp_range = (tMax !== null && tMin !== null) ? tMax - tMin : null;
    const precip_sum = daily.precipitation_sum?.[k] ?? null;
    const rain_sum = daily.rain_sum?.[k] ?? precip_sum;
    const wind_max = daily.wind_speed_10m_max?.[k] ?? null;
    const et0 = daily.et0_fao_evapotranspiration?.[k] ?? null;

    // Lags (del día anterior k - 1)
    let temp_min_lag1 = null;
    let temp_max_lag1 = null;
    let precip_lag1 = null;

    if (k > 0) {
      temp_min_lag1 = daily.temperature_2m_min?.[k - 1] ?? null;
      temp_max_lag1 = daily.temperature_2m_max?.[k - 1] ?? null;
      precip_lag1 = daily.precipitation_sum?.[k - 1] ?? null;
    }

    // Ventanas móviles estrictamente anteriores (sin incluir el día k)
    // Rolling 3d: días [k - 3 .. k - 1]
    const temp_min_rolling_3d = (k >= 3)
      ? calculateRollingWindow(daily.temperature_2m_min, k - 3, k - 1, 'mean')
      : null;
    const temp_max_rolling_3d = (k >= 3)
      ? calculateRollingWindow(daily.temperature_2m_max, k - 3, k - 1, 'mean')
      : null;
    const precip_rolling_3d = (k >= 3)
      ? calculateRollingWindow(daily.precipitation_sum, k - 3, k - 1, 'sum')
      : null;

    // Rolling 7d: días [k - 7 .. k - 1]
    const temp_min_rolling_7d = (k >= 7)
      ? calculateRollingWindow(daily.temperature_2m_min, k - 7, k - 1, 'mean')
      : null;
    const precip_rolling_7d = (k >= 7)
      ? calculateRollingWindow(daily.precipitation_sum, k - 7, k - 1, 'sum')
      : null;

    // Agregados horarios del día k
    const hourlyValues = hourlyAgg.get(dateStr) || {};
    const humidity_mean = hourlyValues.humidity_mean ?? null;
    const humidity_min = hourlyValues.humidity_min ?? null;
    const humidity_max = hourlyValues.humidity_max ?? null;
    const soil_moisture_mean = hourlyValues.soil_moisture_mean ?? null;

    forecastFeaturesList.push({
      date: dateStr,
      day_index: k - pastDaysCount,
      // Variables
      temperature_2m_mean: tMean,
      temperature_2m_min: tMin,
      temperature_2m_max: tMax,
      temp_range,
      precipitation_sum: precip_sum,
      rain_sum,
      wind_speed_10m_max: wind_max,
      et0_fao_evapotranspiration: et0,
      elevation,
      month,
      day_of_year,
      is_winter,
      is_dry_season,
      temp_min_lag1,
      temp_max_lag1,
      precip_lag1,
      temp_min_rolling_3d,
      temp_max_rolling_3d,
      temp_min_rolling_7d,
      precip_rolling_3d,
      precip_rolling_7d,
      humidity_mean,
      humidity_min,
      humidity_max,
      soil_moisture_mean
    });
  }

  return forecastFeaturesList;
}

module.exports = {
  calculateDayOfYear,
  aggregateHourlyByDate,
  calculateRollingWindow,
  checkFeatureCompleteness,
  buildDailyFeatures
};
