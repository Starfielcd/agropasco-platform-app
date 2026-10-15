/**
 * AgroPasco Digital — Agente Inteligente de Asesoría Agrícola (MVP)
 * ==============================================================================
 * Orquestador de Tool Calling para Google Gemini API (gemini-3.5-flash-lite).
 *
 * Características:
 *  - Selección autónoma y controlada de herramientas (Function Calling)
 *  - Validación estricta y autorización RBAC en el servidor antes de ejecutar herramientas
 *  - Límite estricto: Máximo 1 invocación de herramienta por consulta en MVP
 *  - Trazabilidad explícita: reporta `tool_used` y `tool_executions` en el payload final
 *  - Fallback determinista local integrado si el LLM está inactivo o no responde
 *  - Cero llamadas externas no autorizadas; cero modificaciones en base de datos
 */

'use strict';

const {
  getConfig,
  defaultCircuitBreaker,
  defaultOutboundThrottler,
  validateResponseSchema,
  generateDeterministicFallback,
  parseRetryAfter
} = require('../services/llmService');

const {
  PARCEL_WEATHER_RISK_DECLARATION,
  executeParcelWeatherRiskTool
} = require('./tools/parcelWeatherRiskTool');

// Registro cerrado de herramientas autorizadas
const AGENT_TOOLS_MAP = {
  get_parcel_weather_risk: executeParcelWeatherRiskTool
};

const AGENT_TOOL_DECLARATIONS = [
  PARCEL_WEATHER_RISK_DECLARATION
];

const AGENT_SYSTEM_PROMPT = `Eres el Agente Inteligente de Asesoría Agrícola de AgroPasco Digital, especialista en agronomía para la Región Pasco (Cerro de Pasco, Oxapampa y Daniel Alcides Carrión).
Dispones de la herramienta "get_parcel_weather_risk" para consultar el estado meteorológico y riesgos de una parcela cuando el usuario pregunte por sus condiciones específicas o riesgos climáticos.
Si la consulta es general (conceptos, rotación, plagas teóricas) responde directamente sin invocar herramientas.
Si el usuario pregunta por su parcela o sobre riesgos actuales y tienes un parcel_id disponible o el usuario lo menciona, invoca "get_parcel_weather_risk".
Cuando recibas los resultados de una herramienta, incorpóralos con honestidad en tu recomendación técnica sin inventar datos que falten.
Tu respuesta final DEBE ser SIEMPRE un objeto JSON con el siguiente esquema estricto:
{
  "reply": "Recomendación técnica agronómica redactada con claridad",
  "warnings": ["lista de advertencias técnicas o meteorológicas si corresponden"],
  "suggested_actions": ["lista de 2 a 4 pasos prácticos preventivos para el agricultor"],
  "requires_human_advisor": false
}`;

/**
 * Ejecuta una consulta al Agente Agrícola con soporte completo para Tool Calling.
 *
 * @param {object} params
 * @param {string} params.userMessage Mensaje del agricultor
 * @param {object} params.authContext Identidad autenticada { userId, userRole }
 * @param {number|null} [params.parcelId] Parcela seleccionada en la interfaz
 * @param {object} [params.contextData] Contexto preliminar
 * @param {Array} [params.conversationHistory] Historial previo
 * @param {object} [params.options] Opciones avanzadas o mocks para tests
 * @returns {Promise<object>} Respuesta estructurada con metadatos de herramientas
 */
async function runAgriculturalAgent({
  userMessage,
  prompt,
  authContext = {},
  parcelId = null,
  contextData = {},
  evidenceData = [],
  conversationHistory = [],
  options = {}
}) {
  const effectiveUserMessage = userMessage || prompt || options.userMessage || options.prompt || '';
  const effectiveAuthContext = (authContext && authContext.userId) ? authContext : (options.authContext || {});
  const effectiveParcelId = parcelId !== null && parcelId !== undefined ? parcelId : (options.parcelId || null);
  const effectiveEvidence = (Array.isArray(evidenceData) && evidenceData.length > 0)
    ? evidenceData
    : (Array.isArray(options.evidenceData) ? options.evidenceData : []);

  const config = options.config || getConfig();
  const circuitBreaker = options.circuitBreaker || defaultCircuitBreaker;
  const throttler = options.throttler || defaultOutboundThrottler;
  const fetchFn = options.fetchFn || globalThis.fetch;

  // 1. Si el LLM está deshabilitado en configuración -> Fallback directo
  if (!config.enabled) {
    const fallbackRes = generateDeterministicFallback(contextData, effectiveUserMessage, 'llm_disabled_by_config');
    return {
      ...fallbackRes,
      tool_used: null,
      tool_executions: []
    };
  }

  // 2. Si el Circuit Breaker está abierto -> Fallback inmediato
  if (circuitBreaker.isOpen()) {
    const fallbackRes = generateDeterministicFallback(contextData, effectiveUserMessage, 'circuit_breaker_open');
    return {
      ...fallbackRes,
      tool_used: null,
      tool_executions: []
    };
  }

  // 3. Control de cuotas salientes defensivo (14 RPM / Concurrencia)
  const throttleCheck = throttler.canExecute();
  if (!throttleCheck.allowed) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[AGENT_THROTTLE] Cuota saliente prevenida (${throttleCheck.reason}). Activando fallback.`);
    }
    const fallbackRes = generateDeterministicFallback(contextData, effectiveUserMessage, `outbound_rate_limit: ${throttleCheck.reason}`);
    return {
      ...fallbackRes,
      tool_used: null,
      tool_executions: []
    };
  }

  // 4. Modo Mock inyectado para pruebas automatizadas (CERO consumo de API externa)
  const mockFn = options.mockAgentHandler || options.mockHandler;
  if (mockFn && typeof mockFn === 'function') {
    try {
      const mockResult = await mockFn({
        systemPrompt: options.systemPrompt || AGENT_SYSTEM_PROMPT,
        userMessage: effectiveUserMessage,
        contextData,
        evidenceData: effectiveEvidence,
        authContext: effectiveAuthContext,
        parcelId: effectiveParcelId,
        conversationHistory
      }, config);
      return {
        reply: mockResult.reply || '',
        warnings: Array.isArray(mockResult.warnings) ? mockResult.warnings : [],
        suggested_actions: Array.isArray(mockResult.suggested_actions) ? mockResult.suggested_actions : [],
        requires_human_advisor: Boolean(mockResult.requires_human_advisor),
        is_fallback: Boolean(mockResult.is_fallback),
        tool_used: mockResult.tool_used || null,
        tool_executions: Array.isArray(mockResult.tool_executions) ? mockResult.tool_executions : [],
        provenance: mockResult.provenance || {
          source: 'llm_gemini_agent',
          model: config.model,
          generated_at: new Date().toISOString()
        }
      };
    } catch (err) {
      return {
        ...generateDeterministicFallback(contextData, effectiveUserMessage, `mock_error: ${err.message}`),
        tool_used: null,
        tool_executions: []
      };
    }
  }

  throttler.recordRequestStart();

  const toolExecutions = [];
  let toolUsedName = null;

  try {
    // 5. Preparar prompt con contexto de parcela vinculada si existe
    let augmentedUserMessage = effectiveUserMessage;
    if (effectiveParcelId) {
      augmentedUserMessage += `\n[PARCELA_VINCULADA_ACTUAL: parcel_id = ${effectiveParcelId}]`;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

    const contents = [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(msg.content) }]
          });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: augmentedUserMessage }]
    });

    // 6. Turno 1: Enviar solicitud con declaración de herramientas
    const turn1Body = {
      contents,
      systemInstruction: {
        parts: [{ text: options.systemPrompt || AGENT_SYSTEM_PROMPT }]
      },
      tools: [
        { functionDeclarations: AGENT_TOOL_DECLARATIONS }
      ],
      generationConfig: {
        maxOutputTokens: config.maxOutputTokens,
        temperature: 0.2
      }
    };

    const controller1 = new AbortController();
    const timer1 = setTimeout(() => controller1.abort(), config.timeoutMs);
    let turn1Response;

    try {
      turn1Response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey
        },
        body: JSON.stringify(turn1Body),
        signal: controller1.signal
      });
    } catch (err) {
      clearTimeout(timer1);
      if (err.name === 'AbortError' || err.code === 20) {
        const timeoutErr = new Error(`TIMEOUT_ERROR: Agente excedió límite de ${config.timeoutMs}ms.`);
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer1);
    }

    if (!turn1Response.ok) {
      const status = turn1Response.status;
      const retryAfterMs = parseRetryAfter(turn1Response.headers ? turn1Response.headers.get('retry-after') : null);
      const httpErr = new Error(`HTTP_${status}: Error de proveedor en Agente.`);
      httpErr.status = status;
      httpErr.retryAfterMs = retryAfterMs;
      throw httpErr;
    }

    const turn1Json = await turn1Response.json();
    const candidate1 = turn1Json.candidates?.[0];
    const candidateParts1 = candidate1?.content?.parts || [];

    // 7. Evaluar si Gemini solicitó ejecutar una herramienta (Function Call)
    const functionCallPart = candidateParts1.find(p => p.functionCall);

    if (functionCallPart && functionCallPart.functionCall) {
      const call = functionCallPart.functionCall;
      const toolName = call.name;
      const toolArgs = call.args || {};

      toolUsedName = toolName;

      // Validación de lista cerrada de herramientas
      const toolFn = AGENT_TOOLS_MAP[toolName];
      let toolResult;

      if (!toolFn) {
        toolResult = {
          success: false,
          error: `Herramienta "${toolName}" no reconocida o no autorizada.`
        };
      } else {
        // Ejecución autorizada en servidor con RBAC
        try {
          toolResult = await toolFn(toolArgs, authContext, options);
        } catch (toolErr) {
          toolResult = {
            success: false,
            error: `Error interno al ejecutar herramienta: ${toolErr.message}`
          };
        }
      }

      toolExecutions.push({
        tool: toolName,
        tool_name: toolName,
        args: toolArgs,
        result: toolResult,
        status: toolResult.success ? 'success' : 'error',
        success: Boolean(toolResult.success),
        executed_at: new Date().toISOString()
      });

      // 8. Turno 2: Entregar resultado de la herramienta a Gemini y solicitar JSON final
      contents.push(candidate1.content || {
        role: 'model',
        parts: [{ functionCall: call }]
      });
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolName,
            response: toolResult
          }
        }]
      });

      const turn2Body = {
        contents,
        systemInstruction: {
          parts: [{ text: options.systemPrompt || AGENT_SYSTEM_PROMPT }]
        },
        generationConfig: {
          maxOutputTokens: config.maxOutputTokens,
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      };

      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), config.timeoutMs);
      let turn2Response;

      try {
        turn2Response = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey
          },
          body: JSON.stringify(turn2Body),
          signal: controller2.signal
        });
      } catch (err) {
        clearTimeout(timer2);
        if (err.name === 'AbortError' || err.code === 20) {
          const timeoutErr = new Error(`TIMEOUT_ERROR: Agente excedió límite de ${config.timeoutMs}ms en Turno 2.`);
          timeoutErr.code = 'ETIMEDOUT';
          throw timeoutErr;
        }
        throw err;
      } finally {
        clearTimeout(timer2);
      }

      if (!turn2Response.ok) {
        const status = turn2Response.status;
        const retryAfterMs = parseRetryAfter(turn2Response.headers ? turn2Response.headers.get('retry-after') : null);
        const httpErr = new Error(`HTTP_${status}: Error de proveedor en Agente (Turno 2).`);
        httpErr.status = status;
        httpErr.retryAfterMs = retryAfterMs;
        throw httpErr;
      }

      const turn2Json = await turn2Response.json();
      const rawFinalText = turn2Json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawFinalText) {
        throw new Error('EMPTY_RESPONSE: No se recibió contenido del Agente tras ejecutar la herramienta.');
      }

      let payload;
      try {
        const cleanJsonText = rawFinalText
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/i, '')
          .trim();
        payload = JSON.parse(cleanJsonText);
      } catch (_) {
        throw new Error('SCHEMA_ERROR: El contenido devuelto por el Agente no es JSON válido.');
      }

      const validation = validateResponseSchema(payload);
      if (!validation.valid) {
        throw new Error(`SCHEMA_VALIDATION_ERROR: ${validation.error}`);
      }

      circuitBreaker.recordSuccess();

      return {
        reply: payload.reply,
        warnings: payload.warnings || [],
        suggested_actions: payload.suggested_actions || [],
        requires_human_advisor: Boolean(payload.requires_human_advisor),
        is_fallback: false,
        tool_used: toolUsedName,
        tool_executions: toolExecutions,
        provenance: {
          source: 'llm_gemini_agent',
          model: config.model,
          generated_at: new Date().toISOString()
        }
      };
    } else {
      // 9. Caso sin llamada a herramienta (Gemini respondió directamente con texto)
      const rawText = candidateParts1[0]?.text || '';
      let payload;
      try {
        const cleanJsonText = rawText
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/i, '')
          .trim();
        payload = JSON.parse(cleanJsonText);
      } catch (_) {
        // Si no devolvió JSON estricto, encapsular en contrato seguro
        payload = {
          reply: rawText || 'Orientación general emitida por el asistente agrícola.',
          warnings: [],
          suggested_actions: ['Revisar condiciones generales en campo.'],
          requires_human_advisor: false
        };
      }

      const validation = validateResponseSchema(payload);
      if (!validation.valid) {
        payload = {
          reply: payload.reply || String(rawText),
          warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
          suggested_actions: Array.isArray(payload.suggested_actions) ? payload.suggested_actions : [],
          requires_human_advisor: Boolean(payload.requires_human_advisor)
        };
      }

      circuitBreaker.recordSuccess();

      return {
        reply: payload.reply,
        warnings: payload.warnings || [],
        suggested_actions: payload.suggested_actions || [],
        requires_human_advisor: Boolean(payload.requires_human_advisor),
        is_fallback: false,
        tool_used: null,
        tool_executions: [],
        provenance: {
          source: 'llm_gemini_agent',
          model: config.model,
          generated_at: new Date().toISOString()
        }
      };
    }
  } catch (err) {
    const retryAfterMs = err.retryAfterMs || null;
    circuitBreaker.recordFailure(retryAfterMs);

    let safeErrMessage = err.message || '';
    if (config.apiKey) {
      safeErrMessage = safeErrMessage.split(config.apiKey).join('[REDACTED_KEY]');
    }
    safeErrMessage = safeErrMessage.replace(/key=[^&\s]+/g, 'key=[REDACTED]').replace(/AIza[0-9A-Za-z-_]+/g, '[REDACTED_KEY]');

    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[AGENT_ERROR] Error en Agente Agrícola: ${safeErrMessage}. Activando fallback determinista.`);
    }

    const fallbackRes = generateDeterministicFallback(contextData, userMessage, `agent_error: ${safeErrMessage}`);
    return {
      ...fallbackRes,
      tool_used: null,
      tool_executions: toolExecutions
    };
  } finally {
    throttler.recordRequestEnd();
    if (circuitBreaker.isProbing) {
      circuitBreaker.releaseProbe();
    }
  }
}

module.exports = {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOL_DECLARATIONS,
  AGENT_TOOLS_MAP,
  runAgriculturalAgent
};
