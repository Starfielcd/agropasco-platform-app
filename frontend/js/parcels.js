/**
 * AgroPasco — Módulo de Parcelas (Mapa del Agricultor)
 * Dibujo de polígonos, registro de parcelas y vista satelital
 */

let parcelMap = null;

async function renderParcelsPage() {
  const result = await api.getParcels();
  const parcels = result.data || [];

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🗺️ Mis Parcelas (${parcels.length})</h3>
          <p class="text-sm text-muted">Dibuja polígonos en el mapa satelital para delimitar tus parcelas.</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="relocateFarmer()" title="Detectar mi ubicación actual">
            📡 Mi Ubicación
          </button>
          <button class="btn btn-primary" onclick="toggleParcelDrawMode()">✏️ Dibujar Nueva Parcela</button>
        </div>
      </div>

      <!-- Banner de geolocalización -->
      <div id="geolocation-banner" class="card mb-lg" style="display: none; padding: 12px 16px; border-left: 4px solid #22c55e; background: rgba(34, 197, 94, 0.06);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="geo-pulse-marker" style="width: 16px; height: 16px;">
            <div class="geo-pulse-dot" style="width: 10px; height: 10px; border-width: 2px;"></div>
            <div class="geo-pulse-ring" style="width: 16px; height: 16px;"></div>
          </div>
          <div>
            <span id="geo-banner-text" style="font-size: 13px; font-weight: 600; color: var(--green-400);">Ubicación detectada</span>
            <span id="geo-banner-detail" class="text-sm text-muted" style="margin-left: 8px;"></span>
          </div>
        </div>
      </div>

      <!-- Mapa Principal con Leyenda de Severidad -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden; border: 1.5px solid var(--border);">
        <div style="padding: 10px 16px; background: rgba(15,23,42,0.95); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 8px;">
          <strong style="color: #ffffff; font-size: 13.5px;">🛰️ Mapa Interactivo de Parcelas Registradas</strong>
          <div style="display: flex; gap: 10px; align-items: center; font-size: 12px;">
            <span style="color: #4ade80;">🟢 Leve / Sano</span>
            <span style="color: #facc15;">🟡 Moderado</span>
            <span style="color: #f87171;">🔴 Grave / Catástrofe</span>
          </div>
        </div>
        <div id="parcel-map" class="map-container" style="height: 500px; width: 100%;"></div>
      </div>

      <!-- Formulario oculto para nueva parcela -->
      <div id="parcel-form-container" class="card mb-lg" style="display: none; border-left: 4px solid var(--green-500);">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🌱</span> Registrar Parcela Dibujada</div>
          <button class="btn btn-sm btn-secondary" onclick="cancelParcelDraw()">Cancelar</button>
        </div>
        <form onsubmit="handleCreateParcel(event)">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nombre de la Parcela</label>
              <input type="text" class="form-input" id="parcel-name" placeholder="Ej: Parcela Norte - Yanahuanca" required>
            </div>
            <div class="form-group">
              <label class="form-label">Cultivo Actual</label>
              <select class="form-select" id="parcel-crop-type">
                <option value="">Sin cultivo asignado</option>
                <option value="papa">🥔 Papa</option>
                <option value="maca">🌿 Maca</option>
                <option value="quinua">🌾 Quinua</option>
                <option value="habas">🫘 Habas</option>
                <option value="cafe">☕ Café</option>
                <option value="olluco">🟡 Olluco</option>
                <option value="cebada">🌾 Cebada</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Fecha de Siembra</label>
              <input type="date" class="form-input" id="parcel-planting-date">
            </div>
            <div class="form-group">
              <label class="form-label">Altitud (msnm)</label>
              <input type="number" class="form-input" id="parcel-altitude" value="4380">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Área Calculada</label>
              <input type="text" class="form-input" id="parcel-area-display" readonly style="background: var(--bg-glass);">
            </div>
            <div class="form-group">
              <label class="form-label">Ubicación (dirección)</label>
              <input type="text" class="form-input" id="parcel-address" readonly style="background: var(--bg-glass);">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notas</label>
            <textarea class="form-textarea" id="parcel-notes" placeholder="Observaciones sobre la parcela..."></textarea>
          </div>
          <div class="form-group" style="padding: 12px; border-radius: 8px; border: 1.5px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2);">
            ${AgroMediaUploader.render({
              id: 'parcel-photo',
              folder: 'parcels',
              label: 'Fotografía de la Parcela / Terreno — OBLIGATORIA *'
            })}
          </div>
          <input type="hidden" id="parcel-geojson">
          <input type="hidden" id="parcel-center-lat">
          <input type="hidden" id="parcel-center-lng">
          <input type="hidden" id="parcel-area-ha">
          <button type="submit" class="btn btn-primary btn-block btn-lg">🌾 Registrar Parcela con Fotografía</button>
        </form>
      </div>

      <!-- Lista de Parcelas -->
      ${parcels.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">📋</span> Parcelas Registradas</div>
          </div>
          <div class="grid-3">
            ${parcels.map(p => renderParcelCard(p)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderParcelCard(parcel) {
  const statusColors = { activa: 'green', en_descanso: 'amber', planificada: 'blue', cosechada: 'purple' };
  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡' };

  return `
    <div class="crop-card" onclick="viewParcelOnMap(${parcel.id})" style="cursor: pointer; position: relative;">
      <div class="crop-card-header">
        <div>
          <div class="crop-card-name">${parcel.name}</div>
          <div class="crop-card-type">${parcel.crop_type ? (cropIcons[parcel.crop_type] || '🌱') + ' ' + parcel.crop_type : '📍 Sin cultivo asignado'}</div>
        </div>
        <div class="crop-card-icon">🗺️</div>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 4px;">
        <span class="badge badge-${statusColors[parcel.status] || 'green'}">${parcel.status}</span>
        ${parcel.pest_severity ? `
          <span class="badge badge-${parcel.pest_severity === 'critico' || parcel.pest_severity === 'grave' ? 'red' : parcel.pest_severity === 'moderado' ? 'amber' : 'green'}" style="font-size: 11px;">
            ${parcel.pest_severity === 'critico' ? '🔴 Catástrofe' : parcel.pest_severity === 'grave' ? '🟠 Plaga Grave' : '🟡 Moderado'}: ${parcel.active_pest_name || ''}
          </span>
        ` : `
          <span class="badge badge-green" style="font-size: 11px;">🟢 Sano</span>
        `}
        ${parcel.planting_date ? `<span class="text-sm text-muted">📅 ${parcel.planting_date}</span>` : ''}
      </div>
      <div class="crop-card-stats">
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${parcel.area_hectares || 0} ha</div>
          <div class="crop-card-stat-label">Área</div>
        </div>
        <div class="crop-card-stat">
          <div class="crop-card-stat-value" style="color: var(--green-400);">🏔️ ${parcel.altitude_masl || 4380}</div>
          <div class="crop-card-stat-label">msnm</div>
        </div>
      </div>

      <!-- Acciones de Gestión de Parcela -->
      <div style="display: flex; gap: 8px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border);">
        <button class="btn btn-sm btn-secondary" style="flex: 1;" onclick="event.stopPropagation(); showEditParcelModal(${parcel.id})">
          ✏️ Editar
        </button>
        <button class="btn btn-sm btn-danger" style="flex: 0.5;" onclick="event.stopPropagation(); handleDeleteParcel(${parcel.id}, '${parcel.name.replace(/'/g, "\\'")}')">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// Inicializa mapa después de render
function initParcelMap() {
  if (parcelMap) { parcelMap.destroy(); parcelMap = null; }

  const container = document.getElementById('parcel-map');
  if (!container) return;

  parcelMap = new AgroMap('parcel-map', {
    satellite: true,
    drawEnabled: false,
    autoLocate: true,
    onLocationFound: handleFarmerLocationDetected,
    onPolygonCreated: handlePolygonCreated
  }).init();

  // Cargar parcelas existentes
  loadParcelsOnMap();
}

/**
 * Callback: Se ejecuta cuando la Geolocation API detecta la ubicación del agricultor.
 * Auto-rellena la altitud y coordenadas en el formulario de parcela.
 */
function handleFarmerLocationDetected(location) {
  // Guardar ubicación del agricultor para uso posterior
  window._farmerDetectedLocation = location;

  // Mostrar banner de geolocalización
  const banner = document.getElementById('geolocation-banner');
  const bannerText = document.getElementById('geo-banner-text');
  const bannerDetail = document.getElementById('geo-banner-detail');
  if (banner) {
    banner.style.display = 'block';
    if (bannerText) bannerText.textContent = `📍 Ubicación detectada`;
    if (bannerDetail) {
      bannerDetail.textContent = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` +
        (location.altitude != null ? ` · 🏔️ ${location.altitude} msnm` : '') +
        (location.accuracy ? ` · Precisión: ~${Math.round(location.accuracy)}m` : '');
    }
  }

  // Si el formulario de parcela está visible, pre-rellenar altitud
  const altField = document.getElementById('parcel-altitude');
  if (altField && location.altitude != null) {
    altField.value = location.altitude;
  }

  // También pre-rellenar en el formulario de cultivos si existe
  const cropAltField = document.getElementById('crop-altitude');
  if (cropAltField && location.altitude != null) {
    cropAltField.value = location.altitude;
    const badge = document.getElementById('altitude-source-badge');
    if (badge) badge.textContent = `📡 GPS: ${location.altitude} msnm`;
  }
}

/**
 * Botón "Mi Ubicación": Re-dispara la geolocalización del navegador
 * y centra el mapa en la posición actual del agricultor.
 */
function relocateFarmer() {
  if (parcelMap) {
    parcelMap.locateUser();
  } else {
    showToast('Inicializando mapa...', 'info');
    initParcelMap();
  }
}

async function loadParcelsOnMap() {
  if (!parcelMap) return;

  const result = await api.getParcels();
  const parcels = result.data || [];

  parcelMap.clearLayer('parcels');

  parcels.forEach(p => {
    try {
      const geoJson = JSON.parse(p.geo_json);
      const coords = geoJson.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
      if (coords.length > 0) {
        // Semáforo de severidad fitosanitaria
        let color = '#22c55e'; // 🟢 Leve / Sano
        let fillOpacity = 0.25;
        let weight = 2;

        if (p.pest_severity === 'critico' || p.pest_severity === 'grave') {
          color = '#ef4444'; // 🔴 Grave / Catástrofe
          fillOpacity = 0.45;
          weight = 4;
        } else if (p.pest_severity === 'moderado') {
          color = '#eab308'; // 🟡 Moderado
          fillOpacity = 0.35;
          weight = 3;
        }

        parcelMap.addPolygon(coords, {
          color: color,
          weight: weight,
          fillColor: color,
          fillOpacity: fillOpacity,
          tooltip: `${p.name}${p.crop_type ? ' — ' + p.crop_type : ''} ${p.pest_severity ? '(' + p.pest_severity.toUpperCase() + ')' : ''}`,
          popup: `
            <div style="font-family: Inter, sans-serif; min-width: 220px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <strong style="font-size: 14px; color: ${color};">${p.name}</strong>
                <span class="badge badge-${color === '#ef4444' ? 'red' : color === '#eab308' ? 'amber' : 'green'}" style="font-size: 10px;">
                  ${p.pest_severity ? (p.pest_severity === 'critico' ? '🔴 Catástrofe' : p.pest_severity === 'grave' ? '🟠 Grave' : '🟡 Moderado') : '🟢 Sano'}
                </span>
              </div>

              ${p.active_pest_name ? `
                <div style="background: rgba(239,68,68,0.12); border-left: 3px solid ${color}; padding: 6px 8px; border-radius: 4px; margin: 6px 0;">
                  <strong style="font-size: 12px; color: ${color};">🐛 Plaga: ${p.active_pest_name}</strong>
                  ${p.active_pest_photo ? `
                    <div style="margin-top: 6px; text-align: center;">
                      <img src="${p.active_pest_photo}" style="max-height: 80px; max-width: 100%; border-radius: 4px; object-fit: cover; cursor: pointer;"
                           onclick="AgroMediaUploader.previewEnlarged('${p.active_pest_photo}', 'Plaga en ${p.name}')" title="Clic para ampliar">
                    </div>
                  ` : ''}
                </div>
              ` : ''}

              <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">
                ${p.crop_type ? '🌱 Cultivo: <strong>' + p.crop_type + '</strong><br>' : '📍 Sin cultivo<br>'}
                📐 Área: <strong>${p.area_hectares} ha</strong><br>
                🏔️ Altitud: <strong style="color: #4ade80;">${p.altitude_masl || 4380} msnm</strong><br>
                <em>Estado: ${p.status}</em>
              </div>

              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.15); display: flex; gap: 6px;">
                <button class="btn btn-sm btn-primary" style="flex: 1;" onclick="showEditParcelModal(${p.id})">
                  ✏️ Editar
                </button>
                <a href="#/pest-reports" class="btn btn-sm btn-secondary" style="font-size: 11px;">
                  🐛 Plagas
                </a>
              </div>
            </div>
          `
        });
      }
    } catch (e) {
      console.warn('Error al parsear GeoJSON de parcela', p.id, e);
    }
  });

  if (parcels.length > 0) {
    parcelMap.fitToParcels();
  }
}

let drawModeActive = false;

function toggleParcelDrawMode() {
  if (!parcelMap) {
    initParcelMap();
    setTimeout(toggleParcelDrawMode, 500);
    return;
  }

  drawModeActive = !drawModeActive;

  if (drawModeActive) {
    parcelMap.enableDraw();
    showToast('Dibuja un polígono en el mapa para delimitar tu parcela', 'info');
  }
}

function cancelParcelDraw() {
  drawModeActive = false;
  document.getElementById('parcel-form-container').style.display = 'none';
  if (parcelMap?.drawnItems) {
    parcelMap.drawnItems.clearLayers();
  }
}

async function handlePolygonCreated(data) {
  // Mostrar formulario
  document.getElementById('parcel-form-container').style.display = 'block';
  document.getElementById('parcel-form-container').scrollIntoView({ behavior: 'smooth' });

  // Llenar datos calculados
  document.getElementById('parcel-area-display').value = `${data.areaHectares} hectáreas`;
  document.getElementById('parcel-area-ha').value = data.areaHectares;
  document.getElementById('parcel-geojson').value = JSON.stringify(data.geoJSON);

  // Calcular centro del polígono
  const coords = data.coordinates;
  const centerLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const centerLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  document.getElementById('parcel-center-lat').value = centerLat;
  document.getElementById('parcel-center-lng').value = centerLng;

  // Obtener altitud automáticamente desde Open-Meteo Elevation API
  const altField = document.getElementById('parcel-altitude');
  altField.value = '';
  altField.placeholder = '⏳ Calculando altitud satelital...';

  try {
    const elevation = await AgroMap.getElevation(centerLat, centerLng);
    const finalAlt = elevation != null ? elevation : 4380;
    altField.value = finalAlt;
    altField.placeholder = 'Altitud (msnm)';
    showToast(`✅ Polígono delimitado: ${data.areaHectares} ha. Altitud calculada automáticamente: ${finalAlt} msnm`, 'success');
  } catch (e) {
    altField.value = 4380;
    altField.placeholder = 'Altitud (msnm)';
  }

  // Geocodificación inversa
  try {
    const geoResult = await GeocodingService.reverseGeocode(centerLat, centerLng);
    if (geoResult.success) {
      document.getElementById('parcel-address').value = geoResult.address;
    }
  } catch (e) {
    document.getElementById('parcel-address').value = `${centerLat.toFixed(4)}, ${centerLng.toFixed(4)} (Pasco)`;
  }
}

async function handleCreateParcel(e) {
  e.preventDefault();

  const photoUrl = document.getElementById('parcel-photo-value')?.value;
  if (!photoUrl || photoUrl.trim() === '') {
    showToast('⚠️ La fotografía de la parcela o del terreno es obligatoria.', 'error');
    return;
  }

  const geoJson = document.getElementById('parcel-geojson').value;
  if (!geoJson) {
    showToast('Primero dibuja un polígono en el mapa', 'warning');
    return;
  }

  const result = await api.createParcel({
    name: document.getElementById('parcel-name').value,
    geo_json: geoJson,
    area_hectares: parseFloat(document.getElementById('parcel-area-ha').value) || 0,
    center_lat: parseFloat(document.getElementById('parcel-center-lat').value) || null,
    center_lng: parseFloat(document.getElementById('parcel-center-lng').value) || null,
    crop_type: document.getElementById('parcel-crop-type').value || null,
    planting_date: document.getElementById('parcel-planting-date').value || null,
    altitude_masl: parseInt(document.getElementById('parcel-altitude').value) || 4380,
    notes: document.getElementById('parcel-notes').value || null,
    photo_url: photoUrl.trim()
  });

  if (result.success) {
    showToast('¡Parcela registrada exitosamente con fotografía y altitud!', 'success');
    cancelParcelDraw();
    navigateTo('/parcels');
  } else {
    showToast(result.error || 'Error al registrar parcela', 'error');
  }
}

// ===== MODAL DE EDICIÓN DE PARCELAS =====
async function showEditParcelModal(parcelId) {
  const result = await api.getParcel(parcelId);
  if (!result.success) {
    showToast('Error al cargar datos de la parcela', 'error');
    return;
  }

  const p = result.data;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'edit-parcel-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 600px;">
      <div class="modal-header">
        <h3>✏️ Editar Parcela: ${p.name}</h3>
        <button class="modal-close" onclick="document.getElementById('edit-parcel-modal').remove()">✕</button>
      </div>

      <form onsubmit="handleUpdateParcel(event, ${p.id})">
        <div class="form-group">
          <label class="form-label">Nombre de la Parcela</label>
          <input type="text" class="form-input" id="edit-parcel-name" value="${p.name || ''}" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Cultivo Asignado</label>
            <select class="form-select" id="edit-parcel-crop">
              <option value="" ${!p.crop_type ? 'selected' : ''}>Sin cultivo asignado</option>
              <option value="papa" ${p.crop_type === 'papa' ? 'selected' : ''}>🥔 Papa</option>
              <option value="maca" ${p.crop_type === 'maca' ? 'selected' : ''}>🌿 Maca</option>
              <option value="quinua" ${p.crop_type === 'quinua' ? 'selected' : ''}>🌾 Quinua</option>
              <option value="habas" ${p.crop_type === 'habas' ? 'selected' : ''}>🫘 Habas</option>
              <option value="cafe" ${p.crop_type === 'cafe' ? 'selected' : ''}>☕ Café</option>
              <option value="olluco" ${p.crop_type === 'olluco' ? 'selected' : ''}>🟡 Olluco</option>
              <option value="cebada" ${p.crop_type === 'cebada' ? 'selected' : ''}>🌾 Cebada</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Estado de la Parcela</label>
            <select class="form-select" id="edit-parcel-status">
              <option value="activa" ${p.status === 'activa' ? 'selected' : ''}>✅ Activa</option>
              <option value="en_descanso" ${p.status === 'en_descanso' ? 'selected' : ''}>🟡 En Descanso</option>
              <option value="planificada" ${p.status === 'planificada' ? 'selected' : ''}>📝 Planificada</option>
              <option value="cosechada" ${p.status === 'cosechada' ? 'selected' : ''}>🧺 Cosechada</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Área (hectáreas)</label>
            <input type="number" class="form-input" id="edit-parcel-area" step="0.01" value="${p.area_hectares || 0}" required>
          </div>
          <div class="form-group">
            <label class="form-label">
              Altitud (msnm)
              ${p.center_lat && p.center_lng ? `
                <button type="button" class="btn btn-sm btn-secondary" style="padding: 2px 8px; font-size: 11px; margin-left: 6px;" onclick="recalcParcelElevation(${p.center_lat}, ${p.center_lng})">
                  🔄 Satelital
                </button>
              ` : ''}
            </label>
            <input type="number" class="form-input" id="edit-parcel-altitude" value="${p.altitude_masl || 4380}" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fecha de Siembra</label>
            <input type="date" class="form-input" id="edit-parcel-planting-date" value="${p.planting_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Coordenadas del Centro</label>
            <input type="text" class="form-input" readonly style="background: var(--bg-glass);" value="${p.center_lat ? `${p.center_lat.toFixed(4)}, ${p.center_lng.toFixed(4)}` : 'No registradas'}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Notas / Observaciones</label>
          <textarea class="form-textarea" id="edit-parcel-notes" rows="3" placeholder="Observaciones de suelo, acceso a riego o ubicación...">${p.notes || ''}</textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button type="submit" class="btn btn-primary btn-lg" style="flex: 1;">
            💾 Guardar Cambios
          </button>
          <button type="button" class="btn btn-secondary btn-lg" onclick="document.getElementById('edit-parcel-modal').remove()">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function recalcParcelElevation(lat, lng) {
  const altInput = document.getElementById('edit-parcel-altitude');
  if (!altInput) return;
  altInput.value = '';
  altInput.placeholder = '⏳ Calculando...';

  try {
    const elevation = await AgroMap.getElevation(lat, lng);
    if (elevation != null) {
      altInput.value = elevation;
      showToast(`Altitud satelital recalculada: ${elevation} msnm`, 'success');
    } else {
      altInput.value = 4380;
    }
  } catch (e) {
    altInput.value = 4380;
  }
}

async function handleUpdateParcel(e, parcelId) {
  e.preventDefault();

  const result = await api.updateParcel(parcelId, {
    name: document.getElementById('edit-parcel-name').value,
    crop_type: document.getElementById('edit-parcel-crop').value || null,
    status: document.getElementById('edit-parcel-status').value,
    area_hectares: parseFloat(document.getElementById('edit-parcel-area').value) || 0,
    altitude_masl: parseInt(document.getElementById('edit-parcel-altitude').value) || 4380,
    planting_date: document.getElementById('edit-parcel-planting-date').value || null,
    notes: document.getElementById('edit-parcel-notes').value || null
  });

  if (result.success) {
    document.getElementById('edit-parcel-modal')?.remove();
    showToast('¡Parcela actualizada exitosamente!', 'success');
    navigateTo('/parcels');
  } else {
    showToast(result.error || 'Error al actualizar parcela', 'error');
  }
}

async function handleDeleteParcel(parcelId, parcelName) {
  if (!confirm(`¿Estás seguro de eliminar la parcela "${parcelName}"? Esta acción no se puede deshacer.`)) {
    return;
  }

  const result = await api.deleteParcel(parcelId);
  if (result.success) {
    showToast(`Parcela "${parcelName}" eliminada correctamente`, 'warning');
    navigateTo('/parcels');
  } else {
    showToast(result.error || 'Error al eliminar parcela', 'error');
  }
}

function viewParcelOnMap(parcelId) {
  const mapEl = document.getElementById('parcel-map');
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: 'smooth' });
  }
}
