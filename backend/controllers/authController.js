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
        requestId: result.lastID,
        userId: result.lastID,
        email,
        role: validRole,
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

    if (user.status === 'disabled' || user.is_blocked || user.status === 'blocked') {
      const errorMsg = user.role === 'admin' && user.status === 'disabled'
        ? 'Esta cuenta administrativa ha sido desactivada por transferencia de administración. Solo puede ingresar el Administrador Central activo.'
        : 'Tu cuenta ha sido bloqueada o desactivada por el Administrador de AgroPasco. Contacta a Soporte Técnico.';
      return res.status(403).json({
        success: false,
        error: errorMsg
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
    const { newPassword, currentPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    // Si es cambio voluntario (no obligado por must_change_password) o si se provee currentPassword, validarla
    if (currentPassword) {
      const validCurrent = await bcrypt.compare(currentPassword, user.password_hash);
      if (!validCurrent) {
        return res.status(401).json({
          success: false,
          error: 'La contraseña actual ingresada es incorrecta.'
        });
      }
    } else if (user.must_change_password !== 1) {
      return res.status(400).json({
        success: false,
        error: 'Debes ingresar tu contraseña actual para confirmar la actualización.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await dbRun(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, req.user.id]
    );

    // Registrar en el libro de auditoría el cambio de credenciales
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        user.id,
        'CAMBIO_CONTRASENA',
        'user',
        user.id,
        `El usuario "${user.name}" (${user.email}) con rol [${user.role}] cambió satisfactoriamente su contraseña.`,
        clientIp
      ]
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

// ===== CONSULTA DE ESTADO DE INICIALIZACIÓN DEL SISTEMA =====
async function getSetupStatus(req, res) {
  try {
    const admin = await dbGet("SELECT id, name, email FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");
    res.json({
      success: true,
      hasActiveAdmin: !!admin,
      adminEmail: admin ? admin.email : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al consultar estado de inicialización.' });
  }
}

// ===== REGISTRO DEL ADMINISTRADOR INICIAL (PRIMER USO) =====
async function setupInitialAdmin(req, res) {
  try {
    const { name, email, password, location, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nombre, email y contraseña son obligatorios.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Comprobar si ya existe un administrador activo en el sistema
    const existingAdmin = await dbGet("SELECT id, name, email FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");
    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        error: `El sistema ya cuenta con un Administrador Central activo (${existingAdmin.email}). Para cambiar de administrador, el actual debe realizar una Transferencia de Administración desde su panel.`
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await dbGet('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    const passwordHash = await bcrypt.hash(password, 12);
    let adminId;

    if (existingUser) {
      // Promover usuario existente a Administrador Central inicial
      await dbRun(
        `UPDATE users SET
          name = ?,
          role = 'admin',
          password_hash = ?,
          status = 'active',
          is_blocked = 0,
          must_change_password = 0,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name.trim(), passwordHash, existingUser.id]
      );
      adminId = existingUser.id;
    } else {
      const result = await dbRun(
        `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password)
         VALUES (?, ?, ?, 'admin', ?, ?, 'active', 0, 0)`,
        [name.trim(), cleanEmail, passwordHash, location || 'Cerro de Pasco', phone || null]
      );
      adminId = result.lastID;
    }

    // Registrar en auditoría
    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [adminId, 'REGISTRO_ADMINISTRADOR_INICIAL', 'user', adminId, `Administrador Central inicial "${name}" (${cleanEmail}) configurado en el sistema.`, req.ip]
    );

    const user = { id: adminId, name: name.trim(), email: cleanEmail, role: 'admin' };
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: '¡Administrador Central registrado exitosamente!',
      data: { user, token }
    });
  } catch (err) {
    console.error('Error al registrar administrador inicial:', err);
    res.status(500).json({ success: false, error: 'Error al registrar administrador inicial.' });
  }
}

/**
 * Consulta del estado de una solicitud de registro para actualización reactiva del stepper en frontend
 * Acepta identifier por params o query (email o id/requestId)
 */
async function getApplicationStatus(req, res) {
  try {
    const identifier = req.params.identifier || req.query.email || req.query.requestId || req.query.userId || req.query.id;
    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro de búsqueda (email o id) requerido para consultar la solicitud.'
      });
    }

    let user = null;
    const cleanId = String(identifier).trim();
    if (cleanId.includes('@')) {
      user = await dbGet(
        'SELECT id, name, email, role, status, is_blocked, must_change_password, rejection_reason, approved_at, created_at FROM users WHERE LOWER(email) = LOWER(?)',
        [cleanId]
      );
    } else if (!isNaN(parseInt(cleanId, 10))) {
      user = await dbGet(
        'SELECT id, name, email, role, status, is_blocked, must_change_password, rejection_reason, approved_at, created_at FROM users WHERE id = ?',
        [parseInt(cleanId, 10)]
      );
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No se encontró ninguna solicitud de cuenta registrada con los datos proporcionados.'
      });
    }

    const roleLabel = user.role === 'advisor' ? 'Asesor Técnico' : (user.role === 'supermarket' ? 'Supermercado' : 'Agricultor');
    const isApproved = user.status === 'active' && !user.is_blocked;
    const isRejected = user.status === 'rejected';
    const isPending = user.status === 'pending';

    // Steps definition:
    // Step 1: Solicitud registrada
    // Step 2: Revisión del Administrador (in_progress si pending, completed si active, rejected si rejected)
    // Step 3: Notificación por correo (completed si active, pending si pending)
    let currentStep = 1;
    let statusText = 'Pendiente de Aprobación';
    let message = 'Tu solicitud está en cola para revisión del Administrador.';

    if (isApproved) {
      currentStep = 3;
      statusText = 'Aprobada';
      message = user.must_change_password
        ? '¡Tu cuenta ha sido aprobada! El administrador asignó una clave temporal para tu cuenta.'
        : '¡Tu cuenta ha sido aprobada! Ya puedes iniciar sesión de inmediato con la contraseña que registraste al crear tu cuenta.';
    } else if (isRejected) {
      currentStep = 2;
      statusText = 'Rechazada';
      message = user.rejection_reason || 'Tu solicitud no fue aprobada por el Administrador.';
    } else if (isPending) {
      currentStep = 2;
      statusText = 'En Revisión';
      message = 'El Administrador está evaluando tu perfil y credenciales institucionales.';
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel,
        status: user.status,
        statusText,
        message,
        mustChangePassword: Boolean(user.must_change_password),
        hasRegisteredPassword: !Boolean(user.must_change_password),
        step: currentStep,
        stepStatus: {
          step1: 'completed',
          step2: isApproved ? 'completed' : (isRejected ? 'rejected' : 'in_progress'),
          step3: isApproved ? 'completed' : 'pending'
        },
        isApproved,
        isRejected,
        isPending,
        rejectionReason: user.rejection_reason,
        approvedAt: user.approved_at,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('Error al consultar estado de solicitud:', err);
    res.status(500).json({ success: false, error: 'Error al consultar estado de la solicitud.' });
  }
}

/**
 * Permite a un usuario cuya cuenta fue aprobada (status = 'active')
 * establecer o actualizar su contraseña de acceso directamente desde la interfaz,
 * garantizando que nunca quede atrapado si el correo SMTP no llegó.
 */
async function setupApprovedPassword(req, res) {
  try {
    const { email, identifier, newPassword } = req.body;
    const searchParam = (email || identifier || '').trim().toLowerCase();

    if (!searchParam || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Correo electrónico y nueva contraseña son obligatorios.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    let user = null;
    if (searchParam.includes('@')) {
      user = await dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [searchParam]);
    } else if (!isNaN(parseInt(searchParam, 10))) {
      user = await dbGet('SELECT * FROM users WHERE id = ?', [parseInt(searchParam, 10)]);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No se encontró ninguna cuenta registrada con estos datos.'
      });
    }

    if (user.status !== 'active' || user.is_blocked) {
      return res.status(403).json({
        success: false,
        error: 'Esta opción solo está disponible para cuentas que ya han sido aprobadas por el Administrador.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await dbRun(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, user.id]
    );

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, 'SET_APPROVED_PASSWORD', 'user', user.id, `Contraseña configurada por el usuario aprobado "${user.name}" (${user.email}).`, req.ip]
    );

    res.json({
      success: true,
      message: '¡Contraseña establecida exitosamente! Ya puedes iniciar sesión con tu nueva clave.'
    });
  } catch (err) {
    console.error('Error al configurar contraseña aprobada:', err);
    res.status(500).json({ success: false, error: 'Error al establecer la contraseña.' });
  }
}

module.exports = {
  register,
  login,
  getProfile,
  changePassword,
  getSetupStatus,
  setupInitialAdmin,
  getApplicationStatus,
  setupApprovedPassword
};
