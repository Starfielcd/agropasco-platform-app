/**
 * AgroPasco — Controlador de IA / Recomendaciones
 */

const { getRecommendations, assessFrostRisk, getIrrigationPlan } = require('../services/aiService');

async function recommend(req, res) {
  try {
    const result = await getRecommendations(req.params.cropId);
    if (result.error) {
      return res.status(404).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Error en recomendaciones IA:', err);
    res.status(500).json({ success: false, error: 'Error al generar recomendaciones.' });
  }
}

async function frostRisk(req, res) {
  try {
    const result = await assessFrostRisk();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al evaluar riesgo de helada.' });
  }
}

async function irrigationPlan(req, res) {
  try {
    const result = await getIrrigationPlan(req.params.cropId);
    if (result.error) {
      return res.status(404).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al generar plan de riego.' });
  }
}

module.exports = { recommend, frostRisk, irrigationPlan };
