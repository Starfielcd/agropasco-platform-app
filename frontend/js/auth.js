/**
 * AgroPasco — Módulo de Autenticación (Frontend)
 * Login y registro con selección visual de roles
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
                  </div>
                  <div class="role-card" data-role="supermarket" onclick="selectRole('supermarket')">
                    <div class="role-card-icon">🏪</div>
                    <div class="role-card-title">Supermercado</div>
                    <div class="role-card-desc">Accede al catálogo de productos certificados</div>
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
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  btn.textContent = 'Ingresando...';
  btn.disabled = true;

  const result = await api.login({
    email: document.getElementById('login-email').value,
    password: document.getElementById('login-password').value
  });

  if (result.success) {
    setToken(result.data.token);
    setUser(result.data.user);
    showToast(`¡Bienvenido, ${result.data.user.name}!`, 'success');
    window.location.hash = '#/dashboard';
  } else {
    showToast(result.error || 'Error al iniciar sesión', 'error');
    btn.textContent = '🔐 Iniciar Sesión';
    btn.disabled = false;
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

function handleLogout() {
  removeToken();
  removeUser();
  showToast('Sesión cerrada', 'info');
  window.location.hash = '#/login';
}
