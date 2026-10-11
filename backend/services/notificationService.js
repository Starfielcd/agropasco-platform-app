/**
 * AgroPasco — Servicio de Notificaciones
 * Gestión de alertas para agricultores
 */

const db = require('../config/database');
const { dbRun, dbGet, dbAll } = db;

/**
 * Crear una notificación para un usuario
 */
async function createNotification(userId, type, title, message, severity = 'info') {
  return await dbRun(
    'INSERT INTO notifications (user_id, type, title, message, severity) VALUES (?, ?, ?, ?, ?)',
    [userId, type, title, message, severity]
  );
}

/**
 * Escapa caracteres comodín de SQL LIKE/ILIKE (%, _, \) para evitar coincidencias accidentales.
 * @param {string} str
 * @returns {string}
 */
function escapeLikePattern(str) {
  return String(str).replace(/([%_\\])/g, '\\$1');
}

/**
 * Crea una notificación de alerta meteorológica de forma atómica y segura ante concurrencia.
 * Utiliza una transacción PostgreSQL dedicada con pg_advisory_xact_lock para evitar
 * condiciones de carrera (TOCTOU) tanto en la misma instancia como entre múltiples instancias.
 *
 * @param {object} params
 * @param {number} params.userId ID del agricultor
 * @param {string} params.type Tipo de notificación (ej. 'alerta_helada')
 * @param {string} params.title Título de la alerta (incluye nombre de parcela)
 * @param {string} params.message Cuerpo del mensaje
 * @param {string} params.severity Severidad ('info', 'warning', 'critical')
 * @param {number} [params.parcelId] ID de la parcela
 * @param {string} [params.parcelName] Nombre de la parcela
 * @param {string} [params.phenomenon] Fenómeno evaluado ('frost', 'heavy_rain', etc.)
 * @param {string} [params.modelType] Tipo de modelo ('ml_trained' o 'rule_based')
 * @param {number} [params.windowHours=6] Ventana de deduplicación en horas (por defecto 6)
 * @returns {Promise<{ created: boolean, id?: number, skipped: boolean, reason?: string, error?: string, message?: string }>}
 */
async function createWeatherAlertAtomically(params) {
  const {
    userId,
    type,
    title,
    message,
    severity = 'info',
    parcelId = null,
    parcelName = '',
    phenomenon = null,
    modelType = null,
    windowHours = 6
  } = params;

  // Validación y normalización de la ventana temporal
  const validWindowHours = Number.isFinite(Number(windowHours)) && Number(windowHours) > 0
    ? Number(windowHours)
    : 6;

  // Clave canónica de bloqueo asesor: identifica inequívocamente el evento en PostgreSQL
  const lockParcel = parcelId !== null && parcelId !== undefined
    ? String(parcelId)
    : (parcelName && parcelName.trim() ? parcelName.trim().toLowerCase() : 'all');
  const lockEvent = (phenomenon || type || 'alert').toLowerCase();
  const lockKey = `agropasco_alert:${userId}:${lockParcel}:${lockEvent}`;

  // Construcción de la consulta de deduplicación
  const conditions = [
    'user_id = ?',
    'type = ?'
  ];
  const queryParams = [userId, type];

  if (phenomenon) {
    conditions.push('(phenomenon = ? OR phenomenon IS NULL)');
    queryParams.push(phenomenon);
  }

  // Identidad de parcela:
  // - Para registros nuevos con parcel_id: filtra por parcel_id.
  // - Para registros históricos con parcel_id NULL: fallback seguro por título con escape estricto de comodines.
  if (parcelId !== null && parcelId !== undefined) {
    if (parcelName && parcelName.trim()) {
      const escaped = escapeLikePattern(parcelName.trim());
      conditions.push('(parcel_id = ? OR (parcel_id IS NULL AND (title ILIKE ? OR title ILIKE ?)))');
      queryParams.push(parcelId, `%— ${escaped}`, `%- ${escaped}`);
    } else {
      conditions.push('parcel_id = ?');
      queryParams.push(parcelId);
    }
  } else if (parcelName && parcelName.trim()) {
    const escaped = escapeLikePattern(parcelName.trim());
    conditions.push('(title ILIKE ? OR title ILIKE ?)');
    queryParams.push(`%— ${escaped}`, `%- ${escaped}`);
  }

  // Expresión parametrizada estándar para la ventana temporal (sin mezcla de ? y $N)
  conditions.push("created_at > NOW() - (? * INTERVAL '1 hour')");
  queryParams.push(validWindowHours);

  const selectSql = `SELECT id FROM notifications WHERE ${conditions.join(' AND ')}`;

  try {
    return await db.withTransaction(async (tx) => {
      // 1. Configurar lock_timeout local a la transacción (5 segundos)
      await tx.client.query("SET LOCAL lock_timeout = '5000ms'");

      // 2. Adquirir bloqueo asesor transaccional a nivel de PostgreSQL
      // El lock se retiene durante toda la transacción y se libera automáticamente en COMMIT o ROLLBACK
      await tx.client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);

      // 3. Verificar existencia dentro de la sección crítica en la misma conexión
      const existing = await tx.dbGet(selectSql, queryParams);

      if (existing) {
        return {
          created: false,
          skipped: true,
          reason: 'duplicate_within_window',
          existingId: existing.id
        };
      }

      // 4. Insertar la notificación dentro de la misma transacción
      const insertRes = await tx.dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity, parcel_id, phenomenon, model_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, title, message, severity, parcelId || null, phenomenon || null, modelType || null]
      );

      return {
        created: true,
        skipped: false,
        id: insertRes.lastID
      };
    });
  } catch (err) {
    if (err.code === '55P03' || /lock\s*timeout/i.test(err.message)) {
      console.warn(`[WEATHER_ALERT] Timeout de adquisición de lock agotado (5s) para clave: ${lockKey}`);
      return {
        created: false,
        skipped: false,
        error: 'lock_timeout',
        reason: 'lock_timeout_exceeded',
        message: 'Tiempo de espera para adquisición de bloqueo asesor agotado (5s).'
      };
    }
    throw err;
  }
}

/**
 * Crear alerta masiva para todos los agricultores de una ubicación
 */
async function createBulkAlert(type, title, message, severity, location = 'Cerro de Pasco') {
  const farmers = await dbAll(
    "SELECT id FROM users WHERE role = 'farmer' AND (location ILIKE ? OR location IS NULL)",
    [`%${location}%`]
  );

  const results = [];
  for (const farmer of farmers) {
    const result = await createNotification(farmer.id, type, title, message, severity);
    results.push(result);
  }

  return { notified_users: farmers.length, type, severity };
}

/**
 * Obtener notificaciones de un usuario
 */
async function getUserNotifications(userId, limit = 20, unreadOnly = false) {
  const whereClause = unreadOnly ? 'AND read = 0' : '';
  return await dbAll(
    `SELECT * FROM notifications WHERE user_id = ? ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

/**
 * Marcar notificación como leída
 */
async function markAsRead(notificationId, userId) {
  return await dbRun(
    'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
}

/**
 * Marcar todas las notificaciones como leídas
 */
async function markAllAsRead(userId) {
  return await dbRun(
    'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0',
    [userId]
  );
}

/**
 * Contar notificaciones no leídas
 */
async function getUnreadCount(userId) {
  const result = await dbGet(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0',
    [userId]
  );
  return result?.count || 0;
}

module.exports = {
  createNotification,
  createWeatherAlertAtomically,
  escapeLikePattern,
  createBulkAlert,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount
};
