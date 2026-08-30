/**
 * AgroPasco — Controlador de Asesoría Agrícola
 */

const { dbAll } = require('../config/database');
const { cropCalendar, plantingGuides } = require('../data/advisory-knowledge');

async function getTips(req, res) {
  try {
    const { crop, category, condition, season } = req.query;

    let sql = 'SELECT * FROM advisory_tips WHERE 1=1';
    const params = [];

    if (crop) { sql += ' AND crop_type = ?'; params.push(crop); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (condition) { sql += ' AND condition = ?'; params.push(condition); }

    sql += ' ORDER BY crop_type, category';

    const tips = await dbAll(sql, params);

    // If no specific crop, also include general tips
    if (crop && crop !== 'general') {
      const generalTips = await dbAll(
        'SELECT * FROM advisory_tips WHERE crop_type = ? AND (category = ? OR ? IS NULL)',
        ['general', category || null, category || null]
      );
      tips.push(...generalTips);
    }

    res.json({
      success: true,
      data: tips,
      total: tips.length,
      filters_applied: { crop, category, condition, season }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener consejos.' });
  }
}

async function getEmergencyTips(req, res) {
  try {
    const emergencyTips = await dbAll(
      "SELECT * FROM advisory_tips WHERE category = 'proteccion' OR category = 'clima' ORDER BY crop_type",
    );

    res.json({
      success: true,
      data: emergencyTips,
      total: emergencyTips.length,
      note: 'Consejos de emergencia para protección de cultivos ante eventos climáticos adversos.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener consejos de emergencia.' });
  }
}

async function getCalendar(req, res) {
  try {
    const cropType = req.params.cropType;

    if (cropType && cropCalendar[cropType]) {
      const cal = cropCalendar[cropType];
      res.json({
        success: true,
        data: {
          crop_type: cropType,
          ...cal,
          current_month: new Date().toLocaleString('es-PE', { month: 'long' }),
          is_planting_season: cal.siembra.some(m =>
            m.toLowerCase().startsWith(new Date().toLocaleString('es-PE', { month: 'short' }).substring(0, 3))
          ),
          is_harvest_season: cal.cosecha.some(m =>
            m.toLowerCase().startsWith(new Date().toLocaleString('es-PE', { month: 'short' }).substring(0, 3))
          )
        }
      });
    } else {
      // Return all calendars
      const allCalendars = Object.entries(cropCalendar).map(([type, cal]) => ({
        crop_type: type, ...cal
      }));
      res.json({
        success: true,
        data: allCalendars,
        note: 'Calendarios agrícolas para la Región Pasco.'
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener calendario.' });
  }
}

async function getPlantingGuide(req, res) {
  try {
    const cropType = req.params.cropType;

    if (cropType && plantingGuides[cropType]) {
      return res.json({
        success: true,
        data: {
          crop_type: cropType,
          ...plantingGuides[cropType]
        }
      });
    }

    res.json({
      success: true,
      data: plantingGuides
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener guía de siembra.' });
  }
}

module.exports = { getTips, getEmergencyTips, getCalendar, getPlantingGuide };
