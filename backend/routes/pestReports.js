/**
 * AgroPasco — Rutas de Reportes de Plagas
 */

const router = require('express').Router();
const {
  createReport,
  listReports,
  respondReport,
  confirmPestFeedback,
  getReportResponses
} = require('../controllers/pestReportController');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);

// Agricultor crea reporte (con foto obligatoria)
router.post('/', requireRole('farmer', 'admin'), createReport);

// Listar reportes (según rol)
router.get('/', listReports);

// Obtener historial de dictámenes y materiales de un reporte
router.get('/:id/responses', getReportResponses);

// Asesor responde reporte con recomendación técnica, video o PDF
router.put('/:id/respond', requireRole('advisor', 'admin'), respondReport);

// Agricultor confirma si la plaga fue extinguida o si persiste
router.post('/:id/feedback', requireRole('farmer', 'admin'), confirmPestFeedback);

module.exports = router;
