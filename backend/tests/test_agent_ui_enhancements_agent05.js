/**
 * AgroPasco Digital — Suite de Pruebas AGENT05: Mejoras Visuales del Asistente Agrícola
 * ==============================================================================
 * Verificaciones requeridas por AGENT05:
 *  1. Renderizado de tarjeta de recomendación agronómica (.chat-reply-card, jerarquía tipográfica).
 *  2. Renderizado condicional de tarjeta de parcela y chips contextuales (.chat-parcel-card).
 *  3. Renderizado condicional de badge de riesgo meteorológico (Alto: rojo >=60%, Moderado: amarillo >=30%, Bajo: verde <30%, Sin datos: gris).
 *  4. Renderizado estructurado de acciones sugeridas con chips numerados (.chat-action-item, .chat-action-num).
 *  5. Renderizado estructurado de advertencias con icono (.chat-warning-item, .chat-warning-icon).
 *  6. Tolerancia a campos ausentes o nulos sin excepciones no controladas.
 *  7. Protección estricta contra inyección XSS en textos dinámicos generados por Gemini.
 */

const assert = require('assert');
const path = require('path');

// Mock ligero de DOM para pruebas en Node.js
function createMockElement(tagName = 'div') {
  const children = [];
  const attributes = {};
  const classListSet = new Set();

  const el = {
    tagName: tagName.toUpperCase(),
    style: {},
    value: '',
    disabled: false,
    _innerHTML: '',
    get innerHTML() {
      const childHtml = this.children.map(c => {
        const cls = c.className ? ` class="${c.className}"` : '';
        return `<${c.tagName.toLowerCase()}${cls}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
      }).join('');
      return (this._innerHTML || '') + childHtml;
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      if (val === '') this.children.length = 0;
    },
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

    get className() { return Array.from(classListSet).join(' '); },
    set className(val) {
      classListSet.clear();
      if (typeof val === 'string') {
        val.trim().split(/\s+/).forEach(c => { if (c) classListSet.add(c); });
      }
    },

    classList: {
      add: (...cls) => cls.forEach(c => classListSet.add(c)),
      remove: (...cls) => cls.forEach(c => classListSet.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classListSet.has(c)) classListSet.delete(c); else classListSet.add(c);
        } else if (force) {
          classListSet.add(c);
        } else {
          classListSet.delete(c);
        }
      },
      contains: (c) => classListSet.has(c)
    },

    appendChild(child) {
      if (child) {
        child.parentNode = this;
        children.push(child);
      }
      return child;
    },

    querySelector(selector) {
      const match = (node) => {
        if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) return node;
        if (selector.startsWith('#') && node.getAttribute('id') === selector.slice(1)) return node;
        if (node.tagName.toLowerCase() === selector.toLowerCase()) return node;
        for (const c of node.children) {
          const res = match(c);
          if (res) return res;
        }
        return null;
      };
      return match(this);
    },

    querySelectorAll(selector) {
      const results = [];
      const matchAll = (node) => {
        if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) results.push(node);
        else if (selector.startsWith('#') && node.getAttribute('id') === selector.slice(1)) results.push(node);
        else if (node.tagName.toLowerCase() === selector.toLowerCase()) results.push(node);
        node.children.forEach(matchAll);
      };
      this.children.forEach(matchAll);
      return results;
    }
  };
  return el;
}

// Configurar entorno global simulado
global.document = {
  createElement: createMockElement,
  getElementById: (id) => null
};
global.window = { location: { hash: '#/advisory' } };
global.getUser = () => ({ id: 1, role: 'farmer' });
global.showToast = () => {};
global.cachedUserParcels = [
  { id: 101, name: 'Parcela San Pedro', crop_name: 'Papa', crop_type: 'papa', altitude_masl: 4150 }
];

const { appendAssistantMessageBubble } = require('../../frontend/js/advisory');

async function runSuite() {
  console.log('================================================================================');
  console.log('🧪 SUITE AGENT05: MEJORAS VISUALES DE JERARQUÍA Y TARJETAS EN ASISTENTE AGRÍCOLA');
  console.log('================================================================================\n');

  let checkCount = 0;
  function pass(msg) {
    checkCount++;
    console.log(`  ✓ [CHECK ${checkCount}] ${msg}`);
  }

  // 1. Tarjeta de recomendación agronómica estructurada
  const container1 = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Recomendación técnica para prevenir heladas.\nSe aconseja aplicar riego temprano.',
    is_fallback: false,
    weather_status: 'fresh'
  }, container1);

  const replyCard = container1.querySelector('.chat-reply-card');
  assert.ok(replyCard, 'Debe renderizar la tarjeta .chat-reply-card');
  assert.ok(container1.innerHTML.includes('Orientación Agronómica'), 'Debe incluir cabecera de Orientación Agronómica');
  assert.ok(container1.innerHTML.includes('Recomendación técnica para prevenir heladas'), 'Debe contener el primer párrafo');
  assert.ok(container1.innerHTML.includes('Se aconseja aplicar riego temprano'), 'Debe contener el segundo párrafo');
  pass('Tarjeta de recomendación agronómica renderizada con jerarquía tipográfica (.chat-reply-card)');

  // 2. Tarjeta de parcela con chips contextuales
  const container2 = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Orientación para la parcela seleccionada.',
    parcel_id: 101,
    context_used: {
      crop_type: 'Papa',
      variety: 'Canchan',
      phenological_stage: 'Floración',
      altitude_masl: 4150,
      approximate_zone: 'Puna Altoandina'
    }
  }, container2);

  const parcelCard = container2.querySelector('.chat-parcel-card');
  assert.ok(parcelCard, 'Debe renderizar .chat-parcel-card');
  assert.ok(container2.innerHTML.includes('Papa (Canchan)'), 'Debe incluir el chip con cultivo y variedad');
  assert.ok(container2.innerHTML.includes('Floración'), 'Debe incluir la etapa fenológica');
  assert.ok(container2.innerHTML.includes('4150 msnm'), 'Debe incluir la altitud');
  pass('Tarjeta de parcela (.chat-parcel-card) y chips contextuales renderizados con precisión');

  // 3. Badges de riesgo meteorológico respaldado (Alto >=60%, Moderado >=30%, Bajo <30%, Sin datos)
  // Caso 3a: Riesgo Alto (75%)
  const container3a = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Alerta por helada.',
    weather_status: 'fresh',
    tool_executions: [{
      result: { weather: { frost_risk_pct: 75, temp_min_c: -1.5 } }
    }]
  }, container3a);
  assert.ok(container3a.innerHTML.includes('risk-high'), 'Debe incluir clase risk-high para >=60%');
  assert.ok(container3a.innerHTML.includes('75%'), 'Debe mostrar el porcentaje exacto');
  assert.ok(container3a.innerHTML.includes('Riesgo Alto de Helada'), 'Debe mostrar texto descriptivo');
  pass('Riesgo meteorológico alto (>=60%) renderiza badge rojo con porcentaje exacto');

  // Caso 3b: Riesgo Moderado (45%)
  const container3b = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Atención a helada moderada.',
    weather_status: 'fresh',
    tool_executions: [{
      result: { weather: { frost_risk_pct: 45, temp_min_c: 2.0 } }
    }]
  }, container3b);
  assert.ok(container3b.innerHTML.includes('risk-moderate'), 'Debe incluir clase risk-moderate para 30-59%');
  assert.ok(container3b.innerHTML.includes('45%'), 'Debe mostrar 45%');
  pass('Riesgo meteorológico moderado (30-59%) renderiza badge amarillo/ámbar');

  // Caso 3c: Riesgo Bajo (15%)
  const container3c = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Condiciones favorables.',
    weather_status: 'fresh',
    tool_executions: [{
      result: { weather: { frost_risk_pct: 15, temp_min_c: 8.0 } }
    }]
  }, container3c);
  assert.ok(container3c.innerHTML.includes('risk-low'), 'Debe incluir clase risk-low para <30%');
  assert.ok(container3c.innerHTML.includes('15%'), 'Debe mostrar 15%');
  pass('Riesgo meteorológico bajo (<30%) renderiza badge verde');

  // Caso 3d: Sin datos meteorológicos
  const container3d = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Sin datos disponibles.',
    weather_status: 'missing_weather'
  }, container3d);
  assert.ok(container3d.innerHTML.includes('risk-none'), 'Debe incluir clase risk-none');
  assert.ok(container3d.innerHTML.includes('Sin telemetría de helada'), 'Debe informar ausencia de datos');
  pass('Ausencia de pronóstico renderiza badge gris neutral sin inventar riesgos ni porcentajes');

  // 4. Acciones sugeridas con chips numerados
  const container4 = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Acciones para mitigar frío.',
    suggested_actions: ['Revisar acolchado térmico', 'Monitorear temperatura a las 4 AM']
  }, container4);
  const actionItems = container4.querySelectorAll('.chat-action-item');
  assert.strictEqual(actionItems.length, 2, 'Deben existir 2 items de acciones');
  assert.ok(container4.innerHTML.includes('chat-action-num'), 'Debe incluir numeración visual');
  assert.ok(container4.innerHTML.includes('Revisar acolchado térmico'), 'Debe contener el texto de la acción 1');
  assert.ok(container4.innerHTML.includes('Monitorear temperatura a las 4 AM'), 'Debe contener el texto de la acción 2');
  pass('Acciones recomendadas renderizadas en tarjetas individuales (.chat-action-item) con chip numérico');

  // 5. Advertencias con icono y estilo no alarmista
  const container5 = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Advertencias de manejo.',
    warnings: ['Viento helado previsto para la madrugada', 'Suelo con humedad deficiente']
  }, container5);
  const warningItems = container5.querySelectorAll('.chat-warning-item');
  assert.strictEqual(warningItems.length, 2, 'Deben existir 2 items de advertencia');
  assert.ok(container5.innerHTML.includes('chat-warning-icon'), 'Debe incluir icono de advertencia');
  assert.ok(container5.innerHTML.includes('Viento helado previsto'), 'Debe contener la advertencia 1');
  pass('Advertencias agronómicas renderizadas en elementos individuales (.chat-warning-item) con icono');

  // 6. Tolerancia a campos ausentes o nulos
  const container6 = createMockElement('div');
  appendAssistantMessageBubble({
    reply: 'Consulta simple sin metadatos.',
    warnings: null,
    suggested_actions: null,
    context_used: null,
    tool_executions: null
  }, container6);
  assert.ok(container6.innerHTML.includes('Consulta simple sin metadatos'), 'Debe renderizar la respuesta limpiamente');
  pass('Tolerancia total ante campos nulos o ausentes sin errores de ejecución');

  // 7. Protección anti-XSS estricta
  const container7 = createMockElement('div');
  const maliciousPayload = {
    reply: '<script>alert("xss")</script>Texto seguro',
    warnings: ['<img src="x" onerror="alert(1)">Peligro'],
    suggested_actions: ['<iframe src="evil.com"></iframe>Acción']
  };
  appendAssistantMessageBubble(maliciousPayload, container7);
  assert.ok(!container7.innerHTML.includes('<script>'), 'No debe contener tags de script ejecutables');
  assert.ok(!container7.innerHTML.includes('<img src="x"'), 'No debe contener tags de img maliciosas');
  assert.ok(!container7.innerHTML.includes('<iframe'), 'No debe contener iframes');
  assert.ok(container7.innerHTML.includes('&lt;script&gt;'), 'Debe escapar caracteres HTML mediante textContent');
  pass('Protección anti-XSS validada: todos los textos dinámicos se escapan de forma segura');

  console.log('\n' + '='.repeat(80));
  console.log(`🎉 TODAS LAS ${checkCount} VERIFICACIONES DE AGENT05 APROBADAS SATISFACTORIAMENTE`);
  console.log('='.repeat(80));
}

runSuite().catch(err => {
  console.error('❌ Error en suite AGENT05:', err);
  process.exit(1);
});
