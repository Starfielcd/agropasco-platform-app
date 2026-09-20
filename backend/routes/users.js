/**
 * AgroPasco — Rutas de Usuarios y Estado de Solicitudes
 */

const router = require('express').Router();
const { getApplicationStatus, setupApprovedPassword } = require('../controllers/authController');

// Consulta de estado de solicitud de cuenta para stepper dinámico
router.get('/application-status', getApplicationStatus);
router.get('/application-status/:identifier', getApplicationStatus);

// Configuración directa de contraseña para cuentas aprobadas (fallback si SMTP falla)
router.post('/setup-approved-password', setupApprovedPassword);

module.exports = router;
