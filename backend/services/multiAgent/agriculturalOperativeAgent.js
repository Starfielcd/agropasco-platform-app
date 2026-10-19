/**
 * AgroPasco Digital — Agente 4: Agrícola y Operativo (Fase 6)
 * ==========================================================
 * Responsabilidad:
 *  - Recibir riesgos calculados y características meteorológicas.
 *  - Evaluar cultivo, etapa fenológica y susceptibilidad agroclimática.
 *  - Ejecutar el motor experto de mitigación (mitigationService.js).
 *  - Priorizar estrategias agronómicas preventivas por ventana temporal y severidad.
 *  - Generar alertas y notificaciones internas deduplicadas.
 *  - Registrar acciones de seguimiento preventivo.
 *  - Control de Seguridad: REQUERIR CONFIRMACIÓN HUMANA para cualquier acción física
 *    o comercial (PROHIBIDO modificar pedidos B2B, stocks, precios o activar válvulas).
 */

const db = require('../../config/database');
const { defaultMitigationService } = require('../mitigationService');

class AgriculturalOperativeAgent {
  constructor() {
    this.id = 'agent_agricultural_operative';
    this.name = 'agricultural_operative';
    this.displayName = 'Agente Agrícola y Operativo';
    this.version = '1.0.0';
    this.responsibility = 'Transformación de riesgos predictivos en recomendaciones agronómicas de mitigación, prevención fitosanitaria, manejo hídrico y preparación de alertas controladas.';
  }

  /**
   * Ejecuta el análisis agronómico y genera recomendaciones preventivas
   * @param {object} params
   * @param {number} params.parcel_id
   * @param {object} params.predictive_output Salida del Agente Predictivo ML
   * @param {object} [params.parcel_context] Contexto de la parcela
   * @param {number} [params.user_id] ID del usuario solicitante
   * @returns {Promise<object>}
   */
  async execute(params) {
    const {
      parcel_id,
      predictive_output,
      parcel_context = {},
      user_id = null,
    } = params;

    const tStart = Date.now();

    if (!parcel_id) {
      throw new Error('[AgriculturalOperativeAgent] Se requiere el parámetro parcel_id.');
    }

    if (!predictive_output || !predictive_output.predictions_by_horizon) {
      throw new Error('[AgriculturalOperativeAgent] Se requieren predicciones estructuradas por horizonte.');
    }

    // 1. Obtener contexto agronómico de la parcela
    let parcel = parcel_context;
    if (!parcel.crop_type) {
      const dbParcel = await db.dbGet(
        'SELECT id, user_id, name, crop_type, area_hectares, altitude_masl, location FROM parcels WHERE id = ?',
        [parcel_id]
      );
      if (dbParcel) {
        parcel = { ...dbParcel, ...parcel };
      }
    }

    const cropType = (parcel.crop_type || 'papa').toLowerCase();
    const altitude = Number(parcel.altitude_masl || 4337.0);

    // Determinación de etapa fenológica estándar según cultivo andino
    let phenologicalStage = 'tuberizacion';
    let vulnerabilityLevel = 'alta';
    if (cropType === 'maca') {
      phenologicalStage = 'engrosamiento_hipocotilo';
      vulnerabilityLevel = 'media';
    } else if (cropType === 'quinua') {
      phenologicalStage = 'grano_lechoso';
      vulnerabilityLevel = 'alta';
    } else if (cropType === 'maiz') {
      phenologicalStage = 'llenado_grano';
      vulnerabilityLevel = 'critica';
    } else if (cropType === 'habas') {
      phenologicalStage = 'floracion_fructificacion';
      vulnerabilityLevel = 'media';
    }

    // 2. Evaluar horizontes y recopilar recomendaciones expertas
    const horizons = ['24h', '48h', '72h'];
    const generatedStrategies = [];
    const internalAlerts = [];
    const sensitiveActionsGate = [];

    for (const hKey of horizons) {
      const horizonData = predictive_output.predictions_by_horizon[hKey];
      if (!horizonData) continue;

      const phenomenaList = ['frost', 'heavy_rain', 'snow', 'hail'];
      for (const phen of phenomenaList) {
        const pred = horizonData[phen];
        if (!pred) continue;

        // Si el riesgo supera ninguno/bajo, o si es helada/lluvia con score >= 25, generar mitigación
        const isActionable = (pred.risk_level === 'high' || pred.risk_level === 'moderate' || (pred.risk_score && pred.risk_score >= 25));
        if (isActionable) {
          const recommendations = defaultMitigationService.generateRecommendations({
            parcel_id,
            crop: cropType,
            phenological_stage: phenologicalStage,
            phenomenon: phen,
            horizon: hKey,
            operational_forecast: { altitude_masl: altitude },
            ml_prediction: pred,
            monte_carlo_results: predictive_output.monte_carlo_sensitivity,
          });

          if (recommendations && recommendations.length > 0) {
            generatedStrategies.push(...recommendations);

            // Generar alerta estructurada
            internalAlerts.push({
              id: `alert_${parcel_id}_${phen}_${hKey}_${Date.now()}`,
              horizon: hKey,
              phenomenon: phen,
              risk_level: pred.risk_level,
              risk_score: pred.risk_score,
              crop: cropType,
              message: `Alerta agroclimática para ${parcel.name || 'Parcela ' + parcel_id}: ${phen.toUpperCase()} en horizonte ${hKey} con nivel ${pred.risk_level.toUpperCase()} (${pred.risk_score}%).`,
              urgency: pred.risk_level === 'high' ? 'alta' : 'media',
              created_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    // 3. Deduplicación de estrategias y alertas
    const uniqueStrategiesMap = new Map();
    for (const strat of generatedStrategies) {
      if (!uniqueStrategiesMap.has(strat.strategy_id)) {
        uniqueStrategiesMap.set(strat.strategy_id, strat);
      }
    }
    const deduplicatedStrategies = Array.from(uniqueStrategiesMap.values());

    // 4. Aplicar Gobernanza Estricta y Barreras de Seguridad (Guardrails)
    // PROHIBICIÓN EXPRESA: No modificar compras B2B, inventarios, precios ni válvulas físicas.
    // Todas las acciones operativas sensibles quedan sujetas a confirmación humana.
    for (const strat of deduplicatedStrategies) {
      const isIrrigationAction = strat.category === 'manejo_hidrico' || (strat.title || '').toLowerCase().includes('riego');
      const isChemicalPurchase = strat.resources_needed && (strat.resources_needed.toLowerCase().includes('fungicida') || strat.resources_needed.toLowerCase().includes('compra'));

      if (isIrrigationAction || isChemicalPurchase) {
        sensitiveActionsGate.push({
          action_type: isIrrigationAction ? 'physical_irrigation_actuation' : 'commercial_supplies_requisition',
          strategy_id: strat.strategy_id,
          title: strat.title,
          status: 'PENDING_HUMAN_AUTHORIZATION',
          auto_executed: false,
          requires_human_confirmation: true,
          safety_restriction: 'PROHIBIDO modificar pedidos B2B, inventario o válvulas de riego físicas automáticamente sin aprobación explícita del agricultor o asesor agronómico.',
        });
      }
    }

    // 5. Preparar plan de seguimiento operativo
    const followupActions = deduplicatedStrategies.map((strat, idx) => ({
      step_order: idx + 1,
      strategy_id: strat.strategy_id,
      action_name: strat.title,
      category: strat.category,
      priority: strat.priority,
      time_window: strat.time_window,
      status: 'recomendada',
      requires_confirmation: sensitiveActionsGate.some(s => s.strategy_id === strat.strategy_id),
    }));

    const durationMs = Date.now() - tStart;

    return {
      agent: this.name,
      agent_id: this.id,
      status: 'success',
      execution_time_ms: durationMs,
      timestamp: new Date().toISOString(),
      crop_context: {
        parcel_id,
        parcel_name: parcel.name,
        crop_type: cropType,
        phenological_stage: phenologicalStage,
        vulnerability_level: vulnerabilityLevel,
        altitude_masl: altitude,
      },
      mitigation_strategies: deduplicatedStrategies,
      total_strategies_count: deduplicatedStrategies.length,
      internal_alerts: internalAlerts,
      followup_actions_plan: followupActions,
      safety_guardrails: {
        b2b_orders_auto_modified: false,
        inventory_auto_modified: false,
        prices_auto_modified: false,
        physical_valves_actuated: false,
        all_sensitive_actions_gated: true,
        sensitive_actions_pending_approval: sensitiveActionsGate,
      },
      agronomic_references: [
        'INIA — Manual Técnico de Manejo Integrado de Heladas en Papa y Tubérculos Altoandinos.',
        'SENAMHI — Umbrales Bioclimáticos y Zonas de Riesgo Agroclimático en Pasco.',
        'FAO — Gestión del Riesgo Agroclimático en Ecosistemas de Puna y Sierra Central.',
      ],
    };
  }
}

module.exports = new AgriculturalOperativeAgent();
