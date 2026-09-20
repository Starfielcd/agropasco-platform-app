/**
 * AgroPasco — Controlador de Parcelas
 * CRUD de parcelas con polígonos GeoJSON, validación de claves foráneas y fotos obligatorias.
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

async function listParcels(req, res) {
  try {
    let parcels;
    const pestSubqueries = `
      (SELECT pr.severity FROM pest_reports pr WHERE pr.parcel_id = p.id AND pr.status != 'resuelto' ORDER BY CASE pr.severity WHEN 'critico' THEN 1 WHEN 'grave' THEN 2 WHEN 'moderado' THEN 3 WHEN 'leve' THEN 4 ELSE 5 END LIMIT 1) as pest_severity,
      (SELECT pr.pest_name FROM pest_reports pr WHERE pr.parcel_id = p.id AND pr.status != 'resuelto' ORDER BY CASE pr.severity WHEN 'critico' THEN 1 WHEN 'grave' THEN 2 WHEN 'moderado' THEN 3 WHEN 'leve' THEN 4 ELSE 5 END LIMIT 1) as active_pest_name,
      (SELECT pr.photo_url FROM pest_reports pr WHERE pr.parcel_id = p.id AND pr.status != 'resuelto' ORDER BY CASE pr.severity WHEN 'critico' THEN 1 WHEN 'grave' THEN 2 WHEN 'moderado' THEN 3 WHEN 'leve' THEN 4 ELSE 5 END LIMIT 1) as active_pest_photo
    `;

    if (req.user.role === 'advisor' || req.user.role === 'admin') {
      // Los asesores y admins ven todas las parcelas de la región
      parcels = await dbAll(
        `SELECT p.*, u.name as farmer_name, u.location as farmer_location,
                c.name as crop_name,
                ${pestSubqueries}
         FROM parcels p
         LEFT JOIN users u ON p.user_id = u.id
         LEFT JOIN crops c ON p.crop_id = c.id
         ORDER BY p.updated_at DESC`
      );
    } else {
      // Los agricultores ven sus parcelas con el estado fitosanitario integrado
      parcels = await dbAll(
        `SELECT p.*, c.name as crop_name,
                ${pestSubqueries}
         FROM parcels p
         LEFT JOIN crops c ON p.crop_id = c.id
         WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
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
    const {
      name,
      geo_json,
      area_hectares,
      center_lat,
      center_lng,
      crop_type,
      cultivo,
      crop_id,
      cultivo_id,
      user_id,
      usuario_id,
      planting_date,
      altitude_masl,
      notes,
      photo_url
    } = req.body;

    if (!name || !geo_json) {
      return res.status(400).json({
        success: false,
        error: 'Nombre y polígono GeoJSON son obligatorios.',
        field: !name ? 'name' : 'geo_json'
      });
    }

    // 1. Identificar y validar user_id (clave foránea a tabla users)
    const effectiveUserId = req.user?.id || user_id || usuario_id;
    if (!effectiveUserId) {
      return res.status(401).json({
        success: false,
        error: 'No se pudo determinar el usuario autenticado (user_id ausente). Inicia sesión nuevamente.',
        field: 'user_id'
      });
    }

    const userRecord = await dbGet('SELECT id, name, role FROM users WHERE id = ?', [effectiveUserId]);
    if (!userRecord) {
      return res.status(400).json({
        success: false,
        error: `El usuario con ID ${effectiveUserId} no existe en la base de datos. Por favor inicia sesión nuevamente.`,
        field: 'user_id'
      });
    }

    // 2. Identificar y validar crop_id (clave foránea a tabla crops) y crop_type
    let resolvedCropId = (crop_id !== undefined && crop_id !== null && crop_id !== '')
      ? crop_id
      : ((cultivo_id !== undefined && cultivo_id !== null && cultivo_id !== '') ? cultivo_id : null);
    let resolvedCropType = crop_type || cultivo || null;

    if (resolvedCropId !== null && resolvedCropId !== undefined) {
      // Si se proporcionó un ID numérico o representable como número entero positivo
      if (!isNaN(Number(resolvedCropId)) && Number(resolvedCropId) > 0) {
        resolvedCropId = parseInt(resolvedCropId, 10);
        const cropRecord = await dbGet('SELECT id, name, crop_type, user_id FROM crops WHERE id = ?', [resolvedCropId]);
        if (!cropRecord) {
          return res.status(400).json({
            success: false,
            error: `El cultivo seleccionado con ID ${resolvedCropId} no existe en la base de datos. Seleccione un cultivo válido o regístrelo previamente en "Mis Cultivos".`,
            field: 'crop_id'
          });
        }
        if (!resolvedCropType) {
          resolvedCropType = cropRecord.crop_type;
        }
      } else if (typeof resolvedCropId === 'string' && resolvedCropId.trim() !== '') {
        // Si el frontend envió el nombre o tipo textual en crop_id (ej: "maca", "papa")
        const textVal = resolvedCropId.trim();
        if (!resolvedCropType) {
          resolvedCropType = textVal.toLowerCase();
        }
        // Intentar buscar si el usuario tiene un cultivo registrado con ese nombre o tipo
        const matchingCrop = await dbGet(
          'SELECT id, crop_type FROM crops WHERE user_id = ? AND (LOWER(crop_type) = LOWER(?) OR LOWER(name) = LOWER(?)) LIMIT 1',
          [effectiveUserId, textVal, textVal]
        );
        if (matchingCrop) {
          resolvedCropId = matchingCrop.id;
          resolvedCropType = matchingCrop.crop_type;
        } else {
          resolvedCropId = null; // Evitar pasar texto a columna INTEGER de clave foránea
        }
      } else {
        resolvedCropId = null;
      }
    }

    const geoJsonStr = typeof geo_json === 'string' ? geo_json : JSON.stringify(geo_json);
    const finalPhoto = (photo_url && typeof photo_url === 'string' && photo_url.trim() !== '')
      ? photo_url.trim()
      : null;

    let result;
    try {
      result = await dbRun(
        `INSERT INTO parcels (user_id, name, geo_json, area_hectares, center_lat, center_lng, crop_type, crop_id, planting_date, altitude_masl, notes, photo_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          effectiveUserId,
          name.trim(),
          geoJsonStr,
          parseFloat(area_hectares) || 0,
          center_lat ? parseFloat(center_lat) : null,
          center_lng ? parseFloat(center_lng) : null,
          resolvedCropType || null,
          resolvedCropId,
          planting_date || null,
          altitude_masl ? parseInt(altitude_masl, 10) : 4380,
          notes ? notes.trim() : null,
          finalPhoto
        ]
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('FOREIGN KEY constraint failed')) {
        console.error('Error de Foreign Key al insertar parcela:', {
          userId: effectiveUserId,
          cropId: resolvedCropId,
          dbError: dbErr.message
        });
        return res.status(400).json({
          success: false,
          error: 'Error de integridad referencial: Uno de los registros asociados (usuario o cultivo) no existe en la base de datos.',
          field: !userRecord ? 'user_id' : 'crop_id',
          details: { user_id: effectiveUserId, crop_id: resolvedCropId }
        });
      }
      throw dbErr;
    }

    // Audit log (non-blocking)
    dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [effectiveUserId, 'CREATE', 'parcel', result.lastID, `Parcela "${name.trim()}" creada exitosamente`]
    ).catch(e => console.warn('Audit log error:', e.message));

    const parcel = await dbGet(
      `SELECT p.*, c.name as crop_name
       FROM parcels p LEFT JOIN crops c ON p.crop_id = c.id
       WHERE p.id = ?`,
      [result.lastID]
    );

    res.status(201).json({ success: true, message: 'Parcela registrada exitosamente.', data: parcel });
  } catch (err) {
    console.error('Error al crear parcela:', err);
    res.status(500).json({ success: false, error: `Error al registrar parcela: ${err.message}` });
  }
}

async function getParcel(req, res) {
  try {
    const parcel = await dbGet(
      `SELECT p.*, u.name as farmer_name, c.name as crop_name
       FROM parcels p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN crops c ON p.crop_id = c.id
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
    const {
      name,
      geo_json,
      area_hectares,
      center_lat,
      center_lng,
      crop_type,
      cultivo,
      crop_id,
      cultivo_id,
      planting_date,
      status,
      altitude_masl,
      notes,
      photo_url
    } = req.body;

    const parcel = await dbGet('SELECT * FROM parcels WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!parcel) {
      return res.status(404).json({ success: false, error: 'Parcela no encontrada.' });
    }

    let resolvedCropId = (crop_id !== undefined && crop_id !== null && crop_id !== '')
      ? crop_id
      : ((cultivo_id !== undefined && cultivo_id !== null && cultivo_id !== '') ? cultivo_id : parcel.crop_id);
    let resolvedCropType = crop_type || cultivo || parcel.crop_type;

    if (resolvedCropId !== null && resolvedCropId !== undefined) {
      if (!isNaN(Number(resolvedCropId)) && Number(resolvedCropId) > 0) {
        resolvedCropId = parseInt(resolvedCropId, 10);
        const cropRecord = await dbGet('SELECT id, crop_type, name FROM crops WHERE id = ?', [resolvedCropId]);
        if (!cropRecord) {
          return res.status(400).json({
            success: false,
            error: `El cultivo con ID ${resolvedCropId} no existe en la base de datos.`,
            field: 'crop_id'
          });
        }
        if (!crop_type && !cultivo) {
          resolvedCropType = cropRecord.crop_type;
        }
      } else if (typeof resolvedCropId === 'string' && resolvedCropId.trim() !== '') {
        const textVal = resolvedCropId.trim();
        if (!crop_type && !cultivo) {
          resolvedCropType = textVal.toLowerCase();
        }
        const matchingCrop = await dbGet(
          'SELECT id, crop_type FROM crops WHERE user_id = ? AND (LOWER(crop_type) = LOWER(?) OR LOWER(name) = LOWER(?)) LIMIT 1',
          [req.user.id, textVal, textVal]
        );
        resolvedCropId = matchingCrop ? matchingCrop.id : null;
      } else {
        resolvedCropId = null;
      }
    } else {
      resolvedCropId = null;
    }

    const geoJsonStr = geo_json ? (typeof geo_json === 'string' ? geo_json : JSON.stringify(geo_json)) : parcel.geo_json;
    const finalPhoto = (photo_url && typeof photo_url === 'string' && photo_url.trim() !== '') ? photo_url.trim() : parcel.photo_url;

    try {
      await dbRun(
        `UPDATE parcels SET name=?, geo_json=?, area_hectares=?, center_lat=?, center_lng=?, crop_type=?, crop_id=?, planting_date=?, status=?, altitude_masl=?, notes=?, photo_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [
          name ? name.trim() : parcel.name,
          geoJsonStr,
          area_hectares !== undefined ? (parseFloat(area_hectares) || 0) : parcel.area_hectares,
          center_lat !== undefined ? (center_lat ? parseFloat(center_lat) : null) : parcel.center_lat,
          center_lng !== undefined ? (center_lng ? parseFloat(center_lng) : null) : parcel.center_lng,
          resolvedCropType || null,
          resolvedCropId,
          planting_date !== undefined ? (planting_date || null) : parcel.planting_date,
          status || parcel.status,
          altitude_masl !== undefined ? (parseInt(altitude_masl, 10) || 4380) : parcel.altitude_masl,
          notes !== undefined ? (notes ? notes.trim() : null) : parcel.notes,
          finalPhoto,
          req.params.id
        ]
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(400).json({
          success: false,
          error: 'Error de integridad referencial: El cultivo seleccionado no existe en la base de datos.',
          field: 'crop_id'
        });
      }
      throw dbErr;
    }

    const updated = await dbGet(
      `SELECT p.*, c.name as crop_name
       FROM parcels p LEFT JOIN crops c ON p.crop_id = c.id
       WHERE p.id = ?`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Parcela actualizada.', data: updated });
  } catch (err) {
    console.error('Error al actualizar parcela:', err);
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
