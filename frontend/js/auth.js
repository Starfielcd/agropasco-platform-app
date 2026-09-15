/**
 * AgroPasco — Módulo de Autenticación (Frontend)
 * Login y registro con selección visual de roles.
 * Flujo de aprobación para roles sensibles (Asesor / Supermercado).
 * Modal de cambio de contraseña obligatorio al primer login tras aprobación.
 */

function renderLoginPage() {
  return `
    <div class="login-page">
      <div class="login-container">
        <div class="login-header">
          <div class="login-logo">🌾</div>
          <h1>AgroPasco Digital</h1>
          <p>Plataforma Agrícola Inteligente — Región Pasco, Perú</p>
        </div>
        <div class="login-card">
          <div class="login-tabs">
            <button class="login-tab active" id="tab-login" onclick="switchAuthTab('login')">Iniciar Sesión</button>
            <button class="login-tab" id="tab-register" onclick="switchAuthTab('register')">Registrarse</button>
          </div>

          <div id="login-form-container">
            <form id="login-form" onsubmit="handleLogin(event)">
              <div class="form-group">
                <label class="form-label">Correo Electrónico</label>
                <input type="email" class="form-input" id="login-email" placeholder="tu@correo.com" required>
              </div>
              <div class="form-group">
                <label class="form-label">Contraseña</label>
                <input type="password" class="form-input" id="login-password" placeholder="••••••" required>
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg" id="login-btn">
                🔐 Iniciar Sesión
              </button>
            </form>
          </div>

          <div id="register-form-container" class="hidden">
            <form id="register-form" onsubmit="handleRegister(event)">
              <div class="form-group">
                <label class="form-label">Nombre Completo</label>
                <input type="text" class="form-input" id="reg-name" placeholder="Juan Pérez" required>
              </div>
              <div class="form-group">
                <label class="form-label">Correo Electrónico</label>
                <input type="email" class="form-input" id="reg-email" placeholder="tu@correo.com" required>
              </div>
              <div class="form-group">
                <label class="form-label">Contraseña</label>
                <input type="password" class="form-input" id="reg-password" placeholder="Mínimo 6 caracteres" required minlength="6">
              </div>

              <!-- Selector de Rol Visual -->
              <div class="form-group">
                <label class="form-label" style="font-weight: 700; font-size: 14px; color: var(--text-primary);">Selecciona tu Rol</label>
                <div class="role-selector">
                  <div class="role-card active" data-role="farmer" onclick="selectRole('farmer')">
                    <div class="role-card-icon">🌱</div>
                    <div class="role-card-title">Agricultor</div>
                    <div class="role-card-desc">Gestiona cultivos, parcelas y comercializa productos</div>
                  </div>
                  <div class="role-card" data-role="advisor" onclick="selectRole('advisor')">
                    <div class="role-card-icon">📋</div>
                    <div class="role-card-title">Asesor Técnico</div>
                    <div class="role-card-desc">Monitorea parcelas, valida productos y asesora</div>
                    <div class="role-card-approval-notice">⏳ Requiere aprobación del Admin</div>
                  </div>
                  <div class="role-card" data-role="supermarket" onclick="selectRole('supermarket')">
                    <div class="role-card-icon">🏪</div>
                    <div class="role-card-title">Supermercado</div>
                    <div class="role-card-desc">Accede al catálogo de productos certificados</div>
                    <div class="role-card-approval-notice">⏳ Requiere aprobación del Admin</div>
                  </div>
                </div>
                <input type="hidden" id="reg-role" value="farmer">
              </div>

              <div class="form-group">
                <label class="form-label">📍 Zona / Distrito (Región Pasco)</label>
                <select class="form-select" id="reg-location-select" onchange="toggleCustomLocation(this.value)">
                  <optgroup label="Provincia Daniel Alcides Carrión">
                    <option value="Yanahuanca, Pasco" selected>📍 Yanahuanca</option>
                    <option value="Chacayán, Pasco">📍 Chacayán</option>
                    <option value="Tapuc, Pasco">📍 Tapuc</option>
                    <option value="Paucar, Pasco">📍 Paucar</option>
                    <option value="Vilcabamba, Pasco">📍 Vilcabamba</option>
                    <option value="Santa Ana de Tusi, Pasco">📍 Santa Ana de Tusi</option>
                    <option value="Goyllarisquizga, Pasco">📍 Goyllarisquizga</option>
                  </optgroup>
                  <optgroup label="Provincia de Pasco">
                    <option value="Chaupimarca, Pasco">📍 Chaupimarca (Cerro de Pasco)</option>
                    <option value="Yanacancha, Pasco">📍 Yanacancha</option>
                    <option value="Tinyahuarco, Pasco">📍 Tinyahuarco</option>
                    <option value="Paucartambo, Pasco">📍 Paucartambo</option>
                    <option value="Huachón, Pasco">📍 Huachón</option>
                    <option value="Ninacaca, Pasco">📍 Ninacaca</option>
                    <option value="Huayllay, Pasco">📍 Huayllay</option>
                    <option value="Vicco, Pasco">📍 Vicco</option>
                    <option value="Simón Bolívar, Pasco">📍 Simón Bolívar</option>
                  </optgroup>
                  <optgroup label="Provincia de Oxapampa">
                    <option value="Villa Rica, Oxapampa">📍 Villa Rica</option>
                    <option value="Oxapampa">📍 Oxapampa</option>
                    <option value="Chontabamba, Oxapampa">📍 Chontabamba</option>
                    <option value="Huancabamba, Oxapampa">📍 Huancabamba</option>
                    <option value="Constitución, Oxapampa">📍 Constitución</option>
                    <option value="Puerto Bermúdez, Oxapampa">📍 Puerto Bermúdez</option>
                  </optgroup>
                  <option value="custom">✏️ Escribir otro lugar o caserío...</option>
                </select>
              </div>
              <div class="form-group hidden" id="custom-location-group">
                <label class="form-label">Nombre del Caserío / Anexo / Zona</label>
                <input type="text" class="form-input" id="reg-location-custom" placeholder="Ej: Caserío Tambopampa, Yanahuanca">
              </div>
              <div class="form-group">
                <label class="form-label">Teléfono (opcional)</label>
                <input type="tel" class="form-input" id="reg-phone" placeholder="963 XXX XXX">
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg" id="register-btn">
                🌾 Crear Cuenta
              </button>
            </form>
          </div>

          <p class="text-center text-sm" style="color: var(--text-secondary); margin-top: 16px;">
            Plataforma para agricultores de la Región Pasco 🇵🇪
          </p>
        </div>
      </div>
    </div>
  `;
}

function selectRole(role) {
  document.getElementById('reg-role').value = role;
  document.querySelectorAll('.role-card').forEach(card => {
    card.classList.toggle('active', card.dataset.role === role);
  });
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');

  if (tab === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    document.getElementById('login-form-container').classList.remove('hidden');
    document.getElementById('register-form-container').classList.add('hidden');
  } else {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    document.getElementById('login-form-container').classList.add('hidden');
    document.getElementById('register-form-container').classList.remove('hidden');
  }
}

async function handleLogin(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById('login-btn');
  if (btn) {
    btn.textContent = 'Ingresando...';
    btn.disabled = true;
  }

  const result = await api.login({
    email: document.getElementById('login-email').value,
    password: document.getElementById('login-password').value
  });

  if (result.success) {
    setToken(result.data.token);
    setUser(result.data.user);

    // ===== Verificar si debe cambiar contraseña al primer login =====
    if (result.data.mustChangePassword) {
      showChangePasswordModal(result.data.user, result.data.token);
      return;
    }

    showToast(`¡Bienvenido, ${result.data.user.name}! (${result.data.user.role})`, 'success');
    const roleRoutes = {
      farmer: '/dashboard',
      advisor: '/advisor/parcels',
      supermarket: '/supermarket',
      admin: '/admin'
    };
    window.location.hash = '#' + (roleRoutes[result.data.user.role] || '/dashboard');
  } else {
    showToast(result.error || 'Error al iniciar sesión', 'error');
    if (btn) {
      btn.textContent = '🔐 Iniciar Sesión';
      btn.disabled = false;
    }
  }
}

function toggleCustomLocation(value) {
  const customGroup = document.getElementById('custom-location-group');
  if (customGroup) {
    if (value === 'custom') {
      customGroup.classList.remove('hidden');
      document.getElementById('reg-location-custom')?.focus();
    } else {
      customGroup.classList.add('hidden');
    }
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('register-btn');
  btn.textContent = 'Registrando...';
  btn.disabled = true;

  const locSelect = document.getElementById('reg-location-select')?.value;
  const locCustom = document.getElementById('reg-location-custom')?.value;
  const finalLocation = (locSelect === 'custom' ? locCustom : locSelect) || 'Yanahuanca, Pasco';

  const result = await api.register({
    name: document.getElementById('reg-name').value,
    email: document.getElementById('reg-email').value,
    password: document.getElementById('reg-password').value,
    role: document.getElementById('reg-role').value,
    location: finalLocation,
    phone: document.getElementById('reg-phone').value
  });

  if (result.success) {
    // ===== Flujo de aprobación: rol sensible queda pendiente =====
    if (result.pending) {
      showToast(result.message, 'info');
      // Mostrar mensaje informativo prominente y volver al login
      showPendingApprovalMessage(result.message);
      return;
    }

    // Registro inmediato (agricultor)
    setToken(result.data.token);
    setUser(result.data.user);
    showToast(`¡Cuenta creada! Bienvenido de ${finalLocation}.`, 'success');
    window.location.hash = '#/dashboard';
  } else {
    showToast(result.error || 'Error en el registro', 'error');
    btn.textContent = '🌾 Crear Cuenta';
    btn.disabled = false;
  }
}

/**
 * Muestra un mensaje informativo cuando la cuenta queda pendiente de aprobación.
 * Luego redirige al tab de login.
 */
function showPendingApprovalMessage(message) {
  const container = document.getElementById('register-form-container');
  if (container) {
    container.innerHTML = `
      <div class="pending-approval-message">
        <div class="pending-approval-icon">⏳</div>
        <h3>Solicitud Enviada</h3>
        <p>${message}</p>
        <div class="pending-approval-steps">
          <div class="step-item">
            <span class="step-number">1</span>
            <span>Solicitud registrada ✅</span>
          </div>
          <div class="step-item pending">
            <span class="step-number">2</span>
            <span>Revisión del Administrador ⏳</span>
          </div>
          <div class="step-item pending">
            <span class="step-number">3</span>
            <span>Notificación por correo 📧</span>
          </div>
        </div>
        <button class="btn btn-primary btn-block" onclick="switchAuthTab('login')" style="margin-top: 20px;">
          ← Volver a Iniciar Sesión
        </button>
      </div>
    `;
  }
}

/**
 * Modal de cambio de contraseña obligatorio.
 * Se muestra cuando el usuario inicia sesión por primera vez tras la aprobación de su cuenta.
 */
function showChangePasswordModal(user, token) {
  // Eliminar modal anterior si existe
  const existingModal = document.getElementById('change-password-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'change-password-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card change-password-modal-card">
      <div class="modal-header-icon">🔐</div>
      <h2>Cambio de Contraseña Obligatorio</h2>
      <p class="modal-subtitle">
        ¡Bienvenido a AgroPasco Digital, <strong>${user.name}</strong>!<br>
        Tu cuenta ha sido aprobada por el Administrador. Por seguridad, debes establecer una nueva contraseña antes de continuar.
      </p>
      <form id="change-password-form" onsubmit="handleChangePassword(event)">
        <div class="form-group">
          <label class="form-label">Nueva Contraseña</label>
          <input type="password" class="form-input" id="new-password" placeholder="Mínimo 6 caracteres" required minlength="6" autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Confirmar Contraseña</label>
          <input type="password" class="form-input" id="confirm-password" placeholder="Repite la nueva contraseña" required minlength="6">
        </div>
        <div id="password-error" class="form-error hidden"></div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="change-password-btn">
          ✅ Establecer Nueva Contraseña
        </button>
      </form>
      <p class="modal-footer-note">
        No puedes acceder al sistema sin cambiar tu contraseña temporal.
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  // Animar entrada
  requestAnimationFrame(() => {
    modal.classList.add('active');
  });
}

async function handleChangePassword(e) {
  e.preventDefault();

  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const errorEl = document.getElementById('password-error');
  const btn = document.getElementById('change-password-btn');

  // Validaciones
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Las contraseñas no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (newPassword.length < 6) {
    errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  btn.textContent = 'Guardando...';
  btn.disabled = true;

  const result = await api.changePassword({ newPassword });

  if (result.success) {
    // Cerrar modal
    const modal = document.getElementById('change-password-modal');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
    }

    showToast('¡Contraseña actualizada! Bienvenido a AgroPasco Digital.', 'success');

    // Navegar al dashboard del rol
    const user = getUser();
    const roleRoutes = {
      farmer: '/dashboard',
      advisor: '/advisor/parcels',
      supermarket: '/supermarket',
      admin: '/admin'
    };
    window.location.hash = '#' + (roleRoutes[user?.role] || '/dashboard');
  } else {
    errorEl.textContent = result.error || 'Error al cambiar la contraseña.';
    errorEl.classList.remove('hidden');
    btn.textContent = '✅ Establecer Nueva Contraseña';
    btn.disabled = false;
  }
}

function handleLogout() {
  removeToken();
  removeUser();
  showToast('Sesión cerrada', 'info');
  window.location.hash = '#/login';
}
