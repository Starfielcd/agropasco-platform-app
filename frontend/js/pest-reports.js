/**
 * AgroPasco — Módulo de Reportes y Gestión de Plagas
 * Flujo: Agricultor reporta → Asesor Técnico responde y monitorea mapa de infección
 */

let advisorPestMap = null;
let activeInfectionLayer = null;

// ===== 1. VISTA DEL AGRICULTOR: REPORTAR Y CONSULTAR PLAGAS =====
async function renderPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];
  const pending = reports.filter(r => r.status === 'pendiente');
  const resolved = reports.filter(r => r.status === 'resuelto');

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🐛 Mis Reportes de Plagas (${reports.length})</h3>
          <p class="text-sm text-muted">Reporta plagas o enfermedades en tus cultivos para recibir respuesta técnica inmediata del asesor.</p>
        </div>
        <button class="btn btn-primary btn-lg" onclick="showFarmerPestReportModal()">
          🐛 + Reportar Plaga en Cultivo
        </button>
      </div>

      <!-- Métricas rápidas -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">⏳</div>
          <div class="stat-card-value">${pending.length}</div>
          <div class="stat-card-label">Reportes Pendientes</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">✅</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Recomendaciones Recibidas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">📋</div>
          <div class="stat-card-value">${reports.length}</div>
          <div class="stat-card-label">Total Reportes</div>
        </div>
      </div>

      <!-- Lista de reportes del agricultor -->
      ${reports.length > 0 ? `
        <div style="display: grid; gap: 14px;">
          ${reports.map(r => `
            <div class="card" style="border-left: 5px solid ${r.status === 'pendiente' ? '#f59e0b' : '#22c55e'};">
              <div class="flex items-center justify-between mb-sm">
                <div style="font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                  <span>🐛 ${r.pest_name}</span>
                  ${r.parcel_crop ? `<span class="badge badge-purple">🌱 ${r.parcel_crop}</span>` : ''}
                </div>
                <span class="badge badge-${r.status === 'pendiente' ? 'amber' : 'green'}" style="font-size: 12px;">
                  ${r.status === 'pendiente' ? '⏳ En espera de asesor' : '✅ Atendido por Asesor'}
                </span>
              </div>

              <div class="text-sm" style="color: #cbd5e1; margin-bottom: 8px;">
                ${r.description || 'Sin descripción detallada.'}
              </div>

              <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-muted); margin-bottom: 8px;">
                ${r.parcel_name ? `<span>🗺️ <strong>Parcela:</strong> ${r.parcel_name}</span>` : ''}
                ${r.altitude_masl ? `<span>🏔️ <strong>Altitud:</strong> ${r.altitude_masl} msnm</span>` : ''}
                <span>📅 <strong>Fecha:</strong> ${new Date(r.created_at).toLocaleDateString('es-PE')}</span>
              </div>

              ${r.photo_url ? `
                <div style="margin: 10px 0;">
                  <img src="${r.photo_url}" alt="Foto plaga" style="max-height: 140px; border-radius: 6px; border: 1px solid var(--border); object-fit: cover;">
                </div>
              ` : ''}

              <!-- Respuesta Técnica del Asesor -->
              ${r.advisor_response ? `
                <div style="margin-top: 10px; padding: 14px; background: rgba(34,197,94,0.1); border-radius: 8px; border-left: 4px solid #22c55e;">
                  <div style="color: #4ade80; font-weight: 700; font-size: 13.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <span>👨‍🔬 Recomendación Técnica de ${r.advisor_name || 'Asesor Especialista'}:</span>
                  </div>
                  <div style="color: #e2e8f0; font-size: 13px; line-height: 1.5;">
                    ${r.advisor_response}
                  </div>
                  ${r.responded_at ? `<div class="text-sm text-muted mt-sm">📅 Respondido: ${new Date(r.responded_at).toLocaleString('es-PE')}</div>` : ''}
                </div>
              ` : `
                <div style="margin-top: 8px; font-size: 12px; color: #f59e0b;">
                  ⏳ Tu reporte ha sido notificado al equipo técnico de AgroPasco. Pronto recibirás recomendaciones para el control.
                </div>
              `}
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">🌿</div>
          <div class="empty-state-title">No tienes plagas reportadas</div>
          <div class="empty-state-text">Si detectas síntomas de plagas o enfermedades en tus parcelas, repórtalas aquí para recibir soporte agronómico.</div>
          <button class="btn btn-primary btn-lg" onclick="showFarmerPestReportModal()">🐛 Reportar Plaga Ahora</button>
        </div>
      `}
    </div>
  `;
}

// Modal para que el Agricultor reporte una plaga
async function showFarmerPestReportModal() {
  let parcels = [];
  try {
    const res = await api.getParcels();
    parcels = res.data || [];
  } catch (e) {}

  const parcelsOptions = parcels.length > 0
    ? `<option value="">-- Seleccionar Parcela Afectada --</option>` +
      parcels.map(p => `<option value="${p.id}" data-crop="${p.crop_type || ''}" data-lat="${p.center_lat || ''}" data-lng="${p.center_lng || ''}" data-alt="${p.altitude_masl || ''}">${p.name}${p.crop_type ? ' (' + p.crop_type + ')' : ''} · ${p.altitude_masl || 4380} msnm</option>`).join('')
    : '<option value="">No tienes parcelas registradas aún</option>';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'pest-report-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 620px;">
      <div class="modal-header">
        <h3>🐛 Reportar Plaga o Enfermedad al Asesor</h3>
        <button class="modal-close" onclick="document.getElementById('pest-report-modal').remove()">✕</button>
      </div>

      <form onsubmit="handleCreatePestReport(event)">
        <!-- Parcela Afectada -->
        <div class="form-group">
          <label class="form-label">Parcela Afectada</label>
          <select class="form-select" id="pr-parcel" onchange="handlePestParcelSelect(this)" required>
            ${parcelsOptions}
          </select>
        </div>

        <!-- Nombre de la Plaga con Sugerencias Comunes -->
        <div class="form-group">
          <label class="form-label">Nombre de la Plaga o Síntoma</label>
          <div style="display: flex; gap: 8px; margin-bottom: 6px;">
            <select class="form-select" style="flex: 1;" onchange="if(this.value){document.getElementById('pr-pest-name').value = this.value;}">
              <option value="">-- Plagas Comunes en Pasco --</option>
              <option value="Gorgojo de los Andes (Premnotrypes spp.)">🥔 Gorgojo de los Andes</option>
              <option value="Rancha o Tizón Tardío (Phytophthora infestans)">🥔 Rancha de la Papa</option>
              <option value="Pulgón Negro de las Habas (Aphis fabae)">🫘 Pulgón Negro</option>
              <option value="Gusano Cortador (Agrotis ipsilon)">🌱 Gusano Cortador</option>
              <option value="Polilla de la Papa (Phthorimaea operculella)">🥔 Polilla de la Papa</option>
              <option value="Oidio / Ceniza (Erysiphe)">🌿 Oidio / Cenicilla</option>
              <option value="Mancha Foliar o Roya">🍃 Roya / Mancha Foliar</option>
            </select>
          </div>
          <input type="text" class="form-input" id="pr-pest-name" placeholder="Ej: Gorgojo de los Andes o describe el síntoma" required>
        </div>

        <!-- Ubicación / Coordenadas -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Ubicación / Caserío</label>
            <input type="text" class="form-input" id="pr-location-name" placeholder="Ej: Sector San Juan, Yanahuanca">
          </div>
          <div class="form-group">
            <label class="form-label">Severidad Estimada</label>
            <select class="form-select" id="pr-severity">
              <option value="leve">🟢 Leve (focos aislados)</option>
              <option value="moderado" selected>🟡 Moderado (10% - 25% del área)</option>
              <option value="grave">🟠 Grave (más del 30% del cultivo)</option>
              <option value="critico">🔴 Crítico (riesgo total de pérdida)</option>
            </select>
          </div>
        </div>

        <input type="hidden" id="pr-lat">
        <input type="hidden" id="pr-lng">

        <!-- Descripción -->
        <div class="form-group">
          <label class="form-label">Descripción del Problema y Síntomas Observados</label>
          <textarea class="form-textarea" id="pr-description" rows="3" placeholder="Describe qué partes de la planta están dañadas (hojas, tallo, tubérculo), coloración, presencia de larvas o insectos..." required></textarea>
        </div>

        <!-- Foto URL -->
        <div class="form-group">
          <label class="form-label">Fotografía de la Plaga (URL opcional)</label>
          <input type="url" class="form-input" id="pr-photo" placeholder="https://ejemplo.com/foto-plaga.jpg">
          <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="document.getElementById('pr-photo').value='https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=800&q=80'">
              📷 Foto de muestra 1
            </button>
            <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="document.getElementById('pr-photo').value='https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=800&q=80'">
              📷 Foto de muestra 2
            </button>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top: 16px;">
          🚀 Enviar Reporte al Asesor Técnico
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

function handlePestParcelSelect(select) {
  const opt = select.selectedOptions[0];
  if (!opt || !opt.value) return;

  const lat = opt.getAttribute('data-lat');
  const lng = opt.getAttribute('data-lng');
  const alt = opt.getAttribute('data-alt');

  if (lat) document.getElementById('pr-lat').value = lat;
  if (lng) document.getElementById('pr-lng').value = lng;
  if (lat && lng) {
    document.getElementById('pr-location-name').value = `Parcela (${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}) · ${alt || 4380} msnm`;
  }
}

async function handleCreatePestReport(e) {
  e.preventDefault();
  const parcelId = document.getElementById('pr-parcel').value;
  const latVal = parseFloat(document.getElementById('pr-lat').value) || null;
  const lngVal = parseFloat(document.getElementById('pr-lng').value) || null;

  const result = await api.createPestReport({
    pest_name: document.getElementById('pr-pest-name').value,
    parcel_id: parcelId ? parseInt(parcelId) : null,
    description: document.getElementById('pr-description').value,
    photo_url: document.getElementById('pr-photo').value || null,
    location_lat: latVal,
    location_lng: lngVal
  });

  if (result.success) {
    document.getElementById('pest-report-modal')?.remove();
    showToast('¡Reporte enviado exitosamente al Asesor Técnico!', 'success');
    navigateTo('/pest-reports');
  } else {
    showToast(result.error || 'Error al enviar reporte', 'error');
  }
}

// ===== 2. VISTA DEL ASESOR TÉCNICO: GESTIÓN DE PLAGAS Y MONITOREO DE INFECCIÓN =====
async function renderAdvisorPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];
  const pending = reports.filter(r => r.status === 'pendiente' || r.status === 'en_revision');
  const resolved = reports.filter(r => r.status === 'resuelto');

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">🐛 Panel de Gestión de Plagas e Infecciones</h3>
          <p class="text-sm text-muted">Supervisa los focos de infección reportados por agricultores y emite recomendaciones técnicas.</p>
        </div>
      </div>

      <!-- Resumen estadístico -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">🔴</div>
          <div class="stat-card-value">${pending.length}</div>
          <div class="stat-card-label">Plagas No Resueltas (Urgente)</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">✅</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Plagas Completas (Atendidas)</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">🗺️</div>
          <div class="stat-card-value">${reports.length}</div>
          <div class="stat-card-label">Total de Focos Monitoreados</div>
        </div>
      </div>

      <!-- MAPA SATELITAL DE INFECCIONES Y PARCELAS -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden; border: 1.5px solid var(--border);">
        <div style="background: rgba(15, 23, 42, 0.95); padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">🛰️</span>
            <strong style="color: #ffffff; font-size: 14px;">Mapa Satelital de Zonas de Infección</strong>
          </div>
          <span id="pest-map-beacon-text" class="badge badge-amber">Haz clic en un reporte para ubicarlo</span>
        </div>
        <div id="pest-report-map" class="map-container" style="height: 440px; width: 100%;"></div>
      </div>

      <!-- SECCIÓN 1: PLAGAS NO RESUELTAS -->
      <div class="card mb-lg" style="border-left: 5px solid #ef4444;">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">🔴</span>
            <span>Plagas No Resueltas (${pending.length} pendientes)</span>
          </div>
          <span class="badge badge-red">Requiere Atención Técnica</span>
        </div>

        ${pending.length > 0 ? `
          <div style="display: grid; gap: 14px;">
            ${pending.map(r => renderAdvisorReportCard(r, 'pending')).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-title">Excelente: No hay plagas pendientes</div>
            <div class="empty-state-text">Todos los reportes de los agricultores han sido atendidos exitosamente.</div>
          </div>
        `}
      </div>

      <!-- SECCIÓN 2: PLAGAS COMPLETAS -->
      <div class="card" style="border-left: 5px solid #22c55e;">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">✅</span>
            <span>Plagas Completas (${resolved.length} atendidas)</span>
          </div>
          <span class="badge badge-green">Con Recomendación Emitida</span>
        </div>

        ${resolved.length > 0 ? `
          <div style="display: grid; gap: 14px;">
            ${resolved.map(r => renderAdvisorReportCard(r, 'resolved')).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">Sin reportes resueltos aún</div>
            <div class="empty-state-text">Los reportes a los que brindes recomendación técnica aparecerán en este historial.</div>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderAdvisorReportCard(r, type) {
  const isPending = type === 'pending';

  return `
    <div class="alert-card ${isPending ? 'warning' : 'info'}" style="background: rgba(15, 23, 42, 0.75); border: 1px solid ${isPending ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}; padding: 18px;">
      <span class="alert-icon" style="font-size: 26px;">🐛</span>
      <div class="alert-content" style="flex: 1;">
        <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 16px; font-weight: 700; color: #ffffff;">
            ${r.pest_name}
          </div>
          <span class="badge badge-${isPending ? 'red' : 'green'}">
            ${isPending ? '🔴 No Resuelta' : '✅ Completa'}
          </span>
        </div>

        <div style="font-size: 13.5px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.5;">
          ${r.description || 'Sin descripción detallada proporcionada por el agricultor.'}
        </div>

        <!-- Metadatos de la parcela y agricultor -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.25); border-radius: 6px;">
          <div style="font-size: 12.5px;">
            <span class="text-muted">👨‍🌾 Agricultor:</span>
            <strong style="color: #60a5fa;">${r.farmer_name || 'Agricultor de Pasco'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🗺️ Parcela:</span>
            <strong style="color: #4ade80;">${r.parcel_name || 'Parcela sin nombre'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🌱 Cultivo Afectado:</span>
            <strong>${r.parcel_crop || 'No especificado'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🏔️ Altitud:</span>
            <strong style="color: #38bdf8;">${r.altitude_masl ? r.altitude_masl + ' msnm' : '4380 msnm'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">📍 Ubicación:</span>
            <span>${r.farmer_location || 'Región Pasco'}</span>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">📅 Fecha Reporte:</span>
            <span>${new Date(r.created_at).toLocaleDateString('es-PE')}</span>
          </div>
        </div>

        ${r.photo_url ? `
          <div style="margin-bottom: 12px;">
            <img src="${r.photo_url}" alt="Foto plaga" style="max-height: 140px; border-radius: 6px; border: 1px solid var(--border); object-fit: cover;">
          </div>
        ` : ''}

        ${r.advisor_response ? `
          <div style="margin-bottom: 12px; padding: 12px; background: rgba(34,197,94,0.12); border-radius: 6px; border-left: 3px solid #22c55e;">
            <div style="font-size: 12px; color: #4ade80; font-weight: 700; margin-bottom: 2px;">
              ✅ Recomendación Técnica Emitida (por ${r.advisor_name || 'Asesor'}):
            </div>
            <div style="font-size: 13px; color: #f1f5f9;">${r.advisor_response}</div>
          </div>
        ` : ''}

        <!-- Botones de Acción -->
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;">
          <button class="btn btn-sm btn-secondary" onclick="focusPestReportOnMap(${r.id})">
            🗺️ Ubicar Parcela en Mapa
          </button>
          ${isPending ? `
            <button class="btn btn-sm btn-primary" onclick="showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '${(r.description || '').replace(/'/g, "\\'").substring(0, 100)}')">
              📋 Responder con Recomendación Técnica
            </button>
          ` : `
            <button class="btn btn-sm btn-secondary" onclick="showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '${(r.advisor_response || '').replace(/'/g, "\\'").substring(0, 100)}', true)">
              ✏️ Actualizar Recomendación
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

// Inicializar mapa de reportes para el asesor
function initPestReportMap() {
  if (advisorPestMap) {
    advisorPestMap.remove();
    advisorPestMap = null;
  }

  const container = document.getElementById('pest-report-map');
  if (!container) return;

  advisorPestMap = L.map('pest-report-map', {
    center: [MapsConfig.DEFAULT_CENTER.lat, MapsConfig.DEFAULT_CENTER.lng],
    zoom: 12
  });

  L.tileLayer(MapsConfig.ESRI_SAT_URL, {
    attribution: MapsConfig.ESRI_SAT_ATTRIBUTION,
    maxZoom: 18
  }).addTo(advisorPestMap);

  activeInfectionLayer = L.featureGroup().addTo(advisorPestMap);

  loadPestReportsOnMap();
  setTimeout(() => advisorPestMap.invalidateSize(), 300);
}

async function loadPestReportsOnMap() {
  if (!advisorPestMap) return;

  const result = await api.getPestReports();
  const reports = result.data || [];
  const bounds = [];

  reports.forEach(r => {
    let layer = null;
    const isPending = r.status === 'pendiente' || r.status === 'en_revision';
    const color = isPending ? '#ef4444' : '#22c55e';

    if (r.geo_json) {
      try {
        const geo = JSON.parse(r.geo_json);
        const coords = geo.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
        if (coords.length > 0) {
          layer = L.polygon(coords, {
            color: color,
            weight: isPending ? 3 : 2,
            fillColor: color,
            fillOpacity: isPending ? 0.35 : 0.2
          });
          bounds.push(...coords);
        }
      } catch (e) {}
    }

    if (!layer && r.location_lat && r.location_lng) {
      layer = L.marker([r.location_lat, r.location_lng], {
        icon: L.divIcon({
          html: `<div style="font-size: 26px; filter: drop-shadow(0 0 6px ${color});">🐛</div>`,
          className: 'custom-marker-container',
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        })
      });
      bounds.push([r.location_lat, r.location_lng]);
    }

    if (layer) {
      layer.bindPopup(`
        <div style="font-family: Inter, sans-serif; min-width: 200px;">
          <strong style="font-size: 14px; color: ${color};">🐛 ${r.pest_name}</strong><br>
          <div style="font-size: 12px; margin: 4px 0;">
            👨‍🌾 <strong>${r.farmer_name || 'Agricultor'}</strong><br>
            🗺️ Parcela: <strong>${r.parcel_name || 'Sin nombre'}</strong><br>
            🌱 Cultivo: <strong>${r.parcel_crop || 'No especificado'}</strong><br>
            🏔️ Altitud: <strong>${r.altitude_masl || 4380} msnm</strong><br>
            <em>Estado: ${isPending ? '🔴 No Resuelta' : '✅ Completa'}</em>
          </div>
          ${isPending ? `
            <button class="btn btn-sm btn-primary btn-block" style="margin-top: 6px;" onclick="showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '')">
              📋 Responder Plaga
            </button>
          ` : ''}
        </div>
      `);
      layer.addTo(activeInfectionLayer);
    }
  });

  if (bounds.length > 0) {
    advisorPestMap.fitBounds(bounds, { padding: [30, 30] });
  }
}

// Foco directo al hacer clic en un reporte desde la lista
async function focusPestReportOnMap(reportId) {
  const result = await api.getPestReports();
  const report = (result.data || []).find(r => r.id === reportId);
  if (!report) {
    showToast('Reporte no encontrado', 'error');
    return;
  }

  const mapEl = document.getElementById('pest-report-map');
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (!advisorPestMap) {
    initPestReportMap();
  }

  const beaconText = document.getElementById('pest-map-beacon-text');
  if (beaconText) {
    beaconText.className = 'badge badge-red';
    beaconText.innerHTML = `⚠️ Zona de infección enfocada: <strong>${report.pest_name}</strong>`;
  }

  let centerLat = report.location_lat || report.center_lat;
  let centerLng = report.location_lng || report.center_lng;
  let coords = [];

  if (report.geo_json) {
    try {
      const geo = JSON.parse(report.geo_json);
      coords = geo.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
      if (coords.length > 0 && (!centerLat || !centerLng)) {
        centerLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        centerLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      }
    } catch (e) {}
  }

  if (centerLat && centerLng) {
    advisorPestMap.setView([centerLat, centerLng], 16);

    // Resaltar polígono de infección con destello
    if (coords.length > 0) {
      const highlight = L.polygon(coords, {
        color: '#ef4444',
        weight: 5,
        fillColor: '#ef4444',
        fillOpacity: 0.45,
        dashArray: '8, 8'
      }).addTo(advisorPestMap);

      highlight.bindPopup(`
        <div style="font-family: Inter, sans-serif; min-width: 220px;">
          <div style="color: #ef4444; font-weight: 800; font-size: 15px;">⚠️ FOCO DE INFECCIÓN ACTIVO</div>
          <strong>Plaga:</strong> ${report.pest_name}<br>
          <strong>Cultivo:</strong> ${report.parcel_crop || '—'}<br>
          <strong>Agricultor:</strong> ${report.farmer_name || '—'}<br>
          <strong>Altitud:</strong> ${report.altitude_masl || 4380} msnm<br>
          <strong>Parcela:</strong> ${report.parcel_name || '—'}
        </div>
      `).openPopup();

      setTimeout(() => {
        advisorPestMap.fitBounds(highlight.getBounds(), { padding: [35, 35] });
      }, 200);
    } else {
      L.popup()
        .setLatLng([centerLat, centerLng])
        .setContent(`
          <div style="font-family: Inter, sans-serif;">
            <strong style="color: #ef4444;">🐛 ${report.pest_name}</strong><br>
            👨‍🌾 ${report.farmer_name || 'Agricultor'}<br>
            🗺️ ${report.parcel_name || ''}
          </div>
        `)
        .openOn(advisorPestMap);
    }

    showToast(`Mostrando zona afectada por ${report.pest_name}`, 'warning');
  } else {
    showToast('Esta parcela no tiene coordenadas geográficas registradas', 'info');
  }
}

// Modal para emitir recomendación técnica fitosanitaria
function showRespondModal(reportId, pestName, existingResponse = '', isEdit = false) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'respond-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 580px;">
      <div class="modal-header">
        <h3>📋 ${isEdit ? 'Actualizar' : 'Emitir'} Recomendación Técnica</h3>
        <button class="modal-close" onclick="document.getElementById('respond-modal').remove()">✕</button>
      </div>

      <div style="padding: 12px; background: rgba(239,68,68,0.1); border-radius: 8px; border-left: 4px solid #ef4444; margin-bottom: 16px;">
        <div style="font-size: 13px; color: #f87171; font-weight: 700;">Plaga a combatir:</div>
        <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-top: 2px;">🐛 ${pestName}</div>
      </div>

      <form onsubmit="handleRespondReport(event, ${reportId})">
        <div class="form-group">
          <label class="form-label">Dictamen y Recomendación Técnica Fitosanitaria</label>
          <textarea class="form-textarea" id="respond-text" rows="6" placeholder="Escribe aquí las instrucciones de manejo: control biológico (ej. Beauveria bassiana), bioles foliares, aporque preventivo, dosis recomendadas y frecuencia de aplicación..." required>${existingResponse || ''}</textarea>
        </div>

        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;">
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Aplicar bioestimulante orgánico al 10% cada 7 días en horas de la tarde para fortalecer defensas.'">
            + Añadir Biol
          </button>
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Realizar aporque alto y eliminación manual de malezas hospederas en el perímetro.'">
            + Añadir Aporque
          </button>
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Utilizar trampas con feromonas y Beauveria bassiana como control microbiológico sin químicos.'">
            + Añadir Control Biológico
          </button>
        </div>

        <button type="submit" class="btn btn-primary btn-block btn-lg">
          ✅ Enviar Dictamen Técnico al Agricultor
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleRespondReport(e, reportId) {
  e.preventDefault();
  const responseText = document.getElementById('respond-text').value;

  const result = await api.respondPestReport(reportId, {
    advisor_response: responseText
  });

  if (result.success) {
    document.getElementById('respond-modal')?.remove();
    showToast('✅ Recomendación técnica enviada al agricultor. Reporte completado.', 'success');
    navigateTo('/advisor/pest-reports');
  } else {
    showToast(result.error || 'Error al responder reporte', 'error');
  }
}
