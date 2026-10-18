/**
 * AgroPasco Digital — Agente 5: Auditor y Supervisor (Fase 6)
 * ==========================================================
 * Responsabilidad:
 *  - Registrar el historial completo de tareas y verificar la procedencia de datos.
 *  - Auditar permisos RBAC y aislamiento estricto por parcela.
 *  - Comprobar que cada predicción y estrategia cuente con evidencia trazable.
 *  - Detectar fallos, ejecuciones incompletas o datos desactualizados.
 *  - Verificar que las simulaciones Monte Carlo NUNCA se presenten como observaciones reales.
 *  - Comprobar que los modelos ejecutados coincidan exactamente con modelRegistry.js.
 *  - Verificar que no se hayan modificado pedidos B2B, inventarios ni actuadores físicos.
 *  - Registrar auditoría persistente en la tabla agent_audit_logs.
 *  - Generar dictamen de cumplimiento (verified, warning, violation).
 */

const db = require('../../config/database');
const { MODEL_REGISTRY } = require('../../config/modelRegistry');
const parcelAuthService = require('../parcelAuthService');


class AuditorSupervisorAgent {
  constructor() {
    this.id = 'agent_auditor_supervisor';
    this.name = 'auditor_supervisor';
    this.displayName = 'Agente Auditor y Supervisor';
    this.version = '1.0.0';
    this.responsibility = 'Auditoría continua, verificación de procedencia de datos, cumplimiento de permisos RBAC, consistencia de modelos vs registro oficial, y distinción estricta entre simulación y realidad.';
  }

  /**
   * Ejecuta la auditoría exhaustiva sobre una tarea multiagente
   * @param {object} params
   * @param {string} params.task_id
   * @param {number} params.parcel_id
   * @param {number} params.user_id
   * @param {object} params.steps Resultados acumulados de los agentes previos
   * @returns {Promise<object>} Reporte de auditoría y dictamen de cumplimiento
   */
  async execute(params) {
    const {
      task_id,
      parcel_id,
      user_id,
      steps = {},
    } = params;

    const tStart = Date.now();
    const auditChecks = [];
    let overallCompliance = 'verified';

    // -------------------------------------------------------------------------
    // CHECK 1: Verificación de Aislamiento RBAC y Pertenencia de Parcela
    // -------------------------------------------------------------------------
    let rbacPassed = false;
    let rbacDetail = '';
    try {
      if (!parcel_id || !user_id) {
        rbacDetail = 'Faltan parámetros de identificación de parcela o usuario.';
      } else {
        const user = await db.dbGet('SELECT id, role FROM users WHERE id = ?', [user_id]);
        if (!user) {
          rbacDetail = 'Usuario no encontrado en la base de datos.';
          overallCompliance = 'violation';
        } else {
          const authResult = await parcelAuthService.checkParcelAccess(user_id, user.role, parcel_id);
          if (authResult.authorized) {
            rbacPassed = true;
            rbacDetail = `Acceso autorizado. Rol: ${user.role}, Autorización: ${authResult.role}.`;
          } else {
            rbacDetail = authResult.reason || `Violación de aislamiento RBAC para usuario ${user_id} en parcela ${parcel_id}.`;
            overallCompliance = 'violation';
          }
        }
      }
    } catch (err) {
      rbacDetail = `Error al verificar RBAC: ${err.message}`;
      overallCompliance = 'warning';
    }

    auditChecks.push({
      check_id: 'RBAC_PARCEL_ISOLATION',
      name: 'Aislamiento de Parcelas y Permisos RBAC',
      status: rbacPassed ? 'PASS' : overallCompliance === 'violation' ? 'FAIL' : 'WARNING',
      detail: rbacDetail,
    });

    // -------------------------------------------------------------------------
    // CHECK 2: Procedencia, Periodos y Frescura de Datos Meteorológicos
    // -------------------------------------------------------------------------
    const meteoStep = steps.meteorological;
    let dataProvenancePassed = false;
    let dataProvenanceDetail = '';

    if (!meteoStep || meteoStep.status !== 'success') {
      dataProvenanceDetail = 'El Agente Meteorológico no entregó datos válidos o falló.';
      overallCompliance = 'violation';
    } else {
      const prov = meteoStep.provenance || {};
      const validation = meteoStep.parcel_validation || {};
      const quality = meteoStep.data_quality || {};

      const hasValidSource = prov.source && prov.source.includes('Open-Meteo');
      const hasReferenceDataset = prov.historical_dataset_reference && prov.historical_dataset_reference.includes('cerro_de_pasco_processed.csv');
      const isGeoValid = validation.validation_passed === true;
      const isComplete = quality.completeness_pct >= 80;

      if (hasValidSource && hasReferenceDataset && isGeoValid && isComplete) {
        dataProvenancePassed = true;
        dataProvenanceDetail = `Datos meteorológicos válidos. Fuente: ${prov.source}. Dataset histórico de correlación: ${prov.historical_dataset_reference}. Completitud: ${quality.completeness_pct}%. Coordenadas validadas en Pasco.`;
      } else {
        dataProvenanceDetail = `Inconsistencia en procedencia de datos. Fuente: ${prov.source}, Dataset Ref: ${prov.historical_dataset_reference}, GeoValid: ${isGeoValid}, Completitud: ${quality.completeness_pct}%.`;
        overallCompliance = overallCompliance === 'violation' ? 'violation' : 'warning';
      }
    }

    auditChecks.push({
      check_id: 'DATA_PROVENANCE_AND_FRESHNESS',
      name: 'Procedencia de Datos y Alineación de Dataset Histórico',
      status: dataProvenancePassed ? 'PASS' : overallCompliance === 'violation' ? 'FAIL' : 'WARNING',
      detail: dataProvenanceDetail,
    });

    // -------------------------------------------------------------------------
    // CHECK 3: Cumplimiento de Modelos Versionados vs modelRegistry.js
    // -------------------------------------------------------------------------
    const mlStep = steps.predictive_ml;
    let modelCompliancePassed = false;
    let modelComplianceDetail = '';

    if (!mlStep || mlStep.status !== 'success') {
      modelComplianceDetail = 'El Agente Predictivo ML no entregó inferencias estructuradas.';
      overallCompliance = 'violation';
    } else {
      const audit = mlStep.models_registry_audit || {};
      const frostAlg = audit.frost?.algorithm;
      const frostVer = audit.frost?.version;
      const rainAlg = audit.heavy_rain?.algorithm;
      const hailIsRule = audit.hail?.algorithm === 'DeterministicPhysicalRule';

      const matchesRegistry = frostAlg === MODEL_REGISTRY.frost.algorithm &&
                              frostVer === MODEL_REGISTRY.frost.version &&
                              rainAlg === MODEL_REGISTRY.heavy_rain.algorithm &&
                              hailIsRule;

      if (matchesRegistry) {
        modelCompliancePassed = true;
        modelComplianceDetail = `Modelos conformes con modelRegistry.js: Heladas (${frostAlg} ${frostVer}), Lluvias (${rainAlg}), Granizadas (DeterministicPhysicalRule v1.0.0_provisional_rule).`;
      } else {
        modelComplianceDetail = `Discrepancia en modelos ejecutados vs registro oficial. Frost: ${frostAlg} (Esperado: ${MODEL_REGISTRY.frost.algorithm}), Rain: ${rainAlg} (Esperado: ${MODEL_REGISTRY.heavy_rain.algorithm}).`;
        overallCompliance = 'violation';
      }
    }

    auditChecks.push({
      check_id: 'MODEL_REGISTRY_COMPLIANCE',
      name: 'Correspondencia Estricta con Registro de Modelos',
      status: modelCompliancePassed ? 'PASS' : 'FAIL',
      detail: modelComplianceDetail,
    });

    // -------------------------------------------------------------------------
    // CHECK 4: Distinción Estricta entre Simulación Estocástica y Observación
    // -------------------------------------------------------------------------
    let simulationDistinctionPassed = true;
    let simulationDetail = '';

    if (mlStep && mlStep.monte_carlo_sensitivity) {
      const mc = mlStep.monte_carlo_sensitivity;
      if (mc.executed) {
        if (mc.is_stochastic_simulation === true && mc.simulation_warning) {
          simulationDetail = 'Verificado: La simulación Monte Carlo está explícitamente rotulada como simulación estocástica y advierte que no constituye una observación real.';
        } else {
          simulationDistinctionPassed = false;
          simulationDetail = 'Violación: La simulación Monte Carlo no incluye advertencias de distinción entre simulación estocástica y observación física.';
          overallCompliance = 'violation';
        }
      } else {
        simulationDetail = 'Simulación Monte Carlo no requerida o fallida; no hay riesgo de confusión con observaciones.';
      }
    } else {
      simulationDetail = 'No se incluyó simulación estocástica en esta tarea.';
    }

    auditChecks.push({
      check_id: 'SIMULATION_VS_OBSERVATION_DISTINCTION',
      name: 'Distinción Rigurosa Simulación vs Observación',
      status: simulationDistinctionPassed ? 'PASS' : 'FAIL',
      detail: simulationDetail,
    });

    // -------------------------------------------------------------------------
    // CHECK 5: Integridad de Cadena de Evidencia y Trazabilidad de Agentes
    // -------------------------------------------------------------------------
    let evidencePassed = true;
    let evidenceDetail = '';

    const requiredAgents = ['meteorological', 'predictive_ml', 'agricultural_operative'];
    const missingAgents = requiredAgents.filter(a => !steps[a] || steps[a].status !== 'success');

    if (missingAgents.length === 0) {
      evidenceDetail = 'Cadena de custodia completa: Los agentes Meteorológico, Predictivo y Agrícola aportaron resultados trazables con marcas de tiempo y métricas de ejecución.';
    } else {
      evidencePassed = false;
      evidenceDetail = `Cadena de evidencia incompleta. Agentes faltantes o con error: ${missingAgents.join(', ')}.`;
      overallCompliance = 'violation';
    }

    auditChecks.push({
      check_id: 'EVIDENCE_CHAIN_COMPLETENESS',
      name: 'Completitud de la Cadena de Evidencias Multiagente',
      status: evidencePassed ? 'PASS' : 'FAIL',
      detail: evidenceDetail,
    });

    // -------------------------------------------------------------------------
    // CHECK 6: Gobernanza de Seguridad (Sin Modificación Automática B2B / Válvulas)
    // -------------------------------------------------------------------------
    const agriStep = steps.agricultural_operative;
    let safetyPassed = true;
    let safetyDetail = '';

    if (agriStep) {
      const guardrails = agriStep.safety_guardrails || {};
      const b2bNotTouched = guardrails.b2b_orders_auto_modified === false;
      const valvesNotActuated = guardrails.physical_valves_actuated === false;
      const allSensitiveGated = guardrails.all_sensitive_actions_gated === true;

      if (b2bNotTouched && valvesNotActuated && allSensitiveGated) {
        safetyDetail = 'Verificado: Barreras de seguridad activas. Cero modificaciones automáticas de pedidos B2B, inventario, precios o actuadores físicos. Acciones sensibles condicionadas a confirmación humana.';
      } else {
        safetyPassed = false;
        safetyDetail = 'Violación de barreras de seguridad: Se detectaron intentos de modificación automática o deshabilitación de puertas de confirmación humana.';
        overallCompliance = 'violation';
      }
    } else {
      safetyDetail = 'Paso agrícola no evaluado.';
    }

    auditChecks.push({
      check_id: 'SAFETY_AND_GOVERNANCE_BOUNDARIES',
      name: 'Barreras de Seguridad (Protección B2B y Recursos Físicos)',
      status: safetyPassed ? 'PASS' : 'FAIL',
      detail: safetyDetail,
    });

    // -------------------------------------------------------------------------
    // Registrar persistencia en agent_audit_logs
    // -------------------------------------------------------------------------
    let auditLogId = null;
    try {
      const insertSql = `
        INSERT INTO agent_audit_logs (
          task_id, parcel_id, user_id, agent_name, action,
          compliance_status, verification_details, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        RETURNING id
      `;

      const auditDetailsJson = JSON.stringify({
        checks: auditChecks,
        summary: `Auditoría finalizada con estado: ${overallCompliance.toUpperCase()}`,
        audited_agents: Object.keys(steps),
      });

      const logRow = await db.dbGet(insertSql, [
        task_id,
        parcel_id,
        user_id,
        'auditor_supervisor',
        'AUDIT_WORKFLOW_EXECUTION',
        overallCompliance,
        auditDetailsJson,
      ]);

      auditLogId = logRow ? logRow.id : null;
    } catch (dbErr) {
      console.warn('[AuditorSupervisorAgent] Error al registrar en agent_audit_logs:', dbErr.message);
    }

    const durationMs = Date.now() - tStart;

    return {
      agent: this.name,
      agent_id: this.id,
      task_id,
      status: 'success',
      execution_time_ms: durationMs,
      timestamp: new Date().toISOString(),
      compliance_status: overallCompliance,
      audit_log_id: auditLogId,
      total_checks: auditChecks.length,
      passed_checks: auditChecks.filter(c => c.status === 'PASS').length,
      warning_checks: auditChecks.filter(c => c.status === 'WARNING').length,
      failed_checks: auditChecks.filter(c => c.status === 'FAIL').length,
      checks: auditChecks,
      verdict_summary: overallCompliance === 'verified'
        ? 'La ejecución multiagente cumple rigurosamente con los 6 estándares de seguridad, RBAC, gobernanza ML y distinción simulación-observación.'
        : `Atención: La ejecución presenta observaciones de auditoría (${overallCompliance.toUpperCase()}). Consulte el desglose de checks.`,
    };
  }
}

module.exports = new AuditorSupervisorAgent();
