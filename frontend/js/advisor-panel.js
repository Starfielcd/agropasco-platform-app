/**
 * AgroPasco — Panel del Asesor Técnico
 * Parcelas por región (agrupadas por provincia), marcadores de plagas y recomendaciones
 */

let advisorMap = null;
let advisorParcelsData = [];
let highlightedParcelLayer = null;

async function renderAdvisorParcelsPage() {
  const [parcelsRes, markersRes] = await Promise.all([
    api.getParcels(),
    api.getPestMarkers()
  ]);

  const parcels = parcelsRes.data || [];
  advisorParcelsData = parcels;
  const markers = markersRes.data || [];
  const unresolvedMarkers = markers.filter(m => !m.resolved);

  // Clasificar parcelas en las 3 provincias oficiales de Pasco
  const provinceGroups = {
    'Provincia Daniel Alcides Carrión': [],
    'Provincia de Pasco': [],
    'Provincia de Oxapampa': []
  };

  parcels.forEach(p => {
    const loc = ((p.farmer_location || '') + ' ' + (p.name || '') + ' ' + (p.notes || '')).toLowerCase();

    if (loc.includes('yanahuanca') || loc.includes('chacayan') || loc.includes('chacayán') ||
        loc.includes('tapuc') || loc.includes('paucar') || loc.includes('vilcabamba') ||
        loc.includes('tusi') || loc.includes('goyllarisquizga') || loc.includes('carrión') || loc.includes('carrion')) {
      provinceGroups['Provincia Daniel Alcides Carrión'].push(p);
    } else if (loc.includes('oxapampa') || loc.includes('villa rica') || loc.includes('chontabamba') ||
               loc.includes('huancabamba') || loc.includes('pozuzo') || loc.includes('bermudez') ||
               loc.includes('bermúdez') || loc.includes('constitucion') || loc.includes('constitución') || loc.includes('palcazu')) {
      provinceGroups['Provincia de Oxapampa'].push(p);
    } else {
      // Provincia de Pasco (Cerro de Pasco, Chaupimarca, Yanacancha, Tinyahuarco, Ninacaca, Huayllay, Vicco, Paucartambo...)
      provinceGroups['Provincia de Pasco'].push(p);
    }
  });

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">🗺️ Parcelas en la Región Pasco</h3>
          <p class="text-sm text-muted">Monitoreo territorial agrupado por provincias: Daniel A. Carrión, Pasco y Oxapampa.</p>
        </div>
        <button class="btn btn-primary" onclick="showPestMarkerModal()">🐛 + Reportar Plaga</button>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">🗺️</div>
          <div class="stat-card-value">${parcels.length}</div>
          <div class="stat-card-label">Parcelas Registradas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">🐛</div>
          <div class="stat-card-value">${unresolvedMarkers.length}</div>
          <div class="stat-card-label">Alertas de Plagas Activas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">🏔️</div>
          <div class="stat-card-value">${Object.values(provinceGroups).filter(list => list.length > 0).length} / 3</div>
          <div class="stat-card-label">Provincias con Cultivos</div>
        </div>
      </div>

      <!-- Ficha Técnica Flotante de Parcela Seleccionada -->
      <div id="selected-parcel-detail" class="card mb-lg" style="display: none; border-left: 5px solid #22c55e; background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(15, 23, 42, 0.95));">
        <!-- Contenido inyectado dinámicamente al hacer clic en una parcela -->
      </div>

      <!-- Mapa Satelital de la Región -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden; border: 1.5px solid var(--border);">
        <div style="padding: 12px 18px; background: rgba(15, 23, 42, 0.95); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border);">
          <strong style="color: #ffffff; font-size: 14px;">🛰️ Vista Satelital de Polígonos de Parcelas</strong>
          <span class="badge badge-green">3 Provincias de Pasco</span>
        </div>
        <div id="advisor-map" class="map-container" style="height: 480px; width: 100%;"></div>
      </div>

      <!-- PARCELAS AGRUPADAS POR PROVINCIA -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">📍</span>
            <span>Parcelas por Provincia (${parcels.length} registradas)</span>
          </div>
          <span class="text-sm text-muted">Selecciona una provincia para desplegar sus parcelas</span>
        </div>

        <div style="display: grid; gap: 14px;">
          ${Object.entries(provinceGroups).map(([province, pList], idx) => {
            const icons = {
              'Provincia Daniel Alcides Carrión': '🏔️',
              'Provincia de Pasco': '⛏️',
              'Provincia de Oxapampa': '☕'
            };
            const openDefault = idx === 0 || pList.length > 0;

            return `
              <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
                <button class="btn btn-secondary btn-block" style="text-align: left; font-weight: 700; font-size: 15px; padding: 14px 18px; border-radius: 0; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04);"
                  onclick="toggleProvinceAccordion(this)">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 20px;">${icons[province] || '📍'}</span>
                    <span>${province}</span>
                    <span class="badge badge-${pList.length > 0 ? 'green' : 'blue'}" style="font-size: 11px;">
                      ${pList.length} parcelas
                    </span>
                  </div>
                  <span style="font-size: 14px; color: var(--text-muted);">${openDefault ? '▲' : '▼'}</span>
                </button>

                <div class="province-parcels" style="display: ${openDefault ? 'block' : 'none'}; padding: 14px; background: rgba(0,0,0,0.2);">
                  ${pList.length > 0 ? `
                    <div class="grid-3" style="gap: 12px;">
                      ${pList.map(p => `
                        <div class="alert-card info" style="margin-bottom: 0; cursor: pointer; transition: all 0.2s;"
                             onclick="inspectParcelOnMap(${p.id})">
                          <span class="alert-icon">🗺️</span>
                          <div class="alert-content" style="flex: 1;">
                            <div class="alert-title" style="font-size: 15px; font-weight: 700; color: #ffffff;">
                              ${p.name}
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px; font-size: 12.5px;">
                              <div>🌱 <strong>Producto:</strong> <span style="color: #4ade80;">${p.crop_type || 'Sin cultivo'}</span></div>
                              <div>🏔️ <strong>Altitud:</strong> <span style="color: #38bdf8;">${p.altitude_masl || 4380} msnm</span></div>
                              <div>👨‍🌾 <strong>Dueño:</strong> <span>${p.farmer_name || 'Agricultor'}</span></div>
                              <div>📐 <strong>Área:</strong> <span>${p.area_hectares || 0} ha</span></div>
                            </div>
                            <button class="btn btn-sm btn-primary" style="margin-top: 10px; width: 100%;" onclick="event.stopPropagation(); inspectParcelOnMap(${p.id})">
                              🔍 Ver Polígono en Mapa
                            </button>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
                      No hay parcelas registradas actualmente en esta provincia.
                    </div>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Marcadores de Plagas Georreferenciados -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🐛</span> Marcadores Georreferenciados de Plagas</div>
        </div>
        ${unresolvedMarkers.length > 0 ? `
          <div style="display: grid; gap: 12px;">
            ${unresolvedMarkers.slice(0, 10).map(m => `
              <div class="alert-card ${m.severity === 'critico' ? 'critical' : m.severity === 'grave' ? 'warning' : 'info'}">
                <span class="alert-icon">${{insecto:'🐛', hongo:'🍄', bacteria:'🦠', virus:'🧬', maleza:'🌿', nematodo:'🪱', otro:'⚠️'}[m.pest_type] || '⚠️'}</span>
                <div class="alert-content">
                  <div class="alert-title">${m.title} ${m.parcel_name ? '— ' + m.parcel_name : ''}</div>
                  <div class="alert-message">${m.description || ''}</div>
                  <div style="display: flex; gap: 8px; margin-top: 8px; align-items: center; flex-wrap: wrap;">
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
            <div class="empty-state-title">Sin plagas activas en el mapa</div>
            <div class="empty-state-text">Todas las zonas se encuentran libres de focos críticos.</div>
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
    const arrow = btn.querySelector('span:last-child');
    if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
  }
}

// Al hacer clic en una parcela: mostrar el gráfico dibujado con datos: producto sembrado, altitud, agricultor dueño, área y ubicación
async function inspectParcelOnMap(parcelId) {
  const parcel = advisorParcelsData.find(p => p.id === parcelId);
  if (!parcel) return;

  const mapEl = document.getElementById('advisor-map');
  const detailEl = document.getElementById('selected-parcel-detail');

  // Mostrar Ficha Técnica de la Parcela con los 5 campos requeridos
  if (detailEl) {
    detailEl.style.display = 'block';
    detailEl.innerHTML = `
      <div class="flex items-center justify-between mb-sm">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">🗺️</span>
          <div>
            <h4 style="font-size: 17px; font-weight: 700; color: #ffffff; margin: 0;">${parcel.name}</h4>
            <span class="text-sm text-muted">Ficha Técnica Georreferenciada</span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('selected-parcel-detail').style.display='none'">✕</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px;">
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border-left: 3px solid #22c55e;">
          <div class="text-sm text-muted">🌾 Producto Sembrado</div>
          <div style="font-size: 15px; font-weight: 700; color: #4ade80; margin-top: 2px;">
            ${parcel.crop_type ? '🌱 ' + parcel.crop_type.toUpperCase() : 'Sin cultivo asignado'}
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border-left: 3px solid #38bdf8;">
          <div class="text-sm text-muted">🏔️ Altitud</div>
          <div style="font-size: 15px; font-weight: 700; color: #38bdf8; margin-top: 2px;">
            ${parcel.altitude_masl || 4380} msnm
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border-left: 3px solid #60a5fa;">
          <div class="text-sm text-muted">👨‍🌾 Agricultor Dueño</div>
          <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-top: 2px;">
            ${parcel.farmer_name || 'Agricultor de Pasco'}
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border-left: 3px solid #f59e0b;">
          <div class="text-sm text-muted">📐 Área Calculada</div>
          <div style="font-size: 15px; font-weight: 700; color: #fbbf24; margin-top: 2px;">
            ${parcel.area_hectares || 0} hectáreas
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border-left: 3px solid #a855f7; grid-column: span 2;">
          <div class="text-sm text-muted">📍 Ubicación Geográfica</div>
          <div style="font-size: 14px; font-weight: 600; color: #f1f5f9; margin-top: 2px;">
            ${parcel.farmer_location || parcel.notes || 'Región Pasco'} ${parcel.center_lat ? `(${parcel.center_lat.toFixed(4)}, ${parcel.center_lng.toFixed(4)})` : ''}
          </div>
        </div>
      </div>
    `;
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Foco en el mapa
  if (advisorMap) {
    if (highlightedParcelLayer) {
      advisorMap.map.removeLayer(highlightedParcelLayer);
      highlightedParcelLayer = null;
    }

    if (parcel.geo_json) {
      try {
        const geo = JSON.parse(parcel.geo_json);
        const coords = geo.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
        if (coords.length > 0) {
          highlightedParcelLayer = L.polygon(coords, {
            color: '#fbbf24',
            weight: 5,
            fillColor: '#22c55e',
            fillOpacity: 0.45
          }).addTo(advisorMap.map);

          highlightedParcelLayer.bindPopup(`
            <div style="font-family: Inter, sans-serif; min-width: 220px;">
              <strong style="font-size: 15px; color: #22c55e;">${parcel.name}</strong><br>
              🌱 <strong>Producto:</strong> ${parcel.crop_type || 'Sin cultivo'}<br>
              🏔️ <strong>Altitud:</strong> ${parcel.altitude_masl || 4380} msnm<br>
              👨‍🌾 <strong>Dueño:</strong> ${parcel.farmer_name || 'Agricultor'}<br>
              📐 <strong>Área:</strong> ${parcel.area_hectares} ha<br>
              📍 <strong>Ubicación:</strong> ${parcel.farmer_location || 'Pasco'}
            </div>
          `).openPopup();

          advisorMap.map.fitBounds(highlightedParcelLayer.getBounds(), { padding: [40, 40] });
        }
      } catch (e) {
        console.warn('Error al enfocar polígono:', e);
      }
    } else if (parcel.center_lat && parcel.center_lng) {
      advisorMap.setCenter(parcel.center_lat, parcel.center_lng, 16);
    }
  }

  showToast(`Parcela "${parcel.name}" enfocada en el mapa satelital`, 'success');
}

// Inicializar Mapa del Asesor
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

  // Dibujar todas las parcelas en mapa
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
              👨‍🌾 <strong>Dueño:</strong> ${p.farmer_name || 'Agricultor'}<br>
              🌱 <strong>Producto:</strong> ${p.crop_type || 'Sin cultivo'}<br>
              📐 <strong>Área:</strong> ${p.area_hectares} ha<br>
              🏔️ <strong>Altitud:</strong> ${p.altitude_masl || 4380} msnm<br>
              📍 <strong>Ubicación:</strong> ${p.farmer_location || 'Pasco'}
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

async function renderAdvisorRecommendationsPage() {
  const result = await api.getRecommendations();
  const recs = result.data || [];

  const categoryIcons = {
    plagas: '🐛',
    fertilizacion: '🌿',
    riego: '💧',
    cosecha: '🧺',
    rotacion: '🔄',
    general: '📋'
  };

  const priorityColors = {
    baja: 'green',
    normal: 'blue',
    alta: 'amber',
    urgente: 'red'
  };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">📋 Recomendaciones Técnicas Emitidas (${recs.length})</h3>
          <p class="text-sm text-muted">Directivas agronómicas y recomendaciones para agricultores de la Región Pasco.</p>
        </div>
        <button class="btn btn-primary btn-lg" onclick="showRecommendationModal()">
          + Nueva Recomendación Técnica
        </button>
      </div>

      ${recs.length > 0 ? `
        <div style="display: grid; gap: 14px;">
          ${recs.map(r => `
            <div class="card" style="border-left: 4px solid var(--${priorityColors[r.priority] || 'blue'}-500);">
              <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
                <div style="font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                  <span>${categoryIcons[r.category] || '📋'}</span>
                  <span>${r.title}</span>
                </div>
                <div style="display: flex; gap: 8px;">
                  <span class="badge badge-${priorityColors[r.priority] || 'blue'}" style="text-transform: capitalize;">
                    ${r.priority}
                  </span>
                  <span class="badge badge-purple" style="text-transform: capitalize;">
                    ${r.category}
                  </span>
                </div>
              </div>

              <div style="color: #cbd5e1; font-size: 14px; line-height: 1.5; margin: 8px 0;">
                ${r.recommendation}
              </div>

              <div style="display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px;">
                <span>👤 Emitido por: <strong>${r.advisor_name || 'Asesor Técnico'}</strong></span>
                ${r.created_at ? `<span>📅 Fecha: ${new Date(r.created_at).toLocaleDateString('es-PE')}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">No hay recomendaciones registradas</div>
          <div class="empty-state-text">Emite recomendaciones fitosanitarias o agronómicas para los agricultores.</div>
          <button class="btn btn-primary btn-lg" onclick="showRecommendationModal()">+ Nueva Recomendación Técnica</button>
        </div>
      `}
    </div>
  `;
}

