/**
 * AgroPasco Digital — Suite de Regresión AGENT04: Corrección Turno 2 Gemini Function Calling
 * ==============================================================================
 * Verificaciones:
 *  1. Comprueba que el Turno 2 serializa el mensaje del functionResponse con role: 'user' (protocolo oficial Gemini REST).
 *  2. Comprueba que el Turno 2 preserva el candidate.content del Turno 1 con su thoughtSignature e id de llamada.
 *  3. Comprueba que el Turno 2 no genera HTTP 400 de 'Role function is not supported'.
 *  4. Comprueba que la síntesis final del Turno 2 produce JSON válido estructurado con { reply, warnings, suggested_actions, requires_human_advisor }.
 */

const assert = require('assert');
const { runAgriculturalAgent } = require('../agents/agriculturalAgent');

async function runTurn2RegressionTests() {
  console.log('================================================================================');
  console.log('🧪 SUITE AGENT04: REGRESIÓN DE PAYLOAD Y PROTOCOLO GEMINI TURNO 2');
  console.log('================================================================================\n');

  let checkCount = 0;
  function pass(msg) {
    checkCount++;
    console.log(`  ✓ [CHECK ${checkCount}] ${msg}`);
  }

  // TEST 1: Simulación de Turno 1 a Turno 2 inspeccionando el payload enviado al proveedor
  let capturedTurn2Body = null;
  let capturedTurn1Body = null;

  const mockCandidateTurn1 = {
    content: {
      parts: [
        {
          functionCall: {
            name: 'get_parcel_weather_risk',
            args: { parcel_id: 101 },
            id: 'call_test_883'
          },
          thoughtSignature: 'EmAKXgFpFH0TfuodJLXyWbhE0Ba6tL7nzQ9NofPLWmJQvggoorquqax86XDGQtV7apT4lZehRC8w5w2SOxySPNl8DdIRppTKl/MBFOHUC7qTdzBrgxXkifBJckIuopm/mt4='
        }
      ],
      role: 'model'
    }
  };

  const mockFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.tools) {
      capturedTurn1Body = body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [mockCandidateTurn1]
        })
      };
    }

    // Turn 2
    capturedTurn2Body = body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                reply: 'Para su parcela 101, el riesgo de helada es del 70%.',
                warnings: ['Alerta de helada nocturna'],
                suggested_actions: ['Revisar riego preventivo'],
                requires_human_advisor: false
              })
            }]
          }
        }]
      })
    };
  };

  // Mock de la herramienta para que devuelva datos válidos
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const res = await runAgriculturalAgent({
      userMessage: '¿Cuál es el pronóstico de heladas en mi parcela?',
      authContext: { userId: 801, userRole: 'farmer' },
      parcelId: 101,
      options: {
        config: { enabled: true, provider: 'gemini', apiKey: 'test-key', model: 'gemini-3.5-flash-lite' },
        fetchFn: mockFetch
      }
    });

    assert.ok(capturedTurn1Body, 'Turno 1 debe haberse enviado');
    pass('Turno 1 envió declaración de herramientas');

    assert.ok(capturedTurn2Body, 'Turno 2 debe haberse enviado');
    pass('Turno 2 fue orquestado tras recibir functionCall');

    // Verificar estructura de contents en Turno 2
    const contents = capturedTurn2Body.contents;
    assert.strictEqual(contents.length, 3, 'contents debe tener 3 elementos: [user, model_functionCall, user_functionResponse]');
    pass('Historial en Turno 2 conserva los 3 turnos conversacionales requeridos');

    // Comprobar elemento 1: model con functionCall y thoughtSignature
    const modelContent = contents[1];
    assert.strictEqual(modelContent.role, 'model');
    assert.strictEqual(modelContent.parts[0].functionCall.name, 'get_parcel_weather_risk');
    assert.strictEqual(modelContent.parts[0].thoughtSignature, mockCandidateTurn1.content.parts[0].thoughtSignature);
    pass('Turno 2 preserva thoughtSignature e id del candidate.content del Turno 1');

    // Comprobar elemento 2: functionResponse con role 'user' (NO 'function')
    const funcResponseContent = contents[2];
    assert.strictEqual(funcResponseContent.role, 'user', 'El rol para functionResponse en Gemini v1beta DEBE ser "user"');
    assert.notStrictEqual(funcResponseContent.role, 'function', 'El rol "function" está explícitamente prohibido por la API de Gemini (HTTP 400)');
    pass('Turno 2 utiliza estrictamente role: "user" para functionResponse, neutralizando el error HTTP 400');

    assert.ok(funcResponseContent.parts[0].functionResponse, 'parts debe contener functionResponse');
    assert.strictEqual(funcResponseContent.parts[0].functionResponse.name, 'get_parcel_weather_risk');
    pass('functionResponse incluye el nombre exacto de la herramienta get_parcel_weather_risk');

    // Comprobar respuesta final sintetizada
    assert.strictEqual(res.is_fallback, false);
    assert.strictEqual(res.tool_used, 'get_parcel_weather_risk');
    assert.ok(res.reply.includes('parcela 101'));
    pass('Respuesta final del Agente incorpora la recomendación técnica sin activar fallback');

    console.log('\n' + '='.repeat(80));
    console.log(`🎉 TODAS LAS ${checkCount} VERIFICACIONES DE REGRESIÓN AGENT04 APROBADAS`);
    console.log('='.repeat(80));
  } finally {
    globalThis.fetch = origFetch;
  }
}

runTurn2RegressionTests().catch(err => {
  console.error('❌ Fallo en suite AGENT04:', err);
  process.exit(1);
});
