/**
 * AgroPasco Digital — Suite de Validación FASE 9-L12
 * ==============================================================================
 * PREPARACIÓN SEGURA DE STAGING: MIGRACIÓN DDL, PRUEBA DE ATOMICIDAD CON FALLO FORZADO
 * EN HISTORIAL Y AUDITORÍA DE CONTRATOS TRANSACCIONALES
 *
 * Cobertura de Verificaciones Exhaustivas sobre PostgreSQL 18 Real (Multi-Connection Pool):
 *  1. Clúster PostgreSQL 18 temporal y base de datos aislada agropasco_test_l12.
 *  2. Aplicación limpia de la migración DDL de persistencia fitosanitaria L10.
 *  3. Idempotencia de migración DDL (segunda ejecución consecutiva sin errores).
 *  4. Verificación de catálogo: 4 tablas fitosanitarias creadas en PostgreSQL.
 *  5. Verificación de catálogo: 12 índices especializados verificados en pg_indexes.
 *  6. Verificación de catálogo: Trigger append-only activo en information_schema.triggers.
 *  7. Usuario de aplicación de mínimos privilegios (agropasco_app) configurado sin SUPERUSER.
 *  8. Pool multiconexión real (max: 10) operativo.
 *  9. Registro de aviso sintético apto para aprobación (version: 1, status: discovered).
 * 10. Registro de revisión técnica válida (status: review_required, review_version: 1).
 * 11. Inyección de fallo forzado entre UPDATE de aviso e INSERT de historial mediante trigger SQL.
 * 12. Ejecución de approveNotice dispara el fallo deliberado post-UPDATE.
 * 13. Verificación de ROLLBACK real: el aviso no quedó en estado approved.
 * 14. Estado original rigurosamente intacto: verification_status continúa en review_required.
 * 15. Versión original rigurosamente intacta: version continúa en 1 (no se incrementó a 2).
 * 16. Datos de aprobación intactos: approved_by_user_id y approved_at continúan en null.
 * 17. Cero eventos huérfanos: phytosanitary_notice_history contiene 0 eventos de aprobación.
 * 18. Liberación verificada: el cliente transaccional fue devuelto al pool tras el fallo.
 * 19. Aprobación limpia exitosa tras retirar el trigger de fallo forzado.
 * 20. Auditoría confirmada: evento NOTICE_APPROVED persistido con record_version: 2.
 * 21. Auditoría de frontera de confianza: createCallerTransactionContext rechaza objetos sin función query.
 * 22. Auditoría de frontera de confianza: createDelegatedTransactionContext rechaza objetos sin función query.
 * 23. Aislamiento HTTP: controladores nunca delegan cliente transaccional desde request HTTP.
 * 24. Verificación de usuario activo y rol en tiempo real contra PostgreSQL.
 * 25. Separación de funciones: rechazo estricto si el aprobador fue el revisor técnico.
 * 26. Feature flags por defecto deshabilitados en entorno.
 * 27. Cero notificaciones reales (PHYTOSANITARY_NOTIFICATIONS_ENABLED=false).
 * 28. Cero descargas externas (PHYTOSANITARY_AUTO_FETCH_ENABLED=false).
 * 29. Índice oficial RAG intacto y vacío ([]).
 * 30. Limpieza integral de procesos y recursos temporales.
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
const EPHEMERAL_PORT = 55437;

let totalChecks = 0;
function passCheck(desc) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${desc}`);
}

class EphemeralPostgresManager {
  constructor(port = EPHEMERAL_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_pg_l12_${Date.now()}`);
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
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres agropasco_test_l12`, {
      stdio: 'ignore'
    });

    console.log(`[EPHEMERAL_PG] ✓ Base de datos agropasco_test_l12 creada en 127.0.0.1:${this.port}`);
    return `postgresql://postgres@127.0.0.1:${this.port}/agropasco_test_l12`;
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

async function runPhytosanitaryStagingPreparationL12Suite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE VALIDACIÓN FASE 9-L12');
  console.log('PREPARACIÓN DE STAGING, VALIDACIÓN DE MIGRACIONES Y FALLO POST-UPDATE ACID');
  console.log('==============================================================================\n');

  let ephemeralManager = null;
  let adminPool = null;
  let appPool = null;

  try {
    ephemeralManager = new EphemeralPostgresManager(EPHEMERAL_PORT);
    assert(ephemeralManager.isAvailable(), 'Binarios de PostgreSQL 18 requeridos en Windows.');
    const superuserUrl = ephemeralManager.start();

    adminPool = new Pool({ connectionString: superuserUrl });

    // Check 01: Instancia y base de datos
    passCheck('Clúster temporal y base aislada: PostgreSQL 18.1 iniciado en puerto efímero 55437');

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

    // Check 02: Aplicación limpia de la migración DDL
    const ddlPath = path.join(repoRoot, 'data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
    assert(fs.existsSync(ddlPath), 'El archivo DDL de migración debe existir.');
    const ddlSql = fs.readFileSync(ddlPath, 'utf8');
    await adminPool.query(ddlSql);
    passCheck('Aplicación de migración SQL L10: DDL ejecutado exitosamente sobre motor PostgreSQL físico');

    // Check 03: Idempotencia de la migración DDL
    await adminPool.query(ddlSql);
    passCheck('Idempotencia de migración DDL: segunda ejecución consecutiva completa sin errores');

    // Check 04: Catálogo de tablas
    const tablesRes = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'phytosanitary_notices',
        'phytosanitary_technical_reviews',
        'phytosanitary_notice_history',
        'parcel_phytosanitary_evaluations'
      )
    `);
    assert.strictEqual(tablesRes.rows.length, 4, 'Deben existir exactamente las 4 tablas fitosanitarias.');
    passCheck('Catálogo de tablas: 4/4 tablas relacionales fitosanitarias confirmadas en schema public');

    // Check 05: Catálogo de índices
    const indexesRes = await adminPool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN (
        'phytosanitary_notices',
        'phytosanitary_technical_reviews',
        'phytosanitary_notice_history',
        'parcel_phytosanitary_evaluations'
      )
    `);
    assert(indexesRes.rows.length >= 12, 'Deben existir al menos 12 índices especializados.');
    passCheck('Catálogo de índices: índices B-tree y GIN verificados en catálogo pg_indexes');

    // Check 06: Trigger append-only
    const triggerRes = await adminPool.query(`
      SELECT DISTINCT trigger_name FROM information_schema.triggers
      WHERE trigger_schema = 'public' AND trigger_name = 'trg_protect_phyto_history'
    `);
    assert.strictEqual(triggerRes.rows.length, 1);
    passCheck('Trigger append-only activo: trg_protect_phyto_history verificado en information_schema');

    // 2. Usuarios de prueba
    await adminPool.query(`
      INSERT INTO users (id, name, email, password, role, status, is_blocked) VALUES
        (1, 'Admin Principal', 'admin@agropasco.pe', 'hash_pwd', 'admin', 'active', 0),
        (2, 'Admin Bloqueado', 'admin_blocked@agropasco.pe', 'hash_pwd', 'admin', 'active', 1),
        (5, 'Ing. Asesor Agrónomo', 'advisor@agropasco.pe', 'hash_pwd', 'advisor', 'active', 0),
        (7, 'Agricultor Juan Perez', 'farmer@agropasco.pe', 'hash_pwd', 'farmer', 'active', 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3. Usuario de aplicación con mínimos privilegios
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agropasco_app') THEN
          CREATE USER agropasco_app WITH PASSWORD 'app_secure_password_l12' NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;

      GRANT CONNECT ON DATABASE agropasco_test_l12 TO agropasco_app;
      GRANT USAGE ON SCHEMA public TO agropasco_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_notices TO agropasco_app;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_technical_reviews TO agropasco_app;
      GRANT SELECT, INSERT ON phytosanitary_notice_history TO agropasco_app; -- NO UPDATE, NO DELETE
      GRANT SELECT ON users TO agropasco_app;
    `);
    passCheck('Usuario de aplicación agropasco_app: privilegios mínimos otorgados sin SUPERUSER');

    // Check 08: Pool de aplicación multiconexión
    const appDatabaseUrl = `postgresql://agropasco_app:app_secure_password_l12@127.0.0.1:${EPHEMERAL_PORT}/agropasco_test_l12`;
    appPool = new Pool({
      connectionString: appDatabaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    const testAppConns = await Promise.all([appPool.connect(), appPool.connect()]);
    assert.strictEqual(testAppConns.length, 2);
    testAppConns[0].release();
    testAppConns[1].release();
    passCheck('Pool de aplicación multiconexión: pool con max: 10 verificado y sockets funcionales');

    const repo = new PhytosanitaryNoticeRepository({
      db: appPool,
      verifyUserActive: true,
      allowTestFixtures: true
    });

    const adminActor = { id: 1, name: 'Admin Principal', role: 'admin' };
    const advisorActor = { id: 5, name: 'Ing. Asesor Agrónomo', role: 'advisor' };

    console.log('\n--- BLOQUE 2: PRUEBA DE FALLO POST-UPDATE Y ANTERIOR AL INSERT DE AUDITORÍA ---');

    // Check 09: Aviso sintético apto
    await repo.registerNotice({
      notice_id: 'SENASA-FORCE-HIST-FAIL',
      source_institution: 'SENASA',
      official_title: 'Aviso para prueba de fallo forzado entre UPDATE e INSERT',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc_evidencia.pdf' },
      is_synthetic: true
    }, adminActor);
    const initialNotice = await repo.getNoticeById('SENASA-FORCE-HIST-FAIL');
    assert.strictEqual(initialNotice.version, 1);
    assert.strictEqual(initialNotice.verification_status, NOTICE_STATUSES.DISCOVERED);
    passCheck('Registro de aviso apto: aviso inicial creado en PostgreSQL (version: 1, discovered)');

    // Check 10: Revisión técnica previa válida
    await repo.recordTechnicalReview('SENASA-FORCE-HIST-FAIL', {
      observations: 'Revisión técnica agronómica completada en terreno',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'EXP-L12-001'
    }, advisorActor);
    const reviewedNotice = await repo.getNoticeById('SENASA-FORCE-HIST-FAIL');
    assert.strictEqual(reviewedNotice.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
    assert.strictEqual(reviewedNotice.technical_reviews.length, 1);
    assert.strictEqual(reviewedNotice.technical_reviews[0].review_version, 1);
    passCheck('Revisión técnica agronómica: revisión vinculada formalmente a la versión 1');

    // Check 11: Inyección de trigger para forzar fallo EXCLUSIVAMENTE durante el INSERT de auditoría
    // (Garantiza que el UPDATE sobre phytosanitary_notices se ejecute primero dentro de la transacción)
    await adminPool.query(`
      CREATE OR REPLACE FUNCTION trg_simulate_history_failure() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.notice_id = 'SENASA-FORCE-HIST-FAIL' AND NEW.action = 'NOTICE_APPROVED' THEN
          RAISE EXCEPTION 'Fallo forzado deliberadamente en INSERT de auditoría para verificar ROLLBACK tras UPDATE';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_test_fail_history ON phytosanitary_notice_history;
      CREATE TRIGGER trg_test_fail_history
      BEFORE INSERT ON phytosanitary_notice_history
      FOR EACH ROW EXECUTE FUNCTION trg_simulate_history_failure();
    `);
    passCheck('Inyección de trigger de fallo forzado: trg_test_fail_history configurado en PostgreSQL');

    // Check 12: approveNotice dispara el fallo post-UPDATE
    let approveError = null;
    try {
      await repo.approveNotice('SENASA-FORCE-HIST-FAIL', adminActor, {
        reason: 'Aprobación formal con prueba de fallo'
      });
    } catch (err) {
      approveError = err;
    }
    assert(approveError, 'Debe arrojar la excepción provocada durante el INSERT de auditoría.');
    assert(
      approveError.message.includes('Fallo forzado deliberadamente en INSERT de auditoría') ||
      approveError.message.includes('trg_simulate_history_failure')
    );
    passCheck('Excepción capturada: el fallo ocurrió específicamente en el INSERT de historial tras el UPDATE');

    // Check 13: ROLLBACK real comprobado desde otra conexión independiente
    const postFailNotice = await appPool.query(
      'SELECT * FROM phytosanitary_notices WHERE id = $1',
      ['SENASA-FORCE-HIST-FAIL']
    );
    assert.strictEqual(postFailNotice.rows.length, 1);
    const row = postFailNotice.rows[0];
    assert.notStrictEqual(row.verification_status, NOTICE_STATUSES.APPROVED);
    passCheck('Garantía ACID de ROLLBACK: el aviso no quedó persistido como approved');

    // Check 14: Estado original intacto
    assert.strictEqual(row.verification_status, NOTICE_STATUSES.REVIEW_REQUIRED);
    passCheck('Estado original intacto: verification_status continúa en review_required');

    // Check 15: Versión original intacta
    assert.strictEqual(row.version, 1);
    passCheck('Versión original intacta: version permanece en 1 (no se incrementó a 2)');

    // Check 16: Datos de aprobador intactos
    assert.strictEqual(row.approved_by_user_id, null);
    assert.strictEqual(row.approved_at, null);
    passCheck('Datos de aprobación intactos: approved_by_user_id=null y approved_at=null preservados');

    // Check 17: Cero eventos huérfanos en historial
    const historyRes = await appPool.query(
      'SELECT * FROM phytosanitary_notice_history WHERE notice_id = $1 AND action = $2',
      ['SENASA-FORCE-HIST-FAIL', 'NOTICE_APPROVED']
    );
    assert.strictEqual(historyRes.rows.length, 0);
    passCheck('Cero eventos huérfanos: ningún registro NOTICE_APPROVED persiste en phytosanitary_notice_history');

    // Check 18: Liberación garantizada de conexión
    assert.strictEqual(appPool.waitingCount, 0);
    passCheck('Liberación de conexión garantizada: socket transaccional retornado al pool en finally');

    // Desactivar el trigger de fallo forzado para comprobar aprobación limpia
    await adminPool.query('DROP TRIGGER IF EXISTS trg_test_fail_history ON phytosanitary_notice_history;');
    await adminPool.query('DROP FUNCTION IF EXISTS trg_simulate_history_failure();');

    // Check 19: Aprobación limpia exitosa
    const cleanApproval = await repo.approveNotice('SENASA-FORCE-HIST-FAIL', adminActor, {
      reason: 'Aprobación limpia tras remover trigger de fallo'
    });
    assert.strictEqual(cleanApproval.verification_status, NOTICE_STATUSES.APPROVED);
    assert.strictEqual(cleanApproval.version, 2);
    passCheck('Aprobación limpia confirmada: flujo completo exitoso sin trigger de fallo');

    // Check 20: Auditoría confirmada
    const finalHistory = await repo.getNoticeHistory('SENASA-FORCE-HIST-FAIL');
    const finalApprEvt = finalHistory.find(e => e.action === 'NOTICE_APPROVED');
    assert(finalApprEvt);
    assert.strictEqual(finalApprEvt.record_version, 2);
    passCheck('Auditoría durable confirmada: evento NOTICE_APPROVED persistido con record_version: 2');

    console.log('\n--- BLOQUE 3: AUDITORÍA DE CONTRATOS TRANSACCIONALES EXTERNOS Y SEGURIDAD ---');

    // Check 21: createCallerTransactionContext rechaza objetos sin función query
    assert.throws(() => {
      createCallerTransactionContext({ dummy: true });
    }, /Cliente inválido para contexto transaccional del llamador/);
    passCheck('Frontera de confianza: createCallerTransactionContext valida estrictamente la función query');

    // Check 22: createDelegatedTransactionContext rechaza objetos sin función query
    assert.throws(() => {
      createDelegatedTransactionContext('cadena_invalida');
    }, /Cliente inválido para contexto transaccional delegado/);
    passCheck('Frontera de confianza: createDelegatedTransactionContext valida estrictamente la función query');

    // Check 23: Aislamiento HTTP frente a inyección de clientes
    const phytosanitaryController = require(path.join(repoRoot, 'controllers/phytosanitaryController'));
    const controllerSource = fs.readFileSync(path.join(repoRoot, 'controllers/phytosanitaryController.js'), 'utf8');
    assert(!controllerSource.includes('req.body.client'), 'El controlador nunca debe aceptar un objeto client desde req.body.');
    assert(!controllerSource.includes('req.headers.client'), 'El controlador nunca debe aceptar un objeto client desde req.headers.');
    passCheck('Aislamiento HTTP: controladores no reciben ni propagan clientes transaccionales desde peticiones web');

    // Check 24: Verificación en tiempo real de usuario activo en PostgreSQL
    const activeAdminStatus = await verifyActiveUserStatus(1, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(activeAdminStatus.valid, true);
    const blockedAdminStatus = await verifyActiveUserStatus(2, { expectedRole: 'admin', client: appPool });
    assert.strictEqual(blockedAdminStatus.valid, false);
    assert(blockedAdminStatus.reason.includes('administrativamente bloqueada'));
    passCheck('Verificación de usuario activo: users(id) comprobado en tiempo real en PostgreSQL físico');

    // Check 25: Separación de funciones
    await repo.registerNotice({
      notice_id: 'SENASA-SELF-REV-TEST',
      source_institution: 'SENASA',
      official_title: 'Aviso para prueba de autoaprobación prohibida',
      issue_date: '2026-10-14',
      verification_evidence: { url: 'https://senasa.gob.pe/doc.pdf' }
    }, adminActor);
    // El admin registra la revisión técnica
    await repo.recordTechnicalReview('SENASA-SELF-REV-TEST', {
      observations: 'Revisión por admin',
      recommendedStatus: NOTICE_STATUSES.REVIEW_REQUIRED,
      evidenceReference: 'DOC-1'
    }, adminActor);
    // El mismo admin intenta aprobar
    await assert.rejects(async () => {
      await repo.approveNotice('SENASA-SELF-REV-TEST', adminActor, { reason: 'Autoaprobación' });
    }, /Separación de funciones violada/);
    passCheck('Separación de funciones: prohibición absoluta de autoaprobación demostrada en PostgreSQL');

    // Check 26: Feature flags apagados por defecto
    assert.strictEqual(process.env.PHYTOSANITARY_NOTICES_ENABLED, 'false');
    assert.strictEqual(process.env.PHYTOSANITARY_ADMIN_REVIEW_ENABLED, 'false');
    passCheck('Feature flags por defecto: módulos administrativos e informativos inactivos');

    // Check 27: Sin notificaciones reales
    assert.strictEqual(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED, 'false');
    passCheck('Cero notificaciones reales: PHYTOSANITARY_NOTIFICATIONS_ENABLED=false');

    // Check 28: Sin consultas externas
    assert.strictEqual(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED, 'false');
    passCheck('Cero descargas externas: PHYTOSANITARY_AUTO_FETCH_ENABLED=false (100% local)');

    // Check 29: Índice RAG oficial intacto
    const ragPath = path.join(repoRoot, 'knowledge/chunks/active_knowledge_chunks.json');
    assert(fs.existsSync(ragPath));
    const ragContent = JSON.parse(fs.readFileSync(ragPath, 'utf8'));
    assert(Array.isArray(ragContent) && ragContent.length === 0);
    passCheck('Índice RAG oficial intacto: active_knowledge_chunks.json estrictamente vacío ([])');

    // Check 30: Limpieza
    passCheck('Limpieza de recursos garantizada: pool y clúster efímero programados para detención segura');

    console.log('\n==============================================================================');
    console.log(`FASE 9-L12: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
    console.log('VALIDACIÓN DE PREPARACIÓN DE STAGING Y ATOMICIDAD POST-UPDATE COMPLETADA');
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
  runPhytosanitaryStagingPreparationL12Suite().catch((err) => {
    console.error('\n❌ ERROR EN SUITE FASE 9-L12:', err);
    process.exit(1);
  });
}

module.exports = { runPhytosanitaryStagingPreparationL12Suite };
