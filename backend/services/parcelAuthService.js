/**
 * AgroPasco Digital — Servicio de Autorización y Aislamiento por Parcela (Fase 7)
 * ==============================================================================
 * Regla de Gobernanza RBAC (Sección 10):
 *  - Agricultores acceden única y exclusivamente a sus parcelas propias.
 *  - Asesores acceden ÚNICAMENTE a parcelas autorizadas según relaciones reales del sistema
 *    (asignación explícita, recomendaciones agronómicas emitidas, marcadores de plaga o notas de mitigación).
 *    PROHIBIDO otorgar acceso global a asesores por el simple hecho de tener el rol.
 *  - Administradores disponen de permisos de supervisión acordes a su función.
 *  - Supermercados tienen PROHIBIDO el acceso a información privada agronómica/climática de parcelas.
 */

const db = require('../config/database');

class ParcelAuthService {
  /**
   * Verifica si un usuario está autorizado para operar o consultar una parcela
   * @param {number|object} userIdOrUser ID del usuario o el objeto usuario ({ id, role })
   * @param {string|number} userRoleOrParcelId Rol del usuario o ID de parcela si se pasó objeto
   * @param {number} [parcelIdParam] ID de la parcela
   * @returns {Promise<{ authorized: boolean, reason?: string, parcel?: object, role?: string }>}
   */
  async checkParcelAccess(userIdOrUser, userRoleOrParcelId, parcelIdParam) {
    let userId;
    let userRole;
    let parcelId;

    if (userIdOrUser && typeof userIdOrUser === 'object') {
      userId = userIdOrUser.id;
      userRole = userIdOrUser.role;
      parcelId = userRoleOrParcelId;
    } else {
      userId = userIdOrUser;
      userRole = userRoleOrParcelId;
      parcelId = parcelIdParam;
    }

    if (!userId || !parcelId) {
      return { authorized: false, reason: 'Parámetros de usuario o parcela faltantes.' };
    }

    const parcel = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!parcel) {
      return { authorized: false, reason: `Parcela #${parcelId} no encontrada.` };
    }

    // 1. Administrador: acceso de auditoría y supervisión global
    if (userRole === 'admin') {
      return { authorized: true, parcel, role: 'admin' };
    }

    // 2. Supermercado: acceso estrictamente denegado
    if (userRole === 'supermarket') {
      return { authorized: false, reason: 'Usuarios con rol supermercado no tienen acceso a parcelas agrícolas privadas.' };
    }

    // 3. Agricultor: únicamente sus parcelas registradas
    if (userRole === 'farmer') {
      if (parcel.user_id === userId) {
        return { authorized: true, parcel, role: 'owner' };
      }
      return { authorized: false, reason: `Aislamiento RBAC: El agricultor #${userId} no es propietario de la parcela #${parcelId}.` };
    }

    // 4. Asesor Agronómico: ÚNICAMENTE si existe relación real y verificable en el sistema
    if (userRole === 'asesor' || userRole === 'advisor') {
      // A. Asignación explícita activa en advisor_parcel_assignments
      const assignment = await db.dbGet(
        'SELECT id FROM advisor_parcel_assignments WHERE advisor_id = ? AND parcel_id = ? AND (active = 1 OR status = \'active\')',
        [userId, parcelId]
      );
      if (assignment) {
        return { authorized: true, parcel, role: 'assigned_advisor' };
      }

      // B. Recomendaciones agronómicas previas emitidas para esta parcela
      const recommendation = await db.dbGet(
        'SELECT id FROM advisor_recommendations WHERE advisor_id = ? AND parcel_id = ? LIMIT 1',
        [userId, parcelId]
      );
      if (recommendation) {
        return { authorized: true, parcel, role: 'active_recommender' };
      }

      // C. Acciones de mitigación asesoradas (Fase 5)
      const mitigation = await db.dbGet(
        'SELECT id FROM mitigation_actions WHERE advisor_id = ? AND parcel_id = ? LIMIT 1',
        [userId, parcelId]
      );
      if (mitigation) {
        return { authorized: true, parcel, role: 'mitigation_advisor' };
      }

      // D. Marcadores de plagas creados por este asesor en la parcela
      const marker = await db.dbGet(
        'SELECT id FROM pest_markers WHERE advisor_id = ? AND parcel_id = ? LIMIT 1',
        [userId, parcelId]
      );
      if (marker) {
        return { authorized: true, parcel, role: 'pest_monitor_advisor' };
      }

      // Asesor no autorizado para esta parcela específica
      return {
        authorized: false,
        reason: `Acceso no autorizado: El asesor #${userId} no tiene una relación agronómica asignada con la parcela #${parcelId}.`,
      };
    }

    return { authorized: false, reason: `Rol desconocido o no autorizado: '${userRole}'.` };
  }

  /**
   * Asigna explícitamente un asesor a una parcela
   * @param {number} advisorId
   * @param {number} parcelId
   * @param {number} assignedBy ID del administrador o agricultor
   */
  async assignAdvisorToParcel(advisorId, parcelId, assignedBy = null) {
    const sql = `
      INSERT INTO advisor_parcel_assignments (advisor_id, parcel_id, assigned_by, assigned_at, active)
      VALUES (?, ?, ?, NOW(), 1)
      ON CONFLICT (advisor_id, parcel_id)
      DO UPDATE SET active = 1, assigned_at = NOW()
      RETURNING *
    `;
    return await db.dbGet(sql, [advisorId, parcelId, assignedBy]);
  }
}

module.exports = new ParcelAuthService();
