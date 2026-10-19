/**
 * AgroPasco Digital — Servicio de Persistencia y Evaluación de Predicciones (Fase 7)
 * =================================================================================
 * Responsabilidad:
 *  - Registrar de manera persistente cada inferencia emitida por parcela, horizonte y fenómeno.
 *  - Mantener trazabilidad estricta: fecha de emisión, fecha objetivo, modelo, versión y fuente.
 *  - Comparar predicciones vencidas contra observaciones de campo (ground_truth_observations).
 *  - Clasificar resultados en matriz de confusión: Aciertos (Hits), Fallos (Misses),
 *    Falsas Alarmas (False Alarms) y Negativos Correctos (Correct Negatives).
 *  - Distinguir estrictamente entre observación física, reporte de campo y estimación meteorológica.
 */

const db = require('../config/database');

class PredictionPersistenceService {
  /**
   * Registra las predicciones estructuradas generadas por el Agente Predictivo ML
   * @param {string} taskId ID de la tarea multiagente
   * @param {number} parcelId ID de la parcela
   * @param {object} predictiveOutput Salida del Agente Predictivo ML
   * @param {string} weatherSource Fuente de datos meteorológicos
   */
  async persistWorkflowPredictions(taskId, parcelId, predictiveOutput, weatherSource = 'Open-Meteo ERA5 / Forecast API') {
    if (!parcelId || !predictiveOutput || !predictiveOutput.predictions_by_horizon) {
      return { inserted_count: 0, predictions: [] };
    }

    const horizonsData = predictiveOutput.predictions_by_horizon;
    const insertedRecords = [];
    const modelsRegistry = predictiveOutput.models_registry_audit || {};

    const phenomena = ['frost', 'heavy_rain', 'snow', 'hail'];
    const horizons = ['24h', '48h', '72h'];

    for (const hKey of horizons) {
      const hData = horizonsData[hKey];
      if (!hData || !hData.target_date) continue;

      const targetDate = hData.target_date;

      for (const phen of phenomena) {
        const pred = hData[phen];
        if (!pred) continue;

        const probability = Number(pred.probability ?? 0.0);
        const riskScore = Number(pred.risk_score ?? (probability * 100));
        const riskLevel = pred.risk_level || 'none';

        // Determinar modelo y versión según registro
        const regModel = modelsRegistry[phen] || {};
        const modelName = regModel.algorithm || pred.algorithm || (phen === 'hail' ? 'DeterministicPhysicalRule' : 'MachineLearningModel');
        const modelVersion = regModel.version || pred.version || (phen === 'hail' ? '1.0.0_provisional_rule' : '2.0.0_audited_no_leak');

        const sql = `
          INSERT INTO ml_predictions_log (
            task_id, parcel_id, emitted_at, target_date, horizon,
            phenomenon, probability, risk_score, risk_level,
            model_name, model_version, weather_source, validity_status, created_at
          )
          VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
          RETURNING *
        `;

        try {
          const row = await db.dbGet(sql, [
            taskId,
            parcelId,
            targetDate,
            hKey,
            phen,
            probability,
            riskScore,
            riskLevel,
            modelName,
            modelVersion,
            weatherSource,
          ]);
          if (row) insertedRecords.push(row);
        } catch (err) {
          console.warn(`[PredictionPersistence] Error al persistir predicción ${phen} ${hKey}:`, err.message);
        }
      }
    }

    return {
      inserted_count: insertedRecords.length,
      predictions: insertedRecords,
    };
  }

  /**
   * Obtiene el historial persistente de predicciones de una parcela
   * @param {number} parcelId
   * @param {number} limit
   */
  async getPredictionsByParcel(parcelId, limit = 20) {
    const sql = `
      SELECT p.*, o.source as observation_source, o.severity as observation_severity
      FROM ml_predictions_log p
      LEFT JOIN ground_truth_observations o ON p.observation_id = o.id
      WHERE p.parcel_id = ?
      ORDER BY p.emitted_at DESC, p.target_date DESC
      LIMIT ?
    `;
    return await db.dbAll(sql, [parcelId, limit]);
  }

  /**
   * Proceso de contraste y evaluación: Predicción vs. Realidad
   * Compara predicciones activas cuya fecha objetivo ya transcurrió con observaciones disponibles.
   * @param {number} [parcelId=null] Opcional para filtrar por parcela
   */
  async evaluatePredictionsAgainstObservations(parcelId = null) {
    let sql = `
      SELECT * FROM ml_predictions_log
      WHERE validity_status = 'active'
        AND target_date <= CURRENT_DATE
    `;
    const params = [];

    if (parcelId) {
      sql += ' AND parcel_id = ?';
      params.push(parcelId);
    }

    sql += ' ORDER BY target_date ASC LIMIT 50';

    const pendingPredictions = await db.dbAll(sql, params);
    let evaluatedCount = 0;
    let expiredCount = 0;

    for (const pred of pendingPredictions) {
      // Buscar observación de campo coincidente para esa parcela, fecha y fenómeno
      const obsSql = `
        SELECT id, phenomenon, severity, source, verification_method, observed_at
        FROM ground_truth_observations
        WHERE parcel_id = ?
          AND phenomenon = ?
          AND observed_at::date = ?::date
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const obs = await db.dbGet(obsSql, [pred.parcel_id, pred.phenomenon, pred.target_date]);

      if (obs) {
        // Evaluar correspondencia
        const observedPositive = (obs.severity === 'moderado' || obs.severity === 'severo' || obs.severity === 'extremo');
        const predictedPositive = (pred.risk_level === 'high' || pred.risk_level === 'moderate' || pred.risk_score >= 40);

        let evalResult = 'unverified';
        if (predictedPositive && observedPositive) {
          evalResult = 'hit'; // Acierto (Verdadero Positivo)
        } else if (!predictedPositive && observedPositive) {
          evalResult = 'miss'; // Fallo (Falso Negativo)
        } else if (predictedPositive && !observedPositive) {
          evalResult = 'false_alarm'; // Falsa Alarma (Falso Positivo)
        } else if (!predictedPositive && !observedPositive) {
          evalResult = 'correct_negative'; // Negativo Correcto (Verdadero Negativo)
        }

        await db.dbRun(`
          UPDATE ml_predictions_log
          SET validity_status = 'evaluated',
              evaluation_result = ?,
              observation_id = ?,
              evaluated_at = NOW()
          WHERE id = ?
        `, [evalResult, obs.id, pred.id]);

        evaluatedCount++;
      } else {
        // Si han transcurrido más de 48 horas tras la fecha objetivo sin reporte de observación, marcar como expirada
        const targetDateObj = new Date(pred.target_date);
        const hoursPassed = (Date.now() - targetDateObj.getTime()) / (1000 * 60 * 60);

        if (hoursPassed > 48) {
          await db.dbRun(`
            UPDATE ml_predictions_log
            SET validity_status = 'expired',
                evaluation_result = 'unverified',
                evaluated_at = NOW()
            WHERE id = ?
          `, [pred.id]);

          expiredCount++;
        }
      }
    }

    return {
      success: true,
      evaluated_count: evaluatedCount,
      expired_count: expiredCount,
      total_processed: pendingPredictions.length,
    };
  }

  /**
   * Computa métricas consolidadas de exactitud empírica (Predicción vs Realidad)
   * @param {number} [parcelId=null]
   */
  async getAccuracyMetrics(parcelId = null) {
    let sql = `
      SELECT
        COUNT(*) as total_predictions,
        COUNT(CASE WHEN validity_status = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN validity_status = 'evaluated' THEN 1 END) as evaluated_count,
        COUNT(CASE WHEN validity_status = 'expired' THEN 1 END) as expired_count,
        COUNT(CASE WHEN evaluation_result = 'hit' THEN 1 END) as hits,
        COUNT(CASE WHEN evaluation_result = 'miss' THEN 1 END) as misses,
        COUNT(CASE WHEN evaluation_result = 'false_alarm' THEN 1 END) as false_alarms,
        COUNT(CASE WHEN evaluation_result = 'correct_negative' THEN 1 END) as correct_negatives
      FROM ml_predictions_log
    `;
    const params = [];

    if (parcelId) {
      sql += ' WHERE parcel_id = ?';
      params.push(parcelId);
    }

    const row = await db.dbGet(sql, params) || {};

    const hits = Number(row.hits || 0);
    const misses = Number(row.misses || 0);
    const falseAlarms = Number(row.false_alarms || 0);
    const correctNegatives = Number(row.correct_negatives || 0);
    const totalVerified = hits + misses + falseAlarms + correctNegatives;

    const precision = (hits + falseAlarms) > 0 ? Number(((hits / (hits + falseAlarms)) * 100).toFixed(1)) : null;
    const recall = (hits + misses) > 0 ? Number(((hits / (hits + misses)) * 100).toFixed(1)) : null;
    const accuracy = totalVerified > 0 ? Number((((hits + correctNegatives) / totalVerified) * 100).toFixed(1)) : null;

    return {
      success: true,
      parcel_id: parcelId,
      total_predictions: Number(row.total_predictions || 0),
      active_predictions: Number(row.active_count || 0),
      evaluated_predictions: Number(row.evaluated_count || 0),
      expired_predictions: Number(row.expired_count || 0),
      confusion_matrix: {
        hits,
        misses,
        false_alarms: falseAlarms,
        correct_negatives: correctNegatives,
        total_verified: totalVerified,
      },
      metrics: {
        accuracy_pct: accuracy,
        precision_pct: precision,
        recall_pct: recall,
      },
    };
  }
}

module.exports = new PredictionPersistenceService();
