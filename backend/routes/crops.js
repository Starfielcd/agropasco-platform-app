const router = require('express').Router();
const { listCrops, createCrop, getCrop, updateCrop, deleteCrop, addCropLog, getTraceability } = require('../controllers/cropController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// All crop routes require authentication
router.use(authenticateToken);

router.get('/', listCrops);
router.post('/', requireRole('farmer', 'admin', 'advisor'), createCrop);
router.get('/:id', getCrop);
router.put('/:id', requireRole('farmer', 'admin', 'advisor'), updateCrop);
router.delete('/:id', requireRole('farmer', 'admin'), deleteCrop);
router.post('/:id/logs', requireRole('farmer', 'admin', 'advisor'), addCropLog);
router.get('/:id/traceability', getTraceability);

module.exports = router;
