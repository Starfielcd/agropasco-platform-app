/**
 * AgroPasco Digital — Suite de Integración Real PostgreSQL (Fase 9-L10A / L10A.1)
 * ==============================================================================
 * VALIDACIÓN REAL DE POSTGRESQL, TRANSACCIONES, AUDITORÍA DURABLE Y LÍMITES DE INTEGRACIÓN
 *
 * Responsabilidades:
 *  1. Comprobar disponibilidad de base de datos PostgreSQL local y aislada de pruebas.
 *  2. Si no hay TEST_DATABASE_URL externa, habilitar de forma segura una instancia efímera
 *     en Windows en puerto 55432 bajo directorio temporal con credenciales desechables.
 *  3. PROHIBICIÓN ESTRICTA: Jamás utilizar DATABASE_URL productiva como fallback.
 *  4. Ejecución de 10 pruebas reales sobre motor PostgreSQL físico:
 *     - DDL de migración real tras asegurar tablas padre users y parcels.
 *     - Índices especializados en pg_indexes.
 *     - Triggers nativos PL/pgSQL activos en information_schema.
 *     - Parámetros nativos seguros.
 *     - Claves foráneas users(id) reales.
 *     - Transacciones ACID (COMMIT y ROLLBACK garantizados).
 *     - Concurrencia pesimista real: bloqueo SELECT ... FOR UPDATE con 2 clientes.
 *     - Trigger append-only rechaza UPDATE y DELETE reales en historial.
 *     - Retirada y sustitución documental con integridad FK y CHECKs.
 *     - Validación de usuarios activos y persistencia física tras reconexión.
 *  5. Limpieza segura: detención exclusiva con pg_ctl stop y eliminación del directorio temporal.
 * ==============================================================================
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const assert = require('assert');

const repoRoot = path.resolve(__dirname, '..');
const { Pool } = require(path.join(repoRoot, 'node_modules/pg'));
const { verifyActiveUserStatus } = require(path.join(repoRoot, 'services/userStatusService'));

const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DEFAULT_EPHEMERAL_PORT = 55432;

// Verificación estricta de variables de entorno para evitar ejecución accidental sobre producción
function getIsolatedTestDatabaseUrl() {
  const testUrl = process.env.TEST_POSTGRES_URL || process.env.TEST_DATABASE_URL;

  if (testUrl) {
    if (testUrl.includes('supabase.co') || testUrl.includes('render.com') || testUrl.includes('pooler.supabase')) {
      console.error('\n❌ ERROR CRÍTICO DE SEGURIDAD: La URL de pruebas apunta a infraestructura remota (Supabase/Render).');
      console.error('   Las pruebas de integración deben ejecutarse exclusivamente sobre PostgreSQL local/aislado.');
      process.exit(1);
    }
    return testUrl;
  }

  return null;
}

// Orquestador seguro de instancia efímera local si no hay URL externa
class EphemeralPostgresManager {
  constructor(port = DEFAULT_EPHEMERAL_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_pg_temp_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'postgres_server.log');
    this.started = false;
  }

  isAvailable() {
    return fs.existsSync(path.join(pgBin, 'initdb.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_ctl.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_isready.exe'));
  }

  start() {
    console.log(`[EPHEMERAL_PG] Creando clúster temporal en: ${this.tempDir}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    // 1. initdb
    execSync(`"${path.join(pgBin, 'initdb.exe')}" -D "${this.tempDir}" -U postgres -A trust --no-locale -E UTF8`, {
      stdio: 'ignore'
    });

    // 2. pg_ctl start (usar ignore para evitar herencia de tuberías abiertas por postgres.exe)
    execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -o "-p ${this.port} -h 127.0.0.1" -l "${this.logFile}" start`, {
      stdio: 'ignore'
    });
    this.started = true;

    // 3. Esperar a que pg_isready responda
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        execSync(`"${path.join(pgBin, 'pg_isready.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres`, { stdio: 'ignore' });
        ready = true;
        break;
      } catch (_) {
        execSync('ping 127.0.0.1 -n 1 > nul', { shell: true });
      }
    }
    if (!ready) {
      throw new Error(`Instancia PostgreSQL temporal en puerto ${this.port} no estuvo lista.`);
    }

    // 4. createdb
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres agropasco_test_l10a`, {
      stdio: 'ignore'
    });

    console.log(`[EPHEMERAL_PG] ✓ Servidor temporal iniciado y base "agropasco_test_l10a" creada en 127.0.0.1:${this.port}\n`);
    return `postgresql://postgres@127.0.0.1:${this.port}/agropasco_test_l10a`;
  }

  stop() {
    if (this.started) {
      try {
        execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -m fast stop`, { stdio: 'ignore' });
        console.log(`[EPHEMERAL_PG] ✓ Servidor temporal en puerto ${this.port} detenido.`);
      } catch (err) {
        console.warn(`[EPHEMERAL_PG] Advertencia al detener servidor: ${err.message}`);
      }
    }
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log(`[EPHEMERAL_PG] ✓ Carpeta temporal eliminada.`);
      }
    } catch (_) {}
  }
}

async function runPhytosanitaryPostgresIntegrationL10ASuite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE INTEGRACIÓN POSTGRESQL REAL (FASE 9-L10A / L10A.1)');
  console.log('VALIDACIÓN DE MOTOR FÍSICO, TRANSACCIONES ACID Y AUDITORÍA DURABLE');
  console.log('==============================================================================\n');

  let testDbUrl = getIsolatedTestDatabaseUrl();
  let ephemeralManager = null;

  // Si no hay URL configurada externamente, intentar levantar instancia efímera segura
  if (!testDbUrl) {
    ephemeralManager = new EphemeralPostgresManager(DEFAULT_EPHEMERAL_PORT);
    if (ephemeralManager.isAvailable()) {
      try {
        testDbUrl = ephemeralManager.start();
      } catch (err) {
        console.warn(`⚠️ No se pudo iniciar clúster efímero: ${err.message}`);
        ephemeralManager.stop();
        ephemeralManager = null;
        testDbUrl = null;
      }
    }
  }

  let pool = null;
  let isConnected = false;

  if (testDbUrl) {
    try {
      pool = new Pool({
        connectionString: testDbUrl,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 5000
      });
      const client = await pool.connect();
      client.release();
      isConnected = true;
    } catch (err) {
      console.warn(`⚠️ Intento de conexión a base de datos de pruebas falló: ${err.message}`);
      isConnected = false;
    }
  }

  // Si no hay entorno aislado disponible
  if (!isConnected) {
    console.log('------------------------------------------------------------------------------');
    console.log('[POSTGRESQL_INTEGRATION_BLOCKED]');
    console.log('No se dispone de un motor PostgreSQL local/aislado de pruebas accesible.');
    console.log('Docker no está instalado en el host y no fue posible iniciar una instancia temporal.');
    console.log('Prohibido utilizar DATABASE_URL de producción como sustituto.');
    console.log('------------------------------------------------------------------------------');
    console.log('\nESTADO DE COMPROBACIONES DE INTEGRACIÓN POSTGRESQL REAL:');
    console.log('  [OMITIDA] [TEST 01] Creación y validación de tablas e integridad de esquema (DDL) -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 02] Creación de índices especializados (GIN, compuestos)         -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 03] Activación de trigger append-only nativo PL/pgSQL           -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 04] Inserción de aviso con parámetros SQL en motor físico        -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 05] Inserción de revisión agronómica vinculada a users real     -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 06] Transacciones ACID: COMMIT exitoso y ROLLBACK garantizado    -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 07] Concurrencia real: bloqueo SELECT FOR UPDATE entre clientes  -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 08] Trigger append-only rechaza UPDATE y DELETE reales          -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 09] Retirada y sustitución documental con integridad FK         -> NO EJECUTADA');
    console.log('  [OMITIDA] [TEST 10] Validación de usuarios activos y persistencia tras reconexión-> NO EJECUTADA');
    console.log('\n==============================================================================');
    console.log('FASE 9-L10A.1: 0 APROBADAS | 0 FALLIDAS | 10 OMITIDAS (POSTGRESQL_UNAVAILABLE)');
    console.log('ESTADO: POSTGRESQL_INTEGRATION_BLOCKED (OMISIÓN DOCUMENTADA SEGÚN SECCIÓN 3 Y 10)');
    console.log('==============================================================================\n');
    return {
      status: 'POSTGRESQL_INTEGRATION_BLOCKED',
      passed: 0,
      failed: 0,
      omitted: 10
    };
  }

  // Si existe conexión real de prueba, ejecutar las 10 comprobaciones reales
  console.log(`✓ Ejecutando pruebas contra base de datos aislada: ${testDbUrl}\n`);
  let passedCount = 0;

  try {
    // 0. Pre-requisitos: Asegurar tablas padre users y parcels requeridas por las claves foráneas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        email VARCHAR(128) UNIQUE NOT NULL,
        password_hash VARCHAR(256) NOT NULL,
        role VARCHAR(32) NOT NULL,
        status VARCHAR(32) DEFAULT 'active',
        is_blocked INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS parcels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(128) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const migrationPath = path.join(__dirname, '../data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
    const ddl = fs.readFileSync(migrationPath, 'utf8');

    // TEST 01: Aplicación DDL
    await pool.query(ddl);
    console.log('  ✓ [TEST 01] DDL aplicado exitosamente: tablas creadas en PostgreSQL real');
    passedCount++;

    // TEST 02: Índices
    const resIdx = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'phytosanitary_notices';
    `);
    assert(resIdx.rows.length >= 5);
    console.log('  ✓ [TEST 02] Índices verificados en catálogo pg_indexes');
    passedCount++;

    // TEST 03: Triggers
    const resTrg = await pool.query(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table = 'phytosanitary_notice_history';
    `);
    assert(resTrg.rows.some(r => r.trigger_name === 'trg_protect_phyto_history'));
    console.log('  ✓ [TEST 03] Trigger trg_protect_phyto_history activo en motor PostgreSQL');
    passedCount++;

    // TEST 04: Inserción de aviso con datos válidos
    const testNoticeId = `SENASA-REAL-${Date.now()}`;
    await pool.query(`
      INSERT INTO phytosanitary_notices (
        id, source_institution, official_title, notice_type, geographical_scope,
        geographical_scope_type, issue_date, recommended_public_action, provenance,
        verification_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `, [
      testNoticeId, 'SENASA', 'Aviso real en motor PG', 'alerta',
      JSON.stringify({ department: 'PASCO' }), 'departamental', '2024-07-25',
      'Acción preventiva', JSON.stringify({ source: 'oficial' }),
      'review_required'
    ]);
    console.log('  ✓ [TEST 04] Inserción de aviso completada con parámetros nativos');
    passedCount++;

    // TEST 05: Inserción de revisión técnica
    // Crear usuarios de prueba en users
    await pool.query(`
      INSERT INTO users (id, name, email, password_hash, role, status, is_blocked) VALUES
        (901, 'Asesor Test Real', 'asesor.real@test.pe', 'hash', 'advisor', 'active', 0),
        (902, 'Admin Test Real', 'admin.real@test.pe', 'hash', 'admin', 'active', 0),
        (903, 'Admin Bloqueado', 'admin.blocked@test.pe', 'hash', 'admin', 'active', 1),
        (904, 'Admin Inactivo', 'admin.inactive@test.pe', 'hash', 'admin', 'inactive', 0)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, is_blocked = EXCLUDED.is_blocked;
    `);
    await pool.query(`
      INSERT INTO phytosanitary_technical_reviews (
        notice_id, reviewer_user_id, reviewer_name, reviewer_role, observations,
        recommended_status, review_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7);
    `, [testNoticeId, 901, 'Asesor Test Real', 'advisor', 'Revisión técnica agronómica en terreno', 'review_required', 1]);
    console.log('  ✓ [TEST 05] Revisión técnica registrada con foreign key users(id)');
    passedCount++;

    // TEST 06: Transacciones ACID: ROLLBACK y COMMIT
    // 6a. Probar ROLLBACK ante error en transacción
    const clientRollback = await pool.connect();
    try {
      await clientRollback.query('BEGIN');
      await clientRollback.query(`
        INSERT INTO phytosanitary_notices (
          id, source_institution, official_title, notice_type, geographical_scope,
          geographical_scope_type, issue_date, recommended_public_action, provenance
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `, ['TEMP-NOTICE-ROLLBACK', 'SENASA', 'Aviso a descartar', 'alerta', '{}', 'nacional', '2024-07-25', 'Acción', '{}']);
      // Forzar ROLLBACK explícito
      await clientRollback.query('ROLLBACK');
    } finally {
      clientRollback.release();
    }
    const checkRollback = await pool.query('SELECT id FROM phytosanitary_notices WHERE id = $1', ['TEMP-NOTICE-ROLLBACK']);
    assert.strictEqual(checkRollback.rows.length, 0, 'La fila insertada en transacción descartada no debe persistir');

    // 6b. Probar COMMIT atómico de aprobación y evento de auditoría
    const clientCommit = await pool.connect();
    try {
      await clientCommit.query('BEGIN');
      await clientCommit.query('SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE', [testNoticeId]);
      await clientCommit.query(`
        UPDATE phytosanitary_notices SET
          verification_status = 'approved',
          approved_by_user_id = 902,
          approved_by_name = 'Admin Test Real',
          approved_at = NOW(),
          verification_evidence = '{"url":"https://senasa.gob.pe/exp.pdf"}'::jsonb,
          version = version + 1
        WHERE id = $1;
      `, [testNoticeId]);
      await clientCommit.query(`
        INSERT INTO phytosanitary_notice_history (
          event_id, notice_id, from_status, to_status, previous_status, new_status,
          actor_user_id, actor_role, action, reason, record_version, correlation_id
        ) VALUES ($1, $2, 'review_required', 'approved', 'review_required', 'approved', 902, 'admin', 'NOTICE_APPROVED', 'Aprobado formal', 2, 'CORR-1');
      `, [`EVT-REAL-${Date.now()}`, testNoticeId]);
      await clientCommit.query('COMMIT');
    } finally {
      clientCommit.release();
    }
    const checkCommit = await pool.query('SELECT verification_status, version FROM phytosanitary_notices WHERE id = $1', [testNoticeId]);
    assert.strictEqual(checkCommit.rows[0].verification_status, 'approved');
    assert.strictEqual(checkCommit.rows[0].version, 2);
    console.log('  ✓ [TEST 06] Transacciones ACID verificadas: ROLLBACK limpio y COMMIT atómico');
    passedCount++;

    // TEST 07: Concurrencia pesimista con 2 conexiones simultáneas (SELECT FOR UPDATE)
    const connA = await pool.connect();
    const connB = await pool.connect();
    try {
      await connA.query('BEGIN');
      await connA.query('SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE', [testNoticeId]);

      // connB debe quedar bloqueada temporalmente hasta que connA termine
      let connBCompleted = false;
      const bPromise = connB.query('SELECT * FROM phytosanitary_notices WHERE id = $1 FOR UPDATE', [testNoticeId])
        .then(() => { connBCompleted = true; });

      // Verificar que connB no completó instantáneamente mientras connA retiene el bloqueo
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.strictEqual(connBCompleted, false, 'Bloqueo pesimista FOR UPDATE debe retener a la segunda conexión');

      await connA.query('COMMIT');
      await bPromise;
      await connB.query('ROLLBACK');
      console.log('  ✓ [TEST 07] Concurrencia real: SELECT ... FOR UPDATE bloqueó efectivamente la segunda conexión');
      passedCount++;
    } finally {
      connA.release();
      connB.release();
    }

    // TEST 08: Trigger append-only bloquea UPDATE y DELETE
    await assert.rejects(async () => {
      await pool.query(`UPDATE phytosanitary_notice_history SET reason = 'Modificado' WHERE notice_id = $1`, [testNoticeId]);
    }, /El historial de auditoría fitosanitaria es append-only e inmutable/);
    await assert.rejects(async () => {
      await pool.query(`DELETE FROM phytosanitary_notice_history WHERE notice_id = $1`, [testNoticeId]);
    }, /El historial de auditoría fitosanitaria es append-only e inmutable/);
    console.log('  ✓ [TEST 08] Trigger append-only nativo PL/pgSQL rechazó UPDATE y DELETE');
    passedCount++;

    // TEST 09: Retirada de aviso y sustitución
    const subNoticeId = `SENASA-SUB-${Date.now()}`;
    await pool.query(`
      INSERT INTO phytosanitary_notices (
        id, source_institution, official_title, notice_type, geographical_scope,
        geographical_scope_type, issue_date, recommended_public_action, provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `, [subNoticeId, 'SENASA', 'Aviso sustituto', 'alerta', '{}', 'nacional', '2024-07-26', 'Acción', '{}']);

    await pool.query(`
      UPDATE phytosanitary_notices SET
        verification_status = 'superseded',
        superseded_by = $1,
        version = version + 1
      WHERE id = $2;
    `, [subNoticeId, testNoticeId]);

    const checkSup = await pool.query('SELECT verification_status, superseded_by FROM phytosanitary_notices WHERE id = $1', [testNoticeId]);
    assert.strictEqual(checkSup.rows[0].verification_status, 'superseded');
    assert.strictEqual(checkSup.rows[0].superseded_by, subNoticeId);
    console.log('  ✓ [TEST 09] Retirada y sustitución documental con integridad FK verificadas');
    passedCount++;

    // TEST 10: Validación de usuarios activos y persistencia tras reconexión
    const uActive = await verifyActiveUserStatus(902, { expectedRole: 'admin', client: pool });
    assert.strictEqual(uActive.valid, true);

    const uBlocked = await verifyActiveUserStatus(903, { expectedRole: 'admin', client: pool });
    assert.strictEqual(uBlocked.valid, false);

    const uInactive = await verifyActiveUserStatus(904, { expectedRole: 'admin', client: pool });
    assert.strictEqual(uInactive.valid, false);

    const uMissing = await verifyActiveUserStatus(9999, { expectedRole: 'admin', client: pool });
    assert.strictEqual(uMissing.valid, false);

    // Persistencia tras cerrar y reabrir conexión
    await pool.end();
    const freshPool = new Pool({ connectionString: testDbUrl });
    const resPersist = await freshPool.query('SELECT verification_status FROM phytosanitary_notices WHERE id = $1', [testNoticeId]);
    assert.strictEqual(resPersist.rows[0].verification_status, 'superseded');
    await freshPool.end();
    console.log('  ✓ [TEST 10] Validación de usuarios en BD real y persistencia tras reconexión física');
    passedCount++;

    console.log('\n==============================================================================');
    console.log(`FASE 9-L10A / L10A.1: ${passedCount}/10 PRUEBAS REALES APROBADAS EN POSTGRESQL AISLADO`);
    console.log('==============================================================================\n');

    return {
      status: 'POSTGRESQL_REAL_VALIDATED',
      passed: passedCount,
      failed: 0,
      omitted: 0
    };
  } finally {
    if (pool && !pool.ended) {
      await pool.end();
    }
    if (ephemeralManager) {
      ephemeralManager.stop();
    }
  }
}

if (require.main === module) {
  runPhytosanitaryPostgresIntegrationL10ASuite().catch(err => {
    console.error('\n❌ ERROR EN SUITE L10A:', err);
    process.exit(1);
  });
}

module.exports = { runPhytosanitaryPostgresIntegrationL10ASuite };
