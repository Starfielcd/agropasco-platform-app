/**
 * AgroPasco Digital — SPA Router & Aplicación Principal
 * Hash-based routing for single page application
 */

// ===== ROUTER =====
const routes = {
  '/login': { title: 'Iniciar Sesión', render: () => renderLoginPage(), public: true, fullPage: true },
  '/dashboard': { title: 'Panel Principal', subtitle: 'Vista general de tus operaciones agrícolas', icon: '📊', render: renderDashboard },
  '/crops': { title: 'Mis Cultivos', subtitle: 'Gestiona tus cultivos y registra actividades', icon: '🌿', render: renderCropsPage },
  '/weather': { title: 'Clima & Alertas', subtitle: 'Pronóstico y alertas climáticas para Cerro de Pasco', icon: '⛅', render: renderWeatherPage },
  '/advisory': { title: 'Asesoría Agrícola', subtitle: 'Buenas prácticas para cultivos de la Región Pasco', icon: '📚', render: renderAdvisoryPage },
  '/traceability': { title: 'Trazabilidad Digital', subtitle: 'Historial completo de tus cultivos', icon: '📋', render: renderTraceabilityPage },
  '/supermarket': { title: 'Catálogo Supermercado', subtitle: 'Productos certificados para la venta', icon: '🏪', render: renderSupermarketPage },
};

let currentRoute = '/login';

async function navigateTo(path) {
  const token = getToken();
  const user = getUser();

  // Auth guard
  if (!token && path !== '/login') {
    window.location.hash = '#/login';
    return;
  }

  // Redirect authenticated users away from login
  if (token && path === '/login') {
    window.location.hash = '#/dashboard';
    return;
  }

  // Handle dynamic routes
  let routeConfig, routeParams;

  // /crops/:id
  const cropDetailMatch = path.match(/^\/crops\/(\d+)$/);
  if (cropDetailMatch) {
    routeConfig = { title: 'Detalle del Cultivo', subtitle: 'Información y actividades del cultivo', icon: '🌿', render: () => renderCropDetail(cropDetailMatch[1]) };
    routeParams = cropDetailMatch[1];
  }

  // /traceability/:id
  const traceMatch = path.match(/^\/traceability\/(\d+)$/);
  if (traceMatch) {
    routeConfig = { title: 'Trazabilidad', subtitle: 'Reporte de trazabilidad digital', icon: '📋', render: () => renderTraceabilityPage(traceMatch[1]) };
    routeParams = traceMatch[1];
  }

  if (!routeConfig) routeConfig = routes[path];
  if (!routeConfig) { routeConfig = routes['/dashboard']; path = '/dashboard'; }

  currentRoute = path;

  const appContainer = document.getElementById('app');

  // Full page routes (login)
  if (routeConfig.fullPage) {
    const content = typeof routeConfig.render === 'function' ? routeConfig.render() : '';
    appContainer.innerHTML = content;
    return;
  }

  // Build app layout if not present
  if (!document.getElementById('page-content')) {
    appContainer.innerHTML = buildAppLayout(user);
  }

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('data-route');
    item.classList.toggle('active', href === path || (href && path.startsWith(href) && href !== '/dashboard'));
  });

  // Update header
  const headerTitle = document.getElementById('header-title');
  const headerSub = document.getElementById('header-subtitle');
  if (headerTitle) headerTitle.textContent = `${routeConfig.icon || ''} ${routeConfig.title}`;
  if (headerSub) headerSub.textContent = routeConfig.subtitle || '';

  // Render page content
  const pageContent = document.getElementById('page-content');
  pageContent.innerHTML = '<div class="page-content" style="display: flex; align-items: center; justify-content: center; min-height: 300px;"><div class="skeleton" style="width: 100%; max-width: 600px; height: 200px; display: flex; align-items: center; justify-content: center; font-size: 24px;">🌾 Cargando...</div></div>';

  try {
    const content = await routeConfig.render();
    pageContent.innerHTML = content;
  } catch (err) {
    console.error('Error al renderizar página:', err);
    pageContent.innerHTML = `
      <div class="page-content">
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Error al cargar</div>
          <div class="empty-state-text">${err.message}. Verifica que el servidor esté corriendo.</div>
          <button class="btn btn-primary" onclick="navigateTo('${path}')">Reintentar</button>
        </div>
      </div>
    `;
  }

  // Update notification count
  updateNotificationBadge();
}

function buildAppLayout(user) {
  return `
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-icon">🌾</div>
          <div>
            <h1>AgroPasco</h1>
            <span>Plataforma Agrícola</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-title">Principal</div>
          <div class="nav-item" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
            <span class="nav-item-icon">📊</span> Panel Principal
          </div>
          <div class="nav-item" data-route="/crops" onclick="window.location.hash='#/crops'">
            <span class="nav-item-icon">🌿</span> Mis Cultivos
          </div>

          <div class="nav-section-title">Monitoreo</div>
          <div class="nav-item" data-route="/weather" onclick="window.location.hash='#/weather'">
            <span class="nav-item-icon">⛅</span> Clima & Alertas
            <span class="nav-badge" id="alert-badge" style="display: none;">0</span>
          </div>
          <div class="nav-item" data-route="/advisory" onclick="window.location.hash='#/advisory'">
            <span class="nav-item-icon">📚</span> Asesoría
          </div>

          <div class="nav-section-title">Trazabilidad</div>
          <div class="nav-item" data-route="/traceability" onclick="window.location.hash='#/traceability'">
            <span class="nav-item-icon">📋</span> Trazabilidad
          </div>
          <div class="nav-item" data-route="/supermarket" onclick="window.location.hash='#/supermarket'">
            <span class="nav-item-icon">🏪</span> Supermercado
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-user-avatar">${(user?.name || 'U')[0].toUpperCase()}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${user?.name || 'Usuario'}</div>
              <div class="sidebar-user-role">${user?.role === 'farmer' ? '🌱 Agricultor' : user?.role === 'advisor' ? '📋 Asesor' : user?.role === 'supermarket' ? '🏪 Supermercado' : user?.role || ''}</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()" title="Cerrar Sesión">🚪</button>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <header class="main-header">
          <div class="header-left">
            <h2 id="header-title">📊 Panel Principal</h2>
            <p id="header-subtitle">Vista general de tus operaciones agrícolas</p>
          </div>
          <div class="header-right">
            <button class="btn-icon" title="Alertas" onclick="window.location.hash='#/weather'">
              🔔
              <span class="badge" id="notif-badge" style="display: none;">0</span>
            </button>
          </div>
        </header>
        <div id="page-content"></div>
      </main>

      <!-- Mobile menu toggle -->
      <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
    </div>
  `;
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

async function updateNotificationBadge() {
  try {
    const result = await api.getAlerts();
    const count = result.data?.alerts?.length || 0;
    const alertBadge = document.getElementById('alert-badge');
    const notifBadge = document.getElementById('notif-badge');

    if (alertBadge) {
      alertBadge.style.display = count > 0 ? 'inline' : 'none';
      alertBadge.textContent = count;
    }
    if (notifBadge) {
      notifBadge.style.display = count > 0 ? 'flex' : 'none';
      notifBadge.textContent = count;
    }
  } catch (e) {}
}

// ===== HASH ROUTER LISTENER =====
function handleHashChange() {
  const hash = window.location.hash.slice(1) || '/login';
  navigateTo(hash);
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  // Set initial route
  if (!window.location.hash) {
    const token = getToken();
    window.location.hash = token ? '#/dashboard' : '#/login';
  }

  handleHashChange();
});

window.addEventListener('hashchange', handleHashChange);

// Close sidebar on mobile when navigating
window.addEventListener('hashchange', () => {
  document.getElementById('sidebar')?.classList.remove('open');
});