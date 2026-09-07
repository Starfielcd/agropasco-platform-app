/**
 * AgroPasco — Controlador de Parcelas
 * CRUD de parcelas con polígonos GeoJSON
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

async function listParcels(req, res) {
  try {
    let parcels;
    if (req.user.role === 'advisor') {
      // Los asesores ven todas las parcelas de la región
      parcels = await dbAll(
        `SELECT p.*, u.name as farmer_name, u.location as farmer_location
         FROM parcels p
         LEFT JOIN users u ON p.user_id = u.id
         ORDER BY p.updated_at DESC`
      );
    } else {
      // Los agricultores solo ven sus parcelas
      parcels = await dbAll(
        `SELECT * FROM parcels WHERE user_id = ? ORDER BY updated_at DESC`,
        [req.user.id]
      );
    }
    res.json({ success: true, data: parcels, total: parcels.length });
  } catch (err) {
    console.error('Error al listar parcelas:', err);
    res.status(500).json({ success: false, error: 'Error al obtener parcelas.' });
  }
}

async function createParcel(req, res) {
  try {
    const { name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, altitude_masl, notes } = req.body;

    if (!name || !geo_json) {
      return res.status(400).json({ success: false, error: 'Nombre y polígono GeoJSON son obligatorios.' });
    }

    const geoJsonStr = typeof geo_json === 'string' ? geo_json : JSON.stringify(geo_json);

    const result = await dbRun(
      `INSERT INTO parcels (user_id, name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, altitude_masl, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, geoJsonStr, area_hectares || 0, center_lat || null, center_lng || null,
       crop_type || null, planting_date || null, altitude_masl || 4380, notes || null]
    );

    // Audit log (non-blocking)
    dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE', 'parcel', result.lastID, `Parcela "${name}" creada`]
    ).catch(e => console.warn('Audit log error:', e.message));

    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Parcela registrada exitosamente.', data: parcel });
  } catch (err) {
    console.error('Error al crear parcela:', err);
    res.status(500).json({ success: false, error: `Error al registrar parcela: ${err.message}` });
  }
}

async function getParcel(req, res) {
  try {
    const parcel = await dbGet(
      `SELECT p.*, u.name as farmer_name
       FROM parcels p LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [req.params.id]
    );

    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    // Solo el dueño o asesores/admin pueden ver
    if (parcel.user_id !== req.user.id && req.user.role !== 'advisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'No tienes permisos para ver esta parcela.' });
    }

    // Obtener marcadores de plagas asociados
    const markers = await dbAll(
      `SELECT pm.*, u.name as advisor_name
       FROM pest_markers pm LEFT JOIN users u ON pm.advisor_id = u.id
       WHERE pm.parcel_id = ? ORDER BY pm.created_at DESC`,
      [parcel.id]
    );

    // Obtener recomendaciones
    const recommendations = await dbAll(
      `SELECT ar.*, u.name as advisor_name
       FROM advisor_recommendations ar LEFT JOIN users u ON ar.advisor_id = u.id
       WHERE ar.parcel_id = ? ORDER BY ar.created_at DESC`,
      [parcel.id]
    );

    res.json({ success: true, data: { ...parcel, pest_markers: markers, recommendations } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener parcela.' });
  }
}

async function updateParcel(req, res) {
  try {
    const { name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, status, altitude_masl, notes } = req.body;

    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    const geoJsonStr = geo_json ? (typeof geo_json === 'string' ? geo_json : JSON.stringify(geo_json)) : parcel.geo_json;

    await dbRun(
      `UPDATE parcels SET name=?, geo_json=?, area_hectares=?, center_lat=?, center_lng=?, crop_type=?, planting_date=?, status=?, altitude_masl=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name || parcel.name, geoJsonStr, area_hectares ?? parcel.area_hectares,
       center_lat ?? parcel.center_lat, center_lng ?? parcel.center_lng,
       crop_type ?? parcel.crop_type, planting_date ?? parcel.planting_date,
       status || parcel.status, altitude_masl ?? parcel.altitude_masl,
       notes ?? parcel.notes, req.params.id]
    );

    const updated = await dbGet('SELECT * FROM parcels WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Parcela actualizada.', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al actualizar parcela.' });
  }
}

async function deleteParcel(req, res) {
  try {
    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    await dbRun('DELETE FROM parcels WHERE id = ?', [req.params.id]);

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'DELETE', 'parcel', req.params.id, `Parcela "${parcel.name}" eliminada`]
    );

    res.json({ success: true, message: 'Parcela eliminada.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al eliminar parcela.' });
  }
}

module.exports = { listParcels, createParcel, getParcel, updateParcel, deleteParcel };
