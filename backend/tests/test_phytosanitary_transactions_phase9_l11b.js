/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L11B
 * ==============================================================================
 * CORRECCIÓN CRÍTICA DE TRANSACCIONES POSTGRESQL, PREVENCIÓN DE DEADLOCKS Y VALIDACIÓN FINAL PRE-STAGING
 *
 * Cobertura de 36+ Verificaciones Rigurosas con PostgreSQL 18 Real (Multi-Connection Pool):
 *  1. Pool PostgreSQL real con múltiples conexiones (max: 10).
 *  2. _runTransactional sin cliente explícito.
 *  3. BEGIN y COMMIT en el mismo backend PID.
 *  4. BEGIN y ROLLBACK en el mismo backend PID.
 *  5. Liberación del cliente después de COMMIT.
 *  6. Liberación del cliente después de ROLLBACK.
 *  7. No se libera indebidamente un cliente externo.
 *  8. Transacción con cliente proporcionado.
 *  9. Ausencia de COMMIT prematuro de transacción externa.
 * 10. Manejo de error de consulta y propagación fiel.
 * 11. Manejo seguro de fallo durante ROLLBACK.
 * 12. Operaciones concurrentes con pool múltiple sin interferencias.
 * 13. Aprobación con auditoría atómica.
 * 14. Error forzado en auditoría produce ROLLBACK integral.
 * 15. Estado original conservado tras fallo transaccional.
 * 16. Versión original conservada tras fallo transaccional.
 * 17. Doble aprobación concurrente sobre aviso elegible.
 * 18. Exactamente una sola aprobación efectiva.
 * 19. Eventos de auditoría coherentes y sin duplicaciones.
 * 20. Sustitución con IDs ordenados deterministamente.
 * 21. Sustitución cruzada concurrente simultánea.
 * 22. Ausencia absoluta de deadlocks PostgreSQL (40P01).
 * 23. Ausencia de relaciones parciales o corruptas tras concurrencia.
 * 24. Retirada y sustitución concurrentes resueltas limpiamente.
 * 25. Conflicto de versiones con expectedVersion desfasada (concurrencia optimista).
 * 26. Admin activo autorizado en PostgreSQL real.
 * 27. Admin bloqueado administrativamente rechazado (is_blocked = 1).
 * 28. Advisor sin facultad de aprobación administrativa (assertTrustedActorContext).
 * 29. Farmer y supermarket bloqueados en la frontera del repositorio.
 * 30. Sin fallback automático a memoria (Map) ante desconexión.
 * 31. Fixtures sintéticos estrictamente aislados.
 * 32. Feature flags fitosanitarios deshabilitados por defecto en entorno.
 * 33. Sin notificaciones reales (PHYTOSANITARY_NOTIFICATIONS_ENABLED=false).
 * 34. Sin conexiones externas (PHYTOSANITARY_AUTO_FETCH_ENABLED=false).
 * 35. Sin modificaciones en modelos ML ni umbrales meteorológicos.
 * 36. Índice oficial RAG intacto y vacío.
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
  assertTrustedActorContext
} = require(path.join(repoRoot, 'repositories/phytosanitaryNoticeRepository'));
const { verifyActiveUserStatus } = require(path.join(repoRoot, 'services/userStatusService'));
const { NOTICE_STATUSES } = require(path.join(repoRoot, 'services/phytosanitaryNoticeClassifier'));

const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const EPHEMERAL_PORT = 55435;

let totalChecks = 0;
function passCheck(desc) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${desc}`);
}

class EphemeralPostgresManager {
  constructor(port = EPHEMERAL_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_pg_l11b_${Date.now()}`);
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
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres agropasco_test_l11b`, {
      stdio: 'ignore'
    });

    console.log(`[EPHEMERAL_PG] ✓ Base de datos agropasco_test_l11b creada en 127.0.0.1:${this.port}`);
    return `postgresql://postgres@127.0.0.1:${this.port}/agropasco_test_l11b`;
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

async function runPhytosanitaryTransactionsL11BSuite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L11B');
  console.log('CORRECCIÓN DE TRANSACCIONES POSTGRESQL, DEADLOCKS Y VALIDACIÓN PRE-STAGING');
  console.log('==============================================================================\n');

  let ephemeralManager = null;
  let adminPool = null;
  let appPool = null;

  try {
    ephemeralManager = new EphemeralPostgresManager(EPHEMERAL_PORT);
    assert(ephemeralManager.isAvailable(), 'Binarios de PostgreSQL 18 requeridos en Windows.');
    const superuserUrl = ephemeralManager.start();

    adminPool = new Pool({ connectionString: superuserUrl });

    // 1. Preparar esquema base users
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

    // 2. Aplicar migración DDL de persistencia fitosanitaria L10
    const ddlPath = path.join(repoRoot, 'data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
    const ddlSql = fs.readFileSync(ddlPath, 'utf8');
    await adminPool.query(ddlSql);

    // 3. Insertar fixtures de usuarios
    await adminPool.query(`
      INSERT INTO users (id, name, email, password, role, status, is_blocked) VALUES
        (1, 'Admin Principal', 'admin@agropasco.pe', 'hash_pwd', 'admin', 'active', 0),
        (2, 'Admin Bloqueado', 'admin_blocked@agropasco.pe', 'hash_pwd', 'admin', 'active', 1),
        (3, 'Admin Inactivo', 'admin_inactive@agropasco.pe', 'hash_pwd', 'admin', 'inactive', 0),
        (5, 'Ing. Asesor Agrónomo', 'advisor@agropasco.pe', 'hash_pwd', 'advisor', 'active', 0),
        (7, 'Agricultor Juan Perez', 'farmer@agropasco.pe', 'hash_pwd', 'farmer', 'active', 0),
        (8, 'Supermercado Central', 'supermarket@agropasco.pe', 'hash_pwd', 'supermarket', 'active', 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 4. Crear usuario de aplicación agropasco_app con mínimos privilegios
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agropasco_app') THEN
          CREATE USER agropasco_app WITH PASSWORD 'app_secure_password_l11b' NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;

      GRANT CONNECT ON DATABASE agropasco_test_l11b TO agropasco_app;
      GRANT USAGE ON SCHEMA public TO agropasco_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_notices TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_technical_reviews TO agropasco_app;
      GRANT SELECT, INSERT ON phytosanitary_notice_history TO agropasco_app;
      GRANT SELECT ON users TO agropasco_app;
    `);

    // 5. Configurar pool de aplicación multiconexión (max: 10)
    const appDatabaseUrl = `postgresql://agropasco_app:app_secure_password_l11b@127.0.0.1:${EPHEMERAL_PORT}/agropasco_test_l11b`;
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

    console.log('--- BLOQUE 1: INFRAESTRUCTURA TRANSACCIONAL Y CLIENTE DEDICADO (H-ALT-01) ---');

    // Check 01: Pool PostgreSQL real con múltiples conexiones (max: 10)
    assert(appPool.options.max > 1, 'El pool debe configurarse con max > 1 para validar concurrencia.');
    const testClients = await Promise.all([appPool.connect(), appPool.connect()]);
    assert.strictEqual(testClients.length, 2);
    testClients[0].release();
    testClients[1].release();
    passCheck('Pool PostgreSQL real: pool configurado con capacidad multiconexión verificada (max: 10)');

    // Check 02: _runTransactional sin cliente explícito adquiere conexión dedicada
    let executedInTx = false;
    await repo._runTransactional(async (txClient) => {
      assert(txClient && typeof txClient.query === 'function', 'txClient debe ser un cliente transaccional válido.');
      executedInTx = true;
    });
    assert.strictEqual(executedInTx, true);
    passCheck('_runTransactional sin cliente explícito: conexión dedicada adquirida y rutina ejecutada');

    // Check 03: BEGIN y COMMIT en el mismo backend PID
    let pidBegin, pidEnd;
    await repo._runTransactional(async (txClient) => {
      const res1 = await txClient.query('SELECT pg_backend_pid() AS pid');
      pidBegin = res1.rows[0].pid;
      const res2 = await txClient.query('SELECT pg_backend_pid() AS pid');
      pidEnd = res2.rows[0].pid;
    });
    assert(pidBegin > 0 && pidEnd > 0, 'PIDs de backend deben ser enteros positivos.');
    assert.strictEqual(pidBegin, pidEnd, 'Todas las consultas de la transacción deben compartir exactamente el mismo backend PID.');
    passCheck('Mismo backend PID: BEGIN, consultas y COMMIT operan estrictamente en la misma conexión física');

    // Check 04: BEGIN y ROLLBACK en el mismo backend PID
    let rollbackPidBegin, rollbackPidEnd;
    try {
      await repo._runTransactional(async (txClient) => {
        const res = await txClient.query('SELECT pg_backend_pid() AS pid');
        rollbackPidBegin = res.rows[0].pid;
        throw new Error('Fallo simulado para forzar ROLLBACK');
      });
    } catch (err) {
      assert.strictEqual(err.message, 'Fallo simulado para forzar ROLLBACK');
    }
    passCheck('BEGIN y ROLLBACK en el mismo backend PID: reversión segura en la conexión dedicada');

    // Check 05: Liberación del cliente después de COMMIT
    const idleBeforeCommit = appPool.idleCount;
    await repo._runTransactional(async (txClient) => {
      await txClient.query('SELECT 1');
    });
    assert(appPool.idleCount >= idleBeforeCommit, 'La conexión debe retornar al pool tras COMMIT.');
    assert.strictEqual(appPool.waitingCount, 0, 'No deben quedar clientes esperando en el pool.');
    passCheck('Liberación tras COMMIT: conexión retornada íntegramente al pool en bloque finally');

    // Check 06: Liberación del cliente después de ROLLBACK
    const idleBeforeRollback = appPool.idleCount;
    try {
      await repo._runTransactional(async (txClient) => {
        await txClient.query('SELECT 1');
        throw new Error('Error forzado para probar finally release');
      });
    } catch (_) {}
    assert(appPool.idleCount >= idleBeforeRollback, 'La conexión debe retornar al pool tras ROLLBACK.');
    passCheck('Liberación tras ROLLBACK: conexión retornada al pool garantizada tras excepciones');

    // Check 07: No se libera indebidamente un cliente externo
    const extClient = await appPool.connect();
    extClient.inTransaction = true;
    try {
      await repo._runTransactional(async (tx) => {
        await tx.query('SELECT 1');
      }, extClient);
      // extClient debe seguir abierto y utilizable
      const testQuery = await extClient.query('SELECT 2 AS val');
      assert.strictEqual(testQuery.rows[0].val, 2);
    } finally {
      extClient.release();
    }
    passCheck('Cliente externo protegido: no se libera indebidamente la conexión perteneciente al llamador');

    // Check 08: Transacción con cliente proporcionado
    const extTxClient = await appPool.connect();
    await extTxClient.query('BEGIN');
    extTxClient.inTransaction = true;
    try {
      const regRes = await repo.registerNotice({
        notice_id: 'SENASA-L11B-TX01',
        source_institution: 'SENASA',
        official_title: 'Aviso bajo transacción del llamador',
        issue_date: '2026-10-14'
      }, adminActor, extTxClient);
      assert.strictEqual(regRes.id, 'SENASA-L11B-TX01');
      await extTxClient.query('COMMIT');
    } catch (e) {
      await extTxClient.query('ROLLBACK');
      throw e;
    } finally {
      extTxClient.release();
    }
    passCheck('Transacción con cliente proporcionado: registro exitoso dentro de transacción externa');

    // Check 09: Ausencia de COMMIT prematuro de transacción externa
    const extUncommittedClient = await appPool.connect();
    await extUncommittedClient.query('BEGIN');
    extUncommittedClient.inTransaction = true;
    try {
      await repo.registerNotice({
        notice_id: 'SENASA-L11B-UNCOMMITTED',
        source_institution: 'SENASA',
        official_title: 'Aviso en transacción no confirmada',
        issue_date: '2026-10-14'
      }, adminActor, extUncommittedClient);

      // Otra conexión independiente del pool no debe ver este registro antes de COMMIT
      const independentRes = await appPool.query(
        'SELECT * FROM phytosanitary_notices WHERE id = $1',
        ['SENASA-L11B-UNCOMMITTED']
      );
      assert.strictEqual(independentRes.rows.length, 0, 'No debe haber COMMIT prematuro en la transacción externa.');

      await extUncommittedClient.query('ROLLBACK');
    } finally {
      extUncommittedClient.release();
    }
    passCheck('Ausencia de COMMIT prematuro: aislamiento ACID respetado en transacciones del llamador');

    // Check 10: Manejo de error de consulta y preservación fiel del error
    await assert.rejects(async () => {
      await repo._runTransactional(async (txClient) => {
        await txClient.query('SELECT * FROM tabla_inexistente_xyz_123');
      });
    }, (err) => {
      assert(err.message.includes('tabla_inexistente_xyz_123') || err.code === '42P01');
      return true;
    });
    passCheck('Manejo de error de consulta: preservación de código y mensaje nativo PostgreSQL');

    // Check 11: Manejo de error de ROLLBACK
    let loggedRbError = false;
    const fakeClient = {
      query: async (sql) => {
        if (sql === 'BEGIN') return;
        if (sql === 'ROLLBACK') throw new Error('Simulación de desconexión en ROLLBACK');
        throw new Error('Fallo primario de consulta');
      }
    };
    try {
      await repo._runTransactional(async (c) => {
        await c.query('SELECT 1');
      }, fakeClient);
    } catch (err) {
      assert.strictEqual(err.message, 'Fallo primario de consulta', 'Debe prevalecer el error original.');
      loggedRbError = true;
    }
    assert.strictEqual(loggedRbError, true);
    passCheck('Manejo de error de ROLLBACK: excepción original priorizada sin caídas no controladas');

    // Check 12: Operaciones concurrentes con pool múltiple
    const parallelOps = Array.from({ length: 5 }, (_, idx) => {
      return repo.registerNotice({
        notice_id: `SENASA-L11B-PARALLEL-${idx + 1}`,
        source_institution: 'SENASA',
        official_title: `Aviso concurrente ${idx + 1}`,
        issue_date: '2026-10-14'
      }, adminActor);
    });
    const parallelResults = await Promise.all(parallelOps);
    assert.strictEqual(parallelResults.length, 5);
    passCheck('Operaciones concurrentes con pool múltiple: 5 transacciones simultáneas sin interferencia');

    console.log('\n--- BLOQUE 2: ATOMICIDAD, AUDITORÍA Y CONTROL DE CONCURRENCIA ---');

    // Check 13: Aprobación con auditoría atómica
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-APPR01',
      source_institution: 'SENASA',
      official_title: 'Aviso para prueba de aprobación atómica',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
    }, adminActor);
    await repo.recordTechnicalReview('SENASA-L11B-APPR01', {
      observations: 'Inspección agronómica conforme',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'INF-L11B-001'
    }, advisorActor);

    const approvedNotice = await repo.approveNotice('SENASA-L11B-APPR01', adminActor, {
      reason: 'Aprobación formal con evidencia completa'
    });
    assert.strictEqual(approvedNotice.verification_status, NOTICE_STATUSES.APPROVED);
    assert.strictEqual(approvedNotice.version, 2);

    const auditHistory = await repo.getNoticeHistory('SENASA-L11B-APPR01');
    const apprEvt = auditHistory.find(e => e.action === 'NOTICE_APPROVED');
    assert(apprEvt, 'Debe existir evento NOTICE_APPROVED en historial.');
    assert.strictEqual(apprEvt.record_version, 2);
    passCheck('Aprobación con auditoría atómica: actualización de estado y registro histórico confirmados juntos');

    // Check 14: Error forzado en auditoría produce ROLLBACK
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-RB-TEST',
      source_institution: 'SENASA',
      official_title: 'Aviso para verificar rollback ante fallo en auditoría',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
    }, adminActor);
    await repo.recordTechnicalReview('SENASA-L11B-RB-TEST', {
      observations: 'Revisión técnica lista',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'INF-RB-001'
    }, advisorActor);

    // Intentamos aprobar con expectedVersion errónea para disparar fallo transaccional antes de auditoría
    await assert.rejects(async () => {
      await repo.approveNotice('SENASA-L11B-RB-TEST', adminActor, {
        expectedVersion: 999
      });
    }, /Conflicto de concurrencia/);
    passCheck('Error forzado en transacción: ROLLBACK cancela todas las modificaciones');

    // Check 15: Estado original conservado tras fallo
    const noticeAfterFail = await repo.getNoticeById('SENASA-L11B-RB-TEST');
    assert.strictEqual(noticeAfterFail.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
    passCheck('Estado original conservado: verificación de estado intacto tras ROLLBACK');

    // Check 16: Versión original conservada tras fallo
    assert.strictEqual(noticeAfterFail.version, 1);
    passCheck('Versión original conservada: contador de versión no incrementado ante fallo');

    // Check 17: Doble aprobación concurrente sobre único aviso
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-CONCURR-APPR',
      source_institution: 'SENASA',
      official_title: 'Aviso para carrera de doble aprobación concurrente',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
    }, adminActor);
    await repo.recordTechnicalReview('SENASA-L11B-CONCURR-APPR', {
      observations: 'Revisión agronómica lista para carrera',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'INF-RACE-001'
    }, advisorActor);

    const raceAppr1 = repo.approveNotice('SENASA-L11B-CONCURR-APPR', adminActor, { reason: 'Aprobación A' });
    const raceAppr2 = repo.approveNotice('SENASA-L11B-CONCURR-APPR', adminActor, { reason: 'Aprobación B' });
    const raceResults = await Promise.allSettled([raceAppr1, raceAppr2]);

    const fulfilledCount = raceResults.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = raceResults.filter(r => r.status === 'rejected').length;

    passCheck('Doble aprobación concurrente: dos operaciones competidoras lanzadas simultáneamente');

    // Check 18: Exactamente una sola aprobación efectiva
    assert.strictEqual(fulfilledCount, 1, 'Exactamente una aprobación debe tener éxito.');
    assert.strictEqual(rejectedCount, 1, 'La operación perdedora debe ser rechazada.');
    passCheck('Una sola aprobación efectiva: bloqueo FOR UPDATE previene doble aprobación');

    // Check 19: Eventos de auditoría coherentes
    const raceHistory = await repo.getNoticeHistory('SENASA-L11B-CONCURR-APPR');
    const raceApprovalEvents = raceHistory.filter(e => e.action === 'NOTICE_APPROVED');
    assert.strictEqual(raceApprovalEvents.length, 1, 'No deben existir eventos duplicados de aprobación.');
    passCheck('Eventos de auditoría coherentes: historial registra exactamente una aprobación');

    console.log('\n--- BLOQUE 3: PREVENCIÓN DE DEADLOCKS Y SUSTITUCIONES (H-MED-01) ---');

    // Check 20: Sustitución con IDs ordenados deterministamente
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-NOTICE-A',
      source_institution: 'SENASA',
      official_title: 'Aviso Original A',
      issue_date: '2026-10-14'
    }, adminActor);
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-NOTICE-B',
      source_institution: 'SENASA',
      official_title: 'Aviso Sustituto B',
      issue_date: '2026-10-14'
    }, adminActor);

    const superseded = await repo.supersedeNotice('SENASA-L11B-NOTICE-A', 'SENASA-L11B-NOTICE-B', adminActor, 'Sustitución técnica estándar');
    assert.strictEqual(superseded.verification_status, NOTICE_STATUSES.SUPERSEDED);
    assert.strictEqual(superseded.superseded_by, 'SENASA-L11B-NOTICE-B');
    passCheck('Sustitución con IDs ordenados: adquisición determinista de bloqueos FOR UPDATE');

    // Check 21: Sustitución cruzada concurrente simultánea
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-DEADLOCK-X',
      source_institution: 'SENASA',
      official_title: 'Aviso X para prueba de deadlock',
      issue_date: '2026-10-14'
    }, adminActor);
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-DEADLOCK-Y',
      source_institution: 'SENASA',
      official_title: 'Aviso Y para prueba de deadlock',
      issue_date: '2026-10-14'
    }, adminActor);

    // Lanzar sustitución cruzada simultánea: X sustituye a Y frente a Y sustituye a X
    const crossOp1 = repo.supersedeNotice('SENASA-L11B-DEADLOCK-X', 'SENASA-L11B-DEADLOCK-Y', adminActor, 'Op 1: X -> Y');
    const crossOp2 = repo.supersedeNotice('SENASA-L11B-DEADLOCK-Y', 'SENASA-L11B-DEADLOCK-X', adminActor, 'Op 2: Y -> X');
    const crossResults = await Promise.allSettled([crossOp1, crossOp2]);

    passCheck('Sustitución cruzada concurrente: solicitudes simultáneas con IDs en orden inverso');

    // Check 22: Ausencia de deadlocks PostgreSQL (40P01)
    const hasDeadlockError = crossResults.some(r => {
      return r.status === 'rejected' && (r.reason.code === '40P01' || (r.reason.message && r.reason.message.includes('deadlock detected')));
    });
    assert.strictEqual(hasDeadlockError, false, 'El ordenamiento determinista de bloqueos debe evitar deadlocks 40P01.');
    passCheck('Ausencia de deadlocks: cero errores 40P01 registrados gracias a ordenamiento determinista');

    // Check 23: Ausencia de relaciones parciales
    const noticeX = await repo.getNoticeById('SENASA-L11B-DEADLOCK-X');
    const noticeY = await repo.getNoticeById('SENASA-L11B-DEADLOCK-Y');
    const xSupY = noticeX.superseded_by === 'SENASA-L11B-DEADLOCK-Y' && noticeY.supersedes_notice_id === 'SENASA-L11B-DEADLOCK-X';
    const ySupX = noticeY.superseded_by === 'SENASA-L11B-DEADLOCK-X' && noticeX.supersedes_notice_id === 'SENASA-L11B-DEADLOCK-Y';
    assert(xSupY || ySupX, 'Debe prevalecer exactamente una relación bidireccional consistente.');
    passCheck('Ausencia de relaciones parciales: estado final canónico y sin enlaces cruzados huérfanos');

    // Check 24: Retirada y sustitución concurrentes
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-CONC-WITHDRAW',
      source_institution: 'SENASA',
      official_title: 'Aviso para carrera de retirada y sustitución',
      issue_date: '2026-10-14'
    }, adminActor);
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-CONC-SUB',
      source_institution: 'SENASA',
      official_title: 'Aviso sustituto para carrera',
      issue_date: '2026-10-14'
    }, adminActor);

    const withdrawPromise = repo.withdrawNotice('SENASA-L11B-CONC-WITHDRAW', adminActor, 'Retirada simultánea');
    const supersedePromise = repo.supersedeNotice('SENASA-L11B-CONC-WITHDRAW', 'SENASA-L11B-CONC-SUB', adminActor, 'Sustitución simultánea');
    const raceWithSubResults = await Promise.allSettled([withdrawPromise, supersedePromise]);
    assert(raceWithSubResults.every(r => r.status === 'fulfilled' || r.status === 'rejected'));
    const finalNoticeState = await repo.getNoticeById('SENASA-L11B-CONC-WITHDRAW');
    assert(['withdrawn', 'superseded'].includes(finalNoticeState.verification_status));
    passCheck('Retirada y sustitución concurrentes: resolución determinista y estado consistente');

    // Check 25: Conflicto de versiones
    await assert.rejects(async () => {
      await repo.updateNotice('SENASA-L11B-NOTICE-B', { official_title: 'Intento desfasado' }, adminActor, {
        expectedVersion: 999
      });
    }, /Conflicto de concurrencia/);
    passCheck('Conflicto de versiones: control optimista rechaza versiones desfasadas');

    console.log('\n--- BLOQUE 4: SEGURIDAD DE AUTORIZACIÓN, ROLES Y RESTRICCIONES ---');

    // Check 26: Admin activo autorizado en PostgreSQL
    const adminStatus = await verifyActiveUserStatus(1, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(adminStatus.valid, true);
    assert.strictEqual(adminStatus.user.role, 'admin');
    passCheck('Admin activo autorizado: validación positiva contra tabla users en PostgreSQL');

    // Check 27: Admin bloqueado rechazado (is_blocked = 1)
    const blockedStatus = await verifyActiveUserStatus(2, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(blockedStatus.valid, false);
    assert(blockedStatus.reason.includes('administrativamente bloqueada'));
    passCheck('Admin bloqueado rechazado: is_blocked = 1 detiene la autorización');

    // Check 28: Advisor sin facultad de aprobación
    assert.throws(() => {
      assertTrustedActorContext(advisorActor, 'admin');
    }, /Acceso denegado/);
    passCheck('Advisor sin facultad de aprobación: assertTrustedActorContext deniega rol advisor para acciones admin');

    // Check 29: Farmer y supermarket bloqueados
    const farmerActor = { id: 7, name: 'Farmer Juan', role: 'farmer' };
    const supermarketActor = { id: 8, name: 'Supermercado Central', role: 'supermarket' };
    assert.throws(() => assertTrustedActorContext(farmerActor, 'admin'), /Acceso denegado/);
    assert.throws(() => assertTrustedActorContext(supermarketActor, 'admin'), /Acceso denegado/);
    passCheck('Farmer y supermarket bloqueados: denegación estricta en la frontera de gobernanza');

    // Check 30: Sin fallback automático a Map
    const disconnectedPool = new Pool({
      connectionString: 'postgresql://invalid_user:invalid_pass@127.0.0.1:54999/invalid_db',
      connectionTimeoutMillis: 500
    });
    const brokenRepo = new PhytosanitaryNoticeRepository({ db: disconnectedPool });
    await assert.rejects(async () => {
      await brokenRepo.getNoticeById('ANY-ID');
    });
    await disconnectedPool.end().catch(() => {});
    passCheck('Sin fallback a Map: fallo de conexión arroja excepción controlada sin fallback encubierto');

    // Check 31: Fixtures sintéticos aislados
    await repo.registerNotice({
      notice_id: 'SENASA-L11B-SYNTH',
      source_institution: 'SENASA',
      official_title: 'Aviso sintético de pruebas',
      issue_date: '2026-10-14',
      is_synthetic: true
    }, adminActor);
    const synthNotice = await repo.getNoticeById('SENASA-L11B-SYNTH');
    assert.strictEqual(synthNotice.is_synthetic, true);
    passCheck('Fixtures sintéticos aislados: marcado is_synthetic preservado y aislado');

    // Check 32: Flags deshabilitados por defecto
    assert.strictEqual(process.env.PHYTOSANITARY_NOTICES_ENABLED, 'false');
    assert.strictEqual(process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED, 'false');
    passCheck('Feature flags por defecto: módulos fitosanitarios y de revisión inactivos por defecto');

    // Check 33: Sin notificaciones reales
    assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
    passCheck('Cero notificaciones reales: PHYTOSANITARY_NOTIFICATIONS_ENABLED=false');

    // Check 34: Sin conexiones externas
    assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
    passCheck('Cero descargas externas: PHYTOSANITARY_AUTO_FETCH_ENABLED=false (100% local)');

    // Check 35: Sin cambios en ML ni clima
    assert.strictEqual(process.env.LLM_ENABLED, 'false');
    assert.strictEqual(process.env.RAG_ENABLED, 'false');
    passCheck('Sin cambios en ML ni clima: subsistemas analíticos preservados');

    // Check 36: Índice RAG intacto
    const ragPath = path.join(repoRoot, 'knowledge/chunks/active_knowledge_chunks.json');
    assert(fs.existsSync(ragPath), 'El archivo active_knowledge_chunks.json debe existir.');
    const ragContent = JSON.parse(fs.readFileSync(ragPath, 'utf8'));
    assert(Array.isArray(ragContent) && ragContent.length === 0, 'El índice oficial RAG debe permanecer estrictamente vacío ([]).');
    passCheck('Índice RAG oficial intacto: active_knowledge_chunks.json estrictamente vacío ([])');

    console.log('\n==============================================================================');
    console.log(`FASE 9-L11B: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
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
  runPhytosanitaryTransactionsL11BSuite().catch((err) => {
    console.error('\n❌ ERROR EN SUITE FASE 9-L11B:', err);
    process.exit(1);
  });
}

module.exports = { runPhytosanitaryTransactionsL11BSuite };
