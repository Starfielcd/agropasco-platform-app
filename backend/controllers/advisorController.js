/**
 * AgroPasco — Controlador del Asesor Técnico
 * Marcadores de plagas y recomendaciones técnicas
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

// ===== MARCADORES DE PLAGAS =====

async function createPestMarker(req, res) {
  try {
    const { parcel_id, lat, lng, pest_type, severity, title, description, photo_url } = req.body;

    if (!lat || !lng || !pest_type || !title) {
      return res.status(400).json({ success: false, error: 'Latitud, longitud, tipo de plaga y título son obligatorios.' });
    }

    const result = await dbRun(
      `INSERT INTO pest_markers (advisor_id, parcel_id, lat, lng, pest_type, severity, title, description, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, parcel_id || null, lat, lng, pest_type, severity || 'moderado', title, description || '', photo_url || null]
    );

    // Audit log
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE', 'pest_marker', result.lastID, `Marcador de plaga: ${title} (${pest_type})`]
    );

    // Notificar al dueño de la parcela si existe
    if (parcel_id) {
      const parcel = await dbGet('SELECT user_id, name FROM parcels WHERE id = ?', [parcel_id]);
      if (parcel) {
        await dbRun(
          `INSERT INTO notifications (user_id, type, title, message, severity) VALUES (?, 'asesoria', ?, ?, ?)`,
          [parcel.user_id, `🐛 Plaga detectada en ${parcel.name}`, `El asesor ${req.user.name} ha identificado ${pest_type}: ${title}. ${description || ''}`, severity === 'critico' ? 'critical' : severity === 'grave' ? 'warning' : 'info']
        );
      }
    }

    const marker = await dbGet('SELECT * FROM pest_markers WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Marcador de plaga registrado.', data: marker });
  } catch (err) {
    console.error('Error al crear marcador de plaga:', err);
    res.status(500).json({ success: false, error: 'Error al registrar marcador.' });
  }
}

async function listPestMarkers(req, res) {
  try {
    const { parcel_id, pest_type, severity, resolved } = req.query;

    let sql = `SELECT pm.*, u.name as advisor_name, p.name as parcel_name
               FROM pest_markers pm
               LEFT JOIN users u ON pm.advisor_id = u.id
               LEFT JOIN parcels p ON pm.parcel_id = p.id
               WHERE 1=1`;
    const params = [];

    if (parcel_id) { sql += ' AND pm.parcel_id = ?'; params.push(parcel_id); }
    if (pest_type) { sql += ' AND pm.pest_type = ?'; params.push(pest_type); }
    if (severity) { sql += ' AND pm.severity = ?'; params.push(severity); }
    if (resolved !== undefined) { sql += ' AND pm.resolved = ?'; params.push(resolved === 'true' ? 1 : 0); }

    sql += ' ORDER BY pm.created_at DESC';

    const markers = await dbAll(sql, params);
    res.json({ success: true, data: markers, total: markers.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener marcadores.' });
  }
}

async function resolvePestMarker(req, res) {
  try {
    const marker = await dbGet('SELECT * FROM pest_markers WHERE id = ?', [req.params.id]);
    if (!marker) {
      return res.status(404).json({ success: false, error: 'Marcador no encontrado.' });
    }

    await dbRun('UPDATE pest_markers SET resolved = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Marcador marcado como resuelto.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al actualizar marcador.' });
  }
}

// ===== RECOMENDACIONES TÉCNICAS =====

async function createRecommendation(req, res) {
  try {
    const { farmer_id, parcel_id, category, title, recommendation, priority } = req.body;

    if (!category || !title || !recommendation) {
      return res.status(400).json({ success: false, error: 'Categoría, título y recomendación son obligatorios.' });
    }

    const result = await dbRun(
      `INSERT INTO advisor_recommendations (advisor_id, farmer_id, parcel_id, category, title, recommendation, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, farmer_id || null, parcel_id || null, category, title, recommendation, priority || 'normal']
    );

    // Notificar al agricultor
    if (farmer_id) {
      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity) VALUES (?, 'asesoria', ?, ?, ?)`,
        [farmer_id, `📋 Nueva recomendación: ${title}`, `El asesor ${req.user.name} te ha enviado una recomendación de ${category}: ${recommendation.substring(0, 100)}...`, priority === 'urgente' ? 'critical' : priority === 'alta' ? 'warning' : 'info']
      );
    }

    const rec = await dbGet('SELECT * FROM advisor_recommendations WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Recomendación emitida.', data: rec });
  } catch (err) {
    console.error('Error al crear recomendación:', err);
    res.status(500).json({ success: false, error: 'Error al emitir recomendación.' });
  }
}

async function listRecommendations(req, res) {
  try {
    const { farmer_id, category, status } = req.query;

    let sql, params = [];

    if (req.user.role === 'advisor') {
      sql = `SELECT ar.*, u.name as farmer_name, p.name as parcel_name
             FROM advisor_recommendations ar
             LEFT JOIN users u ON ar.farmer_id = u.id
             LEFT JOIN parcels p ON ar.parcel_id = p.id
             WHERE ar.advisor_id = ?`;
      params.push(req.user.id);
    } else {
      // Agricultor ve las recomendaciones dirigidas a él
      sql = `SELECT ar.*, adv.name as advisor_name, p.name as parcel_name
             FROM advisor_recommendations ar
             LEFT JOIN users u ON ar.farmer_id = u.id
             LEFT JOIN users adv ON ar.advisor_id = adv.id
             LEFT JOIN parcels p ON ar.parcel_id = p.id
             WHERE ar.farmer_id = ?`;
      params.push(req.user.id);
    }

    if (category) { sql += ' AND ar.category = ?'; params.push(category); }
    if (status) { sql += ' AND ar.status = ?'; params.push(status); }
    sql += ' ORDER BY ar.created_at DESC';

    const recs = await dbAll(sql, params);
    res.json({ success: true, data: recs, total: recs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener recomendaciones.' });
  }
}

async function getFarmers(req, res) {
  try {
    const farmers = await dbAll(
      `SELECT id, name, email, location, phone, created_at FROM users WHERE role = 'farmer' ORDER BY name`
    );
    res.json({ success: true, data: farmers, total: farmers.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener agricultores.' });
  }
}

module.exports = { createPestMarker, listPestMarkers, resolvePestMarker, createRecommendation, listRecommendations, getFarmers };
