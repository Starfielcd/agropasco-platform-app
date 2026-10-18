/**
 * AgroPasco — Rutas de Notificaciones de Usuario
 * ==============================================
 */

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
} = require('../controllers/notificationController');

// Todas las operaciones requieren autenticación JWT
router.use(authenticateToken);

router.get('/', getMyNotifications);
router.put('/read-all', markAllNotificationsAsRead);
router.put('/:id/read', markNotificationAsRead);

module.exports = router;
