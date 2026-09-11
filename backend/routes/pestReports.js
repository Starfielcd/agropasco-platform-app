/**
 * AgroPasco — Rutas de Reportes de Plagas
 */

const router = require('express').Router();
const { createReport, listReports, respondReport } = require('../controllers/pestReportController');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

// Farmer crea reporte
router.post('/', requireRole('farmer'), createReport);

// Farmer y advisor listan reportes
router.get('/', listReports);

// Advisor responde reporte
router.put('/:id/respond', requireRole('advisor'), respondReport);

module.exports = router;
