/**
 * AgroPasco — Módulo de Gestión de Cultivos
 */

async function renderCropsPage() {
  const result = await api.getCrops();
  const crops = result.data || [];

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">Mis Cultivos (${crops.length})</h3>
          <p class="text-sm text-muted">Gestiona tus cultivos y registra actividades de cuidado.</p>
        </div>
        <button class="btn btn-primary" onclick="showNewCropModal()">+ Registrar Cultivo</button>
      </div>

      ${crops.length > 0 ? `
        <div class="grid-3">
          ${crops.map(crop => renderCropCard(crop)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">🌱</div>
          <div class="empty-state-title">No tienes cultivos registrados</div>
          <div class="empty-state-text">Registra tu primer cultivo para comenzar con la asesoría personalizada y trazabilidad digital.</div>
          <button class="btn btn-primary btn-lg" onclick="showNewCropModal()">🌾 Registrar mi primer cultivo</button>
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
    const aiRes = await api.getRecommendations(cropId);
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

function showNewCropModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'crop-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>🌱 Registrar Nuevo Cultivo</h3>
        <button class="modal-close" onclick="document.getElementById('crop-modal').remove()">✕</button>
      </div>
      <form onsubmit="handleCreateCrop(event)">
        <div class="form-group">
          <label class="form-label">Nombre del Cultivo</label>
          <input type="text" class="form-input" id="crop-name" placeholder="Ej: Papa Huayro - Parcela Norte" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Cultivo</label>
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
            <input type="text" class="form-input" id="crop-variety" placeholder="Ej: Huayro, Canchan...">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Área (hectáreas)</label>
            <input type="number" class="form-input" id="crop-area" step="0.1" placeholder="0.5" value="0.5">
          </div>
          <div class="form-group">
            <label class="form-label">Altitud (msnm)</label>
            <input type="number" class="form-input" id="crop-altitude" placeholder="4380" value="4380">
          </div>
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
              <option value="sembrado">🌱 Sembrado</option>
              <option value="crecimiento">🌿 En Crecimiento</option>
              <option value="floracion">🌸 Floración</option>
              <option value="maduracion">🟡 Maduración</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notas (opcional)</label>
          <textarea class="form-textarea" id="crop-notes" placeholder="Observaciones adicionales..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">🌾 Registrar Cultivo</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleCreateCrop(e) {
  e.preventDefault();
  const result = await api.createCrop({
    name: document.getElementById('crop-name').value,
    crop_type: document.getElementById('crop-type').value,
    variety: document.getElementById('crop-variety').value,
    area_hectares: parseFloat(document.getElementById('crop-area').value) || 0,
    altitude_masl: parseInt(document.getElementById('crop-altitude').value) || 4380,
    planting_date: document.getElementById('crop-planting-date').value || null,
    status: document.getElementById('crop-status').value,
    notes: document.getElementById('crop-notes').value
  });

  if (result.success) {
    document.getElementById('crop-modal')?.remove();
    showToast('¡Cultivo registrado exitosamente!', 'success');
    window.location.hash = '#/crops';
    navigateTo('/crops');
  } else {
    showToast(result.error || 'Error al registrar cultivo', 'error');
  }
}

async function handleAddLog(e, cropId) {
  e.preventDefault();
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
