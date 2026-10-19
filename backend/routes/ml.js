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
  get5ModelsComparison,
  predictManualSimulation,
  getParcelHorizonsPrediction,
  getPredictionsVsObservationsEvaluation,
  getMonteCarloSimulationContract,
  getAgentsStatusContract,
  runMonteCarloSimulation,
} = require('../controllers/mlController');

const {
  getMitigationStrategiesForParcel,
  recordMitigationAction,
  getParcelActionHistory,
  addAdvisorMitigationNote,
} = require('../controllers/mitigationController');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// === Predicciones ===
// Predicción para una parcela específica (farmer, advisor, admin)
router.get('/predict/:parcelId', predictForParcel);

// Predicción horaria estructurada en horizontes 24h, 48h, 72h para gráficos
router.get('/predict/:parcelId/horizons', getParcelHorizonsPrediction);

// Simulación y predicción manual interactiva para el Dashboard
router.post('/predict/manual', predictManualSimulation);

// Simulación estocástica Monte Carlo (Fase 4)
router.post('/simulation/monte-carlo', runMonteCarloSimulation);

// Predicciones de todas las parcelas del usuario autenticado (farmer)
router.get('/predictions', predictionsForUser);

// Predicciones globales (advisor, admin)
router.get('/predictions/all', requireRole('advisor', 'admin'), allPredictions);

// === Estado y Comparativa de 5 Modelos ML ===
router.get('/models/status', modelsStatusEndpoint);
router.get('/models/comparison', get5ModelsComparison);

// === Evaluación vs Observaciones de Campo ===
router.get('/evaluation/predictions-vs-observations', getPredictionsVsObservationsEvaluation);

// === Contratos Preparados para el Dashboard (Fase 3) ===
router.get('/simulation/contract', getMonteCarloSimulationContract);
router.get('/agents/status', getAgentsStatusContract);

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

// === Estrategias de Mitigación Agrícola y Respuesta Agroclimática (Fase 5) ===
router.get('/mitigation/strategies/:parcelId', getMitigationStrategiesForParcel);
router.post('/mitigation/actions', recordMitigationAction);
router.get('/mitigation/actions/:parcelId', getParcelActionHistory);
router.post('/mitigation/advisor-note', requireRole('advisor', 'admin'), addAdvisorMitigationNote);

// === SISTEMA MULTIAGENTE INTELIGENTE (Fase 6) ===
const {
  executeWorkflowEndpoint,
  getTaskStatusEndpoint,
  getParcelTasksEndpoint,
  getOperationalStatusEndpoint,
  getAuditLogsEndpoint,
} = require('../controllers/agentController');

router.post('/agents/workflow/execute', executeWorkflowEndpoint);
router.get('/agents/tasks/:taskId', getTaskStatusEndpoint);
router.get('/agents/tasks/parcel/:parcelId', getParcelTasksEndpoint);
router.get('/agents/operational-status', getOperationalStatusEndpoint);
router.get('/agents/audit-logs', getAuditLogsEndpoint);

// === AUTOMATIZACIÓN Y PREDICCIÓN VS REALIDAD (Fase 7) ===
const {
  getSchedulerStatusEndpoint,
  triggerSchedulerRunEndpoint,
  getPredictionHistoryEndpoint,
  evaluatePredictionsEndpoint,
  assignAdvisorParcelEndpoint,
} = require('../controllers/schedulerController');

router.get('/scheduler/status', getSchedulerStatusEndpoint);
router.post('/scheduler/trigger', triggerSchedulerRunEndpoint);
router.get('/predictions/history/:parcelId', getPredictionHistoryEndpoint);
router.post('/predictions/evaluate', evaluatePredictionsEndpoint);
router.post('/advisors/assign-parcel', assignAdvisorParcelEndpoint);

module.exports = router;



