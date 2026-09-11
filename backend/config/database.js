/**
 * AgroPasco — Configuración de Base de Datos SQLite
 * Inicialización de tablas y datos semilla
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { advisoryKnowledge } = require('../data/advisory-knowledge');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'agropasco.db');

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) console.error('Error al conectar con la base de datos:', err.message);
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

// Promisify db methods
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initializeDatabase() {
  console.log('📦 Inicializando base de datos...');

  // ===== TABLA: users =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'farmer' CHECK(role IN ('farmer', 'advisor', 'supermarket', 'admin')),
      location TEXT DEFAULT 'Cerro de Pasco',
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== TABLA: crops =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS crops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      crop_type TEXT NOT NULL,
      variety TEXT,
      area_hectares REAL DEFAULT 0,
      planting_date DATE,
      expected_harvest_date DATE,
      status TEXT DEFAULT 'planificado' CHECK(status IN ('planificado', 'sembrado', 'crecimiento', 'floracion', 'maduracion', 'cosechado', 'cancelado')),
      location_detail TEXT,
      altitude_masl INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ===== TABLA: crop_logs (trazabilidad) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS crop_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crop_id INTEGER NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('siembra', 'riego', 'fertilizacion', 'fumigacion', 'aporque', 'poda', 'cosecha', 'inspeccion', 'alerta_clima', 'otro')),
      description TEXT NOT NULL,
      weather_snapshot TEXT,
      photo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE
    )
  `);

  // ===== TABLA: weather_cache =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS weather_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'current' CHECK(data_type IN ('current', 'forecast')),
      data_json TEXT NOT NULL,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== TABLA: advisory_tips =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS advisory_tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crop_type TEXT NOT NULL,
      category TEXT NOT NULL,
      condition TEXT NOT NULL,
      recommendation TEXT NOT NULL
    )
  `);

  // ===== TABLA: products (supermercado) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER,
      name TEXT NOT NULL,
      crop_type TEXT NOT NULL,
      quality TEXT DEFAULT 'primera' CHECK(quality IN ('primera', 'segunda', 'gourmet', 'organica', 'premium')),
      origin TEXT DEFAULT 'Región Pasco',
      stock_kg REAL DEFAULT 0,
      price_per_kg REAL DEFAULT 0,
      unit TEXT DEFAULT 'kg',
      description TEXT,
      traceability_code TEXT UNIQUE,
      certified_natural INTEGER DEFAULT 0,
      available INTEGER DEFAULT 1,
      harvest_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ===== TABLA: notifications =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('alerta_helada', 'alerta_granizo', 'alerta_sequia', 'alerta_lluvia', 'asesoria', 'mercado', 'sistema')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ===== TABLA: parcels (polígonos de parcelas) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS parcels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      geo_json TEXT NOT NULL,
      area_hectares REAL DEFAULT 0,
      center_lat REAL,
      center_lng REAL,
      crop_type TEXT,
      planting_date DATE,
      status TEXT DEFAULT 'activa' CHECK(status IN ('activa', 'en_descanso', 'planificada', 'cosechada')),
      altitude_masl INTEGER DEFAULT 4380,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ===== TABLA: pest_markers (marcadores de plagas georreferenciados) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS pest_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      advisor_id INTEGER NOT NULL,
      parcel_id INTEGER,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      pest_type TEXT NOT NULL CHECK(pest_type IN ('insecto', 'hongo', 'bacteria', 'virus', 'maleza', 'nematodo', 'otro')),
      severity TEXT DEFAULT 'moderado' CHECK(severity IN ('leve', 'moderado', 'grave', 'critico')),
      title TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parcel_id) REFERENCES parcels(id) ON DELETE SET NULL
    )
  `);

  // ===== TABLA: advisor_recommendations =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS advisor_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      advisor_id INTEGER NOT NULL,
      farmer_id INTEGER,
      parcel_id INTEGER,
      category TEXT NOT NULL CHECK(category IN ('fertilizacion', 'riego', 'plagas', 'cosecha', 'rotacion', 'general')),
      title TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('baja', 'normal', 'alta', 'urgente')),
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'leida', 'aplicada', 'descartada')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (parcel_id) REFERENCES parcels(id) ON DELETE SET NULL
    )
  `);

  // ===== TABLA: audit_logs (auditoría del administrador) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ===== TABLA: pest_reports (reportes de plagas agricultor → asesor) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS pest_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL,
      parcel_id INTEGER,
      pest_name TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      location_lat REAL,
      location_lng REAL,
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'en_revision', 'resuelto')),
      advisor_response TEXT,
      advisor_id INTEGER,
      responded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parcel_id) REFERENCES parcels(id) ON DELETE SET NULL,
      FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ===== MIGRACIÓN: columnas de validación en products =====
  const productMigrations = [
    "ALTER TABLE products ADD COLUMN validation_status TEXT DEFAULT 'approved'",
    "ALTER TABLE products ADD COLUMN validated_by INTEGER",
    "ALTER TABLE products ADD COLUMN validation_notes TEXT",
    "ALTER TABLE products ADD COLUMN validated_at DATETIME",
    "ALTER TABLE products ADD COLUMN photo_url TEXT",
    "ALTER TABLE products ADD COLUMN is_natural INTEGER DEFAULT 0",
    "ALTER TABLE products ADD COLUMN original_price REAL DEFAULT 0"
  ];
  for (const sql of productMigrations) {
    try { await dbRun(sql); } catch (e) { /* columna ya existe */ }
  }

  // ===== SEED DATA =====
  await seedData();

  console.log('✅ Base de datos inicializada correctamente');
}

async function seedData() {
  // Ensure default demo user exists for foreign keys
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (!userCount || userCount.count === 0) {
    const bcrypt = require('bcryptjs');
    const defaultHash = await bcrypt.hash('123456', 12);
    await dbRun(
      `INSERT INTO users (id, name, email, password_hash, role, location, phone)
       VALUES (1, 'Agricultor de Pasco', 'agricultor@agropasco.pe', ?, 'farmer', 'Yanahuanca, Pasco', '963987638')`,
      [defaultHash]
    );
  }

  // Check if advisory tips already seeded
  const existing = await dbGet('SELECT COUNT(*) as count FROM advisory_tips');
  if (existing && existing.count > 0) return;

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

  for (const prod of sampleProducts) {
    await dbRun(
      `INSERT INTO products (name, crop_type, quality, origin, stock_kg, price_per_kg, traceability_code, certified_natural, description, harvest_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now', '-' || abs(random() % 30) || ' days'))`,
      [prod.name, prod.crop_type, prod.quality, prod.origin, prod.stock_kg, prod.price_per_kg, prod.traceability_code, prod.certified_natural, prod.description]
    );
  }

  console.log('✅ Datos semilla insertados: ' + advisoryKnowledge.length + ' consejos, ' + sampleProducts.length + ' productos');
}

module.exports = { getDb, dbRun, dbGet, dbAll, initializeDatabase };
