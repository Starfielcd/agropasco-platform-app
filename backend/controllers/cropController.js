/**
 * AgroPasco — Controlador de Cultivos
 */

const { dbRun, dbGet, dbAll } = require('../config/database');
const { getCurrentWeather } = require('../services/weatherService');

const DEFAULT_CROP_IMAGES = {
  papa: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=800&q=80',
  maca: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=800&q=80',
  quinua: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80',
  habas: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=800&q=80',
  cafe: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=800&q=80',
  olluco: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=800&q=80',
  mashua: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=800&q=80',
  oca: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=800&q=80',
  cebada: 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=800&q=80',
  trigo: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80'
};

async function listCrops(req, res) {
  try {
    let crops;
    if (req.user.role === 'admin' || req.user.role === 'advisor') {
      crops = await dbAll(
        `SELECT c.*, u.name as farmer_name, u.location as farmer_location,
          (SELECT COUNT(*) FROM crop_logs WHERE crop_id = c.id) as total_logs,
          (SELECT created_at FROM crop_logs WHERE crop_id = c.id ORDER BY created_at DESC LIMIT 1) as last_activity
         FROM crops c
         LEFT JOIN users u ON c.user_id = u.id
         ORDER BY c.updated_at DESC`
      );
    } else {
      crops = await dbAll(
        `SELECT c.*, 
          (SELECT COUNT(*) FROM crop_logs WHERE crop_id = c.id) as total_logs,
          (SELECT created_at FROM crop_logs WHERE crop_id = c.id ORDER BY created_at DESC LIMIT 1) as last_activity
         FROM crops c WHERE c.user_id = ? ORDER BY c.updated_at DESC`,
        [req.user.id]
      );
    }
    res.json({ success: true, data: crops, total: crops.length });
  } catch (err) {
    console.error('Error al listar cultivos:', err);
    res.status(500).json({ success: false, error: 'Error al obtener cultivos.' });
  }
}

async function createCrop(req, res) {
  try {
    const { name, crop_type, variety, area_hectares, planting_date, status, location_detail, altitude_masl, notes, photo_url } = req.body;

    if (!name || !crop_type) {
      return res.status(400).json({ success: false, error: 'Nombre y tipo de cultivo son obligatorios.' });
    }

    // Si no se proporcionó foto en vivo, usar imagen ilustrativa de alta calidad según tipo de cultivo
    const finalPhoto = (photo_url && typeof photo_url === 'string' && photo_url.trim() !== '')
      ? photo_url.trim()
      : (DEFAULT_CROP_IMAGES[crop_type] || DEFAULT_CROP_IMAGES.papa);

    const result = await dbRun(
      `INSERT INTO crops (user_id, name, crop_type, variety, area_hectares, planting_date, status, location_detail, altitude_masl, notes, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, crop_type, variety || null, area_hectares || 0, planting_date || null,
       status || 'planificado', location_detail || null, altitude_masl || 4380, notes || null, finalPhoto]
    );

    // Auto-create initial log entry
    await dbRun(
      'INSERT INTO crop_logs (crop_id, action_type, description, photo_url) VALUES (?, ?, ?, ?)',
      [result.lastID, 'siembra', `Cultivo "${name}" (${crop_type}) registrado en el sistema AgroPasco con fotografía.`, finalPhoto]
    );

    const crop = await dbGet('SELECT * FROM crops WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Cultivo registrado exitosamente.', data: crop });
  } catch (err) {
    console.error('Error al crear cultivo:', err);
    res.status(500).json({ success: false, error: 'Error al registrar cultivo.' });
  }
}

async function getCrop(req, res) {
  try {
    let crop;
    if (req.user.role === 'admin' || req.user.role === 'advisor') {
      crop = await dbGet(
        `SELECT c.*, u.name as farmer_name, u.location as farmer_location 
         FROM crops c 
         LEFT JOIN users u ON c.user_id = u.id 
         WHERE c.id = ?`,
        [req.params.id]
      );
    } else {
      crop = await dbGet('SELECT * FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    }

    if (!crop) {
      return res.status(404).json({ success: false, error: 'Cultivo no encontrado.' });
    }

    const logs = await dbAll(
      'SELECT * FROM crop_logs WHERE crop_id = ? ORDER BY created_at DESC',
      [crop.id]
    );

    res.json({ success: true, data: { ...crop, logs } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener cultivo.' });
  }
}

async function updateCrop(req, res) {
  try {
    const { name, crop_type, variety, area_hectares, planting_date, expected_harvest_date, status, location_detail, altitude_masl, notes } = req.body;

    const isAdmin = req.user.role === 'admin';
    const crop = isAdmin
      ? await dbGet('SELECT * FROM crops WHERE id = ?', [req.params.id])
      : await dbGet('SELECT * FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    if (!crop) {
      return res.status(404).json({ success: false, error: 'Cultivo no encontrado.' });
    }

    await dbRun(
      `UPDATE crops SET name=?, crop_type=?, variety=?, area_hectares=?, planting_date=?, expected_harvest_date=?, 
       status=?, location_detail=?, altitude_masl=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name || crop.name, crop_type || crop.crop_type, variety ?? crop.variety,
       area_hectares ?? crop.area_hectares, planting_date ?? crop.planting_date,
       expected_harvest_date ?? crop.expected_harvest_date, status || crop.status,
       location_detail ?? crop.location_detail, altitude_masl ?? crop.altitude_masl,
       notes ?? crop.notes, req.params.id]
    );

    // Log status change
    if (status && status !== crop.status) {
      await dbRun(
        'INSERT INTO crop_logs (crop_id, action_type, description) VALUES (?, ?, ?)',
        [crop.id, 'otro', `Estado actualizado de "${crop.status}" a "${status}".`]
      );
    }

    const updated = await dbGet('SELECT * FROM crops WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Cultivo actualizado.', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al actualizar cultivo.' });
  }
}

async function deleteCrop(req, res) {
  try {
    const crop = await dbGet('SELECT * FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!crop) {
      return res.status(404).json({ success: false, error: 'Cultivo no encontrado.' });
    }
    await dbRun('DELETE FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Cultivo eliminado.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al eliminar cultivo.' });
  }
}

async function addCropLog(req, res) {
  try {
    const { action_type, description, photo_url } = req.body;

    if (!action_type || !description) {
      return res.status(400).json({ success: false, error: 'Tipo de acción y descripción son obligatorios.' });
    }

    const crop = await dbGet('SELECT * FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!crop) {
      return res.status(404).json({ success: false, error: 'Cultivo no encontrado.' });
    }

    // Capture weather snapshot for traceability
    let weatherSnapshot = null;
    try {
      const weather = await getCurrentWeather();
      weatherSnapshot = JSON.stringify({
        temp: weather.main?.temp,
        humidity: weather.main?.humidity,
        condition: weather.weather?.[0]?.description,
        timestamp: new Date().toISOString()
      });
    } catch (e) { /* Weather capture is optional */ }

    const result = await dbRun(
      'INSERT INTO crop_logs (crop_id, action_type, description, weather_snapshot, photo_url) VALUES (?, ?, ?, ?, ?)',
      [crop.id, action_type, description, weatherSnapshot, photo_url || null]
    );

    await dbRun('UPDATE crops SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [crop.id]);

    const log = await dbGet('SELECT * FROM crop_logs WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Registro de cuidado agregado.', data: log });
  } catch (err) {
    console.error('Error al agregar log:', err);
    res.status(500).json({ success: false, error: 'Error al registrar actividad.' });
  }
}

async function getTraceability(req, res) {
  try {
    const crop = await dbGet('SELECT * FROM crops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!crop) {
      return res.status(404).json({ success: false, error: 'Cultivo no encontrado.' });
    }

    const logs = await dbAll(
      'SELECT * FROM crop_logs WHERE crop_id = ? ORDER BY created_at ASC',
      [crop.id]
    );

    const user = await dbGet('SELECT name, location FROM users WHERE id = ?', [crop.user_id]);

    // Build traceability report
    const report = {
      traceability_code: `AP-${crop.crop_type.toUpperCase()}-${crop.id}-${new Date().getFullYear()}`,
      crop: {
        name: crop.name,
        type: crop.crop_type,
        variety: crop.variety,
        area_hectares: crop.area_hectares,
        planting_date: crop.planting_date,
        status: crop.status,
        altitude: crop.altitude_masl,
        location: crop.location_detail
      },
      farmer: { name: user?.name, location: user?.location },
      timeline: logs.map(log => ({
        date: log.created_at,
        action: log.action_type,
        description: log.description,
        weather_at_time: log.weather_snapshot ? JSON.parse(log.weather_snapshot) : null,
        has_photo: !!log.photo_url
      })),
      summary: {
        total_activities: logs.length,
        days_since_planting: crop.planting_date
          ? Math.floor((Date.now() - new Date(crop.planting_date).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        activities_by_type: logs.reduce((acc, l) => { acc[l.action_type] = (acc[l.action_type] || 0) + 1; return acc; }, {})
      },
      certified: true,
      platform: 'AgroPasco Digital',
      generated_at: new Date().toISOString()
    };

    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al generar trazabilidad.' });
  }
}

module.exports = { listCrops, createCrop, getCrop, updateCrop, deleteCrop, addCropLog, getTraceability };
