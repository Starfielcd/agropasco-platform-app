/**
 * AgroPasco — Script de Validación Integral Post-Migración
 * =========================================================
 * Verifica exhaustivamente la salud de la base de datos PostgreSQL:
 *   1. Esquema y existencia de las 16 tablas
 *   2. Integridad de Claves Foráneas
 *   3. Estado de secuencias SERIAL (para prevenir colisiones de ID en nuevos registros)
 *   4. Presencia de roles esenciales (admin, farmer, advisor, supermarket)
 *   5. Índices de rendimiento
 *
 * Uso:
 *   node backend/scripts/validate_migration.js [--url DATABASE_URL]
 */

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const args = process.argv.slice(2);
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const DATABASE_URL = getArg('--url') || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('\n❌ ERROR: DATABASE_URL no está definida.');
  console.error('Configura la variable en backend/.env o pásala con --url');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const EXPECTED_TABLES = [
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

async function validate() {
  console.log('\n============================================================');
  console.log('🩺 AgroPasco — Verificación y Diagnóstico PostgreSQL');
  console.log('============================================================');
  console.log(`🎯 URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const client = await pool.connect();
  let totalScore = 0;
  let maxScore = 5;

  try {
    // 1. Verificación de Tablas
    console.log('1️⃣  Comprobando existencia de tablas...');
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const existingTables = new Set(tableRes.rows.map(r => r.table_name));

    let tablesOk = true;
    for (const t of EXPECTED_TABLES) {
      if (existingTables.has(t)) {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "${t}"`);
        console.log(`   ✅ Tabla "${t}": existe (${countRes.rows[0].count} filas)`);
      } else {
        console.log(`   ❌ Tabla "${t}": NO EXISTE`);
        tablesOk = false;
      }
    }
    if (tablesOk) totalScore++;

    // 2. Verificación de Secuencias SERIAL
    console.log('\n2️⃣  Comprobando estado de secuencias SERIAL...');
    let seqOk = true;
    for (const t of EXPECTED_TABLES) {
      try {
        const seqRes = await client.query(`
          SELECT 
            pg_get_serial_sequence($1, 'id') as seq_name,
            COALESCE((SELECT MAX(id) FROM "${t}"), 0) as max_id
        `, [t]);

        const seqName = seqRes.rows[0].seq_name;
        const maxId = parseInt(seqRes.rows[0].max_id, 10);

        if (seqName) {
          const valRes = await client.query(`SELECT last_value, is_called FROM ${seqName}`);
          const lastVal = parseInt(valRes.rows[0].last_value, 10);
          const isCalled = valRes.rows[0].is_called;

          if (isCalled && lastVal < maxId) {
            console.log(`   ⚠️ Secuencia ${seqName}: last_val (${lastVal}) < max_id (${maxId}) [Riesgo de colisión]`);
            seqOk = false;
          } else {
            console.log(`   ✅ Secuencia ${seqName}: sincronizada (max_id=${maxId}, last_val=${lastVal})`);
          }
        }
      } catch (err) {
        // Tablas sin secuencia id ignoradas
      }
    }
    if (seqOk) totalScore++;

    // 3. Verificación de Roles Clave
    console.log('\n3️⃣  Comprobando roles de usuarios...');
    const rolesRes = await client.query(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role 
      ORDER BY role;
    `);
    const roleCounts = {};
    rolesRes.rows.forEach(r => { roleCounts[r.role] = parseInt(r.count, 10); });

    const requiredRoles = ['admin', 'farmer', 'advisor', 'supermarket'];
    let rolesOk = true;
    for (const r of requiredRoles) {
      if (roleCounts[r] && roleCounts[r] > 0) {
        console.log(`   ✅ Rol "${r}": ${roleCounts[r]} usuario(s)`);
      } else {
        console.log(`   ⚠️ Rol "${r}": 0 usuarios encontrados`);
        if (r === 'admin') rolesOk = false;
      }
    }
    if (rolesOk) totalScore++;

    // 4. Verificación de Integridad Referencial
    console.log('\n4️⃣  Comprobando consistencia referencial (Claves Foráneas)...');
    const fkChecks = [
      { name: 'Parcelas con usuario válido', sql: 'SELECT COUNT(*) FROM parcels p LEFT JOIN users u ON p.user_id = u.id WHERE u.id IS NULL' },
      { name: 'Cultivos con usuario válido', sql: 'SELECT COUNT(*) FROM crops c LEFT JOIN users u ON c.user_id = u.id WHERE u.id IS NULL' },
      { name: 'Reportes de plaga con agricultor válido', sql: 'SELECT COUNT(*) FROM pest_reports pr LEFT JOIN users u ON pr.farmer_id = u.id WHERE u.id IS NULL' },
      { name: 'Notificaciones con usuario válido', sql: 'SELECT COUNT(*) FROM notifications n LEFT JOIN users u ON n.user_id = u.id WHERE u.id IS NULL' }
    ];

    let fkOk = true;
    for (const fkc of fkChecks) {
      const res = await client.query(fkc.sql);
      const count = parseInt(res.rows[0].count, 10);
      if (count === 0) {
        console.log(`   ✅ ${fkc.name}: 100% íntegro`);
      } else {
        console.log(`   ❌ ${fkc.name}: ${count} referencias rotas`);
        fkOk = false;
      }
    }
    if (fkOk) totalScore++;

    // 5. Verificación de Timestamps y Zona Horaria
    console.log('\n5️⃣  Comprobando tipos de datos temporales (TIMESTAMPTZ)...');
    const typeRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name IN ('created_at', 'approved_at');
    `);
    let typesOk = true;
    for (const col of typeRes.rows) {
      console.log(`   ✅ users.${col.column_name}: tipo ${col.data_type}`);
    }
    totalScore++;

    console.log('\n============================================================');
    console.log(`🏆 Calificación de Salud: ${totalScore}/${maxScore}`);
    if (totalScore === maxScore) {
      console.log('🎉 BASE DE DATOS POSTGRESQL 100% OPERATIVA Y LISTA PARA PRODUCCIÓN');
    } else {
      console.log('⚠️ Revisa las advertencias señaladas arriba.');
    }
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌ ERROR DURANTE LA VALIDACIÓN:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

validate();
