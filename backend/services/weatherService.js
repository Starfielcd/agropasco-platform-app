/**
 * AgroPasco — Servicio de Clima
 * Integración con OpenWeatherMap + fallback de datos simulados
 */

const { dbRun, dbGet } = require('../config/database');
const { mockWeatherData } = require('../data/advisory-knowledge');
const weatherCacheService = require('./weatherCacheService');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || 'TU_API_KEY_AQUI';
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Cerro de Pasco,PE';
const DEFAULT_LAT = process.env.DEFAULT_LAT || '-10.6868';
const DEFAULT_LON = process.env.DEFAULT_LON || '-76.2625';
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutos

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-10.6674&longitude=-76.2567&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,soil_temperature_0cm,soil_moisture_0_to_1cm,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FLima';

function formatWeatherObjectFromOpenMeteo(data, sourceTag = 'open-meteo-live') {
  const curr = data.current || {};
  const daily = data.daily || {};
  const hourly = data.hourly || {};
  const lastH = Array.isArray(hourly.time) && hourly.time.length > 0 ? hourly.time.length - 1 : -1;

  const temp = curr.temperature_2m ?? (lastH >= 0 && hourly.temperature_2m?.[lastH] !== undefined ? hourly.temperature_2m[lastH] : 4.5);
  const tempMin = daily.temperature_2m_min?.[0] ?? -2.0;
  const tempMax = daily.temperature_2m_max?.[0] ?? 12.0;
  const humidity = curr.relative_humidity_2m ?? (lastH >= 0 && hourly.relative_humidity_2m?.[lastH] !== undefined ? hourly.relative_humidity_2m[lastH] : 75);
  const soilTemp = curr.soil_temperature_0cm ?? 5.2;
  const soilMoist = curr.soil_moisture_0_to_1cm ?? (lastH >= 0 && hourly.soil_moisture_0_to_1cm?.[lastH] !== undefined ? hourly.soil_moisture_0_to_1cm[lastH] : 0.35);
  const uvIdx = curr.uv_index ?? 9.5;
  const rainProb = daily.precipitation_probability_max?.[0] ?? 20;

  return {
    name: 'Cerro de Pasco',
    coord: { lat: -10.6674, lon: -76.2567 },
    altitude: 4380,
    _source: sourceTag,
    temp_2m: temp,
    humidity: humidity,
    pressure: curr.surface_pressure ?? 620,
    wind_speed: curr.wind_speed_10m ?? 4.2,
    soil_temp_0cm: soilTemp,
    soil_moisture_1cm: soilMoist,
    uv_index: uvIdx,
    temp_min: tempMin,
    temp_max: tempMax,
    rain_prob: rainProb,
    condition: temp <= 0 ? 'Helada / Descenso térmico' : 'Cielo despejado',
    main: {
      temp: temp,
      temp_min: tempMin,
      temp_max: tempMax,
      humidity: humidity,
      pressure: curr.surface_pressure ?? 620,
      feels_like: temp - 2.0
    },
    soil: {
      temp: soilTemp,
      moisture: soilMoist
    },
    uv_index: uvIdx,
    wind: { speed: curr.wind_speed_10m ?? 4.2, deg: 180 },
    weather: [{
      id: 800,
      main: 'Clear',
      description: temp <= 0 ? 'Helada / Descenso térmico' : 'Cielo despejado',
      icon: '01d'
    }]
  };
}

async function getCurrentWeather() {
  // 1. Check local weather cache first
  const cached = await getCachedWeather('current');
  if (cached) return cached;

  // 2. Check if a fresh or stale shared raw forecast exists in weatherCacheService
  const shared = await weatherCacheService.getSharedForecast(-10.6674, -76.2567, {
    allowStale: true,
    altitude: 4380
  });
  if (shared && shared.forecast) {
    const weatherObj = formatWeatherObjectFromOpenMeteo(
      shared.forecast,
      shared.isStale ? 'open-meteo-shared-stale' : 'open-meteo-shared-cache'
    );
    await cacheWeather('current', weatherObj);
    return weatherObj;
  }

  // 3. Query Open-Meteo Live API si no hay rate limit activo
  let mlService;
  try {
    mlService = require('./mlService');
  } catch (_) {}

  const isRateLimited = mlService?.isRateLimitActive ? mlService.isRateLimitActive() : false;

  if (!isRateLimited) {
    try {
      const inFlightKey = 'shared_weather_cerro_de_pasco';
      const weatherObj = await weatherCacheService.singleFlight(inFlightKey, async () => {
        weatherCacheService.recordMetric('outgoing', { module: 'weather' });
        const response = await fetch(OPEN_METEO_URL);
        if (response.ok) {
          const data = await response.json();
          weatherCacheService.recordMetric('success');
          await weatherCacheService.saveSharedForecast(-10.6674, -76.2567, data, {
            altitude: 4380,
            scope: 'standard'
          });
          return formatWeatherObjectFromOpenMeteo(data, 'open-meteo-live');
        } else if (response.status === 429 && mlService?.tripRateLimit) {
          weatherCacheService.recordMetric('http_429', { reason: 'HTTP 429 en weatherService' });
          let retryMs = 60000;
          if (typeof mlService.parseRetryAfter === 'function') {
            const retryHeader = response.headers?.get ? response.headers.get('retry-after') : null;
            const parsed = mlService.parseRetryAfter(retryHeader);
            if (parsed !== null && parsed > 0) retryMs = parsed;
          }
          mlService.tripRateLimit(retryMs, 'HTTP 429 en weatherService');
          return null;
        }
        return null;
      });

      if (weatherObj) {
        await cacheWeather('current', weatherObj);
        return weatherObj;
      }
    } catch (err) {
      console.warn('⚠️ Error al consultar Open-Meteo API:', err.message);
    }
  }

  // Fallback: simulated data with realistic variations
  const simulated = generateRealisticWeather();
  simulated._source = 'simulated';
  simulated._note = 'Datos simulados realistas para Cerro de Pasco (4380 msnm).';
  return simulated;
}

function formatDailyForecastFromOpenMeteo(daily) {
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return null;
  const days = [];
  const times = daily.time.slice(0, 5);
  for (let i = 0; i < times.length; i++) {
    const minT = daily.temperature_2m_min?.[i] ?? 0;
    const maxT = daily.temperature_2m_max?.[i] ?? 10;
    const rainP = daily.precipitation_probability_max?.[i] ?? 10;
    days.push({
      date: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `Día ${i + 1}`,
      raw_date: times[i],
      temp_min: minT,
      temp_max: maxT,
      humidity: 70,
      condition: minT <= 0 ? 'Helada / Frío extremo' : rainP > 50 ? 'Lluvias probables' : 'Nublado parcial',
      rain_prob: rainP,
      icon: getWeatherIcon(minT, rainP)
    });
  }
  return days;
}

async function getForecast() {
  const cached = await getCachedWeather('forecast');
  if (cached) return cached;

  // 1. Reutilizar pronóstico diario de Open-Meteo compartido si existe
  const shared = await weatherCacheService.getSharedForecast(-10.6674, -76.2567, {
    allowStale: true,
    altitude: 4380
  });
  if (shared?.forecast?.daily) {
    const openMeteoDays = formatDailyForecastFromOpenMeteo(shared.forecast.daily);
    if (openMeteoDays && openMeteoDays.length > 0) {
      await cacheWeather('forecast', openMeteoDays);
      return openMeteoDays;
    }
  }

  if (WEATHER_API_KEY && WEATHER_API_KEY !== 'TU_API_KEY_AQUI') {
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${DEFAULT_LAT}&lon=${DEFAULT_LON}&appid=${WEATHER_API_KEY}&units=metric&lang=es&cnt=40`
      );
      if (response.ok) {
        const data = await response.json();
        const dailyForecast = processForecast(data);
        await cacheWeather('forecast', dailyForecast);
        return dailyForecast;
      }
    } catch (err) {
      console.warn('⚠️ Error al consultar pronóstico:', err.message);
    }
  }

  // Fallback
  return mockWeatherData.forecast;
}

function processForecast(rawData) {
  const days = {};
  rawData.list.forEach(item => {
    const date = item.dt_txt.split(' ')[0];
    if (!days[date]) {
      days[date] = { temps: [], humidity: [], conditions: [], rain_probs: [] };
    }
    days[date].temps.push(item.main.temp);
    days[date].humidity.push(item.main.humidity);
    days[date].conditions.push(item.weather[0].description);
    days[date].rain_probs.push(item.pop * 100);
  });

  return Object.entries(days).slice(0, 5).map(([date, data], index) => ({
    date: index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : `Día ${index + 1}`,
    raw_date: date,
    temp_min: Math.min(...data.temps),
    temp_max: Math.max(...data.temps),
    humidity: Math.round(data.humidity.reduce((a, b) => a + b, 0) / data.humidity.length),
    condition: data.conditions[Math.floor(data.conditions.length / 2)],
    rain_prob: Math.round(Math.max(...data.rain_probs)),
    icon: getWeatherIcon(Math.min(...data.temps), Math.max(...data.rain_probs))
  }));
}

function generateRealisticWeather() {
  const hour = new Date().getHours();
  const month = new Date().getMonth();

  // Cerro de Pasco: temperature varies by time and season
  const isWinter = month >= 5 && month <= 8; // Jun-Sep is dry/cold
  const baseTemp = isWinter ? 2 : 6;
  const hourFactor = hour >= 6 && hour <= 14 ? 8 : hour >= 15 && hour <= 18 ? 4 : -2;

  const temp = baseTemp + hourFactor + (Math.random() * 4 - 2);
  const humidity = isWinter ? 55 + Math.random() * 20 : 70 + Math.random() * 20;

  const conditions = isWinter
    ? ['cielo despejado', 'nubes dispersas', 'algo de nubes']
    : ['nubes dispersas', 'lluvia ligera', 'nubes', 'lluvia moderada'];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];

  return {
    name: 'Cerro de Pasco',
    coord: { lat: parseFloat(DEFAULT_LAT), lon: parseFloat(DEFAULT_LON) },
    main: {
      temp: Math.round(temp * 10) / 10,
      feels_like: Math.round((temp - 2.5) * 10) / 10,
      humidity: Math.round(humidity),
      pressure: 618 + Math.round(Math.random() * 6),
      temp_min: Math.round((baseTemp - 3 + Math.random() * 2) * 10) / 10,
      temp_max: Math.round((baseTemp + 10 + Math.random() * 3) * 10) / 10
    },
    weather: [{ id: 802, main: 'Clouds', description: condition, icon: '03d' }],
    wind: { speed: Math.round((3 + Math.random() * 5) * 10) / 10, deg: Math.round(Math.random() * 360) },
    visibility: condition.includes('lluvia') ? 5000 : 10000,
    altitude: 4380
  };
}

function getWeatherIcon(tempMin, rainProb) {
  if (tempMin <= -2) return '🥶';
  if (tempMin <= 0) return '❄️';
  if (rainProb > 60) return '🌧️';
  if (rainProb > 30) return '⛈️';
  return '⛅';
}

function generateAlerts(weather, forecast, simulatedType = null) {
  const alerts = [];
  const temp = weather.main?.temp ?? weather.temp ?? 4;
  const tempMin = weather.main?.temp_min ?? temp - 3;
  const humidity = weather.main?.humidity ?? 70;
  const condition = (weather.weather?.[0]?.description || '').toLowerCase();

  // If simulation requested:
  if (simulatedType === 'helada' || tempMin <= 0) {
    alerts.push({
      type: 'alerta_helada',
      severity: 'critical',
      title: '🥶 ALERTA CRÍTICA DE HELADA (< 0°C)',
      message: `Temperatura extrema registrada de ${tempMin <= 0 ? tempMin : -3.5}°C en Cerro de Pasco. Riesgo alto de congelamiento de follaje en tubérculos y brotes jóvenes.`,
      actions: [
        'Activar riego por aspersión antes del amanecer (3:00 - 5:00 AM) para liberar calor latente.',
        'Colocar mantas térmicas, agrotela o paja sobre parcelas de papa, quinua y maca.',
        'Generar humo controlado en bordes del campo usando fogatas con paja húmeda.',
        'Aplicar bioestimulantes de aminoácidos y fósforo al reaparecer el sol.'
      ]
    });
  } else if (tempMin <= 3) {
    alerts.push({
      type: 'alerta_helada',
      severity: 'warning',
      title: '⚠️ PRE-ALERTA DE DESCENSO TÉRMICO',
      message: `Temperatura mínima proyectada en ${tempMin}°C. Posible helada ligera durante la madrugada.`,
      actions: [
        'Revisar disponibilidad de coberturas de plástico y agrotela.',
        'Verificar el funcionamiento de aspersores y motobombas.',
        'Postergar abonado de nitrógeno soluble para evitar rebrote tierno susceptible.'
      ]
    });
  }

  if (simulatedType === 'radiacion' || temp > 18) {
    alerts.push({
      type: 'alerta_radiacion',
      severity: 'warning',
      title: '☀️ ALERTA DE RADIACIÓN SOLAR ALTA / GOLPE DE CALOR',
      message: `Temperatura de ${temp}°C a 4,380 msnm con índice UV extremadamente alto (>11). Riesgo de deshidratación celular e inburn foliar.`,
      actions: [
        'Incrementar frecuencia de riego ligero al amanecer para reducir evapotranspiración.',
        'Aplicar caolín (arcilla blanca) o bio-protectores reflectantes al follaje.',
        'Proteger viveros y platabandas con malla sombra al 50%.',
        'Evitar deshierbes drásticos que expongan el cuello de la planta al sol directo.'
      ]
    });
  }

  if (simulatedType === 'granizo' || condition.includes('granizo') || (humidity > 85 && condition.includes('lluvia'))) {
    alerts.push({
      type: 'alerta_granizo',
      severity: 'critical',
      title: '🌩️ ALERTA DE LLUVIAS INTENSAS Y GRANIZO',
      message: `Humedad de ${humidity}% con desarrollo nuboso vertical. Riesgo inminente de granizada y erosión de surcos.`,
      actions: [
        'Instalar mallas antigranizo de monofilamento sobre cultivos de alto valor.',
        'Despejar y profundizar zanjas de coronación y canales de drenaje principal.',
        'Postergar aplicación de fertilizantes foliares hasta pasada la tormenta.',
        'Tras el granizo: aplicar caldo bordelés o azufre para cicatrizar heridas en tallos.'
      ]
    });
  }

  if (simulatedType === 'sequia' || (humidity < 40 && tempMin > 4)) {
    alerts.push({
      type: 'alerta_sequia',
      severity: 'warning',
      title: '🏜️ ALERTA DE SEQUÍA Y ESTRÉS HÍDRICO',
      message: `Humedad atmosférica crítica de ${humidity}%. Déficit hídrico acumulado amenaza la floración y tuberización.`,
      actions: [
        'Aplicar mulching (cobertura vegetativa muerta) en la base de las plantas.',
        'Priorizar el riego por goteo o surcos intercalados cada 4-5 días.',
        'Aplicar materia orgánica bien compostada para retener humedad en el perfil.',
        'Monitorear presencia de arañita roja y trips favorecidos por la sequedad.'
      ]
    });
  }

  // Check forecast for upcoming threats
  if (forecast && Array.isArray(forecast)) {
    forecast.forEach(day => {
      if (day.temp_min <= -2 && day.date !== 'Hoy') {
        alerts.push({
          type: 'alerta_helada',
          severity: 'warning',
          title: `❄️ HELADA EN PRONÓSTICO — ${day.date}`,
          message: `Se prevé descenso térmico a ${day.temp_min}°C en ${day.date}. Preparar defensas activas.`,
          actions: ['Revisar stock de mantas agrícolas', 'Asegurar operatividad de riego', 'Monitorear boletín senamhi']
        });
      }
    });
  }

  return alerts;
}

async function getCachedWeather(type) {
  try {
    const row = await dbGet(
      'SELECT data_json, fetched_at FROM weather_cache WHERE location = ? AND data_type = ? ORDER BY fetched_at DESC LIMIT 1',
      [DEFAULT_CITY, type]
    );
    if (row) {
      const fetchedAt = new Date(row.fetched_at).getTime();
      if (Date.now() - fetchedAt < CACHE_DURATION_MS) {
        return JSON.parse(row.data_json);
      }
    }
  } catch (err) {
    // Cache miss is ok
  }
  return null;
}

async function cacheWeather(type, data) {
  try {
    await dbRun(
      'INSERT INTO weather_cache (location, data_type, data_json) VALUES (?, ?, ?)',
      [DEFAULT_CITY, type, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn('⚠️ Error al cachear datos de clima:', err.message);
  }
}

module.exports = { getCurrentWeather, getForecast, generateAlerts };
