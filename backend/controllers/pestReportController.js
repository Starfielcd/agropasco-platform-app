/**
 * AgroPasco — Controlador de Reportes de Plagas
 * Flujo: Agricultor reporta (Foto Obligatoria) → Asesor responde con recomendación y adjuntos → Agricultor confirma extinción o persistencia
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

// Agricultor crea reporte de plaga — Fotografía Obligatoria
async function createReport(req, res) {
  try {
    const { parcel_id, pest_name, severity, description, photo_url, location_lat, location_lng } = req.body;

    if (!pest_name || pest_name.trim() === '') {
      return res.status(400).json({ success: false, error: 'El nombre de la plaga o síntoma es obligatorio.' });
    }

    // ===== REQUERIMIENTO 2: FOTOGRAFÍA OBLIGATORIA EN REPORTES =====
    if (!photo_url || typeof photo_url !== 'string' || photo_url.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'La fotografía de la plaga es obligatoria. Por favor toma una foto con la cámara o sube una imagen de la galería para que el asesor pueda evaluar el daño.'
      });
    }

    const validSeverity = ['leve', 'moderado', 'grave', 'critico'].includes(severity) ? severity : 'moderado';

    // Si se asocia parcela, verificar que pertenece al agricultor y obtener sus coordenadas si faltan
    let parcelCoordsLat = location_lat || null;
    let parcelCoordsLng = location_lng || null;

    if (parcel_id) {
      const parcel = await dbGet('SELECT id, center_lat, center_lng, altitude_masl FROM parcels WHERE id = ? AND user_id = ?', [parcel_id, req.user.id]);
      if (!parcel) {
        return res.status(400).json({ success: false, error: 'Parcela no encontrada o no te pertenece.' });
      }
      if (!parcelCoordsLat && parcel.center_lat) parcelCoordsLat = parcel.center_lat;
      if (!parcelCoordsLng && parcel.center_lng) parcelCoordsLng = parcel.center_lng;
    }

    const result = await dbRun(
      `INSERT INTO pest_reports (farmer_id, parcel_id, pest_name, severity, description, photo_url, location_lat, location_lng, status, control_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'pendiente')`,
      [req.user.id, parcel_id || null, pest_name.trim(), validSeverity, description ? description.trim() : '', photo_url.trim(), parcelCoordsLat, parcelCoordsLng]
    );

    const reportId = result.lastID;

    // Notificar a todos los asesores técnicos de la plataforma
    const advisors = await dbAll("SELECT id FROM users WHERE role = 'advisor' AND status = 'active'");
    for (const adv of advisors) {
      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'asesoria', ?, ?, ?)`,
        [
          adv.id,
          `🐛 Nuevo reporte de plaga: ${pest_name}`,
          `El agricultor ${req.user.name} reportó "${pest_name}" con severidad ${validSeverity.toUpperCase()}. Requiere evaluación técnica.`,
          validSeverity === 'critico' || validSeverity === 'grave' ? 'critical' : 'warning'
        ]
      );
    }

    const report = await dbGet(
      `SELECT pr.*, u.name as farmer_name, p.name as parcel_name, p.crop_type as parcel_crop, p.altitude_masl
       FROM pest_reports pr
       LEFT JOIN users u ON pr.farmer_id = u.id
       LEFT JOIN parcels p ON pr.parcel_id = p.id
       WHERE pr.id = ?`,
      [reportId]
    );

    res.status(201).json({
      success: true,
      message: '¡Reporte de plaga registrado exitosamente con evidencia fotográfica! El asesor técnico ha sido notificado.',
      data: report
    });
  } catch (err) {
    console.error('Error al crear reporte de plaga:', err);
    res.status(500).json({ success: false, error: 'Error interno al procesar el reporte de plaga.' });
  }
}

// Listar reportes (con enriquecimiento de metadatos para mapa y ficha técnica)
async function listReports(req, res) {
  try {
    const { status } = req.query;
    let sql, params = [];

    const selectFields = `
      pr.*,
      u.name as farmer_name, u.email as farmer_email, u.phone as farmer_phone, u.location as farmer_location,
      p.name as parcel_name, p.crop_type as parcel_crop, p.geo_json, p.altitude_masl,
      p.area_hectares, p.center_lat, p.center_lng, p.notes as parcel_notes,
      adv.name as advisor_name, adv.email as advisor_email,
      (SELECT COUNT(*) FROM pest_report_responses prr WHERE prr.pest_report_id = pr.id) as response_count
    `;

    if (req.user.role === 'advisor' || req.user.role === 'admin') {
      sql = `SELECT ${selectFields}
             FROM pest_reports pr
             LEFT JOIN users u ON pr.farmer_id = u.id
             LEFT JOIN parcels p ON pr.parcel_id = p.id
             LEFT JOIN users adv ON pr.advisor_id = adv.id
             WHERE 1=1`;
    } else {
      sql = `SELECT ${selectFields}
             FROM pest_reports pr
             LEFT JOIN users u ON pr.farmer_id = u.id
             LEFT JOIN parcels p ON pr.parcel_id = p.id
             LEFT JOIN users adv ON pr.advisor_id = adv.id
             WHERE pr.farmer_id = ?`;
      params.push(req.user.id);
    }

    if (status) {
      if (status === 'no_resuelto') {
        sql += " AND (pr.status = 'no_resuelto' OR pr.status = 'pendiente' OR pr.control_status = 'no_resuelto')";
      } else if (status === 'en_proceso') {
        sql += " AND (pr.control_status = 'en_proceso' OR pr.status = 'en_revision')";
      } else if (status === 'resuelto') {
        sql += " AND (pr.status = 'resuelto' OR pr.control_status = 'resuelto')";
      } else {
        sql += ' AND pr.status = ?';
        params.push(status);
      }
    }

    sql += ' ORDER BY pr.created_at DESC';

    const reports = await dbAll(sql, params);
    res.json({ success: true, data: reports, total: reports.length });
  } catch (err) {
    console.error('Error al listar reportes:', err);
    res.status(500).json({ success: false, error: 'Error al obtener reportes.' });
  }
}

// Asesor responde reporte con recomendación técnica, materiales (video/PDF) e historial
async function respondReport(req, res) {
  try {
    const { advisor_response, control_status, attachment_video_url, attachment_doc_url, attachment_doc_name } = req.body;

    if (!advisor_response || advisor_response.trim() === '') {
      return res.status(400).json({ success: false, error: 'La respuesta y recomendación técnica del asesor es obligatoria.' });
    }

    const report = await dbGet(`
      SELECT pr.*, u.name as farmer_name, p.name as parcel_name
      FROM pest_reports pr
      LEFT JOIN users u ON pr.farmer_id = u.id
      LEFT JOIN parcels p ON pr.parcel_id = p.id
      WHERE pr.id = ?
    `, [req.params.id]);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Reporte fitosanitario no encontrado.' });
    }

    const targetControlStatus = ['en_proceso', 'resuelto'].includes(control_status) ? control_status : 'en_proceso';
    const mainStatus = targetControlStatus === 'resuelto' ? 'resuelto' : 'en_proceso';

    // 1. Registrar en historial de respuestas
    await dbRun(
      `INSERT INTO pest_report_responses (pest_report_id, advisor_id, response_text, control_status, attachment_video_url, attachment_doc_url, attachment_doc_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        req.user.id,
        advisor_response.trim(),
        targetControlStatus,
        attachment_video_url ? attachment_video_url.trim() : null,
        attachment_doc_url ? attachment_doc_url.trim() : null,
        attachment_doc_name ? attachment_doc_name.trim() : null
      ]
    );

    // 2. Actualizar el reporte principal con la recomendación más reciente
    await dbRun(
      `UPDATE pest_reports SET
        advisor_response = ?,
        advisor_id = ?,
        status = ?,
        control_status = ?,
        attachment_video_url = ?,
        attachment_doc_url = ?,
        attachment_doc_name = ?,
        responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        advisor_response.trim(),
        req.user.id,
        mainStatus,
        targetControlStatus,
        attachment_video_url ? attachment_video_url.trim() : report.attachment_video_url,
        attachment_doc_url ? attachment_doc_url.trim() : report.attachment_doc_url,
        attachment_doc_name ? attachment_doc_name.trim() : report.attachment_doc_name,
        report.id
      ]
    );

    // 3. Notificar al agricultor
    const statusText = targetControlStatus === 'en_proceso' ? 'Tratamiento en Proceso' : 'Control Resuelto';
    await dbRun(
      `INSERT INTO notifications (user_id, type, title, message, severity)
       VALUES (?, 'asesoria', ?, ?, 'info')`,
      [
        report.farmer_id,
        `📋 Recomendación Técnica: ${report.pest_name} (${statusText})`,
        `El Asesor Técnico ${req.user.name} ha emitido un dictamen y plan de control. Revisa las instrucciones y materiales adjuntos en tu panel.`
      ]
    );

    // 4. Devolver reporte actualizado con respuestas
    const updated = await dbGet(
      `SELECT pr.*, u.name as farmer_name, p.name as parcel_name, p.crop_type as parcel_crop, adv.name as advisor_name
       FROM pest_reports pr
       LEFT JOIN users u ON pr.farmer_id = u.id
       LEFT JOIN parcels p ON pr.parcel_id = p.id
       LEFT JOIN users adv ON pr.advisor_id = adv.id
       WHERE pr.id = ?`,
      [report.id]
    );

    const responses = await dbAll(
      `SELECT prr.*, adv.name as advisor_name
       FROM pest_report_responses prr
       LEFT JOIN users adv ON prr.advisor_id = adv.id
       WHERE prr.pest_report_id = ?
       ORDER BY prr.created_at ASC`,
      [report.id]
    );

    res.json({
      success: true,
      message: 'Dictamen técnico emitido y enviado al agricultor exitosamente.',
      data: { ...updated, responses }
    });
  } catch (err) {
    console.error('Error al responder reporte:', err);
    res.status(500).json({ success: false, error: 'Error al responder reporte.' });
  }
}

// Agricultor confirma seguimiento: Extinguida o Persiste (Requerimiento 4)
async function confirmPestFeedback(req, res) {
  try {
    const { feedback_status, feedback_notes } = req.body;

    if (!feedback_status || !['extinguida', 'persiste'].includes(feedback_status)) {
      return res.status(400).json({
        success: false,
        error: 'Debes indicar si la plaga fue "extinguida" o si "persiste".'
      });
    }

    const report = await dbGet(`
      SELECT pr.*, u.name as farmer_name, p.name as parcel_name
      FROM pest_reports pr
      LEFT JOIN users u ON pr.farmer_id = u.id
      LEFT JOIN parcels p ON pr.parcel_id = p.id
      WHERE pr.id = ?
    `, [req.params.id]);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Reporte fitosanitario no encontrado.' });
    }

    // Validar que el usuario sea el dueño agricultor (o admin)
    if (req.user.role !== 'admin' && report.farmer_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Solo el agricultor titular de la parcela puede confirmar el estado.' });
    }

    const isExtinguished = feedback_status === 'extinguida';
    const newStatus = isExtinguished ? 'resuelto' : 'no_resuelto';
    const newControlStatus = isExtinguished ? 'resuelto' : 'no_resuelto';

    await dbRun(
      `UPDATE pest_reports SET
        status = ?,
        control_status = ?,
        feedback_status = ?,
        feedback_notes = ?,
        feedback_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        newStatus,
        newControlStatus,
        feedback_status,
        feedback_notes ? feedback_notes.trim() : null,
        report.id
      ]
    );

    // Notificar al asesor técnico asignado o a todos los asesores
    const advisorTargetId = report.advisor_id;
    if (advisorTargetId) {
      const notifTitle = isExtinguished
        ? `🎉 Plaga Extinguida: ${report.pest_name}`
        : `⚠️ Plaga Persiste: ${report.pest_name}`;
      const notifMsg = isExtinguished
        ? `El agricultor ${report.farmer_name} confirmó que el tratamiento fue efectivo y la plaga en "${report.parcel_name || 'su parcela'}" fue erradicada con éxito.`
        : `El agricultor ${report.farmer_name} reporta que la plaga en "${report.parcel_name || 'su parcela'}" persiste tras la aplicación. ${feedback_notes ? 'Nota: ' + feedback_notes : ''}`;

      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'asesoria', ?, ?, ?)`,
        [advisorTargetId, notifTitle, notifMsg, isExtinguished ? 'info' : 'critical']
      );
    }

    res.json({
      success: true,
      message: isExtinguished
        ? '¡Excelente! Has confirmado que la plaga fue extinguida. El reporte queda cerrado satisfactoriamente.'
        : 'Reporte actualizado a No Resuelto. El Asesor Técnico ha sido alertado para coordinar una nueva estrategia de control.',
      data: {
        id: report.id,
        status: newStatus,
        control_status: newControlStatus,
        feedback_status,
        feedback_notes
      }
    });
  } catch (err) {
    console.error('Error al confirmar feedback de plaga:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar el estado de seguimiento.' });
  }
}

// Obtener historial completo de respuestas y materiales de un reporte
async function getReportResponses(req, res) {
  try {
    const reportId = req.params.id;
    const responses = await dbAll(
      `SELECT prr.*, adv.name as advisor_name, adv.email as advisor_email
       FROM pest_report_responses prr
       LEFT JOIN users adv ON prr.advisor_id = adv.id
       WHERE prr.pest_report_id = ?
       ORDER BY prr.created_at ASC`,
      [reportId]
    );

    res.json({ success: true, data: responses, total: responses.length });
  } catch (err) {
    console.error('Error al obtener historial de respuestas:', err);
    res.status(500).json({ success: false, error: 'Error al consultar historial de respuestas.' });
  }
}

module.exports = {
  createReport,
  listReports,
  respondReport,
  confirmPestFeedback,
  getReportResponses
};
