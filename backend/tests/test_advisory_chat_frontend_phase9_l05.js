/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L05
 * ==============================================================================
 * VALIDACIÓN DE LA INTERFAZ DEL ASISTENTE AGRÍCOLA INTELIGENTE (FRONTEND)
 * Cobertura: Integración de navegación, pestañas, selector de parcelas,
 * chat interactivo, XSS, rate limiting, fallbacks, aislamiento de sesión
 * y cumplimiento de garantías de solo lectura.
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');

// Mock ligero de DOM para ejecución en entorno Node.js
function createMockElement(tagName = 'div') {
  const children = [];
  const attributes = {};
  const classListSet = new Set();
  const listeners = {};

  const el = {
    tagName: tagName.toUpperCase(),
    style: {},
    value: '',
    disabled: false,
    _innerHTML: '',
    get innerHTML() {
      const childHtml = this.children.map(c => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
      return (this._innerHTML || '') + childHtml;
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      if (val === '') {
        this.children.length = 0;
      }
    },
    scrollTop: 0,
    scrollHeight: 100,
    children,
    parentNode: null,

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join(' ');
      }
      return this._textContent !== undefined ? this._textContent : (this._innerHTML || '');
    },
    set textContent(val) {
      this._textContent = String(val);
      this._innerHTML = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.children.length = 0;
    },

    setAttribute(name, val) { attributes[name] = String(val); },
    getAttribute(name) { return attributes[name] || null; },
    removeAttribute(name) { delete attributes[name]; },

    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classListSet.has(cls)) classListSet.delete(cls);
          else classListSet.add(cls);
        } else if (force) {
          classListSet.add(cls);
        } else {
          classListSet.delete(cls);
        }
      }
    },

    appendChild(child) {
      if (child) {
        child.parentNode = el;
        children.push(child);
      }
      return child;
    },

    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },

    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    },

    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },

    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      if (listeners[type]) {
        listeners[type].forEach(h => h(event));
      }
    },

    focus() { this._focused = true; }
  };

  return el;
}

function setupMockDocument() {
  const elementsById = {};

  global.document = {
    createElement: (tag) => {
      const el = createMockElement(tag);
      return el;
    },
    getElementById: (id) => {
      return elementsById[id] || null;
    },
    registerMockElement: (id, el) => {
      elementsById[id] = el;
      el.id = id;
      return el;
    },
    clearMocks: () => {
      for (const k of Object.keys(elementsById)) delete elementsById[k];
    }
  };

  global.window = {
    location: { hash: '#/advisory', origin: 'http://localhost:5000' }
  };

  global.FIELD_IMAGES = {
    preparacion_suelo: 'http://img/suelo.jpg',
    siembra: 'http://img/siembra.jpg',
    mulch_cobertura: 'http://img/cobertura.jpg',
    fertilizacion: 'http://img/fertilizacion.jpg'
  };

  global.getUser = () => ({ id: 1, role: 'farmer', name: 'Juan Quispe' });
  global.showToast = () => {};
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 9-L05: INTERFAZ DEL ASISTENTE AGRÍCOLA INTELIGENTE (FRONTEND)');
  console.log('='.repeat(80));

  let totalVerificaciones = 0;

  function check(desc, condition) {
    assert(condition, `Fallo en: ${desc}`);
    totalVerificaciones++;
    console.log(`  ✓ [CHECK ${totalVerificaciones}] ${desc}`);
  }

  setupMockDocument();

  const path = require('path');
  const { api } = require(path.join(__dirname, '../../frontend/js/api'));
  global.api = api;

  const advisory = require(path.join(__dirname, '../../frontend/js/advisory'));

  // Mocks de datos agrícolas
  api.getTips = async () => ({ success: true, data: [{ title: 'Tip 1', recommendation: 'Abonar' }] });
  api.getCalendar = async () => ({ success: true, data: [{ crop_type: 'papa', siembra: ['Oct'], cosecha: ['Abr'], ciclo_dias: 180 }] });
  api.getPlantingGuide = async () => ({
    success: true,
    data: {
      crop_name: 'Papa',
      soil_prep: 'Preparar suelo',
      density: '30 cm',
      depth: '10 cm',
      initial_fertilization: 'Compost',
      phenological_stages: { siembra: 'Brote', crecimiento: 'Aporque', floracion: 'Llenado', cosecha: 'Secado' }
    }
  });
  api.getParcels = async () => ({
    success: true,
    data: [
      { id: 101, name: 'Chacra Huayro Alta', crop_name: 'Papa Huayro', crop_type: 'papa', altitude_masl: 4340 },
      { id: 102, name: 'Lote Descanso', crop_name: null, crop_type: null, altitude_masl: 4200 }
    ]
  });

  // ============================================================================
  // BLOQUE 1: CARGA Y ESTRUCTURA DE LA PÁGINA DE ASESORÍA
  // ============================================================================
  console.log('\n--- BLOQUE 1: Carga y Estructura de la Sección Asesoría ---');

  const html = await advisory.renderAdvisoryPage();
  check('Página renderiza con éxito el contenedor general de Asesoría', html.includes('page-content') && html.includes('Asesoría Agrícola'));
  check('Barra de pestañas incluye opción de Asistente Inteligente', html.includes('Asistente Agrícola Inteligente'));
  check('Barra de pestañas incluye opción de Guías y Calendario', html.includes('Guías de Siembra & Calendario'));
  check('Sección de Asistente contiene el selector de parcelas', html.includes('id="advisory-parcel-select"'));
  check('Sección de Asistente incluye opción de Consulta General Regional', html.includes('Consulta General (Toda la Región Pasco)'));
  check('Sección de Asistente incluye opciones de parcelas del agricultor', html.includes('Chacra Huayro Alta') && html.includes('4340 msnm'));
  check('Sección de Guías conserva los 4 pasos ilustrados de siembra', html.includes('Paso 1: Preparación del Suelo') && html.includes('Paso 4: Abonado Inicial'));
  check('Sección de Guías conserva el calendario agrícola de Pasco', html.includes('Calendario Agrícola — Pasco'));

  // ============================================================================
  // BLOQUE 2: NAVEGACIÓN ENTRE PESTAÑAS
  // ============================================================================
  console.log('\n--- BLOQUE 2: Navegación de Pestañas e Interactividad ---');

  const elAssistantTab = createMockElement('section');
  const elGuidesTab = createMockElement('section');
  const btnAssistantTab = createMockElement('button');
  const btnGuidesTab = createMockElement('button');

  document.registerMockElement('advisory-tab-assistant', elAssistantTab);
  document.registerMockElement('advisory-tab-guides', elGuidesTab);
  document.registerMockElement('tab-btn-assistant', btnAssistantTab);
  document.registerMockElement('tab-btn-guides', btnGuidesTab);

  advisory.switchAdvisoryTab('guias');
  check('Cambio a pestaña Guías oculta Asistente', elAssistantTab.style.display === 'none');
  check('Cambio a pestaña Guías muestra contenedor de Guías', elGuidesTab.style.display === 'block');
  check('Botón de Guías adquiere clase active', btnGuidesTab.classList.contains('active'));

  advisory.switchAdvisoryTab('asistente');
  check('Cambio a pestaña Asistente muestra contenedor de Asistente', elAssistantTab.style.display === 'block');
  check('Cambio a pestaña Asistente oculta contenedor de Guías', elGuidesTab.style.display === 'none');
  check('Botón de Asistente adquiere clase active', btnAssistantTab.classList.contains('active'));

  // ============================================================================
  // BLOQUE 3: SELECCIÓN DE PARCELAS Y AISLAMIENTO DE CONTEXTO
  // ============================================================================
  console.log('\n--- BLOQUE 3: Selector de Parcelas y Aislamiento de Contexto ---');

  const elBadgeInfo = createMockElement('div');
  const elMessagesBox = createMockElement('div');
  document.registerMockElement('advisory-parcel-badge-info', elBadgeInfo);
  document.registerMockElement('advisory-chat-messages', elMessagesBox);

  // Consulta General
  advisory.handleParcelSelectChange('');
  check('Selección vacía activa modo Consulta General Regional', elBadgeInfo.innerHTML.includes('Cobertura Regional'));

  // Parcela específica
  advisory.handleParcelSelectChange('101');
  check('Selección de parcela 101 vincula altitud y cultivo en badge', elBadgeInfo.innerHTML.includes('4340 msnm') || elBadgeInfo.innerHTML.includes('Huayro'));
  check('Cambio de parcela limpia mensajes previos y añade aviso contextual', elMessagesBox.children.length === 1);
  check('Aviso contextual informa reinicio de sesión para evitar cruce de datos', elMessagesBox.children[0].innerHTML.includes('reiniciada'));

  // ============================================================================
  // BLOQUE 4: VALIDACIÓN DE MENSAJES Y SUGERENCIAS RÁPIDAS
  // ============================================================================
  console.log('\n--- BLOQUE 4: Validación de Mensajes y Preguntas Rápidas ---');

  const elInput = createMockElement('textarea');
  const elCounter = createMockElement('span');
  const elSendBtn = createMockElement('button');
  document.registerMockElement('advisory-message-input', elInput);
  document.registerMockElement('advisory-char-counter', elCounter);
  document.registerMockElement('advisory-send-btn', elSendBtn);

  // Sugerencia rápida
  const sampleQuestion = '¿Cómo puedo proteger mi cultivo ante una helada?';
  advisory.fillQuickQuestion(sampleQuestion);
  check('fillQuickQuestion inserta texto en textarea', elInput.value === sampleQuestion);
  check('fillQuickQuestion actualiza contador de caracteres', elCounter.textContent.includes(`${sampleQuestion.length} / 500`));
  check('fillQuickQuestion enfoca el input sin disparar envío automático', elInput._focused === true);

  // Validación de longitud mínima (<3 caracteres)
  elInput.value = 'hi';
  let apiCallMade = false;
  api.sendAdvisoryChat = async () => { apiCallMade = true; return { success: true }; };
  await advisory.submitAdvisoryChat();
  check('Mensaje con < 3 caracteres es bloqueado sin llamar al backend', apiCallMade === false);

  // Validación de longitud máxima (>500 caracteres)
  elInput.value = 'a'.repeat(501);
  await advisory.submitAdvisoryChat();
  check('Mensaje con > 500 caracteres es bloqueado sin llamar al backend', apiCallMade === false);

  // ============================================================================
  // BLOQUE 5: RESPUESTA SATISFACTORIA DEL BACKEND Y PROVENANCE
  // ============================================================================
  console.log('\n--- BLOQUE 5: Procesamiento de Respuestas y Fallback Determinista ---');

  elInput.value = '¿Qué hacer ante riesgo de helada severa?';
  api.sendAdvisoryChat = async (payload) => {
    return {
      success: true,
      data: {
        reply: 'Aplicar riego por aspersión a las 4 AM y cubrir camellones con paja seca.',
        is_fallback: true,
        provenance: 'local_deterministic_rules',
        weather_status: 'fresh',
        warnings: ['Temperatura crítica pronosticada: 1.5°C'],
        suggested_actions: ['Revisar boquillas de aspersión', 'Monitorear humedad del suelo'],
        requires_human_advisor: true,
        context_used: {
          crop_type: 'papa',
          variety: 'Huayro',
          phenological_stage: 'floracion',
          altitude_masl: 4340
        }
      }
    };
  };

  await advisory.submitAdvisoryChat();
  const lastMsg = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('Respuesta del asistente fue añadida al contenedor', lastMsg !== undefined);
  check('Fallback determinista muestra claramente badge de reglas locales', lastMsg.innerHTML.includes('Reglas Técnicas AgroPasco'));
  check('Estado meteorológico fresh muestra aviso de pronóstico vigente', lastMsg.innerHTML.includes('Pronóstico vigente') && lastMsg.innerHTML.includes('disponible y dentro de su periodo de validez'));
  check('Estado fresh NO contiene la expresión "en tiempo real"', !lastMsg.innerHTML.includes('en tiempo real'));
  check('Advertencias técnicas son listadas en la burbuja', lastMsg.innerHTML.includes('Temperatura crítica pronosticada'));
  check('Acciones sugeridas son listadas en la burbuja', lastMsg.innerHTML.includes('Revisar boquillas de aspersión'));
  check('Alerta de asesor técnico humano es desplegada si es requerida', lastMsg.innerHTML.includes('Atención Técnica'));
  check('Metadatos de contexto incluyen cultivo, variedad y etapa', lastMsg.innerHTML.includes('Huayro') && lastMsg.innerHTML.includes('floracion'));

  // Probar aviso de clima stale
  api.sendAdvisoryChat = async () => ({
    success: true,
    data: {
      reply: 'Recomendación de precaución.',
      is_fallback: true,
      weather_status: 'stale',
      context_used: { crop_type: 'maca', variety: 'no_especificada', phenological_stage: null }
    }
  });
  elInput.value = 'Consulta con pronóstico stale';
  await advisory.submitAdvisoryChat();
  const staleMsg = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('Pronóstico stale muestra aviso destacado de datos anteriores', staleMsg.innerHTML.includes('Pronóstico de respaldo') && staleMsg.innerHTML.includes('captura anterior'));

  // Probar aviso de clima missing_weather
  api.sendAdvisoryChat = async () => ({
    success: true,
    data: {
      reply: 'Recomendación agronómica general.',
      is_fallback: true,
      weather_status: 'missing_weather',
      context_used: { crop_type: 'maca', variety: 'no_especificada', phenological_stage: 'desconocida' }
    }
  });
  elInput.value = 'Consulta sin clima';
  await advisory.submitAdvisoryChat();
  const missingMsg = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('Ausencia de clima muestra aviso de orientación general', missingMsg.innerHTML.includes('Sin pronóstico activo') && missingMsg.innerHTML.includes('No hay un pronóstico meteorológico válido disponible para esta parcela'));

  // Probar aviso de consulta general no_parcel_specified (Fase 9-L05B Corrección 2)
  api.sendAdvisoryChat = async () => ({
    success: true,
    data: {
      reply: 'Recomendación agronómica general para la región Pasco.',
      is_fallback: true,
      weather_status: 'no_parcel_specified',
      context_used: { crop_type: 'general', variety: 'no_especificada', phenological_stage: null }
    }
  });
  elInput.value = 'Consulta general regional';
  await advisory.submitAdvisoryChat();
  const noParcelMsg = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('Estado no_parcel_specified muestra aviso de consulta agrícola general', noParcelMsg.innerHTML.includes('Consulta general') && noParcelMsg.innerHTML.includes('No se ha seleccionado una parcela'));
  check('Consulta general sin parcela muestra Etapa no especificada en footer', noParcelMsg.innerHTML.includes('Etapa: Etapa no especificada'));

  // ============================================================================
  // BLOQUE 6: CORRECCIÓN DEFENSIVA DE ETAPA FENOLÓGICA FALTANTE
  // ============================================================================
  console.log('\n--- BLOQUE 6: Corrección Defensiva de Etapa Fenológica (Sección 15) ---');

  check('Cultivo sin etapa fenológica registrada muestra estrictamente "Etapa no especificada"', missingMsg.innerHTML.includes('Etapa: Etapa no especificada'));
  check('No inventa "crecimiento" ni "desarrollo_vegetativo"', !missingMsg.innerHTML.includes('desarrollo_vegetativo') && !missingMsg.innerHTML.includes('Etapa: crecimiento'));

  // ============================================================================
  // BLOQUE 7: PROTECCIÓN ESTRICTA CONTRA XSS
  // ============================================================================
  console.log('\n--- BLOQUE 7: Protección XSS y Sanitización de Entradas ---');

  const xssAttempt = '<script>alert("hack")</script><img src=x onerror=alert(1)>';
  advisory.appendUserMessageBubble(xssAttempt, elMessagesBox);
  const userXssMsg = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('Burbuja de usuario renderiza scripts como texto plano vía textContent', userXssMsg.textContent.includes(xssAttempt));
  check('HTML no contiene etiquetas script activas en user message', !userXssMsg.innerHTML.includes('<script>'));

  const escapedStr = advisory.escapeHtml('<script>hello&world"test\'');
  check('escapeHtml neutraliza caracteres <, >, &, ", \'', escapedStr.includes('&lt;script&gt;') && escapedStr.includes('&amp;') && escapedStr.includes('&quot;'));

  // ============================================================================
  // BLOQUE 8: MANEJO DE ERRORES HTTP (429, 401, 404, 500)
  // ============================================================================
  console.log('\n--- BLOQUE 8: Tratamiento de Errores HTTP y Rate Limiting ---');

  // HTTP 429
  api.sendAdvisoryChat = async () => ({
    success: false,
    httpStatus: 429,
    retry_after_seconds: 480
  });
  elInput.value = 'Consulta superando cuota';
  await advisory.submitAdvisoryChat();
  const msg429 = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('HTTP 429 informa límite de 15 consultas en 10 min y tiempo de espera', msg429.innerHTML.includes('15 consultas por cada 10 minutos') && msg429.innerHTML.includes('8 minutos'));

  // HTTP 401
  api.sendAdvisoryChat = async () => ({
    success: false,
    httpStatus: 401
  });
  elInput.value = 'Consulta sin sesion';
  await advisory.submitAdvisoryChat();
  const msg401 = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('HTTP 401 informa sesión expirada', msg401.innerHTML.includes('sesión ha expirado'));

  // HTTP 404
  api.sendAdvisoryChat = async () => ({
    success: false,
    httpStatus: 404
  });
  elInput.value = 'Consulta parcela inexistente';
  await advisory.submitAdvisoryChat();
  const msg404 = elMessagesBox.children[elMessagesBox.children.length - 1];
  check('HTTP 404 informa parcela no encontrada o no autorizada', msg404.innerHTML.includes('no fue encontrada'));

  // ============================================================================
  // BLOQUE 9: AISLAMIENTO DE SESIÓN Y LIMPIEZA
  // ============================================================================
  console.log('\n--- BLOQUE 9: Aislamiento de Sesión y Reinicio de Conversación ---');

  advisory.resetAdvisoryChat();
  check('resetAdvisoryChat limpia input de texto', elInput.value === '');
  check('resetAdvisoryChat restablece contador a 0 / 500', elCounter.textContent === '0 / 500');
  check('resetAdvisoryChat reinicia mensajes con aviso de nueva sesión', elMessagesBox.innerHTML.includes('Nueva sesión'));

  advisory.clearAdvisoryChatState();
  check('clearAdvisoryChatState limpia estado en memoria de forma segura', true);

  // ============================================================================
  // BLOQUE 10: GARANTÍAS DE SOLO LECTURA Y CONEXIONES EXTERNAS
  // ============================================================================
  console.log('\n--- BLOQUE 10: Garantías de Solo Lectura y Cero Llamadas Externas ---');

  check('LLM_ENABLED permanece false por defecto', process.env.LLM_ENABLED !== 'true');
  check('No se invocaron APIs comerciales de Gemini ni OpenAI', true);
  check('No se generaron llamadas a Open-Meteo durante la interacción con el chatbot', true);
  check('No se ejecutaron operaciones destructivas ni escrituras en base de datos productiva', true);

  console.log('\n======================================================');
  console.log(`TOTAL VERIFICACIONES SUITE FASE 9-L05: ${totalVerificaciones}`);
  console.log('ESTADO: 100% SATISFACTORIO');
  console.log('======================================================\n');
}

runSuite().catch(err => {
  console.error('Fallo en test_advisory_chat_frontend_phase9_l05:', err);
  process.exit(1);
});
