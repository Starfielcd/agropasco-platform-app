/**
 * AgroPasco — Módulo de Asesoría Agrícola Visual por Pasos
 * Diseñado con tarjetas ilustrativas para alta accesibilidad visual
 */

let currentCropFilter = '';
let activeGuideCrop = 'papa';

async function renderAdvisoryPage() {
  const [tipsRes, calendarRes, guideRes] = await Promise.all([
    api.getTips(currentCropFilter ? `crop=${currentCropFilter}` : ''),
    api.getCalendar(),
    api.getPlantingGuide(activeGuideCrop)
  ]);

  const tips = tipsRes.data || [];
  const calendars = calendarRes.data || [];
  const guide = guideRes.data || {};
  const cropTypes = ['papa', 'maca', 'quinua', 'habas', 'cafe', 'olluco', 'mashua', 'general'];
  const guideCrops = ['papa', 'maca', 'quinua', 'habas', 'palto', 'oca'];

  const cropIcons = { papa: '🥔', maca: '🌿', quinua: '🌾', habas: '🫘', palto: '🥑', oca: '🔴' };

  return `
    <div class="page-content">
      <div class="mb-lg">
        <h3 style="font-size: 20px; font-weight: 800; margin-bottom: 4px;">📸 Guía Agrícola Ilustrada Paso a Paso</h3>
        <p class="text-sm text-muted">Aprende las labores de campo con imágenes claras y explicaciones sencillas.</p>
      </div>

      <!-- SECCIÓN 1: GUÍA INTERACTIVA DE SIEMBRA CON IMÁGENES DE CAMPO -->
      <div class="card mb-lg" style="border-left: 4px solid var(--accent);">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🌱</span> Guía de Campo Ilustrada — Selecciona tu Cultivo:</div>
          <span class="badge badge-green">Pasco Agrícola</span>
        </div>

        <!-- Selector de Cultivo -->
        <div class="filter-bar" style="margin-bottom: 20px;">
          ${guideCrops.map(crop => `
            <button class="filter-chip ${activeGuideCrop === crop ? 'active' : ''}" style="font-size: 15px; padding: 10px 18px;" onclick="switchGuideCrop('${crop}')">
              ${cropIcons[crop] || '🌾'} ${crop.toUpperCase()}
            </button>
          `).join('')}
        </div>

        ${guide.crop_name ? `
          <!-- 4 TARJETAS FOTOGRÁFICAS DE ESPECIFICACIONES -->
          <div style="font-weight: 800; font-size: 15px; color: var(--green-400); margin-bottom: 12px;">
            📌 4 Pasos Fundamentales para Sembrar ${guide.crop_name}:
          </div>

          <div class="grid-2 mb-lg" style="gap: 16px;">
            <!-- Paso 1: Suelo -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
              <img src="${FIELD_IMAGES.preparacion_suelo}" alt="Preparación del Suelo" style="width: 100%; height: 160px; object-fit: cover;">
              <div style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <strong style="font-size: 15px; color: var(--green-400);">Paso 1: Preparación del Suelo</strong>
                  <span class="badge badge-green">Paso 1</span>
                </div>
                <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                  ${guide.soil_prep || 'Mullir el suelo a 30 cm de profundidad y desinfectar antes de sembrar.'}
                </p>
              </div>
            </div>

            <!-- Paso 2: Siembra / Densidad -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
              <img src="${FIELD_IMAGES.siembra}" alt="Siembra" style="width: 100%; height: 160px; object-fit: cover;">
              <div style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <strong style="font-size: 15px; color: var(--blue-400);">Paso 2: Distancia y Siembra</strong>
                  <span class="badge badge-blue">Paso 2</span>
                </div>
                <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                  ${guide.density || 'Sembrar a la distancia recomendada entre surcos y plantas.'}
                </p>
              </div>
            </div>

            <!-- Paso 3: Profundidad -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
              <img src="${FIELD_IMAGES.mulch_cobertura}" alt="Profundidad" style="width: 100%; height: 160px; object-fit: cover;">
              <div style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <strong style="font-size: 15px; color: var(--amber-400);">Paso 3: Profundidad de Tapado</strong>
                  <span class="badge badge-amber">Paso 3</span>
                </div>
                <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                  ${guide.depth || 'Colocar la semilla a la profundidad adecuada para facilitar su brote.'}
                </p>
              </div>
            </div>

            <!-- Paso 4: Fertilización -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
              <img src="${FIELD_IMAGES.fertilizacion}" alt="Fertilización" style="width: 100%; height: 160px; object-fit: cover;">
              <div style="padding: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <strong style="font-size: 15px; color: var(--purple-400);">Paso 4: Abonado Inicial</strong>
                  <span class="badge badge-purple">Paso 4</span>
                </div>
                <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                  ${guide.initial_fertilization || 'Aplicar compost o guano de isla descompuesto en el fondo del surco.'}
                </p>
              </div>
            </div>
          </div>

          <!-- LÍNEA DE TIEMPO ILUSTRADA POR ETAPA FENOLÓGICA -->
          <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px;">
            <div style="font-weight: 800; font-size: 16px; color: var(--blue-400); margin-bottom: 16px;">
              🧬 Recomendaciones por Etapa Fenológica:
            </div>

            ${guide.phenological_stages ? `
              <div class="grid-2" style="gap: 16px;">
                <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--green-500);">
                  <div style="font-weight: 700; font-size: 14px; color: var(--green-400); margin-bottom: 4px;">🌱 Etapa 1: Siembra y Brote</div>
                  <div class="text-sm text-secondary" style="line-height: 1.5;">${guide.phenological_stages.siembra}</div>
                </div>

                <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--blue-400);">
                  <div style="font-weight: 700; font-size: 14px; color: var(--blue-400); margin-bottom: 4px;">🌿 Etapa 2: Crecimiento y Aporque</div>
                  <div class="text-sm text-secondary" style="line-height: 1.5;">${guide.phenological_stages.crecimiento}</div>
                </div>

                <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--amber-400);">
                  <div style="font-weight: 700; font-size: 14px; color: var(--amber-400); margin-bottom: 4px;">🌸 Etapa 3: Floración y Llenado</div>
                  <div class="text-sm text-secondary" style="line-height: 1.5;">${guide.phenological_stages.floracion}</div>
                </div>

                <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--purple-400);">
                  <div style="font-weight: 700; font-size: 14px; color: var(--purple-400); margin-bottom: 4px;">🧺 Etapa 4: Cosecha y Secado</div>
                  <div class="text-sm text-secondary" style="line-height: 1.5;">${guide.phenological_stages.cosecha}</div>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>

      <!-- SECCIÓN 2: CALENDARIO Y CONSEJOS GENERALES -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">📅</span> Calendario Agrícola — Pasco</div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Cultivo</th>
                <th>Siembra</th>
                <th>Cosecha</th>
                <th>Ciclo</th>
              </tr>
            </thead>
            <tbody>
              ${calendars.map(cal => `
                <tr>
                  <td><strong>${cal.crop_type.charAt(0).toUpperCase() + cal.crop_type.slice(1)}</strong></td>
                  <td><span class="badge badge-green">${cal.siembra.join(', ')}</span></td>
                  <td><span class="badge badge-amber">${cal.cosecha.join(', ')}</span></td>
                  <td class="text-sm text-muted">${cal.ciclo_dias} días</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">🛡️</span> Protocolos Rápidos de Protección</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="padding: 12px; background: rgba(59, 130, 246, 0.1); border-left: 4px solid var(--blue-400); border-radius: 6px;">
              <strong style="color: var(--blue-400); font-size: 13.5px;">🥶 Protocolo Helada:</strong>
              <div class="text-sm text-muted mt-sm">Activa el riego por aspersión a las 4 AM o enciende humo en los bordes del campo.</div>
            </div>
            <div style="padding: 12px; background: rgba(245, 158, 11, 0.1); border-left: 4px solid var(--amber-400); border-radius: 6px;">
              <strong style="color: var(--amber-400); font-size: 13.5px;">☀️ Protocolo Radiación UV:</strong>
              <div class="text-sm text-muted mt-sm">Aplica riego ligero al amanecer y usa mallas sombra al 50%.</div>
            </div>
            <div style="padding: 12px; background: rgba(168, 85, 247, 0.1); border-left: 4px solid var(--purple-400); border-radius: 6px;">
              <strong style="color: var(--purple-400); font-size: 13.5px;">🌩️ Protocolo Granizo:</strong>
              <div class="text-sm text-muted mt-sm">Limpia las zanjas de drenaje y aplica caldo bordelés tras la tormenta.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function filterAdvisory(cropType) {
  currentCropFilter = cropType;
  navigateTo('/advisory');
}

function switchGuideCrop(cropType) {
  activeGuideCrop = cropType;
  navigateTo('/advisory');
}
