/**
 * AgroPasco — Controlador de Autenticación
 */

const bcrypt = require('bcryptjs');
const { dbRun, dbGet } = require('../config/database');
const { generateToken } = require('../middleware/auth');

async function register(req, res) {
  try {
    const { name, email, password, role, location, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nombre, email y contraseña son obligatorios.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Este correo electrónico ya está registrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const validRole = ['farmer', 'advisor', 'supermarket'].includes(role) ? role : 'farmer';
    // Admin role cannot be self-assigned via registration — must be assigned by another admin

    const result = await dbRun(
      'INSERT INTO users (name, email, password_hash, role, location, phone) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, passwordHash, validRole, location || 'Cerro de Pasco', phone || null]
    );

    const user = { id: result.lastID, name, email, role: validRole };
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: '¡Registro exitoso! Bienvenido a AgroPasco.',
      data: { user, token }
    });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email y contraseña son obligatorios.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: '¡Bienvenido de vuelta!',
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, location: user.location },
        token
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getProfile(req, res) {
  try {
    const user = await dbGet(
      'SELECT id, name, email, role, location, phone, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { register, login, getProfile };
