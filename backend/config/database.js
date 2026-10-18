/**
 * AgroPasco — Configuración de Base de Datos PostgreSQL
 * Inicialización de tablas y datos semilla
 *
 * Migración desde SQLite:
 *   - Usa node-postgres (pg) con Pool de conexiones
 *   - dbRun/dbGet/dbAll convierten ? → $N automáticamente
 *   - dbRun detecta INSERTs y agrega RETURNING id para compatibilidad con lastID
 *   - Tipos adaptados: SERIAL, TIMESTAMPTZ, BOOLEAN, JSONB, DOUBLE PRECISION
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { advisoryKnowledge } = require('../data/advisory-knowledge');

// ===== Conexión =====
const DATABASE_URL = process.env.DATABASE_URL;

function checkDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL no está configurada. Configura la variable de entorno con la cadena de conexión PostgreSQL.');
    process.exit(1);
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL || 'postgresql://localhost:5432/agropasco_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  if (process.env.DATABASE_URL) {
    console.error('Error inesperado en el pool de PostgreSQL:', err.message);
  }
});

// ===== Helpers de compatibilidad =====

/**
 * Convierte placeholders de estilo SQLite (?) a estilo PostgreSQL ($1, $2, ...).
 * Solo reemplaza '?' fuera de cadenas de texto delimitadas por comillas simples.
 */
function convertPlaceholders(sql) {
  if (!sql || typeof sql !== 'string' || !sql.includes('?')) {
    return sql;
  }
  let index = 0;
  let inString = false;
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && sql[j] === '\\') {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        inString = !inString;
      }
      result += ch;
    } else if (ch === '?' && !inString) {
      index++;
      result += `$${index}`;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Retorna el pool activo (permite inyectar pools aislados para pruebas de integración).
 */
function getActivePool() {
  return (module.exports && module.exports.pool) ? module.exports.pool : pool;
}

/**
 * Ejecuta un INSERT, UPDATE o DELETE.
 * Para INSERTs, agrega RETURNING id automáticamente para compatibilidad con lastID.
 * Retorna { lastID, changes } igual que el wrapper anterior de SQLite.
 */
async function dbRun(sql, params = []) {
  if (module.exports && module.exports.dbRun && module.exports.dbRun !== dbRun) {
    return module.exports.dbRun(sql, params);
  }
  const pgSql = convertPlaceholders(sql);
  let finalSql = pgSql;

  // Para INSERT, agregar RETURNING id si no existe ya
  const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
  if (isInsert && !/RETURNING\s+/i.test(pgSql)) {
    finalSql = pgSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
  }

  const activePool = getActivePool();
  const result = await activePool.query(finalSql, params);

  return {
    lastID: isInsert && result.rows && result.rows.length > 0 ? result.rows[0].id : null,
    changes: result.rowCount || 0,
  };
}

/**
 * Ejecuta un SELECT y retorna la primera fila (o undefined).
 */
async function dbGet(sql, params = []) {
  if (module.exports && module.exports.dbGet && module.exports.dbGet !== dbGet) {
    return module.exports.dbGet(sql, params);
  }
  const pgSql = convertPlaceholders(sql);
  const activePool = getActivePool();
  const result = await activePool.query(pgSql, params);
  return result.rows[0] || undefined;
}

/**
 * Ejecuta un SELECT y retorna todas las filas como array.
 */
async function dbAll(sql, params = []) {
  if (module.exports && module.exports.dbAll && module.exports.dbAll !== dbAll) {
    return module.exports.dbAll(sql, params);
  }
  const pgSql = convertPlaceholders(sql);
  const activePool = getActivePool();
  const result = await activePool.query(pgSql, params);
  return result.rows;
}

/**
 * Retorna el pool de conexiones (equivalente a getDb para código legado).
 */
function getDb() {
  return getActivePool();
}

/**
 * Ejecuta una operación atómica dentro de una transacción PostgreSQL en un cliente dedicado.
 * Garantiza que todas las consultas utilicen la misma conexión física del pool.
 * Realiza COMMIT si la función finaliza exitosamente o ROLLBACK si se produce una excepción.
 * Libera el cliente de vuelta al pool en el bloque finally.
 * @param {Function} callback Función asíncrona que recibe el contexto transaccional: callback(tx)
 */
async function withTransaction(callback) {
  if (module.exports && module.exports.withTransaction && module.exports.withTransaction !== withTransaction) {
    return module.exports.withTransaction(callback);
  }
  // Compatibilidad con pruebas unitarias que simulan dbRun/dbGet en memoria sin PostgreSQL activo
  if (module.exports && (module.exports.dbRun !== dbRun || module.exports.dbGet !== dbGet)) {
    const mockTx = {
      client: {
        query: async (sql, params) => ({ rows: [] }),
      },
      query: (sql, params) => (module.exports.query ? module.exports.query(sql, params) : getActivePool().query(sql, params)),
      dbGet: (sql, params) => module.exports.dbGet(sql, params),
      dbAll: (sql, params) => module.exports.dbAll(sql, params),
      dbRun: (sql, params) => module.exports.dbRun(sql, params),
    };
    return await callback(mockTx);
  }
  const activePool = getActivePool();
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');

    const tx = {
      client,
      query: (sql, params) => client.query(sql, params),
      dbGet: async (sql, params = []) => {
        const pgSql = convertPlaceholders(sql);
        const res = await client.query(pgSql, params);
        return res.rows[0] || undefined;
      },
      dbAll: async (sql, params = []) => {
        const pgSql = convertPlaceholders(sql);
        const res = await client.query(pgSql, params);
        return res.rows;
      },
      dbRun: async (sql, params = []) => {
        const pgSql = convertPlaceholders(sql);
        let finalSql = pgSql;
        const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
        if (isInsert && !/RETURNING\s+/i.test(pgSql)) {
          finalSql = pgSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
        }
        const res = await client.query(finalSql, params);
        return {
          lastID: isInsert && res.rows && res.rows.length > 0 ? res.rows[0].id : null,
          changes: res.rowCount || 0,
        };
      },
    };

    const result = await callback(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// ===== Lista oficial de tablas requeridas en el esquema PostgreSQL =====
const EXPECTED_SCHEMA_TABLES = [
  'users',
  'crops',
  'crop_logs',
  'weather_cache',
  'advisory_tips',
  'products',
  'notifications',
  'parcels',
  'pest_markers',
  'advisor_recommendations',
  'audit_logs',
  'pest_reports',
  'pest_report_responses',
  'support_tickets',
  'ground_truth_observations',
  'alert_preferences'
];

// ===== Inicialización de tablas (esquema final PostgreSQL) =====

/**
 * Crea las 16 tablas del esquema PostgreSQL oficial sin insertar datos semilla.
 * Es estrictamente idempotente: utiliza CREATE TABLE IF NOT EXISTS.
 * Acepta un ejecutor opcional (client o pool), por defecto usa el pool del módulo.
 */
async function initializeSchema(executor = null) {
  executor = executor || getActivePool();
  console.log('📦 Creando/verificando esquema PostgreSQL (16 tablas)...');

  // ===== TABLA: users =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'farmer' CHECK(role IN ('farmer', 'advisor', 'supermarket', 'admin')),
      location TEXT DEFAULT 'Cerro de Pasco',
      phone TEXT,
      status TEXT DEFAULT 'active',
      is_blocked INTEGER DEFAULT 0,
      must_change_password INTEGER DEFAULT 0,
      approved_by INTEGER,
      rejection_reason TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: crops =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS crops (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      crop_type TEXT NOT NULL,
      variety TEXT,
      area_hectares DOUBLE PRECISION DEFAULT 0,
      planting_date DATE,
      expected_harvest_date DATE,
      status TEXT DEFAULT 'planificado' CHECK(status IN ('planificado', 'sembrado', 'crecimiento', 'floracion', 'maduracion', 'cosechado', 'cancelado')),
      location_detail TEXT,
      altitude_masl INTEGER,
      notes TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: crop_logs (trazabilidad) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS crop_logs (
      id SERIAL PRIMARY KEY,
      crop_id INTEGER NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK(action_type IN ('siembra', 'riego', 'fertilizacion', 'fumigacion', 'aporque', 'poda', 'cosecha', 'inspeccion', 'alerta_clima', 'deshierbe', 'otro')),
      description TEXT NOT NULL,
      weather_snapshot TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: weather_cache =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS weather_cache (
      id SERIAL PRIMARY KEY,
      location TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'current',
      data_json TEXT NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: advisory_tips =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS advisory_tips (
      id SERIAL PRIMARY KEY,
      crop_type TEXT NOT NULL,
      category TEXT NOT NULL,
      condition TEXT NOT NULL,
      recommendation TEXT NOT NULL
    )
  `);

  // ===== TABLA: products (supermercado) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      farmer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      crop_type TEXT NOT NULL,
      quality TEXT DEFAULT 'primera' CHECK(quality IN ('primera', 'segunda', 'gourmet', 'organica', 'premium')),
      origin TEXT DEFAULT 'Región Pasco',
      stock_kg DOUBLE PRECISION DEFAULT 0,
      price_per_kg DOUBLE PRECISION DEFAULT 0,
      unit TEXT DEFAULT 'kg',
      description TEXT,
      traceability_code TEXT UNIQUE,
      certified_natural INTEGER DEFAULT 0,
      available INTEGER DEFAULT 1,
      harvest_date DATE,
      validation_status TEXT DEFAULT 'approved',
      validated_by INTEGER,
      validation_notes TEXT,
      validated_at TIMESTAMPTZ,
      photo_url TEXT,
      is_natural INTEGER DEFAULT 0,
      original_price DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: notifications =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      read INTEGER DEFAULT 0,
      parcel_id INTEGER,
      phenomenon TEXT,
      model_type TEXT,
      issued_at TIMESTAMPTZ,
      valid_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: parcels (polígonos de parcelas) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS parcels (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      geo_json TEXT NOT NULL,
      area_hectares DOUBLE PRECISION DEFAULT 0,
      center_lat DOUBLE PRECISION,
      center_lng DOUBLE PRECISION,
      crop_type TEXT,
      crop_id INTEGER REFERENCES crops(id) ON DELETE SET NULL,
      planting_date DATE,
      status TEXT DEFAULT 'activa' CHECK(status IN ('activa', 'en_descanso', 'planificada', 'cosechada')),
      altitude_masl INTEGER DEFAULT 4380,
      notes TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: pest_markers (marcadores de plagas georreferenciados) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS pest_markers (
      id SERIAL PRIMARY KEY,
      advisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      pest_type TEXT NOT NULL CHECK(pest_type IN ('insecto', 'hongo', 'bacteria', 'virus', 'maleza', 'nematodo', 'otro')),
      severity TEXT DEFAULT 'moderado' CHECK(severity IN ('leve', 'moderado', 'grave', 'critico')),
      title TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      resolved INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: advisor_recommendations =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS advisor_recommendations (
      id SERIAL PRIMARY KEY,
      advisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      farmer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
      category TEXT NOT NULL CHECK(category IN ('fertilizacion', 'riego', 'plagas', 'cosecha', 'rotacion', 'general')),
      title TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('baja', 'normal', 'alta', 'urgente')),
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'leida', 'aplicada', 'descartada')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: audit_logs (auditoría del administrador) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: pest_reports (reportes de plagas agricultor → asesor) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS pest_reports (
      id SERIAL PRIMARY KEY,
      farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
      pest_name TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      location_lat DOUBLE PRECISION,
      location_lng DOUBLE PRECISION,
      status TEXT DEFAULT 'pendiente',
      advisor_response TEXT,
      advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      severity TEXT DEFAULT 'moderado',
      control_status TEXT DEFAULT 'pendiente',
      attachment_video_url TEXT,
      attachment_doc_url TEXT,
      attachment_doc_name TEXT,
      feedback_status TEXT,
      feedback_notes TEXT,
      feedback_at TIMESTAMPTZ,
      feedback_media_url TEXT
    )
  `);

  // ===== TABLA: pest_report_responses (historial de respuestas del asesor y materiales) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS pest_report_responses (
      id SERIAL PRIMARY KEY,
      pest_report_id INTEGER NOT NULL REFERENCES pest_reports(id) ON DELETE CASCADE,
      advisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      response_text TEXT NOT NULL,
      control_status TEXT NOT NULL DEFAULT 'en_proceso',
      attachment_video_url TEXT,
      attachment_doc_url TEXT,
      attachment_doc_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: support_tickets (soporte técnico y consultas) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT,
      user_email TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'abierto' CHECK(status IN ('abierto', 'en_atencion', 'resuelto')),
      response TEXT,
      escalated_to_dev INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: ground_truth_observations =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS ground_truth_observations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      altitude_masl INTEGER,
      phenomenon TEXT NOT NULL CHECK(phenomenon IN ('frost', 'heavy_rain', 'snow', 'hail', 'drought', 'strong_winds')),
      severity TEXT DEFAULT 'moderado' CHECK(severity IN ('leve', 'moderado', 'severo', 'extremo')),
      source TEXT NOT NULL DEFAULT 'farmer_report' CHECK(source IN ('farmer_report', 'senamhi_station', 'field_advisor', 'satellite_validated')),
      verification_method TEXT DEFAULT 'visual_inspection' CHECK(verification_method IN ('visual_inspection', 'thermometer', 'pluviometer', 'official_report')),
      station_id TEXT,
      temperature_recorded DOUBLE PRECISION,
      precipitation_recorded_mm DOUBLE PRECISION,
      crop_damage_percentage DOUBLE PRECISION,
      notes TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: alert_preferences =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS alert_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      frost_enabled INTEGER DEFAULT 1,
      heavy_rain_enabled INTEGER DEFAULT 1,
      snow_enabled INTEGER DEFAULT 1,
      hail_enabled INTEGER DEFAULT 1,
      min_risk_level TEXT DEFAULT 'moderate' CHECK(min_risk_level IN ('low', 'moderate', 'high')),
      in_app_enabled INTEGER DEFAULT 1,
      email_enabled INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('✅ Esquema PostgreSQL creado/verificado correctamente (16 tablas).');
}

/**
 * Esquema Comercial B2B (COMERCIO01):
 * Crea de forma idempotente las tablas de órdenes de compra B2B (purchase_orders)
 * y trazabilidad de estados (order_status_history), y añade columnas de enlace en notifications.
 */
async function initializeCommercialSchema(executor = null) {
  executor = executor || getActivePool();
  // ===== TABLA: purchase_orders =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      order_code VARCHAR(32) UNIQUE NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      supermarket_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      supermarket_name TEXT NOT NULL,
      buyer_representative_name TEXT NOT NULL,
      buyer_contact_phone TEXT NOT NULL,
      buyer_contact_email TEXT,
      farmer_name TEXT NOT NULL,
      farmer_contact_phone TEXT,
      product_name TEXT NOT NULL,
      crop_type TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'primera',
      unit TEXT NOT NULL DEFAULT 'kg',
      quantity DOUBLE PRECISION NOT NULL,
      unit_price DOUBLE PRECISION NOT NULL,
      subtotal DOUBLE PRECISION NOT NULL,
      transport_modality TEXT NOT NULL CHECK(transport_modality IN ('farmer_delivery', 'supermarket_pickup')),
      transport_cost DOUBLE PRECISION DEFAULT 0,
      transport_payer TEXT DEFAULT 'supermarket' CHECK(transport_payer IN ('supermarket', 'farmer', 'shared', 'none')),
      transport_cost_status TEXT DEFAULT 'not_applicable' CHECK(transport_cost_status IN ('not_applicable', 'pending_quote', 'quoted', 'accepted', 'rejected')),
      delivery_address TEXT,
      delivery_reference TEXT,
      pickup_location TEXT,
      pickup_reference TEXT,
      requested_date DATE NOT NULL,
      agreed_date DATE,
      agreed_time_slot TEXT,
      packaging_instructions TEXT,
      notes TEXT,
      total_amount DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'solicitud_enviada' CHECK(status IN (
        'solicitud_enviada',
        'pendiente_respuesta',
        'transporte_por_cotizar',
        'pendiente_aceptacion_condiciones',
        'aceptada',
        'en_preparacion',
        'lista_para_entrega',
        'en_traslado',
        'entregada',
        'rechazada',
        'cancelada'
      )),
      farmer_response_notes TEXT,
      rejection_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ===== TABLA: order_status_history =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_by_name TEXT NOT NULL,
      changed_by_role TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Agregar columna order_id a notifications si no existe
  try {
    await executor.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL
    `);
  } catch (_) {}

  // Índices para optimización de consultas B2B
  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_farmer_id ON purchase_orders(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_supermarket_id ON purchase_orders(supermarket_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON purchase_orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON order_status_history(order_id);
  `);

  console.log('✅ Esquema Comercial B2B verificado (purchase_orders, order_status_history, notifications.order_id).');

  // ===== TABLA: mitigation_actions (Estrategias y acciones de mitigación preventiva - Fase 5) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS mitigation_actions (
      id SERIAL PRIMARY KEY,
      parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strategy_id TEXT NOT NULL,
      phenomenon TEXT NOT NULL,
      action_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'en_proceso', 'realizada', 'no_aplicable')),
      horizon TEXT NOT NULL DEFAULT '24h',
      risk_level TEXT NOT NULL DEFAULT 'moderate',
      priority TEXT NOT NULL DEFAULT 'alta',
      time_window TEXT,
      resources_needed TEXT,
      precautions TEXT,
      notes TEXT,
      advisor_notes TEXT,
      advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      executed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_parcel_strategy UNIQUE (parcel_id, strategy_id)
    )
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_mitigation_parcel_id ON mitigation_actions(parcel_id);
    CREATE INDEX IF NOT EXISTS idx_mitigation_status ON mitigation_actions(status);
  `);

  console.log('✅ Esquema de Mitigación Agrícola verificado (mitigation_actions).');

  // ===== TABLAS DEL SISTEMA MULTIAGENTE (Fase 6) =====
  await executor.query(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id VARCHAR(64) PRIMARY KEY,
      workflow_type VARCHAR(64) NOT NULL,
      parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
      current_agent VARCHAR(64) NOT NULL DEFAULT 'orchestrator',
      steps TEXT NOT NULL DEFAULT '{}',
      result_summary TEXT,
      error_message TEXT,
      retries INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS agent_audit_logs (
      id SERIAL PRIMARY KEY,
      task_id VARCHAR(64) REFERENCES agent_tasks(id) ON DELETE CASCADE,
      parcel_id INTEGER REFERENCES parcels(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      agent_name VARCHAR(64) NOT NULL,
      action VARCHAR(128) NOT NULL,
      compliance_status VARCHAR(32) NOT NULL DEFAULT 'verified' CHECK(compliance_status IN ('verified', 'warning', 'violation')),
      verification_details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_parcel_id ON agent_tasks(parcel_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_audit_task_id ON agent_audit_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON agent_audit_logs(created_at DESC);
  `);

  console.log('✅ Esquema Multiagente verificado (agent_tasks, agent_audit_logs).');

  // ===== TABLAS DE AUTOMATIZACIÓN Y PREDICCIÓN PERSISTENTE (Fase 7) =====
  // 1. Registro histórico y evaluación de predicciones ML vs observaciones
  await executor.query(`
    CREATE TABLE IF NOT EXISTS ml_predictions_log (
      id SERIAL PRIMARY KEY,
      task_id VARCHAR(64) REFERENCES agent_tasks(id) ON DELETE SET NULL,
      parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      emitted_at TIMESTAMPTZ DEFAULT NOW(),
      target_date DATE NOT NULL,
      horizon VARCHAR(16) NOT NULL,
      phenomenon VARCHAR(32) NOT NULL,
      probability DOUBLE PRECISION NOT NULL,
      risk_score DOUBLE PRECISION NOT NULL,
      risk_level VARCHAR(32) NOT NULL,
      model_name VARCHAR(64) NOT NULL,
      model_version VARCHAR(64) NOT NULL,
      weather_source VARCHAR(128) NOT NULL,
      validity_status VARCHAR(32) DEFAULT 'active' CHECK(validity_status IN ('active', 'evaluated', 'expired', 'stale')),
      evaluation_result VARCHAR(32) DEFAULT 'pending' CHECK(evaluation_result IN ('pending', 'hit', 'miss', 'false_alarm', 'correct_negative', 'unverified')),
      observation_id INTEGER REFERENCES ground_truth_observations(id) ON DELETE SET NULL,
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. Control de concurrencia y leases distribuidos para el Scheduler en Render / Node.js
  await executor.query(`
    CREATE TABLE IF NOT EXISTS scheduler_locks (
      job_name VARCHAR(64) PRIMARY KEY,
      locked_by VARCHAR(128) NOT NULL,
      locked_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ,
      last_status VARCHAR(32) DEFAULT 'idle',
      last_error TEXT
    )
  `);

  // 3. Asignación de asesores a parcelas específicas (Aislamiento RBAC estricto - Fase 7)
  await executor.query(`
    CREATE TABLE IF NOT EXISTS advisor_parcel_assignments (
      id SERIAL PRIMARY KEY,
      advisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      active INTEGER DEFAULT 1,
      CONSTRAINT unique_advisor_parcel UNIQUE (advisor_id, parcel_id)
    )
  `);

  // Columnas adicionales seguras para notifications
  await executor.query(`
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS horizon VARCHAR(16);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS risk_level VARCHAR(32);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION;
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_ml_pred_parcel_target ON ml_predictions_log(parcel_id, target_date, phenomenon);
    CREATE INDEX IF NOT EXISTS idx_ml_pred_validity ON ml_predictions_log(validity_status);
    CREATE INDEX IF NOT EXISTS idx_advisor_parcel_active ON advisor_parcel_assignments(advisor_id, parcel_id, active);
  `);

  console.log('✅ Esquema Operacional Fase 7 verificado (ml_predictions_log, scheduler_locks, advisor_parcel_assignments).');
}


/**
 * Inicialización completa para desarrollo/servidor:
 * 1. Inicializa el esquema limpio (16 tablas base + esquema comercial B2B, idempotente)
 * 2. Aplica datos semilla iniciales SOLO en entornos no-producción
 *
 * En NODE_ENV=production se omite seedData para proteger los datos
 * reales de Supabase de sobrescrituras accidentales.
 */
async function initializeDatabase() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    console.log('🔒 Modo PRODUCCIÓN: inicializando solo esquema (seedData omitido).');
    await initializeSchema();
    await initializeCommercialSchema();
    console.log('✅ Esquema PostgreSQL verificado en modo producción.');
  } else {
    console.log('📦 Inicializando base de datos PostgreSQL con datos semilla...');
    await initializeSchema();
    await initializeCommercialSchema();
    await seedData();
    console.log('✅ Base de datos PostgreSQL inicializada correctamente');
  }
}

async function seedData() {
  const bcrypt = require('bcryptjs');
  const defaultHash = await bcrypt.hash('123456', 10);
  const adminInitialPasswordHash = await bcrypt.hash('123456789', 12);

  // ===== Seed: Administrador Inicial Único Oficial (Requerimiento AgroPasco) =====
  // Correo: garciatorrescristian39@gmail.com | Clave: 123456789
  const officialAdminEmail = 'garciatorrescristian39@gmail.com';
  const existingOfficialAdmin = await dbGet('SELECT * FROM users WHERE email = ?', [officialAdminEmail]);
  const activeAdmin = await dbGet("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");
  const transferPerformed = await dbGet("SELECT id FROM audit_logs WHERE action = 'TRANSFERENCIA_ADMINISTRACION' LIMIT 1");

  if (!existingOfficialAdmin && !activeAdmin) {
    // 1. Primer arranque: Crear Administrador Inicial Único Oficial
    await dbRun("UPDATE users SET status = 'disabled', is_blocked = 1 WHERE role = 'admin'");

    const adminResult = await dbRun(
      `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password)
       VALUES (?, ?, ?, 'admin', ?, ?, 'active', 0, 0)`,
      ['Cristian Garcia Torres', officialAdminEmail, adminInitialPasswordHash, 'Cerro de Pasco, Pasco', '963000001']
    );

    await dbRun(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [adminResult.lastID, 'REGISTRO_ADMINISTRADOR_INICIAL', 'user', adminResult.lastID, `Administrador Central Inicial Oficial "${officialAdminEmail}" registrado con éxito.`, '127.0.0.1']
    );

    console.log(`🔐 Administrador único inicial configurado: ${officialAdminEmail} / 123456789`);
  } else if (existingOfficialAdmin && !transferPerformed && !activeAdmin) {
    // 2. El usuario existe y no ha habido transferencia ni otro admin activo: activarlo como admin inicial
    await dbRun(
      `UPDATE users SET
        role = 'admin',
        password_hash = COALESCE(password_hash, ?),
        status = 'active',
        is_blocked = 0
       WHERE email = ?`,
      [adminInitialPasswordHash, officialAdminEmail]
    );
    await dbRun("UPDATE users SET status = 'disabled', is_blocked = 1 WHERE role = 'admin' AND email != ?", [officialAdminEmail]);
    console.log(`🔐 Administrador único inicial activado: ${officialAdminEmail}`);
  } else if (existingOfficialAdmin && !transferPerformed && activeAdmin?.id === existingOfficialAdmin.id) {
    // 3. El admin oficial ya es el administrador activo (preservar su contraseña si la cambió)
    console.log(`🔐 Administrador único activo confirmado: ${officialAdminEmail}`);
  } else if (transferPerformed && activeAdmin) {
    // 4. Se ha transferido la administración con éxito: respetar al nuevo administrador activo
    console.log(`👑 Sucesión administrativa activa. Administrador en funciones: ${activeAdmin.email}`);
  }

  // ===== Seed: Agricultor de referencia (SOLO en entornos NO producción) =====
  if (process.env.NODE_ENV !== 'production') {
    const farmerExists = await dbGet("SELECT id FROM users WHERE email = 'agricultor@agropasco.pe'");
    if (!farmerExists) {
      await dbRun(
        `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password)
         VALUES (?, ?, ?, 'farmer', ?, ?, 'active', 0, 0)`,
        ['Agricultor de Pasco', 'agricultor@agropasco.pe', defaultHash, 'Yanahuanca, Pasco', '963987638']
      );
    }

    // Seed sample support tickets if table empty (solo desarrollo)
    const existingTickets = await dbGet('SELECT COUNT(*) as count FROM support_tickets');
    if (!existingTickets || existingTickets.count === 0 || parseInt(existingTickets.count) === 0) {
      await dbRun(`
        INSERT INTO support_tickets (user_name, user_email, category, subject, message, status, response, created_at)
        VALUES
        ('Pedro Villegas', 'pedro.villegas@gmail.com', 'login', 'Problema para recordar contraseña', 'Olvidé mi contraseña de agricultor y necesito ingresar para ver mis parcelas.', 'en_atencion', 'Se ha generado una clave provisional y notificado al agricultor.', NOW() - INTERVAL '2 hours')
      `);
      await dbRun(`
        INSERT INTO support_tickets (user_name, user_email, category, subject, message, status, response, created_at)
        VALUES
        ('Rosa Mendoza', 'rosa.m@agro.pe', 'registro', 'Duda sobre registro de parcela en Yanahuanca', '¿Cómo puedo asociar la altitud automáticamente al dibujar mi parcela?', 'resuelto', 'El sistema detecta automáticamente la altitud mediante GPS y Open-Elevation al seleccionar el punto.', NOW() - INTERVAL '1 day')
      `);
      await dbRun(`
        INSERT INTO support_tickets (user_name, user_email, category, subject, message, status, response, created_at)
        VALUES
        ('Juan Ramos', 'juan.ramos.pasco@gmail.com', 'tecnico', 'Error al cargar fotografía de papa con gorgojo', 'La conexión en campo es lenta y quisiera saber si la foto se guardó correctamente.', 'abierto', NULL, NOW() - INTERVAL '30 minutes')
      `);
    }
  } else {
    console.log('🔒 Producción: agricutor de referencia y tickets de muestra omitidos.');
  }

  // Check if advisory tips already seeded
  const existing = await dbGet('SELECT COUNT(*) as count FROM advisory_tips');
  if (existing && parseInt(existing.count) > 0) return;

  console.log('🌱 Insertando datos semilla...');

  // Insert advisory tips
  for (const tip of advisoryKnowledge) {
    await dbRun(
      'INSERT INTO advisory_tips (crop_type, category, condition, recommendation) VALUES (?, ?, ?, ?)',
      [tip.crop_type, tip.category, tip.condition, tip.recommendation]
    );
  }

  // Insert sample products
  const sampleProducts = [
    { name: 'Papa Nativa Huayro', crop_type: 'papa', quality: 'primera', origin: 'Yanahuanca, Pasco', stock_kg: 1200, price_per_kg: 3.80, traceability_code: 'AP-PAPA-2026-001', certified_natural: 1, description: 'Papa huayro de primera selección cosechada en Yanahuanca, sin agroquímicos, cultivo tradicional andino.' },
    { name: 'Maca Orgánica Amarilla', crop_type: 'maca', quality: 'organica', origin: 'Ninacaca, Pasco', stock_kg: 500, price_per_kg: 22.00, traceability_code: 'AP-MACA-2026-002', certified_natural: 1, description: 'Maca amarilla de la meseta de Ninacaca secada al sol durante 60 días.' },
    { name: 'Café Especial Villa Rica', crop_type: 'cafe', quality: 'gourmet', origin: 'Villa Rica, Oxapampa', stock_kg: 200, price_per_kg: 48.00, traceability_code: 'AP-CAFE-2026-003', certified_natural: 1, description: 'Café de altura de Villa Rica, variedad Typica, proceso lavado, puntaje 84 SCA.' },
    { name: 'Quinua Blanca Orgánica', crop_type: 'quinua', quality: 'organica', origin: 'Paucartambo, Pasco', stock_kg: 350, price_per_kg: 14.50, traceability_code: 'AP-QUIN-2026-004', certified_natural: 1, description: 'Quinua blanca de Paucartambo, lavada y desaponificada. Grano grande calibre >2mm.' },
    { name: 'Habas Secas Seleccionadas', crop_type: 'habas', quality: 'primera', origin: 'Chacayán, Pasco', stock_kg: 800, price_per_kg: 5.20, traceability_code: 'AP-HABA-2026-005', certified_natural: 1, description: 'Habas secas de Chacayán, grano grande y uniforme, almacenamiento desinfectado natural.' },
    { name: 'Olluco Fresco Premium', crop_type: 'olluco', quality: 'premium', origin: 'Huayllay, Pasco', stock_kg: 400, price_per_kg: 4.50, traceability_code: 'AP-OLLU-2026-006', certified_natural: 1, description: 'Olluco fresco de Huayllay de color amarillo brillante, sin daño mecánico.' },
    { name: 'Maca Negra Premium', crop_type: 'maca', quality: 'premium', origin: 'Vicco, Pasco', stock_kg: 150, price_per_kg: 35.00, traceability_code: 'AP-MACN-2026-007', certified_natural: 1, description: 'Maca negra cosechada en Vicco, la variedad más escasa y valorada. Secado natural 45 días.' },
    { name: 'Papa Nativa Peruanita', crop_type: 'papa', quality: 'gourmet', origin: 'Yanahuanca, Pasco', stock_kg: 600, price_per_kg: 4.20, traceability_code: 'AP-PPRU-2026-008', certified_natural: 1, description: 'Papa peruanita de Yanahuanca, piel bicolor, textura cremosa para gastronomía gourmet.' },
  ];

  if (process.env.NODE_ENV !== 'production') {
    for (const prod of sampleProducts) {
      await dbRun(
        `INSERT INTO products (name, crop_type, quality, origin, stock_kg, price_per_kg, traceability_code, certified_natural, description, harvest_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE - (floor(random() * 30))::int * INTERVAL '1 day')`,
        [prod.name, prod.crop_type, prod.quality, prod.origin, prod.stock_kg, prod.price_per_kg, prod.traceability_code, prod.certified_natural, prod.description]
      );
    }
  } else {
    console.log('🔒 Producción: productos de muestra omitidos.');
  }

  console.log('✅ Datos semilla insertados: ' + advisoryKnowledge.length + ' consejos, ' + sampleProducts.length + ' productos');
}

module.exports = {
  pool,
  getActivePool,
  getDb,
  dbRun,
  dbGet,
  dbAll,
  withTransaction,
  convertPlaceholders,
  initializeSchema,
  initializeCommercialSchema,
  seedData,
  initializeDatabase,
  EXPECTED_SCHEMA_TABLES
};
