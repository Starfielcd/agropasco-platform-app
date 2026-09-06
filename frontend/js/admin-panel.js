/**
 * AgroPasco — Panel de Administración
 * Gestión de usuarios, auditoría y control de APIs
 */

async function renderAdminDashboard() {
  const statsRes = await api.getAdminStats();
  const stats = statsRes.data || {};

  const usersByRole = stats.users?.by_role || [];
  const roleLabels = { farmer: '🌱 Agricultor', advisor: '📋 Asesor', supermarket: '🏪 Supermercado', admin: '🔐 Admin' };

  return `
    <div class="page-content">
      <div class="mb-lg">
        <h3 style="font-size: 18px; font-weight: 700;">📊 Panel de Administración</h3>
        <p class="text-sm text-muted">Estadísticas generales y control del sistema AgroPasco.</p>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">👥</div>
          <div class="stat-card-value">${stats.users?.total || 0}</div>
          <div class="stat-card-label">Usuarios Totales</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">🗺️</div>
          <div class="stat-card-value">${stats.parcels?.total || 0}</div>
          <div class="stat-card-label">Parcelas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">🌿</div>
          <div class="stat-card-value">${stats.crops?.total || 0}</div>
          <div class="stat-card-label">Cultivos</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--purple-400)">
          <div class="stat-card-icon">📦</div>
          <div class="stat-card-value">${stats.products?.total || 0}</div>
          <div class="stat-card-label">Productos</div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Usuarios por Rol -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">👥</span> Usuarios por Rol</div>
          </div>
          <div style="display: grid; gap: 12px;">
            ${usersByRole.map(r => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm);">
                <span style="font-weight: 600;">${roleLabels[r.role] || r.role}</span>
                <span class="badge badge-blue">${r.count}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Estado de APIs -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">🔌</span> Integraciones / APIs</div>
          </div>
          <div style="display: grid; gap: 12px;">
            ${Object.entries(stats.apis || {}).map(([key, api]) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm);">
                <div>
                  <div style="font-weight: 600; text-transform: capitalize;">${key}</div>
                  <div class="text-sm text-muted">${api.provider}</div>
                </div>
                <span class="badge badge-${api.status === 'active' ? 'green' : api.status === 'configured' ? 'blue' : 'amber'}">${api.status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Actividad Reciente -->
      <div class="card mt-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">📋</span> Actividad Reciente</div>
          <a href="#/admin/audit" class="btn btn-sm btn-secondary">Ver todo</a>
        </div>
        ${(stats.recent_activity || []).length > 0 ? `
          <div style="display: grid; gap: 8px;">
            ${stats.recent_activity.slice(0, 5).map(log => `
              <div style="display: flex; gap: 12px; padding: 10px; background: var(--bg-glass); border-radius: var(--radius-sm); font-size: 13px;">
                <span style="font-size: 16px;">${{CREATE: '➕', UPDATE_ROLE: '🔄', DELETE: '🗑️'}[log.action] || '📋'}</span>
                <div style="flex: 1;">
                  <strong>${log.user_name || 'Sistema'}</strong> ${log.action.toLowerCase().replace('_', ' ')} ${log.entity_type || ''}
                  <div class="text-muted">${log.details || ''}</div>
                </div>
                <span class="text-sm text-muted">${new Date(log.created_at).toLocaleString('es-PE')}</span>
              </div>
            `).join('')}
          </div>
        ` : '<p class="text-muted text-sm">Sin actividad reciente.</p>'}
      </div>
    </div>
  `;
}

async function renderAdminUsersPage() {
  const result = await api.getAdminUsers();
  const users = result.data || [];
  const roleLabels = { farmer: '🌱 Agricultor', advisor: '📋 Asesor', supermarket: '🏪 Supermercado', admin: '🔐 Admin' };
  const roleColors = { farmer: 'green', advisor: 'blue', supermarket: 'purple', admin: 'red' };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">👥 Gestión de Usuarios</h3>
          <p class="text-sm text-muted">${users.length} usuarios registrados en la plataforma.</p>
        </div>
      </div>

      <div class="card">
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Ubicación</th>
                <th>Registro</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${u.id}</td>
                  <td style="font-weight: 600;">${u.name}</td>
                  <td>${u.email}</td>
                  <td>
                    <select class="form-select" style="width: auto; padding: 4px 28px 4px 8px; font-size: 12px;" onchange="changeUserRole(${u.id}, this.value)" ${u.role === 'admin' ? '' : ''}>
                      ${['farmer', 'advisor', 'supermarket', 'admin'].map(r => `
                        <option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabels[r]}</option>
                      `).join('')}
                    </select>
                  </td>
                  <td class="text-sm">${u.location || '—'}</td>
                  <td class="text-sm text-muted">${new Date(u.created_at).toLocaleDateString('es-PE')}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="confirmDeleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function renderAdminAuditPage() {
  const result = await api.getAuditLog();
  const logs = result.data || [];

  return `
    <div class="page-content">
      <div class="mb-lg">
        <h3 style="font-size: 18px; font-weight: 700;">📋 Log de Auditoría</h3>
        <p class="text-sm text-muted">${logs.length} registros de actividad del sistema.</p>
      </div>

      <div class="card">
        ${logs.length > 0 ? `
          <div style="display: grid; gap: 8px;">
            ${logs.map(log => `
              <div style="display: flex; gap: 12px; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm); font-size: 13px; border-left: 3px solid ${{CREATE: 'var(--green-500)', UPDATE_ROLE: 'var(--blue-500)', DELETE: 'var(--red-500)'}[log.action] || 'var(--text-muted)'};">
                <span style="font-size: 18px;">${{CREATE: '➕', UPDATE_ROLE: '🔄', DELETE: '🗑️'}[log.action] || '📋'}</span>
                <div style="flex: 1;">
                  <div><strong>${log.user_name || 'Sistema'}</strong> <span class="badge badge-${log.action === 'DELETE' ? 'red' : 'blue'}" style="font-size: 10px;">${log.action}</span></div>
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

// ===== ACCIONES =====

async function changeUserRole(userId, newRole) {
  const result = await api.updateUserRole(userId, { role: newRole });
  if (result.success) {
    showToast(result.message || 'Rol actualizado', 'success');
  } else {
    showToast(result.error || 'Error al cambiar rol', 'error');
    navigateTo('/admin/users');
  }
}

async function confirmDeleteUser(userId, userName) {
  if (!confirm(`¿Eliminar al usuario "${userName}"? Esta acción no se puede deshacer.`)) return;
  const result = await api.deleteUser(userId);
  if (result.success) {
    showToast(result.message || 'Usuario eliminado', 'success');
    navigateTo('/admin/users');
  } else {
    showToast(result.error || 'Error al eliminar', 'error');
  }
}
