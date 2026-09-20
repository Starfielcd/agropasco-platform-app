/**
 * AgroPasco — Rutas de Usuarios y Estado de Solicitudes
 */

const router = require('express').Router();
const { getApplicationStatus } = require('../controllers/authController');

// Consulta de estado de solicitud de cuenta para stepper dinámico
router.get('/application-status', getApplicationStatus);
router.get('/application-status/:identifier', getApplicationStatus);

module.exports = router;
