/**
 * AgroPasco — Middleware de Autenticación JWT
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Acceso denegado. Token no proporcionado.',
      hint: 'Incluye el header: Authorization: Bearer <tu_token>'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Token inválido o expirado.',
      hint: 'Inicia sesión nuevamente para obtener un token válido.'
    });
  }
}

// Middleware para verificar roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Acceso restringido. Se requiere rol: ${roles.join(' o ')}`
      });
    }
    next();
  };
}

// Generar token JWT
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { authenticateToken, requireRole, generateToken };
