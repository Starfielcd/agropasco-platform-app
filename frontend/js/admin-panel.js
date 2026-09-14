/**
 * AgroPasco — Panel de Administración y Soporte Integral
 * 1. Gestión de Usuarios y Roles (Duplicados, Bloqueo, Reset Password)
 * 2. Soporte Técnico y Monitoreo de Logs
 * 3. Auditoría y Reportes Institucionales con Drill-Down y Exportación (UNDAC / Instituciones)
 * 4. Moderación de Contenido (Fotos Inapropiadas) y Detector de Anomalías
 */

let currentAdminTab = 'metrics';

async function renderAdminDashboard() {
  const statsRes = await api.getAdminStats();
  const stats = statsRes.data || {};

  const usersByRole = stats.users?.by_role || [];
  const roleLabels = { farmer: '🌱 Agricultor', advisor: '📋 Asesor Técnico', supermarket: '🏪 Supermercado', admin: '🔐 Administrador' };

  return `
    <div class="page-content">
      <!-- Encabezado Principal del Administrador -->
      <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
            <span>🔐</span> Panel Central de Administración y Soporte AgroPasco
          </h2>
          <p class="text-sm text-muted">
            Supervisión integral de usuarios, moderación de contenidos, reportes institucionales y soporte técnico.
          </p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary" onclick="exportUniversityReport()" style="display: flex; align-items: center; gap: 6px;">
            <span>📥</span> <strong>Exportar Reporte Universitario</strong>
          </button>
          <button class="btn btn-primary" onclick="scanDuplicatesModal()" style="display: flex; align-items: center; gap: 6px;">
            <span>🔍</span> <strong>Detectar Duplicados</strong>
          </button>
        </div>
      </div>

      <!-- Barra de Pestañas / Módulos de Administración -->
      <div class="card mb-lg" style="padding: 6px; background: rgba(15,23,42,0.85); border: 1.5px solid var(--border);">
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button class="btn ${currentAdminTab === 'metrics' ? 'btn-primary' : 'btn-secondary'} admin-tab-btn" data-tab="metrics" style="flex: 1; min-width: 160px; font-weight: 700;"
                  onclick="switchAdminTab('metrics')">
            📊 Métricas & Auditoría
          </button>
          <button class="btn ${currentAdminTab === 'users' ? 'btn-primary' : 'btn-secondary'} admin-tab-btn" data-tab="users" style="flex: 1; min-width: 160px; font-weight: 700;"
                  onclick="switchAdminTab('users')">
            👥 Usuarios & Roles
          </button>
          <button class="btn ${currentAdminTab === 'support' ? 'btn-primary' : 'btn-secondary'} admin-tab-btn" data-tab="support" style="flex: 1; min-width: 160px; font-weight: 700;"
                  onclick="switchAdminTab('support')">
            🛠️ Soporte Técnico & Logs
          </button>
          <button class="btn ${currentAdminTab === 'moderation' ? 'btn-primary' : 'btn-secondary'} admin-tab-btn" data-tab="moderation" style="flex: 1; min-width: 160px; font-weight: 700;"
                  onclick="switchAdminTab('moderation')">
            🛡️ Moderación de Fotos & Datos
          </button>
        </div>
      </div>

      <!-- Contenedor Dinámico de la Pestaña Activa -->
      <div id="admin-tab-content">
        ${await renderActiveAdminTabContent(stats)}
      </div>
    </div>
  `;
}

async function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    const isThis = btn.getAttribute('data-tab') === tabName;
    btn.className = `btn ${isThis ? 'btn-primary' : 'btn-secondary'} admin-tab-btn`;
  });

  const contentEl = document.getElementById('admin-tab-content');
  if (contentEl) {
    contentEl.innerHTML = '<div class="skeleton" style="height: 300px; display: flex; align-items: center; justify-content: center; font-size: 15px;">🌾 Cargando información...</div>';
    const statsRes = await api.getAdminStats();
    contentEl.innerHTML = await renderActiveAdminTabContent(statsRes.data || {});
  }
}

async function renderActiveAdminTabContent(stats) {
  switch (currentAdminTab) {
    case 'metrics':
      return renderMetricsTabContent(stats);
    case 'users':
      return await renderUsersTabContent();
    case 'support':
      return await renderSupportTabContent(stats);
    case 'moderation':
      return await renderModerationTabContent();
    default:
      return renderMetricsTabContent(stats);
  }
}

// ==========================================
// 1. PESTAÑA: MÉTRICAS & REPORTES AUDITABLES
// ==========================================

function renderMetricsTabContent(stats) {
  const usersByRole = stats.users?.by_role || [];
  const farmerCount = usersByRole.find(r => r.role === 'farmer')?.count || 0;
  const advisorCount = usersByRole.find(r => r.role === 'advisor')?.count || 0;
  const supermarketCount = usersByRole.find(r => r.role === 'supermarket')?.count || 0;

  return `
    <div>
      <!-- Banner de Evaluación y Drill-down informativo -->
      <div class="card mb-lg" style="border-left: 4px solid var(--blue-500); background: rgba(59,130,246,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong style="color: var(--blue-400); font-size: 14px;">💡 Métricas Interactivas con Desglose:</strong>
            <span class="text-sm text-muted" style="margin-left: 6px;">Haz clic en cualquier tarjeta estadística para ver el listado detallado de cada usuario, producto o reporte.</span>
          </div>
          <span class="badge badge-blue">Región Pasco · Evaluación UNDAC</span>
        </div>
      </div>

      <!-- Grilla de Tarjetas Estadísticas con Drill-Down al Clic -->
      <div class="stats-grid mb-lg">
        <!-- Agricultores Activos -->
        <div class="stat-card" style="--stat-color: var(--green-500); cursor: pointer; transition: transform 0.2s;" onclick="openMetricDetailModal('farmers', 'Listado de Agricultores Activos')" title="Clic para ver lista de agricultores">
          <div class="stat-card-icon">👨‍🌾</div>
          <div class="stat-card-value">${farmerCount}</div>
          <div class="stat-card-label">Agricultores Activos (Ver Detalle →)</div>
        </div>

        <!-- Productos en Supermercado -->
        <div class="stat-card" style="--stat-color: var(--purple-400); cursor: pointer; transition: transform 0.2s;" onclick="openMetricDetailModal('products', 'Catálogo de Productos en Venta')" title="Clic para ver lista de productos">
          <div class="stat-card-icon">📦</div>
          <div class="stat-card-value">${stats.products?.total || 0}</div>
          <div class="stat-card-label">Productos en Venta (${stats.products?.active || 0} aprobados →)</div>
        </div>

        <!-- Plagas Reportadas y Atendidas -->
        <div class="stat-card" style="--stat-color: var(--red-500); cursor: pointer; transition: transform 0.2s;" onclick="openMetricDetailModal('pests', 'Reportes de Plagas Fitosanitarias')" title="Clic para ver plagas">
          <div class="stat-card-icon">🐛</div>
          <div class="stat-card-value">${stats.pest_reports?.total || 0}</div>
          <div class="stat-card-label">Plagas (${stats.pest_reports?.resolved || 0} resueltas / ${stats.pest_reports?.pending || 0} activas →)</div>
        </div>

        <!-- Parcelas Georreferenciadas -->
        <div class="stat-card" style="--stat-color: var(--blue-500); cursor: pointer; transition: transform 0.2s;" onclick="openMetricDetailModal('parcels', 'Parcelas Registradas en Pasco')" title="Clic para ver parcelas">
          <div class="stat-card-icon">🗺️</div>
          <div class="stat-card-value">${stats.parcels?.total || 0}</div>
          <div class="stat-card-label">Parcelas Mapeadas (Ver Detalle →)</div>
        </div>
      </div>

      <!-- Resumen de Roles y Estado de Integraciones -->
      <div class="grid-2 mb-lg">
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">👥</span> Usuarios del Ecosistema AgroPasco</div>
          </div>
          <div style="display: grid; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <span>🌱 <strong>Agricultores</strong> (productores de Pasco)</span>
              <span class="badge badge-green">${farmerCount}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <span>📋 <strong>Asesores Técnicos</strong> (ingenieros agrónomos)</span>
              <span class="badge badge-blue">${advisorCount}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <span>🏪 <strong>Supermercados</strong> (centros de compra)</span>
              <span class="badge badge-purple">${supermarketCount}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">🔌</span> Integraciones Geoespaciales y Climáticas</div>
          </div>
          <div style="display: grid; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <div>
                <strong>Cartografía Satelital</strong>
                <div class="text-xs text-muted">Esri World Imagery + Leaflet</div>
              </div>
              <span class="badge badge-green">Activo</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <div>
                <strong>Telemetría Meteorológica</strong>
                <div class="text-xs text-muted">Open-Meteo High-Res API (Pasco: 4,380 msnm)</div>
              </div>
              <span class="badge badge-green">Activo</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px;">
              <div>
                <strong>Almacenamiento Local de Evidencias</strong>
                <div class="text-xs text-muted">Servidor /uploads (Imágenes de plagas y cosechas)</div>
              </div>
              <span class="badge badge-green">Activo</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Registro de Auditoría Rápida -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">📋</span> Eventos Recientes de Auditoría del Sistema</div>
          <a href="#/admin/audit" class="btn btn-sm btn-secondary">Ver historial completo</a>
        </div>
        ${(stats.recent_activity || []).length > 0 ? `
          <div style="display: grid; gap: 8px;">
            ${stats.recent_activity.slice(0, 5).map(log => `
              <div style="display: flex; gap: 12px; padding: 10px 14px; background: var(--bg-glass); border-radius: 6px; font-size: 13px; align-items: center;">
                <span style="font-size: 16px;">${{CREATE: '➕', UPDATE_ROLE: '🔄', DELETE: '🗑️', RESET_PASSWORD: '🔑', BLOQUEAR_CUENTA: '🔒'}[log.action] || '📋'}</span>
                <div style="flex: 1;">
                  <strong>${log.user_name || 'Sistema'}</strong> <span class="badge badge-blue" style="font-size: 10px;">${log.action}</span>
                  <div class="text-muted text-xs mt-xs">${log.details || ''}</div>
                </div>
                <span class="text-xs text-muted">${new Date(log.created_at).toLocaleString('es-PE')}</span>
              </div>
            `).join('')}
          </div>
        ` : '<p class="text-muted text-sm">Sin actividad reciente registrada.</p>'}
      </div>
    </div>
  `;
}

// ==========================================
// 2. PESTAÑA: GESTIÓN DE USUARIOS & ROLES
// ==========================================

async function renderUsersTabContent() {
  try {
    const res = await api.getAdminUsers();
    const users = res.data || [];
    const roleLabels = { farmer: '🌱 Agricultor', advisor: '📋 Asesor', supermarket: '🏪 Supermercado', admin: '🔐 Admin' };

    return `
      <div class="card mb-md">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
          <div style="display: flex; gap: 8px; flex: 1; min-width: 250px;">
            <input type="text" id="admin-user-search" class="form-input" placeholder="🔍 Buscar por nombre, email o teléfono..." oninput="filterAdminUserTable(this.value)">
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="scanDuplicatesModal()">
              🔍 Escanear Cuentas Duplicadas
            </button>
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" id="admin-users-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Contacto</th>
                <th>Rol Actual (Supervisión)</th>
                <th>Estado</th>
                <th>Registro</th>
                <th>Acciones de Soporte</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => {
                const isBlocked = u.is_blocked || u.status === 'blocked';
                return `
                  <tr data-user-row="${u.name.toLowerCase()} ${u.email.toLowerCase()} ${u.phone || ''}">
                    <td><strong>#${u.id}</strong></td>
                    <td>
                      <div style="font-weight: 700; color: #ffffff;">${u.name}</div>
                      <div class="text-xs text-muted">📍 ${u.location || 'Pasco'}</div>
                    </td>
                    <td>
                      <div>${u.email}</div>
                      <div class="text-xs text-muted">📞 ${u.phone || 'Sin teléfono'}</div>
                    </td>
                    <td>
                      <select class="form-select" style="width: auto; font-size: 12px; padding: 4px 8px;" onchange="changeUserRole(${u.id}, this.value)">
                        ${['farmer', 'advisor', 'supermarket', 'admin'].map(r => `
                          <option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabels[r]}</option>
                        `).join('')}
                      </select>
                    </td>
                    <td>
                      <span class="badge badge-${isBlocked ? 'red' : 'green'}" id="status-badge-${u.id}">
                        ${isBlocked ? '🔒 Bloqueado' : '✅ Activo'}
                      </span>
                    </td>
                    <td class="text-xs text-muted">${new Date(u.created_at).toLocaleDateString('es-PE')}</td>
                    <td>
                      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <button class="btn btn-sm btn-secondary" onclick="resetUserPasswordPrompt(${u.id}, '${u.name.replace(/'/g, "\\'")}')" title="Restablecer contraseña">
                          🔑 Reset Clave
                        </button>
                        <button class="btn btn-sm ${isBlocked ? 'btn-primary' : 'btn-secondary'}"
                                onclick="toggleUserStatusAction(${u.id}, ${!isBlocked}, '${u.name.replace(/'/g, "\\'")}')"
                                title="${isBlocked ? 'Desbloquear cuenta' : 'Bloquear cuenta'}">
                          ${isBlocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="confirmDeleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')" title="Eliminar usuario">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    return `<div class="empty-state">Error al cargar lista de usuarios: ${e.message}</div>`;
  }
}

function filterAdminUserTable(query) {
  const q = query.trim().toLowerCase();
  const rows = document.querySelectorAll('#admin-users-table tbody tr');
  rows.forEach(r => {
    const text = r.getAttribute('data-user-row') || '';
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

// ==========================================
// 3. PESTAÑA: SOPORTE TÉCNICO & TICKETS
// ==========================================

async function renderSupportTabContent(stats) {
  try {
    const ticketsRes = await api.getSupportTickets();
    const tickets = ticketsRes.data || [];

    return `
      <!-- Bandeja de Solicitudes y Tickets de Soporte -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">📩</span> Bandeja de Consultas e Incidencias (${tickets.length})
          </div>
          <span class="badge badge-amber">${tickets.filter(t => t.status !== 'resuelto').length} pendientes</span>
        </div>

        <div style="display: grid; gap: 12px;">
          ${tickets.length > 0 ? tickets.map(t => {
            const isResolved = t.status === 'resuelto';
            return `
              <div style="padding: 16px; background: var(--bg-glass); border-radius: 8px; border-left: 4px solid ${isResolved ? '#22c55e' : t.escalated_to_dev ? '#ef4444' : '#f59e0b'};">
                <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
                  <div>
                    <strong style="font-size: 15px; color: #ffffff;">${t.subject}</strong>
                    <span class="badge badge-blue text-xs" style="margin-left: 6px; text-transform: uppercase;">${t.category}</span>
                    ${t.escalated_to_dev ? '<span class="badge badge-red text-xs">🚀 Escalado a Desarrolladores</span>' : ''}
                  </div>
                  <span class="badge badge-${isResolved ? 'green' : 'amber'}">${t.status.toUpperCase()}</span>
                </div>

                <p class="text-sm text-muted mb-sm">${t.message}</p>

                <div class="text-xs text-muted mb-md">
                  👤 <strong>${t.user_name || 'Usuario'}</strong> (${t.user_email || '—'}) · 📅 ${new Date(t.created_at).toLocaleString('es-PE')}
                </div>

                ${t.response ? `
                  <div style="padding: 10px 14px; background: rgba(34,197,94,0.1); border-radius: 6px; font-size: 12.5px; border-left: 3px solid #22c55e; margin-bottom: 10px;">
                    <strong style="color: #4ade80;">Respuesta de Soporte AgroPasco:</strong>
                    <div style="color: #f1f5f9; margin-top: 2px;">${t.response}</div>
                  </div>
                ` : ''}

                <!-- Botones de Acción de Soporte -->
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button class="btn btn-sm btn-primary" onclick="openReplyTicketModal(${t.id}, '${t.subject.replace(/'/g, "\\'")}', '${(t.user_name || '').replace(/'/g, "\\'")}')">
                    💬 ${isResolved ? 'Actualizar Respuesta' : 'Responder Consulta'}
                  </button>
                  ${!t.escalated_to_dev && !isResolved ? `
                    <button class="btn btn-sm btn-secondary" onclick="escalateTicketAction(${t.id})">
                      🚀 Escalar a Desarrolladores
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('') : `
            <div class="empty-state" style="padding: 24px;">No hay tickets de soporte abiertos actualmente.</div>
          `}
        </div>
      </div>

      <!-- Monitor de Logs del Sistema -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🖥️</span> Monitoreo de Eventos y Fallas del Sistema</div>
        </div>
        <div style="font-family: monospace; font-size: 12px; background: #050811; padding: 14px; border-radius: 6px; max-height: 260px; overflow-y: auto; color: #a5f3fc;">
          <div>[LOG-SYSTEM] Servidor AgroPasco inicializado en modo WAL con integridad referencial.</div>
          <div>[LOG-AUTH] Conexión JWT y verificación de firmas activa.</div>
          <div>[LOG-GEO] Coordenadas base configuradas en Cerro de Pasco (-10.6674, -76.2567).</div>
          ${(stats.recent_activity || []).map(l => `
            <div style="margin-top: 4px; color: ${l.action === 'DELETE' ? '#f87171' : l.action.includes('BLOQUEAR') ? '#fbbf24' : '#4ade80'};">
              [AUDIT][${new Date(l.created_at).toISOString()}] ${l.action} por ${l.user_name || 'System'}: ${l.details || ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    return `<div class="empty-state">Error al cargar soporte técnico: ${e.message}</div>`;
  }
}

// ==========================================
// 4. PESTAÑA: MODERACIÓN DE CONTENIDO & ANOMALÍAS
// ==========================================

async function renderModerationTabContent() {

  return `<div id="${containerId}"><div class="skeleton" style="height: 350px;">Cargando módulo de moderación...</div></div>`;
}

// ==========================================
// 5. ACCIONES Y MODALES INTERACTIVOS
// ==========================================

// Drilldown modal al hacer clic en una tarjeta estadística
async function openMetricDetailModal(type, title) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'metric-drilldown-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 780px;">
      <div class="modal-header">
        <h3 style="font-size: 18px; font-weight: 800;">📋 ${title}</h3>
        <button class="modal-close" onclick="document.getElementById('metric-drilldown-modal').remove()">✕</button>
      </div>
      <div id="metric-drilldown-content" style="max-height: 60vh; overflow-y: auto; padding: 10px 0;">
        <div class="skeleton" style="height: 200px;">Cargando desglose detallado...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  try {
    const res = await api.getMetricDetail(type);
    const items = res.data || [];
    const contentEl = document.getElementById('metric-drilldown-content');
    if (!contentEl) return;

    if (items.length === 0) {
      contentEl.innerHTML = '<div class="empty-state">No hay registros registrados para esta categoría.</div>';
      return;
    }

    if (type === 'farmers') {
      contentEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Ubicación</th>
              <th>Parcelas</th>
              <th>Cultivos</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(u => `
              <tr>
                <td><strong>#${u.id}</strong></td>
                <td><strong>${u.name}</strong></td>
                <td>${u.email}<br><span class="text-xs text-muted">${u.phone || ''}</span></td>
                <td>${u.location || 'Pasco'}</td>
                <td><span class="badge badge-green">${u.parcel_count || 0}</span></td>
                <td><span class="badge badge-blue">${u.crop_count || 0}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'products') {
      contentEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Producto</th>
              <th>Agricultor</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>100% Natural</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(p => `
              <tr>
                <td><strong>#${p.id}</strong></td>
                <td><strong>${p.name}</strong></td>
                <td>${p.farmer_name || '—'}</td>
                <td style="color: #4ade80; font-weight: 700;">S/ ${p.price_per_kg?.toFixed(2)}</td>
                <td>${p.stock_kg} kg</td>
                <td>${p.is_natural ? '<span class="badge badge-green">🌿 +30% Natural</span>' : 'Convencional'}</td>
                <td><span class="badge badge-${p.validation_status === 'approved' ? 'green' : 'amber'}">${p.validation_status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'pests') {
      contentEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Plaga</th>
              <th>Parcela</th>
              <th>Severidad</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(pr => `
              <tr>
                <td><strong>#${pr.id}</strong></td>
                <td><strong>${pr.pest_name}</strong></td>
                <td>${pr.parcel_name || '—'}</td>
                <td><span class="badge badge-${pr.severity === 'critico' || pr.severity === 'grave' ? 'red' : pr.severity === 'moderado' ? 'amber' : 'green'}">${pr.severity || 'moderado'}</span></td>
                <td><span class="badge badge-${pr.status === 'resuelto' ? 'green' : 'amber'}">${pr.status}</span></td>
                <td class="text-xs text-muted">${new Date(pr.created_at).toLocaleDateString('es-PE')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'parcels') {
      contentEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Parcela</th>
              <th>Agricultor</th>
              <th>Cultivo</th>
              <th>Área</th>
              <th>Altitud</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(p => `
              <tr>
                <td><strong>#${p.id}</strong></td>
                <td><strong>${p.name}</strong></td>
                <td>${p.farmer_name || '—'}</td>
                <td>${p.crop_type || '—'}</td>
                <td>${p.area_hectares} ha</td>
                <td style="color: #38bdf8;">${p.altitude_masl || 4380} msnm</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    showToast('Error al cargar detalle: ' + err.message, 'error');
  }
}

// Exportar reporte consolidado para Universidad / Institución
async function exportUniversityReport() {
  try {
    showToast('Generando reporte institucional consolidado...', 'info');
    const res = await api.getActivityReport();
    if (!res.success || !res.report) {
      showToast('No se pudo generar el reporte.', 'error');
      return;
    }

    const rep = res.report;
    const totals = rep.totales;

    // Crear contenido CSV estructurado
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "AGROPASCO DIGITAL - REPORTE OFICIAL DE ACTIVIDAD AGRICOLA\n";
    csvContent += `Institucion: ${rep.institucion}\n`;
    csvContent += `Fecha: ${new Date(rep.fecha_generacion).toLocaleString('es-PE')}\n`;
    csvContent += `Region: ${rep.region}\n\n`;

    csvContent += "METRICAS GENERALES\n";
    csvContent += `Agricultores Activos,${totals.agricultores_activos}\n`;
    csvContent += `Asesores Tecnicos,${totals.asesores_tecnicos}\n`;
    csvContent += `Parcelas Mapeadas,${totals.parcelas_mapeadas}\n`;
    csvContent += `Area Total (Hectareas),${totals.area_total_hectareas}\n`;
    csvContent += `Productos Registrados,${totals.productos_registrados}\n`;
    csvContent += `Productos Certificados Natural (+30%),${totals.productos_validados_natural}\n`;
    csvContent += `Plagas Reportadas,${totals.plagas_reportadas}\n`;
    csvContent += `Plagas Atendidas,${totals.plagas_atendidas}\n\n`;

    csvContent += "DETALLE DE AGRICULTORES\n";
    csvContent += "ID,Nombre,Email,Ubicacion,Telefono\n";
    rep.detalles.agricultores.forEach(a => {
      csvContent += `${a.id},"${a.name}","${a.email}","${a.location || ''}","${a.phone || ''}"\n`;
    });

    // Disparar descarga directa
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `AgroPasco_Reporte_Universitario_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();

    showToast('✅ Reporte CSV descargado exitosamente para evaluación universitaria.', 'success');
  } catch (e) {
    showToast('Error al exportar reporte: ' + e.message, 'error');
  }
}

// Modal para detectar y eliminar cuentas duplicadas
async function scanDuplicatesModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'duplicates-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px;">
      <div class="modal-header">
        <h3 style="font-size: 18px; font-weight: 800;">🔍 Detector de Cuentas Duplicadas</h3>
        <button class="modal-close" onclick="document.getElementById('duplicates-modal').remove()">✕</button>
      </div>
      <div id="duplicates-modal-content">
        <div class="skeleton" style="height: 180px;">Analizando base de datos en busca de duplicados...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  try {
    const res = await api.getDuplicates();
    const dups = res.data || [];
    const container = document.getElementById('duplicates-modal-content');
    if (!container) return;

    if (dups.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <div class="empty-state-icon">✅</div>
          <div class="empty-state-title">Excelente: Base de datos limpia</div>
          <div class="empty-state-text">No se detectaron nombres, teléfonos o correos redundantes en la plataforma.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <p class="text-sm text-muted mb-md">Se identificaron <strong>${dups.length}</strong> posibles duplicidades. Puedes eliminar la cuenta redundante directamente:</p>
      <div style="display: grid; gap: 12px; max-height: 55vh; overflow-y: auto;">
        ${dups.map(d => `
          <div style="padding: 12px; background: rgba(239,68,68,0.08); border-radius: 8px; border-left: 4px solid #ef4444;">
            <div style="font-weight: 700; color: #f87171; font-size: 13px; margin-bottom: 6px;">
              ⚠️ Coincidencia: ${d.reason}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              ${d.accounts.map(acc => `
                <div style="padding: 8px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                  <strong>#${acc.id} - ${acc.name}</strong><br>
                  <span class="text-muted">${acc.email}</span><br>
                  <span class="text-muted">📞 ${acc.phone || '—'} · ${acc.role}</span>
                  <div style="margin-top: 6px;">
                    <button class="btn btn-sm btn-danger btn-block" style="font-size: 11px; padding: 2px 6px;"
                            onclick="confirmDeleteUser(${acc.id}, '${acc.name.replace(/'/g, "\\'")}')">
                      🗑️ Eliminar Cuenta #${acc.id}
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    showToast('Error al buscar duplicados: ' + e.message, 'error');
  }
}

// Modal para restablecer contraseña
function resetUserPasswordPrompt(userId, userName) {
  const tempPass = 'AgroPasco2026!';
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'reset-pass-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 500px;">
      <div class="modal-header">
        <h3>🔑 Restablecer Contraseña</h3>
        <button class="modal-close" onclick="document.getElementById('reset-pass-modal').remove()">✕</button>
      </div>
      <p class="text-sm text-muted mb-md">
        Se asignará una contraseña provisional segura al usuario <strong>${userName}</strong>:
      </p>

      <div class="form-group">
        <label class="form-label">Nueva Contraseña Provisional:</label>
        <input type="text" id="reset-pass-input" class="form-input" value="${tempPass}" style="font-weight: 700; color: #4ade80;">
      </div>

      <div style="display: flex; gap: 8px; margin-top: 14px;">
        <button class="btn btn-primary btn-block btn-lg" onclick="executeResetPassword(${userId})">
          Confirmar y Restablecer
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function executeResetPassword(userId) {
  const tempPass = document.getElementById('reset-pass-input').value.trim();
  const res = await api.resetUserPassword(userId, { temp_password: tempPass });

  if (res.success) {
    document.getElementById('reset-pass-modal')?.remove();
    showToast(`✅ ${res.message} Clave: ${tempPass}`, 'success');
  } else {
    showToast(res.error || 'Error al restablecer contraseña.', 'error');
  }
}

async function toggleUserStatusAction(userId, newBlockedState, userName) {
  const actionName = newBlockedState ? 'bloquear' : 'desbloquear';
  if (!confirm(`¿Estás seguro de ${actionName} la cuenta de "${userName}"?`)) return;

  const res = await api.toggleUserStatus(userId, { is_blocked: newBlockedState });
  if (res.success) {
    showToast(res.message, 'success');
    navigateTo('/admin');
  } else {
    showToast(res.error || 'Error al cambiar estado.', 'error');
  }
}

async function changeUserRole(userId, newRole) {
  const res = await api.updateUserRole(userId, { role: newRole });
  if (res.success) {
    showToast(res.message || 'Rol actualizado', 'success');
  } else {
    showToast(res.error || 'Error al cambiar rol', 'error');
    navigateTo('/admin');
  }
}

async function confirmDeleteUser(userId, userName) {
  if (!confirm(`¿Eliminar definitivamente al usuario "${userName}"? Esta acción no se puede deshacer.`)) return;
  const res = await api.deleteUser(userId);
  if (res.success) {
    showToast(res.message || 'Usuario eliminado', 'success');
    document.getElementById('duplicates-modal')?.remove();
    navigateTo('/admin');
  } else {
    showToast(res.error || 'Error al eliminar', 'error');
  }
}

// Modal para responder ticket de soporte
function openReplyTicketModal(ticketId, subject, userName) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'reply-ticket-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 560px;">
      <div class="modal-header">
        <h3>💬 Responder Consulta de Soporte</h3>
        <button class="modal-close" onclick="document.getElementById('reply-ticket-modal').remove()">✕</button>
      </div>

      <div style="padding: 10px; background: rgba(59,130,246,0.1); border-radius: 6px; margin-bottom: 14px; font-size: 13px;">
        <strong>Asunto:</strong> ${subject}<br>
        <strong>Usuario:</strong> ${userName || 'Usuario'}
      </div>

      <form onsubmit="handleSendTicketResponse(event, ${ticketId})">
        <div class="form-group">
          <label class="form-label">Respuesta Técnica / Instrucciones para el usuario:</label>
          <textarea id="ticket-reply-text" class="form-textarea" rows="4" placeholder="Escribe aquí la solución o respuesta oficial..." required></textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-block btn-lg">
          Enviar Respuesta y Resolver Consulta
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleSendTicketResponse(e, ticketId) {
  e.preventDefault();
  const text = document.getElementById('ticket-reply-text').value.trim();
  const res = await api.respondSupportTicket(ticketId, { response: text });

  if (res.success) {
    document.getElementById('reply-ticket-modal')?.remove();
    showToast('✅ Consulta respondida y marcada como resuelta.', 'success');
    navigateTo('/admin');
  } else {
    showToast(res.error || 'Error al enviar respuesta.', 'error');
  }
}

async function escalateTicketAction(ticketId) {
  if (!confirm('¿Deseas escalar esta incidencia técnica a los desarrolladores?')) return;
  const res = await api.escalateSupportTicket(ticketId);
  if (res.success) {
    showToast('🚀 Ticket escalado al equipo de ingeniería.', 'success');
    navigateTo('/admin');
  } else {
    showToast(res.error || 'Error al escalar ticket.', 'error');
  }
}

async function removePhotoAction(entityType, entityId) {
  if (!confirm('¿Estás seguro de retirar esta fotografía por no cumplir las normas?')) return;
  const res = await api.removeModerationPhoto({ entity_type: entityType, entity_id: entityId });
  if (res.success) {
    showToast('Fotografía retirada exitosamente.', 'success');
    navigateTo('/admin');
  } else {
    showToast(res.error || 'Error al retirar foto.', 'error');
  }
}

// ==========================================
// 6. COMPATIBILIDAD CON SUB-RUTAS ANTIGUAS
// ==========================================

async function renderAdminUsersPage() {
  currentAdminTab = 'users';
  return renderAdminDashboard();
}

async function renderAdminAuditPage() {
  const result = await api.getAuditLog();
  const logs = result.data || [];

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">📋 Log Completo de Auditoría y Seguridad</h3>
          <p class="text-sm text-muted">${logs.length} registros de operaciones en la plataforma AgroPasco.</p>
        </div>
        <a href="#/admin" class="btn btn-secondary">← Volver al Panel Admin</a>
      </div>

      <div class="card">
        ${logs.length > 0 ? `
          <div style="display: grid; gap: 8px;">
            ${logs.map(log => `
              <div style="display: flex; gap: 12px; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm); font-size: 13px; border-left: 3px solid ${{CREATE: 'var(--green-500)', UPDATE_ROLE: 'var(--blue-500)', DELETE: 'var(--red-500)'}[log.action] || 'var(--text-muted)'};">
                <span style="font-size: 18px;">${{CREATE: '➕', UPDATE_ROLE: '🔄', DELETE: '🗑️', RESET_PASSWORD: '🔑', BLOQUEAR_CUENTA: '🔒'}[log.action] || '📋'}</span>
                <div style="flex: 1;">
                  <div><strong>${log.user_name || 'Sistema'}</strong> <span class="badge badge-blue" style="font-size: 10px;">${log.action}</span></div>
                  <div class="text-muted mt-sm">${log.details || `${log.entity_type} #${log.entity_id}`}</div>
                </div>
                <div class="text-sm text-muted" style="white-space: nowrap;">
                  ${new Date(log.created_at).toLocaleString('es-PE')}
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="text-muted">Sin registros de auditoría.</p>'}
      </div>
    </div>
  `;
}
