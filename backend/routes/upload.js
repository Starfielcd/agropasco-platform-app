/**
 * AgroPasco — Rutas de Carga de Archivos
 */

const router = require('express').Router();
const { handleFileUpload, handleBase64Upload } = require('../controllers/uploadController');
const { authenticateToken } = require('../middleware/auth');

// Ambas rutas requieren autenticación
router.use(authenticateToken);

// Subida Multipart (input type="file")
router.post('/', handleFileUpload);

// Subida Base64 (captura en vivo con cámara/canvas)
router.post('/base64', handleBase64Upload);

module.exports = router;
