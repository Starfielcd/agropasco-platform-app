/**
 * AgroPasco Digital — Servicio de Verificación de Estado de Usuario
 * FASE 9-L10: Verificación de cuentas activas, no bloqueadas y roles vigentes
 */

'use strict';

const { getDb } = require('../config/database');

/**
 * Verifica contra la base de datos PostgreSQL el estado fidedigno de un usuario.
 * No confía exclusivamente en los claims estáticos del token JWT.
 *
 * @param {number|string} userId Identificador numérico del usuario
 * @param {Object} [options={}]
 * @param {string} [options.expectedRole] Rol esperado (ej: 'admin', 'advisor')
 * @param {Object} [options.client] Cliente o ejecutor de transacción dedicado (opcional)
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   user?: { id: number, name: string, role: string, status: string, is_blocked: number }
 * }>}
 */
async function verifyActiveUserStatus(userId, { expectedRole = null, client = null, tokenRole = null } = {}) {
  const numericId = Number(userId);
  if (!numericId || isNaN(numericId) || numericId <= 0) {
    return { valid: false, reason: 'Identificador de usuario inválido o inexistente.' };
  }

  const executor = client || getDb();
  if (!executor || typeof executor.query !== 'function') {
    return { valid: false, reason: 'Conexión a base de datos no disponible para verificar estado de usuario.' };
  }

  try {
    const res = await executor.query(
      'SELECT id, name, email, role, status, is_blocked FROM users WHERE id = $1 LIMIT 1',
      [numericId]
    );

    if (!res.rows || res.rows.length === 0) {
      return { valid: false, reason: `Usuario con ID ${numericId} no encontrado en la base de datos.` };
    }

    const user = res.rows[0];

    // 1. Verificación de bloqueo administrativo
    if (user.is_blocked === 1 || user.is_blocked === true) {
      return { valid: false, reason: `La cuenta de usuario (ID ${numericId}) se encuentra administrativamente bloqueada.` };
    }

    // 2. Verificación de estado activo
    if (user.status && user.status !== 'active') {
      return { valid: false, reason: `La cuenta de usuario (ID ${numericId}) no está activa (estado actual: "${user.status}").` };
    }

    // 3. Verificación de rol vigente frente a tokens con rol desactualizado
    if (tokenRole && user.role !== tokenRole) {
      return {
        valid: false,
        reason: `Discrepancia de rol: el rol actual en base de datos es "${user.role}", pero el token indica "${tokenRole}".`
      };
    }

    if (expectedRole) {
      const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
      if (!allowedRoles.includes(user.role)) {
        return {
          valid: false,
          reason: `Discrepancia de rol: el rol actual en base de datos es "${user.role}", pero la operación exige "${Array.isArray(expectedRole) ? allowedRoles.join(' o ') : expectedRole}".`
        };
      }
    }

    return {
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        is_blocked: user.is_blocked
      }
    };
  } catch (err) {
    return {
      valid: false,
      reason: `Error al consultar estado de usuario: ${err.message}`
    };
  }
}

module.exports = {
  verifyActiveUserStatus
};
