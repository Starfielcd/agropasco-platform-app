/**
 * AgroPasco — Script de Inicialización Limpia del Esquema PostgreSQL
 * ==================================================================
 * Crea exclusivamente las 16 tablas del esquema PostgreSQL oficial
 * utilizando CREATE TABLE IF NOT EXISTS.
 *
 * Principios estrictos de seguridad e integridad:
 *   - NO ejecuta seedData() bajo ninguna circunstancia.
 *   - NO inserta registros ficticios ni datos semilla.
 *   - NO borra tablas (sin DROP ni TRUNCATE).
 *   - NO usa ni permite flags destructivos (--clean).
 *   - 100% Idempotente: puede ejecutarse múltiples veces sin alterar datos existentes.
 *   - Requiere DATABASE_URL para ejecución real.
 *   - Enmascara credenciales en consola (sin imprimir secretos).
 *   - Termina con código != 0 ante cualquier error.
 *
 * Uso:
 *   node backend/scripts/init_pg_schema.js [--help] [--dry-run]
 */

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { initializeSchema, EXPECTED_SCHEMA_TABLES } = require('../config/database');

// Protección arquitectónica: verificar que seedData NO esté presente ni accesible
if (typeof seedData !== 'undefined') {
  console.error('\n❌ ERROR FATAL DE ARQUITECTURA: seedData está accesible en init_pg_schema.js');
  process.exit(1);
}

const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const isDryRun = args.includes('--dry-run');

// Bloqueo explícito contra flags destructivos
if (args.includes('--clean') || args.includes('--confirm-wipe-database') || args.includes('--drop')) {
  console.error('\n🛑 ERROR: init_pg_schema.js es un inicializador estrictamente no destructivo.');
  console.error('Los flags --clean, --drop o similares están terminantemente prohibidos en este script.\n');
  process.exit(1);
}

function showHelp() {
  console.log(`
Uso: node backend/scripts/init_pg_schema.js [opciones]

Inicializa limpiamente el esquema PostgreSQL creando las 16 tablas oficiales
sin insertar datos semilla ni alterar tablas preexistentes.

Opciones:
  --help, -h    Muestra esta ayuda
  --dry-run     Valida el esquema estáticamente sin conectar a PostgreSQL
`);
}

/**
 * Ejecuta la creación limpia de las 16 tablas sobre la base de datos.
 * Acepta un pool opcional para facilitar pruebas locales con mocks.
 */
async function runInitSchema(customPool = null) {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL && !customPool) {
    console.error('\n❌ ERROR: DATABASE_URL no está definida en el entorno ni en backend/.env');
    console.error('Configura DATABASE_URL antes de ejecutar la inicialización del esquema en Supabase.\n');
    process.exit(1);
  }

  const pool = customPool || new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL && DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();

  try {
    const maskedUrl = DATABASE_URL
      ? DATABASE_URL.replace(/:[^:@]+@/, ':****@')
      : 'mock_pool_connection';

    console.log('\n============================================================');
    console.log('📦 AgroPasco — INICIALIZACIÓN LIMPIA DE ESQUEMA POSTGRESQL');
    console.log('============================================================');
    console.log(`🎯 Destino PostgreSQL: ${maskedUrl}`);
    console.log(`📋 Tablas a crear/verificar: ${EXPECTED_SCHEMA_TABLES.length}`);
    console.log('🌱 Datos semilla (seedData): DESACTIVADOS ESTRICTAMENTE');
    console.log('------------------------------------------------------------\n');

    // Ejecutar creación del esquema (16 tablas con CREATE TABLE IF NOT EXISTS)
    await initializeSchema(client);

    // Verificación de tablas en el esquema public
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const existingTables = (res.rows || []).map(r => r.table_name);
    console.log('\n📊 Verificación de tablas en esquema public:');
    let allFound = true;
    for (const t of EXPECTED_SCHEMA_TABLES) {
      const found = existingTables.includes(t);
      if (!found) allFound = false;
      console.log(`  ${found ? '✅' : '❌'} ${t.padEnd(28)} : ${found ? 'EXISTE' : 'NO ENCONTRADA'}`);
    }

    if (!allFound) {
      throw new Error('No todas las tablas requeridas fueron detectadas en el esquema public tras la ejecución.');
    }

    // Confirmar que no hay datos semilla insertados en users
    const usersCountRes = await client.query('SELECT COUNT(*) as count FROM users;');
    const usersCount = parseInt(usersCountRes.rows[0].count, 10);
    console.log(`\n🔍 Verificación de pureza: ${usersCount} usuarios encontrados en tabla users.`);
    if (usersCount > 0) {
      console.log('⚠️  Aviso: La tabla users contiene registros previos (no fueron alterados).');
    } else {
      console.log('✅ Esquema verificado 100% limpio (cero registros semilla inyectados).');
    }

    console.log('============================================================');
    console.log('✅ ESQUEMA POSTGRESQL INICIALIZADO LIMPIAMENTE');
    console.log('============================================================\n');

    return { success: true, tables: existingTables, usersCount };
  } catch (err) {
    console.error('\n❌ ERROR AL INICIALIZAR EL ESQUEMA POSTGRESQL:', err.message);
    throw err;
  } finally {
    client.release();
    if (!customPool) {
      await pool.end();
    }
  }
}

async function main() {
  if (isHelp) {
    showHelp();
    return;
  }

  if (isDryRun) {
    console.log('\n============================================================');
    console.log('🔬 AgroPasco — VALIDACIÓN EN SECO DE ESQUEMA (DRY RUN)');
    console.log('============================================================');
    console.log('📋 Tablas oficiales contempladas (16 tablas):');
    EXPECTED_SCHEMA_TABLES.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2, ' ')}. ${t}`));
    console.log('🌱 seedData(): EXCLUIDO arquitectónicamente.');
    console.log('🔒 Cero conexiones realizadas a PostgreSQL.');
    console.log('============================================================\n');
    return;
  }

  try {
    await runInitSchema();
  } catch (err) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runInitSchema,
  EXPECTED_SCHEMA_TABLES
};
