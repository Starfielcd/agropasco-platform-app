const router = require('express').Router();
const { listCrops, createCrop, getCrop, updateCrop, deleteCrop, addCropLog, getTraceability } = require('../controllers/cropController');
const { authenticateToken } = require('../middleware/auth');

// All crop routes require authentication
router.use(authenticateToken);

router.get('/', listCrops);
router.post('/', createCrop);
router.get('/:id', getCrop);
router.put('/:id', updateCrop);
router.delete('/:id', deleteCrop);
router.post('/:id/logs', addCropLog);
router.get('/:id/traceability', getTraceability);

module.exports = router;
