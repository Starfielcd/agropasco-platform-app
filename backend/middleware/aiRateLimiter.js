/**
 * AgroPasco Digital — Middleware de Rate Limiting para Asistente Agrícola (LLM)
 * ==============================================================================
 * FASE 9-L04: Resolución de MED-02
 *
 * Características:
 *  - Control estricto de cuotas por identidad JWT autenticada (req.user.id).
 *  - Ventana deslizante configurable (por defecto 15 solicitudes por 10 minutos).
 *  - Control de concurrencia en vuelo por usuario (burst protection): evita que
 *    ráfagas paralelas eludan la cuota antes de que finalice la primera petición.
 *  - Límite global de saturación de solicitudes simultáneas al servicio LLM.
 *  - Respuestas seguras HTTP 429 con cabecera estándar Retry-After.
 *  - Limpieza automática de estados expirados en memoria.
 *
 * NOTA DE ARQUITECTURA:
 *  Esta implementación opera en la memoria del proceso Node.js. Provee protección
 *  robusta y determinista contra abuso y condiciones de carrera dentro de la
 *  instancia local. En entornos con escalado horizontal multi-instancia, se
 *  complementará con un almacén distribuido (ej. Redis/Valkey).
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const DEFAULT_MAX_REQUESTS = 15;
const MAX_CONCURRENT_PER_USER = 1;
const MAX_GLOBAL_CONCURRENT = 10;

// Almacén en memoria por usuario
// Map<key, { timestamps: number[], inFlight: number }>
const userQuotaStore = new Map();
let globalInFlight = 0;

function getMaxRequests() {
  const envVal = parseInt(process.env.LLM_MAX_USER_REQUESTS_PER_10MIN, 10);
  return (!isNaN(envVal) && envVal > 0) ? envVal : DEFAULT_MAX_REQUESTS;
}

function getClientKey(req) {
  if (req.user && req.user.id) {
    return `user_${req.user.id}`;
  }
  // Fallback por IP si la petición no estuviese autenticada
  return `ip_${req.ip || req.connection?.remoteAddress || 'unknown'}`;
}

/**
 * Middleware Express para limitar el consumo del endpoint conversacional.
 */
function aiRateLimiter(req, res, next) {
  const now = Date.now();
  const maxRequests = getMaxRequests();
  const key = getClientKey(req);

  // 1. Limpieza de ventana para este usuario
  let record = userQuotaStore.get(key);
  if (!record) {
    record = { timestamps: [], inFlight: 0 };
    userQuotaStore.set(key, record);
  }

  // Filtrar timestamps que cayeron fuera de la ventana de 10 minutos
  record.timestamps = record.timestamps.filter(t => (now - t) < WINDOW_MS);

  // 2. Control de ráfagas concurrentes por usuario (Burst Protection)
  if (record.inFlight >= MAX_CONCURRENT_PER_USER) {
    res.setHeader('Retry-After', '2');
    return res.status(429).json({
      success: false,
      error: 'Ya tiene una consulta en proceso con el asistente. Por favor espere un momento a que finalice.',
      retry_after_seconds: 2
    });
  }

  // 3. Control de concurrencia global del proveedor
  if (globalInFlight >= MAX_GLOBAL_CONCURRENT) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({
      success: false,
      error: 'El asistente agrícola está procesando una alta demanda en este momento. Por favor reintente en unos segundos.',
      retry_after_seconds: 5
    });
  }

  // 4. Verificación de cuota por ventana temporal
  if (record.timestamps.length >= maxRequests) {
    const oldestTimestamp = record.timestamps[0];
    const retryAfterMs = Math.max(1000, (oldestTimestamp + WINDOW_MS) - now);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      success: false,
      error: `Límite de consultas del asistente alcanzado (máximo ${maxRequests} consultas cada 10 minutos). Por favor intente más tarde.`,
      retry_after_seconds: retryAfterSec
    });
  }

  // 5. Autorizar solicitud: registrar timestamp e incrementar en vuelo
  record.timestamps.push(now);
  record.inFlight++;
  globalInFlight++;

  // 6. Hook de finalización para liberar contadores en vuelo
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      record.inFlight = Math.max(0, record.inFlight - 1);
      globalInFlight = Math.max(0, globalInFlight - 1);
    }
  };

  res.on('finish', release);
  res.on('close', release);

  next();
}

/**
 * Limpieza periódica de registros inactivos para evitar fugas de memoria.
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [key, record] of userQuotaStore.entries()) {
    record.timestamps = record.timestamps.filter(t => (now - t) < WINDOW_MS);
    if (record.timestamps.length === 0 && record.inFlight === 0) {
      userQuotaStore.delete(key);
    }
  }
}

// Intervalo de limpieza cada 5 minutos (solo en entornos activos, no bloqueante)
let cleanupInterval = null;
if (process.env.NODE_ENV !== 'test') {
  cleanupInterval = setInterval(cleanupExpired, 5 * 60 * 1000);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Método de reinicio para suites de pruebas.
 */
function reset() {
  userQuotaStore.clear();
  globalInFlight = 0;
}

/**
 * Inspección de estado para pruebas.
 */
function getStatus(req) {
  const key = typeof req === 'string' ? req : getClientKey(req);
  const record = userQuotaStore.get(key);
  return {
    key,
    inFlight: record ? record.inFlight : 0,
    requestCount: record ? record.timestamps.length : 0,
    globalInFlight
  };
}

module.exports = {
  aiRateLimiter,
  reset,
  getStatus,
  cleanupExpired,
  WINDOW_MS,
  DEFAULT_MAX_REQUESTS
};
