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
  let index = 0;
  let inString = false;
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && (i === 0 || sql[i - 1] !== '\\')) {
      inString = !inString;
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
 * Ejecuta un INSERT, UPDATE o DELETE.
 * Para INSERTs, agrega RETURNING id automáticamente para compatibilidad con lastID.
 * Retorna { lastID, changes } igual que el wrapper anterior de SQLite.
 */
async function dbRun(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  let finalSql = pgSql;

  // Para INSERT, agregar RETURNING id si no existe ya
  const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
  if (isInsert && !/RETURNING\s+/i.test(pgSql)) {
    finalSql = pgSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
  }

  const result = await pool.query(finalSql, params);

  return {
    lastID: isInsert && result.rows && result.rows.length > 0 ? result.rows[0].id : null,
    changes: result.rowCount || 0,
  };
}

/**
 * Ejecuta un SELECT y retorna la primera fila (o undefined).
 */
async function dbGet(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows[0] || undefined;
}

/**
 * Ejecuta un SELECT y retorna todas las filas como array.
 */
async function dbAll(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

/**
 * Retorna el pool de conexiones (equivalente a getDb para código legado).
 */
function getDb() {
  return pool;
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
async function initializeSchema(executor = pool) {
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
 * Inicialización completa para desarrollo/servidor:
 * 1. Inicializa el esquema limpio (16 tablas, idempotente)
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
    console.log('✅ Esquema PostgreSQL verificado en modo producción.');
  } else {
    console.log('📦 Inicializando base de datos PostgreSQL con datos semilla...');
    await initializeSchema();
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
  getDb,
  dbRun,
  dbGet,
  dbAll,
  initializeSchema,
  seedData,
  initializeDatabase,
  EXPECTED_SCHEMA_TABLES
};
