/**
 * AgroPasco — Módulo de Reportes de Plagas
 * Agricultor reporta → Asesor Técnico responde
 */

let pestReportMap = null;

// ===== VISTA DEL AGRICULTOR =====
async function renderPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];
  const pending = reports.filter(r => r.status === 'pendiente');
  const resolved = reports.filter(r => r.status === 'resuelto');

  // Obtener parcelas del farmer para el selector
  let parcelsHtml = '<option value="">Sin parcela específica</option>';
  try {
    const parcelsRes = await api.getParcels();
    (parcelsRes.data || []).forEach(p => {
      parcelsHtml += `<option value="${p.id}">${p.name}${p.crop_type ? ' — ' + p.crop_type : ''}</option>`;
    });
  } catch (e) {}

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🐛 Reportes de Plagas (${reports.length})</h3>
          <p class="text-sm text-muted">Reporta plagas en tus cultivos y recibe respuesta del asesor técnico.</p>
        </div>
        <button class="btn btn-primary" onclick="showFarmerPestReportModal()">🐛 Reportar Plaga</button>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">⏳</div>
          <div class="stat-card-value">${pending.length}</div>
          <div class="stat-card-label">Pendientes</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">✅</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Resueltos</div>
        </div>
      </div>

      <!-- Lista de reportes -->
      ${reports.length > 0 ? `
        <div style="display: grid; gap: 12px;">
          ${reports.map(r => `
            <div class="card" style="border-left: 4px solid ${r.status === 'pendiente' ? 'var(--amber-500)' : 'var(--green-500)'}; cursor: pointer;" onclick="showReportDetailModal(${r.id}, 'farmer')">
              <div class="flex items-center justify-between mb-sm">
                <div style="font-weight: 600; font-size: 15px;">🐛 ${r.pest_name}</div>
                <span class="badge badge-${r.status === 'pendiente' ? 'amber' : 'green'}">${r.status === 'pendiente' ? '⏳ Pendiente' : '✅ Resuelto'}</span>
              </div>
              <div class="text-sm text-muted mb-sm">${r.description || 'Sin descripción'}</div>
              ${r.parcel_name ? `<div class="text-sm" style="color: var(--green-400);">🗺️ ${r.parcel_name}${r.parcel_crop ? ' — ' + r.parcel_crop : ''}</div>` : ''}
              ${r.advisor_response ? `
                <div style="margin-top: 8px; padding: 10px; background: var(--bg-glass); border-radius: 6px; border-left: 3px solid var(--green-400);">
                  <div class="text-sm" style="color: var(--green-400); font-weight: 600;">📋 Respuesta del Asesor ${r.advisor_name || ''}:</div>
                  <div class="text-sm text-muted mt-sm">${r.advisor_response}</div>
                </div>
              ` : ''}
              <div class="text-sm text-muted" style="margin-top: 6px;">📅 ${new Date(r.created_at).toLocaleDateString('es-PE')}</div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">🌿</div>
          <div class="empty-state-title">Sin reportes de plagas</div>
          <div class="empty-state-text">Si detectas una plaga en tus cultivos, repórtala aquí para recibir asesoría técnica.</div>
          <button class="btn btn-primary btn-lg" onclick="showFarmerPestReportModal()">🐛 Reportar mi primera plaga</button>
        </div>
      `}
    </div>
  `;
}

// Modal para que el agricultor reporte plaga
async function showFarmerPestReportModal() {
  let parcelsOptions = '<option value="">Sin parcela específica</option>';
  try {
    const parcelsRes = await api.getParcels();
    (parcelsRes.data || []).forEach(p => {
      parcelsOptions += `<option value="${p.id}">${p.name}${p.crop_type ? ' — ' + p.crop_type : ''}</option>`;
    });
  } catch (e) {}

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'pest-report-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>🐛 Reportar Plaga en Cultivo</h3>
        <button class="modal-close" onclick="document.getElementById('pest-report-modal').remove()">✕</button>
      </div>
      <form onsubmit="handleCreatePestReport(event)">
        <div class="form-group">
          <label class="form-label">Nombre de la Plaga</label>
          <input type="text" class="form-input" id="pr-pest-name" placeholder="Ej: Gorgojo de los Andes, Rancha..." required>
        </div>
        <div class="form-group">
          <label class="form-label">Parcela Afectada</label>
          <select class="form-select" id="pr-parcel">${parcelsOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Descripción del Problema</label>
          <textarea class="form-textarea" id="pr-description" rows="3" placeholder="Describe los síntomas, extensión del daño, desde cuándo lo observas..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">URL de Foto (opcional)</label>
          <input type="url" class="form-input" id="pr-photo" placeholder="https://...">
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">🐛 Enviar Reporte al Asesor</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleCreatePestReport(e) {
  e.preventDefault();
  const parcelId = document.getElementById('pr-parcel').value;

  const result = await api.createPestReport({
    pest_name: document.getElementById('pr-pest-name').value,
    parcel_id: parcelId ? parseInt(parcelId) : null,
    description: document.getElementById('pr-description').value,
    photo_url: document.getElementById('pr-photo').value || null
  });

  if (result.success) {
    document.getElementById('pest-report-modal')?.remove();
    showToast('¡Reporte enviado al asesor técnico!', 'success');
    navigateTo('/pest-reports');
  } else {
    showToast(result.error || 'Error al enviar reporte', 'error');
  }
}

// ===== VISTA DEL ASESOR TÉCNICO =====
async function renderAdvisorPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];
  const pending = reports.filter(r => r.status === 'pendiente' || r.status === 'en_revision');
  const resolved = reports.filter(r => r.status === 'resuelto');

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🐛 Gestión de Plagas Reportadas</h3>
          <p class="text-sm text-muted">${pending.length} pendientes · ${resolved.length} resueltos</p>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">⏳</div>
          <div class="stat-card-value">${pending.length}</div>
          <div class="stat-card-label">Plagas No Resueltas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">✅</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Plagas Completas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">📋</div>
          <div class="stat-card-value">${reports.length}</div>
          <div class="stat-card-label">Total Reportes</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="card mb-lg" style="padding: 0;">
        <div style="display: flex; border-bottom: 1px solid var(--border);">
          <button class="btn" id="tab-pending" style="flex:1; border-radius: 8px 0 0 0; border: none; padding: 12px; font-weight: 600; background: var(--green-600); color: white;" onclick="switchPestTab('pending')">
            🔴 No Resueltas (${pending.length})
          </button>
          <button class="btn" id="tab-resolved" style="flex:1; border-radius: 0 8px 0 0; border: none; padding: 12px; font-weight: 600; background: var(--bg-glass); color: var(--text-muted);" onclick="switchPestTab('resolved')">
            ✅ Completas (${resolved.length})
          </button>
        </div>

        <div id="pest-tab-content" style="padding: 16px;">
          ${renderPestReportsList(pending, 'pending')}
        </div>
      </div>

      <!-- Mapa de reportes -->
      <div class="card" style="padding: 0; overflow: hidden;">
        <div id="pest-report-map" class="map-container" style="height: 400px; width: 100%;"></div>
      </div>
    </div>
  `;
}

function switchPestTab(tab) {
  const tabPending = document.getElementById('tab-pending');
  const tabResolved = document.getElementById('tab-resolved');
  const content = document.getElementById('pest-tab-content');

  if (tab === 'pending') {
    tabPending.style.background = 'var(--green-600)';
    tabPending.style.color = 'white';
    tabResolved.style.background = 'var(--bg-glass)';
    tabResolved.style.color = 'var(--text-muted)';
  } else {
    tabResolved.style.background = 'var(--green-600)';
    tabResolved.style.color = 'white';
    tabPending.style.background = 'var(--bg-glass)';
    tabPending.style.color = 'var(--text-muted)';
  }

  // Re-render list
  api.getPestReports().then(res => {
    const reports = res.data || [];
    const filtered = tab === 'pending'
      ? reports.filter(r => r.status === 'pendiente' || r.status === 'en_revision')
      : reports.filter(r => r.status === 'resuelto');
    content.innerHTML = renderPestReportsList(filtered, tab);
  });
}

function renderPestReportsList(reports, tab) {
  if (reports.length === 0) {
    return `
      <div class="empty-state" style="padding: 24px;">
        <div class="empty-state-icon">${tab === 'pending' ? '✅' : '📋'}</div>
        <div class="empty-state-title">${tab === 'pending' ? 'Sin plagas pendientes' : 'Sin reportes completados'}</div>
        <div class="empty-state-text">${tab === 'pending' ? 'Todos los reportes han sido atendidos.' : 'Los reportes resueltos aparecerán aquí.'}</div>
      </div>
    `;
  }

  return `
    <div style="display: grid; gap: 12px;">
      ${reports.map(r => `
        <div class="alert-card ${r.status === 'pendiente' ? 'warning' : 'info'}" style="cursor: pointer;" onclick="showReportDetailModal(${r.id}, 'advisor')">
          <span class="alert-icon">🐛</span>
          <div class="alert-content" style="flex: 1;">
            <div class="alert-title">${r.pest_name}</div>
            <div class="alert-message">${r.description || 'Sin descripción'}</div>
            <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center; flex-wrap: wrap;">
              <span class="badge badge-blue">👨‍🌾 ${r.farmer_name || 'Agricultor'}</span>
              ${r.parcel_name ? `<span class="badge badge-green">🗺️ ${r.parcel_name}</span>` : ''}
              ${r.parcel_crop ? `<span class="badge badge-purple">🌱 ${r.parcel_crop}</span>` : ''}
              <span class="text-sm text-muted">📅 ${new Date(r.created_at).toLocaleDateString('es-PE')}</span>
              ${r.status === 'pendiente' ? `
                <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '${(r.description || '').replace(/'/g, "\\'").substring(0, 100)}')" style="margin-left: auto;">
                  📋 Responder
                </button>
              ` : `
                <span class="badge badge-green" style="margin-left: auto;">✅ Respondido por ${r.advisor_name || 'Asesor'}</span>
              `}
            </div>
            ${r.advisor_response ? `
              <div style="margin-top: 8px; padding: 8px; background: rgba(34,197,94,0.1); border-radius: 6px; border-left: 3px solid var(--green-400);">
                <div class="text-sm" style="color: var(--green-400);">Respuesta:</div>
                <div class="text-sm text-muted">${r.advisor_response}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Modal para que el asesor responda
function showRespondModal(reportId, pestName, description) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'respond-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>📋 Responder Reporte: ${pestName}</h3>
        <button class="modal-close" onclick="document.getElementById('respond-modal').remove()">✕</button>
      </div>
      <div style="padding: 12px; background: var(--bg-glass); border-radius: 6px; margin-bottom: 16px;">
        <div class="text-sm text-muted">Plaga reportada: <strong style="color: var(--text-primary);">${pestName}</strong></div>
        ${description ? `<div class="text-sm text-muted mt-sm">${description}</div>` : ''}
      </div>
      <form onsubmit="handleRespondReport(event, ${reportId})">
        <div class="form-group">
          <label class="form-label">Recomendación Técnica</label>
          <textarea class="form-textarea" id="respond-text" rows="5" placeholder="Escribe tu recomendación técnica para combatir esta plaga. Incluye: método de control, productos recomendados, frecuencia de aplicación..." required></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">✅ Enviar Recomendación</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleRespondReport(e, reportId) {
  e.preventDefault();
  const result = await api.respondPestReport(reportId, {
    advisor_response: document.getElementById('respond-text').value
  });

  if (result.success) {
    document.getElementById('respond-modal')?.remove();
    showToast('Recomendación enviada al agricultor', 'success');
    navigateTo('/advisor/pest-reports');
  } else {
    showToast(result.error || 'Error al responder', 'error');
  }
}

// Modal detalle con mapa
async function showReportDetailModal(reportId, role) {
  const result = await api.getPestReports();
  const report = (result.data || []).find(r => r.id === reportId);
  if (!report) { showToast('Reporte no encontrado', 'error'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'report-detail-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal" style="max-width: 720px;">
      <div class="modal-header">
        <h3>🐛 ${report.pest_name}</h3>
        <button class="modal-close" onclick="document.getElementById('report-detail-modal').remove()">✕</button>
      </div>

      <div style="display: grid; gap: 10px; margin-bottom: 16px;">
        ${[
          ['Estado', `<span class="badge badge-${report.status === 'pendiente' ? 'amber' : 'green'}">${report.status}</span>`],
          ['Agricultor', report.farmer_name || '—'],
          ['Parcela', report.parcel_name || 'No especificada'],
          ['Cultivo', report.parcel_crop || 'No especificado'],
          ['Altitud', report.altitude_masl ? report.altitude_masl + ' msnm' : '—'],
          ['Descripción', report.description || 'Sin descripción'],
          ['Fecha', new Date(report.created_at).toLocaleString('es-PE')]
        ].map(([l, v]) => `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
            <span class="text-muted text-sm">${l}</span>
            <span style="font-weight: 600; font-size: 13px;">${v}</span>
          </div>
        `).join('')}
      </div>

      ${report.photo_url ? `<img src="${report.photo_url}" style="width: 100%; max-height: 250px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;" alt="Foto de plaga">` : ''}

      ${report.advisor_response ? `
        <div style="padding: 12px; background: rgba(34,197,94,0.1); border-radius: 8px; border-left: 4px solid var(--green-400); margin-bottom: 12px;">
          <div style="font-weight: 600; color: var(--green-400); margin-bottom: 4px;">📋 Respuesta del Asesor ${report.advisor_name || ''}</div>
          <div class="text-sm">${report.advisor_response}</div>
          ${report.responded_at ? `<div class="text-sm text-muted mt-sm">📅 ${new Date(report.responded_at).toLocaleString('es-PE')}</div>` : ''}
        </div>
      ` : ''}

      <!-- Mapa con la parcela -->
      ${report.geo_json ? `
        <div style="font-weight: 600; margin-bottom: 8px;">📍 Ubicación de la Parcela Afectada</div>
        <div id="report-detail-map" style="height: 280px; width: 100%; border-radius: 8px; overflow: hidden;"></div>
      ` : ''}

      ${role === 'advisor' && report.status === 'pendiente' ? `
        <button class="btn btn-primary btn-block btn-lg" style="margin-top: 12px;" onclick="document.getElementById('report-detail-modal').remove(); showRespondModal(${report.id}, '${report.pest_name.replace(/'/g, "\\'")}', '${(report.description || '').replace(/'/g, "\\'").substring(0, 100)}')">
          📋 Responder este Reporte
        </button>
      ` : ''}
    </div>
  `;
  document.body.appendChild(modal);

  // Inicializar mapa si hay geo_json
  if (report.geo_json) {
    setTimeout(() => {
      try {
        const mapContainer = document.getElementById('report-detail-map');
        if (!mapContainer) return;

        const map = L.map('report-detail-map', {
          center: [report.center_lat || -10.6868, report.center_lng || -76.2625],
          zoom: 15,
          zoomControl: true
        });

        L.tileLayer(MapsConfig.ESRI_SAT_URL, {
          attribution: MapsConfig.ESRI_SAT_ATTRIBUTION,
          maxZoom: 18
        }).addTo(map);

        const geoJson = JSON.parse(report.geo_json);
        const coords = geoJson.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
        if (coords.length > 0) {
          const polygon = L.polygon(coords, {
            color: '#ef4444',
            weight: 3,
            fillOpacity: 0.3,
            fillColor: '#ef4444'
          }).addTo(map);

          polygon.bindPopup(`
            <div style="font-family: Inter, sans-serif;">
              <strong>🐛 ${report.pest_name}</strong><br>
              🗺️ ${report.parcel_name || 'Parcela'}<br>
              👨‍🌾 ${report.farmer_name || 'Agricultor'}
            </div>
          `).openPopup();

          map.fitBounds(polygon.getBounds(), { padding: [20, 20] });
        }

        setTimeout(() => map.invalidateSize(), 200);
      } catch (e) {
        console.warn('Error al mostrar mapa del reporte:', e);
      }
    }, 300);
  }
}

// Inicializar mapa de reportes (para vista del asesor)
function initPestReportMap() {
  const container = document.getElementById('pest-report-map');
  if (!container) return;

  const map = L.map('pest-report-map', {
    center: [MapsConfig.DEFAULT_CENTER.lat, MapsConfig.DEFAULT_CENTER.lng],
    zoom: 11
  });

  L.tileLayer(MapsConfig.ESRI_SAT_URL, {
    attribution: MapsConfig.ESRI_SAT_ATTRIBUTION,
    maxZoom: 18
  }).addTo(map);

  // Cargar reportes en mapa
  api.getPestReports().then(res => {
    const reports = res.data || [];
    const bounds = [];

    reports.forEach(r => {
      if (r.geo_json) {
        try {
          const geoJson = JSON.parse(r.geo_json);
          const coords = geoJson.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
          if (coords.length > 0) {
            const color = r.status === 'pendiente' ? '#f59e0b' : '#22c55e';
            const polygon = L.polygon(coords, { color, weight: 2, fillOpacity: 0.2, fillColor: color }).addTo(map);
            polygon.bindPopup(`
              <div style="font-family: Inter, sans-serif;">
                <strong>🐛 ${r.pest_name}</strong><br>
                👨‍🌾 ${r.farmer_name || 'Agricultor'}<br>
                🗺️ ${r.parcel_name || ''}<br>
                ${r.status === 'pendiente' ? '⏳ Pendiente' : '✅ Resuelto'}
              </div>
            `);
            bounds.push(...coords);
          }
        } catch (e) {}
      } else if (r.location_lat && r.location_lng) {
        const marker = L.marker([r.location_lat, r.location_lng], {
          icon: L.divIcon({
            html: '<div style="font-size: 24px;">🐛</div>',
            className: 'custom-marker-container',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
          })
        }).addTo(map);
        marker.bindPopup(`<strong>🐛 ${r.pest_name}</strong><br>${r.farmer_name || ''}`);
        bounds.push([r.location_lat, r.location_lng]);
      }
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  });

  setTimeout(() => map.invalidateSize(), 200);
}
