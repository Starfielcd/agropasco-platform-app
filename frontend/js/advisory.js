/**
 * AgroPasco — Módulo de Asesoría Agrícola Inteligente & Guías Visuales
 * ==============================================================================
 * FASE 9-L05: Interfaz conversacional con soporte de parcelas, modo regional,
 * fallback agronómico determinista, avisos de frescura meteorológica, control
 * de cuotas (HTTP 429), prevención de XSS y aislamiento de sesiones en memoria.
 */

// ===== ESTADO GLOBAL DEL MÓDULO DE ASESORÍA =====
let activeAdvisoryTab = 'asistente'; // 'asistente' | 'guias'
let currentCropFilter = '';
let activeGuideCrop = 'papa';

// ===== ESTADO EN MEMORIA DEL ASISTENTE CONVERSACIONAL =====
let chatHistory = []; // Array de { role: 'user'|'assistant', content: string }, máx 4
let selectedParcelId = null; // null = Consulta regional general
let isChatSubmitting = false;
let chatAbortController = null;
let cachedUserParcels = [];

/**
 * Limpia el estado conversacional en memoria.
 * Invocado al cerrar sesión, cambiar de cuenta o resetear chat.
 */
function clearAdvisoryChatState() {
  if (chatAbortController) {
    try { chatAbortController.abort(); } catch (_) {}
    chatAbortController = null;
  }
  chatHistory = [];
  selectedParcelId = null;
  isChatSubmitting = false;
  cachedUserParcels = [];
}

/**
 * Cambia la pestaña activa (Asistente vs Guías) sin recargar ni perder estado.
 */
function switchAdvisoryTab(tabName) {
  activeAdvisoryTab = tabName;
  const assistantContainer = document.getElementById('advisory-tab-assistant');
  const guidesContainer = document.getElementById('advisory-tab-guides');
  const btnAssistant = document.getElementById('tab-btn-assistant');
  const btnGuides = document.getElementById('tab-btn-guides');

  if (assistantContainer && guidesContainer && btnAssistant && btnGuides) {
    if (tabName === 'asistente') {
      assistantContainer.style.display = 'block';
      guidesContainer.style.display = 'none';
      btnAssistant.classList.add('active');
      btnGuides.classList.remove('active');
      btnAssistant.setAttribute('aria-selected', 'true');
      btnGuides.setAttribute('aria-selected', 'false');
    } else {
      assistantContainer.style.display = 'none';
      guidesContainer.style.display = 'block';
      btnAssistant.classList.remove('active');
      btnGuides.classList.add('active');
      btnAssistant.setAttribute('aria-selected', 'false');
      btnGuides.setAttribute('aria-selected', 'true');
    }
  }
}

/**
 * Renderiza la página completa de Asesoría Agrícola (SPA).
 */
async function renderAdvisoryPage() {
  const user = (typeof getUser === 'function') ? getUser() : null;
  const isElevated = user?.role === 'advisor' || user?.role === 'admin';

  // Cargar datos en paralelo: guías preexistentes y parcelas autorizadas
  const [tipsRes, calendarRes, guideRes, parcelsRes] = await Promise.all([
    api.getTips(currentCropFilter ? `crop=${currentCropFilter}` : ''),
    api.getCalendar(),
    api.getPlantingGuide(activeGuideCrop),
    api.getParcels().catch(() => ({ success: false, data: [] }))
  ]);

  const tips = tipsRes?.data || [];
  const calendars = calendarRes?.data || [];
  const guide = guideRes?.data || {};
  cachedUserParcels = parcelsRes?.data || [];

  // Programar inicialización de listeners del chat una vez montado el DOM
  setTimeout(() => {
    initAdvisoryChatEvents();
  }, 60);

  return `
    <div class="page-content">
      <!-- Encabezado General -->
      <div class="mb-lg" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; margin: 0 0 4px; display: flex; align-items: center; gap: 8px;">
            🌾 Asesoría Agrícola & Asistente Inteligente
          </h2>
          <p class="text-sm text-muted" style="margin: 0;">
            Orientación agronómica validada, pronósticos meteorológicos de campo y guías de cultivo para la Región Pasco.
          </p>
        </div>
        <div>
          <span class="badge ${isElevated ? 'badge-blue' : 'badge-green'}" style="font-size: 12px; padding: 6px 12px;">
            ${isElevated ? '👨‍🔬 Modo Asesor Técnico Regional' : '👨‍🌾 Modo Agricultor'}
          </span>
        </div>
      </div>

      <!-- Barra de Pestañas (Segmented Control) -->
      <nav class="advisory-tabs-nav" role="tablist" aria-label="Secciones de Asesoría">
        <button
          type="button"
          class="advisory-tab-btn ${activeAdvisoryTab === 'asistente' ? 'active' : ''}"
          id="tab-btn-assistant"
          role="tab"
          aria-selected="${activeAdvisoryTab === 'asistente' ? 'true' : 'false'}"
          aria-controls="advisory-tab-assistant"
          onclick="switchAdvisoryTab('asistente')"
        >
          🤖 Asistente Agrícola Inteligente
        </button>
        <button
          type="button"
          class="advisory-tab-btn ${activeAdvisoryTab === 'guias' ? 'active' : ''}"
          id="tab-btn-guides"
          role="tab"
          aria-selected="${activeAdvisoryTab === 'guias' ? 'true' : 'false'}"
          aria-controls="advisory-tab-guides"
          onclick="switchAdvisoryTab('guias')"
        >
          📚 Guías de Siembra & Calendario
        </button>
      </nav>

      <!-- ============================================================ -->
      <!-- PESTAÑA A: ASISTENTE AGRÍCOLA INTELIGENTE (CHATBOT)           -->
      <!-- ============================================================ -->
      <section
        id="advisory-tab-assistant"
        role="tabpanel"
        aria-labelledby="tab-btn-assistant"
        style="display: ${activeAdvisoryTab === 'asistente' ? 'block' : 'none'};"
      >
        <div class="advisory-chat-container">
          <!-- Encabezado del Chatbot -->
          <div class="advisory-chat-header">
            <div class="advisory-chat-title-group">
              <h3 class="advisory-chat-title">
                <span>🌾</span> Asistente Técnico AgroPasco
              </h3>
              <span id="advisory-chat-status-badge" class="badge badge-gray" style="font-size: 11.5px; font-weight: 700;">
                🌾 Asistente Técnico
              </span>
            </div>
            <div class="advisory-chat-header-actions">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                id="advisory-new-chat-btn"
                onclick="resetAdvisoryChat()"
                title="Reiniciar la conversación actual"
                style="font-size: 12.5px; padding: 6px 12px;"
              >
                🔄 Nueva Conversación
              </button>
            </div>
          </div>

          <!-- Barra de Selección de Parcela -->
          <div class="advisory-chat-parcel-bar">
            <label for="advisory-parcel-select">
              <span>🗺️</span> <strong>Vincular Parcela:</strong>
            </label>
            <select
              id="advisory-parcel-select"
              class="form-select advisory-parcel-select"
              aria-label="Seleccionar parcela para la consulta"
              onchange="handleParcelSelectChange(this.value)"
            >
              <option value="" ${selectedParcelId === null ? 'selected' : ''}>
                🌐 Consulta General (Toda la Región Pasco)
              </option>
              ${cachedUserParcels.map(p => `
                <option value="${p.id}" ${selectedParcelId === p.id ? 'selected' : ''}>
                  ${escapeHtml(p.name)} (${p.crop_name || p.crop_type || 'Sin cultivo'} · ${p.altitude_masl || 4380} msnm)
                </option>
              `).join('')}
            </select>
            <div id="advisory-parcel-badge-info" class="advisory-parcel-badge">
              ${renderParcelBadgeInfo(selectedParcelId, cachedUserParcels)}
            </div>
          </div>

          <!-- Área de Mensajes del Chat -->
          <div
            id="advisory-chat-messages"
            class="advisory-chat-messages"
            aria-live="polite"
            role="log"
            aria-label="Historial de mensajes de la consulta agrícola"
          >
            <!-- Mensaje Inicial de Bienvenida -->
            <div class="chat-msg chat-msg-assistant" id="advisory-welcome-bubble">
              <div class="chat-msg-avatar" aria-hidden="true">🌾</div>
              <div class="chat-msg-content" style="max-width: 100%;">
                <div class="chat-msg-header">
                  <strong>Asistente Agrícola AgroPasco</strong>
                  <span>• Ahora</span>
                </div>
                <div class="chat-msg-bubble">
                  <p style="margin: 0 0 8px; font-weight: 600; font-size: 15px;">
                    ¡Hola! Soy tu asistente de asesoría agrícola para la región Pasco.
                  </p>
                  <p style="margin: 0 0 8px; color: var(--text-secondary); line-height: 1.5;">
                    Puedo orientarte sobre prevención de heladas, manejo de cultivos andinos y de selva central,
                    buenas prácticas de riego y recomendaciones frente a riesgos meteorológicos.
                  </p>
                  <div style="font-size: 12.5px; color: var(--text-muted); border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">
                    💡 <em>Tus consultas se evalúan con reglas técnicas agronómicas validadas localmente para las altitudes de Pasco.</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sugerencias de Preguntas Rápidas -->
          <div class="chat-quick-suggestions">
            <div class="chat-suggestions-title">
              <span>💡</span> Preguntas frecuentes sugeridas:
            </div>
            <div class="chat-suggestions-grid">
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Cómo puedo proteger mi cultivo ante una helada?')">
                🥶 Protección ante heladas
              </button>
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Qué medidas preventivas puedo tomar frente a lluvias intensas?')">
                🌧️ Lluvias intensas y drenaje
              </button>
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Qué significa el riesgo meteorológico de mi parcela?')">
                🔬 Riesgo meteorológico
              </button>
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Qué debo revisar si las hojas presentan manchas?')">
                🌿 Revisión de hojas y plagas
              </button>
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Cuáles son las buenas prácticas de riego para mi cultivo?')">
                💧 Buenas prácticas de riego
              </button>
              <button type="button" class="chat-suggestion-chip" onclick="fillQuickQuestion('¿Cuándo debería consultar a un asesor técnico presencial?')">
                👨‍🔬 Cuándo llamar al asesor
              </button>
            </div>
          </div>

          <!-- Barra de Entrada y Envío -->
          <div class="advisory-chat-composer">
            <form id="advisory-chat-form" onsubmit="event.preventDefault(); submitAdvisoryChat();">
              <div class="advisory-chat-input-wrapper">
                <textarea
                  id="advisory-message-input"
                  class="form-textarea advisory-chat-textarea"
                  placeholder="Escribe tu consulta agronómica (ej: ¿Cómo preparo el suelo antes de la helada?)..."
                  rows="2"
                  maxlength="500"
                  aria-label="Mensaje para el asistente agrícola"
                  required
                ></textarea>
                <button
                  type="submit"
                  id="advisory-send-btn"
                  class="btn btn-primary"
                  style="min-height: 48px; padding: 0 20px; font-weight: 700;"
                >
                  <span>📤</span> Consultar
                </button>
              </div>
              <div class="advisory-chat-bottom-info">
                <span>Presiona <kbd style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px;">Enter</kbd> para enviar • <kbd style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px;">Shift+Enter</kbd> para salto de línea</span>
                <span id="advisory-char-counter" class="advisory-char-counter" aria-live="polite">0 / 500</span>
              </div>
            </form>
          </div>

          <!-- Sección Informativa Preparatoria de Biblioteca Oficial (Fase 9-L06) -->
          <div class="chat-rag-preview-box">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>📖</span>
              <span><strong>Biblioteca Agrícola Oficial (INIA / SENASA / FAO):</strong> Disponible en la próxima Fase 9-L06.</span>
            </div>
            <span class="badge badge-gray" style="font-size: 11px;">Próximamente RAG</span>
          </div>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- PESTAÑA B: GUÍAS VISUALES Y CALENDARIO AGRÍCOLA (EXISTENTE)   -->
      <!-- ============================================================ -->
      <section
        id="advisory-tab-guides"
        role="tabpanel"
        aria-labelledby="tab-btn-guides"
        style="display: ${activeAdvisoryTab === 'guias' ? 'block' : 'none'};"
      >
        ${renderExistingGuidesSection({ tips, calendars, guide })}
      </section>
    </div>
  `;
}

/**
 * Renderiza el contenido de las guías y calendarios preexistentes.
 */
function renderExistingGuidesSection({ tips, calendars, guide }) {
  const guideCrops = ['papa', 'maca', 'quinua', 'habas', 'palto', 'oca'];
  const cropIcons = { papa: '🥔', maca: '🌿', quinua: '🌾', habas: '🫘', palto: '🥑', oca: '🔴' };

  return `
    <!-- SECCIÓN 1: GUÍA INTERACTIVA DE SIEMBRA CON IMÁGENES DE CAMPO -->
    <div class="card mb-lg" style="border-left: 4px solid var(--accent);">
      <div class="card-header">
        <div class="card-title"><span class="card-title-icon">🌱</span> Guía de Campo Ilustrada — Selecciona tu Cultivo:</div>
        <span class="badge badge-green">Pasco Agrícola</span>
      </div>

      <!-- Selector de Cultivo -->
      <div class="filter-bar" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 8px;">
        ${guideCrops.map(crop => `
          <button
            type="button"
            class="filter-chip ${activeGuideCrop === crop ? 'active' : ''}"
            style="font-size: 14.5px; padding: 8px 16px; border-radius: 99px; border: 1px solid var(--border); background: ${activeGuideCrop === crop ? 'var(--accent)' : 'var(--bg-glass)'}; color: ${activeGuideCrop === crop ? '#fff' : 'var(--text-primary)'}; cursor: pointer;"
            onclick="switchGuideCrop('${crop}')"
          >
            ${cropIcons[crop] || '🌾'} ${crop.toUpperCase()}
          </button>
        `).join('')}
      </div>

      ${guide.crop_name ? `
        <!-- 4 TARJETAS FOTOGRÁFICAS DE ESPECIFICACIONES -->
        <div style="font-weight: 800; font-size: 15px; color: var(--green-400); margin-bottom: 12px;">
          📌 4 Pasos Fundamentales para Sembrar ${escapeHtml(guide.crop_name)}:
        </div>

        <div class="grid-2 mb-lg" style="gap: 16px;">
          <!-- Paso 1: Suelo -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
            <img src="${(typeof FIELD_IMAGES !== 'undefined' && FIELD_IMAGES.preparacion_suelo) || ''}" alt="Preparación del Suelo" style="width: 100%; height: 160px; object-fit: cover;">
            <div style="padding: 16px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 15px; color: var(--green-400);">Paso 1: Preparación del Suelo</strong>
                <span class="badge badge-green">Paso 1</span>
              </div>
              <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                ${escapeHtml(guide.soil_prep || 'Mullir el suelo a 30 cm de profundidad y desinfectar antes de sembrar.')}
              </p>
            </div>
          </div>

          <!-- Paso 2: Siembra / Densidad -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
            <img src="${(typeof FIELD_IMAGES !== 'undefined' && FIELD_IMAGES.siembra) || ''}" alt="Siembra" style="width: 100%; height: 160px; object-fit: cover;">
            <div style="padding: 16px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 15px; color: var(--blue-400);">Paso 2: Distancia y Siembra</strong>
                <span class="badge badge-blue">Paso 2</span>
              </div>
              <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                ${escapeHtml(guide.density || 'Sembrar a la distancia recomendada entre surcos y plantas.')}
              </p>
            </div>
          </div>

          <!-- Paso 3: Profundidad -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
            <img src="${(typeof FIELD_IMAGES !== 'undefined' && FIELD_IMAGES.mulch_cobertura) || ''}" alt="Profundidad" style="width: 100%; height: 160px; object-fit: cover;">
            <div style="padding: 16px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 15px; color: var(--amber-400);">Paso 3: Profundidad de Tapado</strong>
                <span class="badge badge-amber">Paso 3</span>
              </div>
              <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                ${escapeHtml(guide.depth || 'Colocar la semilla a la profundidad adecuada para facilitar su brote.')}
              </p>
            </div>
          </div>

          <!-- Paso 4: Fertilización -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
            <img src="${(typeof FIELD_IMAGES !== 'undefined' && FIELD_IMAGES.fertilizacion) || ''}" alt="Fertilización" style="width: 100%; height: 160px; object-fit: cover;">
            <div style="padding: 16px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 15px; color: var(--purple-400);">Paso 4: Abonado Inicial</strong>
                <span class="badge badge-purple">Paso 4</span>
              </div>
              <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5; margin: 0;">
                ${escapeHtml(guide.initial_fertilization || 'Aplicar compost o guano de isla descompuesto en el fondo del surco.')}
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
                <div class="text-sm text-secondary" style="line-height: 1.5;">${escapeHtml(guide.phenological_stages.siembra)}</div>
              </div>

              <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--blue-400);">
                <div style="font-weight: 700; font-size: 14px; color: var(--blue-400); margin-bottom: 4px;">🌿 Etapa 2: Crecimiento y Aporque</div>
                <div class="text-sm text-secondary" style="line-height: 1.5;">${escapeHtml(guide.phenological_stages.crecimiento)}</div>
              </div>

              <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--amber-400);">
                <div style="font-weight: 700; font-size: 14px; color: var(--amber-400); margin-bottom: 4px;">🌸 Etapa 3: Floración y Llenado</div>
                <div class="text-sm text-secondary" style="line-height: 1.5;">${escapeHtml(guide.phenological_stages.floracion)}</div>
              </div>

              <div style="background: var(--bg-glass); padding: 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--purple-400);">
                <div style="font-weight: 700; font-size: 14px; color: var(--purple-400); margin-bottom: 4px;">🧺 Etapa 4: Cosecha y Secado</div>
                <div class="text-sm text-secondary" style="line-height: 1.5;">${escapeHtml(guide.phenological_stages.cosecha)}</div>
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
                <td><strong>${escapeHtml(cal.crop_type ? cal.crop_type.charAt(0).toUpperCase() + cal.crop_type.slice(1) : '')}</strong></td>
                <td><span class="badge badge-green">${escapeHtml(Array.isArray(cal.siembra) ? cal.siembra.join(', ') : '')}</span></td>
                <td><span class="badge badge-amber">${escapeHtml(Array.isArray(cal.cosecha) ? cal.cosecha.join(', ') : '')}</span></td>
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
  `;
}

// ===== FUNCIONES AUXILIARES DE GUÍAS EXISTENTES =====
function filterAdvisory(cropType) {
  currentCropFilter = cropType;
  if (typeof navigateTo === 'function') navigateTo('/advisory');
}

function switchGuideCrop(cropType) {
  activeGuideCrop = cropType;
  if (typeof navigateTo === 'function') navigateTo('/advisory');
}

// ===== LÓGICA INTERACTIVA DEL ASISTENTE CHATBOT =====

/**
 * Inicializa listeners de eventos del chat tras el montaje del DOM.
 */
function initAdvisoryChatEvents() {
  const input = document.getElementById('advisory-message-input');
  const counter = document.getElementById('advisory-char-counter');

  if (input && counter) {
    input.addEventListener('input', () => {
      const len = input.value.length;
      counter.textContent = `${len} / 500`;
      counter.classList.toggle('warning', len >= 450 && len < 500);
      counter.classList.toggle('danger', len >= 500);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitAdvisoryChat();
      }
    });
  }
}

/**
 * Rellena el campo de consulta con una pregunta sugerida sin enviarla automáticamente.
 */
function fillQuickQuestion(questionText) {
  const input = document.getElementById('advisory-message-input');
  const counter = document.getElementById('advisory-char-counter');
  if (input) {
    input.value = questionText;
    if (counter) {
      counter.textContent = `${questionText.length} / 500`;
      counter.classList.toggle('warning', questionText.length >= 450);
    }
    input.focus();
  }
}

/**
 * Maneja el cambio en el selector de parcelas.
 * Aísla el contexto descartando peticiones e historial previo.
 */
function handleParcelSelectChange(val) {
  if (chatAbortController) {
    try { chatAbortController.abort(); } catch (_) {}
    chatAbortController = null;
  }
  isChatSubmitting = false;

  selectedParcelId = (val && String(val).trim() !== '') ? parseInt(val, 10) : null;
  chatHistory = []; // Limpieza estricta de historial para evitar cruce de contexto

  // Actualizar badge visual de la parcela
  const badge = document.getElementById('advisory-parcel-badge-info');
  if (badge) {
    badge.innerHTML = renderParcelBadgeInfo(selectedParcelId, cachedUserParcels);
  }

  // Limpiar mensajes y notificar al usuario en el chat
  const messagesContainer = document.getElementById('advisory-chat-messages');
  if (messagesContainer) {
    messagesContainer.innerHTML = '';
    const notice = document.createElement('div');
    notice.className = 'chat-msg chat-msg-assistant';

    const pSelected = selectedParcelId ? cachedUserParcels.find(p => p.id === selectedParcelId) : null;
    const parcelLabel = pSelected ? escapeHtml(pSelected.name) : 'Consulta General Regional';

    notice.innerHTML = `
      <div class="chat-msg-avatar" aria-hidden="true">📍</div>
      <div class="chat-msg-content" style="max-width: 100%;">
        <div class="chat-msg-bubble" style="background: rgba(34, 197, 94, 0.08); border-left: 3px solid var(--accent);">
          <strong>Contexto cambiado:</strong> ${parcelLabel}.
          <div class="text-sm text-muted mt-sm">
            La conversación anterior fue reiniciada para asegurar que las recomendaciones técnicas correspondan con precisión a esta unidad agrícola.
          </div>
        </div>
      </div>
    `;
    messagesContainer.appendChild(notice);
  }
}

/**
 * Reinicia la conversación actual de manera manual.
 */
function resetAdvisoryChat() {
  if (chatAbortController) {
    try { chatAbortController.abort(); } catch (_) {}
    chatAbortController = null;
  }
  isChatSubmitting = false;
  chatHistory = [];

  const messagesContainer = document.getElementById('advisory-chat-messages');
  const input = document.getElementById('advisory-message-input');
  const counter = document.getElementById('advisory-char-counter');

  if (input) {
    input.value = '';
    input.disabled = false;
  }
  if (counter) {
    counter.textContent = '0 / 500';
    counter.className = 'advisory-char-counter';
  }

  const sendBtn = document.getElementById('advisory-send-btn');
  if (sendBtn) sendBtn.disabled = false;

  const statusBadge = document.getElementById('advisory-chat-status-badge');
  if (statusBadge) {
    statusBadge.className = 'badge badge-gray';
    statusBadge.textContent = '🌾 Asistente Técnico';
  }

  if (messagesContainer) {
    messagesContainer.innerHTML = `
      <div class="chat-msg chat-msg-assistant">
        <div class="chat-msg-avatar" aria-hidden="true">🌾</div>
        <div class="chat-msg-content" style="max-width: 100%;">
          <div class="chat-msg-header">
            <strong>Asistente Agrícola AgroPasco</strong>
            <span>• Nueva sesión</span>
          </div>
          <div class="chat-msg-bubble">
            <p style="margin: 0 0 6px;">
              Conversación reiniciada. ¿En qué labor o consulta técnica puedo orientarte hoy?
            </p>
          </div>
        </div>
      </div>
    `;
  }
  if (typeof showToast === 'function') {
    showToast('Conversación reiniciada', 'info');
  }
}

/**
 * Envía la consulta al endpoint seguro POST /api/ai/advisory-chat.
 */
async function submitAdvisoryChat() {
  const input = document.getElementById('advisory-message-input');
  const sendBtn = document.getElementById('advisory-send-btn');
  const messagesContainer = document.getElementById('advisory-chat-messages');

  if (!input || !messagesContainer || isChatSubmitting) return;

  const rawText = input.value || '';
  const cleanMessage = rawText.trim();

  // Validación estricta del contrato (3 a 500 caracteres)
  if (cleanMessage.length < 3) {
    if (typeof showToast === 'function') showToast('Tu consulta debe tener al menos 3 caracteres.', 'warning');
    input.focus();
    return;
  }
  if (cleanMessage.length > 500) {
    if (typeof showToast === 'function') showToast('La consulta excede el máximo permitido de 500 caracteres.', 'warning');
    input.focus();
    return;
  }

  // 1. Bloquear controles para evitar envíos concurrentes
  isChatSubmitting = true;
  input.disabled = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span>⏳</span> Enviando...';
  }

  // 2. Renderizar burbuja del agricultor con textContent seguro
  appendUserMessageBubble(cleanMessage, messagesContainer);

  // 3. Renderizar indicador de carga
  const typingIndicator = appendTypingIndicator(messagesContainer);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // 4. Preparar AbortController para permitir cancelaciones seguras
  chatAbortController = new AbortController();

  try {
    const payload = {
      parcel_id: selectedParcelId,
      message: cleanMessage,
      conversation_history: chatHistory.slice(-4)
    };

    const res = await api.sendAdvisoryChat(payload, { signal: chatAbortController.signal });

    // Remover indicador de carga
    if (typingIndicator && typingIndicator.parentNode) {
      typingIndicator.remove();
    }

    if (res && res.success && res.data) {
      // 5. Renderizar respuesta del asistente
      appendAssistantMessageBubble(res.data, messagesContainer);

      // Actualizar historial en memoria (máximo 4 mensajes)
      chatHistory.push({ role: 'user', content: cleanMessage });
      chatHistory.push({ role: 'assistant', content: res.data.reply || '' });
      if (chatHistory.length > 4) {
        chatHistory = chatHistory.slice(-4);
      }

      // Limpiar entrada de texto
      input.value = '';
      const counter = document.getElementById('advisory-char-counter');
      if (counter) counter.textContent = '0 / 500';
    } else {
      // Manejo estructurado de errores HTTP
      handleChatErrorResponse(res, messagesContainer);
    }
  } catch (err) {
    if (typingIndicator && typingIndicator.parentNode) {
      typingIndicator.remove();
    }
    if (err.name === 'AbortError') {
      // Petición cancelada deliberadamente (ej: cambio de parcela o logout)
      return;
    }
    appendErrorMessageBubble('Error de comunicación con el servicio del asistente. Verifica tu conexión e inténtalo nuevamente.', messagesContainer);
  } finally {
    isChatSubmitting = false;
    chatAbortController = null;
    input.disabled = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>📤</span> Consultar';
    }
    input.focus();
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

/**
 * Añade la burbuja del usuario al chat empleando textContent para prevenir XSS.
 */
function appendUserMessageBubble(text, container) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-user';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '👨‍🌾';

  const content = document.createElement('div');
  content.className = 'chat-msg-content';

  const header = document.createElement('div');
  header.className = 'chat-msg-header';
  const now = new Date();
  header.textContent = `Tú • ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  bubble.textContent = text; // Protección estricta contra inyección XSS

  content.appendChild(header);
  content.appendChild(bubble);
  msgEl.appendChild(avatar);
  msgEl.appendChild(content);

  container.appendChild(msgEl);
}

/**
 * Añade el indicador de typing animado mientras el backend procesa.
 */
function appendTypingIndicator(container) {
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg chat-msg-assistant';
  typingEl.id = 'chat-typing-indicator';

  typingEl.innerHTML = `
    <div class="chat-msg-avatar" aria-hidden="true">🌾</div>
    <div class="chat-msg-content">
      <div class="chat-typing-indicator">
        <span>Asistente analizando condiciones agronómicas</span>
        <div class="chat-dots" aria-hidden="true">
          <span class="chat-dot"></span>
          <span class="chat-dot"></span>
          <span class="chat-dot"></span>
        </div>
      </div>
    </div>
  `;
  container.appendChild(typingEl);
  return typingEl;
}

/**
 * Añade la respuesta estructurada del asistente renderizando honestamente
 * la procedencia, estado meteorológico, advertencias y acciones sugeridas.
 */
function appendAssistantMessageBubble(data, container) {
  const targetContainer = container || (typeof document !== 'undefined' ? document.getElementById('advisory-chat-messages') : null);
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-assistant';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '🌾';

  const content = document.createElement('div');
  content.className = 'chat-msg-content';

  const header = document.createElement('div');
  header.className = 'chat-msg-header';
  const now = new Date();
  header.textContent = `Asistente Agrícola • ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  content.appendChild(header);

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';

  // 1. Badge de procedencia obligatoria (Sección 8)
  const metaBar = document.createElement('div');
  metaBar.className = 'chat-meta-bar';

  const provBadge = document.createElement('span');
  if (data.is_fallback) {
    provBadge.className = 'chat-provenance-badge fallback';
    provBadge.textContent = '📌 Reglas Técnicas AgroPasco';
    provBadge.title = 'Orientación basada en reglas técnicas de AgroPasco. El modelo de lenguaje todavía no está activo.';
  } else {
    provBadge.className = 'chat-provenance-badge llm';
    provBadge.textContent = '🤖 Asistente IA Generativa';
    provBadge.title = 'Respuesta generada por asistente IA';
  }
  metaBar.appendChild(provBadge);

  // 1b. Badge de herramienta consultada por el Agente (AGENT01)
  if (data.tool_used === 'get_parcel_weather_risk' || (Array.isArray(data.tool_executions) && data.tool_executions.length > 0)) {
    const toolBadge = document.createElement('span');
    toolBadge.className = 'chat-tool-badge';
    toolBadge.innerHTML = '<span>🔧</span> Herramienta: Consulta meteorológica de parcela';
    toolBadge.title = 'El agente consultó internamente el estado meteorológico y riesgos de la parcela para fundamentar esta respuesta.';
    metaBar.appendChild(toolBadge);
  }

  // 1c. Sincronizar badge de estado del encabezado
  const statusBadge = document.getElementById('advisory-chat-status-badge');
  if (statusBadge) {
    if (data.is_fallback) {
      statusBadge.className = 'badge badge-amber';
      statusBadge.textContent = '📌 Reglas Técnicas Locales';
    } else {
      statusBadge.className = 'badge badge-green';
      statusBadge.textContent = '🤖 Conectado a Gemini IA';
    }
  }

  bubble.appendChild(metaBar);

  // 2. Banner de estado meteorológico (Fase 9-L05B: Corrección 2 y 3)
  if (data.weather_status === 'fresh') {
    const weatherNotice = document.createElement('div');
    weatherNotice.className = 'chat-weather-banner fresh';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = '🌤️';
    const textDiv = document.createElement('div');
    const strongEl = document.createElement('strong');
    strongEl.textContent = 'Pronóstico vigente: ';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'disponible y dentro de su periodo de validez.';
    textDiv.appendChild(strongEl);
    textDiv.appendChild(textSpan);
    weatherNotice.appendChild(iconSpan);
    weatherNotice.appendChild(textDiv);
    bubble.appendChild(weatherNotice);
  } else if (data.weather_status === 'stale') {
    const weatherNotice = document.createElement('div');
    weatherNotice.className = 'chat-weather-banner stale';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = '⚠️';
    const textDiv = document.createElement('div');
    const strongEl = document.createElement('strong');
    strongEl.textContent = 'Pronóstico de respaldo: ';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Los datos meteorológicos provienen de una captura anterior y pueden haber variado.';
    textDiv.appendChild(strongEl);
    textDiv.appendChild(textSpan);
    weatherNotice.appendChild(iconSpan);
    weatherNotice.appendChild(textDiv);
    bubble.appendChild(weatherNotice);
  } else if (data.weather_status === 'missing_weather') {
    const weatherNotice = document.createElement('div');
    weatherNotice.className = 'chat-weather-banner missing';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = 'ℹ️';
    const textDiv = document.createElement('div');
    const strongEl = document.createElement('strong');
    strongEl.textContent = 'Sin pronóstico activo: ';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'No hay un pronóstico meteorológico válido disponible para esta parcela. La orientación será de carácter general.';
    textDiv.appendChild(strongEl);
    textDiv.appendChild(textSpan);
    weatherNotice.appendChild(iconSpan);
    weatherNotice.appendChild(textDiv);
    bubble.appendChild(weatherNotice);
  } else if (data.weather_status === 'no_parcel_specified') {
    const weatherNotice = document.createElement('div');
    weatherNotice.className = 'chat-weather-banner missing';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = '🌐';
    const textDiv = document.createElement('div');
    const strongEl = document.createElement('strong');
    strongEl.textContent = 'Consulta general: ';
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Consulta agrícola general. No se ha seleccionado una parcela; las recomendaciones no incluyen pronósticos ni riesgos específicos de un terreno.';
    textDiv.appendChild(strongEl);
    textDiv.appendChild(textSpan);
    weatherNotice.appendChild(iconSpan);
    weatherNotice.appendChild(textDiv);
    bubble.appendChild(weatherNotice);
  }

  // 3. Cuerpo principal de la respuesta (reply)
  const replyP = document.createElement('div');
  replyP.style.lineHeight = '1.6';
  replyP.style.fontSize = '14.5px';
  // Formatear saltos de línea de forma segura con textContent
  const lines = (data.reply || '').split('\n');
  lines.forEach((line, idx) => {
    if (line.trim() !== '') {
      const p = document.createElement('p');
      p.style.margin = idx === lines.length - 1 ? '0' : '0 0 8px';
      p.textContent = line;
      replyP.appendChild(p);
    }
  });
  bubble.appendChild(replyP);

  // 4. Advertencias técnicas combinadas (warnings)
  if (Array.isArray(data.warnings) && data.warnings.length > 0) {
    const warningsBox = document.createElement('div');
    warningsBox.className = 'chat-warnings-container';

    const title = document.createElement('div');
    title.className = 'chat-warnings-title';
    title.textContent = '⚠️ Advertencias Agronómicas:';
    warningsBox.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'chat-warnings-list';
    data.warnings.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    });
    warningsBox.appendChild(ul);
    bubble.appendChild(warningsBox);
  }

  // 5. Acciones sugeridas (suggested_actions)
  if (Array.isArray(data.suggested_actions) && data.suggested_actions.length > 0) {
    const actionsBox = document.createElement('div');
    actionsBox.className = 'chat-actions-container';

    const title = document.createElement('div');
    title.className = 'chat-actions-title';
    title.textContent = '✅ Acciones Recomendadas:';
    actionsBox.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'chat-actions-list';
    data.suggested_actions.forEach(act => {
      const li = document.createElement('li');
      li.textContent = act;
      ul.appendChild(li);
    });
    actionsBox.appendChild(ul);
    bubble.appendChild(actionsBox);
  }

  // 6. Alerta de asesor humano
  if (data.requires_human_advisor) {
    const humanAlert = document.createElement('div');
    humanAlert.className = 'chat-advisor-alert';
    humanAlert.innerHTML = '<span>👨‍🌾</span> <div><strong>Atención Técnica:</strong> Se aconseja inspección en campo o contacto directo con el asesor técnico regional para este caso.</div>';
    bubble.appendChild(humanAlert);
  }

  // 6b. Fuentes consultadas (FASE 9-LLM02: Corrección E-02)
  // Aparece ÚNICAMENTE cuando existan referencias válidas en la respuesta
  if (Array.isArray(data.references) && data.references.length > 0) {
    const sourcesContainer = document.createElement('div');
    sourcesContainer.className = 'chat-sources-container';

    // Cabecera / Botón interactivo para colapsar y expandir
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'chat-sources-toggle';
    toggleBtn.setAttribute('aria-expanded', 'false');

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'chat-sources-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggleIcon.textContent = '📚';

    const toggleTitle = document.createElement('span');
    toggleTitle.className = 'chat-sources-title';
    toggleTitle.textContent = `Fuentes consultadas (${data.references.length})`;

    const toggleArrow = document.createElement('span');
    toggleArrow.className = 'chat-sources-arrow';
    toggleArrow.setAttribute('aria-hidden', 'true');
    toggleArrow.textContent = '▾';

    toggleBtn.appendChild(toggleIcon);
    toggleBtn.appendChild(toggleTitle);
    toggleBtn.appendChild(toggleArrow);

    const sourcesList = document.createElement('div');
    sourcesList.className = 'chat-sources-list';
    sourcesList.style.display = 'none';

    toggleBtn.addEventListener('click', () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
      sourcesList.style.display = isExpanded ? 'none' : 'flex';
      toggleArrow.textContent = isExpanded ? '▾' : '▴';
      toggleBtn.classList.toggle('expanded', !isExpanded);
    });

    data.references.forEach((ref, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'chat-source-item';

      // Cabecera de la referencia: badge de cita y título
      const itemHeader = document.createElement('div');
      itemHeader.className = 'chat-source-item-header';

      const citationBadge = document.createElement('span');
      citationBadge.className = 'chat-source-badge';
      citationBadge.textContent = ref.citation_id || `[CITA-${idx + 1}]`;
      itemHeader.appendChild(citationBadge);

      const titleEl = document.createElement('strong');
      titleEl.className = 'chat-source-item-title';
      titleEl.textContent = ref.title || 'Documento Técnico Agrícola';
      itemHeader.appendChild(titleEl);

      itemEl.appendChild(itemHeader);

      // Metadatos: Institución, página y verificación
      const metaRow = document.createElement('div');
      metaRow.className = 'chat-source-item-meta';

      const instSpan = document.createElement('span');
      instSpan.className = 'chat-source-institution';
      instSpan.textContent = ref.institution || 'Institución Oficial';
      metaRow.appendChild(instSpan);

      const pageText = (ref.printed_page_verified && ref.printed_page_number)
        ? `Pág. impresa ${ref.printed_page_number} (Digital ${ref.pdf_page_number})`
        : (ref.pdf_page_number ? `Pág. digital ${ref.pdf_page_number}` : null);

      if (pageText) {
        const sep1 = document.createElement('span');
        sep1.className = 'chat-source-sep';
        sep1.textContent = ' • ';
        metaRow.appendChild(sep1);

        const pageSpan = document.createElement('span');
        pageSpan.className = 'chat-source-page';
        pageSpan.textContent = pageText;
        metaRow.appendChild(pageSpan);
      }

      if (ref.verification_status) {
        const sep2 = document.createElement('span');
        sep2.className = 'chat-source-sep';
        sep2.textContent = ' • ';
        metaRow.appendChild(sep2);

        const statusSpan = document.createElement('span');
        statusSpan.className = 'chat-source-status';
        statusSpan.textContent = ref.verification_status === 'verified' ? '✓ Verificado' : ref.verification_status;
        metaRow.appendChild(statusSpan);
      }

      itemEl.appendChild(metaRow);

      // Enlace oficial seguro (ÚNICAMENTE HTTPS y dominios institucionales autorizados - FASE 9-LLM03)
      if (isSafeOfficialUrl(ref.source_url)) {
        const linkRow = document.createElement('div');
        linkRow.className = 'chat-source-link-wrapper';

        const linkEl = document.createElement('a');
        linkEl.className = 'chat-source-link';
        linkEl.href = ref.source_url;
        linkEl.setAttribute('href', ref.source_url);
        linkEl.target = '_blank';
        linkEl.setAttribute('target', '_blank');
        linkEl.rel = 'noopener noreferrer';
        linkEl.setAttribute('rel', 'noopener noreferrer');
        linkEl.textContent = 'Ver documento oficial ↗';

        linkRow.appendChild(linkEl);
        itemEl.appendChild(linkRow);
      }

      sourcesList.appendChild(itemEl);
    });

    sourcesContainer.appendChild(toggleBtn);
    sourcesContainer.appendChild(sourcesList);
    bubble.appendChild(sourcesContainer);
  }

  // 7. Pie de contexto usado (Sección 15: Corrección defensiva de etapa no especificada)
  if (data.context_used) {
    const cu = data.context_used;
    const footer = document.createElement('div');
    footer.className = 'chat-context-footer';

    const cropSpan = document.createElement('span');
    cropSpan.textContent = `Cultivo: ${cu.crop_type || 'General'}`;
    footer.appendChild(cropSpan);

    const varietySpan = document.createElement('span');
    varietySpan.textContent = `Variedad: ${cu.variety && cu.variety !== 'no_especificada' ? cu.variety : 'No especificada'}`;
    footer.appendChild(varietySpan);

    // Verificación defensiva estricta: NUNCA inventar "crecimiento" ni "desarrollo_vegetativo" si no está registrada
    const stageSpan = document.createElement('span');
    const validStage = (cu.phenological_stage && cu.phenological_stage !== 'general' && cu.phenological_stage !== 'desconocida' && cu.phenological_stage !== 'no_especificada')
      ? cu.phenological_stage
      : 'Etapa no especificada';
    stageSpan.textContent = `Etapa: ${validStage}`;
    footer.appendChild(stageSpan);

    if (cu.altitude_masl) {
      const altSpan = document.createElement('span');
      altSpan.textContent = `Altitud: ${cu.altitude_masl} msnm`;
      footer.appendChild(altSpan);
    }

    bubble.appendChild(footer);
  }

  content.appendChild(bubble);
  msgEl.appendChild(avatar);
  msgEl.appendChild(content);
  if (targetContainer) {
    targetContainer.appendChild(msgEl);
  }
}

/**
 * Añade una burbuja de error comprensible y amigable al usuario.
 */
function appendErrorMessageBubble(msgText, container) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-assistant';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '⚠️';

  const content = document.createElement('div');
  content.className = 'chat-msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  bubble.style.background = 'rgba(239, 68, 68, 0.1)';
  bubble.style.border = '1px solid rgba(239, 68, 68, 0.3)';
  bubble.style.color = 'var(--text-primary)';

  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.style.color = 'var(--red-400)';
  title.style.marginBottom = '4px';
  title.textContent = 'Aviso del Sistema:';

  const body = document.createElement('div');
  body.textContent = msgText;

  bubble.appendChild(title);
  bubble.appendChild(body);
  content.appendChild(bubble);
  msgEl.appendChild(avatar);
  msgEl.appendChild(content);

  container.appendChild(msgEl);
}

/**
 * Interpreta errores de la respuesta HTTP y genera mensajes adecuados al agricultor.
 */
function handleChatErrorResponse(res, container) {
  const status = res?.httpStatus || res?.status;
  let userFriendlyMsg = 'No pudimos procesar tu consulta en este momento. Inténtalo nuevamente.';

  if (status === 429) {
    const retrySecs = res?.retry_after_seconds ? Math.ceil(res.retry_after_seconds) : 600;
    const retryMins = Math.ceil(retrySecs / 60);
    userFriendlyMsg = `Has alcanzado el límite de consultas (15 consultas por cada 10 minutos). Por favor espera aproximadamente ${retryMins} minutos antes de realizar otra consulta.`;
  } else if (status === 400) {
    userFriendlyMsg = res?.error || 'Por favor verifica tu consulta. Debe tener entre 3 y 500 caracteres.';
  } else if (status === 401) {
    userFriendlyMsg = 'Tu sesión ha expirado o no tienes autorización. Por favor inicia sesión nuevamente.';
  } else if (status === 404) {
    userFriendlyMsg = 'La parcela seleccionada no fue encontrada o no pertenece a tu cuenta autorizada.';
  } else if (res?.error) {
    userFriendlyMsg = res.error;
  }

  appendErrorMessageBubble(userFriendlyMsg, container);
}

/**
 * Genera el texto del badge informativo de la parcela seleccionada.
 */
function renderParcelBadgeInfo(parcelId, parcels) {
  if (!parcelId) {
    return '<span>🌐</span> Cobertura Regional de Pasco';
  }
  const p = parcels.find(item => item.id === parcelId);
  if (!p) {
    return '<span>🗺️</span> Parcela seleccionada';
  }
  const cropText = p.crop_name || p.crop_type || 'Sin cultivo';
  const altText = p.altitude_masl ? `${p.altitude_masl} msnm` : '4,380 msnm';
  return `<span>🌱</span> ${escapeHtml(cropText)} • <span>🏔️</span> ${escapeHtml(altText)}`;
}

/**
 * Validador estricto de URLs institucionales oficiales seguras (FASE 9-LLM03).
 * Requiere protocolo HTTPS, ausencia de credenciales, y pertenencia a dominios oficiales autorizados.
 */
function isSafeOfficialUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) return false;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443') return false;

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')) return false;

    const ALLOWED_SUFFIXES = [
      'gob.pe',
      'inia.gob.pe',
      'senasa.gob.pe',
      'senamhi.gob.pe',
      'midagri.gob.pe',
      'fao.org',
      'cipotato.org',
      'agropasco.pe'
    ];

    const isAllowed = ALLOWED_SUFFIXES.some(suffix => {
      const cleanSuffix = suffix.startsWith('.') ? suffix.slice(1) : suffix;
      return hostname === cleanSuffix || hostname.endsWith('.' + cleanSuffix);
    });

    if (!isAllowed) return false;
    if (/[\0\r\n\t<>]/.test(parsed.pathname) || /[\0\r\n\t<>]/.test(parsed.search)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Validador estricto de URLs institucionales oficiales seguras (FASE 9-LLM03).
 * Requiere protocolo HTTPS, ausencia de credenciales y pertenencia a dominios oficiales autorizados.
 */
function isSafeOfficialUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) return false;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443') return false;

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')) return false;

    const ALLOWED_SUFFIXES = [
      'gob.pe',
      'inia.gob.pe',
      'senasa.gob.pe',
      'senamhi.gob.pe',
      'midagri.gob.pe',
      'fao.org',
      'cipotato.org',
      'agropasco.pe'
    ];

    const isAllowed = ALLOWED_SUFFIXES.some(suffix => {
      const cleanSuffix = suffix.startsWith('.') ? suffix.slice(1) : suffix;
      return hostname === cleanSuffix || hostname.endsWith('.' + cleanSuffix);
    });

    if (!isAllowed) return false;
    if (/[\0\r\n\t<>]/.test(parsed.pathname) || /[\0\r\n\t<>]/.test(parsed.search)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Escapa cadenas HTML para prevenir inyecciones XSS.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Exportación para entornos CommonJS (pruebas unitarias automatizadas)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderAdvisoryPage,
    switchAdvisoryTab,
    clearAdvisoryChatState,
    handleParcelSelectChange,
    resetAdvisoryChat,
    fillQuickQuestion,
    submitAdvisoryChat,
    appendUserMessageBubble,
    appendAssistantMessageBubble,
    handleChatErrorResponse,
    isSafeOfficialUrl,
    escapeHtml
  };
}
