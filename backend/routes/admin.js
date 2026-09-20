/**
 * AgroPasco — Rutas de Administración y Soporte Integral
 */

const router = require('express').Router();
const {
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
} = require('../controllers/adminController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Todas las rutas requieren autenticación y rol de admin
router.use(authenticateToken);
router.use(requireRole('admin'));

// ===== 1. GESTIÓN DE USUARIOS =====
router.get('/users', listUsers);
router.put('/users/:id/role', updateUserRole);
router.put('/users/:id/status', toggleUserStatus);
router.post('/users/:id/reset-password', resetUserPassword);
router.post('/users/:id/resend-credentials', resendCredentials);
router.get('/duplicates', detectDuplicates);
router.delete('/users/:id', deleteUser);

// ===== 2. AUDITORÍA, ESTADÍSTICAS Y REPORTES =====
router.get('/audit', getAuditLog);
router.get('/stats', getSystemStats);
router.get('/stats/metric-detail', getMetricDetail);
router.get('/reports/activity', getActivityReport);

// ===== 3. MODERACIÓN DE CONTENIDO =====
router.get('/moderation/photos', getModerationPhotos);
router.delete('/moderation/photos', removeModerationPhoto);
router.get('/moderation/anomalies', getAnomalies);

// ===== 4. SOPORTE TÉCNICO Y TICKETS =====
router.get('/support/tickets', getTickets);
router.post('/support/tickets/:id/reply', respondTicket);
router.post('/support/tickets/:id/escalate', escalateTicket);

// ===== 5. GESTIÓN DE SOLICITUDES DE CUENTA =====
router.get('/pending-accounts', getPendingAccounts);
router.put('/accounts/:id/approve', approveAccount);
router.put('/accounts/:id/reject', rejectAccount);

// ===== 6. TRANSFERENCIA DE ADMINISTRACIÓN ÚNICA =====
router.post('/transfer', transferAdministration);

module.exports = router;
