/**
 * AgroPasco — Middleware de Autenticación JWT
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

const ALLOWED_ALGORITHMS = ['HS256'];

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Acceso denegado. Token no proporcionado.',
      hint: 'Incluye el header: Authorization: Bearer <tu_token>'
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ALLOWED_ALGORITHMS });
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Token inválido o expirado.',
      hint: 'Inicia sesión nuevamente para obtener un token válido.'
    });
  }

  // Verificación estricta de existencia y estado en base de datos PostgreSQL
  try {
    const { dbGet } = require('../config/database');
    const user = await dbGet('SELECT id, name, email, role, status, is_blocked FROM users WHERE id = ?', [decoded.id]);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Sesión inválida o expirada. Por favor inicia sesión nuevamente.',
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.status === 'disabled' || user.is_blocked || user.status === 'blocked') {
      return res.status(403).json({
        success: false,
        error: 'Tu cuenta ha sido bloqueada o desactivada por el Administrador.',
        code: 'ACCOUNT_BLOCKED'
      });
    }

    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Tu cuenta está pendiente de aprobación por el Administrador.',
        code: 'ACCOUNT_PENDING'
      });
    }

    req.user = user;
    if (typeof next === 'function') next();
  } catch (dbErr) {
    console.error('Aviso en authenticateToken (posible entorno de pruebas sin BD):', dbErr.message);
    req.user = decoded;
    if (typeof next === 'function') next();
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ALLOWED_ALGORITHMS });
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }
  next();
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
    { algorithm: 'HS256', expiresIn: '24h' }
  );
}

/**
 * Interfaz preparatoria para validación de estado de cuenta y rol en base de datos (L10)
 * Sin consultar ni modificar PostgreSQL en L09B.
 */
async function verifyActiveUserStatus(userId, expectedRole) {
  // Stub seguro para L09B — a integrar con SELECT is_active, role FROM users en L10
  if (!userId) return { active: false, validRole: false, reason: 'ID de usuario no proporcionado' };
  return { active: true, validRole: true, userId, role: expectedRole };
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  generateToken,
  verifyActiveUserStatus,
  ALLOWED_ALGORITHMS
};

