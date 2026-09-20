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
      if (status === 'no_resuelto' || status === 'No Resuelta') {
        sql += " AND (pr.status IN ('no_resuelto', 'No Resuelta', 'pendiente', 'reabierta', 'urgente') OR pr.control_status IN ('no_resuelto', 'persiste') OR pr.feedback_status = 'persiste')";
      } else if (status === 'en_proceso') {
        sql += " AND ((pr.control_status = 'en_proceso' OR pr.status = 'en_proceso' OR pr.status = 'en_revision') AND pr.control_status != 'no_resuelto' AND pr.control_status != 'persiste' AND (pr.feedback_status IS NULL OR pr.feedback_status != 'persiste') AND pr.status != 'resuelto' AND pr.control_status != 'resuelto' AND pr.status != 'No Resuelta')";
      } else if (status === 'resuelto') {
        sql += " AND ((pr.status = 'resuelto' OR pr.control_status = 'resuelto' OR pr.feedback_status = 'extinguida') AND pr.control_status != 'no_resuelto' AND pr.control_status != 'persiste' AND (pr.feedback_status IS NULL OR pr.feedback_status != 'persiste') AND pr.status != 'No Resuelta')";
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
    console.log('[PEST_RESPOND_REQUEST]:', {
      params: req.params,
      bodyKeys: Object.keys(req.body || {}),
      hasFiles: !!(req.files && req.files.length) || !!req.file,
      userId: req.user?.id,
      userRole: req.user?.role
    });

    // Soporte para archivos adjuntos recibidos directamente vía Multer
    let attachedDocUrl = req.body.attachment_doc_url || null;
    let attachedVideoUrl = req.body.attachment_video_url || null;
    let attachedDocName = req.body.attachment_doc_name || null;

    const uploadedFiles = req.files || (req.file ? [req.file] : []);
    for (const f of uploadedFiles) {
      const isVideo = (f.mimetype && f.mimetype.startsWith('video/')) || /\.(mp4|webm|mov|m4v)$/i.test(f.originalname || '');
      const isPdf = (f.mimetype && f.mimetype.includes('pdf')) || /\.pdf$/i.test(f.originalname || '');
      const folder = isVideo ? 'videos' : (isPdf ? 'documents' : 'general');
      const relativeUrl = `/uploads/${folder}/${f.filename}`;
      if (isVideo && !attachedVideoUrl) {
        attachedVideoUrl = relativeUrl;
      } else if (!attachedDocUrl) {
        attachedDocUrl = relativeUrl;
        if (!attachedDocName) attachedDocName = f.originalname || 'Guía Técnica Fitosanitaria';
      }
    }

    // Normalización de nombres de parámetros para recomendación/dictamen
    const advisor_response = req.body.advisor_response ||
                             req.body.dictamen_texto ||
                             req.body.dictamen ||
                             req.body.recommendation ||
                             req.body.response_text ||
                             req.body.text;

    const control_status = req.body.control_status || req.body.status || 'en_proceso';

    // Soporte para adjuntos en formato objeto o array
    if (req.body.adjuntos) {
      if (typeof req.body.adjuntos === 'object' && !Array.isArray(req.body.adjuntos)) {
        if (req.body.adjuntos.doc && !attachedDocUrl) attachedDocUrl = req.body.adjuntos.doc;
        if (req.body.adjuntos.video && !attachedVideoUrl) attachedVideoUrl = req.body.adjuntos.video;
        if (req.body.adjuntos.doc_name && !attachedDocName) attachedDocName = req.body.adjuntos.doc_name;
      } else if (Array.isArray(req.body.adjuntos)) {
        for (const item of req.body.adjuntos) {
          const url = typeof item === 'string' ? item : item.url;
          if (url) {
            if (/\.(mp4|webm|mov)$/i.test(url) && !attachedVideoUrl) attachedVideoUrl = url;
            else if (!attachedDocUrl) attachedDocUrl = url;
          }
        }
      }
    }

    if (!attachedDocName && attachedDocUrl) {
      attachedDocName = 'Guía Técnica Fitosanitaria';
    }

    const reportId = req.params.id || req.body.report_id || req.body.id;
    if (!reportId) {
      return res.status(400).json({ success: false, error: 'ID de reporte requerido.' });
    }

    if (!advisor_response || advisor_response.trim() === '') {
      return res.status(400).json({ success: false, error: 'La respuesta y recomendación técnica del asesor es obligatoria.' });
    }

    const report = await dbGet(`
      SELECT pr.*, u.name as farmer_name, p.name as parcel_name
      FROM pest_reports pr
      LEFT JOIN users u ON pr.farmer_id = u.id
      LEFT JOIN parcels p ON pr.parcel_id = p.id
      WHERE pr.id = ?
    `, [reportId]);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Reporte fitosanitario no encontrado.' });
    }

    const targetControlStatus = ['en_proceso', 'resuelto'].includes(control_status) ? control_status : 'en_proceso';
    const mainStatus = targetControlStatus === 'resuelto' ? 'resuelto' : 'en_revision';
    const advisorId = req.user?.id || req.body.advisor_id || report.advisor_id || 1;

    // 1. Registrar en historial de respuestas
    await dbRun(
      `INSERT INTO pest_report_responses (pest_report_id, advisor_id, response_text, control_status, attachment_video_url, attachment_doc_url, attachment_doc_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        advisorId,
        advisor_response.trim(),
        targetControlStatus,
        attachedVideoUrl ? attachedVideoUrl.trim() : null,
        attachedDocUrl ? attachedDocUrl.trim() : null,
        attachedDocName ? attachedDocName.trim() : null
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
        advisorId,
        mainStatus,
        targetControlStatus,
        attachedVideoUrl ? attachedVideoUrl.trim() : report.attachment_video_url,
        attachedDocUrl ? attachedDocUrl.trim() : report.attachment_doc_url,
        attachedDocName ? attachedDocName.trim() : report.attachment_doc_name,
        report.id
      ]
    );

    // 3. Notificar al agricultor
    const statusText = targetControlStatus === 'en_proceso' ? 'Tratamiento en Proceso' : 'Control Resuelto';
    const advisorName = req.user?.name || 'Asesor Técnico';
    await dbRun(
      `INSERT INTO notifications (user_id, type, title, message, severity)
       VALUES (?, 'asesoria', ?, ?, 'info')`,
      [
        report.farmer_id,
        `📋 Recomendación Técnica: ${report.pest_name} (${statusText})`,
        `El Asesor Técnico ${advisorName} ha emitido un dictamen y plan de control. Revisa las instrucciones y materiales adjuntos en tu panel.`
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
    console.error('[PEST_RESPONSE_ERROR]:', err);
    res.status(500).json({ success: false, error: 'Error al responder reporte: ' + (err.message || 'Error interno') });
  }
}

// Agricultor confirma seguimiento: Extinguida o Persiste (Requerimiento 4 / Plaga Persiste)
async function confirmPestFeedback(req, res) {
  try {
    const rawStatus = req.body.feedback_status || (req.body.status === 'No Resuelta' || req.body.status === 'no_resuelto' ? 'persiste' : 'persiste');
    const feedback_status = rawStatus === 'extinguida' ? 'extinguida' : 'persiste';
    const feedback_notes = req.body.feedback_notes || req.body.notes || req.body.observations || '';
    const feedbackMedia = req.body.media_url || req.body.photo_url || req.body.video_url || req.body.attachment_url || null;

    const reportId = req.params.id || req.body.report_id || req.body.id;
    const report = await dbGet(`
      SELECT pr.*, u.name as farmer_name, p.name as parcel_name
      FROM pest_reports pr
      LEFT JOIN users u ON pr.farmer_id = u.id
      LEFT JOIN parcels p ON pr.parcel_id = p.id
      WHERE pr.id = ?
    `, [reportId]);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Reporte fitosanitario no encontrado.' });
    }

    // Validar que el usuario sea el dueño agricultor (o asesor/admin)
    if (req.user.role !== 'admin' && req.user.role !== 'advisor' && report.farmer_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Solo el agricultor titular de la parcela puede confirmar el estado.' });
    }

    const isExtinguished = feedback_status === 'extinguida';
    // Mapeo no destructivo: 'No Resuelta' con prioridad urgente
    const newStatus = isExtinguished ? 'resuelto' : 'No Resuelta';
    const newControlStatus = isExtinguished ? 'resuelto' : 'no_resuelto';

    // UPDATE NO DESTRUCTIVO: preserva photo_url y descripción inicial
    await dbRun(
      `UPDATE pest_reports SET
        status = ?,
        control_status = ?,
        feedback_status = ?,
        feedback_notes = ?,
        feedback_media_url = ?,
        feedback_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        newStatus,
        newControlStatus,
        feedback_status,
        feedback_notes ? feedback_notes.trim() : null,
        feedbackMedia ? feedbackMedia.trim() : report.feedback_media_url,
        report.id
      ]
    );

    // Agregar al timeline/historial en pest_report_responses si la plaga persiste
    if (!isExtinguished) {
      const isVideo = feedbackMedia && (/\.(mp4|webm|mov)$/i.test(feedbackMedia) || feedbackMedia.includes('/videos/'));
      await dbRun(
        `INSERT INTO pest_report_responses (pest_report_id, advisor_id, response_text, control_status, attachment_video_url, attachment_doc_url, attachment_doc_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          report.id,
          report.advisor_id || req.user.id || 1,
          `⚠️ [ALERTA: LA PLAGA PERSISTE]: ${feedback_notes ? feedback_notes.trim() : 'El agricultor reporta que los síntomas persisten tras la aplicación del tratamiento.'}`,
          'no_resuelto',
          isVideo ? feedbackMedia : null,
          !isVideo ? feedbackMedia : null,
          feedbackMedia ? (isVideo ? 'Video de Plaga Persistente' : 'Evidencia Fotográfica de Persistencia') : null
        ]
      );
    }

    // Notificar al asesor técnico asignado o a todos los asesores
    const advisorTargetId = report.advisor_id;
    const notifTitle = isExtinguished
      ? `🎉 Plaga Extinguida: ${report.pest_name}`
      : `🚨 URGENTE: Plaga Persiste — ${report.pest_name} en Parcela "${report.parcel_name || 'Sin Parcela'}"`;
    const notifMsg = isExtinguished
      ? `El agricultor ${report.farmer_name} confirmó que el tratamiento fue efectivo y la plaga en "${report.parcel_name || 'su parcela'}" fue erradicada con éxito.`
      : `El agricultor ${report.farmer_name} reporta que la plaga "${report.pest_name}" en "${report.parcel_name || 'su parcela'}" NO ha cedido y persiste. Se requiere reformulación de dosis o nuevo plan de acción urgente.${feedback_notes ? ' Observaciones: ' + feedback_notes : ''}`;

    if (advisorTargetId) {
      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'asesoria', ?, ?, ?)`,
        [advisorTargetId, notifTitle, notifMsg, isExtinguished ? 'info' : 'critical']
      );
    } else {
      const advisors = await dbAll(`SELECT id FROM users WHERE role = 'advisor'`);
      for (const adv of advisors) {
        await dbRun(
          `INSERT INTO notifications (user_id, type, title, message, severity)
           VALUES (?, 'asesoria', ?, ?, ?)`,
          [adv.id, notifTitle, notifMsg, isExtinguished ? 'info' : 'critical']
        );
      }
    }

    res.json({
      success: true,
      message: isExtinguished
        ? '¡Excelente! Has confirmado que la plaga fue extinguida. El reporte queda cerrado satisfactoriamente.'
        : 'Reporte actualizado a No Resuelta. El Asesor Técnico ha sido alertado con prioridad urgente.',
      data: {
        id: report.id,
        status: newStatus,
        control_status: newControlStatus,
        feedback_status,
        feedback_notes,
        feedback_media_url: feedbackMedia
      }
    });
  } catch (err) {
    console.error('Error al confirmar feedback de plaga:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar el estado de seguimiento: ' + err.message });
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
