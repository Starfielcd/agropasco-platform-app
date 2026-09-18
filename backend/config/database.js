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

  // ===== TABLA: support_tickets (soporte técnico y consultas) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      user_email TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'abierto' CHECK(status IN ('abierto', 'en_atencion', 'resuelto')),
      response TEXT,
      escalated_to_dev INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
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

  // ===== MIGRACIÓN: columnas adicionales en pest_reports y users =====
  const additionalMigrations = [
    "ALTER TABLE pest_reports ADD COLUMN severity TEXT DEFAULT 'moderado'",
    "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0"
  ];
  for (const sql of additionalMigrations) {
    try { await dbRun(sql); } catch (e) { /* columna ya existe */ }
  }

  // ===== MIGRACIÓN: columnas para flujo de aprobación de cuentas =====
  const approvalMigrations = [
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN approved_by INTEGER",
    "ALTER TABLE users ADD COLUMN rejection_reason TEXT",
    "ALTER TABLE users ADD COLUMN approved_at DATETIME"
  ];
  for (const sql of approvalMigrations) {
    try { await dbRun(sql); } catch (e) { /* columna ya existe */ }
  }

  // ===== MIGRACIÓN: Fotos obligatorias y seguimiento de plagas =====
  const pestAndPhotoMigrations = [
    "ALTER TABLE parcels ADD COLUMN photo_url TEXT",
    "ALTER TABLE crops ADD COLUMN photo_url TEXT",
    "ALTER TABLE pest_reports ADD COLUMN control_status TEXT DEFAULT 'pendiente'",
    "ALTER TABLE pest_reports ADD COLUMN attachment_video_url TEXT",
    "ALTER TABLE pest_reports ADD COLUMN attachment_doc_url TEXT",
    "ALTER TABLE pest_reports ADD COLUMN attachment_doc_name TEXT",
    "ALTER TABLE pest_reports ADD COLUMN feedback_status TEXT",
    "ALTER TABLE pest_reports ADD COLUMN feedback_notes TEXT",
    "ALTER TABLE pest_reports ADD COLUMN feedback_at DATETIME"
  ];
  for (const sql of pestAndPhotoMigrations) {
    try { await dbRun(sql); } catch (e) { /* columna ya existe */ }
  }

  // ===== TABLA: pest_report_responses (historial de respuestas del asesor y materiales) =====
  await dbRun(`
    CREATE TABLE IF NOT EXISTS pest_report_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pest_report_id INTEGER NOT NULL,
      advisor_id INTEGER NOT NULL,
      response_text TEXT NOT NULL,
      control_status TEXT NOT NULL DEFAULT 'en_proceso',
      attachment_video_url TEXT,
      attachment_doc_url TEXT,
      attachment_doc_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pest_report_id) REFERENCES pest_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ===== SEED DATA =====
  await seedData();

  console.log('✅ Base de datos inicializada correctamente');
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

  // ===== Seed: Agricultor de referencia (para pruebas) =====
  const farmerExists = await dbGet("SELECT id FROM users WHERE email = 'agricultor@agropasco.pe'");
  if (!farmerExists) {
    await dbRun(
      `INSERT INTO users (name, email, password_hash, role, location, phone, status, is_blocked, must_change_password)
       VALUES (?, ?, ?, 'farmer', ?, ?, 'active', 0, 0)`,
      ['Agricultor de Pasco', 'agricultor@agropasco.pe', defaultHash, 'Yanahuanca, Pasco', '963987638']
    );
  }

  // Seed sample support tickets if table empty
  const existingTickets = await dbGet('SELECT COUNT(*) as count FROM support_tickets');
  if (!existingTickets || existingTickets.count === 0) {
    await dbRun(`
      INSERT INTO support_tickets (user_name, user_email, category, subject, message, status, response, created_at)
      VALUES
      ('Pedro Villegas', 'pedro.villegas@gmail.com', 'login', 'Problema para recordar contraseña', 'Olvidé mi contraseña de agricultor y necesito ingresar para ver mis parcelas.', 'en_atencion', 'Se ha generado una clave provisional y notificado al agricultor.', datetime('now', '-2 hours')),
      ('Rosa Mendoza', 'rosa.m@agro.pe', 'registro', 'Duda sobre registro de parcela en Yanahuanca', '¿Cómo puedo asociar la altitud automáticamente al dibujar mi parcela?', 'resuelto', 'El sistema detecta automáticamente la altitud mediante GPS y Open-Elevation al seleccionar el punto.', datetime('now', '-1 day')),
      ('Juan Ramos', 'juan.ramos.pasco@gmail.com', 'tecnico', 'Error al cargar fotografía de papa con gorgojo', 'La conexión en campo es lenta y quisiera saber si la foto se guardó correctamente.', 'abierto', NULL, datetime('now', '-30 minutes'))
    `);
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
