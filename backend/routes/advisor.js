/**
 * AgroPasco — Rutas del Asesor Técnico
 */

const router = require('express').Router();
const { createPestMarker, listPestMarkers, resolvePestMarker, createRecommendation, listRecommendations, getFarmers } = require('../controllers/advisorController');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);
router.use(requireRole('advisor'));

// Marcadores de plagas
router.get('/markers', listPestMarkers);
router.post('/markers', createPestMarker);
router.put('/markers/:id/resolve', resolvePestMarker);

// Recomendaciones técnicas
router.get('/recommendations', listRecommendations);
router.post('/recommendations', createRecommendation);

// Listar agricultores (para asignar recomendaciones)
router.get('/farmers', getFarmers);

module.exports = router;
