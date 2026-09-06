/**
 * AgroPasco Digital — SPA Router & Aplicación Principal
 * Hash-based routing with ROLE-BASED navigation
 */

// ===== ROLE-BASED ROUTE DEFINITIONS =====
const routes = {
  // Public
  '/login': { title: 'Iniciar Sesión', render: () => renderLoginPage(), public: true, fullPage: true },

  // Farmer routes
  '/dashboard': { title: 'Panel Principal', subtitle: 'Vista general de tus operaciones agrícolas', icon: '📊', render: renderDashboard, roles: ['farmer', 'advisor', 'supermarket', 'admin'] },
  '/parcels': { title: 'Mis Parcelas', subtitle: 'Delimita tus parcelas en el mapa satelital', icon: '🗺️', render: renderParcelsPage, roles: ['farmer'] },
  '/crops': { title: 'Mis Cultivos', subtitle: 'Gestiona tus cultivos y registra actividades', icon: '🌿', render: renderCropsPage, roles: ['farmer'] },
  '/weather': { title: 'Clima & Alertas', subtitle: 'Pronóstico y alertas climáticas para Cerro de Pasco', icon: '⛅', render: renderWeatherPage, roles: ['farmer'] },
  '/advisory': { title: 'Asesoría Agrícola', subtitle: 'Buenas prácticas para cultivos de la Región Pasco', icon: '📚', render: renderAdvisoryPage, roles: ['farmer'] },
  '/traceability': { title: 'Trazabilidad Digital', subtitle: 'Historial completo de tus cultivos', icon: '📋', render: renderTraceabilityPage, roles: ['farmer'] },

  // Advisor routes
  '/advisor/parcels': { title: 'Parcelas de la Región', subtitle: 'Visualiza y monitorea todas las parcelas de Pasco', icon: '🗺️', render: renderAdvisorParcelsPage, roles: ['advisor'] },
  '/advisor/recommendations': { title: 'Recomendaciones', subtitle: 'Emite recomendaciones técnicas personalizadas', icon: '📋', render: renderAdvisorRecommendationsPage, roles: ['advisor'] },
  '/advisor/advisory': { title: 'Base de Conocimiento', subtitle: 'Asesoría técnica de referencia', icon: '📚', render: renderAdvisoryPage, roles: ['advisor'] },

  // Supermarket routes
  '/supermarket': { title: 'Catálogo de Productos', subtitle: 'Productos certificados con trazabilidad digital', icon: '🏪', render: renderSupermarketPage, roles: ['supermarket'] },
  '/supermarket/traceability': { title: 'Trazabilidad', subtitle: 'Consulta el origen exacto de cada producto', icon: '📋', render: renderTraceabilityPage, roles: ['supermarket'] },
  '/supermarket/logistics': { title: 'Rutas de Recogida', subtitle: 'Optimiza las rutas desde campos hasta distribución', icon: '🚛', render: renderLogisticsPage, roles: ['supermarket'] },
  '/supermarket/inventory': { title: 'Inventario', subtitle: 'Gestión de stock y ofertas', icon: '📦', render: renderInventoryPage, roles: ['supermarket'] },

  // Admin routes
  '/admin': { title: 'Panel Admin', subtitle: 'Supervisión del sistema AgroPasco', icon: '🔐', render: renderAdminDashboard, roles: ['admin'] },
  '/admin/users': { title: 'Gestión de Usuarios', subtitle: 'Administra usuarios y roles del sistema', icon: '👥', render: renderAdminUsersPage, roles: ['admin'] },
  '/admin/audit': { title: 'Auditoría', subtitle: 'Registro de actividad y seguridad', icon: '📋', render: renderAdminAuditPage, roles: ['admin'] },
};

// Default route per role
const defaultRoutes = {
  farmer: '/dashboard',
  advisor: '/advisor/parcels',
  supermarket: '/supermarket',
  admin: '/admin'
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
    window.location.hash = '#' + (defaultRoutes[user?.role] || '/dashboard');
    return;
  }

  // Handle dynamic routes
  let routeConfig, routeParams;

  // /crops/:id
  const cropDetailMatch = path.match(/^\/crops\/(\d+)$/);
  if (cropDetailMatch) {
    routeConfig = { title: 'Detalle del Cultivo', subtitle: 'Información y actividades del cultivo', icon: '🌿', render: () => renderCropDetail(cropDetailMatch[1]), roles: ['farmer'] };
    routeParams = cropDetailMatch[1];
  }

  // /traceability/:id
  const traceMatch = path.match(/^\/traceability\/(\d+)$/);
  if (traceMatch) {
    routeConfig = { title: 'Trazabilidad', subtitle: 'Reporte de trazabilidad digital', icon: '📋', render: () => renderTraceabilityPage(traceMatch[1]), roles: ['farmer', 'supermarket'] };
    routeParams = traceMatch[1];
  }

  if (!routeConfig) routeConfig = routes[path];

  // If route not found, go to role-based default
  if (!routeConfig) {
    const defaultRoute = defaultRoutes[user?.role] || '/dashboard';
    routeConfig = routes[defaultRoute];
    path = defaultRoute;
  }

  // Role guard — check if user has permission for this route
  if (routeConfig.roles && user && !routeConfig.roles.includes(user.role)) {
    const defaultRoute = defaultRoutes[user.role] || '/dashboard';
    window.location.hash = '#' + defaultRoute;
    showToast('No tienes acceso a esa sección', 'warning');
    return;
  }

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
    item.classList.toggle('active', href === path || (href && path.startsWith(href) && href !== '/dashboard' && href !== '/admin' && href !== '/supermarket'));
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

    // Auto-init maps after render
    setTimeout(() => {
      if (path === '/parcels' && typeof initParcelMap === 'function') initParcelMap();
      if (path === '/advisor/parcels' && typeof initAdvisorMap === 'function') initAdvisorMap();
      if (path === '/supermarket/logistics' && typeof initLogisticsMap === 'function') initLogisticsMap();
    }, 300);
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

// ===== ROLE-BASED SIDEBAR =====

function buildAppLayout(user) {
  const role = user?.role || 'farmer';
  const navItems = getNavItemsForRole(role);

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
          ${navItems}
        </nav>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-user-avatar">${(user?.name || 'U')[0].toUpperCase()}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${user?.name || 'Usuario'}</div>
              <div class="sidebar-user-role">${getRoleLabel(role)}</div>
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
            <div class="role-indicator">
              <span class="badge badge-${role === 'admin' ? 'red' : role === 'advisor' ? 'blue' : role === 'supermarket' ? 'purple' : 'green'}" style="font-size: 12px; padding: 5px 12px;">
                ${getRoleLabel(role)}
              </span>
            </div>
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

function getRoleLabel(role) {
  const labels = {
    farmer: '🌱 Agricultor',
    advisor: '📋 Asesor Técnico',
    supermarket: '🏪 Supermercado',
    admin: '🔐 Administrador'
  };
  return labels[role] || role;
}

function getNavItemsForRole(role) {
  const navConfigs = {
    // ===== AGRICULTOR =====
    farmer: `
      <div class="nav-section-title">Principal</div>
      <div class="nav-item" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
        <span class="nav-item-icon">📊</span> Panel Principal
      </div>
      <div class="nav-item" data-route="/parcels" onclick="window.location.hash='#/parcels'">
        <span class="nav-item-icon">🗺️</span> Mis Parcelas
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
    `,

    // ===== ASESOR TÉCNICO =====
    advisor: `
      <div class="nav-section-title">Monitoreo Regional</div>
      <div class="nav-item" data-route="/advisor/parcels" onclick="window.location.hash='#/advisor/parcels'">
        <span class="nav-item-icon">🗺️</span> Parcelas de la Región
      </div>

      <div class="nav-section-title">Intervención</div>
      <div class="nav-item" data-route="/advisor/recommendations" onclick="window.location.hash='#/advisor/recommendations'">
        <span class="nav-item-icon">📋</span> Recomendaciones
      </div>
      <div class="nav-item" data-route="/advisor/advisory" onclick="window.location.hash='#/advisor/advisory'">
        <span class="nav-item-icon">📚</span> Base de Conocimiento
      </div>

      <div class="nav-section-title">Datos</div>
      <div class="nav-item" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
        <span class="nav-item-icon">📊</span> Panel General
      </div>
    `,

    // ===== SUPERMERCADO =====
    supermarket: `
      <div class="nav-section-title">Catálogo</div>
      <div class="nav-item" data-route="/supermarket" onclick="window.location.hash='#/supermarket'">
        <span class="nav-item-icon">🏪</span> Productos
      </div>
      <div class="nav-item" data-route="/supermarket/traceability" onclick="window.location.hash='#/supermarket/traceability'">
        <span class="nav-item-icon">📋</span> Trazabilidad
      </div>

      <div class="nav-section-title">Logística</div>
      <div class="nav-item" data-route="/supermarket/logistics" onclick="window.location.hash='#/supermarket/logistics'">
        <span class="nav-item-icon">🚛</span> Rutas de Recogida
      </div>
      <div class="nav-item" data-route="/supermarket/inventory" onclick="window.location.hash='#/supermarket/inventory'">
        <span class="nav-item-icon">📦</span> Inventario
      </div>

      <div class="nav-section-title">Datos</div>
      <div class="nav-item" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
        <span class="nav-item-icon">📊</span> Panel General
      </div>
    `,

    // ===== ADMINISTRADOR =====
    admin: `
      <div class="nav-section-title">Administración</div>
      <div class="nav-item" data-route="/admin" onclick="window.location.hash='#/admin'">
        <span class="nav-item-icon">📊</span> Panel Admin
      </div>
      <div class="nav-item" data-route="/admin/users" onclick="window.location.hash='#/admin/users'">
        <span class="nav-item-icon">👥</span> Usuarios & Roles
      </div>
      <div class="nav-item" data-route="/admin/audit" onclick="window.location.hash='#/admin/audit'">
        <span class="nav-item-icon">📋</span> Auditoría
      </div>

      <div class="nav-section-title">Datos</div>
      <div class="nav-item" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
        <span class="nav-item-icon">📊</span> Panel General
      </div>
    `
  };

  return navConfigs[role] || navConfigs.farmer;
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
document.addEventListener('DOMContentLoaded', async () => {
  // Load map config
  if (typeof MapsConfig !== 'undefined') {
    await MapsConfig.loadConfig();
  }

  // Set initial route
  if (!window.location.hash) {
    const token = getToken();
    const user = getUser();
    const defaultRoute = token ? (defaultRoutes[user?.role] || '/dashboard') : '/login';
    window.location.hash = '#' + defaultRoute;
  }

  handleHashChange();
});

window.addEventListener('hashchange', handleHashChange);

// Close sidebar on mobile when navigating
window.addEventListener('hashchange', () => {
  document.getElementById('sidebar')?.classList.remove('open');
});