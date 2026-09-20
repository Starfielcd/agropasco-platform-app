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

const { upload } = require('../controllers/uploadController');

// Asesor responde reporte con recomendación técnica, video o PDF (admite PUT y POST, JSON y Multipart)
router.put('/:id/respond', requireRole('advisor', 'admin'), upload.any(), respondReport);
router.post('/:id/respond', requireRole('advisor', 'admin'), upload.any(), respondReport);

// Agricultor confirma si la plaga fue extinguida o si persiste (vía /feedback o /persist o /status)
router.post('/:id/feedback', requireRole('farmer', 'admin'), confirmPestFeedback);
router.post('/:id/persist', requireRole('farmer', 'admin'), (req, res) => {
  req.body.feedback_status = 'persiste';
  return confirmPestFeedback(req, res);
});
router.put('/:id/persist', requireRole('farmer', 'admin'), (req, res) => {
  req.body.feedback_status = 'persiste';
  return confirmPestFeedback(req, res);
});
router.put('/:id/status', requireRole('farmer', 'advisor', 'admin'), (req, res) => {
  if (req.body.status === 'No Resuelta' || req.body.status === 'no_resuelto' || req.body.feedback_status === 'persiste') {
    req.body.feedback_status = 'persiste';
  }
  return confirmPestFeedback(req, res);
});

module.exports = router;
