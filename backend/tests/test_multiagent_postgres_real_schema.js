/**
 * AgroPasco Digital — Suite de Integración E2E sobre PostgreSQL Real (Anti-Regresión)
 * ===================================================================================
 * Esta prueba levanta un clúster local efímero de PostgreSQL 18 con el esquema físico real
 * (16 tablas + B2B + ML + Sistema Multiagente) para validar que:
 *  1. La tabla 'parcels' utiliza 'center_lat' y 'center_lng' (NO 'latitude' ni 'longitude').
 *  2. El Agente Meteorológico extrae las coordenadas con los alias correctos sin error SQL.
 *  3. El flujo completo de los 5 agentes (Orquestador, Meteorológico, Predictivo ML,
 *     Agrícola Operativo, Auditor Supervisor) se ejecuta de extremo a extremo.
 *  4. Las tareas y los logs de auditoría se persisten en las tablas físicas PostgreSQL.
 *  5. Las predicciones se registran en 'ml_predictions_log'.
 *  6. El manejo de errores controlados (parcela inexistente / error geográfico) es trazable.
 */

'use strict';

process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { Pool } = require('pg');

const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DB_PORT = 55442;
const DB_NAME = 'agropasco_real_multiagent_db';

class EphemeralPostgresCluster {
  constructor(port = DB_PORT, dbName = DB_NAME) {
    this.port = port;
    this.dbName = dbName;
    this.tempDir = path.join(os.tmpdir(), `agropasco_multiagent_test_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'pg_server.log');
    this.started = false;
  }

  start() {
    fs.mkdirSync(this.tempDir, { recursive: true });

    // 1. Inicializar clúster PostgreSQL local
    execSync(`"${path.join(pgBin, 'initdb.exe')}" -D "${this.tempDir}" -U postgres -A trust --no-locale -E UTF8`, {
      stdio: 'ignore'
    });

    // 2. Arrancar servidor en puerto aislado
    execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -o "-p ${this.port} -h 127.0.0.1" -l "${this.logFile}" start`, {
      stdio: 'ignore'
    });
    this.started = true;

    // 3. Esperar a que el servidor acepte conexiones
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        execSync(`"${path.join(pgBin, 'pg_isready.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres`, { stdio: 'ignore' });
        ready = true;
        break;
      } catch (_) {
        execSync('ping 127.0.0.1 -n 1 > nul', { shell: true });
      }
    }
    if (!ready) {
      throw new Error(`Servidor PostgreSQL temporal en puerto ${this.port} no respondió.`);
    }

    // 4. Crear base de datos de prueba
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres ${this.dbName}`, {
      stdio: 'ignore'
    });

    return `postgresql://postgres@127.0.0.1:${this.port}/${this.dbName}`;
  }

  stop() {
    if (this.started) {
      try {
        execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -m fast stop`, { stdio: 'ignore' });
      } catch (_) {}
      this.started = false;
    }
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

// Generador de pronóstico sintético determinista para no depender de llamadas externas en tests
function generateMockForecast(lat, lng, elevation) {
  const dates = [];
  const now = new Date();
  
  // 10 días: 7 pasados (t-7 a t-1) + 3 futuros (t, t+1, t+2)
  for (let i = -7; i < 3; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }

  const hourlyTime = [];
  const temp2m = [];
  const rh2m = [];
  const precip = [];
  const wind10m = [];
  const dewPoint = [];
  const soilMoist = [];

  for (let d = 0; d < dates.length; d++) {
    const dateStr = dates[d];
    for (let h = 0; h < 24; h++) {
      const hStr = h < 10 ? `0${h}` : `${h}`;
      hourlyTime.push(`${dateStr}T${hStr}:00`);

      // Simular helada en madrugadas (2-6 AM)
      const isNight = h >= 2 && h <= 6;
      const tVal = isNight ? -3.5 + ((h - 2) * 0.2) : 8.5 + (Math.sin(h / 3) * 3.0);
      temp2m.push(Number(tVal.toFixed(2)));
      rh2m.push(isNight ? 92.0 : 55.0);
      precip.push(h === 14 ? 3.0 : 0.0);
      wind10m.push(8.0 + Math.cos(h));
      dewPoint.push(isNight ? -4.5 : 1.5);
      soilMoist.push(0.35);
    }
  }

  // Daily aggregates correspondientes a los 10 días
  const dailyTempMin = [];
  const dailyTempMax = [];
  const dailyTempMean = [];
  const dailyPrecipSum = [];
  const dailyRainSum = [];
  const dailyWindMax = [];
  const dailyEt0 = [];

  for (let d = 0; d < dates.length; d++) {
    dailyTempMin.push(-3.5);
    dailyTempMax.push(11.5);
    dailyTempMean.push(4.0);
    dailyPrecipSum.push(3.0);
    dailyRainSum.push(3.0);
    dailyWindMax.push(9.0);
    dailyEt0.push(2.5);
  }

  return {
    latitude: lat,
    longitude: lng,
    elevation: elevation,
    generationtime_ms: 0.85,
    utc_offset_seconds: -18000,
    daily: {
      time: dates,
      temperature_2m_max: dailyTempMax,
      temperature_2m_min: dailyTempMin,
      temperature_2m_mean: dailyTempMean,
      precipitation_sum: dailyPrecipSum,
      rain_sum: dailyRainSum,
      wind_speed_10m_max: dailyWindMax,
      et0_fao_evapotranspiration: dailyEt0,
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: temp2m,
      relative_humidity_2m: rh2m,
      precipitation: precip,
      wind_speed_10m: wind10m,
      dew_point_2m: dewPoint,
      soil_moisture_0_to_7cm: soilMoist,
    }
  };
}

async function runRealPostgresMultiagentSuite() {
  console.log('======================================================================');
  console.log('AGROPASCO DIGITAL — TEST SUITE E2E SOBRE POSTGRESQL 18 REAL (SCHEMA)');
  console.log('======================================================================\n');

  const cluster = new EphemeralPostgresCluster();
  let dbUrl = null;
  let testPool = null;

  try {
    console.log('[1/7] Levantando instancia efímera de PostgreSQL 18 local...');
    dbUrl = cluster.start();
    console.log(`  ✓ PostgreSQL 18 activo en 127.0.0.1:${DB_PORT} [DB: ${DB_NAME}]`);

    // Inyectar DATABASE_URL en process.env ANTES de cargar database.js
    process.env.DATABASE_URL = dbUrl;
    const db = require('../config/database');

    // Inicializar pool real conectado al clúster efímero
    testPool = new Pool({
      connectionString: dbUrl,
      max: 10,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000
    });
    testPool.on('error', () => {}); // Prevenir unhandled error al detener cluster
    db.pool = testPool;

    console.log('[2/7] Inicializando esquema físico completo en PostgreSQL...');
    await db.initializeDatabase();
    console.log('  ✓ Esquema de 16 tablas + B2B + ML + Multiagente creado exitosamente.');

    // -----------------------------------------------------------------------
    // VERIFICACIÓN DE ESQUEMA REAL EN POSTGRESQL (PREVENCIÓN DE REGRESIONES)
    // -----------------------------------------------------------------------
    console.log('[3/7] Verificando columnas físicas en tabla parcels...');
    const columnsRes = await testPool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'parcels'
      ORDER BY ordinal_position
    `);
    const columnNames = columnsRes.rows.map(r => r.column_name);

    assert(columnNames.includes('center_lat'), 'La tabla parcels DEBE contener la columna center_lat');
    assert(columnNames.includes('center_lng'), 'La tabla parcels DEBE contener la columna center_lng');
    assert(columnNames.includes('altitude_masl'), 'La tabla parcels DEBE contener altitude_masl');
    assert(columnNames.includes('crop_type'), 'La tabla parcels DEBE contener crop_type');
    
    // Validar explícitamente que NO existen 'latitude' ni 'longitude' para no regresar al bug
    assert(!columnNames.includes('latitude'), 'La tabla parcels NO debe tener columna latitude (usa center_lat)');
    assert(!columnNames.includes('longitude'), 'La tabla parcels NO debe tener columna longitude (usa center_lng)');
    console.log('  ✅ [PASS] Esquema físico de parcels validado: center_lat y center_lng existen, sin columnas redundantes.');

    // -----------------------------------------------------------------------
    // SIEMBRA DE DATOS REALES EN POSTGRESQL
    // -----------------------------------------------------------------------
    console.log('[4/7] Sembrando usuario agricultor y parcela en Región Pasco...');
    const userRes = await db.dbRun(`
      INSERT INTO users (name, email, password_hash, role, phone, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `, ['Deyvis Pasco Tester', 'deyvis.tester@agropasco.pe', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', 'farmer', '+51 963852741']);
    const userId = userRes.lastID;

    const geoJson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-76.257, -10.667],
          [-76.255, -10.667],
          [-76.255, -10.665],
          [-76.257, -10.665],
          [-76.257, -10.667]
        ]]
      }
    });

    // Parcela Chaupimarca (Centroide: -10.6674, -76.2567, Altitud 4337 msnm, Cultivo Papa)
    const parcelRes = await db.dbRun(`
      INSERT INTO parcels (user_id, name, geo_json, center_lat, center_lng, altitude_masl, crop_type, area_hectares, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activa')
    `, [userId, 'Parcela Chaupimarca Alta', geoJson, -10.6674, -76.2567, 4337, 'papa', 2.8]);
    const parcelId = parcelRes.lastID;

    console.log(`  ✓ Usuario ID ${userId} y Parcela ID ${parcelId} registrados en PostgreSQL.`);

    // -----------------------------------------------------------------------
    // PREPARACIÓN DE CACHÉ METEOROLÓGICA PARA AISLAMIENTO HERMÉTICO
    // -----------------------------------------------------------------------
    const weatherCacheService = require('../services/weatherCacheService');
    const mockForecast = generateMockForecast(-10.6674, -76.2567, 4337);
    await weatherCacheService.saveSharedForecast(-10.6674, -76.2567, mockForecast, {
      altitude: 4337,
      scope: 'ml_full',
    });

    // -----------------------------------------------------------------------
    // EJECUCIÓN END-TO-END DE LOS 5 AGENTES
    // -----------------------------------------------------------------------
    console.log('[5/7] Ejecutando Flujo Multiagente Completo (5 Agentes) contra PostgreSQL Real...');
    const { orchestratorAgent, agentTaskManager } = require('../services/multiAgent');
    const predictionPersistenceService = require('../services/predictionPersistenceService');

    const workflowResult = await orchestratorAgent.executeWorkflow({
      parcel_id: parcelId,
      user_id: userId,
      workflow_type: 'agroclimatic_risk_assessment',
      include_monte_carlo: true,
      monte_carlo_iterations: 500,
      force_refresh: false,
    });

    assert(workflowResult, 'El flujo multiagente debe retornar un objeto de tarea');
    assert.strictEqual(workflowResult.status, 'completed', 'El estado de la tarea debe ser completed');
    assert.strictEqual(workflowResult.parcel_id, parcelId, 'Debe corresponder a la parcela consultada');
    assert(workflowResult.duration_ms > 0, 'Debe registrar duración en ms');

    // 1. Agente Meteorológico: Comprobar extracción de coordenadas y validación
    const meteoStep = workflowResult.steps.meteorological;
    assert(meteoStep, 'Debe existir el paso meteorological');
    assert.strictEqual(meteoStep.status, 'success', 'Paso meteorological debe ser exitoso');
    assert.strictEqual(meteoStep.parcel_validation.validation_passed, true, 'Validación geoespacial de Pasco debe ser exitosa');
    assert.strictEqual(meteoStep.parcel_validation.latitude, -10.6674, 'Latitude debe mapear center_lat');
    assert.strictEqual(meteoStep.parcel_validation.longitude, -76.2567, 'Longitude debe mapear center_lng');
    assert.strictEqual(meteoStep.parcel_validation.altitude_masl, 4337, 'Altitude debe coincidir');
    console.log('  ✅ [PASS] Agente Meteorológico: center_lat y center_lng leídos correctamente mediante alias SQL.');

    // 2. Agente Predictivo ML: Inferencia y horizontes
    const mlStep = workflowResult.steps.predictive_ml;
    assert(mlStep, 'Debe existir el paso predictive_ml');
    assert.strictEqual(mlStep.status, 'success', 'Paso predictive_ml debe ser exitoso');
    assert(mlStep.predictions_by_horizon['24h'], 'Debe contener horizonte 24h');
    assert(mlStep.predictions_by_horizon['48h'], 'Debe contener horizonte 48h');
    assert(mlStep.predictions_by_horizon['72h'], 'Debe contener horizonte 72h');
    assert(mlStep.predictions_by_horizon['24h'].frost, 'Debe predecir fenómeno heladas');
    assert(mlStep.monte_carlo_sensitivity, 'Debe incluir sensibilidad Monte Carlo');
    assert.strictEqual(mlStep.monte_carlo_sensitivity.executed, true, 'Monte Carlo debe haberse ejecutado exitosamente');
    assert.strictEqual(mlStep.monte_carlo_sensitivity.iterations, 500, 'Monte Carlo debe haber ejecutado 500 iteraciones');
    console.log('  ✅ [PASS] Agente Predictivo ML: Inferencias y Monte Carlo ejecutados correctamente.');

    // 3. Agente Agrícola Operativo: Estrategias y mitigación
    const agriStep = workflowResult.steps.agricultural_operative;
    assert(agriStep, 'Debe existir el paso agricultural_operative');
    assert.strictEqual(agriStep.status, 'success', 'Paso agricultural_operative debe ser exitoso');
    assert(Array.isArray(agriStep.mitigation_strategies), 'Debe incluir lista de estrategias preventivas');
    assert(agriStep.mitigation_strategies.length > 0, 'Debe generar al menos una estrategia preventiva');
    assert(agriStep.safety_guardrails, 'Debe reportar barreras de seguridad aplicadas');
    assert.strictEqual(agriStep.safety_guardrails.b2b_orders_auto_modified, false, 'No debe auto-modificar pedidos B2B');
    assert.strictEqual(agriStep.safety_guardrails.physical_valves_actuated, false, 'No debe activar válvulas físicas');
    console.log('  ✅ [PASS] Agente Agrícola: Estrategias generadas y barreras de seguridad respetadas.');

    // 4. Agente Auditor y Supervisor: 6 Controles de Cumplimiento
    const auditStep = workflowResult.steps.auditor_supervisor;
    assert(auditStep, 'Debe existir el paso auditor_supervisor');
    assert.strictEqual(auditStep.status, 'success', 'Paso auditor_supervisor debe ser exitoso');
    assert.strictEqual(auditStep.total_checks, 6, 'Debe haber evaluado 6 controles obligatorios');
    assert.strictEqual(auditStep.passed_checks, 6, 'Los 6 controles deben estar aprobados');
    assert.strictEqual(auditStep.compliance_status, 'verified', 'Dictamen debe ser verified');
    console.log('  ✅ [PASS] Agente Auditor Supervisor: 6/6 Controles verificados con dictamen verified.');

    // 5. Persistencia y Trazabilidad en Tablas Físicas PostgreSQL
    console.log('[6/7] Verificando persistencia física en agent_tasks, agent_audit_logs y ml_predictions_log...');
    
    // Verificar agent_tasks en PostgreSQL
    const taskDb = await db.dbGet('SELECT * FROM agent_tasks WHERE id = ?', [workflowResult.id]);
    assert(taskDb, 'La tarea debe estar persistida en la tabla agent_tasks');
    assert.strictEqual(taskDb.status, 'completed', 'Estado en BD debe ser completed');
    assert.strictEqual(taskDb.parcel_id, parcelId, 'Parcel_id en BD debe ser correcto');
    assert(taskDb.steps && typeof taskDb.steps === 'string', 'Steps debe estar guardado como JSON string');
    
    // Verificar agent_audit_logs en PostgreSQL
    const auditDb = await db.dbGet('SELECT * FROM agent_audit_logs WHERE task_id = ?', [workflowResult.id]);
    assert(auditDb, 'El log de auditoría debe estar persistido en agent_audit_logs');
    assert.strictEqual(auditDb.compliance_status, 'verified', 'Estado de cumplimiento en BD debe ser verified');
    assert(auditDb.verification_details.includes('SIMULATION_VS_OBSERVATION_DISTINCTION'), 'Detalles deben contener la auditoría');

    // Persistir predicciones
    const weatherSource = meteoStep.provenance?.source || 'Open-Meteo ERA5';
    const persistRes = await predictionPersistenceService.persistWorkflowPredictions(
      workflowResult.id,
      parcelId,
      mlStep,
      weatherSource
    );
    assert(persistRes.inserted_count > 0, 'Debe insertar al menos una predicción en ml_predictions_log');

    const predDb = await db.dbAll('SELECT * FROM ml_predictions_log WHERE task_id = ?', [workflowResult.id]);
    assert(predDb.length >= 3, 'Deben existir predicciones persistidas para los horizontes');
    console.log(`  ✅ [PASS] Persistencia confirmada en PostgreSQL: ${predDb.length} registros en ml_predictions_log.`);

    // -----------------------------------------------------------------------
    // PRUEBAS DE ERROR CONTROLADO Y RESILIENCIA
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // PRUEBAS DE ERROR CONTROLADO Y RESILIENCIA
    // -----------------------------------------------------------------------
    console.log('[7/7] Probando manejo de error controlado y trazabilidad en auditoría...');
    
    // Caso 7.1: Parcela inexistente rechazada controladamente
    let controlledErrorCaught = false;
    try {
      await orchestratorAgent.executeWorkflow({
        parcel_id: 999999, // ID inexistente
        user_id: userId,
        workflow_type: 'agroclimatic_risk_assessment',
      });
    } catch (err) {
      controlledErrorCaught = true;
      assert(
        err.message.includes('foreign key') || 
        err.message.includes('violates foreign key') || 
        err.message.includes('no existe') || 
        err.message.includes('no encontrada'),
        `Mensaje de error inesperado: ${err.message}`
      );
    }
    assert(controlledErrorCaught, 'Debe fallar de manera controlada al consultar parcela inexistente');
    console.log('  ✅ [PASS] Parcela inexistente rechazada con integridad referencial garantizada.');

    // Caso 7.2: Parcela real con coordenadas fuera de Pasco (Anomalía Geográfica)
    const outOfBoundsParcel = await db.dbRun(`
      INSERT INTO parcels (user_id, name, geo_json, center_lat, center_lng, altitude_masl, crop_type, area_hectares, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activa')
    `, [userId, 'Parcela Fuera de Pasco (Lima Costera)', geoJson, -12.0464, -77.0428, 150, 'papa', 1.0]);
    const outParcelId = outOfBoundsParcel.lastID;

    // Suministrar forecast sintético para la coordenada fuera de Pasco
    const outForecast = generateMockForecast(-12.0464, -77.0428, 150);
    await weatherCacheService.saveSharedForecast(-12.0464, -77.0428, outForecast, {
      altitude: 150,
      scope: 'ml_full',
    });

    const anomalousWorkflow = await orchestratorAgent.executeWorkflow({
      parcel_id: outParcelId,
      user_id: userId,
      workflow_type: 'agroclimatic_risk_assessment',
      include_monte_carlo: false,
    });

    assert(anomalousWorkflow, 'Flujo de parcela anómala debe completar registrando advertencias');
    const meteoAnomalous = anomalousWorkflow.steps.meteorological;
    assert.strictEqual(meteoAnomalous.parcel_validation.is_pasco_region, false, 'Debe detectar que está fuera de Pasco');
    assert.strictEqual(meteoAnomalous.parcel_validation.validation_passed, false, 'Validation passed debe ser false');

    const auditAnomalous = anomalousWorkflow.steps.auditor_supervisor;
    assert(
      auditAnomalous.compliance_status === 'warning' || auditAnomalous.compliance_status === 'violation',
      'Auditor debe emitir dictamen warning o violation ante coordenadas fuera de Pasco'
    );

    // Verificar que el log de auditoría se persistió en PostgreSQL con el estado de advertencia
    const auditLogRow = await db.dbGet(
      'SELECT * FROM agent_audit_logs WHERE task_id = ?',
      [anomalousWorkflow.id]
    );
    assert(auditLogRow, 'Log de auditoría de advertencia debe persistirse en BD');
    assert(
      auditLogRow.compliance_status === 'warning' || auditLogRow.compliance_status === 'violation',
      'Estado en BD debe reflejar advertencia'
    );
    console.log('  ✅ [PASS] Anomalía geográfica detectada y auditada con trazabilidad estricta (warning/violation).');

    console.log('\n======================================================================');
    console.log('RESULTADO FINAL: TODOS LOS TESTS SOBRE POSTGRESQL REAL PASARON (7/7)');
    console.log('======================================================================\n');

  } finally {
    console.log('Cerrando pool de conexiones PostgreSQL...');
    try {
      if (testPool) await testPool.end();
    } catch (_) {}
    console.log('Cerrando clúster PostgreSQL efímero y liberando recursos...');
    cluster.stop();
    console.log('✓ Clúster PostgreSQL detenido y directorio temporal eliminado.');
  }
}

if (require.main === module) {
  runRealPostgresMultiagentSuite().catch((err) => {
    console.error('\n❌ ERROR FATAL EN SUITE POSTGRES REAL:', err);
    process.exit(1);
  });
}

module.exports = { runRealPostgresMultiagentSuite };
