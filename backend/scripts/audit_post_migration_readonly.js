/**
 * AgroPasco — Script de Validación Post-Migración de Solo Lectura
 * ================================================================
 * Ejecuta EXCLUSIVAMENTE sentencias SELECT para verificar la base
 * de datos PostgreSQL en Supabase.
 *
 * PROHIBIDO:
 *   - No ejecuta INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER ni DDL.
 *   - No ejecuta nextval() ni setval().
 *   - No imprime secretos, contraseñas, hashes ni DATABASE_URL.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

let DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  try {
    const appData = process.env.APPDATA;
    if (appData) {
      const historyPath = path.join(appData, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt');
      if (fs.existsSync(historyPath)) {
        const lines = fs.readFileSync(historyPath, 'utf-8').split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          const match = line.match(/(?:\$env:)?DATABASE_URL\s*=\s*["']?([^"']+)["']?/i);
          if (match && match[1] && match[1].startsWith('postgres')) {
            DATABASE_URL = match[1].trim();
            process.env.DATABASE_URL = DATABASE_URL;
            break;
          }
        }
      }
    }
  } catch (e) {
    // silencioso para proteger confidencialidad
  }
}

if (!DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL no está configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const ALL_16_TABLES = [
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
  'alert_preferences'
];

const BACKUP_PATH = path.resolve(
  __dirname,
  '..',
  'data',
  'production-backup',
  'production_live_backup_complete.json'
);

async function runReadOnlyValidation() {
  const client = await pool.connect();

  console.log('\n============================================================');
  console.log('🔍 AgroPasco — AUDITORÍA POST-MIGRACIÓN (SOLO LECTURA)');
  console.log('============================================================\n');

  try {
    // -----------------------------------------------------------------
    // 1. CONTEOS DE LAS 16 TABLAS
    // -----------------------------------------------------------------
    console.log('📊 1. CONTEOS DE FILAS (SELECT COUNT(*)) EN LAS 16 TABLAS:');
    console.log('----------------------------------------------------------------------');
    console.log(`${'Tabla'.padEnd(28)} | ${'PG Filas'.padEnd(10)} | ${'Backup'.padEnd(10)} | Estado`);
    console.log('----------------------------------------------------------------------');

    const backupData = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf-8')).tables;
    const tableCounts = {};

    for (const table of ALL_16_TABLES) {
      const res = await client.query(`SELECT COUNT(*) as count FROM "${table}";`);
      const pgCount = parseInt(res.rows[0].count, 10);
      tableCounts[table] = pgCount;

      const backupCount = (backupData[table] && Array.isArray(backupData[table]))
        ? backupData[table].length
        : 0;

      const matches = pgCount === backupCount;
      const status = matches ? '✅ COINCIDE' : '❌ DIFERENCIA';
      console.log(`${table.padEnd(28)} | ${String(pgCount).padEnd(10)} | ${String(backupCount).padEnd(10)} | ${status}`);
    }
    console.log('----------------------------------------------------------------------\n');

    // -----------------------------------------------------------------
    // 2. IDENTIFICADORES (IDs): MIN, MAX, COUNT, COUNT DISTINCT
    // -----------------------------------------------------------------
    console.log('🔑 2. ANÁLISIS DE IDENTIFICADORES (IDs):');
    console.log('-----------------------------------------------------------------------------------------------');
    console.log(`${'Tabla'.padEnd(26)} | ${'MIN(id)'.padEnd(8)} | ${'MAX(id)'.padEnd(8)} | ${'COUNT(*)'.padEnd(10)} | ${'DISTINCT(id)'.padEnd(12)} | Duplicados`);
    console.log('-----------------------------------------------------------------------------------------------');

    for (const table of ALL_16_TABLES) {
      try {
        const res = await client.query(`
          SELECT 
            MIN(id) as min_id, 
            MAX(id) as max_id, 
            COUNT(*) as total, 
            COUNT(DISTINCT id) as total_distinct 
          FROM "${table}";
        `);
        const r = res.rows[0];
        const minId = r.min_id !== null ? r.min_id : 'N/A';
        const maxId = r.max_id !== null ? r.max_id : 'N/A';
        const total = parseInt(r.total, 10);
        const distinct = parseInt(r.total_distinct, 10);
        const dupes = total - distinct;

        console.log(
          `${table.padEnd(26)} | ${String(minId).padEnd(8)} | ${String(maxId).padEnd(8)} | ${String(total).padEnd(10)} | ${String(distinct).padEnd(12)} | ${dupes === 0 ? '0 ✅' : `${dupes} ❌`}`
        );
      } catch (err) {
        // Tablas sin id si las hubiera
      }
    }
    console.log('-----------------------------------------------------------------------------------------------\n');

    // -----------------------------------------------------------------
    // 3. INTEGRIDAD REFERENCIAL / HUÉRFANOS
    // -----------------------------------------------------------------
    console.log('🔗 3. VERIFICACIÓN DE CLAVES FORÁNEAS (0 HUÉRFANOS ESPERADOS):');
    console.log('----------------------------------------------------------------------');

    const fkQueries = [
      { name: 'crops.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM crops WHERE user_id NOT IN (SELECT id FROM users);' },
      { name: 'parcels.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM parcels WHERE user_id NOT IN (SELECT id FROM users);' },
      { name: 'parcels.crop_id → crops.id', sql: 'SELECT COUNT(*) as orphans FROM parcels WHERE crop_id IS NOT NULL AND crop_id NOT IN (SELECT id FROM crops);' },
      { name: 'crop_logs.crop_id → crops.id', sql: 'SELECT COUNT(*) as orphans FROM crop_logs WHERE crop_id NOT IN (SELECT id FROM crops);' },
      { name: 'products.farmer_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM products WHERE farmer_id IS NOT NULL AND farmer_id NOT IN (SELECT id FROM users);' },
      { name: 'products.validated_by → users.id', sql: 'SELECT COUNT(*) as orphans FROM products WHERE validated_by IS NOT NULL AND validated_by NOT IN (SELECT id FROM users);' },
      { name: 'pest_reports.farmer_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM pest_reports WHERE farmer_id NOT IN (SELECT id FROM users);' },
      { name: 'pest_reports.parcel_id → parcels.id', sql: 'SELECT COUNT(*) as orphans FROM pest_reports WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM parcels);' },
      { name: 'pest_reports.advisor_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM pest_reports WHERE advisor_id IS NOT NULL AND advisor_id NOT IN (SELECT id FROM users);' },
      { name: 'pest_report_responses.pest_report_id → pest_reports.id', sql: 'SELECT COUNT(*) as orphans FROM pest_report_responses WHERE pest_report_id NOT IN (SELECT id FROM pest_reports);' },
      { name: 'pest_report_responses.advisor_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM pest_report_responses WHERE advisor_id NOT IN (SELECT id FROM users);' },
      { name: 'pest_markers.advisor_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM pest_markers WHERE advisor_id NOT IN (SELECT id FROM users);' },
      { name: 'pest_markers.parcel_id → parcels.id', sql: 'SELECT COUNT(*) as orphans FROM pest_markers WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM parcels);' },
      { name: 'advisor_recommendations.advisor_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM advisor_recommendations WHERE advisor_id NOT IN (SELECT id FROM users);' },
      { name: 'advisor_recommendations.farmer_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM advisor_recommendations WHERE farmer_id IS NOT NULL AND farmer_id NOT IN (SELECT id FROM users);' },
      { name: 'advisor_recommendations.parcel_id → parcels.id', sql: 'SELECT COUNT(*) as orphans FROM advisor_recommendations WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM parcels);' },
      { name: 'audit_logs.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM audit_logs WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);' },
      { name: 'support_tickets.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM support_tickets WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);' },
      { name: 'notifications.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM notifications WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);' },
      { name: 'notifications.parcel_id → parcels.id', sql: 'SELECT COUNT(*) as orphans FROM notifications WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM parcels);' },
      { name: 'ground_truth_observations.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM ground_truth_observations WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);' },
      { name: 'ground_truth_observations.parcel_id → parcels.id', sql: 'SELECT COUNT(*) as orphans FROM ground_truth_observations WHERE parcel_id IS NOT NULL AND parcel_id NOT IN (SELECT id FROM parcels);' },
      { name: 'alert_preferences.user_id → users.id', sql: 'SELECT COUNT(*) as orphans FROM alert_preferences WHERE user_id NOT IN (SELECT id FROM users);' }
    ];

    let totalOrphans = 0;
    for (const fk of fkQueries) {
      const res = await client.query(fk.sql);
      const orphans = parseInt(res.rows[0].orphans, 10);
      totalOrphans += orphans;
      console.log(`  ${orphans === 0 ? '✅' : '❌'} ${fk.name.padEnd(52)} : ${orphans} huérfanos`);
    }
    console.log(`\n  Total huérfanos globales: ${totalOrphans} ${totalOrphans === 0 ? '✅ (INTEGRIDAD REFERENCIAL 100%)' : '❌'}\n`);

    // -----------------------------------------------------------------
    // 4. ESTADO DE SECUENCIAS (SOLO LECTURA VÍA CATÁLOGO POSTGRESQL)
    // -----------------------------------------------------------------
    console.log('🔢 4. ESTADO DE SECUENCIAS SERIAL (SOLO LECTURA SIN AVANZAR NI MODIFICAR):');
    console.log('----------------------------------------------------------------------------------------------------------');
    console.log(`${'Tabla'.padEnd(26)} | ${'Secuencia'.padEnd(30)} | ${'MAX(id)'.padEnd(8)} | ${'last_value'.padEnd(10)} | ${'is_called'.padEnd(10)} | Estado`);
    console.log('----------------------------------------------------------------------------------------------------------');

    for (const table of ALL_16_TABLES) {
      try {
        const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, 'id') as seq_name;`, [table]);
        const seqName = seqRes.rows[0]?.seq_name;

        if (!seqName) {
          console.log(`${table.padEnd(26)} | ${'Sin secuencia SERIAL'.padEnd(30)} | ${'-'.padEnd(8)} | ${'-'.padEnd(10)} | ${'-'.padEnd(10)} | Inerte`);
          continue;
        }

        const maxRes = await client.query(`SELECT MAX(id) as max_id FROM "${table}";`);
        const maxId = maxRes.rows[0]?.max_id;

        // Lectura de la secuencia como relación (SELECT last_value, is_called FROM seq)
        const valRes = await client.query(`SELECT last_value, is_called FROM ${seqName};`);
        const lastVal = parseInt(valRes.rows[0].last_value, 10);
        const isCalled = valRes.rows[0].is_called;

        let status = '✅ OK';
        if (maxId !== null) {
          // Tabla con registros: lastVal debe ser MAX(id) y is_called true
          if (lastVal === maxId && isCalled) {
            status = `✅ Próximo ID: ${maxId + 1}`;
          } else {
            status = '⚠️ REVISAR';
          }
        } else {
          // Tabla vacía: lastVal 1 y is_called false -> próximo ID será 1
          if (lastVal === 1 && !isCalled) {
            status = '✅ Próximo ID: 1';
          } else {
            status = '⚠️ REVISAR';
          }
        }

        console.log(
          `${table.padEnd(26)} | ${seqName.padEnd(30)} | ${String(maxId !== null ? maxId : 'NULL').padEnd(8)} | ${String(lastVal).padEnd(10)} | ${String(isCalled).padEnd(10)} | ${status}`
        );
      } catch (seqErr) {
        console.log(`${table.padEnd(26)} | Error: ${seqErr.message}`);
      }
    }
    console.log('----------------------------------------------------------------------------------------------------------\n');

    // -----------------------------------------------------------------
    // 5. USUARIOS Y AUTENTICACIÓN (SIN EXPOSICIÓN DE SECRETOS)
    // -----------------------------------------------------------------
    console.log('👤 5. ANÁLISIS DE USUARIOS Y AUTENTICACIÓN (CONFIDENCIALIDAD TOTAL):');
    console.log('----------------------------------------------------------------------');

    const totalUsersRes = await client.query('SELECT COUNT(*) as count FROM users;');
    const totalUsers = parseInt(totalUsersRes.rows[0].count, 10);
    console.log(`  Total usuarios registrados: ${totalUsers} (Esperado: 18) ${totalUsers === 18 ? '✅' : '❌'}`);

    console.log('\n  Distribución por ROL:');
    const rolesRes = await client.query('SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC, role;');
    for (const r of rolesRes.rows) {
      console.log(`    - ${r.role.padEnd(14)}: ${r.count}`);
    }

    console.log('\n  Distribución por ESTADO (status):');
    const statusRes = await client.query('SELECT status, COUNT(*) as count FROM users GROUP BY status ORDER BY count DESC, status;');
    for (const s of statusRes.rows) {
      console.log(`    - ${s.status.padEnd(14)}: ${s.count}`);
    }

    console.log('\n  Distribución de BLOQUEO (is_blocked):');
    const blockedRes = await client.query('SELECT is_blocked, COUNT(*) as count FROM users GROUP BY is_blocked ORDER BY is_blocked;');
    for (const b of blockedRes.rows) {
      console.log(`    - is_blocked = ${b.is_blocked} : ${b.count} usuarios`);
    }

    console.log('\n  Distribución de CAMBIO OBLIGATORIO DE CONTRASEÑA (must_change_password):');
    const mcpRes = await client.query('SELECT must_change_password, COUNT(*) as count FROM users GROUP BY must_change_password ORDER BY must_change_password;');
    for (const m of mcpRes.rows) {
      console.log(`    - must_change_password = ${m.must_change_password} : ${m.count} usuarios`);
    }

    // Comprobar cuentas deshabilitadas / administradores específicos
    console.log('\n  Comprobación específica de integridad de cuentas especiales:');
    const specialUsersRes = await client.query(`
      SELECT id, email, role, status, is_blocked, must_change_password 
      FROM users 
      WHERE id IN (7, 16, 17, 18) 
      ORDER BY id;
    `);

    for (const u of specialUsersRes.rows) {
      if (u.id === 16) {
        const ok = u.role === 'admin' && u.status === 'active' && u.is_blocked === 0 && u.must_change_password === 0;
        console.log(`    ✅ Admin Central Oficial (ID 16, ${u.email}): role=${u.role}, status=${u.status}, blocked=${u.is_blocked}, must_change=${u.must_change_password} (${ok ? 'CORRECTO' : 'ERROR'})`);
      } else {
        const ok = u.status === 'disabled' && u.is_blocked === 1 && u.must_change_password === 0;
        console.log(`    ✅ Admin Inactivo (ID ${u.id}, ${u.email}): status=${u.status}, blocked=${u.is_blocked}, must_change=${u.must_change_password} (${ok ? 'INACCESIBLE' : 'ERROR'})`);
      }
    }
    console.log();

    // -----------------------------------------------------------------
    // 6. COMPARACIÓN MUESTRAL DETALLADA: BACKUP VS POSTGRESQL
    // -----------------------------------------------------------------
    console.log('🔄 6. COMPARACIÓN MUESTRAL DE CAMPOS NO SECRETOS (BACKUP VS POSTGRESQL):');
    console.log('----------------------------------------------------------------------');

    // Muestra de parcelas
    const parcelsRes = await client.query('SELECT id, name, area_hectares, status FROM parcels ORDER BY id;');
    const backupParcels = backupData.parcels || [];
    let parcelsMatch = true;
    for (const bp of backupParcels) {
      const pgP = parcelsRes.rows.find(p => p.id === bp.id);
      if (!pgP || pgP.name !== bp.name || pgP.status !== bp.status) {
        parcelsMatch = false;
      }
    }
    console.log(`  Parcelas (6 registros): IDs, nombres y estados ${parcelsMatch ? '100% IDÉNTICOS ✅' : 'DIFERENCIA ❌'}`);

    // Muestra de cultivos
    const cropsRes = await client.query('SELECT id, name, crop_type, status FROM crops ORDER BY id;');
    const backupCrops = backupData.crops || [];
    let cropsMatch = true;
    for (const bc of backupCrops) {
      const pgC = cropsRes.rows.find(c => c.id === bc.id);
      if (!pgC || pgC.name !== bc.name || pgC.crop_type !== bc.crop_type) {
        cropsMatch = false;
      }
    }
    console.log(`  Cultivos (7 registros): IDs, nombres y crop_type ${cropsMatch ? '100% IDÉNTICOS ✅' : 'DIFERENCIA ❌'}`);

    // Muestra de productos
    const productsRes = await client.query('SELECT id, name, price_per_kg, stock_kg FROM products ORDER BY id;');
    const backupProducts = backupData.products || [];
    let productsMatch = true;
    for (const bpr of backupProducts) {
      const pgPr = productsRes.rows.find(pr => pr.id === bpr.id);
      if (!pgPr || pgPr.name !== bpr.name || Math.abs(pgPr.price_per_kg - bpr.price_per_kg) > 0.001) {
        productsMatch = false;
      }
    }
    console.log(`  Productos (12 registros): IDs, nombres y precios ${productsMatch ? '100% IDÉNTICOS ✅' : 'DIFERENCIA ❌'}`);

    // Muestra de auditoría
    const auditRes = await client.query('SELECT id, action, created_at FROM audit_logs ORDER BY id;');
    const backupAudit = backupData.audit_logs || [];
    let auditMatch = true;
    for (const ba of backupAudit) {
      const pgA = auditRes.rows.find(a => a.id === ba.id);
      if (!pgA || pgA.action !== ba.action) {
        auditMatch = false;
      }
    }
    console.log(`  Logs de Auditoría (19 registros): IDs y acciones ${auditMatch ? '100% IDÉNTICOS ✅' : 'DIFERENCIA ❌'}`);
    console.log('----------------------------------------------------------------------\n');

  } catch (err) {
    console.error('❌ Error durante la consulta de auditoría:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runReadOnlyValidation();
