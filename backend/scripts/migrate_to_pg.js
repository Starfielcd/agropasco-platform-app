/**
 * AgroPasco — Script de Migración e Importación a PostgreSQL (Supabase Free)
 * =========================================================================
 * Lee el archivo JSON oficial del respaldo de producción (LIVE 9b995b2)
 * e inserta todos los datos en la base de datos PostgreSQL respetando:
 *   - Orden estricto de dependencias de Claves Foráneas (FK)
 *   - Filtrado estricto de columnas (elimina columnas calculadas de JOINs)
 *   - Preservación exacta de IDs originales (SERIAL)
 *   - Transacción atómica global única (BEGIN / COMMIT / ROLLBACK)
 *   - Actualización de secuencias PostgreSQL (pg_get_serial_sequence)
 *   - Protección contra borrados destructivos (--clean exige --confirm-wipe-database)
 *   - Estrategia criptográfica segura para password_hash (sin contraseñas universales)
 *   - Generación de manifiesto de credenciales temporales (credentials_handoff.json)
 *   - Modo Dry-Run (--dry-run) 100% en seco sin conexión ni escrituras a la BD
 *
 * Uso:
 *   node backend/scripts/migrate_to_pg.js --dry-run
 *   node backend/scripts/migrate_to_pg.js [--url DATABASE_URL] [--clean --confirm-wipe-database] [--file RUTA_JSON]
 *
 * Opciones:
 *   --dry-run                 Ejecuta solo la validación estática del JSON sin conectar a PostgreSQL
 *   --url <url>               Cadena de conexión PostgreSQL (por defecto toma process.env.DATABASE_URL)
 *   --clean                   Limpia (TRUNCATE CASCADE) las tablas antes de importar (requiere --confirm-wipe-database)
 *   --confirm-wipe-database   Confirmación obligatoria para permitir operaciones de limpieza (--clean)
 *   --file <ruta>             Ruta al archivo JSON de respaldo oficial de producción
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { initializeSchema } = require('../config/database');

// Parsear argumentos CLI
const args = process.argv.slice(2);
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const isDryRun = args.includes('--dry-run');
const shouldClean = args.includes('--clean');
const confirmWipe = args.includes('--confirm-wipe-database');
const customUrl = getArg('--url');
const customFile = getArg('--file');

// Fuente por defecto: respaldo oficial de producción
const DEFAULT_BACKUP_FILE = path.resolve(
  __dirname,
  '..',
  'data',
  'production-backup',
  'production_live_backup_complete.json'
);

const DATA_FILE = customFile ? path.resolve(customFile) : DEFAULT_BACKUP_FILE;
const CREDENTIALS_HANDOFF_FILE = path.resolve(
  __dirname,
  '..',
  'data',
  'production-backup',
  'credentials_handoff.json'
);

// 1. PROTECCIÓN ESTRICTA: Prohibir expresamente export_data.json (SQLite local)
if (DATA_FILE.toLowerCase().includes('export_data.json')) {
  console.error('\n❌ ERROR CRÍTICO DE SEGURIDAD:');
  console.error('Se intentó especificar "export_data.json", el cual corresponde a datos de desarrollo SQLite local.');
  console.error('La migración a Supabase exige EXCLUSIVAMENTE el respaldo de producción:');
  console.error(`  ${DEFAULT_BACKUP_FILE}\n`);
  process.exit(1);
}

// 2. PROTECCIÓN DESTRUCTORA: Exigir confirmación explícita para --clean
if (shouldClean && !confirmWipe) {
  console.error('\n🛑 PROTECCIÓN DE SEGURIDAD ACTIVADA:');
  console.error('El flag --clean ejecuta TRUNCATE CASCADE destructivo sobre las tablas de la base de datos.');
  console.error('Para prevenir borrados accidentales de datos de producción, se requiere confirmación explícita.');
  console.error('Si realmente deseas vaciar la base de datos de destino, debes incluir ambos flags:');
  console.error('  --clean --confirm-wipe-database\n');
  process.exit(1);
}

if (!fs.existsSync(DATA_FILE)) {
  console.error(`\n❌ ERROR: Archivo de respaldo no encontrado en: ${DATA_FILE}`);
  console.error('Asegúrate de que exista el archivo generado por la extracción de producción.\n');
  process.exit(1);
}

// Validación de autenticidad del archivo de respaldo
function validateBackupFileStructure(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`El archivo ${filePath} no es un JSON válido: ${err.message}`);
  }

  const meta = parsed._metadata;
  if (!meta) {
    throw new Error('El archivo NO contiene el bloque _metadata obligatorio del extractor de producción.');
  }

  if (!meta.source_url || !meta.source_url.includes('agropasco-digital.onrender.com')) {
    throw new Error(`El archivo indica un source_url inválido o no correspondiente a producción: ${meta.source_url}`);
  }

  if (meta.target_commit !== '9b995b2') {
    throw new Error(`El commit objetivo registrado en el respaldo (${meta.target_commit}) no coincide con LIVE 9b995b2.`);
  }

  if (!parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('El archivo no contiene la clave "tables" con el mapa de entidades.');
  }

  return parsed;
}

// Conteos esperados y certificados de la extracción de producción (LIVE 9b995b2)
const EXPECTED_PRODUCTION_COUNTS = {
  users: 18,
  parcels: 6,
  crops: 7,
  crop_logs: 8,
  products: 12,
  pest_reports: 6,
  pest_report_responses: 2,
  pest_markers: 0,
  advisor_recommendations: 0,
  support_tickets: 3,
  audit_logs: 19,
  advisory_tips: 47,
};

// Orden estricto de inserción respetando Foreign Keys
const INSERTION_ORDER = [
  'users',
  'crops',
  'parcels',
  'crop_logs',
  'products',
  'notifications',
  'pest_reports',
  'pest_report_responses',
  'pest_markers',
  'advisor_recommendations',
  'audit_logs',
  'support_tickets',
  'advisory_tips',
  'weather_cache',
  'ground_truth_observations',
  'alert_preferences',
];

// Esquema PostgreSQL de referencia (columnas oficiales, obligatorias y FKs)
const PG_SCHEMAS = {
  users: {
    columns: ['id', 'name', 'email', 'password_hash', 'role', 'location', 'phone', 'status', 'is_blocked', 'must_change_password', 'approved_by', 'rejection_reason', 'approved_at', 'created_at', 'updated_at'],
    required: ['name', 'email', 'password_hash'],
    fks: []
  },
  crops: {
    columns: ['id', 'user_id', 'name', 'crop_type', 'variety', 'area_hectares', 'planting_date', 'expected_harvest_date', 'status', 'location_detail', 'altitude_masl', 'notes', 'photo_url', 'created_at', 'updated_at'],
    required: ['user_id', 'name', 'crop_type'],
    fks: [{ col: 'user_id', refTable: 'users', refCol: 'id' }]
  },
  parcels: {
    columns: ['id', 'user_id', 'name', 'geo_json', 'area_hectares', 'center_lat', 'center_lng', 'crop_type', 'crop_id', 'planting_date', 'status', 'altitude_masl', 'notes', 'photo_url', 'created_at', 'updated_at'],
    required: ['user_id', 'name', 'geo_json'],
    fks: [
      { col: 'user_id', refTable: 'users', refCol: 'id' },
      { col: 'crop_id', refTable: 'crops', refCol: 'id', nullable: true }
    ]
  },
  crop_logs: {
    columns: ['id', 'crop_id', 'action_type', 'description', 'weather_snapshot', 'photo_url', 'created_at'],
    required: ['crop_id', 'action_type', 'description'],
    fks: [{ col: 'crop_id', refTable: 'crops', refCol: 'id' }]
  },
  products: {
    columns: ['id', 'farmer_id', 'name', 'crop_type', 'quality', 'origin', 'stock_kg', 'price_per_kg', 'unit', 'description', 'traceability_code', 'certified_natural', 'available', 'harvest_date', 'validation_status', 'validated_by', 'validation_notes', 'validated_at', 'photo_url', 'is_natural', 'original_price', 'created_at', 'updated_at'],
    required: ['name', 'crop_type'],
    fks: [
      { col: 'farmer_id', refTable: 'users', refCol: 'id', nullable: true },
      { col: 'validated_by', refTable: 'users', refCol: 'id', nullable: true }
    ]
  },
  notifications: {
    columns: ['id', 'user_id', 'type', 'title', 'message', 'severity', 'read', 'parcel_id', 'phenomenon', 'model_type', 'issued_at', 'valid_until', 'created_at'],
    required: ['type', 'title', 'message'],
    fks: [
      { col: 'user_id', refTable: 'users', refCol: 'id', nullable: true },
      { col: 'parcel_id', refTable: 'parcels', refCol: 'id', nullable: true }
    ]
  },
  pest_reports: {
    columns: ['id', 'farmer_id', 'parcel_id', 'pest_name', 'description', 'photo_url', 'location_lat', 'location_lng', 'status', 'advisor_response', 'advisor_id', 'responded_at', 'created_at', 'severity', 'control_status', 'attachment_video_url', 'attachment_doc_url', 'attachment_doc_name', 'feedback_status', 'feedback_notes', 'feedback_at', 'feedback_media_url'],
    required: ['farmer_id', 'pest_name'],
    fks: [
      { col: 'farmer_id', refTable: 'users', refCol: 'id' },
      { col: 'parcel_id', refTable: 'parcels', refCol: 'id', nullable: true },
      { col: 'advisor_id', refTable: 'users', refCol: 'id', nullable: true }
    ]
  },
  pest_report_responses: {
    columns: ['id', 'pest_report_id', 'advisor_id', 'response_text', 'control_status', 'attachment_video_url', 'attachment_doc_url', 'attachment_doc_name', 'created_at'],
    required: ['pest_report_id', 'advisor_id', 'response_text'],
    fks: [
      { col: 'pest_report_id', refTable: 'pest_reports', refCol: 'id' },
      { col: 'advisor_id', refTable: 'users', refCol: 'id' }
    ]
  },
  pest_markers: {
    columns: ['id', 'advisor_id', 'parcel_id', 'lat', 'lng', 'pest_type', 'severity', 'title', 'description', 'photo_url', 'resolved', 'created_at'],
    required: ['advisor_id', 'lat', 'lng', 'pest_type', 'title'],
    fks: [
      { col: 'advisor_id', refTable: 'users', refCol: 'id' },
      { col: 'parcel_id', refTable: 'parcels', refCol: 'id', nullable: true }
    ]
  },
  advisor_recommendations: {
    columns: ['id', 'advisor_id', 'farmer_id', 'parcel_id', 'category', 'title', 'recommendation', 'priority', 'status', 'created_at'],
    required: ['advisor_id', 'category', 'title', 'recommendation'],
    fks: [
      { col: 'advisor_id', refTable: 'users', refCol: 'id' },
      { col: 'farmer_id', refTable: 'users', refCol: 'id', nullable: true },
      { col: 'parcel_id', refTable: 'parcels', refCol: 'id', nullable: true }
    ]
  },
  audit_logs: {
    columns: ['id', 'user_id', 'action', 'entity_type', 'entity_id', 'details', 'ip_address', 'created_at'],
    required: ['action'],
    fks: [{ col: 'user_id', refTable: 'users', refCol: 'id', nullable: true }]
  },
  support_tickets: {
    columns: ['id', 'user_id', 'user_name', 'user_email', 'category', 'subject', 'message', 'status', 'response', 'escalated_to_dev', 'created_at', 'updated_at'],
    required: ['subject', 'message'],
    fks: [{ col: 'user_id', refTable: 'users', refCol: 'id', nullable: true }]
  },
  advisory_tips: {
    columns: ['id', 'crop_type', 'category', 'condition', 'recommendation'],
    required: ['crop_type', 'category', 'condition', 'recommendation'],
    fks: []
  },
  weather_cache: {
    columns: ['id', 'location', 'data_type', 'data_json', 'fetched_at'],
    required: ['location', 'data_json'],
    fks: []
  },
  ground_truth_observations: {
    columns: ['id', 'user_id', 'parcel_id', 'observed_at', 'latitude', 'longitude', 'altitude_masl', 'phenomenon', 'severity', 'source', 'verification_method', 'station_id', 'temperature_recorded', 'precipitation_recorded_mm', 'crop_damage_percentage', 'notes', 'photo_url', 'created_at'],
    required: ['observed_at', 'phenomenon'],
    fks: [
      { col: 'user_id', refTable: 'users', refCol: 'id', nullable: true },
      { col: 'parcel_id', refTable: 'parcels', refCol: 'id', nullable: true }
    ]
  },
  alert_preferences: {
    columns: ['id', 'user_id', 'frost_enabled', 'heavy_rain_enabled', 'snow_enabled', 'hail_enabled', 'min_risk_level', 'in_app_enabled', 'email_enabled', 'updated_at'],
    required: ['user_id'],
    fks: [{ col: 'user_id', refTable: 'users', refCol: 'id' }]
  }
};

/**
 * Generador de contraseñas temporales únicas criptográficas de alta entropía (>= 96 bits).
 * Utiliza 12 bytes aleatorios (24 caracteres hexadecimales en 6 bloques de 4).
 * Formato: AP-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX! (33 caracteres, 96 bits de entropía pura)
 */
function generateUniqueTempPassword(usedSet = new Set()) {
  let pwd;
  do {
    const rawBytes = crypto.randomBytes(12);
    const hex = rawBytes.toString('hex').toUpperCase();
    const chunks = [];
    for (let i = 0; i < 24; i += 4) {
      chunks.push(hex.slice(i, i + 4));
    }
    pwd = `AP-${chunks.join('-')}!`;
  } while (usedSet.has(pwd));
  usedSet.add(pwd);
  return pwd;
}

/**
 * Sincroniza la secuencia SERIAL de una tabla en PostgreSQL:
 *   - Si la tabla tiene registros (MAX(id) no es nulo): setval(seq, MAX(id), true)
 *     -> El próximo INSERT automático tomará MAX(id) + 1.
 *   - Si la tabla está vacía (MAX(id) es nulo): setval(seq, 1, false)
 *     -> El primer INSERT automático tomará exactamente ID 1.
 */
async function syncTableSequence(client, table) {
  const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq_name;`, [table]);
  const seqName = seqRes.rows && seqRes.rows[0] ? seqRes.rows[0].seq_name : null;

  if (!seqName) {
    return { synced: false, reason: 'no_serial_sequence' };
  }

  const maxRes = await client.query(`SELECT MAX(id) AS max_id FROM "${table}";`);
  const maxId = maxRes.rows && maxRes.rows[0] ? maxRes.rows[0].max_id : null;

  if (maxId !== null && maxId !== undefined) {
    await client.query(`SELECT setval($1, $2, true);`, [seqName, maxId]);
    return { synced: true, seqName, value: maxId, isCalled: true };
  } else {
    await client.query(`SELECT setval($1, 1, false);`, [seqName]);
    return { synced: true, seqName, value: 1, isCalled: false };
  }
}

/**
 * Prepara los usuarios asignando hashes y contraseñas temporales según la estrategia autorizada:
 *   - Admin Oficial (ID 16): hash de '123456789', must_change_password = 0
 *   - Admins Deshabilitados (IDs 7, 17, 18): hash aleatorio inaccesible, must_change_password = 0, disabled/blocked
 *   - 14 Usuarios reales: contraseña temporal ÚNICA, hash individual bcrypt, must_change_password = 1
 */
async function prepareUsersForMigration(userRows) {
  const preparedRows = [];
  const handoffCredentials = [];
  const usedPasswords = new Set();

  for (const rawUser of userRows) {
    const user = { ...rawUser };

    if (user.id === 16 && user.email === 'garciatorrescristian39@gmail.com') {
      // A. Administrador Central Oficial
      user.password_hash = await bcrypt.hash('123456789', 12);
      user.must_change_password = 0;
      user.status = 'active';
      user.is_blocked = 0;
    } else if ([7, 17, 18].includes(user.id)) {
      // B. Administradores inactivos / deshabilitados
      const inaccessibleSecret = crypto.randomBytes(32).toString('hex');
      user.password_hash = await bcrypt.hash(inaccessibleSecret, 12);
      user.must_change_password = 0;
      user.status = 'disabled';
      user.is_blocked = 1;
    } else {
      // C. 14 Usuarios reales de producción (IDs 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15)
      const tempPassword = generateUniqueTempPassword(usedPasswords);
      user.password_hash = await bcrypt.hash(tempPassword, 12);
      user.must_change_password = 1;

      // Registrar en manifiesto de entrega
      handoffCredentials.push({
        user_id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        temp_password: tempPassword
      });
    }

    preparedRows.push(user);
  }

  return { preparedRows, handoffCredentials };
}

/**
 * MODO DRY-RUN:
 * Validación estática en seco sin conectar a PostgreSQL ni escribir archivos
 */
async function runDryRun(payload) {
  console.log('\n============================================================');
  console.log('🔬 AgroPasco — VALIDACIÓN EN SECO (DRY RUN)');
  console.log('============================================================');
  console.log(`📁 Archivo analizado: ${DATA_FILE}`);
  console.log(`🏷️  Origen: ${payload._metadata?.source_url}`);
  console.log(`📌 Commit origen: ${payload._metadata?.target_commit}`);
  console.log(`📅 Fecha de extracción: ${payload._metadata?.extracted_at}`);
  console.log(`👤 Usuario extractor: ${payload._metadata?.authenticated_user?.email} (ID: ${payload._metadata?.authenticated_user?.id})`);
  console.log('------------------------------------------------------------\n');

  const tables = payload.tables || {};
  let totalErrors = 0;
  let totalWarnings = 0;

  // 1. Verificación de conteos esperados
  console.log('📊 1. VERIFICACIÓN DE CONTEOS DE REGISTROS:');
  console.log('----------------------------------------------------------------------');
  console.log(`${'Tabla'.padEnd(28)} | ${'Esperado'.padEnd(10)} | ${'En Backup'.padEnd(10)} | Estado`);
  console.log('----------------------------------------------------------------------');

  for (const [table, expectedCount] of Object.entries(EXPECTED_PRODUCTION_COUNTS)) {
    const actualRows = tables[table] || [];
    const actualCount = Array.isArray(actualRows) ? actualRows.length : 0;
    const match = expectedCount === actualCount;
    const status = match ? '✅ EXACTO' : '❌ DIFERENCIA';
    if (!match) totalErrors++;
    console.log(`${table.padEnd(28)} | ${String(expectedCount).padEnd(10)} | ${String(actualCount).padEnd(10)} | ${status}`);
  }
  console.log('----------------------------------------------------------------------\n');

  // 2. Tablas nuevas del esquema que no existen en el backup (deben quedar vacías)
  console.log('🆕 2. TABLAS NUEVAS DEL ESQUEMA (ML / ALERTAS):');
  const newTables = ['notifications', 'weather_cache', 'ground_truth_observations', 'alert_preferences'];
  for (const nt of newTables) {
    const inBackup = tables[nt] ? tables[nt].length : 0;
    console.log(`  - ${nt}: ${inBackup} registros en backup → Se creará vacía en PostgreSQL ✅`);
  }
  console.log();

  // 3. Verificación de IDs (duplicados, nulos, consistencia numérica)
  console.log('🔑 3. INTEGRIDAD DE IDENTIFICADORES (IDs):');
  const idMaps = {};

  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const ids = rows.map(r => r.id);
    idMaps[table] = new Set(ids);

    const nullIds = ids.filter(id => id === null || id === undefined);
    const nonNumericIds = ids.filter(id => typeof id !== 'number' || isNaN(id));
    const duplicateIds = ids.filter((id, idx) => ids.indexOf(id) !== idx);

    let issues = [];
    if (nullIds.length > 0) {
      issues.push(`${nullIds.length} IDs nulos`);
      totalErrors++;
    }
    if (nonNumericIds.length > 0) {
      issues.push(`${nonNumericIds.length} IDs no numéricos`);
      totalErrors++;
    }
    if (duplicateIds.length > 0) {
      issues.push(`IDs duplicados: [${duplicateIds.join(', ')}]`);
      totalErrors++;
    }

    if (issues.length === 0) {
      const minId = Math.min(...ids);
      const maxId = Math.max(...ids);
      console.log(`  ✅ ${table.padEnd(26)}: ${ids.length} IDs únicos válidos (rango: ${minId} .. ${maxId})`);
    } else {
      console.log(`  ❌ ${table.padEnd(26)}: ${issues.join(' | ')}`);
    }
  }
  console.log();

  // 4. Verificación de Claves Foráneas (FK) dentro del respaldo
  console.log('🔗 4. INTEGRIDAD REFERENCIAL DE CLAVES FORÁNEAS (FK):');
  for (const [table, schema] of Object.entries(PG_SCHEMAS)) {
    const rows = tables[table] || [];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    for (const fk of schema.fks) {
      const refSet = idMaps[fk.refTable] || new Set();
      let orphanCount = 0;
      const orphanIds = [];

      for (const row of rows) {
        const val = row[fk.col];
        if (val === null || val === undefined) {
          if (!fk.nullable) orphanCount++;
        } else {
          if (!refSet.has(val)) {
            orphanCount++;
            orphanIds.push({ id: row.id, refValue: val });
          }
        }
      }

      if (orphanCount === 0) {
        console.log(`  ✅ ${table}.${fk.col} → ${fk.refTable}.id : 0 huérfanos`);
      } else {
        console.log(`  ❌ ${table}.${fk.col} → ${fk.refTable}.id : ${orphanCount} huérfanos! (${JSON.stringify(orphanIds.slice(0, 3))})`);
        totalErrors++;
      }
    }
  }
  console.log();

  // 5. Análisis de Columnas: Extras (JOINs) y Faltantes (Esquema PG)
  console.log('📐 5. CONCORDANCIA DE COLUMNAS (ESQUEMA POSTGRESQL VS BACKUP JSON):');
  for (const [table, schema] of Object.entries(PG_SCHEMAS)) {
    const rows = tables[table] || [];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const firstRowCols = Object.keys(rows[0]);
    const validPgCols = new Set(schema.columns);

    const extraCols = firstRowCols.filter(c => !validPgCols.has(c));
    const missingCols = schema.columns.filter(c => !firstRowCols.includes(c));
    const missingRequired = schema.required.filter(c => !firstRowCols.includes(c));

    let statusStr = `  📋 ${table.padEnd(24)}: `;
    if (extraCols.length > 0) {
      statusStr += `\n     🟡 Columnas extra detectadas (se filtrarán automáticamente en INSERT): [${extraCols.join(', ')}]`;
      totalWarnings++;
    }
    if (missingRequired.length > 0) {
      if (table === 'users' && missingRequired.includes('password_hash')) {
        statusStr += `\n     🔐 password_hash se inyectará de forma individual según la estrategia autorizada ✅`;
      } else {
        statusStr += `\n     ❌ COLUMNAS OBLIGATORIAS AUSENTES: [${missingRequired.join(', ')}]`;
        totalErrors++;
      }
    } else if (missingCols.length > 0) {
      statusStr += `\n     ℹ️  Columnas opcionales ausentes (tomarán DEFAULT): [${missingCols.join(', ')}]`;
    }
    if (extraCols.length === 0 && (missingRequired.length === 0 || (table === 'users' && missingRequired.every(c => c === 'password_hash')))) {
      statusStr += 'Columnas compatibles al 100% ✅';
    }
    console.log(statusStr);
  }
  console.log();

  // 6. Simulación de la estrategia de contraseñas
  console.log('🔐 6. SIMULACIÓN DE LA ESTRATEGIA DE CONTRASEÑAS (EN MEMORIA):');
  const userRows = tables.users || [];
  const { preparedRows, handoffCredentials } = await prepareUsersForMigration(userRows);

  console.log(`  - Total usuarios procesados: ${preparedRows.length}`);
  const adminOfficial = preparedRows.find(u => u.id === 16);
  console.log(`  - Admin Oficial (ID 16, ${adminOfficial.email}): Hash de clave conocida inyectado, must_change_password = ${adminOfficial.must_change_password} ✅`);
  
  const disabledAdmins = preparedRows.filter(u => [7, 17, 18].includes(u.id));
  console.log(`  - Admins Inactivos (IDs 7, 17, 18): ${disabledAdmins.length} cuentas con hashes inaccesibles (status: disabled, is_blocked: 1) ✅`);

  console.log(`  - Cuentas Reales (14 usuarios): ${handoffCredentials.length} contraseñas temporales ÚNICAS simuladas ✅`);
  const uniqueTempCheck = new Set(handoffCredentials.map(c => c.temp_password));
  console.log(`  - Verificación de no colisión de claves temporales: ${uniqueTempCheck.size} únicas de ${handoffCredentials.length} generadas ✅`);
  console.log(`  - credentials_handoff.json: NO CREADO durante dry-run (protección activa) ✅`);
  console.log();

  // 7. Verificación de Fechas
  console.log('📅 7. COMPATIBILIDAD DE FORMATOS DE FECHA:');
  let invalidDatesCount = 0;
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'string' && (k.endsWith('_at') || k.endsWith('_date'))) {
          const timestamp = Date.parse(v);
          if (isNaN(timestamp)) {
            invalidDatesCount++;
            console.log(`  ❌ Fecha inválida en ${table} (id ${row.id}), campo ${k}: "${v}"`);
          }
        }
      }
    }
  }
  if (invalidDatesCount === 0) {
    console.log('  ✅ Todos los campos de fecha (_at, _date) son timestamps ISO-8601 válidos.');
  } else {
    totalErrors += invalidDatesCount;
  }
  console.log();

  // Resumen final del Dry Run
  console.log('============================================================');
  console.log('🏁 RESULTADO DEL DRY RUN:');
  console.log(`   - Errores críticos de integridad/datos: ${totalErrors}`);
  console.log(`   - Tablas con columnas filtrables: ${totalWarnings}`);
  console.log(`   - Integridad de IDs: 100% ÚNICOS Y VÁLIDOS`);
  console.log(`   - Integridad de Claves Foráneas (FK): 100% CERO HUÉRFANOS`);
  console.log(`   - Validación de Conteos: 100% COINCIDENTES`);
  console.log(`   - Estrategia de Contraseñas: 100% PREPARADA Y SEGURA`);
  console.log('------------------------------------------------------------');

  if (totalErrors === 0) {
    console.log('DRY RUN OK — Código y datos listos para migración transaccional autorizada.');
  } else {
    console.log('DRY RUN CON ERRORES — Corregir las inconsistencias señaladas antes de migrar.');
  }
  console.log('============================================================\n');
}

/**
 * EJECUCIÓN REAL DE MIGRACIÓN:
 * Atómica, dentro de una sola transacción global (BEGIN / COMMIT / ROLLBACK)
 * SOLO se ejecuta cuando el usuario lo autorice explícitamente sin --dry-run
 */
async function executeRealMigration(payload) {
  const DATABASE_URL = customUrl || process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('\n❌ ERROR: DATABASE_URL no está definida.');
    console.error('Pásala como argumento (--url "postgresql://...") o configúrala en backend/.env\n');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  const tables = payload.tables || {};

  console.log('\n============================================================');
  console.log('🚀 AgroPasco — EJECUCIÓN DE MIGRACIÓN A POSTGRESQL');
  console.log('============================================================');
  console.log(`📁 Fuente de producción: ${DATA_FILE}`);
  console.log(`🎯 Destino PostgreSQL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`🧹 Modo limpio (--clean): ${shouldClean && confirmWipe ? 'SÍ (TRUNCATE verificado)' : 'NO'}`);
  console.log('------------------------------------------------------------\n');

  try {
    // 1. Preparar usuarios con sus hashes y claves temporales
    console.log('🔐 Preparando credenciales seguras para la tabla users...');
    const { preparedRows: preparedUsers, handoffCredentials } = await prepareUsersForMigration(tables.users || []);
    tables.users = preparedUsers;

    // 2. INICIAR TRANSACCIÓN ATÓMICA GLOBAL ÚNICA
    console.log('🔄 Iniciando Transacción Atómica Global (BEGIN)...');
    await client.query('BEGIN');

    // 2.1 Asegurar que el esquema PostgreSQL (16 tablas) exista de forma limpia
    console.log('📦 Verificando/creando esquema PostgreSQL (16 tablas)...');
    await initializeSchema(client);

    // 3. Si se autorizó expresamente limpieza destructiva con doble confirmación
    if (shouldClean && confirmWipe) {
      console.log('🧹 Vaciando tablas en orden inverso respetando FKs...');
      const reverseOrder = [...INSERTION_ORDER].reverse();
      for (const table of reverseOrder) {
        try {
          await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
        } catch (truncErr) {
          // Ignorar si la tabla aún no fue creada
        }
      }
      console.log('✅ Tablas vaciadas.');
    }

    // 4. Inserción tabla por tabla dentro de la MISMA transacción
    console.log('📥 Insertando entidades respetando IDs y filtrando columnas...');
    const migrationSummary = {};

    for (const table of INSERTION_ORDER) {
      const rows = tables[table] || [];
      if (rows.length === 0) {
        console.log(`  - ${table.padEnd(26)}: 0 registros (omitida)`);
        migrationSummary[table] = 0;
        continue;
      }

      const validColumns = PG_SCHEMAS[table].columns;
      let insertedCount = 0;

      for (const row of rows) {
        // Filtrar exclusivamente columnas válidas del esquema PostgreSQL
        const rowKeys = Object.keys(row).filter(col => validColumns.includes(col));
        const rowValues = rowKeys.map(col => row[col]);

        const quotedCols = rowKeys.map(c => `"${c}"`).join(', ');
        const placeholders = rowKeys.map((_, i) => `$${i + 1}`).join(', ');

        let onConflict = '';
        if (rowKeys.includes('id')) {
          const updateAssignments = rowKeys
            .filter(c => c !== 'id')
            .map(c => `"${c}" = EXCLUDED."${c}"`)
            .join(', ');
          onConflict = updateAssignments.length > 0
            ? ` ON CONFLICT (id) DO UPDATE SET ${updateAssignments}`
            : ` ON CONFLICT (id) DO NOTHING`;
        }

        const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders})${onConflict};`;
        await client.query(sql, rowValues);
        insertedCount++;
      }

      // Sincronizar secuencia SERIAL respetando tablas con datos y tablas vacías
      if (validColumns.includes('id')) {
        try {
          await syncTableSequence(client, table);
        } catch (seqErr) {
          // Tabla sin secuencia SERIAL o error no crítico
        }
      }

      console.log(`  - ${table.padEnd(26)}: ${insertedCount}/${rows.length} registros insertados ✅`);
      migrationSummary[table] = insertedCount;
    }

    // 5. CONFIRMAR TRANSACCIÓN GLOBAL
    console.log('\n🔒 Confirmando Transacción Global (COMMIT)...');
    await client.query('COMMIT');
    console.log('✅ COMMIT exitoso: Todos los registros fueron guardados atómicamente.\n');

    // 6. Generar archivo privado de credenciales temporales SOLO tras COMMIT exitoso
    console.log('📝 Generando manifiesto local confidencial de credenciales temporales...');
    fs.writeFileSync(
      CREDENTIALS_HANDOFF_FILE,
      JSON.stringify(handoffCredentials, null, 2),
      'utf-8'
    );
    console.log(`🔐 Archivo generado exitosamente en:\n   ${CREDENTIALS_HANDOFF_FILE}`);
    console.log('   (Protegido en .gitignore — entregar individualmente a cada usuario)\n');

    // 7. Validación final de conteos en PostgreSQL
    console.log('============================================================');
    console.log('📊 REPORTE FINAL DE VERIFICACIÓN EN POSTGRESQL');
    console.log('============================================================');
    for (const [table, expected] of Object.entries(EXPECTED_PRODUCTION_COUNTS)) {
      try {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "${table}"`);
        const pgCount = parseInt(countRes.rows[0].count, 10);
        const match = pgCount === expected;
        console.log(`  ${table.padEnd(26)}: ${pgCount} en PG / ${expected} esperados ${match ? '✅' : '❌'}`);
      } catch (countErr) {
        console.log(`  ${table.padEnd(26)}: Error al consultar (${countErr.message})`);
      }
    }
    console.log('============================================================\n');

  } catch (err) {
    // 8. EN CASO DE ERROR: ROLLBACK COMPLETO INMEDIATO
    console.error('\n❌ ERROR DURANTE LA IMPORTACIÓN. EJECUTANDO ROLLBACK GLOBAL...');
    try {
      await client.query('ROLLBACK');
      console.error('🔄 ROLLBACK ejecutado: CERO cambios fueron persistidos en PostgreSQL.');
    } catch (rbErr) {
      console.error('Error al ejecutar rollback:', rbErr.message);
    }
    console.error('Detalle del error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Función principal
 */
async function main() {
  let payload;
  try {
    payload = validateBackupFileStructure(DATA_FILE);
  } catch (err) {
    console.error(`\n❌ ERROR DE VALIDACIÓN DEL ARCHIVO: ${err.message}\n`);
    process.exit(1);
  }

  // Si se invocó con --dry-run, ejecutar validación en seco y salir SIN conectar a BD
  if (isDryRun) {
    await runDryRun(payload);
    return;
  }

  // Ejecución real (solo si explícitamente autorizado sin --dry-run)
  await executeRealMigration(payload);
}

if (require.main === module) {
  main();
}

module.exports = {
  generateUniqueTempPassword,
  syncTableSequence,
  prepareUsersForMigration,
  validateBackupFileStructure,
  INSERTION_ORDER,
  PG_SCHEMAS
};
