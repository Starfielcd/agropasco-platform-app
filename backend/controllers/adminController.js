/**
 * AgroPasco — Controlador de Administración y Soporte Técnico
 * Gestión de usuarios, duplicados, bloqueos, contraseñas, auditoría,
 * reportes institucionales, moderación y tickets de soporte.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { dbRun, dbGet, dbAll } = require('../config/database');
const { createNotification } = require('../services/notificationService');
const { sendApprovalEmail, sendPasswordResetEmail, sendRejectionEmail, sendAdminTransferEmail } = require('../services/emailService');

// ===== 1. GESTIÓN DE USUARIOS =====

async function listUsers(req, res) {
  try {
    const { role, search, status } = req.query;

    let sql = 'SELECT id, name, email, role, location, phone, status, is_blocked, created_at, updated_at FROM users WHERE 1=1';
    const params = [];

    if (role) { sql += ' AND role = ?'; params.push(role); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (search) { sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    sql += ' ORDER BY created_at DESC';

    const users = await dbAll(sql, params);
    const stats = await dbAll('SELECT role, COUNT(*) as count FROM users GROUP BY role');

    res.json({ success: true, data: users, total: users.length, stats });
  } catch (err) {
    console.error('Error al listar usuarios:', err);
    res.status(500).json({ success: false, error: 'Error al obtener usuarios.' });
  }
}

async function updateUserRole(req, res) {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    if (role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede asignar el rol de Administrador directamente. Debe utilizar la opción "Transferir Administración" para garantizar que exista un único administrador activo.'
      });
    }

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes cambiar tu propio rol.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede modificar el rol de una cuenta de Administrador desde esta opción.'
      });
    }

    await dbRun('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role, userId]);

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'UPDATE_ROLE', 'user', userId, `Rol cambiado de "${user.role}" a "${role}" para ${user.name}`, clientIp]
    );

    res.json({ success: true, message: `Rol de ${user.name} actualizado a ${role}.` });
  } catch (err) {
    console.error('Error al actualizar rol:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar rol.' });
  }
}

async function toggleUserStatus(req, res) {
  try {
    const userId = req.params.id;
    const { is_blocked, reason } = req.body;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes bloquear tu propia cuenta de administrador.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    const newBlockedState = is_blocked ? 1 : 0;
    const newStatus = newBlockedState ? 'blocked' : 'active';
    let tempPassword = null;
    let emailSent = false;
    let emailError = null;

    if (newBlockedState === 0) {
      // Al desbloquear, generar contraseña temporal y enviar email de acceso
      tempPassword = 'AP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!';
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      await dbRun(
        'UPDATE users SET is_blocked = 0, status = "active", password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [passwordHash, userId]
      );

      try {
        const mailRes = await sendPasswordResetEmail(user, tempPassword, 'Cuenta Reactivada / Desbloqueada por el Administrador');
        emailSent = mailRes && mailRes.success;
        if (!emailSent && mailRes?.error) emailError = mailRes.error;
      } catch (mailErr) {
        console.error('[UNBLOCK_EMAIL_ERROR]:', mailErr.message);
        emailError = mailErr.message;
      }
    } else {
      await dbRun('UPDATE users SET is_blocked = 1, status = "blocked", updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
    }

    const actionText = newBlockedState ? 'BLOQUEAR_CUENTA' : 'DESBLOQUEAR_CUENTA';
    const detailText = newBlockedState
      ? `Cuenta de "${user.name}" (${user.email}) bloqueada. Motivo: ${reason || 'Sospecha o infracción de normas'}`
      : `Cuenta de "${user.name}" reactivada por administración. Credenciales temporales generadas.`;

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, actionText, 'user', userId, detailText, req.ip]
    );

    res.json({
      success: true,
      message: `Cuenta de ${user.name} ${newBlockedState ? 'bloqueada' : 'desbloqueada y habilitada'} exitosamente.${tempPassword ? (emailSent ? ' Se enviaron las credenciales por correo.' : ' Credenciales listas para copia manual.') : ''}`,
      status: newStatus,
      is_blocked: newBlockedState,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      tempPassword,
      provisional_password: tempPassword,
      emailSent,
      emailError
    });
  } catch (err) {
    console.error('Error al alternar estado del usuario:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar estado del usuario.' });
  }
}

async function resetUserPassword(req, res) {
  try {
    const userId = req.params.id;
    const { temp_password } = req.body;

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    const provisionalPassword = (temp_password && temp_password.trim()) || ('AP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!');
    const passwordHash = await bcrypt.hash(provisionalPassword, 12);

    await dbRun(
      'UPDATE users SET password_hash = ?, must_change_password = 1, is_blocked = 0, status = "active", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, userId]
    );

    let emailSent = false;
    let emailError = null;
    try {
      const mailRes = await sendPasswordResetEmail(user, provisionalPassword, 'Restablecimiento de credenciales por el Administrador');
      emailSent = mailRes && mailRes.success;
      if (!emailSent && mailRes?.error) emailError = mailRes.error;
    } catch (mailErr) {
      console.error('[RESET_PASSWORD_EMAIL_ERROR]:', mailErr.message);
      emailError = mailErr.message;
    }

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'RESET_PASSWORD', 'user', userId, `Contraseña restablecida para ${user.name} (${user.email}). Clave temporal asignada.`, req.ip]
    );

    res.json({
      success: true,
      message: `Contraseña restablecida exitosamente para ${user.name}.${emailSent ? ' Se envió un email con las credenciales.' : ' Credencial lista para copia manual.'}`,
      provisional_password: provisionalPassword,
      tempPassword: provisionalPassword,
      emailSent,
      emailError
    });
  } catch (err) {
    console.error('Error al resetear contraseña:', err);
    res.status(500).json({ success: false, error: 'Error al restablecer contraseña.' });
  }
}

async function resendCredentials(req, res) {
  try {
    const userId = req.params.id;
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    const tempPassword = 'AP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!';
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await dbRun(
      'UPDATE users SET password_hash = ?, must_change_password = 1, is_blocked = 0, status = "active", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, userId]
    );

    let emailSent = false;
    let emailError = null;
    try {
      const mailRes = await sendPasswordResetEmail(user, tempPassword, 'Reenvío de credenciales de acceso solicitadas por Administración');
      emailSent = mailRes && mailRes.success;
      if (!emailSent && mailRes?.error) emailError = mailRes.error;
    } catch (mailErr) {
      console.error('[RESEND_CREDENTIALS_EMAIL_ERROR]:', mailErr.message);
      emailError = mailErr.message;
    }

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'RESEND_CREDENTIALS', 'user', userId, `Credenciales reenviadas a ${user.name} (${user.email}).`, req.ip]
    );

    res.json({
      success: true,
      message: `Credenciales regeneradas y reenviadas exitosamente a ${user.email}.${emailSent ? '' : ' Credencial lista para copia manual.'}`,
      tempPassword,
      provisional_password: tempPassword,
      emailSent,
      emailError
    });
  } catch (err) {
    console.error('Error al reenviar credenciales:', err);
    res.status(500).json({ success: false, error: 'Error al reenviar credenciales.' });
  }
}

async function detectDuplicates(req, res) {
  try {
    // Buscar usuarios con nombres idénticos o teléfonos repetidos o emails con prefijos idénticos
    const allUsers = await dbAll('SELECT id, name, email, role, location, phone, created_at FROM users ORDER BY name ASC');
    const duplicates = [];

    for (let i = 0; i < allUsers.length; i++) {
      for (let j = i + 1; j < allUsers.length; j++) {
        const u1 = allUsers[i];
        const u2 = allUsers[j];

        const sameName = u1.name.trim().toLowerCase() === u2.name.trim().toLowerCase();
        const samePhone = u1.phone && u2.phone && u1.phone.trim() === u2.phone.trim();
        const email1User = u1.email.split('@')[0].toLowerCase();
        const email2User = u2.email.split('@')[0].toLowerCase();
        const similarEmail = email1User === email2User;

        if (sameName || samePhone || similarEmail) {
          duplicates.push({
            reason: sameName ? 'Nombre idéntico' : samePhone ? 'Teléfono compartido' : 'Prefijo de email idéntico',
            accounts: [u1, u2]
          });
        }
      }
    }

    res.json({ success: true, data: duplicates, total: duplicates.length });
  } catch (err) {
    console.error('Error al detectar duplicados:', err);
    res.status(500).json({ success: false, error: 'Error al escanear duplicados.' });
  }
}

async function deleteUser(req, res) {
  try {
    const userId = req.params.id;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes eliminar tu propia cuenta.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar una cuenta de Administrador. Si desea relevar sus funciones, utilice "Transferir Administración".'
      });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'DELETE', 'user', userId, `Usuario "${user.name}" (${user.email}) eliminado`, req.ip]
    );

    res.json({ success: true, message: `Usuario ${user.name} eliminado.` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al eliminar usuario.' });
  }
}

// ===== 2. AUDITORÍA, ESTADÍSTICAS Y REPORTES =====

async function getAuditLog(req, res) {
  try {
    const { action, entity_type, limit } = req.query;

    let sql = `SELECT al.*, u.name as user_name, u.role as user_role
               FROM audit_logs al
               LEFT JOIN users u ON al.user_id = u.id
               WHERE 1=1`;
    const params = [];

    if (action) { sql += ' AND al.action = ?'; params.push(action); }
    if (entity_type) { sql += ' AND al.entity_type = ?'; params.push(entity_type); }

    sql += ' ORDER BY al.created_at DESC';
    sql += ` LIMIT ${parseInt(limit) || 100}`;

    const logs = await dbAll(sql, params);
    res.json({ success: true, data: logs, total: logs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener log de auditoría.' });
  }
}

async function getSystemStats(req, res) {
  try {
    const usersByRole = await dbAll('SELECT role, COUNT(*) as count FROM users GROUP BY role');
    const totalCrops = await dbGet('SELECT COUNT(*) as count FROM crops');
    const totalParcels = await dbGet('SELECT COUNT(*) as count FROM parcels');
    const totalProducts = await dbGet('SELECT COUNT(*) as count FROM products');
    const activeProducts = await dbGet("SELECT COUNT(*) as count FROM products WHERE validation_status = 'approved'");
    const totalPests = await dbGet('SELECT COUNT(*) as count FROM pest_reports');
    const resolvedPests = await dbGet("SELECT COUNT(*) as count FROM pest_reports WHERE status = 'resuelto'");
    const pendingPests = await dbGet("SELECT COUNT(*) as count FROM pest_reports WHERE status != 'resuelto'");
    const totalTickets = await dbGet('SELECT COUNT(*) as count FROM support_tickets');

    const recentLogs = await dbAll(
      `SELECT al.*, u.name as user_name FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT 10`
    );

    const apiStatus = {
      maps: { provider: process.env.MAPS_PROVIDER || 'leaflet', status: 'active' },
      weather: { provider: 'Open-Meteo', status: 'active' },
      database: { provider: 'SQLite (WAL)', status: 'active' }
    };

    res.json({
      success: true,
      data: {
        users: { total: usersByRole.reduce((s, r) => s + r.count, 0), by_role: usersByRole },
        crops: { total: totalCrops?.count || 0 },
        parcels: { total: totalParcels?.count || 0 },
        products: { total: totalProducts?.count || 0, active: activeProducts?.count || 0 },
        pest_reports: { total: totalPests?.count || 0, resolved: resolvedPests?.count || 0, pending: pendingPests?.count || 0 },
        support_tickets: { total: totalTickets?.count || 0 },
        recent_activity: recentLogs,
        apis: apiStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener estadísticas.' });
  }
}

// Detalle modal al hacer clic en una métrica (drilldown)
async function getMetricDetail(req, res) {
  try {
    const { type } = req.query; // 'farmers', 'advisors', 'supermarkets', 'products', 'pests', 'parcels'
    let data = [];

    switch (type) {
      case 'farmers':
        data = await dbAll(`
          SELECT u.id, u.name, u.email, u.phone, u.location, u.created_at,
                 (SELECT COUNT(*) FROM parcels p WHERE p.user_id = u.id) as parcel_count,
                 (SELECT COUNT(*) FROM crops c WHERE c.user_id = u.id) as crop_count
          FROM users u WHERE u.role = 'farmer' ORDER BY u.created_at DESC
        `);
        break;

      case 'advisors':
        data = await dbAll(`
          SELECT u.id, u.name, u.email, u.phone, u.location, u.status, u.is_blocked, u.created_at,
                 (SELECT COUNT(*) FROM pest_reports pr WHERE pr.advisor_id = u.id) as resolved_pests_count
          FROM users u WHERE u.role = 'advisor' ORDER BY u.created_at DESC
        `);
        break;

      case 'supermarkets':
        data = await dbAll(`
          SELECT u.id, u.name, u.email, u.phone, u.location, u.status, u.is_blocked, u.created_at
          FROM users u WHERE u.role = 'supermarket' ORDER BY u.created_at DESC
        `);
        break;

      case 'products':
        data = await dbAll(`
          SELECT p.id, p.name, p.crop_type, p.quality, p.price_per_kg, p.original_price,
                 p.is_natural, p.validation_status, p.stock_kg, p.photo_url, u.name as farmer_name
          FROM products p LEFT JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC
        `);
        break;

      case 'pests':
        data = await dbAll(`
          SELECT pr.id, pr.pest_name, pr.severity, pr.status, pr.photo_url, pr.created_at,
                 u.name as farmer_name, p.name as parcel_name
          FROM pest_reports pr
          LEFT JOIN users u ON pr.farmer_id = u.id
          LEFT JOIN parcels p ON pr.parcel_id = p.id
          ORDER BY pr.created_at DESC
        `);
        break;

      case 'parcels':
        data = await dbAll(`
          SELECT p.id, p.name, p.crop_type, p.area_hectares, p.altitude_masl, p.status,
                 u.name as farmer_name, u.location as farmer_location
          FROM parcels p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC
        `);
        break;

      default:
        return res.status(400).json({ success: false, error: 'Tipo de métrica no soportado.' });
    }

    res.json({ success: true, type, data, total: data.length });
  } catch (err) {
    console.error('Error al obtener detalle de métrica:', err);
    res.status(500).json({ success: false, error: 'Error al obtener desglose de métrica.' });
  }
}

// Reporte exportable consolidado (para universidad / instituciones)
async function getActivityReport(req, res) {
  try {
    const farmers = await dbAll("SELECT id, name, email, location, phone, created_at FROM users WHERE role = 'farmer'");
    const advisors = await dbAll("SELECT id, name, email, location, phone, created_at FROM users WHERE role = 'advisor'");
    const parcels = await dbAll("SELECT p.id, p.name, p.crop_type, p.area_hectares, p.altitude_masl, u.name as farmer_name FROM parcels p JOIN users u ON p.user_id = u.id");
    const products = await dbAll("SELECT p.id, p.name, p.crop_type, p.stock_kg, p.price_per_kg, p.is_natural, p.validation_status, u.name as farmer_name FROM products p LEFT JOIN users u ON p.farmer_id = u.id");
    const pests = await dbAll("SELECT pr.id, pr.pest_name, pr.severity, pr.status, pr.created_at, u.name as farmer_name FROM pest_reports pr JOIN users u ON pr.farmer_id = u.id");

    const summary = {
      institucion: 'Universidad Nacional Daniel Alcides Carrión (UNDAC) / Institución Evaluadora',
      plataforma: 'AgroPasco Digital 2.0',
      fecha_generacion: new Date().toISOString(),
      region: 'Pasco, Perú (Provincias: Daniel A. Carrión, Pasco, Oxapampa)',
      totales: {
        agricultores_activos: farmers.length,
        asesores_tecnicos: advisors.length,
        parcelas_mapeadas: parcels.length,
        area_total_hectareas: parcels.reduce((s, p) => s + (p.area_hectares || 0), 0).toFixed(2),
        productos_registrados: products.length,
        productos_validados_natural: products.filter(p => p.is_natural === 1).length,
        plagas_reportadas: pests.length,
        plagas_atendidas: pests.filter(p => p.status === 'resuelto').length
      },
      detalles: {
        agricultores: farmers,
        parcelas,
        productos,
        plagas
      }
    };

    res.json({ success: true, report: summary });
  } catch (err) {
    console.error('Error al generar reporte institucional:', err);
    res.status(500).json({ success: false, error: 'Error al generar reporte consolidado.' });
  }
}

// ===== 3. MODERACIÓN DE CONTENIDO Y DETECCIÓN DE ANOMALÍAS =====

async function getModerationPhotos(req, res) {
  try {
    const productPhotos = await dbAll(`
      SELECT p.id, 'producto' as entity_type, p.name as title, p.photo_url, p.created_at,
             u.name as uploader_name, u.role as uploader_role
      FROM products p LEFT JOIN users u ON p.farmer_id = u.id
      WHERE p.photo_url IS NOT NULL AND p.photo_url != ''
    `);

    const pestPhotos = await dbAll(`
      SELECT pr.id, 'plaga' as entity_type, pr.pest_name as title, pr.photo_url, pr.created_at,
             u.name as uploader_name, u.role as uploader_role
      FROM pest_reports pr LEFT JOIN users u ON pr.farmer_id = u.id
      WHERE pr.photo_url IS NOT NULL AND pr.photo_url != ''
    `);

    const allPhotos = [...productPhotos, ...pestPhotos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, data: allPhotos, total: allPhotos.length });
  } catch (err) {
    console.error('Error al obtener fotos para moderación:', err);
    res.status(500).json({ success: false, error: 'Error al cargar muro de fotos.' });
  }
}

async function removeModerationPhoto(req, res) {
  try {
    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ success: false, error: 'entity_type y entity_id son obligatorios.' });
    }

    if (entity_type === 'producto') {
      await dbRun('UPDATE products SET photo_url = NULL WHERE id = ?', [entity_id]);
    } else if (entity_type === 'plaga') {
      await dbRun('UPDATE pest_reports SET photo_url = NULL WHERE id = ?', [entity_id]);
    }

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'MODERACION_FOTO_ELIMINADA', entity_type, entity_id, `Fotografía retirada por administrador por moderación`, req.ip]
    );

    res.json({ success: true, message: 'Fotografía retirada exitosamente.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al retirar fotografía.' });
  }
}

async function getAnomalies(req, res) {
  try {
    // 1. Precios absurdos (ej: menor a S/ 0.50 o mayor a S/ 250 por kg)
    const priceAnomalies = await dbAll(`
      SELECT p.id, p.name, p.price_per_kg, p.stock_kg, u.name as farmer_name
      FROM products p LEFT JOIN users u ON p.farmer_id = u.id
      WHERE p.price_per_kg > 250 OR p.price_per_kg < 0.5 OR p.stock_kg > 50000
    `);

    // 2. Coordenadas sospechosas en parcelas (fuera del rango aprox de Pasco: lat [-11.5, -9.5], lng [-77.0, -74.5])
    const coordAnomalies = await dbAll(`
      SELECT p.id, p.name, p.center_lat, p.center_lng, p.altitude_masl, u.name as farmer_name
      FROM parcels p LEFT JOIN users u ON p.user_id = u.id
      WHERE (p.center_lat IS NOT NULL AND (p.center_lat > -9.0 OR p.center_lat < -12.0))
         OR (p.center_lng IS NOT NULL AND (p.center_lng > -74.0 OR p.center_lng < -77.5))
         OR (p.altitude_masl IS NOT NULL AND (p.altitude_masl < 1000 OR p.altitude_masl > 5500))
    `);

    res.json({
      success: true,
      data: {
        price_anomalies: priceAnomalies,
        coord_anomalies: coordAnomalies,
        total: priceAnomalies.length + coordAnomalies.length
      }
    });
  } catch (err) {
    console.error('Error al detectar anomalías:', err);
    res.status(500).json({ success: false, error: 'Error al escanear anomalías.' });
  }
}

// ===== 4. SOPORTE TÉCNICO Y TICKETS =====

async function getTickets(req, res) {
  try {
    const { status, category } = req.query;
    let sql = 'SELECT * FROM support_tickets WHERE 1=1';
    const params = [];

    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (category) { sql += ' AND category = ?'; params.push(category); }

    sql += ' ORDER BY created_at DESC';
    const tickets = await dbAll(sql, params);

    res.json({ success: true, data: tickets, total: tickets.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener tickets de soporte.' });
  }
}

async function respondTicket(req, res) {
  try {
    const ticketId = req.params.id;
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ success: false, error: 'La respuesta es obligatoria.' });
    }

    await dbRun(
      `UPDATE support_tickets SET response = ?, status = 'resuelto', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [response, ticketId]
    );

    res.json({ success: true, message: 'Ticket respondido y marcado como resuelto.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al responder ticket.' });
  }
}

async function escalateTicket(req, res) {
  try {
    const ticketId = req.params.id;

    await dbRun(
      `UPDATE support_tickets SET escalated_to_dev = 1, status = 'en_atencion', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    );

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'ESCALAR_TICKET_DEV', 'support_ticket', ticketId, `Incidencia escalada a ingenieros de software / devops`, req.ip]
    );

    res.json({ success: true, message: 'Ticket escalado exitosamente a desarrolladores.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al escalar ticket.' });
  }
}

// ===== 5. GESTIÓN DE SOLICITUDES DE CUENTA (APROBACIÓN / RECHAZO) =====

async function getPendingAccounts(req, res) {
  try {
    const pending = await dbAll(
      `SELECT id, name, email, role, location, phone, status, created_at
       FROM users
       WHERE status = 'pending' AND role IN ('advisor', 'supermarket')
       ORDER BY created_at ASC`
    );

    res.json({ success: true, data: pending, total: pending.length });
  } catch (err) {
    console.error('Error al obtener solicitudes pendientes:', err);
    res.status(500).json({ success: false, error: 'Error al obtener solicitudes pendientes.' });
  }
}

async function approveAccount(req, res) {
  try {
    const userId = req.params.id;

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Esta cuenta no está pendiente de aprobación.' });
    }

    // Generar contraseña temporal segura
    const tempPassword = 'AP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!';
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Activar cuenta con contraseña temporal y flag de cambio obligatorio
    await dbRun(
      `UPDATE users SET
        status = 'active',
        is_blocked = 0,
        password_hash = ?,
        must_change_password = 1,
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, req.user.id, userId]
    );

    // Notificación interna al usuario
    const roleLabel = user.role === 'advisor' ? 'Asesor Técnico' : 'Supermercado';
    await createNotification(
      user.id,
      'sistema',
      '✅ Cuenta Aprobada',
      `¡Bienvenido a AgroPasco Digital! Tu cuenta como ${roleLabel} ha sido aprobada por el Administrador. Inicia sesión con las credenciales enviadas a tu correo.`,
      'info'
    );

    // Email con credenciales temporales (envuelto para no bloquear la aprobación en caso de falla SMTP)
    let emailSent = false;
    let emailError = null;
    try {
      const mailRes = await sendApprovalEmail(user, tempPassword);
      emailSent = mailRes && mailRes.success;
      if (!emailSent && mailRes?.error) emailError = mailRes.error;
    } catch (mailErr) {
      console.error('[APPROVE_ACCOUNT_EMAIL_ERROR]:', mailErr.message);
      emailError = mailErr.message;
    }

    // Registro de auditoría
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'APROBAR_CUENTA', 'user', userId, `Cuenta de "${user.name}" (${user.email}) aprobada como ${roleLabel}. Credenciales temporales generadas.`, req.ip]
    );

    res.json({
      success: true,
      message: `Cuenta de ${user.name} aprobada exitosamente.${emailSent ? ' Se ha enviado un email con las credenciales temporales.' : ' Credenciales listas para copia manual por el Administrador.'}`,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      tempPassword,
      provisional_password: tempPassword,
      emailSent,
      emailError
    });
  } catch (err) {
    console.error('Error al aprobar cuenta:', err);
    res.status(500).json({ success: false, error: 'Error al aprobar la cuenta.' });
  }
}

async function rejectAccount(req, res) {
  try {
    const userId = req.params.id;
    const { reason } = req.body;

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Esta cuenta no está pendiente de aprobación.' });
    }

    // Rechazar y bloquear la cuenta
    await dbRun(
      `UPDATE users SET
        status = 'rejected',
        is_blocked = 1,
        rejection_reason = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Solicitud rechazada por el Administrador.', userId]
    );

    // Notificación interna al usuario
    const roleLabel = user.role === 'advisor' ? 'Asesor Técnico' : 'Supermercado';
    await createNotification(
      user.id,
      'sistema',
      '❌ Solicitud de Cuenta Rechazada',
      `Tu solicitud como ${roleLabel} ha sido rechazada. Motivo: ${reason || 'No especificado'}. Contacta a Soporte Técnico si tienes dudas.`,
      'critical'
    );

    // Email de rechazo
    await sendRejectionEmail(user, reason);

    // Registro de auditoría
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'RECHAZAR_CUENTA', 'user', userId, `Cuenta de "${user.name}" (${user.email}) rechazada como ${roleLabel}. Motivo: ${reason || 'No especificado'}`, req.ip]
    );

    res.json({
      success: true,
      message: `Solicitud de ${user.name} rechazada. Se ha notificado al usuario.`
    });
  } catch (err) {
    console.error('Error al rechazar cuenta:', err);
    res.status(500).json({ success: false, error: 'Error al rechazar la cuenta.' });
  }
}

// ===== 6. TRANSFERENCIA DE ADMINISTRACIÓN ÚNICA =====
async function transferAdministration(req, res) {
  try {
    const { currentPassword, newAdminName, newAdminEmail, newAdminPassword, newAdminPhone, newAdminLocation } = req.body;

    if (!currentPassword || !newAdminName || !newAdminEmail) {
      return res.status(400).json({
        success: false,
        error: 'Tu contraseña actual de administrador, el nombre y el correo del nuevo administrador son obligatorios.'
      });
    }

    // 1. Obtener datos del administrador actual
    const currentAdmin = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!currentAdmin || currentAdmin.role !== 'admin' || currentAdmin.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Solo el Administrador Central activo puede transferir la administración del sistema.'
      });
    }

    // 2. Validar contraseña del administrador actual
    const validCurrent = await bcrypt.compare(currentPassword, currentAdmin.password_hash);
    if (!validCurrent) {
      return res.status(401).json({
        success: false,
        error: 'Contraseña de confirmación incorrecta. No se autorizó la transferencia de administración.'
      });
    }

    const cleanNewEmail = newAdminEmail.trim().toLowerCase();
    if (cleanNewEmail === currentAdmin.email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: 'El correo del nuevo administrador debe ser diferente a tu correo actual.'
      });
    }

    // 3. Generar contraseña temporal segura para el nuevo administrador
    const tempPassword = newAdminPassword && newAdminPassword.length >= 6
      ? newAdminPassword
      : 'AP-ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!';
    const newPasswordHash = await bcrypt.hash(tempPassword, 12);

    // 4. Verificar si el usuario ya existe en la base de datos (sin borrar usuarios existentes)
    const existingUser = await dbGet('SELECT * FROM users WHERE email = ?', [cleanNewEmail]);
    let newAdminId;

    if (existingUser) {
      // Promover usuario existente a Administrador único activo
      await dbRun(
        `UPDATE users SET
          name = ?,
          role = 'admin',
          password_hash = ?,
          status = 'active',
          is_blocked = 0,
          must_change_password = 1,
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newAdminName.trim(), newPasswordHash, currentAdmin.id, existingUser.id]
      );
      newAdminId = existingUser.id;
    } else {
      // Crear nuevo usuario como Administrador
      const insertRes = await dbRun(
        `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password, approved_by, approved_at)
         VALUES (?, ?, ?, 'admin', ?, ?, 'active', 0, 1, ?, CURRENT_TIMESTAMP)`,
        [newAdminName.trim(), cleanNewEmail, newPasswordHash, newAdminLocation || 'Cerro de Pasco', newAdminPhone || null, currentAdmin.id]
      );
      newAdminId = insertRes.lastID;
    }

    // 5. Deshabilitar al administrador anterior para asegurar que NO exista más de un admin activo a la vez
    await dbRun(
      `UPDATE users SET
        status = 'disabled',
        is_blocked = 1,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [currentAdmin.id]
    );

    // Asegurar que ningún otro usuario tenga rol admin y status active
    await dbRun(
      `UPDATE users SET status = 'disabled', is_blocked = 1 WHERE role = 'admin' AND id != ?`,
      [newAdminId]
    );

    // 6. Registrar en el libro de auditoría inmutable
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        currentAdmin.id,
        'TRANSFERENCIA_ADMINISTRACION',
        'user',
        newAdminId,
        `Administración Central transferida por "${currentAdmin.name}" (${currentAdmin.email}) hacia "${newAdminName}" (${cleanNewEmail}). Cuenta previa deshabilitada.`,
        clientIp
      ]
    );

    // 7. Notificación interna y correo automático con credenciales temporales
    await createNotification(
      newAdminId,
      'sistema',
      '👑 Transferencia de Administración',
      `¡Has sido designado como el nuevo Administrador Central de AgroPasco Digital! Por seguridad, debes cambiar tu contraseña obligatoriamente al iniciar sesión.`,
      'info'
    );

    const loginUrl = `${req.protocol}://${req.get('host')}/#/login`;
    await sendAdminTransferEmail({
      name: newAdminName.trim(),
      email: cleanNewEmail,
      tempPassword,
      transferrerName: currentAdmin.name,
      loginUrl
    });

    res.json({
      success: true,
      message: `¡Administración transferida exitosamente a ${newAdminName} (${cleanNewEmail})! Tu sesión actual ha sido deshabilitada por seguridad.`,
      tempPassword, // Se devuelve en el payload para visualización de respaldo
      newAdminId
    });
  } catch (err) {
    console.error('Error al transferir administración:', err);
    res.status(500).json({ success: false, error: 'Error al procesar la transferencia de administración.' });
  }
}

module.exports = {
  listUsers,
  updateUserRole,
  toggleUserStatus,
  resetUserPassword,
  detectDuplicates,
  deleteUser,
  getAuditLog,
  getSystemStats,
  getMetricDetail,
  getActivityReport,
  getModerationPhotos,
  removeModerationPhoto,
  getAnomalies,
  getTickets,
  respondTicket,
  escalateTicket,
  getPendingAccounts,
  approveAccount,
  rejectAccount,
  resendCredentials,
  transferAdministration
};
