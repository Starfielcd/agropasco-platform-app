/**
 * AgroPasco — Rutas de Administración
 */

const router = require('express').Router();
const { listUsers, updateUserRole, deleteUser, getAuditLog, getSystemStats } = require('../controllers/adminController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Todas las rutas requieren admin
router.use(authenticateToken);
router.use(requireRole('admin'));

// Gestión de usuarios
router.get('/users', listUsers);
router.put('/users/:id/role', updateUserRole);
router.delete('/users/:id', deleteUser);

// Auditoría
router.get('/audit', getAuditLog);

// Estadísticas del sistema
router.get('/stats', getSystemStats);

module.exports = router;
