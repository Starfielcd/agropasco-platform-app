/**
 * AgroPasco — Módulo de Gestión de Cultivos
 */

async function renderCropsPage() {
  const user = getUser();
  const result = await api.getCrops();
  const crops = result.data || [];

  const isSupervisor = user?.role === 'admin' || user?.role === 'advisor';
  const pageTitle = isSupervisor ? `Cultivos de la Región Pasco (${crops.length})` : `Mis Cultivos (${crops.length})`;
  const pageSubtitle = isSupervisor ? 'Supervisa y monitorea los cultivos registrados en las provincias de Pasco.' : 'Gestiona tus cultivos y registra actividades de cuidado.';

  // Auto-abrir modal si la URL solicita nuevo cultivo
  if (window.location.hash.includes('action=new') || window.location.hash.includes('new=true')) {
    setTimeout(() => {
      if (!document.getElementById('crop-modal')) {
        showNewCropModal();
      }
    }, 150);
  }

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">${pageTitle}</h3>
          <p class="text-sm text-muted">${pageSubtitle}</p>
        </div>
        <button type="button" class="btn btn-primary" onclick="event.preventDefault(); event.stopPropagation(); showNewCropModal(event); return false;">+ Registrar Cultivo</button>
      </div>

      ${crops.length > 0 ? `
        <div class="grid-3">
          ${crops.map(crop => renderCropCard(crop)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">🌱</div>
          <div class="empty-state-title">No hay cultivos registrados</div>
          <div class="empty-state-text">Registra tu primer cultivo para comenzar con la asesoría personalizada y trazabilidad digital.</div>
          <button type="button" class="btn btn-primary btn-lg" onclick="event.preventDefault(); event.stopPropagation(); showNewCropModal(event); return false;">⚡ Registrar cultivo ahora</button>
        </div>
      `}
    </div>
  `;
}

async function renderCropDetail(cropId) {
  const result = await api.getCrop(cropId);
  if (!result.success) return `<div class="page-content"><div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">Cultivo no encontrado</div></div></div>`;

  const crop = result.data;
  const logs = crop.logs || [];
  const icons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡', mashua: '🟠' };

  // Get AI recommendations
  let recommendations = [];
  try {
    const aiRes = await api.getRecommendationsAI(cropId);
    if (aiRes.success) recommendations = aiRes.data.recommendations || [];
  } catch(e) {}

  return `
    <div class="page-content">
      <div class="flex items-center gap-md mb-lg">
        <a href="#/crops" class="btn btn-secondary btn-sm">← Volver</a>
        <div style="flex: 1;">
          <h3 style="font-size: 20px; font-weight: 700;">${icons[crop.crop_type] || '🌱'} ${crop.name}</h3>
          <p class="text-sm text-muted">${crop.crop_type}${crop.variety ? ' — ' + crop.variety : ''} | ${crop.area_hectares || 0} ha | ${crop.altitude_masl || 4380} msnm</p>
        </div>
        <span class="badge badge-green" style="font-size: 14px; padding: 6px 16px;">${crop.status}</span>
      </div>

      <div class="grid-2">
        <!-- Crop Info + Actions -->
        <div>
          <div class="card mb-md">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">📋</span> Información del Cultivo</div>
              <button class="btn btn-sm btn-danger" onclick="confirmDeleteCrop(${crop.id})">Eliminar</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              ${[
                ['Tipo', crop.crop_type],
                ['Variedad', crop.variety || 'No especificada'],
                ['Área', `${crop.area_hectares || 0} hectáreas`],
                ['Fecha de Siembra', crop.planting_date || 'No registrada'],
                ['Altitud', `${crop.altitude_masl || 4380} msnm`],
                ['Ubicación', crop.location_detail || 'No especificada'],
                ['Estado Actual', crop.status],
                ['Registros', `${logs.length} actividades`]
              ].map(([label, value]) => `
                <div style="padding: 10px; background: var(--bg-glass); border-radius: 6px;">
                  <div class="text-sm text-muted">${label}</div>
                  <div style="font-weight: 600; margin-top: 2px;">${value}</div>
                </div>
              `).join('')}
            </div>

            <!-- Quick Status Change -->
            <div style="margin-top: 16px; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm);">
              <label class="form-label">Actualizar Etapa Fenológica:</label>
              <div class="flex gap-sm mt-sm" style="flex-wrap: wrap;">
                ${['sembrado', 'crecimiento', 'floracion', 'maduracion', 'cosechado'].map(st => `
                  <button class="btn btn-sm ${crop.status === st ? 'btn-primary' : 'btn-secondary'}" onclick="updateCropStatus(${crop.id}, '${st}')">
                    ${{sembrado:'🌱 Siembra', crecimiento:'🌿 Crecimiento', floracion:'🌸 Floración', maduracion:'🟡 Maduración', cosechado:'🧺 Cosechado'}[st] || st}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Phenological Advice Card -->
          <div class="card mb-md" style="border-left: 4px solid var(--blue-400);">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">🧬</span> Recomendación Técnica de la Etapa (${crop.status.toUpperCase()})</div>
            </div>
            ${getPhenologicalAdvice(crop.crop_type, crop.status)}
          </div>

          <!-- Add Activity -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">📝</span> Registrar Actividad</div>
            </div>
            <form onsubmit="handleAddLog(event, ${crop.id})">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Tipo de Actividad</label>
                  <select class="form-select" id="log-action" required>
                    <option value="riego">💧 Riego</option>
                    <option value="fertilizacion">🌿 Fertilización</option>
                    <option value="fumigacion">🧴 Fumigación</option>
                    <option value="aporque">🏔️ Aporque</option>
                    <option value="poda">✂️ Poda</option>
                    <option value="inspeccion">🔍 Inspección</option>
                    <option value="cosecha">🧺 Cosecha</option>
                    <option value="otro">📋 Otro</option>
                  </select>
                </div>
                <div class="form-group" style="align-self: end;">
                  <button type="submit" class="btn btn-primary btn-block">Registrar</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Descripción</label>
                <textarea class="form-textarea" id="log-description" placeholder="Describe la actividad realizada..." required></textarea>
              </div>
            </form>
          </div>
        </div>

        <!-- Timeline + AI Recommendations -->
        <div>
          ${recommendations.length > 0 ? `
            <div class="card mb-md">
              <div class="card-header">
                <div class="card-title"><span class="card-title-icon">🤖</span> Recomendaciones IA</div>
                <span class="badge badge-purple">AI</span>
              </div>
              ${recommendations.slice(0, 3).map(rec => `
                <div class="alert-card ${rec.severity === 'critical' ? 'critical' : rec.severity === 'high' ? 'warning' : 'info'}" style="margin-bottom: 8px;">
                  <div class="alert-content">
                    <div class="alert-title">${rec.title}</div>
                    <div class="alert-message">${rec.message}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div class="card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">📅</span> Historial de Actividades</div>
              <a href="#/traceability/${crop.id}" class="btn btn-sm btn-secondary">Ver Trazabilidad</a>
            </div>
            ${logs.length > 0 ? `
              <div class="timeline">
                ${logs.map(log => {
                  const actionIcons = { siembra: '🌱', riego: '💧', fertilizacion: '🌿', fumigacion: '🧴', aporque: '🏔️', poda: '✂️', cosecha: '🧺', inspeccion: '🔍', alerta_clima: '⚠️', otro: '📋' };
                  const weather = log.weather_snapshot ? JSON.parse(log.weather_snapshot) : null;
                  return `
                    <div class="timeline-item">
                      <div class="timeline-date">${new Date(log.created_at).toLocaleString('es-PE')}</div>
                      <div class="timeline-action">${actionIcons[log.action_type] || '📋'} ${log.action_type.charAt(0).toUpperCase() + log.action_type.slice(1)}</div>
                      <div class="timeline-description">${log.description}</div>
                      ${weather ? `<div class="timeline-weather">🌡️ ${weather.temp?.toFixed(1) ?? '--'}°C | 💧 ${weather.humidity ?? '--'}% | ${weather.condition ?? ''}</div>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : '<div class="text-center text-muted mt-md">No hay actividades registradas aún.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

let cropModalMap = null;
let cropDrawnLayer = null;
let isOpeningCropModal = false;

async function showNewCropModal(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  // Prevenir aperturas simultáneas o clicks dobles
  if (isOpeningCropModal) return;
  isOpeningCropModal = true;
  setTimeout(() => { isOpeningCropModal = false; }, 300);

  // Limpiar cualquier modal previo de manera limpia
  const existing = document.getElementById('crop-modal');
  if (existing) {
    if (window._cropEscHandler) {
      window.removeEventListener('keydown', window._cropEscHandler);
      window._cropEscHandler = null;
    }
    if (cropModalMap) {
      try { cropModalMap.remove(); } catch (e) {}
      cropModalMap = null;
    }
    existing.remove();
  }

  // Obtener parcelas del agricultor para auto-rellenado opcional
  let parcels = [];
  try {
    const res = await api.getParcels();
    parcels = res.data || [];
  } catch (e) {}

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.id = 'crop-modal';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 99999; opacity: 1 !important; visibility: visible !important; padding: 16px; box-sizing: border-box;';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Registrar Nuevo Cultivo — AgroPasco');

  const closeCropModal = (evt) => {
    if (evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    }
    if (window._cropEscHandler) {
      window.removeEventListener('keydown', window._cropEscHandler);
      window._cropEscHandler = null;
    }
    if (cropModalMap) {
      try { cropModalMap.remove(); } catch (err) {}
      cropModalMap = null;
    }
    const m = document.getElementById('crop-modal');
    if (m) m.remove();
  };
  window._closeCropModal = closeCropModal;

  const handleEscKey = (e) => {
    if (e.key === 'Escape') closeCropModal(e);
  };
  window._cropEscHandler = handleEscKey;
  window.addEventListener('keydown', handleEscKey);

  modal.onclick = (e) => {
    if (e.target === modal) {
      closeCropModal(e);
    }
  };

  const parcelsOptions = parcels.length > 0
    ? `<option value="">-- Opcional: Seleccionar de mis parcelas --</option>` +
      parcels.map(p => `<option value="${p.id}" data-area="${p.area_hectares || 0}" data-alt="${p.altitude_masl || 4380}" data-crop="${p.crop_type || ''}" data-lat="${p.center_lat || ''}" data-lng="${p.center_lng || ''}" data-name="${p.name}">${p.name} (${p.area_hectares} ha · ${p.altitude_masl || 4380} msnm)</option>`).join('')
    : '<option value="">No tienes parcelas registradas aún</option>';

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto;" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">🌱</span>
          <h3 style="margin: 0; font-size: 18px; font-weight: 700;">Registrar Nuevo Cultivo</h3>
        </div>
        <button type="button" class="modal-close" aria-label="Cerrar modal" onclick="event.preventDefault(); event.stopPropagation(); window._closeCropModal(event);">✕</button>
      </div>

      <!-- Selector de parcela existente para auto-rellenado -->
      <div class="form-group" style="background: rgba(34, 197, 94, 0.08); padding: 12px; border-radius: var(--radius-sm); border: 1px solid rgba(34, 197, 94, 0.25); margin-bottom: 16px;">
        <label class="form-label" style="color: #4ade80;">🗺️ Vincular con Parcela Existente (Auto-completa altitud y área):</label>
        <select class="form-select" id="crop-parcel-select" onchange="handleSelectExistingParcel(this)">
          ${parcelsOptions}
        </select>
      </div>

      <form onsubmit="handleCreateCrop(event)">
        <div class="form-group">
          <label class="form-label">Nombre del Cultivo *</label>
          <input type="text" class="form-input" id="crop-name" placeholder="Ej: Papa Nativa Huayro - Parcela San Juan" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Cultivo *</label>
            <select class="form-select" id="crop-type" required>
              <option value="papa">🥔 Papa</option>
              <option value="maca">🌿 Maca</option>
              <option value="quinua">🌾 Quinua</option>
              <option value="habas">🫘 Habas</option>
              <option value="cafe">☕ Café</option>
              <option value="olluco">🟡 Olluco</option>
              <option value="mashua">🟠 Mashua</option>
              <option value="oca">🔴 Oca</option>
              <option value="cebada">🌾 Cebada</option>
              <option value="trigo">🌾 Trigo</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Variedad (opcional)</label>
            <input type="text" class="form-input" id="crop-variety" placeholder="Ej: Huayro, Peruanita, Amarilla...">
          </div>
        </div>

        <!-- SECCIÓN DE FOTOGRAFÍA EN VIVO / ARCHIVO CON AGROMEDIAUPLOADER -->
        <div class="form-group" style="padding: 12px; border-radius: 8px; border: 1.5px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); margin: 16px 0;">
          ${typeof AgroMediaUploader !== 'undefined' ? AgroMediaUploader.render({
            id: 'crop-photo',
            folder: 'crops',
            label: 'Fotografía del Cultivo o de la Siembra (en vivo o galería)'
          }) : ''}
        </div>

        <!-- SECCIÓN DE MAPA PARA DIBUJAR PARCELA Y OBTENER ALTITUD -->
        <div class="form-group" style="margin: 16px 0;">
          <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
            <label class="form-label" style="margin-bottom: 0; font-weight: 700; color: var(--text-primary);">
              📍 Ubicar o Dibujar en el Mapa (Auto-calcula Altitud msnm)
            </label>
            <button type="button" class="btn btn-sm btn-secondary" onclick="toggleCropModalMap()">
              🗺️ <span id="btn-toggle-crop-map-text">Abrir Mapa</span>
            </button>
          </div>

          <div id="crop-map-container" style="display: none; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); margin-top: 8px; position: relative;">
            <div style="background: rgba(15, 23, 42, 0.9); padding: 8px 12px; font-size: 12px; color: #94a3b8; display: flex; align-items: center; justify-content: space-between;">
              <span>✏️ Haz clic para marcar o usa la herramienta para delimitar</span>
              <span id="crop-map-status" style="color: #4ade80; font-weight: 600;">Listo</span>
            </div>
            <div id="crop-modal-map" style="height: 240px; width: 100%;"></div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Área (hectáreas)</label>
            <input type="number" class="form-input" id="crop-area" step="0.01" placeholder="0.5" value="0.5">
          </div>
          <div class="form-group">
            <label class="form-label">
              Altitud (msnm)
              <span id="altitude-source-badge" class="badge badge-green" style="font-size: 10px; margin-left: 6px;">Auto-calculable</span>
            </label>
            <input type="number" class="form-input" id="crop-altitude" placeholder="Obteniendo..." value="4380" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Detalle de Ubicación / Dirección</label>
          <input type="text" class="form-input" id="crop-location" placeholder="Ej: Yanahuanca, Daniel Alcides Carrión, Pasco">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fecha de Siembra</label>
            <input type="date" class="form-input" id="crop-planting-date">
          </div>
          <div class="form-group">
            <label class="form-label">Estado Actual</label>
            <select class="form-select" id="crop-status">
              <option value="planificado">📝 Planificado</option>
              <option value="sembrado" selected>🌱 Sembrado</option>
              <option value="crecimiento">🌿 En Crecimiento</option>
              <option value="floracion">🌸 Floración</option>
              <option value="maduracion">🟡 Maduración</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Notas (opcional)</label>
          <textarea class="form-textarea" id="crop-notes" placeholder="Observaciones de suelo, manejo tradicional o características climáticas..."></textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="event.preventDefault(); event.stopPropagation(); window._closeCropModal(event);" style="flex: 0.35;">
            Cancelar
          </button>
          <button type="submit" id="crop-submit-btn" class="btn btn-primary btn-lg" style="flex: 1;">
            🌾 Registrar Cultivo con Altitud
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // Set today as default planting date
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('crop-planting-date');
  if (dateInput) dateInput.value = today;
}

function handleSelectExistingParcel(select) {
  const opt = select.selectedOptions[0];
  if (!opt || !opt.value) return;

  const area = opt.getAttribute('data-area');
  const alt = opt.getAttribute('data-alt');
  const crop = opt.getAttribute('data-crop');
  const name = opt.getAttribute('data-name');
  const lat = opt.getAttribute('data-lat');
  const lng = opt.getAttribute('data-lng');

  if (area) document.getElementById('crop-area').value = area;
  if (alt) {
    document.getElementById('crop-altitude').value = alt;
    document.getElementById('altitude-source-badge').textContent = 'De Parcela Registrada';
  }
  if (crop) document.getElementById('crop-type').value = crop;
  if (name && !document.getElementById('crop-name').value) {
    document.getElementById('crop-name').value = `Cultivo en ${name}`;
  }
  if (lat && lng) {
    document.getElementById('crop-location').value = `Coord: ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)} (Pasco)`;
  }
  showToast(`Datos vinculados de "${name}". Altitud: ${alt} msnm`, 'success');
}

function toggleCropModalMap() {
  const container = document.getElementById('crop-map-container');
  const btnText = document.getElementById('btn-toggle-crop-map-text');
  if (!container) return;

  const isHidden = container.style.display === 'none';
  if (isHidden) {
    container.style.display = 'block';
    if (btnText) btnText.textContent = 'Ocultar Mapa';
    initCropModalMap();
  } else {
    container.style.display = 'none';
    if (btnText) btnText.textContent = 'Abrir Mapa';
  }
}

function initCropModalMap() {
  if (cropModalMap) {
    setTimeout(() => cropModalMap.invalidateSize(), 200);
    return;
  }

  const mapEl = document.getElementById('crop-modal-map');
  if (!mapEl) return;

  // Centro por defecto: Cerro de Pasco (o ubicación detectada previamente)
  const startLat = window._farmerDetectedLocation?.lat || MapsConfig.DEFAULT_CENTER.lat;
  const startLng = window._farmerDetectedLocation?.lng || MapsConfig.DEFAULT_CENTER.lng;
  const startZoom = window._farmerDetectedLocation ? 15 : 13;

  cropModalMap = L.map('crop-modal-map', {
    center: [startLat, startLng],
    zoom: startZoom
  });

  L.tileLayer(MapsConfig.ESRI_SAT_URL, {
    attribution: MapsConfig.ESRI_SAT_ATTRIBUTION,
    maxZoom: 18
  }).addTo(cropModalMap);

  // Drawn items group
  const drawnItems = new L.FeatureGroup().addTo(cropModalMap);

  // Si tenemos ubicación previa, agregar marcador de referencia
  if (window._farmerDetectedLocation) {
    const loc = window._farmerDetectedLocation;
    L.marker([loc.lat, loc.lng], {
      icon: L.divIcon({
        html: `<div class="geo-pulse-marker"><div class="geo-pulse-dot"></div><div class="geo-pulse-ring"></div></div>`,
        className: 'geo-pulse-container',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: 999
    }).addTo(cropModalMap).bindTooltip('📍 Tu ubicación', { permanent: false });
  }

  // Auto-geolocalización si no tenemos ubicación previa
  if (!window._farmerDetectedLocation && navigator.geolocation) {
    const statusEl = document.getElementById('crop-map-status');
    if (statusEl) statusEl.textContent = '📡 Detectando ubicación...';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        cropModalMap.setView([lat, lng], 15, { animate: true });

        L.marker([lat, lng], {
          icon: L.divIcon({
            html: `<div class="geo-pulse-marker"><div class="geo-pulse-dot"></div><div class="geo-pulse-ring"></div></div>`,
            className: 'geo-pulse-container',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        }).addTo(cropModalMap).bindTooltip('📍 Tu ubicación', { permanent: false });

        if (statusEl) statusEl.textContent = `✅ Ubicación detectada`;
        await applyCropElevation(lat, lng);

        window._farmerDetectedLocation = { lat, lng, accuracy: position.coords.accuracy };
      },
      (err) => {
        if (statusEl) statusEl.textContent = 'Listo (ubicación manual)';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Habilitar dibujo con Leaflet.Draw si existe
  if (typeof L.Control.Draw !== 'undefined') {
    const drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: false,
        circle: false,
        circlemarker: false,
        rectangle: true,
        marker: true,
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#22c55e', weight: 3, fillOpacity: 0.3 }
        }
      },
      edit: { featureGroup: drawnItems, remove: true }
    });
    cropModalMap.addControl(drawControl);

    cropModalMap.on(L.Draw.Event.CREATED, async (e) => {
      drawnItems.clearLayers();
      const layer = e.layer;
      drawnItems.addLayer(layer);

      const statusEl = document.getElementById('crop-map-status');
      if (statusEl) statusEl.textContent = '⏳ Obteniendo altitud satelital...';

      let centerLat, centerLng, areaHa = 0;

      if (layer.getLatLngs) {
        // Polígono o rectángulo
        const latlngs = layer.getLatLngs()[0];
        centerLat = latlngs.reduce((s, ll) => s + ll.lat, 0) / latlngs.length;
        centerLng = latlngs.reduce((s, ll) => s + ll.lng, 0) / latlngs.length;
        const areaM2 = L.GeometryUtil ? L.GeometryUtil.geodesicArea(latlngs) : 0;
        areaHa = parseFloat((areaM2 / 10000).toFixed(2));
        if (areaHa > 0) document.getElementById('crop-area').value = areaHa;
      } else if (layer.getLatLng) {
        // Marcador
        const ll = layer.getLatLng();
        centerLat = ll.lat;
        centerLng = ll.lng;
      }

      await applyCropElevation(centerLat, centerLng);
    });
  }

  // Click simple en mapa como fallback para marcar punto y obtener altitud
  cropModalMap.on('click', async (e) => {
    drawnItems.clearLayers();
    const marker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(drawnItems);
    await applyCropElevation(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => cropModalMap.invalidateSize(), 300);
}

async function applyCropElevation(lat, lng) {
  const altField = document.getElementById('crop-altitude');
  const statusEl = document.getElementById('crop-map-status');
  const badge = document.getElementById('altitude-source-badge');

  if (altField) {
    altField.value = '';
    altField.placeholder = '⏳ Calculando altitud...';
  }
  if (statusEl) statusEl.textContent = `📍 [${lat.toFixed(4)}, ${lng.toFixed(4)}] Obteniendo altitud...`;

  try {
    const elevation = await AgroMap.getElevation(lat, lng);
    const finalAlt = elevation != null ? elevation : 4380;
    if (altField) altField.value = finalAlt;
    if (badge) badge.textContent = `✅ Calculado: ${finalAlt} msnm`;
    if (statusEl) statusEl.textContent = `✅ Altitud detectada: ${finalAlt} msnm`;

    // Intentar geocodificación inversa
    try {
      const geo = await GeocodingService.reverseGeocode(lat, lng);
      if (geo.success && geo.address) {
        document.getElementById('crop-location').value = geo.address;
      } else {
        document.getElementById('crop-location').value = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)} (Pasco)`;
      }
    } catch (e) {
      document.getElementById('crop-location').value = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)} (Pasco)`;
    }

    showToast(`Altitud calculada automáticamente: ${finalAlt} msnm`, 'success');
  } catch (err) {
    if (altField) altField.value = 4380;
    if (statusEl) statusEl.textContent = 'Altitud estándar: 4380 msnm';
  }
}

async function handleCreateCrop(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  const nameInput = document.getElementById('crop-name');
  const typeInput = document.getElementById('crop-type');
  const areaInput = document.getElementById('crop-area');
  const altInput = document.getElementById('crop-altitude');
  const photoUrl = document.getElementById('crop-photo-value')?.value || '';
  const photoContainer = document.getElementById('crop-photo-container');

  const nameVal = nameInput?.value?.trim();
  const typeVal = typeInput?.value?.trim();
  const areaVal = parseFloat(areaInput?.value);
  const altVal = parseInt(altInput?.value);

  // 1. Validaciones previas de campos requeridos
  if (!nameVal) {
    showToast('⚠️ El nombre del cultivo es obligatorio.', 'warning');
    nameInput?.focus();
    return;
  }

  if (!typeVal) {
    showToast('⚠️ Debe seleccionar el tipo de cultivo.', 'warning');
    typeInput?.focus();
    return;
  }

  if (isNaN(areaVal) || areaVal <= 0) {
    showToast('⚠️ Ingrese un área válida mayor a 0 hectáreas.', 'warning');
    areaInput?.focus();
    return;
  }

  if (isNaN(altVal) || altVal <= 0) {
    showToast('⚠️ Ingrese una altitud válida en msnm.', 'warning');
    altInput?.focus();
    return;
  }

  // 2. Validación de fotografía obligatoria
  if (!photoUrl || photoUrl.trim() === '') {
    if (photoContainer) {
      photoContainer.style.border = '2px solid #ef4444';
      photoContainer.style.boxShadow = '0 0 14px rgba(239, 68, 68, 0.4)';
      photoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showToast('⚠️ La fotografía del cultivo o de la siembra es obligatoria antes de registrar.', 'error');
    if (window.AgroLogger) AgroLogger.warn('CROP', 'Intento de registro sin fotografía obligatoria', { name: nameVal });
    return;
  }

  const submitBtn = document.getElementById('crop-submit-btn');

  const executeSubmit = async () => {
    if (window.AgroLogger) AgroLogger.action('CROP', `Enviando registro de cultivo "${nameVal}"`);

    const result = await api.createCrop({
      name: nameVal,
      crop_type: typeVal,
      variety: document.getElementById('crop-variety')?.value?.trim() || null,
      area_hectares: areaVal,
      altitude_masl: altVal,
      location_detail: document.getElementById('crop-location')?.value?.trim() || null,
      planting_date: document.getElementById('crop-planting-date')?.value || null,
      status: document.getElementById('crop-status')?.value || 'sembrado',
      notes: document.getElementById('crop-notes')?.value?.trim() || null,
      photo_url: photoUrl.trim()
    });

    if (result.success) {
      if (window.AgroLogger) AgroLogger.info('CROP', `Cultivo "${nameVal}" registrado con éxito`);
      if (typeof window._closeCropModal === 'function') {
        window._closeCropModal();
      } else {
        if (cropModalMap) { try { cropModalMap.remove(); } catch (err) {} cropModalMap = null; }
        document.getElementById('crop-modal')?.remove();
      }
      showToast('¡Cultivo registrado exitosamente!', 'success');
      window.location.hash = '#/crops';
      navigateTo('/crops');
    } else {
      const errorMsg = result.error || 'Verifique que los datos sean correctos.';
      if (window.AgroLogger) AgroLogger.error('CROP', 'Fallo al registrar cultivo en el servidor', { error: errorMsg });
      showToast(`Error al registrar cultivo: ${errorMsg}`, 'error');
      // El modal permanece abierto para que el usuario corrija sin perder sus datos
    }
  };

  if (window.AgroLogger && AgroLogger.wrapButtonAction) {
    await AgroLogger.wrapButtonAction(submitBtn, 'Guardando cultivo...', executeSubmit);
  } else {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span>⏳</span> Guardando cultivo...'; }
    try {
      await executeSubmit();
    } finally {
      if (submitBtn && document.body.contains(submitBtn)) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '🌾 Registrar Cultivo con Altitud';
      }
    }
  }
}

async function handleAddLog(e, cropId) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  const executeAddLog = async () => {
    const result = await api.addCropLog(cropId, {
      action_type: document.getElementById('log-action').value,
      description: document.getElementById('log-description').value
    });

    if (result.success) {
      showToast('Actividad registrada con snapshot climático', 'success');
      navigateTo(`/crops/${cropId}`);
    } else {
      showToast(result.error || 'Error al registrar actividad', 'error');
    }
  };

  if (window.AgroLogger && AgroLogger.wrapButtonAction) {
    await AgroLogger.wrapButtonAction(submitBtn, 'Registrando actividad...', executeAddLog);
  } else {
    await executeAddLog();
  }
}

async function confirmDeleteCrop(cropId) {
  if (confirm('¿Estás seguro de eliminar este cultivo? Esta acción no se puede deshacer.')) {
    const result = await api.deleteCrop(cropId);
    if (result.success) {
      showToast('Cultivo eliminado', 'warning');
      window.location.hash = '#/crops';
      navigateTo('/crops');
    } else {
      showToast(result.error || 'Error al eliminar', 'error');
    }
  }
}

async function updateCropStatus(cropId, newStatus) {
  const result = await api.updateCrop(cropId, { status: newStatus });
  if (result.success) {
    showToast(`Etapa actualizada a ${newStatus.toUpperCase()}`, 'success');
    navigateTo(`/crops/${cropId}`);
  } else {
    showToast(result.error || 'Error al actualizar etapa', 'error');
  }
}

function getPhenologicalAdvice(cropType, status) {
  const adviceMap = {
    sembrado: {
      title: '🌱 Etapa: Siembra y Emergencia',
      pest: 'Tratamiento de tubérculos/semillas con ceniza de madera o Trichoderma contra pudrición de raíz (Rhizoctonia).',
      fertilization: 'Abonado base: compost compostado + guano de isla en el fondo del surco. No aplicar exceso de urea en siembra.',
      irrigation: 'Mantener humedad ligera y constante sin encharcar para permitir la emergencia uniforme de plántulas.'
    },
    crecimiento: {
      title: '🌿 Etapa: Crecimiento Vegetativo',
      pest: 'Monitorear larva de gorgojo de los Andes en papa y pulgón negro en habas. Control biológico con Beauveria bassiana.',
      fertilization: 'Primer aporque a los 30-40 días. Aplicación de biol foliar al 10% cada 15 días para estimular fotosíntesis.',
      irrigation: 'Riego por surcos cada 7-10 días según evaporación. Evitar déficit antes del aporque.'
    },
    floracion: {
      title: '🌸 Etapa: Floración / Tuberización (Fase Crítica)',
      pest: 'Evitar aplicar plaguicidas tóxicos que ahuyenten polinizadores. Control de rancha (Phytophthora) si hay alta humedad.',
      fertilization: 'Aplicación de abono foliar rico en potasio y fósforo + calcio-boro para aumentar cuajado y llenado de raíz.',
      irrigation: 'FASE CRÍTICA: Riego oportuno obligatorio cada 6-8 días. El estrés hídrico reduce el rendimiento hasta en 40%.'
    },
    maduracion: {
      title: '🟡 Etapa: Maduración y Pre-Cosecha',
      pest: 'Inspeccionar que no haya plagas de almacén antes de la siega. Eliminar malas hierbas maduras.',
      fertilization: 'Suspender fertilización nitrogenada para asegurar firmeza de la cáscara y buena conservación post-cosecha.',
      irrigation: 'Suspender riego 12 a 15 días antes de la cosecha para facilitar el oreo del suelo y desprendimiento limpio.'
    },
    cosechado: {
      title: '🧺 Etapa: Cosecha y Post-Cosecha',
      pest: 'Almacenar en bodegas oscuras, frescas y ventiladas. Usar tarimas de madera para evitar contacto directo con suelo.',
      fertilization: 'Preparar la parcela para rotación de cultivo (ejemplo: sembrar habas tras papa para fijar nitrógeno).',
      irrigation: 'Cosechar en días soleados sin lluvias para evitar barro adherido a los productos.'
    }
  };

  const current = adviceMap[status] || adviceMap.crecimiento;

  return `
    <div style="display: grid; gap: 8px;">
      <div style="font-size: 13.5px; font-weight: 700; color: var(--green-400);">${current.title}</div>
      <div style="background: var(--bg-glass); padding: 10px; border-radius: 6px; font-size: 12.5px;">
        <strong style="color: var(--amber-400);">🐛 Manejo Fitosanitario / Plagas:</strong>
        <div class="text-muted mt-sm">${current.pest}</div>
      </div>
      <div style="background: var(--bg-glass); padding: 10px; border-radius: 6px; font-size: 12.5px;">
        <strong style="color: var(--green-400);">🍃 Nutrición / Fertilización Foliar:</strong>
        <div class="text-muted mt-sm">${current.fertilization}</div>
      </div>
      <div style="background: var(--bg-glass); padding: 10px; border-radius: 6px; font-size: 12.5px;">
        <strong style="color: var(--blue-400);">💧 Requerimiento Hídrico:</strong>
        <div class="text-muted mt-sm">${current.irrigation}</div>
      </div>
    </div>
  `;
}

// Exponer globalmente para listeners HTML y llamados programáticos
window.showNewCropModal = showNewCropModal;
window.handleOpenCropModal = showNewCropModal;
