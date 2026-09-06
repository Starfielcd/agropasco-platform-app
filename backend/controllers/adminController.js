/**
 * AgroPasco — Controlador de Administración
 * Gestión de usuarios, auditoría y estadísticas
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

async function listUsers(req, res) {
  try {
    const { role, search } = req.query;

    let sql = 'SELECT id, name, email, role, location, phone, created_at, updated_at FROM users WHERE 1=1';
    const params = [];

    if (role) { sql += ' AND role = ?'; params.push(role); }
    if (search) { sql += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    sql += ' ORDER BY created_at DESC';

    const users = await dbAll(sql, params);

    // Estadísticas por rol
    const stats = await dbAll('SELECT role, COUNT(*) as count FROM users GROUP BY role');

    res.json({ success: true, data: users, total: users.length, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener usuarios.' });
  }
}

async function updateUserRole(req, res) {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    if (!role || !['farmer', 'advisor', 'supermarket', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Rol inválido.' });
    }

    // No permitir cambiar el rol del propio admin
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes cambiar tu propio rol.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    await dbRun('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role, userId]);

    // Audit log
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'UPDATE_ROLE', 'user', userId, `Rol cambiado de "${user.role}" a "${role}" para ${user.name}`, req.ip]
    );

    res.json({ success: true, message: `Rol de ${user.name} actualizado a ${role}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al actualizar rol.' });
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

    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    // Audit log
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'DELETE', 'user', userId, `Usuario "${user.name}" (${user.email}) eliminado`, req.ip]
    );

    res.json({ success: true, message: `Usuario ${user.name} eliminado.` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al eliminar usuario.' });
  }
}

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
    const totalMarkers = await dbGet('SELECT COUNT(*) as count FROM pest_markers WHERE resolved = 0');
    const totalRecommendations = await dbGet('SELECT COUNT(*) as count FROM advisor_recommendations WHERE status = "pendiente"');
    const recentLogs = await dbAll(
      `SELECT al.*, u.name as user_name FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT 10`
    );

    // API status
    const apiStatus = {
      maps: { provider: process.env.MAPS_PROVIDER || 'leaflet', status: 'active' },
      weather: { provider: 'Open-Meteo', status: process.env.WEATHER_API_KEY ? 'configured' : 'default' },
      database: { provider: 'SQLite', status: 'active' }
    };

    res.json({
      success: true,
      data: {
        users: { total: usersByRole.reduce((s, r) => s + r.count, 0), by_role: usersByRole },
        crops: { total: totalCrops?.count || 0 },
        parcels: { total: totalParcels?.count || 0 },
        products: { total: totalProducts?.count || 0 },
        pest_markers: { unresolved: totalMarkers?.count || 0 },
        recommendations: { pending: totalRecommendations?.count || 0 },
        recent_activity: recentLogs,
        apis: apiStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener estadísticas.' });
  }
}

module.exports = { listUsers, updateUserRole, deleteUser, getAuditLog, getSystemStats };
