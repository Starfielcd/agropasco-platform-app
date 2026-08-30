/**
 * AgroPasco — Servicio de Notificaciones
 * Gestión de alertas para agricultores
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

/**
 * Crear una notificación para un usuario
 */
async function createNotification(userId, type, title, message, severity = 'info') {
  return await dbRun(
    'INSERT INTO notifications (user_id, type, title, message, severity) VALUES (?, ?, ?, ?, ?)',
    [userId, type, title, message, severity]
  );
}

/**
 * Crear alerta masiva para todos los agricultores de una ubicación
 */
async function createBulkAlert(type, title, message, severity, location = 'Cerro de Pasco') {
  const farmers = await dbAll(
    "SELECT id FROM users WHERE role = 'farmer' AND (location LIKE ? OR location IS NULL)",
    [`%${location}%`]
  );

  const results = [];
  for (const farmer of farmers) {
    const result = await createNotification(farmer.id, type, title, message, severity);
    results.push(result);
  }

  return { notified_users: farmers.length, type, severity };
}

/**
 * Obtener notificaciones de un usuario
 */
async function getUserNotifications(userId, limit = 20, unreadOnly = false) {
  const whereClause = unreadOnly ? 'AND read = 0' : '';
  return await dbAll(
    `SELECT * FROM notifications WHERE user_id = ? ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

/**
 * Marcar notificación como leída
 */
async function markAsRead(notificationId, userId) {
  return await dbRun(
    'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
}

/**
 * Marcar todas las notificaciones como leídas
 */
async function markAllAsRead(userId) {
  return await dbRun(
    'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0',
    [userId]
  );
}

/**
 * Contar notificaciones no leídas
 */
async function getUnreadCount(userId) {
  const result = await dbGet(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0',
    [userId]
  );
  return result?.count || 0;
}

module.exports = {
  createNotification,
  createBulkAlert,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount
};
