/**
 * AgroPasco — Módulo de Gestión de Plagas y Asesoría Fitosanitaria
 * Flujo Completo:
 * 1. Agricultor reporta con Fotografía Obligatoria y selección de parcela con altitud.
 * 2. Asesor Técnico ubica parcela en mapa satelital con ficha técnica completa y polígono.
 * 3. Asesor responde con recomendación, estado de control, video explicativo y guía PDF.
 * 4. Historial cronológico de respuestas preservado.
 * 5. Agricultor evalúa efectividad: confirma plaga extinguida o reporta persistencia (vuelta a No Resuelto).
 */

let advisorPestMap = null;
let activeInfectionLayer = null;
let highlightedPolygonLayer = null;

// Helper: Formato de badges de estado con semáforo de colores
function getPestStatusBadge(report) {
  const st = (report.control_status || report.status || 'pendiente').toLowerCase();
  if (st === 'resuelto' || st === 'extinguida') {
    return `<span class="badge badge-green" style="font-weight: 700;">🟢 Resuelta / Extinguida</span>`;
  } else if (st === 'en_proceso' || st === 'en_revision') {
    return `<span class="badge badge-amber" style="font-weight: 700;">🟡 En Proceso de Control</span>`;
  } else {
    return `<span class="badge badge-red" style="font-weight: 700;">🔴 No Resuelta</span>`;
  }
}

function getPestSeverityBadge(sev) {
  const s = (sev || 'moderado').toLowerCase();
  if (s === 'critico') return `<span class="badge badge-red">🔴 Catástrofe / Crítico</span>`;
  if (s === 'grave') return `<span class="badge badge-red">🟠 Grave</span>`;
  if (s === 'moderado') return `<span class="badge badge-amber">🟡 Moderado</span>`;
  return `<span class="badge badge-green">🟢 Leve</span>`;
}

// ===== 1. VISTA DEL AGRICULTOR: REPORTAR Y CONSULTAR PLAGAS =====
async function renderPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];

  const unresolved = reports.filter(r => (r.status === 'no_resuelto' || r.status === 'pendiente' || r.control_status === 'no_resuelto'));
  const inProcess = reports.filter(r => (r.control_status === 'en_proceso' || r.status === 'en_proceso'));
  const resolved = reports.filter(r => (r.status === 'resuelto' || r.control_status === 'resuelto'));

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg flex-wrap gap-md">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">🐛 Mis Reportes de Plagas y Enfermedades (${reports.length})</h3>
          <p class="text-sm text-muted">Registra fotos de campo para diagnóstico fitosanitario y recibe recomendaciones técnicas de ingenieros agrónomos.</p>
        </div>
        <button class="btn btn-primary btn-lg" onclick="showFarmerPestReportModal()" style="box-shadow: 0 4px 14px rgba(34,197,94,0.35);">
          🐛 + Reportar Plaga en Cultivo
        </button>
      </div>

      <!-- Métricas rápidas por semáforo -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">🔴</div>
          <div class="stat-card-value">${unresolved.length}</div>
          <div class="stat-card-label">Plagas No Resueltas</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">🟡</div>
          <div class="stat-card-value">${inProcess.length}</div>
          <div class="stat-card-label">En Proceso de Control</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">🟢</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Plagas Resueltas / Extinguidas</div>
        </div>
      </div>

      <!-- Lista de reportes del agricultor -->
      ${reports.length > 0 ? `
        <div style="display: grid; gap: 16px;">
          ${reports.map(r => renderFarmerReportCard(r)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">🌿</div>
          <div class="empty-state-title">No tienes reportes de plagas registrados</div>
          <div class="empty-state-text">Si detectas síntomas de gusanos, hongos, rancha o marchitez en tus parcelas, repórtalas con fotografía para recibir asistencia técnica.</div>
          <button class="btn btn-primary btn-lg" onclick="showFarmerPestReportModal()">🐛 Reportar Plaga con Foto Ahora</button>
        </div>
      `}
    </div>
  `;
}

function renderFarmerReportCard(r) {
  const isUnresolved = r.status === 'no_resuelto' || r.status === 'pendiente' || r.control_status === 'no_resuelto';
  const isInProcess = r.control_status === 'en_proceso' || r.status === 'en_proceso';
  const isResolved = r.status === 'resuelto' || r.control_status === 'resuelto';

  const borderColor = isResolved ? '#22c55e' : isInProcess ? '#f59e0b' : '#ef4444';

  return `
    <div class="card" style="border-left: 6px solid ${borderColor}; background: rgba(15, 23, 42, 0.85); padding: 20px;">
      <div class="flex items-center justify-between mb-sm flex-wrap gap-sm">
        <div style="font-weight: 800; font-size: 17px; display: flex; align-items: center; gap: 10px;">
          <span>🐛 ${r.pest_name}</span>
          ${r.parcel_crop ? `<span class="badge badge-purple">🌱 ${r.parcel_crop}</span>` : ''}
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${getPestSeverityBadge(r.severity)}
          ${getPestStatusBadge(r)}
        </div>
      </div>

      <div class="text-sm" style="color: #cbd5e1; margin-bottom: 12px; line-height: 1.5;">
        ${r.description || 'Sin descripción detallada.'}
      </div>

      <!-- Ficha de la Parcela y Fecha -->
      <div style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-muted); margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
        ${r.parcel_name ? `<span>🗺️ <strong>Parcela:</strong> ${r.parcel_name}</span>` : ''}
        ${r.altitude_masl ? `<span>🏔️ <strong>Altitud:</strong> ${r.altitude_masl} msnm</span>` : ''}
        <span>📅 <strong>Fecha de Reporte:</strong> ${new Date(r.created_at).toLocaleDateString('es-PE')}</span>
        ${r.advisor_name ? `<span>👨‍🔬 <strong>Asesor Asignado:</strong> ${r.advisor_name}</span>` : ''}
      </div>

      <!-- Fotografía Obligatoria enviada -->
      ${r.photo_url ? `
        <div style="margin: 12px 0; max-width: 360px;">
          <div style="font-size: 11.5px; color: #94a3b8; margin-bottom: 4px;">📸 Fotografía del daño enviada:</div>
          <img src="${r.photo_url}" alt="Foto plaga" style="max-height: 190px; width: 100%; border-radius: 8px; border: 1.5px solid var(--border); object-fit: cover; cursor: pointer; display: block;"
               onclick="AgroMediaUploader.previewEnlarged('${r.photo_url}', 'Foto Plaga: ${r.pest_name.replace(/'/g, "\\'")}')"
               title="Clic para ampliar imagen">
          <span class="text-xs text-muted" style="display: block; margin-top: 4px;">🔍 Clic en la foto para ver en pantalla completa</span>
        </div>
      ` : ''}

      <!-- DICTAMEN TÉCNICO Y RECOMENDACIÓN DEL ASESOR -->
      ${r.advisor_response ? `
        <div style="margin-top: 14px; padding: 16px; background: rgba(34,197,94,0.1); border-radius: 8px; border-left: 4px solid #22c55e;">
          <div style="color: #4ade80; font-weight: 700; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
            <span>👨‍🔬 Dictamen de ${r.advisor_name || 'Asesor Técnico Colegiado'}:</span>
            ${r.responded_at ? `<span class="text-xs text-muted">${new Date(r.responded_at).toLocaleString('es-PE')}</span>` : ''}
          </div>
          <div style="color: #f1f5f9; font-size: 13.5px; line-height: 1.6; margin-bottom: 12px;">
            ${r.advisor_response}
          </div>

          <!-- Materiales Adjuntos (Video / PDF) -->
          ${(r.attachment_doc_url || r.attachment_video_url) ? `
            <div style="margin-top: 10px; padding: 10px; background: rgba(15, 23, 42, 0.7); border-radius: 6px; border: 1px dashed var(--border);">
              <div style="font-size: 12px; font-weight: 700; color: #38bdf8; margin-bottom: 6px;">📎 Materiales Educativos y Guías Técnicas:</div>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                ${r.attachment_doc_url ? `
                  <a href="${r.attachment_doc_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    <span>📄</span>
                    <strong>Descargar Guía Técnica (PDF)</strong>
                  </a>
                ` : ''}
                ${r.attachment_video_url ? `
                  <a href="${r.attachment_video_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    <span>🎬</span>
                    <strong>Ver Video Explicativo</strong>
                  </a>
                ` : ''}
              </div>
            </div>
          ` : ''}

          <!-- SEGUIMIENTO DE PLAGAS: FEEDBACK DEL AGRICULTOR -->
          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-bottom: 8px;">
              🔄 Seguimiento del Tratamiento: ¿La plaga fue controlada en tu parcela?
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn btn-sm btn-primary" style="background: #16a34a; font-weight: 700;"
                      onclick="handleFarmerPestFeedback(${r.id}, 'extinguida')">
                ✅ Confirmar Plaga Extinguida / Erradicada
              </button>
              <button class="btn btn-sm btn-danger" style="font-weight: 700;"
                      onclick="showReportPersistsModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}')">
                ⚠️ Reportar que la Plaga Persiste
              </button>
              <button class="btn btn-sm btn-secondary" onclick="showPestResponsesHistory(${r.id})">
                📜 Ver Historial de Recomendaciones (${r.response_count || 1})
              </button>
            </div>
          </div>
        </div>
      ` : `
        <div style="margin-top: 12px; padding: 12px; background: rgba(245, 158, 11, 0.1); border-radius: 6px; font-size: 13px; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
          <span>⏳</span>
          <span>Tu reporte ha sido notificado al equipo de asesores técnicos de AgroPasco. Pronto recibirás un plan de manejo biológico y control fitosanitario.</span>
        </div>
      `}
    </div>
  `;
}

// Modal para que el Agricultor reporte una plaga con FOTOGRAFÍA OBLIGATORIA
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

  modal.innerHTML = `
    <div class="modal" style="max-width: 640px;">
      <div class="modal-header">
        <h3>🐛 Reportar Plaga o Síntoma con Fotografía Obligatoria</h3>
        <button class="modal-close" onclick="document.getElementById('pest-report-modal').remove()">✕</button>
      </div>

      <div style="padding: 10px 14px; background: rgba(59, 130, 246, 0.12); border-left: 4px solid #3b82f6; border-radius: 6px; margin-bottom: 14px; font-size: 12.5px; color: #93c5fd;">
        📸 <strong>Fotografía Obligatoria:</strong> El asesor técnico necesita observar visualmente las hojas, tubérculos, tallos o insectos para identificar con precisión la especie y formular el tratamiento correcto.
      </div>

      <form onsubmit="handleCreatePestReport(event)">
        <!-- Parcela Afectada -->
        <div class="form-group">
          <label class="form-label">Parcela Afectada *</label>
          <select class="form-select" id="pr-parcel" onchange="handlePestParcelSelect(this)" required>
            ${parcelsOptions}
          </select>
        </div>

        <!-- Nombre de la Plaga con Sugerencias Comunes -->
        <div class="form-group">
          <label class="form-label">Nombre de la Plaga o Síntoma *</label>
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

        <!-- Ubicación y Severidad -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Caserío o Sector</label>
            <input type="text" class="form-input" id="pr-location-name" placeholder="Ej: Sector San Juan, Yanahuanca">
          </div>
          <div class="form-group">
            <label class="form-label">Severidad Estimada *</label>
            <select class="form-select" id="pr-severity">
              <option value="leve">🟢 Leve (focos aislados en linderos)</option>
              <option value="moderado" selected>🟡 Moderado (10% - 25% del área afectada)</option>
              <option value="grave">🟠 Grave (más del 30% del cultivo)</option>
              <option value="critico">🔴 Crítico (riesgo inminente de pérdida total)</option>
            </select>
          </div>
        </div>

        <input type="hidden" id="pr-lat">
        <input type="hidden" id="pr-lng">

        <!-- Descripción -->
        <div class="form-group">
          <label class="form-label">Descripción Detallada del Síntoma</label>
          <textarea class="form-textarea" id="pr-description" rows="3" placeholder="Describe qué partes de la planta están dañadas (hojas perforadas, tallo quebrado, tubérculo agusanado), coloración amarillenta o presencia de larvas..." required></textarea>
        </div>

        <!-- Fotografía Obligatoria con Cámara o Galería -->
        <div class="form-group" id="pr-photo-group" style="padding: 12px; border-radius: 8px; border: 1.5px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2);">
          ${AgroMediaUploader.render({
            id: 'pr-photo',
            folder: 'pests',
            label: 'Fotografía de la Plaga (Cámara en Vivo o Subir Imagen) — OBLIGATORIA *'
          })}
          <div id="pr-photo-error" style="display: none; color: #ef4444; font-size: 12px; margin-top: 6px; font-weight: 600;">
            ⚠️ Debes adjuntar obligatoriamente una fotografía antes de enviar el reporte.
          </div>
        </div>

        <button type="submit" id="pr-submit-btn" class="btn btn-primary btn-block btn-lg" style="margin-top: 18px; font-weight: 800;">
          🚀 Enviar Reporte con Evidencia al Asesor Técnico
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

// Envío del reporte validando estrictamente la fotografía
async function handleCreatePestReport(e) {
  e.preventDefault();
  const photoUrl = document.getElementById('pr-photo-value')?.value;
  const photoGroup = document.getElementById('pr-photo-group');
  const photoError = document.getElementById('pr-photo-error');

  // Validación en frontend de fotografía obligatoria
  if (!photoUrl || photoUrl.trim() === '') {
    if (photoGroup) {
      photoGroup.style.borderColor = '#ef4444';
      photoGroup.style.boxShadow = '0 0 12px rgba(239,68,68,0.3)';
    }
    if (photoError) photoError.style.display = 'block';
    showToast('⚠️ Debes adjuntar obligatoriamente al menos una fotografía de la plaga antes de enviar.', 'error');
    return;
  }

  const parcelId = document.getElementById('pr-parcel').value;
  const latVal = parseFloat(document.getElementById('pr-lat').value) || null;
  const lngVal = parseFloat(document.getElementById('pr-lng').value) || null;
  const severityVal = document.getElementById('pr-severity')?.value || 'moderado';

  const btn = document.getElementById('pr-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando reporte con evidencia...'; }

  const result = await api.createPestReport({
    pest_name: document.getElementById('pr-pest-name').value,
    severity: severityVal,
    parcel_id: parcelId ? parseInt(parcelId) : null,
    description: document.getElementById('pr-description').value,
    photo_url: photoUrl.trim(),
    location_lat: latVal,
    location_lng: lngVal
  });

  if (result.success) {
    document.getElementById('pest-report-modal')?.remove();
    showToast('¡Reporte con fotografía enviado exitosamente al Asesor Técnico!', 'success');
    navigateTo('/pest-reports');
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Enviar Reporte al Asesor Técnico'; }
    showToast(result.error || 'Error al enviar reporte', 'error');
  }
}

// Confirmación de seguimiento por el agricultor (Extinguida o Persiste)
async function handleFarmerPestFeedback(reportId, feedbackStatus, notes = '') {
  const result = await api.confirmPestFeedback(reportId, {
    feedback_status: feedbackStatus,
    feedback_notes: notes
  });

  if (result.success) {
    showToast(result.message || 'Estado de seguimiento actualizado correctamente.', 'success');
    navigateTo('/pest-reports');
  } else {
    showToast(result.error || 'Error al actualizar estado.', 'error');
  }
}

function showReportPersistsModal(reportId, pestName) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'persist-modal';

  modal.innerHTML = `
    <div class="modal" style="max-width: 500px;">
      <div class="modal-header">
        <h3>⚠️ Reportar que la Plaga Persiste</h3>
        <button class="modal-close" onclick="document.getElementById('persist-modal').remove()">✕</button>
      </div>

      <div style="padding: 10px; background: rgba(239,68,68,0.12); border-left: 4px solid #ef4444; border-radius: 6px; margin-bottom: 14px; font-size: 13px; color: #fca5a5;">
        El reporte volverá al estado <strong>No Resuelta</strong> y el Asesor Técnico recibirá una alerta urgente para reformular la dosis o cambiar el método de control.
      </div>

      <form onsubmit="handlePersistSubmit(event, ${reportId})">
        <div class="form-group">
          <label class="form-label">Comentarios u observaciones adicionales:</label>
          <textarea class="form-textarea" id="persist-notes" rows="3" placeholder="Ej: Se aplicó el biol hace 4 días pero aún se observan larvas vivas en el envés de la hoja..." required></textarea>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('persist-modal').remove()">Cancelar</button>
          <button type="submit" class="btn btn-danger" style="font-weight: 700;">Confirmar: La Plaga Persiste</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

function handlePersistSubmit(e, reportId) {
  e.preventDefault();
  const notes = document.getElementById('persist-notes').value;
  document.getElementById('persist-modal')?.remove();
  handleFarmerPestFeedback(reportId, 'persiste', notes);
}

// Modal para ver el historial de respuestas y materiales de un reporte
async function showPestResponsesHistory(reportId) {
  const res = await api.getPestReportResponses(reportId);
  const responses = res.data || [];

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'history-modal';

  modal.innerHTML = `
    <div class="modal" style="max-width: 620px;">
      <div class="modal-header">
        <h3>📜 Historial de Recomendaciones Técnicas</h3>
        <button class="modal-close" onclick="document.getElementById('history-modal').remove()">✕</button>
      </div>

      <div style="max-height: 480px; overflow-y: auto; padding-right: 6px;">
        ${responses.length > 0 ? responses.map((resp, idx) => `
          <div style="margin-bottom: 14px; padding: 14px; background: rgba(15,23,42,0.85); border-radius: 8px; border-left: 4px solid #38bdf8;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <strong style="color: #38bdf8; font-size: 13.5px;">Dictamen #${idx + 1} — ${resp.advisor_name || 'Asesor Técnico'}</strong>
              <span class="text-xs text-muted">${new Date(resp.created_at).toLocaleString('es-PE')}</span>
            </div>
            <div style="font-size: 13px; color: #e2e8f0; line-height: 1.5; margin-bottom: 8px;">
              ${resp.response_text}
            </div>
            ${resp.attachment_doc_url ? `
              <div style="margin-top: 6px;">
                <a href="${resp.attachment_doc_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 11px;">
                  📄 Descargar Guía Adjunta (PDF)
                </a>
              </div>
            ` : ''}
            ${resp.attachment_video_url ? `
              <div style="margin-top: 6px;">
                <a href="${resp.attachment_video_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 11px;">
                  🎬 Ver Video Adjunto
                </a>
              </div>
            ` : ''}
          </div>
        `).join('') : `
          <div class="empty-state" style="padding: 20px;">
            <div class="empty-state-text">No hay dictámenes previos registrados.</div>
          </div>
        `}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ===== 2. VISTA DEL ASESOR TÉCNICO: GESTIÓN DE PLAGAS Y MONITOREO EN MAPA =====
async function renderAdvisorPestReportsPage() {
  const result = await api.getPestReports();
  const reports = result.data || [];

  // Clasificación estricta en 3 estados según Requerimiento 6
  const unresolved = reports.filter(r => (r.status === 'no_resuelto' || r.status === 'pendiente' || r.control_status === 'no_resuelto'));
  const inProcess = reports.filter(r => (r.control_status === 'en_proceso' || r.status === 'en_proceso'));
  const resolved = reports.filter(r => (r.status === 'resuelto' || r.control_status === 'resuelto'));

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg flex-wrap gap-sm">
        <div>
          <h3 style="font-size: 20px; font-weight: 800;">🐛 Panel de Gestión de Plagas e Infecciones Territoriales</h3>
          <p class="text-sm text-muted">Supervisión satelital de parcelas afectadas, emisión de recomendaciones con material multimedia y seguimiento fitosanitario.</p>
        </div>
      </div>

      <!-- Resumen estadístico por semáforo -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--red-500)">
          <div class="stat-card-icon">🔴</div>
          <div class="stat-card-value">${unresolved.length}</div>
          <div class="stat-card-label">Plagas No Resueltas (Urgente)</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">🟡</div>
          <div class="stat-card-value">${inProcess.length}</div>
          <div class="stat-card-label">En Proceso de Control</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">🟢</div>
          <div class="stat-card-value">${resolved.length}</div>
          <div class="stat-card-label">Plagas Resueltas / Extinguidas</div>
        </div>
      </div>

      <!-- FICHA TÉCNICA DINÁMICA DE PARCELA ENFOCADA (Requerimiento 1) -->
      <div id="focused-parcel-card" class="card mb-lg" style="display: none; border-left: 6px solid #ef4444; background: linear-gradient(135deg, rgba(239,68,68,0.1), rgba(15,23,42,0.95));">
        <!-- Inyectado dinámicamente al presionar Ubicar Parcela en el Mapa -->
      </div>

      <!-- MAPA SATELITAL DE INFECCIONES Y PARCELAS -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden; border: 1.5px solid var(--border);">
        <div style="background: rgba(15, 23, 42, 0.95); padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">🛰️</span>
            <strong style="color: #ffffff; font-size: 14px;">Mapa Satelital de Parcelas y Zonas de Infección</strong>
          </div>
          <span id="pest-map-beacon-text" class="badge badge-amber">Haz clic en "🗺️ Ubicar Parcela en el Mapa" para inspeccionar límites</span>
        </div>
        <div id="pest-report-map" class="map-container" style="height: 480px; width: 100%;"></div>
      </div>

      <!-- SECCIÓN 1: PLAGAS NO RESUELTAS (ROJO) -->
      <div class="card mb-lg" style="border-left: 6px solid #ef4444;">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">🔴</span>
            <span>Plagas No Resueltas (${unresolved.length} casos)</span>
          </div>
          <span class="badge badge-red">Prioridad Máxima</span>
        </div>

        ${unresolved.length > 0 ? `
          <div style="display: grid; gap: 14px;">
            ${unresolved.map(r => renderAdvisorReportCard(r, 'unresolved')).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-title">No hay plagas pendientes de respuesta técnica</div>
            <div class="empty-state-text">Todos los reportes cuentan con dictamen o están en proceso de control.</div>
          </div>
        `}
      </div>

      <!-- SECCIÓN 2: PLAGAS EN PROCESO DE CONTROL (ÁMBAR) -->
      <div class="card mb-lg" style="border-left: 6px solid #f59e0b;">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">🟡</span>
            <span>Plagas En Proceso de Control (${inProcess.length} en seguimiento)</span>
          </div>
          <span class="badge badge-amber">En Monitoreo de Eficacia</span>
        </div>

        ${inProcess.length > 0 ? `
          <div style="display: grid; gap: 14px;">
            ${inProcess.map(r => renderAdvisorReportCard(r, 'in_process')).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 20px;">
            <div class="empty-state-text">No hay reportes actualmente en proceso de control.</div>
          </div>
        `}
      </div>

      <!-- SECCIÓN 3: PLAGAS RESUELTAS / EXTINGUIDAS (VERDE) -->
      <div class="card" style="border-left: 6px solid #22c55e;">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon">🟢</span>
            <span>Plagas Resueltas y Extinguidas (${resolved.length} erradicadas)</span>
          </div>
          <span class="badge badge-green">Focos Cerrados</span>
        </div>

        ${resolved.length > 0 ? `
          <div style="display: grid; gap: 14px;">
            ${resolved.map(r => renderAdvisorReportCard(r, 'resolved')).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: 20px;">
            <div class="empty-state-text">Los reportes confirmados como extinguidos aparecerán aquí.</div>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderAdvisorReportCard(r, category) {
  const isUnresolved = category === 'unresolved';
  const isInProcess = category === 'in_process';
  const isResolved = category === 'resolved';

  const statusColor = isResolved ? '#22c55e' : isInProcess ? '#f59e0b' : '#ef4444';

  return `
    <div class="alert-card" style="background: rgba(15, 23, 42, 0.85); border: 1.5px solid ${statusColor}; padding: 18px; border-radius: 8px;">
      <span class="alert-icon" style="font-size: 26px;">🐛</span>
      <div class="alert-content" style="flex: 1;">
        <div class="flex items-center justify-between mb-sm flex-wrap gap-sm">
          <div style="font-size: 16.5px; font-weight: 800; color: #ffffff;">
            ${r.pest_name}
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${getPestSeverityBadge(r.severity)}
            ${getPestStatusBadge(r)}
          </div>
        </div>

        <div style="font-size: 13.5px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.5;">
          ${r.description || 'Sin descripción detallada proporcionada por el agricultor.'}
        </div>

        <!-- Ficha técnica resumida -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
          <div style="font-size: 12.5px;">
            <span class="text-muted">👨‍🌾 Agricultor:</span>
            <strong style="color: #60a5fa;">${r.farmer_name || 'Agricultor'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🗺️ Parcela:</span>
            <strong style="color: #4ade80;">${r.parcel_name || 'Parcela'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🌱 Cultivo:</span>
            <strong>${r.parcel_crop || 'No especificado'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">🏔️ Altitud:</span>
            <strong style="color: #38bdf8;">${r.altitude_masl ? r.altitude_masl + ' msnm' : '4380 msnm'}</strong>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">📍 Ubicación:</span>
            <span>${r.farmer_location || r.parcel_notes || 'Región Pasco'}</span>
          </div>
          <div style="font-size: 12.5px;">
            <span class="text-muted">📅 Fecha Reporte:</span>
            <span>${new Date(r.created_at).toLocaleDateString('es-PE')}</span>
          </div>
        </div>

        <!-- Fotografía Obligatoria de Campo -->
        ${r.photo_url ? `
          <div style="margin-bottom: 14px; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--border); max-width: 420px; background: #000;">
            <div style="background: rgba(15,23,42,0.9); padding: 6px 12px; font-size: 12px; color: #4ade80; display: flex; justify-content: space-between; align-items: center;">
              <span>📸 Evidencia fotográfica de la plaga:</span>
              <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px; padding: 2px 8px;"
                      onclick="AgroMediaUploader.previewEnlarged('${r.photo_url}', 'Foto Plaga: ${r.pest_name.replace(/'/g, "\\'")}')">
                🔍 Ver Completa
              </button>
            </div>
            <img src="${r.photo_url}" alt="Foto plaga" style="max-height: 200px; width: 100%; object-fit: contain; cursor: pointer; display: block;"
                 onclick="AgroMediaUploader.previewEnlarged('${r.photo_url}', 'Foto Plaga: ${r.pest_name.replace(/'/g, "\\'")}')">
          </div>
        ` : `
          <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(239,68,68,0.1); border-radius: 6px; font-size: 12px; color: #f87171;">
            ⚠️ Sin fotografía registrada (caso anómalo legado).
          </div>
        `}

        <!-- Última recomendación si existe -->
        ${r.advisor_response ? `
          <div style="margin-bottom: 12px; padding: 12px; background: rgba(34,197,94,0.12); border-radius: 6px; border-left: 3px solid #22c55e;">
            <div style="font-size: 12px; color: #4ade80; font-weight: 700; margin-bottom: 3px;">
              ✅ Último Dictamen Técnico Emitido:
            </div>
            <div style="font-size: 13px; color: #f1f5f9; line-height: 1.5;">${r.advisor_response}</div>
            ${(r.attachment_doc_url || r.attachment_video_url) ? `
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                ${r.attachment_doc_url ? `<a href="${r.attachment_doc_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 11px;">📄 Guía PDF</a>` : ''}
                ${r.attachment_video_url ? `<a href="${r.attachment_video_url}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 11px;">🎬 Video Explicativo</a>` : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Botones de Acción Principales (Persistentes y visibles) -->
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px;">
          <!-- BOTÓN: Ubicar Parcela en el Mapa (Requerimiento 1) -->
          <button class="btn btn-sm btn-secondary" style="background: rgba(59, 130, 246, 0.15); border-color: #3b82f6; color: #60a5fa; font-weight: 700;"
                  onclick="focusPestReportOnMap(${r.id})">
            🗺️ Ubicar Parcela en el Mapa
          </button>

          <!-- BOTÓN: Responder con Recomendación Técnica (Requerimiento 3) -->
          <button class="btn btn-sm btn-primary" style="font-weight: 700;"
                  onclick="showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '${(r.advisor_response || '').replace(/'/g, "\\'").replace(/\n/g, ' ')}')">
            📋 ${r.advisor_response ? 'Actualizar / Emitir Nueva Recomendación' : 'Responder con Recomendación Técnica'}
          </button>

          <button class="btn btn-sm btn-secondary" onclick="showPestResponsesHistory(${r.id})">
            📜 Ver Historial (${r.response_count || (r.advisor_response ? 1 : 0)})
          </button>
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
    const isUnresolved = r.status === 'no_resuelto' || r.status === 'pendiente' || r.control_status === 'no_resuelto';
    const isInProcess = r.control_status === 'en_proceso' || r.status === 'en_proceso';

    let color = '#22c55e'; // Resuelta
    if (isUnresolved) color = '#ef4444'; // No resuelta
    else if (isInProcess) color = '#f59e0b'; // En proceso

    if (r.geo_json) {
      try {
        const geo = JSON.parse(r.geo_json);
        const coords = geo.geometry?.coordinates?.[0]?.map(c => [c[1], c[0]]) || [];
        if (coords.length > 0) {
          layer = L.polygon(coords, {
            color: color,
            weight: isUnresolved ? 4 : 2,
            fillColor: color,
            fillOpacity: isUnresolved ? 0.45 : 0.25
          });
          bounds.push(...coords);
        }
      } catch (e) {}
    }

    if (!layer && (r.location_lat || r.center_lat) && (r.location_lng || r.center_lng)) {
      const lat = r.location_lat || r.center_lat;
      const lng = r.location_lng || r.center_lng;
      layer = L.marker([lat, lng], {
        icon: L.divIcon({
          html: `<div style="font-size: 26px; filter: drop-shadow(0 0 8px ${color});">🐛</div>`,
          className: 'custom-marker-container',
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        })
      });
      bounds.push([lat, lng]);
    }

    if (layer) {
      layer.bindPopup(`
        <div style="font-family: Inter, sans-serif; min-width: 230px;">
          <strong style="font-size: 14px; color: ${color};">🐛 ${r.pest_name}</strong><br>
          <div style="font-size: 12px; margin: 6px 0;">
            👨‍🌾 <strong>${r.farmer_name || 'Agricultor'}</strong><br>
            🗺️ Parcela: <strong>${r.parcel_name || 'Sin nombre'}</strong><br>
            🌱 Cultivo: <strong>${r.parcel_crop || 'No especificado'}</strong><br>
            🏔️ Altitud: <strong>${r.altitude_masl || 4380} msnm</strong><br>
            <em>Estado: ${isUnresolved ? '🔴 No Resuelta' : isInProcess ? '🟡 En Proceso' : '🟢 Resuelta'}</em>
          </div>
          ${r.photo_url ? `
            <div style="margin: 6px 0; text-align: center;">
              <img src="${r.photo_url}" alt="Foto plaga" style="max-height: 100px; max-width: 100%; border-radius: 4px; object-fit: cover; cursor: pointer;"
                   onclick="AgroMediaUploader.previewEnlarged('${r.photo_url}', 'Foto Plaga: ${r.pest_name.replace(/'/g, "\\'")}')">
            </div>
          ` : ''}
          <button class="btn btn-sm btn-primary btn-block" style="margin-top: 6px;"
                  onclick="showRespondModal(${r.id}, '${r.pest_name.replace(/'/g, "\\'")}', '${(r.advisor_response || '').replace(/'/g, "\\'")}')">
            📋 Responder con Dictamen
          </button>
        </div>
      `);
      layer.addTo(activeInfectionLayer);
    }
  });

  if (bounds.length > 0) {
    advisorPestMap.fitBounds(bounds, { padding: [30, 30] });
  }
}

// ===== REQUERIMIENTO 1: UBICAR PARCELA EN EL MAPA CON POLÍGONO Y FICHA TÉCNICA =====
async function focusPestReportOnMap(reportId) {
  const result = await api.getPestReports();
  const report = (result.data || []).find(r => r.id === reportId);

  if (!report) {
    showToast('Reporte fitosanitario no encontrado.', 'error');
    return;
  }

  // Comprobar si existen coordenadas o geo_json válidos
  let centerLat = report.location_lat || report.center_lat;
  let centerLng = report.location_lng || report.center_lng;
  let polygonCoords = [];

  if (report.geo_json) {
    try {
      const geo = typeof report.geo_json === 'string' ? JSON.parse(report.geo_json) : report.geo_json;
      const coords = geo.geometry?.coordinates?.[0] || geo.coordinates?.[0] || [];
      polygonCoords = coords.map(c => [c[1], c[0]]);

      if (polygonCoords.length > 0 && (!centerLat || !centerLng)) {
        centerLat = polygonCoords.reduce((s, c) => s + c[0], 0) / polygonCoords.length;
        centerLng = polygonCoords.reduce((s, c) => s + c[1], 0) / polygonCoords.length;
      }
    } catch (e) {
      console.warn('Error al parsear GeoJSON de parcela:', e);
    }
  }

  // Si la parcela no tiene coordenadas válidas, mostrar error claro (Requerimiento 1)
  if (!centerLat || !centerLng) {
    showToast('⚠️ Error: Esta parcela no cuenta con coordenadas geográficas ni polígono GeoJSON registrado.', 'error');
    return;
  }

  // Asegurar inicialización del mapa
  if (!advisorPestMap) {
    initPestReportMap();
  }

  // Scroll suave al mapa
  const mapEl = document.getElementById('pest-report-map');
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Actualizar banner informativo del mapa
  const beaconText = document.getElementById('pest-map-beacon-text');
  if (beaconText) {
    beaconText.className = 'badge badge-red';
    beaconText.innerHTML = `⚠️ Inspección activa: <strong>${report.parcel_name || 'Parcela'}</strong> (${report.pest_name})`;
  }

  // Limpiar polígono resaltado anterior si existía
  if (highlightedPolygonLayer) {
    advisorPestMap.removeLayer(highlightedPolygonLayer);
    highlightedPolygonLayer = null;
  }

  // Centrar mapa con zoom adecuado (zoom 16) y dibujar polígono con límites destacados
  advisorPestMap.setView([centerLat, centerLng], 16);

  if (polygonCoords.length > 0) {
    highlightedPolygonLayer = L.polygon(polygonCoords, {
      color: '#fbbf24',
      weight: 6,
      fillColor: '#ef4444',
      fillOpacity: 0.5,
      dashArray: '8, 8'
    }).addTo(advisorPestMap);

    highlightedPolygonLayer.bindPopup(`
      <div style="font-family: Inter, sans-serif; min-width: 240px;">
        <div style="color: #ef4444; font-weight: 800; font-size: 15px;">⚠️ FOCO FITOSANITARIO ACTIVO</div>
        <strong>Parcela:</strong> ${report.parcel_name || 'Parcela sin nombre'}<br>
        👨‍🌾 <strong>Agricultor Dueño:</strong> ${report.farmer_name || '—'}<br>
        🌱 <strong>Producto Sembrado:</strong> ${report.parcel_crop || '—'}<br>
        🏔️ <strong>Altitud:</strong> ${report.altitude_masl || 4380} msnm<br>
        📐 <strong>Superficie:</strong> ${report.area_hectares || 0} ha<br>
        📍 <strong>Ubicación:</strong> ${report.farmer_location || report.parcel_notes || 'Pasco'}
      </div>
    `).openPopup();

    setTimeout(() => {
      advisorPestMap.fitBounds(highlightedPolygonLayer.getBounds(), { padding: [40, 40] });
    }, 200);
  } else {
    L.popup()
      .setLatLng([centerLat, centerLng])
      .setContent(`
        <div style="font-family: Inter, sans-serif;">
          <strong style="color: #ef4444;">🐛 Foco de Plaga: ${report.pest_name}</strong><br>
          👨‍🌾 ${report.farmer_name || 'Agricultor'}<br>
          🗺️ ${report.parcel_name || 'Parcela'} (${report.altitude_masl || 4380} msnm)
        </div>
      `)
      .openOn(advisorPestMap);
  }

  // RENDERIZAR FICHA TÉCNICA COMPLETA DE LA PARCELA EN EL PANEL
  const focusedCard = document.getElementById('focused-parcel-card');
  if (focusedCard) {
    focusedCard.style.display = 'block';
    focusedCard.innerHTML = `
      <div class="flex items-center justify-between mb-sm flex-wrap gap-sm">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 26px;">🗺️</span>
          <div>
            <h4 style="font-size: 17px; font-weight: 800; color: #ffffff; margin: 0;">Ficha Técnica: ${report.parcel_name || 'Parcela Afectada'}</h4>
            <span class="text-xs text-muted">Límites territoriales y coordenadas georreferenciadas enfocadas en el visor satelital</span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('focused-parcel-card').style.display='none'">✕ Cerrar Ficha</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px;">
        <div style="background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border-left: 3px solid #60a5fa;">
          <div class="text-xs text-muted">👨‍🌾 Agricultor Dueño</div>
          <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-top: 2px;">
            ${report.farmer_name || 'Agricultor de Pasco'}
          </div>
          ${report.farmer_phone ? `<div class="text-xs text-muted">📞 ${report.farmer_phone}</div>` : ''}
        </div>

        <div style="background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border-left: 3px solid #4ade80;">
          <div class="text-xs text-muted">🌾 Variedad / Producto Sembrado</div>
          <div style="font-size: 15px; font-weight: 700; color: #4ade80; margin-top: 2px;">
            ${report.parcel_crop ? '🌱 ' + report.parcel_crop.toUpperCase() : 'Sin cultivo especificado'}
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border-left: 3px solid #38bdf8;">
          <div class="text-xs text-muted">🏔️ Altitud Exacta</div>
          <div style="font-size: 15px; font-weight: 700; color: #38bdf8; margin-top: 2px;">
            ${report.altitude_masl || 4380} msnm
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border-left: 3px solid #fbbf24;">
          <div class="text-xs text-muted">📐 Área Calculada</div>
          <div style="font-size: 15px; font-weight: 700; color: #fbbf24; margin-top: 2px;">
            ${report.area_hectares || 0} hectáreas
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.35); padding: 12px; border-radius: 8px; border-left: 3px solid #ef4444; grid-column: span 2;">
          <div class="text-xs text-muted">📍 Ubicación Exacta y Coordenadas</div>
          <div style="font-size: 13.5px; font-weight: 600; color: #f1f5f9; margin-top: 2px;">
            ${report.farmer_location || report.parcel_notes || 'Región Pasco'} · Lat: ${centerLat.toFixed(5)}, Lng: ${centerLng.toFixed(5)}
          </div>
        </div>
      </div>
    `;
    focusedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  showToast(`Parcela "${report.parcel_name || 'afectada'}" ubicada con sus límites en el mapa`, 'success');
}

// ===== REQUERIMIENTO 3: MODAL PERSISTENTE PARA RESPONDER CON RECOMENDACIÓN TÉCNICA, VIDEO Y PDF =====
function showRespondModal(reportId, pestName, existingResponse = '') {
  // Eliminar modal anterior si existía
  const oldModal = document.getElementById('respond-modal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'respond-modal';

  // MODAL PERSISTENTE: NO se cierra por clics fuera (no modal.onclick con remove)
  modal.style.zIndex = '99999';

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; background: #0b1120; border: 1.5px solid #22c55e;">
      <div class="modal-header" style="border-bottom: 1px solid var(--border); padding-bottom: 12px;">
        <div>
          <h3 style="margin: 0; font-size: 18px; color: #ffffff;">📋 Dictamen y Recomendación Técnica Fitosanitaria</h3>
          <span class="text-xs text-muted">Este formulario es persistente y no se cerrará hasta que confirmes el envío.</span>
        </div>
        <button class="modal-close" onclick="AgroPestResponder.confirmCloseModal()">✕</button>
      </div>

      <div style="padding: 12px; background: rgba(239,68,68,0.12); border-radius: 8px; border-left: 4px solid #ef4444; margin: 14px 0;">
        <div style="font-size: 12.5px; color: #fca5a5; font-weight: 700;">Plaga en diagnóstico:</div>
        <div style="font-size: 16px; font-weight: 800; color: #ffffff; margin-top: 2px;">🐛 ${pestName}</div>
      </div>

      <form onsubmit="AgroPestResponder.handleSubmit(event, ${reportId})">
        <!-- Requerimiento 4: Estado del Control -->
        <div class="form-group">
          <label class="form-label">Estado Inicial del Control Fitosanitario *</label>
          <select class="form-select" id="respond-control-status" required>
            <option value="en_proceso" selected>🟡 En Proceso de Control (Requiere aplicación de tratamiento y seguimiento)</option>
            <option value="resuelto">🟢 Resuelto (Problema fitosanitario menor / resuelto con recomendaciones previas)</option>
          </select>
        </div>

        <!-- Dictamen agronómico -->
        <div class="form-group">
          <label class="form-label">Dictamen Técnico y Plan de Manejo *</label>
          <textarea class="form-textarea" id="respond-text" rows="5"
                    placeholder="Detalla las instrucciones agronómicas: dosificación biológica (ej. Beauveria bassiana 2kg/ha), bioles enriquecidos, podas sanitarias, aporque alto, frecuencia de aplicación y precauciones..." required>${existingResponse || ''}</textarea>
        </div>

        <!-- Atajos de prescripción rápida -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;">
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Aplicar Beauveria bassiana (cepa andina) en dosis de 2 kg/ha al atardecer para control microbiológico del gorgojo.'">
            + Beauveria bassiana
          </button>
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Realizar aporque alto preventivo para evitar que las larvas alcancen los tubérculos en formación.'">
            + Aporque Alto
          </button>
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Aplicar caldo sulfocálcico o extracto de cola de caballo al 10% para frenar el avance de tizón y manchas foliares.'">
            + Caldo Sulfocálcico
          </button>
          <button type="button" class="btn btn-sm btn-secondary" style="font-size: 11px;" onclick="document.getElementById('respond-text').value += ' Instalar mantas de cosecha y trampas de caída en el perímetro del campo.'">
            + Trampas Físicas
          </button>
        </div>

        <!-- Requerimiento 3: Adjuntos Multimedia (Videos y PDFs) -->
        <div style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border); border-radius: 8px; padding: 14px; margin-bottom: 16px;">
          <div style="font-weight: 700; font-size: 13px; color: #38bdf8; margin-bottom: 10px;">
            📎 Materiales Educativos Adicionales para el Agricultor (Opcional)
          </div>

          <!-- Documento PDF o Guía Técnica -->
          <div class="form-group" style="margin-bottom: 12px;">
            ${AgroMediaUploader.renderAttachmentUploader({
              id: 'respond-doc',
              folder: 'documents',
              label: 'Documento PDF o Guía Técnica Fitosanitaria'
            })}
          </div>

          <!-- Video Explicativo -->
          <div class="form-group">
            ${AgroMediaUploader.renderAttachmentUploader({
              id: 'respond-video',
              folder: 'videos',
              label: 'Video Explicativo o Demostración de Aplicación (MP4 / WebM)'
            })}
          </div>
        </div>

        <!-- Botones de Confirmación y Cancelación -->
        <div style="display: flex; gap: 12px; justify-content: flex-end; align-items: center;">
          <button type="button" class="btn btn-secondary" onclick="AgroPestResponder.confirmCloseModal()">
            Cancelar
          </button>
          <button type="submit" id="respond-submit-btn" class="btn btn-primary btn-lg" style="font-weight: 800; background: linear-gradient(135deg, #22c55e, #16a34a);">
            ✅ Confirmar y Enviar Dictamen al Agricultor
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

// Namespace para el envío y persistencia del dictamen
const AgroPestResponder = {
  confirmCloseModal: function() {
    const text = document.getElementById('respond-text')?.value;
    if (text && text.trim().length > 10) {
      if (!confirm('¿Seguro que deseas salir? Se perderá el texto ingresado.')) {
        return;
      }
    }
    document.getElementById('respond-modal')?.remove();
  },

  handleSubmit: async function(e, reportId) {
    e.preventDefault();
    const responseText = document.getElementById('respond-text').value;
    const controlStatus = document.getElementById('respond-control-status').value;
    const docUrl = document.getElementById('respond-doc-value')?.value || null;
    const videoUrl = document.getElementById('respond-video-value')?.value || null;

    const btn = document.getElementById('respond-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando dictamen técnico...'; }

    const result = await api.respondPestReport(reportId, {
      advisor_response: responseText,
      control_status: controlStatus,
      attachment_doc_url: docUrl,
      attachment_video_url: videoUrl,
      attachment_doc_name: docUrl ? 'Guía Técnica Fitosanitaria' : null
    });

    if (result.success) {
      document.getElementById('respond-modal')?.remove();
      showToast('✅ Dictamen técnico y materiales enviados al agricultor exitosamente.', 'success');
      navigateTo('/advisor/pest-reports');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar y Enviar Dictamen'; }
      showToast(result.error || 'Error al responder reporte fitosanitario', 'error');
    }
  }
};
