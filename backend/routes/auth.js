const router = require('express').Router();
const { register, login, getProfile, changePassword } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getProfile);
router.put('/change-password', authenticateToken, changePassword);

module.exports = router;
