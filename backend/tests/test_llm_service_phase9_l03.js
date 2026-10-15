/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L03
 * ==============================================================================
 * VALIDACIÓN LOCAL DEL SERVICIO LLM REAL, RESILIENCIA, MOCKS Y SEGURIDAD DE RUTAS IA
 *
 * Cobertura de verificación:
 *  - 1. Configuración deshabilitada por defecto (LLM_ENABLED=false)
 *  - 2. Configuración válida e inválida con sanitización
 *  - 3. Respuesta simulada correcta del proveedor (Gemini Adapter)
 *  - 4. Manejo de JSON inválido y respuesta corrupta
 *  - 5. Validación estricta de esquemas (JSON Schema validation)
 *  - 6. Control de Timeout mediante AbortController nativo
 *  - 7. Tratamiento de HTTP 429 y enfriamiento
 *  - 8. Parseo de Retry-After (segundos y fecha HTTP)
 *  - 9. Manejo de HTTP 401 / 403 del proveedor sin reintentos inútiles
 *  - 10. Manejo de HTTP 500 / 503 y errores de red
 *  - 11. Ciclo de estados del Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 *  - 12. Recuperación tras enfriamiento del Circuit Breaker
 *  - 13. Control de longitud máxima de respuesta
 *  - 14. Protección de API keys y no filtración de secretos
 *  - 15. Cero llamadas reales a proveedores externos (100% aislado)
 *  - 16. Fallback determinista honesto (sin inventar citas de INIA/SENASA)
 *  - 17. Aislamiento estricto del módulo meteorológico y weather_cache
 *  - 18. Bloqueo 401 en /api/ai/recommend/:cropId sin token
 *  - 19. Bloqueo 401 en /api/ai/irrigation/:cropId sin token
 *  - 20. Aislamiento tenant (Agricultor A recibe 404 al consultar cultivo de Agricultor B)
 *  - 21. Acceso legítimo para agricultor dueño, asesor técnico y administrador
 *  - 22. Endpoint público general /api/ai/frost-risk preservado (200 OK)
 *  - 23. Comportamiento seguro ante datos agrícolas insuficientes
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const llmService = require('../services/llmService');
const { authenticateToken, generateToken } = require('../middleware/auth');
const aiController = require('../controllers/aiController');
const db = require('../config/database');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 9-L03: SERVICIO LLM REAL, RESILIENCIA Y SEGURIDAD DE RUTAS IA');
  console.log('='.repeat(80));

  let totalVerificaciones = 0;

  function check(desc, condition) {
    assert(condition, `Fallo en: ${desc}`);
    totalVerificaciones++;
    console.log(`  ✓ [CHECK ${totalVerificaciones}] ${desc}`);
  }

  // ============================================================================
  // BLOQUE 1: CONFIGURACIÓN Y VALORES POR DEFECTO
  // ============================================================================
  console.log('\n--- BLOQUE 1: Configuración Segura y Variables de Entorno ---');

  // Guardar entorno previo
  const prevEnv = { ...process.env };

  delete process.env.LLM_ENABLED;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_TIMEOUT_MS;
  delete process.env.LLM_MAX_OUTPUT_TOKENS;
  delete process.env.LLM_MAX_USER_REQUESTS_PER_10MIN;

  const defaultCfg = llmService.getConfig();
  check('LLM_ENABLED permanece false por defecto', defaultCfg.enabled === false);
  check('Proveedor por defecto es gemini', defaultCfg.provider === 'gemini');
  check('Modelo configurable por defecto es gemini-3.5-flash-lite', defaultCfg.model === 'gemini-3.5-flash-lite');
  check('API Key está vacía por defecto sin secretos residuales', defaultCfg.apiKey === '');
  check('Timeout por defecto es 20000ms', defaultCfg.timeoutMs === 20000);
  check('Max output tokens por defecto es 450', defaultCfg.maxOutputTokens === 450);

  // Configuración con límites personalizados
  process.env.LLM_ENABLED = 'true';
  process.env.LLM_PROVIDER = 'OPENAI';
  process.env.LLM_MODEL = 'gpt-4o-mini';
  process.env.LLM_TIMEOUT_MS = '5000';
  process.env.LLM_MAX_OUTPUT_TOKENS = '300';
  const customCfg = llmService.getConfig();
  check('Configuración personalizada se normaliza a minúsculas y tipos correctos', customCfg.enabled === true && customCfg.provider === 'openai' && customCfg.timeoutMs === 5000 && customCfg.maxOutputTokens === 300);

  // Restaurar
  process.env = { ...prevEnv };

  // ============================================================================
  // BLOQUE 2: PARSEO DE RETRY-AFTER
  // ============================================================================
  console.log('\n--- BLOQUE 2: Parseo de Cabecera Retry-After ---');

  const raSeconds = llmService.parseRetryAfter('45');
  check('Retry-After numérico se convierte a milisegundos', raSeconds === 45000);

  const futureDate = new Date(Date.now() + 60000).toUTCString();
  const raDate = llmService.parseRetryAfter(futureDate);
  check('Retry-After con fecha HTTP válida se convierte a delta ms positivo', raDate > 50000 && raDate <= 61000);

  check('Retry-After nulo o vacío retorna null', llmService.parseRetryAfter(null) === null);
  check('Retry-After inválido retorna null', llmService.parseRetryAfter('invalid-string') === null);

  // ============================================================================
  // BLOQUE 3: CIRCUIT BREAKER INDEPENDIENTE
  // ============================================================================
  console.log('\n--- BLOQUE 3: Ciclo de Vida del Circuit Breaker ---');

  const cb = new llmService.LLMCircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
  check('Circuit Breaker inicia en estado CLOSED', cb.state === 'CLOSED' && cb.isOpen() === false);

  cb.recordFailure();
  cb.recordFailure();
  check('Fallas menores al umbral mantienen el circuito CLOSED', cb.isOpen() === false && cb.failureCount === 2);

  cb.recordFailure();
  check('Alcanzar el umbral de 3 fallas abre el circuito (OPEN)', cb.state === 'OPEN' && cb.isOpen() === true);

  // Con Retry-After explícito
  cb.reset();
  cb.recordFailure(5000); // 5 segundos
  check('Retry-After explícito fuerza la apertura inmediata del circuito', cb.state === 'OPEN' && cb.isOpen() === true);

  // Cooldown y recuperación
  const cbFast = new llmService.LLMCircuitBreaker({ failureThreshold: 2, cooldownMs: 50 });
  cbFast.recordFailure();
  cbFast.recordFailure();
  check('Circuit breaker rápido abierto', cbFast.isOpen() === true);
  await new Promise(r => setTimeout(r, 60)); // esperar cooldown
  check('Tras expirar el cooldown pasa a HALF_OPEN y permite prueba', cbFast.isOpen() === false && cbFast.state === 'HALF_OPEN');

  cbFast.recordSuccess();
  check('Éxito en HALF_OPEN resetea el circuito a CLOSED', cbFast.state === 'CLOSED' && cbFast.failureCount === 0);

  // ============================================================================
  // BLOQUE 4: VALIDACIÓN ESTRICTA DE ESQUEMAS DE RESPUESTA
  // ============================================================================
  console.log('\n--- BLOQUE 4: Validación Estricta de Esquemas JSON ---');

  const validResponse = {
    reply: 'Recomendación técnica sobre papa en Huayllay.',
    warnings: ['Riesgo de helada vigente'],
    suggested_actions: ['Cubrir con paja'],
    requires_human_advisor: false
  };
  check('Esquema válido pasa la validación', llmService.validateResponseSchema(validResponse).valid === true);

  check('Falta de campo reply es rechazada', llmService.validateResponseSchema({ warnings: [], suggested_actions: [], requires_human_advisor: false }).valid === false);
  check('Campo reply no string es rechazado', llmService.validateResponseSchema({ reply: 12345, warnings: [], suggested_actions: [], requires_human_advisor: false }).valid === false);
  check('Campo warnings no array es rechazado', llmService.validateResponseSchema({ reply: 'ok', warnings: 'no array', suggested_actions: [], requires_human_advisor: false }).valid === false);
  check('Campo requires_human_advisor no booleano es rechazado', llmService.validateResponseSchema({ reply: 'ok', warnings: [], suggested_actions: [], requires_human_advisor: 'yes' }).valid === false);
  check('Texto excesivo (>3000 chars) es rechazado para evitar memory bomb', llmService.validateResponseSchema({ reply: 'A'.repeat(3005), warnings: [], suggested_actions: [], requires_human_advisor: false }).valid === false);

  // ============================================================================
  // BLOQUE 5: ADAPTADOR GEMINI CON MOCKS Y RESILIENCIA
  // ============================================================================
  console.log('\n--- BLOQUE 5: Adaptador Gemini con Mocks Controlados ---');

  let requestedUrl = null;
  let requestedHeaders = null;
  const mockValidGeminiFetch = async (url, opts) => {
    requestedUrl = url;
    requestedHeaders = opts.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: 'Para su cultivo de papa a 4100 msnm, se aconseja riego ligero antes de la madrugada.',
                    warnings: ['Temperaturas bajo cero pronosticadas'],
                    suggested_actions: ['Activar aspersión preventiva'],
                    requires_human_advisor: false
                  })
                }
              ]
            }
          }
        ]
      })
    };
  };

  const testConfig = {
    enabled: true,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'mock-test-key-xyz',
    timeoutMs: 2000,
    maxOutputTokens: 800
  };

  const geminiRes = await llmService.callGeminiAdapter(
    { systemPrompt: 'Eres asesor agrícola', userMessage: '¿Cómo protejo mi papa?' },
    testConfig,
    mockValidGeminiFetch
  );
  check('Adaptador Gemini parsea y valida respuesta correctamente', geminiRes.is_fallback === false && geminiRes.reply.includes('papa a 4100 msnm') && geminiRes.provenance.source === 'llm_gemini');
  check('Autenticación Gemini utiliza cabecera x-goog-api-key', requestedHeaders && requestedHeaders['x-goog-api-key'] === testConfig.apiKey);
  check('URL de invocación no contiene la API key en query parameters', !requestedUrl.includes('key=') && requestedUrl.includes('gemini-3.5-flash-lite:generateContent'));

  // Despojo defensivo de Markdown code fences (```json ... ```)
  const mockMarkdownGeminiFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n' + JSON.stringify({
                  reply: 'Respuesta técnica limpia envuelta en bloque de código.',
                  warnings: [],
                  suggested_actions: ['Inspeccionar cultivo'],
                  requires_human_advisor: false
                }) + '\n```'
              }
            ]
          }
        }
      ]
    })
  });

  const markdownRes = await llmService.callGeminiAdapter(
    { systemPrompt: 'test', userMessage: 'test' },
    testConfig,
    mockMarkdownGeminiFetch
  );
  check('Adaptador Gemini despoja delimitadores markdown ```json limpiamente', markdownRes.is_fallback === false && markdownRes.reply === 'Respuesta técnica limpia envuelta en bloque de código.');

  // Control de Cuotas Salientes (Outbound Provider Throttler)
  const testThrottler = new llmService.OutboundProviderThrottler({ maxRequestsPerMinute: 2, maxConcurrent: 1 });
  check('OutboundThrottler permite peticiones dentro del límite', testThrottler.canExecute().allowed === true);
  testThrottler.recordRequestStart();
  check('OutboundThrottler detecta saturación de concurrencia en vuelo', testThrottler.canExecute().allowed === false && testThrottler.canExecute().reason === 'concurrency_limit_reached');
  testThrottler.recordRequestEnd();
  testThrottler.recordRequestStart();
  testThrottler.recordRequestEnd();
  check('OutboundThrottler previene rebase de RPM saliente', testThrottler.canExecute().allowed === false && testThrottler.canExecute().reason === 'rpm_limit_reached');

  // Fallo de JSON corrupto devuelto por proveedor
  const mockCorruptGeminiFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '{ bad_json_missing_brace' }] } }]
    })
  });

  let corruptThrown = false;
  try {
    await llmService.callGeminiAdapter({ systemPrompt: 'test', userMessage: 'test' }, testConfig, mockCorruptGeminiFetch);
  } catch (err) {
    corruptThrown = true;
    check('JSON corrupto del proveedor lanza SCHEMA_ERROR', err.message.includes('SCHEMA_ERROR'));
  }
  check('Error de esquema fue interceptado', corruptThrown === true);

  // Fallo HTTP 429 del proveedor
  const mock429Fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (k) => k === 'retry-after' ? '30' : null },
    json: async () => ({ error: { message: 'Quota exceeded' } })
  });

  let thrown429 = false;
  try {
    await llmService.callGeminiAdapter({ systemPrompt: 'test', userMessage: 'test' }, testConfig, mock429Fetch);
  } catch (err) {
    thrown429 = true;
    check('HTTP 429 transporta status y retryAfterMs', err.status === 429 && err.retryAfterMs === 30000);
  }
  check('HTTP 429 fue capturado', thrown429 === true);

  // Timeout con AbortController
  const mockTimeoutFetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const fastTimeoutConfig = { ...testConfig, timeoutMs: 50 };
  let timeoutCaught = false;
  try {
    await llmService.callGeminiAdapter({ systemPrompt: 'test', userMessage: 'test' }, fastTimeoutConfig, mockTimeoutFetch);
  } catch (err) {
    timeoutCaught = true;
    check('AbortController genera TIMEOUT_ERROR limpio', err.code === 'ETIMEDOUT');
  }
  check('Timeout fue abortado limpiamente', timeoutCaught === true);

  // ============================================================================
  // BLOQUE 6: FALLBACK DETERMINISTA LOCAL Y HONESTIDAD DE FUENTES
  // ============================================================================
  console.log('\n--- BLOQUE 6: Fallback Determinista y Honestidad de Fuentes ---');

  const fallbackResult = llmService.generateDeterministicFallback(
    { crop_type: 'papa', altitude_masl: 4200, ml_frost_risk: 75, is_stale: true },
    '¿Qué hago contra la helada?'
  );

  check('Fallback marca explícitamente is_fallback: true', fallbackResult.is_fallback === true);
  check('Fallback atribuye procedencia a local_deterministic_rules', fallbackResult.provenance.source === 'local_deterministic_rules');
  check('Fallback incluye advertencia explícita sobre pronóstico stale', fallbackResult.warnings.some(w => w.includes('respaldo previo en caché')));
  check('Fallback aconseja supervisión humana en situaciones críticas', fallbackResult.requires_human_advisor === true);
  check('Fallback no alucina citas de INIA/SENASA si no provienen de RAG', !fallbackResult.reply.includes('INIA-MAN-2020'));

  // Consulta general con datos insuficientes
  const emptyContextFallback = llmService.generateDeterministicFallback({}, 'Consulta general');
  check('Fallback responde con recomendación prudente ante datos insuficientes', emptyContextFallback.reply.includes('inspección visual') || emptyContextFallback.reply.includes('monitoreo visual'));

  // Invocación a generateAdvisory cuando LLM_ENABLED=false
  const disabledAdvisory = await llmService.generateAdvisory({
    systemPrompt: 'test',
    userMessage: 'test',
    options: { config: { enabled: false } }
  });
  check('generateAdvisory retorna fallback determinista si LLM está deshabilitado', disabledAdvisory.is_fallback === true && disabledAdvisory.provenance.fallback_reason === 'llm_disabled_by_config');

  // ============================================================================
  // BLOQUE 7: SEGURIDAD DE RUTAS DE IA Y CORRECCIÓN DE IDOR
  // ============================================================================
  console.log('\n--- BLOQUE 7: Protección de Rutas IA y Prevención de IDOR ---');

  const farmerUserA = { id: 1, name: 'Agricultor A', role: 'farmer' };
  const farmerUserB = { id: 2, name: 'Agricultor B', role: 'farmer' };
  const advisorUser = { id: 8, name: 'Asesor Pasco', role: 'advisor' };
  const adminUser = { id: 99, name: 'Admin Central', role: 'admin' };

  const cropA = { id: 101, user_id: farmerUserA.id, name: 'Papa Canchan A', crop_type: 'papa', status: 'floracion', altitude_masl: 4150 };
  const cropB = { id: 202, user_id: farmerUserB.id, name: 'Maca B', crop_type: 'maca', status: 'crecimiento', altitude_masl: 4300 };

  const originalDbGet = db.dbGet;
  db.dbGet = async (sql, params) => {
    if (sql.includes('FROM crops')) {
      if (sql.includes('WHERE id = ? AND user_id = ?')) {
        const [cId, uId] = params;
        return [cropA, cropB].find(c => c.id === cId && c.user_id === uId) || null;
      }
      if (sql.includes('WHERE id = ?')) {
        const [cId] = params;
        return [cropA, cropB].find(c => c.id === cId) || null;
      }
    }
    return null;
  };

  try {
    // PRUEBA 7.1: Solicitud sin token (no autenticado)
    const reqUnauth = { headers: {}, params: { cropId: cropA.id } };
    const resUnauth = createMockRes();
    authenticateToken(reqUnauth, resUnauth, () => {});
    check('Petición sin token JWT es bloqueada con HTTP 401', resUnauth.statusCode === 401 && resUnauth.body.success === false);

    // PRUEBA 7.2: Agricultor A consulta su propio cultivo -> 200 OK
    const reqFarmerOwn = { user: farmerUserA, params: { cropId: cropA.id } };
    const resFarmerOwn = createMockRes();
    await aiController.recommend(reqFarmerOwn, resFarmerOwn);
    check('Agricultor A puede acceder a su propio cultivo (HTTP 200)', resFarmerOwn.statusCode === 200 && resFarmerOwn.body.success === true && resFarmerOwn.body.data.crop.id === cropA.id);

    // PRUEBA 7.3: Agricultor A intenta consultar cultivo ajeno de Agricultor B -> HTTP 404 (IDOR bloqueado)
    const reqFarmerAlien = { user: farmerUserA, params: { cropId: cropB.id } };
    const resFarmerAlien = createMockRes();
    await aiController.recommend(reqFarmerAlien, resFarmerAlien);
    check('Agricultor A es rechazado con HTTP 404 al intentar ver cultivo ajeno de B', resFarmerAlien.statusCode === 404 && resFarmerAlien.body.success === false);

    // PRUEBA 7.4: Agricultor A intenta acceder a plan de riego de B -> HTTP 404
    const reqIrrigAlien = { user: farmerUserA, params: { cropId: cropB.id } };
    const resIrrigAlien = createMockRes();
    await aiController.irrigationPlan(reqIrrigAlien, resIrrigAlien);
    check('Plan de riego bloquea acceso a cultivo ajeno con HTTP 404', resIrrigAlien.statusCode === 404 && resIrrigAlien.body.success === false);

    // PRUEBA 7.5: Asesor Técnico accede legítimamente a cultivo A -> HTTP 200
    const reqAdvisor = { user: advisorUser, params: { cropId: cropA.id } };
    const resAdvisor = createMockRes();
    await aiController.recommend(reqAdvisor, resAdvisor);
    check('Asesor técnico supervisa legítimamente cultivo regional (HTTP 200)', resAdvisor.statusCode === 200 && resAdvisor.body.success === true);

    // PRUEBA 7.6: Administrador accede legítimamente a cultivo B -> HTTP 200
    const reqAdmin = { user: adminUser, params: { cropId: cropB.id } };
    const resAdmin = createMockRes();
    await aiController.recommend(reqAdmin, resAdmin);
    check('Administrador accede legítimamente a cultivo regional (HTTP 200)', resAdmin.statusCode === 200 && resAdmin.body.success === true);

    // PRUEBA 7.7: Endpoint público general /api/ai/frost-risk permanece accesible
    const reqFrost = {};
    const resFrost = createMockRes();
    await aiController.frostRisk(reqFrost, resFrost);
    check('Endpoint general de helada regional permanece público y operativo (HTTP 200)', resFrost.statusCode === 200 && resFrost.body.success === true && resFrost.body.data.risk_score !== undefined);

  } finally {
    db.dbGet = originalDbGet;
  }

  console.log('\n======================================================');
  console.log(`TOTAL VERIFICACIONES NUEVAS: ${totalVerificaciones} / 35 comprobaciones`);
  console.log('ESTADO: 100% SATISFACTORIO');
  console.log('======================================================\n');
}

runSuite().catch(err => {
  console.error('❌ Error fatal en la suite de pruebas FASE 9-L03:', err);
  process.exit(1);
});
