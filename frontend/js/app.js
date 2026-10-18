/**
 * AgroPasco Digital — SPA Router & Aplicación Principal
 * Hash-based routing with ROLE-BASED navigation
 */

// ===== ROLE-BASED ROUTE DEFINITIONS =====
const routes = {
  // Public
  '/login': { title: 'Iniciar Sesión', render: () => renderLoginPage('login'), public: true, fullPage: true },
  '/register': { title: 'Registrarse', render: () => renderLoginPage('register'), public: true, fullPage: true },

  // Farmer routes
  '/dashboard': { title: 'Panel Principal', subtitle: 'Vista general de tus operaciones agrícolas', icon: '📊', render: renderDashboard, roles: ['farmer', 'advisor', 'supermarket', 'admin'] },
  '/parcels': { title: 'Mis Parcelas', subtitle: 'Delimita tus parcelas en el mapa satelital', icon: '🗺️', render: renderParcelsPage, roles: ['farmer', 'admin'] },
  '/crops': { title: 'Gestión de Cultivos', subtitle: 'Gestiona tus cultivos y registra actividades', icon: '🌿', render: renderCropsPage, roles: ['farmer', 'advisor', 'admin'] },
  '/weather': { title: 'Clima & Alertas', subtitle: 'Pronóstico y alertas climáticas para Cerro de Pasco', icon: '⛅', render: renderWeatherPage, roles: ['farmer', 'advisor', 'supermarket', 'admin'] },
  '/ml-monitor': { title: 'Monitoreo ML', subtitle: 'Predicciones meteorológicas inteligentes por parcela', icon: '🔬', render: renderMLMonitorPage, roles: ['farmer', 'advisor', 'admin'] },
  '/advisory': { title: 'Asesoría Agrícola', subtitle: 'Buenas prácticas para cultivos de la Región Pasco', icon: '📚', render: renderAdvisoryPage, roles: ['farmer', 'advisor', 'admin'] },
  '/traceability': { title: 'Trazabilidad Digital', subtitle: 'Historial completo de tus cultivos', icon: '📋', render: renderTraceabilityPage, roles: ['farmer', 'supermarket', 'admin'] },
  '/pest-reports': { title: 'Reportes de Plagas', subtitle: 'Reporta plagas y recibe asesoría técnica', icon: '🐛', render: renderPestReportsPage, roles: ['farmer', 'advisor', 'admin'] },
  '/farmer/sales': { title: 'Mis Ventas', subtitle: 'Productos publicados y su estado de validación', icon: '📦', render: renderFarmerSalesPage, roles: ['farmer', 'admin'] },
  '/farmer/orders': { title: 'Pedidos Recibidos B2B', subtitle: 'Órdenes de compra solicitadas por supermercados', icon: '📥', render: renderFarmerOrdersPage, roles: ['farmer', 'admin'] },

  // Advisor routes
  '/advisor/parcels': { title: 'Parcelas de la Región', subtitle: 'Visualiza y monitorea todas las parcelas de Pasco', icon: '🗺️', render: renderAdvisorParcelsPage, roles: ['advisor', 'admin'] },
  '/advisor/pest-reports': { title: 'Gestión de Plagas', subtitle: 'Reportes de plagas de agricultores', icon: '🐛', render: renderAdvisorPestReportsPage, roles: ['advisor', 'admin'] },
  '/advisor/validate-products': { title: 'Validar Productos', subtitle: 'Revisa y valida productos para el catálogo', icon: '✅', render: renderValidateProductsPage, roles: ['advisor', 'admin'] },
  '/advisor/recommendations': { title: 'Recomendaciones', subtitle: 'Emite recomendaciones técnicas personalizadas', icon: '📋', render: renderAdvisorRecommendationsPage, roles: ['advisor', 'admin'] },
  '/advisor/advisory': { title: 'Base de Conocimiento', subtitle: 'Asesoría técnica de referencia', icon: '📚', render: renderAdvisoryPage, roles: ['advisor', 'admin'] },

  // Supermarket routes
  '/supermarket': { title: 'Catálogo de Productos', subtitle: 'Productos certificados con trazabilidad digital', icon: '🏪', render: renderSupermarketPage, roles: ['supermarket', 'admin'] },
  '/supermarket/orders': { title: 'Órdenes de Compra B2B', subtitle: 'Seguimiento de compras y transporte con agricultores', icon: '📑', render: renderSupermarketOrdersPage, roles: ['supermarket', 'admin'] },
  '/supermarket/traceability': { title: 'Trazabilidad', subtitle: 'Consulta el origen exacto de cada producto', icon: '📋', render: renderTraceabilityPage, roles: ['supermarket', 'admin'] },
  '/supermarket/logistics': { title: 'Rutas de Recogida', subtitle: 'Optimiza las rutas desde campos hasta distribución', icon: '🚛', render: renderLogisticsPage, roles: ['supermarket', 'admin'] },
  '/supermarket/inventory': { title: 'Inventario', subtitle: 'Gestión de stock y ofertas', icon: '📦', render: renderInventoryPage, roles: ['supermarket', 'admin'] },

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

  // Extraer ruta base sin query params (ej: /crops?action=new -> /crops)
  const basePath = path.split('?')[0];

  // Auth guard: solo permitir /login y /register sin autenticación
  const isPublicRoute = basePath === '/login' || basePath === '/register';
  if (!token && !isPublicRoute) {
    window.location.hash = '#/login';
    return;
  }

  // Redirigir usuarios autenticados fuera de login o register
  if (token && isPublicRoute) {
    window.location.hash = '#' + (defaultRoutes[user?.role] || '/dashboard');
    return;
  }

  // Handle dynamic routes
  let routeConfig, routeParams;

  // /crops/:id
  const cropDetailMatch = basePath.match(/^\/crops\/(\d+)$/);
  if (cropDetailMatch) {
    routeConfig = { title: 'Detalle del Cultivo', subtitle: 'Información y actividades del cultivo', icon: '🌿', render: () => renderCropDetail(cropDetailMatch[1]), roles: ['farmer', 'advisor', 'admin'] };
    routeParams = cropDetailMatch[1];
  }

  // /traceability/:id
  const traceMatch = basePath.match(/^\/traceability\/(\d+)$/);
  if (traceMatch) {
    routeConfig = { title: 'Trazabilidad', subtitle: 'Reporte de trazabilidad digital', icon: '📋', render: () => renderTraceabilityPage(traceMatch[1]), roles: ['farmer', 'supermarket', 'admin'] };
    routeParams = traceMatch[1];
  }

  if (!routeConfig) routeConfig = routes[basePath];

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
    document.body.className = '';
    const content = typeof routeConfig.render === 'function' ? routeConfig.render() : '';
    appContainer.innerHTML = content;
    return;
  }

  const role = user?.role || 'farmer';
  document.body.className = 'role-' + role;

  // Build app layout if not present or if active role changed
  const currentLayoutRole = appContainer.querySelector('.app-layout')?.getAttribute('data-role');
  if (!document.getElementById('page-content') || currentLayoutRole !== role) {
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
      if (path === '/advisor/pest-reports' && typeof initPestReportMap === 'function') initPestReportMap();
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

// ===== ROLE-BASED SIDEBAR & HELPERS =====

function getRoleAvatar(role) {
  const avatars = {
    farmer: 'frontend/assets/images/roles/agricultor/farmer_hero.jpg',
    admin: 'frontend/assets/images/roles/agricultor/farmer_hero.jpg',
    advisor: 'frontend/assets/images/roles/asesor/advisor_hero.jpg',
    supermarket: 'frontend/assets/images/roles/supermercado/supermarket_hero.jpg'
  };
  return avatars[role] || 'frontend/assets/images/roles/agricultor/farmer_hero.jpg';
}

function getRoleDisplayName(role) {
  const names = {
    farmer: 'Agricultor',
    admin: 'Administrador',
    advisor: 'Asesor Técnico',
    supermarket: 'Supermercado'
  };
  return names[role] || 'Usuario';
}

function getSearchPlaceholder(role) {
  const placeholders = {
    farmer: 'Buscar parcelas, cultivos, productos...',
    admin: 'Buscar usuarios, registros, auditoría...',
    advisor: 'Buscar parcelas, plagas, recomendaciones...',
    supermarket: 'Buscar productos certificados, lotes, trazabilidad...'
  };
  return placeholders[role] || 'Buscar...';
}

function getMobileBottomNavForRole(role) {
  if (role === 'admin') {
    return `
      <nav class="mobile-bottom-nav" aria-label="Navegación rápida de Administrador">
        <button class="mobile-nav-btn ${window.location.hash.includes('admin') && !window.location.hash.includes('users') && !window.location.hash.includes('audit') ? 'active' : ''}" onclick="window.location.hash='#/admin'">
          <span class="mobile-nav-icon">📊</span>
          <span>Admin</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('users') ? 'active' : ''}" onclick="window.location.hash='#/admin/users'">
          <span class="mobile-nav-icon">👥</span>
          <span>Usuarios</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('ml-monitor') ? 'active' : ''}" onclick="window.location.hash='#/ml-monitor'">
          <span class="mobile-nav-icon">🔬</span>
          <span>ML</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('audit') ? 'active' : ''}" onclick="window.location.hash='#/admin/audit'">
          <span class="mobile-nav-icon">📋</span>
          <span>Auditoría</span>
        </button>
      </nav>
    `;
  }
  if (role === 'advisor') {
    return `
      <nav class="mobile-bottom-nav" aria-label="Navegación rápida de Asesor Técnico">
        <button class="mobile-nav-btn ${window.location.hash.includes('advisor/parcels') ? 'active' : ''}" onclick="window.location.hash='#/advisor/parcels'">
          <span class="mobile-nav-icon">🗺️</span>
          <span>Parcelas</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('pest-reports') ? 'active' : ''}" onclick="window.location.hash='#/advisor/pest-reports'">
          <span class="mobile-nav-icon">🐛</span>
          <span>Plagas</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('validate-products') ? 'active' : ''}" onclick="window.location.hash='#/advisor/validate-products'">
          <span class="mobile-nav-icon">✅</span>
          <span>Validar</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('ml-monitor') ? 'active' : ''}" onclick="window.location.hash='#/ml-monitor'">
          <span class="mobile-nav-icon">🔬</span>
          <span>ML</span>
        </button>
      </nav>
    `;
  }
  if (role === 'supermarket') {
    return `
      <nav class="mobile-bottom-nav" aria-label="Navegación rápida de Supermercado">
        <button class="mobile-nav-btn ${window.location.hash.includes('supermarket') && !window.location.hash.includes('traceability') && !window.location.hash.includes('logistics') && !window.location.hash.includes('inventory') ? 'active' : ''}" onclick="window.location.hash='#/supermarket'">
          <span class="mobile-nav-icon">🏪</span>
          <span>Catálogo</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('traceability') ? 'active' : ''}" onclick="window.location.hash='#/supermarket/traceability'">
          <span class="mobile-nav-icon">📋</span>
          <span>Trazabilidad</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('logistics') ? 'active' : ''}" onclick="window.location.hash='#/supermarket/logistics'">
          <span class="mobile-nav-icon">🚛</span>
          <span>Rutas</span>
        </button>
        <button class="mobile-nav-btn ${window.location.hash.includes('inventory') ? 'active' : ''}" onclick="window.location.hash='#/supermarket/inventory'">
          <span class="mobile-nav-icon">📦</span>
          <span>Stock</span>
        </button>
      </nav>
    `;
  }
  // Default: Farmer
  return `
    <nav class="mobile-bottom-nav" aria-label="Navegación rápida de Agricultor">
      <button class="mobile-nav-btn ${window.location.hash.includes('dashboard') ? 'active' : ''}" onclick="window.location.hash='#/dashboard'">
        <span class="mobile-nav-icon">📊</span>
        <span>Inicio</span>
      </button>
      <button class="mobile-nav-btn ${window.location.hash.includes('parcels') ? 'active' : ''}" onclick="window.location.hash='#/parcels'">
        <span class="mobile-nav-icon">🗺️</span>
        <span>Parcelas</span>
      </button>
      <button class="mobile-nav-btn ${window.location.hash.includes('weather') ? 'active' : ''}" onclick="window.location.hash='#/weather'">
        <span class="mobile-nav-icon">⛅</span>
        <span>Clima</span>
      </button>
      <button class="mobile-nav-btn ${window.location.hash.includes('advisory') ? 'active' : ''}" onclick="window.location.hash='#/advisory'">
        <span class="mobile-nav-icon">🤖</span>
        <span>Asesoría</span>
      </button>
    </nav>
  `;
}

function buildAppLayout(user) {
  const role = user?.role || 'farmer';
  const navItems = getNavItemsForRole(role);
  const homeRoute = defaultRoutes[role] || '/dashboard';

  return `
    <div class="app-layout" data-role="${role}">
      <!-- Sidebar Agrícola Fiel a Referencia 2 -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand" onclick="window.location.hash='#${homeRoute}'" style="cursor: pointer;">
          <div class="sidebar-brand-logo">
            <svg width="34" height="34" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 4C24 4 29 16 40 18C40 29 29 36 24 36C24 31 25.5 22 24 4Z" fill="#16A34A"/>
              <path d="M11 22C11 22 18 22 24 28C20 35 11 35 7 30C7 26 9 23 11 22Z" fill="#22C55E"/>
              <path d="M22 31C22 31 27 25 35 27C33 34 27 38 20 36C21 33.5 22 32 22 31Z" fill="#4ADE80"/>
            </svg>
          </div>
          <div class="sidebar-brand-text">
            <div class="sidebar-brand-title">AgroPasco</div>
            <div class="sidebar-brand-title">Digital</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          ${navItems}
        </nav>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-user-avatar">
              <img src="${getRoleAvatar(role)}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
            </div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${user?.name || getRoleDisplayName(role)}</div>
              <div class="sidebar-user-role">${getRoleLabel(role)}</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()" title="Cerrar Sesión">🚪</button>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <header class="main-header">
          <div class="header-search">
            <span class="header-search-icon">🔍</span>
            <input type="text" class="header-search-input" id="global-search-input" placeholder="${getSearchPlaceholder(role)}" onkeydown="if(event.key==='Enter')handleGlobalSearch(this.value)">
          </div>

          <div class="header-right">
            <div class="notif-wrapper" style="position: relative;">
              <button class="btn-icon header-notif-btn" id="header-notif-toggle" title="Notificaciones y Órdenes" onclick="toggleNotificationDropdown(event)" style="position: relative;">
                🔔
                <span class="header-notif-badge" id="notif-badge" style="display: none;">0</span>
              </button>
              <div class="notif-dropdown" id="notif-dropdown" style="display: none;">
                <div class="notif-dropdown-header">
                  <span class="notif-dropdown-title">🔔 Notificaciones AgroPasco</span>
                  <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px; padding: 2px 8px;" onclick="handleMarkAllNotificationsRead(event)">
                    ✓ Leídas
                  </button>
                </div>
                <div class="notif-dropdown-body" id="notif-dropdown-body">
                  <div style="padding: 24px; text-align: center; color: #64748B; font-size: 12.5px;">Cargando notificaciones...</div>
                </div>
              </div>
            </div>
            <div class="header-user-profile" onclick="window.location.hash='#${homeRoute}'">
              <div class="header-avatar-circle">
                <img src="${getRoleAvatar(role)}" alt="Usuario" class="header-avatar-img">
              </div>
              <span class="header-user-role-text">${getRoleDisplayName(role)}</span>
              <span class="header-chevron-down">▾</span>
            </div>
          </div>
        </header>

        <div id="page-content"></div>
      </main>

      <!-- Mobile menu toggle button -->
      <button class="menu-toggle" onclick="toggleSidebar()" aria-label="Abrir menú">☰</button>

      <!-- Mobile Bottom Navigation Bar adaptada por rol -->
      ${getMobileBottomNavForRole(role)}
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
      <div class="nav-item active" data-route="/dashboard" onclick="window.location.hash='#/dashboard'">
        <span class="nav-item-icon">🏠</span> Panel Principal
      </div>
      <div class="nav-item" data-route="/parcels" onclick="window.location.hash='#/parcels'">
        <span class="nav-item-icon">🗺️</span> Mis Parcelas
      </div>
      <div class="nav-item" data-route="/crops" onclick="window.location.hash='#/crops'">
        <span class="nav-item-icon">🌱</span> Mis Cultivos
      </div>

      <div class="nav-section-title">MONITOREO</div>
      <div class="nav-item" data-route="/weather" onclick="window.location.hash='#/weather'">
        <span class="nav-item-icon">⛅</span> Clima & Alertas
        <span class="nav-badge-red">1</span>
      </div>
      <div class="nav-item" data-route="/ml-monitor" onclick="window.location.hash='#/ml-monitor'">
        <span class="nav-item-icon">🔬</span> Monitoreo ML
      </div>
      <div class="nav-item" data-route="/advisory" onclick="window.location.hash='#/advisory'">
        <span class="nav-item-icon">🤖</span> Asesoría IA
      </div>
      <div class="nav-item" data-route="/pest-reports" onclick="window.location.hash='#/pest-reports'">
        <span class="nav-item-icon">🌱</span> Reportar Plagas
      </div>

      <div class="nav-section-title">COMERCIO</div>
      <div class="nav-item" data-route="/farmer/sales" onclick="window.location.hash='#/farmer/sales'">
        <span class="nav-item-icon">📦</span> Vender Productos
      </div>
      <div class="nav-item" data-route="/farmer/orders" onclick="window.location.hash='#/farmer/orders'">
        <span class="nav-item-icon">📥</span> Pedidos Recibidos B2B
      </div>

      <div class="nav-section-title">TRAZABILIDAD</div>
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
      <div class="nav-item" data-route="/crops" onclick="window.location.hash='#/crops'">
        <span class="nav-item-icon">🌿</span> Cultivos Regionales
      </div>
      <div class="nav-item" data-route="/ml-monitor" onclick="window.location.hash='#/ml-monitor'">
        <span class="nav-item-icon">🔬</span> Monitoreo ML
      </div>

      <div class="nav-section-title">Gestión</div>
      <div class="nav-item" data-route="/advisor/pest-reports" onclick="window.location.hash='#/advisor/pest-reports'">
        <span class="nav-item-icon">🐛</span> Gestión de Plagas
      </div>
      <div class="nav-item" data-route="/advisor/validate-products" onclick="window.location.hash='#/advisor/validate-products'">
        <span class="nav-item-icon">✅</span> Validar Productos
      </div>
      <div class="nav-item" data-route="/advisor/recommendations" onclick="window.location.hash='#/advisor/recommendations'">
        <span class="nav-item-icon">📋</span> Recomendaciones
      </div>

      <div class="nav-section-title">Conocimiento</div>
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
      <div class="nav-item" data-route="/supermarket/orders" onclick="window.location.hash='#/supermarket/orders'">
        <span class="nav-item-icon">📑</span> Órdenes B2B
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
      <div class="nav-item" data-route="/ml-monitor" onclick="window.location.hash='#/ml-monitor'">
        <span class="nav-item-icon">🔬</span> Monitoreo ML
      </div>
      <div class="nav-item" data-route="/admin/users" onclick="window.location.hash='#/admin/users'">
        <span class="nav-item-icon">👥</span> Usuarios & Roles
      </div>
      <div class="nav-item" data-route="/crops" onclick="window.location.hash='#/crops'">
        <span class="nav-item-icon">🌿</span> Gestión de Cultivos
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
    const token = getToken();
    if (!token) return;

    const notifBadge = document.getElementById('notif-badge');
    const alertBadge = document.getElementById('alert-badge');

    // 1. Obtener notificaciones del usuario desde PostgreSQL
    if (typeof api.getNotifications === 'function') {
      const res = await api.getNotifications(20);
      const unread = res.unread_count || 0;
      if (notifBadge) {
        notifBadge.style.display = unread > 0 ? 'flex' : 'none';
        notifBadge.textContent = unread;
      }
    }

    // 2. Alertas climáticas de campo
    if (alertBadge) {
      const weatherRes = await api.getAlerts();
      const count = weatherRes.data?.alerts?.length || 0;
      alertBadge.style.display = count > 0 ? 'inline' : 'none';
      alertBadge.textContent = count;
    }
  } catch (e) {
    // Silently continue on background badge polling
  }
}

async function toggleNotificationDropdown(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;

  const isVisible = dropdown.style.display === 'block';
  if (isVisible) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.style.display = 'block';
  const bodyEl = document.getElementById('notif-dropdown-body');
  if (bodyEl) {
    bodyEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748B; font-size: 12.5px;">Cargando notificaciones...</div>';
  }

  try {
    const res = await api.getNotifications(25);
    const notifications = res.data || [];
    renderNotificationDropdownItems(notifications);
  } catch (err) {
    if (bodyEl) {
      bodyEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #EF4444; font-size: 12px;">Error al cargar notificaciones.</div>';
    }
  }
}

function renderNotificationDropdownItems(notifications) {
  const bodyEl = document.getElementById('notif-dropdown-body');
  if (!bodyEl) return;

  if (!notifications || notifications.length === 0) {
    bodyEl.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: #64748B;">
        <div style="font-size: 32px; margin-bottom: 6px;">📭</div>
        <div style="font-size: 13px; font-weight: 600;">Bandeja limpia</div>
        <div style="font-size: 11.5px; color: #94A3B8; margin-top: 2px;">No tienes notificaciones pendientes.</div>
      </div>
    `;
    return;
  }

  const iconMap = {
    orden_compra: '🛒',
    mercado: '📦',
    alerta_helada: '❄️',
    alerta_clima: '⛅',
    sistema: 'ℹ️'
  };

  bodyEl.innerHTML = notifications.map(n => {
    const isUnread = !n.read;
    const timeStr = n.created_at ? new Date(n.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const icon = iconMap[n.type] || '🔔';

    return `
      <div class="notif-item ${isUnread ? 'unread' : ''}" onclick="handleNotificationItemClick(${n.id}, ${n.order_id || 'null'})">
        <div style="display: flex; gap: 8px; align-items: flex-start;">
          <span style="font-size: 16px; line-height: 1.2;">${icon}</span>
          <div style="flex: 1; min-width: 0;">
            <div class="notif-item-title">${n.title || 'Notificación'}</div>
            <div class="notif-item-message">${(n.message || '').replace(/\n/g, '<br>')}</div>
            <div class="notif-item-time">${timeStr} ${n.order_id ? '• <strong style="color: #16A34A;">Ver Orden B2B →</strong>' : ''}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleNotificationItemClick(notifId, orderId) {
  const dropdown = document.getElementById('notif-dropdown');
  if (dropdown) dropdown.style.display = 'none';

  try {
    if (notifId) {
      await api.markNotificationRead(notifId);
      updateNotificationBadge();
    }
  } catch (_) {}

  if (orderId && typeof showOrderDetailModal === 'function') {
    showOrderDetailModal(orderId);
  } else if (orderId) {
    const user = getUser();
    if (user?.role === 'farmer') {
      window.location.hash = '#/farmer/orders';
    } else {
      window.location.hash = '#/supermarket/orders';
    }
  }
}

async function handleMarkAllNotificationsRead(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  try {
    await api.markAllNotificationsRead();
    updateNotificationBadge();
    const res = await api.getNotifications(25);
    renderNotificationDropdownItems(res.data || []);
    showToast('Todas las notificaciones marcadas como leídas.', 'success');
  } catch (err) {
    showToast('Error al marcar notificaciones.', 'error');
  }
}

// Cerrar dropdown al hacer clic fuera
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('notif-dropdown');
  const toggle = document.getElementById('header-notif-toggle');
  if (dropdown && dropdown.style.display === 'block') {
    if (!dropdown.contains(e.target) && !toggle?.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  }
});

function handleGlobalSearch(query) {
  if (!query || !query.trim()) return;
  const q = query.toLowerCase().trim();
  if (q.includes('parcel') || q.includes('mapa') || q.includes('tierra')) {
    window.location.hash = '#/parcels';
  } else if (q.includes('cultiv') || q.includes('papa') || q.includes('maca') || q.includes('habas')) {
    window.location.hash = '#/crops';
  } else if (q.includes('clima') || q.includes('alert') || q.includes('helada')) {
    window.location.hash = '#/weather';
  } else if (q.includes('ml') || q.includes('predicci') || q.includes('model')) {
    window.location.hash = '#/ml-monitor';
  } else if (q.includes('product') || q.includes('vent') || q.includes('preci')) {
    window.location.hash = '#/supermarket';
  } else {
    window.location.hash = '#/crops';
  }
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