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
        <button class="btn btn-primary" onclick="toggleParcelDrawMode()">✏️ Dibujar Nueva Parcela</button>
      </div>

      <!-- Mapa Principal -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden;">
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
          <input type="hidden" id="parcel-geojson">
          <input type="hidden" id="parcel-center-lat">
          <input type="hidden" id="parcel-center-lng">
          <input type="hidden" id="parcel-area-ha">
          <button type="submit" class="btn btn-primary btn-block btn-lg">🌾 Registrar Parcela</button>
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
    <div class="crop-card" onclick="viewParcelOnMap(${parcel.id})" style="cursor: pointer;">
      <div class="crop-card-header">
        <div>
          <div class="crop-card-name">${parcel.name}</div>
          <div class="crop-card-type">${parcel.crop_type ? (cropIcons[parcel.crop_type] || '🌱') + ' ' + parcel.crop_type : '📍 Sin cultivo'}</div>
        </div>
        <div class="crop-card-icon">🗺️</div>
      </div>
      <div>
        <span class="badge badge-${statusColors[parcel.status] || 'green'}">${parcel.status}</span>
      </div>
      <div class="crop-card-stats">
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${parcel.area_hectares || 0} ha</div>
          <div class="crop-card-stat-label">Área</div>
        </div>
        <div class="crop-card-stat">
          <div class="crop-card-stat-value">${parcel.altitude_masl || 4380}</div>
          <div class="crop-card-stat-label">msnm</div>
        </div>
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
    onPolygonCreated: handlePolygonCreated
  }).init();

  // Cargar parcelas existentes
  loadParcelsOnMap();
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
        const color = MapsConfig.getPolygonColor(p.status === 'activa' ? (p.crop_type ? 'sembrado' : 'planificado') : 'default');
        parcelMap.addPolygon(coords, {
          color: color,
          tooltip: `${p.name}${p.crop_type ? ' — ' + p.crop_type : ''}`,
          popup: `
            <div style="font-family: Inter, sans-serif;">
              <strong>${p.name}</strong><br>
              ${p.crop_type ? '🌱 ' + p.crop_type + '<br>' : ''}
              📐 ${p.area_hectares} ha<br>
              🏔️ ${p.altitude_masl} msnm<br>
              <em>${p.status}</em>
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

  // Geocodificación inversa
  try {
    const geoResult = await GeocodingService.reverseGeocode(centerLat, centerLng);
    if (geoResult.success) {
      document.getElementById('parcel-address').value = geoResult.address;
    }
  } catch (e) {
    document.getElementById('parcel-address').value = `${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`;
  }

  showToast(`Parcela de ${data.areaHectares} ha dibujada. Completa el formulario.`, 'success');
}

async function handleCreateParcel(e) {
  e.preventDefault();

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
    notes: document.getElementById('parcel-notes').value || null
  });

  if (result.success) {
    showToast('¡Parcela registrada exitosamente!', 'success');
    cancelParcelDraw();
    navigateTo('/parcels');
  } else {
    showToast(result.error || 'Error al registrar parcela', 'error');
  }
}

function viewParcelOnMap(parcelId) {
  // Scroll al mapa y centrar en la parcela
  const mapEl = document.getElementById('parcel-map');
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: 'smooth' });
  }
}

// Auto-init del mapa cuando se renderiza la página
const _origHashListener = window.addEventListener('hashchange', () => {
  if (window.location.hash === '#/parcels' && document.getElementById('parcel-map')) {
    setTimeout(initParcelMap, 300);
  }
});
