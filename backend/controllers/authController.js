/**
 * AgroPasco — Controlador de Autenticación
 * Login, registro con flujo de aprobación y cambio de contraseña
 */

const bcrypt = require('bcryptjs');
const { dbRun, dbGet, dbAll } = require('../config/database');
const { generateToken } = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');
const { sendNewAccountRequestEmail } = require('../services/emailService');

async function register(req, res) {
  try {
    const { name, email, password, role, location, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nombre, email y contraseña son obligatorios.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // ===== BLOQUEAR registro de Administrador desde la interfaz pública =====
    if (role === 'admin') {
      return res.status(403).json({
        success: false,
        error: 'No es posible registrar una cuenta de Administrador. El administrador se configura internamente.'
      });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Este correo electrónico ya está registrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const validRole = ['farmer', 'advisor', 'supermarket'].includes(role) ? role : 'farmer';

    // ===== ROLES SENSIBLES: advisor y supermarket requieren aprobación =====
    const requiresApproval = ['advisor', 'supermarket'].includes(validRole);
    const accountStatus = requiresApproval ? 'pending' : 'active';

    const result = await dbRun(
      `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [name, email, passwordHash, validRole, location || 'Cerro de Pasco', phone || null, accountStatus]
    );

    if (requiresApproval) {
      // Notificar a todos los administradores que hay una nueva solicitud
      const admins = await dbAll("SELECT id, email FROM users WHERE role = 'admin' AND status = 'active'");
      const roleLabel = validRole === 'advisor' ? 'Asesor Técnico' : 'Supermercado';

      for (const admin of admins) {
        // Notificación interna en la plataforma
        await createNotification(
          admin.id,
          'sistema',
          '📬 Nueva solicitud de cuenta',
          `${name} (${email}) ha solicitado una cuenta como ${roleLabel}. Revisa la sección "Solicitudes de Cuenta" en el panel de administración.`,
          'warning'
        );

        // Email al administrador
        await sendNewAccountRequestEmail(admin.email, { name, email, role: validRole, location, phone });
      }

      return res.status(201).json({
        success: true,
        pending: true,
        message: `¡Solicitud enviada! Tu cuenta como ${roleLabel} está pendiente de aprobación por el Administrador. Recibirás una notificación cuando sea revisada.`
      });
    }

    // Registro inmediato para agricultores
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

    // ===== Validar estado de cuenta =====
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Tu cuenta está pendiente de aprobación por el Administrador. Recibirás una notificación cuando sea revisada.'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        error: 'Tu solicitud de cuenta fue rechazada por el Administrador. Contacta a Soporte Técnico para más información.'
      });
    }

    if (user.is_blocked || user.status === 'blocked') {
      return res.status(403).json({
        success: false,
        error: 'Tu cuenta ha sido bloqueada temporalmente por el Administrador de AgroPasco. Contacta a Soporte Técnico.'
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: '¡Bienvenido de vuelta!',
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, location: user.location },
        token,
        mustChangePassword: user.must_change_password === 1
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
      'SELECT id, name, email, role, location, phone, status, must_change_password, created_at FROM users WHERE id = ?',
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

async function changePassword(req, res) {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await dbRun(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, req.user.id]
    );

    res.json({
      success: true,
      message: '¡Contraseña actualizada exitosamente! Ya puedes usar tu nueva contraseña.'
    });
  } catch (err) {
    console.error('Error al cambiar contraseña:', err);
    res.status(500).json({ success: false, error: 'Error al cambiar la contraseña.' });
  }
}

module.exports = { register, login, getProfile, changePassword };
