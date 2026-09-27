/**
 * AgroPasco — Rutas de Machine Learning Meteorológico
 * =====================================================
 * Endpoints protegidos por autenticación y roles.
 */

const router = require('express').Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  predictForParcel,
  predictionsForUser,
  allPredictions,
  modelsStatusEndpoint,
  generateAlerts,
  adminDashboard,
  getUserAlerts,
  markAlertAsRead,
  getUserPreferences,
  updateUserPreferences,
  getGroundTruthObservations,
  createGroundTruthObservation,
} = require('../controllers/mlController');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// === Predicciones ===
// Predicción para una parcela específica (farmer, advisor, admin)
router.get('/predict/:parcelId', predictForParcel);

// Predicciones de todas las parcelas del usuario autenticado (farmer)
router.get('/predictions', predictionsForUser);

// Predicciones globales (advisor, admin)
router.get('/predictions/all', requireRole('advisor', 'admin'), allPredictions);

// === Estado de Modelos ===
router.get('/models/status', modelsStatusEndpoint);

// === Alertas ===
// Alertas meteorológicas del usuario autenticado
router.get('/alerts', getUserAlerts);
router.put('/alerts/:id/read', markAlertAsRead);

// Preferencias de alertas del usuario
router.get('/preferences', getUserPreferences);
router.put('/preferences', updateUserPreferences);

// Generar alertas para todas las parcelas (solo admin)
router.post('/alerts/generate', requireRole('admin'), generateAlerts);

// === Observaciones Verificadas en Campo / SENAMHI ===
router.get('/observations', getGroundTruthObservations);
router.post('/observations', createGroundTruthObservation);

// === Admin Dashboard ===
router.get('/admin/dashboard', requireRole('admin'), adminDashboard);

module.exports = router;
