const express = require('express');
const router = express.Router();
const {
  listNotices,
  getNoticeById,
  evaluateParcelRelevance,
  requirePhytosanitaryEnabled,
  requireAdminReviewEnabled,
  adminRegisterNotice,
  adminListPendingNotices,
  adminGetNoticeHistory,
  adminReviewNotice,
  adminApproveNotice,
  adminRejectNotice,
  adminWithdrawNotice,
  adminUpdateNotice,
  adminSupersedeNotice
} = require('../controllers/phytosanitaryController');
const { authenticateToken, optionalAuth, requireRole } = require('../middleware/auth');

// 1. Subrouter administrativo de revisión y gobernanza fitosanitaria (Sección 12 y 13)
const adminRouter = express.Router();
adminRouter.use(requireAdminReviewEnabled);
adminRouter.use(authenticateToken);

adminRouter.post('/notices', requireRole('admin'), adminRegisterNotice);
adminRouter.get('/notices/pending', requireRole('admin', 'advisor'), adminListPendingNotices);
adminRouter.get('/notices/:id/history', requireRole('admin', 'advisor'), adminGetNoticeHistory);
adminRouter.post('/notices/:id/review', requireRole('admin', 'advisor'), adminReviewNotice);
adminRouter.post('/notices/:id/approve', requireRole('admin'), adminApproveNotice);
adminRouter.post('/notices/:id/reject', requireRole('admin', 'advisor'), adminRejectNotice);
adminRouter.post('/notices/:id/withdraw', requireRole('admin'), adminWithdrawNotice);
adminRouter.post('/notices/:id/supersede', requireRole('admin'), adminSupersedeNotice);
adminRouter.put('/notices/:id', requireRole('admin'), adminUpdateNotice);

router.use('/admin', adminRouter);

// 2. Verificación maestra de Feature Flag (H-MED-02): denegación por defecto con HTTP 503
router.use(requirePhytosanitaryEnabled);

// 3. Consulta pública/autenticada de avisos oficiales verificados con paginación (H-BAJ-01)
router.get('/notices', optionalAuth, listNotices);
router.get('/notices/:id', optionalAuth, getNoticeById);

// 4. Consulta protegida por JWT de relevancia por parcela con autorización estricta (H-MED-01)
router.get('/parcels/:parcelId/relevance', authenticateToken, evaluateParcelRelevance);

module.exports = router;

