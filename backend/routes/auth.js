const router = require('express').Router();
const {
  register,
  login,
  getProfile,
  changePassword,
  getSetupStatus,
  setupInitialAdmin,
  getApplicationStatus,
  setupApprovedPassword
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// Autenticación estándar
router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getProfile);
router.put('/change-password', authenticateToken, changePassword);

// Estado de solicitud de cuenta
router.get('/application-status', getApplicationStatus);
router.get('/application-status/:identifier', getApplicationStatus);
router.post('/setup-approved-password', setupApprovedPassword);

// Registro inicial único del Administrador (Primer uso del sistema)
router.get('/setup-status', getSetupStatus);
router.post('/setup-admin', setupInitialAdmin);

module.exports = router;
