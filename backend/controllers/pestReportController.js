/**
 * AgroPasco — Controlador de Reportes de Plagas
 * Flujo: Agricultor reporta → Asesor Técnico responde
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

// Agricultor crea reporte de plaga
async function createReport(req, res) {
  try {
    const { parcel_id, pest_name, description, photo_url, location_lat, location_lng } = req.body;

    if (!pest_name) {
      return res.status(400).json({ success: false, error: 'El nombre de la plaga es obligatorio.' });
    }

    // Si se asocia parcela, verificar que pertenece al farmer
    if (parcel_id) {
      const parcel = await dbGet('SELECT id FROM parcels WHERE id = ? AND user_id = ?', [parcel_id, req.user.id]);
      if (!parcel) {
        return res.status(400).json({ success: false, error: 'Parcela no encontrada o no te pertenece.' });
      }
    }

    const result = await dbRun(
      `INSERT INTO pest_reports (farmer_id, parcel_id, pest_name, description, photo_url, location_lat, location_lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, parcel_id || null, pest_name, description || '', photo_url || null, location_lat || null, location_lng || null]
    );

    // Notificar a todos los asesores
    const advisors = await dbAll("SELECT id FROM users WHERE role = 'advisor'");
    for (const adv of advisors) {
      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'asesoria', ?, ?, 'warning')`,
        [adv.id, `🐛 Nuevo reporte de plaga: ${pest_name}`, `El agricultor ${req.user.name} ha reportado la plaga "${pest_name}". ${description ? description.substring(0, 100) : ''}`]
      );
    }

    const report = await dbGet(
      `SELECT pr.*, u.name as farmer_name, p.name as parcel_name
       FROM pest_reports pr
       LEFT JOIN users u ON pr.farmer_id = u.id
       LEFT JOIN parcels p ON pr.parcel_id = p.id
       WHERE pr.id = ?`,
      [result.lastID]
    );

    res.status(201).json({ success: true, message: 'Reporte de plaga enviado al asesor técnico.', data: report });
  } catch (err) {
    console.error('Error al crear reporte de plaga:', err);
    res.status(500).json({ success: false, error: 'Error al enviar reporte.' });
  }
}

// Listar reportes (farmer ve los suyos, advisor ve todos)
async function listReports(req, res) {
  try {
    const { status } = req.query;
    let sql, params = [];

    if (req.user.role === 'advisor') {
      sql = `SELECT pr.*, u.name as farmer_name, u.location as farmer_location,
                    p.name as parcel_name, p.crop_type as parcel_crop, p.geo_json, p.altitude_masl,
                    p.area_hectares, p.center_lat, p.center_lng,
                    adv.name as advisor_name
             FROM pest_reports pr
             LEFT JOIN users u ON pr.farmer_id = u.id
             LEFT JOIN parcels p ON pr.parcel_id = p.id
             LEFT JOIN users adv ON pr.advisor_id = adv.id
             WHERE 1=1`;
    } else {
      sql = `SELECT pr.*, u.name as farmer_name,
                    p.name as parcel_name, p.crop_type as parcel_crop, p.geo_json, p.altitude_masl,
                    adv.name as advisor_name
             FROM pest_reports pr
             LEFT JOIN users u ON pr.farmer_id = u.id
             LEFT JOIN parcels p ON pr.parcel_id = p.id
             LEFT JOIN users adv ON pr.advisor_id = adv.id
             WHERE pr.farmer_id = ?`;
      params.push(req.user.id);
    }

    if (status) { sql += ' AND pr.status = ?'; params.push(status); }
    sql += ' ORDER BY pr.created_at DESC';

    const reports = await dbAll(sql, params);
    res.json({ success: true, data: reports, total: reports.length });
  } catch (err) {
    console.error('Error al listar reportes:', err);
    res.status(500).json({ success: false, error: 'Error al obtener reportes.' });
  }
}

// Asesor responde reporte con recomendación técnica
async function respondReport(req, res) {
  try {
    const { advisor_response } = req.body;

    if (!advisor_response) {
      return res.status(400).json({ success: false, error: 'La respuesta del asesor es obligatoria.' });
    }

    const report = await dbGet('SELECT * FROM pest_reports WHERE id = ?', [req.params.id]);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Reporte no encontrado.' });
    }

    await dbRun(
      `UPDATE pest_reports SET advisor_response = ?, advisor_id = ?, status = 'resuelto', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [advisor_response, req.user.id, req.params.id]
    );

    // Notificar al agricultor
    await dbRun(
      `INSERT INTO notifications (user_id, type, title, message, severity)
       VALUES (?, 'asesoria', ?, ?, 'info')`,
      [report.farmer_id, `✅ Respuesta a tu reporte: ${report.pest_name}`,
       `El asesor ${req.user.name} respondió tu reporte de plaga: ${advisor_response.substring(0, 150)}`]
    );

    const updated = await dbGet(
      `SELECT pr.*, u.name as farmer_name, p.name as parcel_name, adv.name as advisor_name
       FROM pest_reports pr
       LEFT JOIN users u ON pr.farmer_id = u.id
       LEFT JOIN parcels p ON pr.parcel_id = p.id
       LEFT JOIN users adv ON pr.advisor_id = adv.id
       WHERE pr.id = ?`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Reporte respondido exitosamente.', data: updated });
  } catch (err) {
    console.error('Error al responder reporte:', err);
    res.status(500).json({ success: false, error: 'Error al responder reporte.' });
  }
}

module.exports = { createReport, listReports, respondReport };
