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
          <!-- Banner dinámico para configuración inicial del administrador si no existe -->
          <div id="initial-setup-banner-container"></div>

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
    if (window.__stepperPollInterval) {
      clearInterval(window.__stepperPollInterval);
      window.__stepperPollInterval = null;
    }
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

function goToLoginWithEmail(email) {
  if (window.__stepperPollInterval) {
    clearInterval(window.__stepperPollInterval);
    window.__stepperPollInterval = null;
  }
  switchAuthTab('login');
  if (email) {
    const emailInput = document.getElementById('login-email');
    if (emailInput) {
      emailInput.value = email;
      const passInput = document.getElementById('login-password');
      if (passInput) passInput.focus();
    }
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
      // Mostrar mensaje informativo prominente y activar stepper reactivo
      const identifier = result.requestId || result.userId || result.email || document.getElementById('reg-email')?.value?.trim();
      showPendingApprovalMessage(result.message, identifier, {
        name: document.getElementById('reg-name')?.value?.trim(),
        email: document.getElementById('reg-email')?.value?.trim() || result.email,
        role: document.getElementById('reg-role')?.value || result.role
      });
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
 * Muestra el stepper reactivo cuando la cuenta queda pendiente de aprobación.
 * Consulta periódicamente (/api/users/application-status) para mover los pasos
 * de Paso 1 a Paso 2 y Paso 3 en tiempo real.
 */
function showPendingApprovalMessage(message, identifier, userData = {}) {
  const container = document.getElementById('register-form-container');
  if (!container) return;

  if (window.__stepperPollInterval) {
    clearInterval(window.__stepperPollInterval);
    window.__stepperPollInterval = null;
  }

  const queryId = identifier || userData.requestId || userData.userId || userData.email || '';
  const emailDisplay = userData.email || (String(queryId).includes('@') ? queryId : '');
  const roleDisplay = userData.role === 'advisor' ? 'Asesor Técnico' : (userData.role === 'supermarket' ? 'Supermercado' : 'Usuario');

  container.innerHTML = `
    <div class="pending-approval-message" id="application-stepper-card">
      <div class="pending-approval-icon" id="stepper-status-icon">⏳</div>
      <h3 id="stepper-status-title">Solicitud Enviada</h3>
      <p id="stepper-status-desc">${message || 'Tu solicitud de cuenta está pendiente de aprobación por el Administrador Central.'}</p>

      <div class="pending-approval-steps" id="stepper-steps-list">
        <div class="step-item completed" id="stepper-step-1">
          <span class="step-number">1</span>
          <span>Solicitud registrada ✅</span>
        </div>
        <div class="step-item in-progress" id="stepper-step-2">
          <span class="step-number">2</span>
          <span>Revisión del Administrador ⏳ (En curso)</span>
        </div>
        <div class="step-item pending" id="stepper-step-3">
          <span class="step-number">3</span>
          <span>Notificación por correo 📧 (En espera de aprobación)</span>
        </div>
      </div>

      <div id="stepper-status-alert" style="margin: 12px 0;"></div>

      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button type="button" class="btn btn-secondary btn-block btn-sm" id="btn-check-status-now" onclick="checkStepperApplicationStatus('${queryId}')">
          🔄 Verificar Estado
        </button>
        <button type="button" class="btn btn-secondary btn-block btn-sm" onclick="goToLoginWithEmail('${emailDisplay}')">
          ← Volver a Iniciar Sesión
        </button>
      </div>
      <div id="stepper-action-primary" style="margin-top: 12px;"></div>
    </div>
  `;

  // Iniciar sondeo / polling automático cada 3.5 segundos
  if (queryId) {
    setTimeout(() => checkStepperApplicationStatus(queryId), 1200);

    window.__stepperPollInterval = setInterval(() => {
      checkStepperApplicationStatus(queryId);
    }, 3500);
  }
}

/**
 * Consulta el estado de la solicitud en el backend y actualiza las clases y textos del stepper
 */
async function checkStepperApplicationStatus(identifier) {
  if (!identifier) return;
  const statusAlert = document.getElementById('stepper-status-alert');
  const step2 = document.getElementById('stepper-step-2');
  const step3 = document.getElementById('stepper-step-3');
  const statusIcon = document.getElementById('stepper-status-icon');
  const statusTitle = document.getElementById('stepper-status-title');
  const statusDesc = document.getElementById('stepper-status-desc');
  const primaryAction = document.getElementById('stepper-action-primary');

  try {
    const res = await api.getApplicationStatus(identifier);
    if (!res || !res.success || !res.data) return;

    const data = res.data;

    if (data.isApproved || data.status === 'active') {
      // 1. Paso 2 y Paso 3 Completados (Aprobado)
      if (window.__stepperPollInterval) {
        clearInterval(window.__stepperPollInterval);
        window.__stepperPollInterval = null;
      }

      if (statusIcon) statusIcon.textContent = '🎉';
      if (statusTitle) statusTitle.textContent = '¡Cuenta Aprobada y Habilitada!';
      if (statusDesc) {
        statusDesc.innerHTML = `El Administrador ha aprobado tu cuenta como <strong>${data.roleLabel || 'usuario'}</strong>. Se generó y envió tu contraseña temporal al correo <strong>${data.email}</strong>.`;
      }

      if (step2) {
        step2.className = 'step-item completed';
        step2.innerHTML = '<span class="step-number">2</span><span>Revisión del Administrador ✅ Aprobada</span>';
      }
      if (step3) {
        step3.className = 'step-item completed';
        step3.innerHTML = '<span class="step-number">3</span><span>Notificación por correo 📧 Credenciales enviadas</span>';
      }

      if (statusAlert) {
        statusAlert.innerHTML = `
          <div style="background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); color: #4ade80; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 13.5px; text-align: center;">
            ✅ Acceso Concedido: Revisa tu bandeja de correo e inicia sesión con tu clave provisional.
          </div>
        `;
      }

      if (primaryAction) {
        primaryAction.innerHTML = `
          <button type="button" class="btn btn-primary btn-block btn-lg" onclick="goToLoginWithEmail('${data.email}')" style="background: #16a34a; border-color: #16a34a; font-weight: 700; box-shadow: 0 4px 14px rgba(22, 163, 74, 0.4);">
            🔐 Iniciar Sesión Ahora
          </button>
        `;
      }

      showToast('¡Tu cuenta ha sido aprobada por el Administrador!', 'success');
    } else if (data.isRejected || data.status === 'rejected') {
      // Solicitud rechazada
      if (window.__stepperPollInterval) {
        clearInterval(window.__stepperPollInterval);
        window.__stepperPollInterval = null;
      }

      if (statusIcon) statusIcon.textContent = '❌';
      if (statusTitle) statusTitle.textContent = 'Solicitud No Aprobada';
      if (statusDesc) statusDesc.textContent = 'Tu solicitud de acceso no fue aprobada por la administración del sistema.';

      if (step2) {
        step2.className = 'step-item rejected';
        step2.innerHTML = '<span class="step-number">2</span><span>Revisión del Administrador ❌ Rechazada</span>';
      }
      if (step3) {
        step3.className = 'step-item rejected';
        step3.innerHTML = '<span class="step-number">3</span><span>Notificación por correo ⛔ Cancelada</span>';
      }

      if (statusAlert) {
        statusAlert.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #f87171; padding: 12px; border-radius: 8px; font-size: 13px; text-align: left;">
            <strong>Motivo indicado:</strong> ${data.rejectionReason || 'No especificado por el administrador.'}<br>
            <span style="font-size: 12px; opacity: 0.85;">Si consideras que esto es un error, por favor contacta al canal de soporte.</span>
          </div>
        `;
      }
    } else {
      // En evaluación activa (pending)
      if (step2) {
        step2.className = 'step-item in-progress';
        step2.innerHTML = '<span class="step-number">2</span><span>Revisión del Administrador ⏳ (En evaluación activa)</span>';
      }
      if (step3) {
        step3.className = 'step-item pending';
        step3.innerHTML = '<span class="step-number">3</span><span>Notificación por correo 📧 (En espera de dictamen)</span>';
      }
    }
  } catch (err) {
    console.warn('Error al verificar estado de solicitud en el stepper:', err);
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

// =======================================================
// REGISTRO INICIAL DEL ADMINISTRADOR ÚNICO (PRIMER USO)
// =======================================================

async function checkSetupStatus() {
  const container = document.getElementById('initial-setup-banner-container');
  if (!container) return;

  try {
    const res = await api.getSetupStatus();
    if (res && res.success && !res.hasActiveAdmin) {
      container.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(217, 119, 6, 0.2), rgba(15, 23, 42, 0.95)); border: 1.5px solid #f59e0b; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; text-align: left; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.2);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 20px;">⚙️</span>
            <strong style="color: #fbbf24; font-size: 14px;">Primer Uso del Sistema Detectado</strong>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px 0; line-height: 1.4;">
            No existe un Administrador Central activo en AgroPasco. Registra al administrador titular para iniciar la operación segura.
          </p>
          <button type="button" class="btn btn-warning btn-sm btn-block" onclick="showInitialAdminSetupModal()" style="background: linear-gradient(135deg, #d97706, #b45309); color: #ffffff; border: none; font-weight: 700;">
            👑 Registrar Administrador Inicial
          </button>
        </div>
      `;
    } else {
      container.innerHTML = '';
    }
  } catch (err) {
    console.error('Error al comprobar setup status:', err);
  }
}

// Ejecutar chequeo cuando se cargue el DOM o cambie la ruta
window.addEventListener('hashchange', () => {
  if (window.location.hash.startsWith('#/login') || !window.location.hash) {
    setTimeout(checkSetupStatus, 150);
  }
});
setTimeout(checkSetupStatus, 200);

function showInitialAdminSetupModal() {
  const existing = document.getElementById('setup-admin-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'setup-admin-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width: 500px; border: 1.5px solid #f59e0b; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #d97706, #b45309); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff;">
            👑
          </div>
          <div>
            <h3 style="margin: 0; font-size: 18px; color: #ffffff; font-weight: 800;">Registro Inicial del Administrador</h3>
            <p class="text-xs text-muted" style="margin: 0;">Primer uso — AgroPasco Digital</p>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="closeInitialAdminSetupModal()" style="padding: 4px 8px; font-size: 16px;">✕</button>
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b; padding: 10px 12px; border-radius: 4px; margin-bottom: 16px; font-size: 12px; color: var(--text-secondary); line-height: 1.4;">
        Por políticas de seguridad, solo se permite registrar <strong>un único administrador</strong>. Toda creación posterior desde formularios públicos está bloqueada permanentemente.
      </div>

      <form id="setup-admin-form" onsubmit="handleSetupInitialAdmin(event)">
        <div class="form-group">
          <label class="form-label" style="font-size: 12px;">Nombre Completo del Administrador</label>
          <input type="text" id="setup-admin-name" class="form-input" placeholder="Ing. Carlos Mendoza" required autofocus>
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size: 12px;">Correo Electrónico Oficial</label>
          <input type="email" id="setup-admin-email" class="form-input" placeholder="admin@agropasco.pe" required>
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size: 12px;">Contraseña Maestra (Mínimo 6 caracteres)</label>
          <input type="password" id="setup-admin-password" class="form-input" placeholder="••••••••••••" required minlength="6">
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size: 12px;">Confirmar Contraseña</label>
          <input type="password" id="setup-admin-confirm" class="form-input" placeholder="••••••••••••" required minlength="6">
        </div>
        <div class="grid-2">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 12px;">Teléfono de Contacto</label>
            <input type="tel" id="setup-admin-phone" class="form-input" placeholder="963 123 456">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 12px;">Sede / Región</label>
            <input type="text" id="setup-admin-location" class="form-input" value="Cerro de Pasco, Pasco">
          </div>
        </div>

        <div id="setup-admin-error" class="form-error hidden" style="margin-top: 14px; padding: 10px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; color: #fca5a5; font-size: 13px;"></div>

        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;">
          <button type="button" class="btn btn-secondary" onclick="closeInitialAdminSetupModal()">Cancelar</button>
          <button type="submit" id="setup-admin-btn" class="btn btn-warning" style="background: linear-gradient(135deg, #d97706, #b45309); color: #ffffff; border: none; font-weight: 700;">
            👑 Crear Administrador Maestro
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('active'));
}

function closeInitialAdminSetupModal() {
  const modal = document.getElementById('setup-admin-modal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 300);
  }
}

async function handleSetupInitialAdmin(e) {
  e.preventDefault();
  const btn = document.getElementById('setup-admin-btn');
  const errorEl = document.getElementById('setup-admin-error');

  const name = document.getElementById('setup-admin-name').value;
  const email = document.getElementById('setup-admin-email').value;
  const password = document.getElementById('setup-admin-password').value;
  const confirm = document.getElementById('setup-admin-confirm').value;
  const phone = document.getElementById('setup-admin-phone').value;
  const location = document.getElementById('setup-admin-location').value;

  if (password !== confirm) {
    errorEl.textContent = 'Las contraseñas no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  btn.textContent = 'Guardando Administrador...';
  btn.disabled = true;

  const result = await api.setupInitialAdmin({
    name,
    email,
    password,
    phone,
    location
  });

  if (result.success) {
    closeInitialAdminSetupModal();
    setToken(result.data.token);
    setUser(result.data.user);
    showToast('¡Administrador Maestro configurado exitosamente!', 'success');
    window.location.hash = '#/admin';
  } else {
    errorEl.textContent = result.error || 'Error al configurar el administrador inicial.';
    errorEl.classList.remove('hidden');
    btn.textContent = '👑 Crear Administrador Maestro';
    btn.disabled = false;
  }
}
