const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const { aiRateLimiter } = require('../middleware/aiRateLimiter');
const { recommend, frostRisk, irrigationPlan, advisoryChat } = require('../controllers/aiController');

// Rutas privadas de cultivo protegidas por JWT
router.get('/recommend/:cropId', authenticateToken, recommend);
router.get('/irrigation/:cropId', authenticateToken, irrigationPlan);

// Endpoint conversacional del asistente agrícola (FASE 9-L04: protegido por JWT y Rate Limiting)
router.post('/advisory-chat', authenticateToken, aiRateLimiter, advisoryChat);

// Métrica meteorológica regional general (pública)
router.get('/frost-risk', frostRisk);

module.exports = router;
