/**
 * AgroPasco — Panel del Asesor Técnico
 * Parcelas por región (agrupadas por provincia), marcadores de plagas y recomendaciones
 */

let advisorMap = null;

async function renderAdvisorParcelsPage() {
  const [parcelsRes, markersRes] = await Promise.all([
    api.getParcels(),
    api.getPestMarkers()
  ]);

  const parcels = parcelsRes.data || [];
  const markers = markersRes.data || [];
  const unresolvedMarkers = markers.filter(m => !m.resolved);

  // Agrupar parcelas por provincia
  const provinceGroups = {};
  parcels.forEach(p => {
    const location = p.farmer_location || p.notes || 'Región Pasco';
    // Extraer provincia del formato "Distrito, Provincia" o "Distrito, Pasco"
    let province = 'Otros';
    const parts = location.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const prov = parts[parts.length - 1];
      if (prov.includes('Pasco') || prov.includes('pasco')) province = 'Provincia de Pasco';
      else if (prov.includes('Oxapampa') || prov.includes('oxapampa')) province = 'Provincia de Oxapampa';
      else province = prov;
    } else if (location.toLowerCase().includes('oxapampa') || location.toLowerCase().includes('villa rica')) {
      province = 'Provincia de Oxapampa';
    } else if (location.toLowerCase().includes('yanahuanca') || location.toLowerCase().includes('chacayán') || location.toLowerCase().includes('tusi')) {
      province = 'Provincia Daniel A. Carrión';
    } else {
      province = 'Provincia de Pasco';
    }
    if (!provinceGroups[province]) provinceGroups[province] = [];
    provinceGroups[province].push(p);
  });

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🗺️ Parcelas de la Región Pasco</h3>
          <p class="text-sm text-muted">${parcels.length} parcelas registradas · ${unresolvedMarkers.length} alertas de plagas activas</p>
        </div>
        <button class="btn btn-primary" onclick="showPestMarkerModal()">🐛 Reportar Plaga</button>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">🗺️</div>
          <div class="stat-card-value">${parcels.length}</div>
          <div class="stat-card-label">Parcelas en la Región</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">🐛</div>
          <div class="stat-card-value">${unresolvedMarkers.length}</div>
          <div class="stat-card-label">Plagas No Resueltas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">📋</div>
          <div class="stat-card-value">${markers.length}</div>
          <div class="stat-card-label">Reportes Totales</div>
        </div>
      </div>

      <!-- Mapa -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden;">
        <div id="advisor-map" class="map-container" style="height: 500px; width: 100%;"></div>
      </div>

      <!-- Parcelas por Provincia -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">📍</span> Parcelas por Provincia</div>
        </div>
        ${Object.keys(provinceGroups).length > 0 ? `
          ${Object.entries(provinceGroups).map(([province, pList]) => `
            <div style="margin-bottom: 12px;">
              <button class="btn btn-secondary btn-block" style="text-align: left; font-weight: 700; font-size: 14px; padding: 12px 16px; margin-bottom: 8px;"
                onclick="toggleProvinceAccordion(this)">
                📍 ${province} (${pList.length} parcelas) <span style="float: right;">▼</span>
              </button>
              <div class="province-parcels" style="display: none; padding-left: 12px;">
                ${pList.map(p => `
                  <div class="alert-card info" style="margin-bottom: 8px; cursor: pointer;" onclick="focusParcelOnMap(${p.center_lat || 'null'}, ${p.center_lng || 'null'}, '${p.geo_json ? p.geo_json.replace(/'/g, "\\'").substring(0, 0) : ''}', ${p.id})">
                    <span class="alert-icon">🗺️</span>
                    <div class="alert-content" style="flex: 1;">
                      <div class="alert-title">${p.name}</div>
                      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                        <span class="badge badge-green">${p.crop_type ? '🌱 ' + p.crop_type : '📍 Sin cultivo'}</span>
                        <span class="badge badge-blue">📐 ${p.area_hectares || 0} ha</span>
                        <span class="badge badge-purple">🏔️ ${p.altitude_masl || '—'} msnm</span>
                        ${p.farmer_name ? `<span class="badge badge-amber">👨‍🌾 ${p.farmer_name}</span>` : ''}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">🗺️</div>
            <div class="empty-state-title">Sin parcelas registradas</div>
          </div>
        `}
      </div>

      <!-- Marcadores de Plagas -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🐛</span> Reportes de Plagas</div>
        </div>
        ${unresolvedMarkers.length > 0 ? `
          <div style="display: grid; gap: 12px;">
            ${unresolvedMarkers.slice(0, 10).map(m => `
              <div class="alert-card ${m.severity === 'critico' ? 'critical' : m.severity === 'grave' ? 'warning' : 'info'}">
                <span class="alert-icon">${{insecto:'🐛', hongo:'🍄', bacteria:'🦠', virus:'🧬', maleza:'🌿', nematodo:'🪱', otro:'⚠️'}[m.pest_type] || '⚠️'}</span>
                <div class="alert-content">
                  <div class="alert-title">${m.title} ${m.parcel_name ? '— ' + m.parcel_name : ''}</div>
                  <div class="alert-message">${m.description || ''}</div>
                  <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center;">
                    <span class="badge badge-${m.severity === 'critico' ? 'red' : m.severity === 'grave' ? 'amber' : 'blue'}">${m.severity}</span>
                    <span class="text-sm text-muted">📍 ${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}</span>
                    <span class="text-sm text-muted">👤 ${m.advisor_name || 'Asesor'}</span>
                    <button class="btn btn-sm btn-secondary" onclick="resolveMarker(${m.id})" style="margin-left: auto;">✅ Resolver</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-title">Sin plagas reportadas</div>
            <div class="empty-state-text">Todas las parcelas están en buen estado.</div>
          </div>
        `}
      </div>
    </div>
  `;
}

function toggleProvinceAccordion(btn) {
  const content = btn.nextElementSibling;
  if (content) {
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    const arrow = btn.querySelector('span[style*="float"]');
    if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
  }
}

function focusParcelOnMap(lat, lng, geoJsonStr, parcelId) {
  if (advisorMap && lat && lng) {
    advisorMap.setCenter(lat, lng, 16);
    const mapEl = document.getElementById('advisor-map');
    if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth' });
  }
}

async function renderAdvisorRecommendationsPage() {
  const [recsRes, farmersRes] = await Promise.all([
    api.getRecommendations(),
    api.getAdvisorFarmers()
  ]);

  const recs = recsRes.data || [];
  const farmers = farmersRes.data || [];

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">📋 Recomendaciones Técnicas</h3>
          <p class="text-sm text-muted">${recs.length} recomendaciones emitidas</p>
        </div>
        <button class="btn btn-primary" onclick="showRecommendationModal()">+ Nueva Recomendación</button>
      </div>

      ${recs.length > 0 ? `
        <div style="display: grid; gap: 12px;">
          ${recs.map(r => `
            <div class="card" style="border-left: 4px solid ${{urgente:'var(--red-500)', alta:'var(--amber-500)', normal:'var(--blue-500)', baja:'var(--text-muted)'}[r.priority] || 'var(--blue-500)'};">
              <div class="flex items-center justify-between mb-sm">
                <div style="font-weight: 600;">${r.title}</div>
                <div style="display: flex; gap: 6px;">
                  <span class="badge badge-${r.priority === 'urgente' ? 'red' : r.priority === 'alta' ? 'amber' : 'blue'}">${r.priority}</span>
                  <span class="badge badge-${r.status === 'aplicada' ? 'green' : r.status === 'leida' ? 'blue' : 'amber'}">${r.status}</span>
                </div>
              </div>
              <div class="text-sm text-muted mb-sm">${r.recommendation}</div>
              <div class="text-sm text-muted">
                📂 ${r.category} · 👨‍🌾 ${r.farmer_name || 'General'} · ${r.parcel_name ? '🗺️ ' + r.parcel_name + ' · ' : ''}📅 ${new Date(r.created_at).toLocaleDateString('es-PE')}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">Sin recomendaciones</div>
          <div class="empty-state-text">Emite tu primera recomendación técnica para los agricultores.</div>
        </div>
      `}
    </div>
  `;
}

// ===== INICIALIZAR MAPA DEL ASESOR =====

function initAdvisorMap() {
  if (advisorMap) { advisorMap.destroy(); advisorMap = null; }
  const container = document.getElementById('advisor-map');
  if (!container) return;

  advisorMap = new AgroMap('advisor-map', {
    satellite: true,
    onClick: (latlng) => {
      showPestMarkerModal(latlng.lat, latlng.lng);
    }
  }).init();

  loadAdvisorMapData();
}

async function loadAdvisorMapData() {
  if (!advisorMap) return;

  const [parcelsRes, markersRes] = await Promise.all([
    api.getParcels(),
    api.getPestMarkers()
  ]);

  // Dibujar parcelas
  (parcelsRes.data || []).forEach(p => {
    try {
      const geoJson = JSON.parse(p.geo_json);
      const coords = geoJson.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
      if (coords.length > 0) {
        advisorMap.addPolygon(coords, {
          color: '#22c55e',
          popup: `
            <div style="font-family: Inter, sans-serif;">
              <strong>${p.name}</strong><br>
              👨‍🌾 ${p.farmer_name || 'Agricultor'}<br>
              ${p.crop_type ? '🌱 ' + p.crop_type + '<br>' : ''}
              📐 ${p.area_hectares} ha<br>
              🏔️ ${p.altitude_masl} msnm<br>
              📍 ${p.farmer_location || ''}
            </div>
          `,
          tooltip: p.name
        });
      }
    } catch (e) {}
  });

  // Dibujar marcadores de plagas
  (markersRes.data || []).filter(m => !m.resolved).forEach(m => {
    const icons = {insecto:'🐛', hongo:'🍄', bacteria:'🦠', virus:'🧬', maleza:'🌿', nematodo:'🪱', otro:'⚠️'};
    advisorMap.addMarker(m.lat, m.lng, {
      icon: icons[m.pest_type] || '⚠️',
      popup: `
        <div style="font-family: Inter, sans-serif;">
          <strong>${m.title}</strong><br>
          🐛 ${m.pest_type} — ${m.severity}<br>
          ${m.description || ''}<br>
          <em>${new Date(m.created_at).toLocaleDateString('es-PE')}</em>
        </div>
      `
    });
  });

  advisorMap.fitToParcels();
}

// ===== MODALES =====

function showPestMarkerModal(lat, lng) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'pest-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>🐛 Reportar Plaga / Enfermedad</h3>
        <button class="modal-close" onclick="document.getElementById('pest-modal').remove()">✕</button>
      </div>
      <form onsubmit="handleCreatePestMarker(event)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Latitud</label>
            <input type="number" class="form-input" id="pest-lat" step="0.0001" value="${lat || ''}" placeholder="-10.6868" required>
          </div>
          <div class="form-group">
            <label class="form-label">Longitud</label>
            <input type="number" class="form-input" id="pest-lng" step="0.0001" value="${lng || ''}" placeholder="-76.2625" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Plaga</label>
            <select class="form-select" id="pest-type" required>
              <option value="insecto">🐛 Insecto</option>
              <option value="hongo">🍄 Hongo</option>
              <option value="bacteria">🦠 Bacteria</option>
              <option value="virus">🧬 Virus</option>
              <option value="maleza">🌿 Maleza</option>
              <option value="nematodo">🪱 Nematodo</option>
              <option value="otro">⚠️ Otro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Severidad</label>
            <select class="form-select" id="pest-severity">
              <option value="leve">🟢 Leve</option>
              <option value="moderado" selected>🟡 Moderado</option>
              <option value="grave">🟠 Grave</option>
              <option value="critico">🔴 Crítico</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Título / Nombre de la Plaga</label>
          <input type="text" class="form-input" id="pest-title" placeholder="Ej: Gorgojo de los Andes" required>
        </div>
        <div class="form-group">
          <label class="form-label">Descripción / Notas de Campo</label>
          <textarea class="form-textarea" id="pest-description" placeholder="Describe los síntomas observados, extensión del daño, recomendación inicial..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">URL de Foto (opcional)</label>
          <input type="url" class="form-input" id="pest-photo" placeholder="https://...">
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">🐛 Registrar Marcador de Plaga</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleCreatePestMarker(e) {
  e.preventDefault();
  const result = await api.createPestMarker({
    lat: parseFloat(document.getElementById('pest-lat').value),
    lng: parseFloat(document.getElementById('pest-lng').value),
    pest_type: document.getElementById('pest-type').value,
    severity: document.getElementById('pest-severity').value,
    title: document.getElementById('pest-title').value,
    description: document.getElementById('pest-description').value,
    photo_url: document.getElementById('pest-photo').value || null
  });

  if (result.success) {
    document.getElementById('pest-modal')?.remove();
    showToast('Marcador de plaga registrado', 'success');
    navigateTo('/advisor/parcels');
  } else {
    showToast(result.error || 'Error al registrar', 'error');
  }
}

async function resolveMarker(markerId) {
  if (!confirm('¿Marcar esta plaga como resuelta?')) return;
  const result = await api.resolvePestMarker(markerId);
  if (result.success) {
    showToast('Plaga marcada como resuelta', 'success');
    navigateTo('/advisor/parcels');
  } else {
    showToast(result.error || 'Error', 'error');
  }
}

function showRecommendationModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'rec-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>📋 Nueva Recomendación Técnica</h3>
        <button class="modal-close" onclick="document.getElementById('rec-modal').remove()">✕</button>
      </div>
      <form onsubmit="handleCreateRecommendation(event)">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Categoría</label>
            <select class="form-select" id="rec-category" required>
              <option value="plagas">🐛 Plagas</option>
              <option value="fertilizacion">🌿 Fertilización</option>
              <option value="riego">💧 Riego</option>
              <option value="cosecha">🧺 Cosecha</option>
              <option value="rotacion">🔄 Rotación de Cultivos</option>
              <option value="general">📋 General</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Prioridad</label>
            <select class="form-select" id="rec-priority">
              <option value="baja">🟢 Baja</option>
              <option value="normal" selected>🔵 Normal</option>
              <option value="alta">🟠 Alta</option>
              <option value="urgente">🔴 Urgente</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Título</label>
          <input type="text" class="form-input" id="rec-title" placeholder="Ej: Aplicar aporque antes de la helada" required>
        </div>
        <div class="form-group">
          <label class="form-label">Recomendación Detallada</label>
          <textarea class="form-textarea" id="rec-recommendation" rows="4" placeholder="Describe la recomendación técnica..." required></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">📋 Emitir Recomendación</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleCreateRecommendation(e) {
  e.preventDefault();
  const result = await api.createRecommendation({
    category: document.getElementById('rec-category').value,
    priority: document.getElementById('rec-priority').value,
    title: document.getElementById('rec-title').value,
    recommendation: document.getElementById('rec-recommendation').value
  });

  if (result.success) {
    document.getElementById('rec-modal')?.remove();
    showToast('Recomendación emitida', 'success');
    navigateTo('/advisor/recommendations');
  } else {
    showToast(result.error || 'Error', 'error');
  }
}
