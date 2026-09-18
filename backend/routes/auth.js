const router = require('express').Router();
const {
  register,
  login,
  getProfile,
  changePassword,
  getSetupStatus,
  setupInitialAdmin
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// Autenticación estándar
router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getProfile);
router.put('/change-password', authenticateToken, changePassword);

// Registro inicial único del Administrador (Primer uso del sistema)
router.get('/setup-status', getSetupStatus);
router.post('/setup-admin', setupInitialAdmin);

module.exports = router;
