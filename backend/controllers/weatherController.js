/**
 * AgroPasco — Controlador de Clima
 */

const { getCurrentWeather, getForecast, generateAlerts } = require('../services/weatherService');
const { dbAll } = require('../config/database');

async function getCurrent(req, res) {
  try {
    const weather = await getCurrentWeather();
    res.json({ success: true, data: weather });
  } catch (err) {
    console.error('Error al obtener clima:', err);
    res.status(500).json({ success: false, error: 'Error al obtener datos climáticos.' });
  }
}

async function getForecastData(req, res) {
  try {
    const forecast = await getForecast();
    res.json({ success: true, data: forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener pronóstico.' });
  }
}

async function getAlerts(req, res) {
  try {
    const weather = await getCurrentWeather();
    const simType = req.query.sim || null;
    const alerts = generateAlerts(weather, forecast, simType);

    res.json({
      success: true,
      data: {
        alerts,
        total: alerts.length,
        has_critical: alerts.some(a => a.severity === 'critical'),
        weather_summary: {
          temp: weather.main?.temp,
          temp_min: weather.main?.temp_min,
          humidity: weather.main?.humidity,
          condition: weather.weather?.[0]?.description
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al generar alertas.' });
  }
}

async function getWeatherHistory(req, res) {
  try {
    const cropId = req.params.cropId;

    // Get weather snapshots from crop logs
    const logs = await dbAll(
      `SELECT cl.created_at, cl.weather_snapshot, cl.action_type, cl.description
       FROM crop_logs cl
       WHERE cl.crop_id = ? AND cl.weather_snapshot IS NOT NULL
       ORDER BY cl.created_at ASC`,
      [cropId]
    );

    const history = logs.map(log => ({
      date: log.created_at,
      action: log.action_type,
      description: log.description,
      weather: JSON.parse(log.weather_snapshot)
    }));

    res.json({ success: true, data: history, total: history.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener historial climático.' });
  }
}

module.exports = { getCurrent, getForecastData, getAlerts, getWeatherHistory };
