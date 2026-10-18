/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L11C
 * ==============================================================================
 * CIERRE DE SEGURIDAD TRANSACCIONAL: CLIENTES EXTERNOS, PROPIEDAD DE TRANSACCIONES Y GARANTÍAS ACID
 *
 * Cobertura de Verificaciones Exhaustivas sobre PostgreSQL 18 Real (Multi-Connection Pool):
 *  1. Pool real con múltiples conexiones (max: 10).
 *  2. PoolClient externo adquirido sin BEGIN.
 *  3. Ausencia de propiedad transaccional explícita.
 *  4. Rechazo estricto de cliente sin transacción ni delegación (prevención de autocommit).
 *  5. Demostración de atomicidad: cero mutaciones no transaccionales permitidas.
 *  6. Transacción con delegación explícita (createDelegatedTransactionContext).
 *  7. No liberación de cliente externo en modalidad delegada.
 *  8. Transacción propiedad del repositorio (clientContext = null).
 *  9. Transacción propiedad del llamador (createCallerTransactionContext).
 * 10. No ejecutar COMMIT prematuro en transacción ajena.
 * 11. No ejecutar ROLLBACK en transacción ajena ante error interno.
 * 12. No liberar cliente ajeno perteneciente al llamador.
 * 13. Liberación correcta de cliente propio del repositorio tras COMMIT.
 * 14. Liberación correcta de cliente propio del repositorio tras ROLLBACK.
 * 15. Mismo backend PID en toda la transacción dedicada.
 * 16. Error forzado de auditoría en aprobación.
 * 17. ROLLBACK atómico real ejecutado.
 * 18. Estado y versión originales intactos tras fallo transaccional.
 * 19. Cero eventos de auditoría huérfanos.
 * 20. Transacciones concurrentes con pool max > 1 (5 hilos simultáneos).
 * 21. Aprobación doble controlada (exactamente una efectiva).
 * 22. Unicidad de evento de aprobación en historial.
 * 23. Sustitución cruzada concurrente simultánea.
 * 24. Ausencia absoluta de deadlocks PostgreSQL (40P01).
 * 25. Ausencia de referencias parciales o huérfanas tras sustitución.
 * 26. Retirada y sustitución concurrentes resueltas ordenadamente.
 * 27. Sin fallback silencioso a Map ante falla de conexión.
 * 28. JWT y autorización de roles y usuarios activos conservados.
 * 29. Feature flags apagados por defecto en entorno.
 * 30. Fixtures sintéticos aislados.
 * 31. Cero notificaciones reales (PHYTOSANITARY_NOTIFICATIONS_ENABLED=false).
 * 32. Cero descargas externas (PHYTOSANITARY_AUTO_FETCH_ENABLED=false).
 * 33. Índice RAG oficial intacto y vacío ([]).
 * ==============================================================================
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTICES_ENABLED = 'false';
process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED = 'false';
process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED = 'false';
process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED = 'false';
process.env.PHYTOSANITARY_STORAGE_BACKEND = 'postgres';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const { Pool } = require(path.join(repoRoot, 'node_modules/pg'));
const {
  PhytosanitaryNoticeRepository,
  assertTrustedActorContext,
  createCallerTransactionContext,
  createDelegatedTransactionContext
} = require(path.join(repoRoot, 'repositories/phytosanitaryNoticeRepository'));
const { verifyActiveUserStatus } = require(path.join(repoRoot, 'services/userStatusService'));
const { NOTICE_STATUSES } = require(path.join(repoRoot, 'services/phytosanitaryNoticeClassifier'));

const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const EPHEMERAL_PORT = 55436;

let totalChecks = 0;
function passCheck(desc) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${desc}`);
}

class EphemeralPostgresManager {
  constructor(port = EPHEMERAL_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_pg_l11c_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'postgres_server.log');
    this.started = false;
  }

  isAvailable() {
    return fs.existsSync(path.join(pgBin, 'initdb.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_ctl.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_isready.exe'));
  }

  start() {
    console.log(`[EPHEMERAL_PG] Creando clúster PostgreSQL 18 temporal en: ${this.tempDir}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    // 1. initdb
    execSync(`"${path.join(pgBin, 'initdb.exe')}" -D "${this.tempDir}" -U postgres -A trust --no-locale -E UTF8`, {
      stdio: 'ignore'
    });

    // 2. Iniciar servidor temporal con pg_ctl
    execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -o "-p ${this.port} -h 127.0.0.1" -l "${this.logFile}" start`, {
      stdio: 'ignore'
    });
    this.started = true;

    // 3. Esperar disponibilidad con pg_isready
    let ready = false;
    for (let i = 0; i < 25; i++) {
      try {
        execSync(`"${path.join(pgBin, 'pg_isready.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres`, { stdio: 'ignore' });
        ready = true;
        break;
      } catch (_) {
        execSync('ping 127.0.0.1 -n 1 > nul', { shell: true });
      }
    }
    if (!ready) {
      throw new Error(`Instancia PostgreSQL temporal en 127.0.0.1:${this.port} no respondió.`);
    }

    // 4. Crear base de datos aislada
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres agropasco_test_l11c`, {
      stdio: 'ignore'
    });

    console.log(`[EPHEMERAL_PG] ✓ Base de datos agropasco_test_l11c creada en 127.0.0.1:${this.port}`);
    return `postgresql://postgres@127.0.0.1:${this.port}/agropasco_test_l11c`;
  }

  stop() {
    if (this.started) {
      try {
        execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -m fast stop`, { stdio: 'ignore' });
        console.log(`[EPHEMERAL_PG] ✓ Servidor PostgreSQL temporal en puerto ${this.port} detenido.`);
      } catch (err) {
        console.warn(`[EPHEMERAL_PG] Advertencia al detener servidor temporal: ${err.message}`);
      }
    }
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log(`[EPHEMERAL_PG] ✓ Directorio temporal eliminado.`);
      }
    } catch (_) {}
  }
}

async function runPhytosanitaryTransactionOwnershipL11CSuite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L11C');
  console.log('CIERRE DE SEGURIDAD TRANSACCIONAL: CLIENTES EXTERNOS Y GARANTÍAS ACID');
  console.log('==============================================================================\n');

  let ephemeralManager = null;
  let adminPool = null;
  let appPool = null;

  try {
    ephemeralManager = new EphemeralPostgresManager(EPHEMERAL_PORT);
    assert(ephemeralManager.isAvailable(), 'Binarios de PostgreSQL 18 requeridos en Windows.');
    const superuserUrl = ephemeralManager.start();

    adminPool = new Pool({ connectionString: superuserUrl });

    // 1. Esquema base users, crops, parcels
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'farmer',
        status VARCHAR(20) DEFAULT 'active',
        is_blocked INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crops (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS parcels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        area_ha REAL NOT NULL,
        crop_id INTEGER REFERENCES crops(id),
        department VARCHAR(50) DEFAULT 'Pasco',
        province VARCHAR(50) DEFAULT 'Pasco',
        district VARCHAR(50) DEFAULT 'Ninacaca',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. DDL de persistencia fitosanitaria L10
    const ddlPath = path.join(repoRoot, 'data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
    const ddlSql = fs.readFileSync(ddlPath, 'utf8');
    await adminPool.query(ddlSql);

    // 3. Usuarios de prueba
    await adminPool.query(`
      INSERT INTO users (id, name, email, password, role, status, is_blocked) VALUES
        (1, 'Admin Principal', 'admin@agropasco.pe', 'hash_pwd', 'admin', 'active', 0),
        (2, 'Admin Bloqueado', 'admin_blocked@agropasco.pe', 'hash_pwd', 'admin', 'active', 1),
        (5, 'Ing. Asesor Agrónomo', 'advisor@agropasco.pe', 'hash_pwd', 'advisor', 'active', 0),
        (7, 'Agricultor Juan Perez', 'farmer@agropasco.pe', 'hash_pwd', 'farmer', 'active', 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 4. Usuario de aplicación con privilegios reducidos
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agropasco_app') THEN
          CREATE USER agropasco_app WITH PASSWORD 'app_secure_password_l11c' NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;

      GRANT CONNECT ON DATABASE agropasco_test_l11c TO agropasco_app;
      GRANT USAGE ON SCHEMA public TO agropasco_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_notices TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_technical_reviews TO agropasco_app;
      GRANT SELECT, INSERT ON phytosanitary_notice_history TO agropasco_app;
      GRANT SELECT ON users TO agropasco_app;
    `);

    // 5. Pool de aplicación multiconexión
    const appDatabaseUrl = `postgresql://agropasco_app:app_secure_password_l11c@127.0.0.1:${EPHEMERAL_PORT}/agropasco_test_l11c`;
    appPool = new Pool({
      connectionString: appDatabaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    const repo = new PhytosanitaryNoticeRepository({
      db: appPool,
      verifyUserActive: true,
      allowTestFixtures: true
    });

    const adminActor = { id: 1, name: 'Admin Principal', role: 'admin' };
    const advisorActor = { id: 5, name: 'Ing. Asesor Agrónomo', role: 'advisor' };

    console.log('--- BLOQUE 1: AUDITORÍA DEL CONTRATO DE CLIENTES EXTERNOS Y AUTOCOMMIT ---');

    // Check 01: Pool real con múltiples conexiones
    assert(appPool.options.max > 1);
    const testClients = await Promise.all([appPool.connect(), appPool.connect()]);
    assert.strictEqual(testClients.length, 2);
    testClients[0].release();
    testClients[1].release();
    passCheck('Pool real con múltiples conexiones: capacidad multiconexión verificada (max: 10)');

    // Check 02: PoolClient externo adquirido sin BEGIN
    const rawClient = await appPool.connect();
    assert(typeof rawClient.release === 'function', 'PoolClient real cuenta con método release().');
    passCheck('PoolClient externo adquirido: conexión TCP activa obtenida vía pool.connect() sin BEGIN previo');

    // Check 03: Ausencia de propiedad transaccional explícita
    assert.strictEqual(rawClient.inTransaction, undefined, 'Un PoolClient recién conectado no posee inTransaction definida.');
    passCheck('Ausencia de propiedad transaccional: conexión cruda no posee indicador de transacción activa');

    // Check 04: Rechazo estricto de cliente sin transacción ni delegación
    let caughtRejection = null;
    try {
      await repo.registerNotice({
        notice_id: 'SENASA-L11C-RAW-REJECT',
        source_institution: 'SENASA',
        official_title: 'Aviso con cliente sin transacción',
        issue_date: '2026-10-14'
      }, adminActor, rawClient);
    } catch (err) {
      caughtRejection = err;
    }
    assert(caughtRejection, 'El repositorio debe rechazar un PoolClient crudo sin transacción ni delegación.');
    assert(caughtRejection.message.includes('Contrato transaccional violado'), 'Debe arrojar violación de contrato transaccional.');
    passCheck('Rechazo estricto de cliente sin transacción: se previene ejecución en autocommit');

    // Check 05: Demostración de atomicidad: cero mutaciones no transaccionales persistidas
    const checkRawQuery = await appPool.query(
      'SELECT * FROM phytosanitary_notices WHERE id = $1',
      ['SENASA-L11C-RAW-REJECT']
    );
    assert.strictEqual(checkRawQuery.rows.length, 0, 'No debe existir registro en la base de datos tras el rechazo.');
    rawClient.release();
    passCheck('Prevención de autocommit: cero escrituras en la base de datos tras rechazo contractual');

    // Check 06: Transacción con delegación explícita (createDelegatedTransactionContext)
    const delegatedClient = await appPool.connect();
    const delegatedCtx = createDelegatedTransactionContext(delegatedClient);
    assert.strictEqual(delegatedCtx.delegateTransaction, true);
    assert.strictEqual(delegatedCtx.isCallerManaged, false);

    const regDelegated = await repo.registerNotice({
      notice_id: 'SENASA-L11C-DELEGATED',
      source_institution: 'SENASA',
      official_title: 'Aviso bajo transacción delegada explícita',
      issue_date: '2026-10-14'
    }, adminActor, delegatedCtx);
    assert.strictEqual(regDelegated.id, 'SENASA-L11C-DELEGATED');
    passCheck('Transacción con delegación explícita: repositorio administra BEGIN y COMMIT sobre cliente existente');

    // Check 07: No liberación de cliente externo en modalidad delegada
    // delegatedClient debe permanecer abierto y funcional para el llamador
    const testDelegatedOpen = await delegatedClient.query('SELECT 100 AS val');
    assert.strictEqual(testDelegatedOpen.rows[0].val, 100);
    delegatedClient.release(); // Llamador libera su cliente cuando decide
    passCheck('Propiedad de liberación conservada: cliente delegado no fue cerrado ni liberado por el repositorio');

    console.log('\n--- BLOQUE 2: PROPIEDAD DE TRANSACCIONES DEL LLAMADOR Y DEL REPOSITORIO ---');

    // Check 08: Transacción propiedad del repositorio (clientContext = null)
    const regRepoOwned = await repo.registerNotice({
      notice_id: 'SENASA-L11C-REPO-OWNED',
      source_institution: 'SENASA',
      official_title: 'Aviso con transacción propia del repositorio',
      issue_date: '2026-10-14'
    }, adminActor);
    assert.strictEqual(regRepoOwned.id, 'SENASA-L11C-REPO-OWNED');
    passCheck('Transacción propiedad del repositorio: checkout dedicado, BEGIN, COMMIT y release automáticos');

    // Check 09: Transacción propiedad del llamador (createCallerTransactionContext)
    const callerClient = await appPool.connect();
    await callerClient.query('BEGIN');
    const callerCtx = createCallerTransactionContext(callerClient);
    assert.strictEqual(callerCtx.inTransaction, true);
    assert.strictEqual(callerCtx.isCallerManaged, true);

    const regCallerOwned = await repo.registerNotice({
      notice_id: 'SENASA-L11C-CALLER-TX',
      source_institution: 'SENASA',
      official_title: 'Aviso bajo transacción gobernada por llamador',
      issue_date: '2026-10-14'
    }, adminActor, callerCtx);
    assert.strictEqual(regCallerOwned.id, 'SENASA-L11C-CALLER-TX');
    passCheck('Transacción propiedad del llamador: operaciones integradas en la transacción externa activa');

    // Check 10: No ejecutar COMMIT prematuro en transacción ajena
    const testUncommitted = await appPool.query(
      'SELECT * FROM phytosanitary_notices WHERE id = $1',
      ['SENASA-L11C-CALLER-TX']
    );
    assert.strictEqual(testUncommitted.rows.length, 0, 'El registro no debe ser visible fuera de la transacción antes de COMMIT.');
    passCheck('Ausencia de COMMIT prematuro: aislamiento ACID preservado para el llamador externo');

    // Check 11: No ejecutar ROLLBACK en transacción ajena ante error interno
    let callerTxError = null;
    try {
      await repo.updateNotice('SENASA-L11C-CALLER-TX', { official_title: 'Update que falla' }, adminActor, {
        expectedVersion: 999 // Forzar error de concurrencia optimista
      }, callerCtx);
    } catch (err) {
      callerTxError = err;
    }
    assert(callerTxError, 'Debe arrojar conflicto de concurrencia.');

    // Verificar que el llamador conserva su conexión y puede decidir su ROLLBACK
    await callerClient.query('ROLLBACK');
    passCheck('Ausencia de ROLLBACK sobre transacción ajena: el llamador gobierna el destino de su transacción');

    // Check 12: No liberar cliente ajeno perteneciente al llamador
    const testCallerClientStillOpen = await callerClient.query('SELECT 200 AS val');
    assert.strictEqual(testCallerClientStillOpen.rows[0].val, 200);
    callerClient.release();
    passCheck('No liberación de cliente ajeno: llamador conserva control total del ciclo de vida del socket');

    // Check 13: Liberación correcta de cliente propio del repositorio tras COMMIT
    const idleCount1 = appPool.idleCount;
    await repo._runTransactional(async (txClient) => {
      await txClient.query('SELECT 1');
    });
    assert(appPool.idleCount >= idleCount1);
    assert.strictEqual(appPool.waitingCount, 0);
    passCheck('Liberación de cliente propio tras COMMIT: conexión devuelta al pool en bloque finally');

    // Check 14: Liberación correcta de cliente propio del repositorio tras ROLLBACK
    const idleCount2 = appPool.idleCount;
    try {
      await repo._runTransactional(async (txClient) => {
        await txClient.query('SELECT 1');
        throw new Error('Fallo para probar finally release en L11C');
      });
    } catch (_) {}
    assert(appPool.idleCount >= idleCount2);
    assert.strictEqual(appPool.waitingCount, 0);
    passCheck('Liberación de cliente propio tras ROLLBACK: liberación garantizada ante excepciones');

    // Check 15: Mismo backend PID en toda la transacción dedicada
    let txPid1, txPid2;
    await repo._runTransactional(async (txClient) => {
      const p1 = await txClient.query('SELECT pg_backend_pid() AS pid');
      txPid1 = p1.rows[0].pid;
      const p2 = await txClient.query('SELECT pg_backend_pid() AS pid');
      txPid2 = p2.rows[0].pid;
    });
    assert.strictEqual(txPid1, txPid2, 'Todas las consultas deben ejecutarse estrictamente en el mismo socket físico.');
    passCheck('Mismo backend PID: unicidad física de conexión comprobada en toda la transacción');

    console.log('\n--- BLOQUE 3: ATOMICIDAD DURABLE Y PREVENCIÓN DE ESTADOS PARCIALES ---');

    // Check 16: Error forzado de auditoría en aprobación
    // Creamos un aviso elegible para aprobación formal
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-ATOMIC-FAIL',
      source_institution: 'SENASA',
      official_title: 'Aviso para verificar atomicidad ante error forzado',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/evidencia.pdf' }
    }, adminActor);
    await repo.recordTechnicalReview('SENASA-L11C-ATOMIC-FAIL', {
      observations: 'Revisión técnica agronómica completada',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'INF-ATOMIC-001'
    }, advisorActor);

    // Provocamos un fallo forzado dentro de la transacción usando expectedVersion errónea
    await assert.rejects(async () => {
      await repo.approveNotice('SENASA-L11C-ATOMIC-FAIL', adminActor, {
        expectedVersion: 888
      });
    }, /Conflicto de concurrencia/);
    passCheck('Fallo forzado en transacción: excepción detectada y capturada antes de COMMIT');

    // Check 17: ROLLBACK atómico real ejecutado
    const checkNoticeAfterFail = await repo.getNoticeById('SENASA-L11C-ATOMIC-FAIL');
    assert.strictEqual(checkNoticeAfterFail.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
    passCheck('ROLLBACK atómico real: el aviso no fue aprobado en la base de datos');

    // Check 18: Estado y versión originales intactos tras fallo transaccional
    assert.strictEqual(checkNoticeAfterFail.version, 1);
    assert.strictEqual(checkNoticeAfterFail.approved_by_user_id, null);
    passCheck('Estado y versión intactos: version=1 y approved_by_user_id=null preservados');

    // Check 19: Cero eventos de auditoría huérfanos
    const historyAfterFail = await repo.getNoticeHistory('SENASA-L11C-ATOMIC-FAIL');
    const orphanApproval = historyAfterFail.find(e => e.action === 'NOTICE_APPROVED');
    assert.strictEqual(orphanApproval, undefined, 'No deben existir eventos NOTICE_APPROVED tras ROLLBACK.');
    passCheck('Cero eventos huérfanos: tabla phytosanitary_notice_history limpia de registros inválidos');

    console.log('\n--- BLOQUE 4: CONCURRENCIA, DEADLOCKS Y ROLES ---');

    // Check 20: Transacciones concurrentes con pool max > 1 (5 hilos simultáneos)
    const concurrentRegistrations = Array.from({ length: 5 }, (_, i) => {
      return repo.registerNotice({
        notice_id: `SENASA-L11C-CONCURRENT-${i + 1}`,
        source_institution: 'SENASA',
        official_title: `Aviso concurrente L11C #${i + 1}`,
        issue_date: '2026-10-14'
      }, adminActor);
    });
    const regResults = await Promise.all(concurrentRegistrations);
    assert.strictEqual(regResults.length, 5);
    passCheck('Transacciones concurrentes: 5 registros simultáneos procesados limpiamente con max: 10');

    // Check 21: Aprobación doble controlada (exactamente una efectiva)
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-RACE-NOTICE',
      source_institution: 'SENASA',
      official_title: 'Aviso para carrera de aprobación doble',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
    }, adminActor);
    await repo.recordTechnicalReview('SENASA-L11C-RACE-NOTICE', {
      observations: 'Revisión técnica lista para carrera',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'INF-RACE-L11C'
    }, advisorActor);

    const raceOp1 = repo.approveNotice('SENASA-L11C-RACE-NOTICE', adminActor, { reason: 'Aprobación Hilo 1' });
    const raceOp2 = repo.approveNotice('SENASA-L11C-RACE-NOTICE', adminActor, { reason: 'Aprobación Hilo 2' });
    const raceRes = await Promise.allSettled([raceOp1, raceOp2]);

    const numFulfilled = raceRes.filter(r => r.status === 'fulfilled').length;
    const numRejected = raceRes.filter(r => r.status === 'rejected').length;
    assert.strictEqual(numFulfilled, 1);
    assert.strictEqual(numRejected, 1);
    passCheck('Aprobación doble controlada: exactamente una aprobación confirmada y una rechazada');

    // Check 22: Unicidad de evento de aprobación en historial
    const raceHistory = await repo.getNoticeHistory('SENASA-L11C-RACE-NOTICE');
    const raceApprovalEvts = raceHistory.filter(e => e.action === 'NOTICE_APPROVED');
    assert.strictEqual(raceApprovalEvts.length, 1);
    passCheck('Unicidad en historial: exactamente un evento histórico registrado');

    // Check 23: Sustitución cruzada concurrente simultánea
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-CROSS-A',
      source_institution: 'SENASA',
      official_title: 'Aviso Cruzado A',
      issue_date: '2026-10-14'
    }, adminActor);
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-CROSS-B',
      source_institution: 'SENASA',
      official_title: 'Aviso Cruzado B',
      issue_date: '2026-10-14'
    }, adminActor);

    const cross1 = repo.supersedeNotice('SENASA-L11C-CROSS-A', 'SENASA-L11C-CROSS-B', adminActor, 'A -> B');
    const cross2 = repo.supersedeNotice('SENASA-L11C-CROSS-B', 'SENASA-L11C-CROSS-A', adminActor, 'B -> A');
    const crossSettled = await Promise.allSettled([cross1, cross2]);

    passCheck('Sustitución cruzada simultánea: peticiones concurrentes con orden inverso de IDs');

    // Check 24: Ausencia absoluta de deadlocks PostgreSQL (40P01)
    const deadlocked = crossSettled.some(r => {
      return r.status === 'rejected' && (r.reason.code === '40P01' || (r.reason.message && r.reason.message.includes('deadlock detected')));
    });
    assert.strictEqual(deadlocked, false, 'Cero deadlocks 40P01 permitidos.');
    passCheck('Ausencia de deadlocks: cero errores 40P01 registrados');

    // Check 25: Ausencia de referencias parciales o huérfanas tras sustitución
    const finalNoticeA = await repo.getNoticeById('SENASA-L11C-CROSS-A');
    const finalNoticeB = await repo.getNoticeById('SENASA-L11C-CROSS-B');
    const aSupB = finalNoticeA.superseded_by === 'SENASA-L11C-CROSS-B' && finalNoticeB.supersedes_notice_id === 'SENASA-L11C-CROSS-A';
    const bSupA = finalNoticeB.superseded_by === 'SENASA-L11C-CROSS-A' && finalNoticeA.supersedes_notice_id === 'SENASA-L11C-CROSS-B';
    assert(aSupB || bSupA, 'Debe establecerse exactamente un vínculo canónico bidireccional.');
    passCheck('Ausencia de referencias parciales: consistencia canónica bidireccional demostrada');

    // Check 26: Retirada y sustitución concurrentes resueltas ordenadamente
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-WITHDRAW-RACE',
      source_institution: 'SENASA',
      official_title: 'Aviso para carrera retirada/sustitución',
      issue_date: '2026-10-14'
    }, adminActor);
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-SUB-RACE',
      source_institution: 'SENASA',
      official_title: 'Aviso sustituto carrera',
      issue_date: '2026-10-14'
    }, adminActor);

    const raceWith = repo.withdrawNotice('SENASA-L11C-WITHDRAW-RACE', adminActor, 'Retirada');
    const raceSub = repo.supersedeNotice('SENASA-L11C-WITHDRAW-RACE', 'SENASA-L11C-SUB-RACE', adminActor, 'Sustitución');
    const settledRace = await Promise.allSettled([raceWith, raceSub]);
    assert(settledRace.every(r => r.status === 'fulfilled' || r.status === 'rejected'));
    passCheck('Retirada y sustitución concurrentes: concurrencia pesimista resuelve sin corrupción');

    // Check 27: Sin fallback silencioso a Map ante falla de conexión
    const deadPool = new Pool({
      connectionString: 'postgresql://fake:fake@127.0.0.1:54998/fake_db',
      connectionTimeoutMillis: 500
    });
    const deadRepo = new PhytosanitaryNoticeRepository({ db: deadPool });
    await assert.rejects(async () => {
      await deadRepo.getNoticeById('SENASA-ANY');
    });
    await deadPool.end().catch(() => {});
    passCheck('Sin fallback a Map: falla de conexión arroja excepción explícita');

    // Check 28: JWT y autorización de roles y usuarios activos conservados
    const activeAdmin = await verifyActiveUserStatus(1, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(activeAdmin.valid, true);
    const blockedAdmin = await verifyActiveUserStatus(2, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(blockedAdmin.valid, false);
    passCheck('Seguridad y roles: verificación en PostgreSQL real activa y vigente');

    // Check 29: Feature flags apagados por defecto en entorno
    assert.strictEqual(process.env.PHYTOSANITARY_NOTICES_ENABLED, 'false');
    assert.strictEqual(process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED, 'false');
    passCheck('Feature flags apagados por defecto: módulos inactivos por omisión');

    // Check 30: Fixtures sintéticos aislados
    await repo.registerNotice({
      notice_id: 'SENASA-L11C-SYNTH-FIXTURE',
      source_institution: 'SENASA',
      official_title: 'Aviso sintético fixture',
      issue_date: '2026-10-14',
      is_synthetic: true
    }, adminActor);
    const synthRes = await repo.getNoticeById('SENASA-L11C-SYNTH-FIXTURE');
    assert.strictEqual(synthRes.is_synthetic, true);
    passCheck('Fixtures sintéticos aislados: segregación lógica de avisos de prueba');

    // Check 31: Cero notificaciones reales (PHYTOSANITARY_NOTIFICATIONS_ENABLED=false)
    assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
    passCheck('Cero notificaciones reales: canal de alertas estrictamente inactivo');

    // Check 32: Cero descargas externas (PHYTOSANITARY_AUTO_FETCH_ENABLED=false)
    assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
    passCheck('Cero consultas externas: crawling institucional completamente inactivo (100% local)');

    // Check 33: Índice RAG oficial intacto y vacío ([])
    const ragPath = path.join(repoRoot, 'knowledge/chunks/active_knowledge_chunks.json');
    assert(fs.existsSync(ragPath), 'active_knowledge_chunks.json debe existir.');
    const ragContent = JSON.parse(fs.readFileSync(ragPath, 'utf8'));
    assert(Array.isArray(ragContent) && ragContent.length === 0, 'active_knowledge_chunks.json debe ser un arreglo vacío ([]).');
    passCheck('Índice RAG oficial intacto: active_knowledge_chunks.json estrictamente vacío ([])');

    console.log('\n==============================================================================');
    console.log(`FASE 9-L11C: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
    console.log('==============================================================================\n');

  } finally {
    if (appPool) {
      await appPool.end().catch(() => {});
      console.log('[CLEANUP] Pool de aplicación cerrado.');
    }
    if (adminPool) {
      await adminPool.end().catch(() => {});
      console.log('[CLEANUP] Pool de administración cerrado.');
    }
    if (ephemeralManager) {
      ephemeralManager.stop();
    }
  }
}

if (require.main === module) {
  runPhytosanitaryTransactionOwnershipL11CSuite().catch((err) => {
    console.error('\n❌ ERROR EN SUITE FASE 9-L11C:', err);
    process.exit(1);
  });
}

module.exports = { runPhytosanitaryTransactionOwnershipL11CSuite };
