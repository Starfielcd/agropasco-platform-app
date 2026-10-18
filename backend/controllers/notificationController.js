/**
 * AgroPasco — Controlador de Notificaciones de Usuario
 * ====================================================
 * Permite consultar la bandeja de notificaciones persistentes en PostgreSQL,
 * contar no leídas y marcarlas como leídas.
 */

const {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount
} = require('../services/notificationService');

async function getMyNotifications(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado.' });
    }

    const limit = parseInt(req.query.limit, 10) || 30;
    const unreadOnly = req.query.unread === 'true';

    const notifications = await getUserNotifications(userId, limit, unreadOnly);
    const unreadCount = await getUnreadCount(userId);

    res.json({
      success: true,
      data: notifications,
      unread_count: unreadCount,
      total: notifications.length
    });
  } catch (err) {
    console.error('Error al obtener notificaciones:', err);
    res.status(500).json({ success: false, error: 'Error al consultar notificaciones.' });
  }
}

async function markNotificationAsRead(req, res) {
  try {
    const userId = req.user?.id;
    const notifId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado.' });
    }

    await markAsRead(notifId, userId);
    const unreadCount = await getUnreadCount(userId);

    res.json({ success: true, message: 'Notificación marcada como leída.', unread_count: unreadCount });
  } catch (err) {
    console.error('Error al marcar notificación:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar notificación.' });
  }
}

async function markAllNotificationsAsRead(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado.' });
    }

    await markAllAsRead(userId);
    res.json({ success: true, message: 'Todas las notificaciones marcadas como leídas.', unread_count: 0 });
  } catch (err) {
    console.error('Error al marcar todas las notificaciones:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar notificaciones.' });
  }
}

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
};
