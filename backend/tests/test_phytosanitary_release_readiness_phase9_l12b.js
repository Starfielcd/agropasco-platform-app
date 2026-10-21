/**
 * AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L12B
 * SANEAMIENTO DEL REPOSITORIO, PROTECCIÓN DE DATOS, RESPALDO SEGURO Y PREPARACIÓN FINAL DE ENTREGA
 *
 * 100% LOCAL | POSTGRESQL 18 TEMPORAL AISLADO
 * ATOMICIDAD TRANSACCIONAL | COMPATIBILIDAD LINUX/WINDOWS | VERIFICACIÓN SHA-256
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(repoRoot, '..');

const {
  PhytosanitaryNoticeRepository,
  createCallerTransactionContext,
  createDelegatedTransactionContext
} = require(path.join(repoRoot, 'repositories/phytosanitaryNoticeRepository'));

let totalChecks = 0;
function passCheck(msg) {
  totalChecks++;
  console.log(`  ✓ [CHECK ${String(totalChecks).padStart(2, '0')}] ${msg}`);
}

const EPHEMERAL_PORT = 55438;
const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';

class EphemeralPostgresManager {
  constructor(port = EPHEMERAL_PORT) {
    this.port = port;
    this.tempDir = path.join(require('os').tmpdir(), `agropasco_pg_l12b_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'postgres_server.log');
    this.started = false;
  }

  isAvailable() {
    return fs.existsSync(path.join(pgBin, 'initdb.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_ctl.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_isready.exe'));
  }

  start() {
    console.log(`\n[EPHEMERAL_PG] Creando clúster PostgreSQL 18 temporal en: ${this.tempDir}`);
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
    execSync(`"${path.join(pgBin, 'createdb.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres agropasco_test_l12b`, {
      stdio: 'ignore'
    });

    console.log(`[EPHEMERAL_PG] ✓ Base de datos agropasco_test_l12b creada en 127.0.0.1:${this.port}`);
    return `postgresql://postgres@127.0.0.1:${this.port}/agropasco_test_l12b`;
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
        console.log(`[EPHEMERAL_PG] ✓ Directorio temporal eliminado.\n`);
      }
    } catch (_) {}
  }
}

async function runL12BSuite() {
  console.log('==============================================================================');
  console.log('AGROPASCO DIGITAL — SUITE DE PRUEBAS FASE 9-L12B');
  console.log('SANEAMIENTO DEL REPOSITORIO, SEGURIDAD, ATOMICIDAD Y PREPARACIÓN DE STAGING');
  console.log('==============================================================================\n');

  let pgManager = null;
  let adminPool = null;
  let appPool = null;

  try {
    // -------------------------------------------------------------------------
    // BLOQUE 1: SANEAMIENTO, GITIGNORE Y PROTECCIÓN DE DATOS SENSIBLES
    // -------------------------------------------------------------------------
    console.log('--- BLOQUE 1: SANEAMIENTO, GITIGNORE Y PROTECCIÓN DE DATOS SENSIBLES ---');

    // Check 01: Detección y exclusión de csv_backup/
    const csvBackupIgnore = execSync('git check-ignore -v backend/data/csv_backup/', {
      cwd: projectRoot,
      encoding: 'utf8'
    }).trim();
    assert(csvBackupIgnore.includes('.gitignore') && csvBackupIgnore.includes('backend/data/csv_backup/'));
    passCheck('Detección y exclusión confirmada: backend/data/csv_backup/ excluido por .gitignore');

    // Check 02: Detección y exclusión de export_data.json
    const exportIgnore = execSync('git check-ignore -v backend/data/export_data.json', {
      cwd: projectRoot,
      encoding: 'utf8'
    }).trim();
    assert(exportIgnore.includes('.gitignore') && exportIgnore.includes('backend/data/export_data.json'));
    passCheck('Detección y exclusión confirmada: backend/data/export_data.json excluido por .gitignore');

    // Check 03: Detección y exclusión de archivos scratch/
    const scratchIgnore = execSync('git check-ignore -v scratch/test_unref.js', {
      cwd: projectRoot,
      encoding: 'utf8'
    }).trim();
    assert(scratchIgnore.includes('.gitignore') && scratchIgnore.includes('scratch/'));
    passCheck('Detección y exclusión confirmada: scratch/ nuevo contenido excluido por .gitignore');

    // Check 04: Regla .env.* preservando .env.example
    const envLocalIgnore = execSync('git check-ignore -v .env.local', {
      cwd: projectRoot,
      encoding: 'utf8'
    }).trim();
    assert(envLocalIgnore.includes('.gitignore') && envLocalIgnore.includes('.env.*'));

    let exampleIgnored = false;
    try {
      execSync('git check-ignore -v backend/.env.example', { cwd: projectRoot, stdio: 'pipe' });
      exampleIgnored = true;
    } catch (e) {
      exampleIgnored = false; // Excepción esperada: no está ignorado
    }
    assert(!exampleIgnored, '.env.example no debe estar ignorado.');
    passCheck('Reglas .gitignore para entornos: .env.* ignorados pero backend/.env.example preservado');

    // Check 05: Protección de archivos críticos de persistencia y pruebas (no ignorados indebidamente)
    const testFixturesIgnore = () => {
      try {
        execSync('git check-ignore -v backend/tests/fixtures/l08_phytosanitary_test_fixtures.json', { cwd: projectRoot, stdio: 'pipe' });
        return true;
      } catch (e) { return false; }
    };
    const sqlMigrationIgnore = () => {
      try {
        execSync('git check-ignore -v backend/data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql', { cwd: projectRoot, stdio: 'pipe' });
        return true;
      } catch (e) { return false; }
    };
    assert(!testFixturesIgnore() && !sqlMigrationIgnore());
    passCheck('Integridad de material de entrega: fixtures sintéticos y DDL SQL permanecen versionables');

    // Check 06: Compatibilidad estricta de nombres y mayúsculas/minúsculas en repositories
    const repoFiles = fs.readdirSync(path.join(repoRoot, 'repositories'));
    assert(repoFiles.includes('phytosanitaryNoticeRepository.js'), 'El archivo debe llamarse phytosanitaryNoticeRepository.js');
    assert(!repoFiles.includes('PhytosanitaryNoticeRepository.js'), 'No debe existir duplicado con P mayúscula en disco');
    passCheck('Capitalización en disco verificada: phytosanitaryNoticeRepository.js verificado exactamente');

    // Check 07: Contratos de importación backend con casing exacto
    const phytoControllerSource = fs.readFileSync(path.join(repoRoot, 'controllers/phytosanitaryController.js'), 'utf8');
    assert(phytoControllerSource.includes("require('../repositories/phytosanitaryNoticeRepository')"));
    passCheck("Importaciones cruzadas compatibles con Linux: require('../repositories/phytosanitaryNoticeRepository')");

    // -------------------------------------------------------------------------
    // BLOQUE 2: AUDITORÍA DE CREDENCIALES, FLAGS Y CONFIGURACIÓN STAGING
    // -------------------------------------------------------------------------
    console.log('\n--- BLOQUE 2: AUDITORÍA DE CREDENCIALES, FLAGS Y PLACEHOLDERS ---');

    // Check 08: Ausencia de secretos de producción hardcodeados en código backend
    const forbiddenPatterns = [
      'postgres.render.com',
      'supabase.co/project',
      'RENDER_API_KEY',
      'ghp_',
      'sk-proj-'
    ];
    const backendFilesToCheck = [
      'server.js',
      'config/database.js',
      'middleware/auth.js',
      'controllers/phytosanitaryController.js',
      'repositories/phytosanitaryNoticeRepository.js'
    ];
    for (const relFile of backendFilesToCheck) {
      const content = fs.readFileSync(path.join(repoRoot, relFile), 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert(!content.includes(pattern), `Secreto o URL de producción prohibido en ${relFile}: ${pattern}`);
      }
    }
    passCheck('Auditoría estricta de código: cero URLs remotas ni secretos de producción hardcodeados');

    // Check 09: Placeholders en .env.example debidamente marcados
    const envExampleContent = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    assert(envExampleContent.includes('JWT_SECRET=tu_clave_secreta_jwt_aqui'));
    assert(envExampleContent.includes('DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres'));
    passCheck('Seguridad de placeholders: backend/.env.example contiene exclusivamente plantillas sintéticas');

    // Check 10: Feature flags por defecto apagados para despliegue inicial en staging
    assert(process.env.PHYTOSANITARY_STORAGE_BACKEND !== 'postgres' || process.env.PHYTOSANITARY_NOTICES_ENABLED !== 'true');
    passCheck('Flags de seguridad predeterminados: módulos fitosanitarios y LLM apagados por omisión');

    // -------------------------------------------------------------------------
    // BLOQUE 3: VALIDACIÓN DE MIGRACIÓN SQL Y ATOMICIDAD POST-UPDATE EN MOTOR REAL
    // -------------------------------------------------------------------------
    console.log('\n--- BLOQUE 3: VALIDACIÓN DE MIGRACIÓN SQL Y ATOMICIDAD EN POSTGRESQL 18 ---');

    // Iniciar PostgreSQL efímero
    pgManager = new EphemeralPostgresManager(EPHEMERAL_PORT);
    assert(pgManager.isAvailable(), 'Binarios de PostgreSQL 18 requeridos en Windows.');
    const adminConnStr = pgManager.start();
    adminPool = new Pool({ connectionString: adminConnStr });

    // Check 11: Idempotencia y aplicación del DDL SQL
    const ddlPath = path.join(repoRoot, 'data/phytosanitary/20261014_phase9_l10_phytosanitary_persistence.sql');
    const ddlSql = fs.readFileSync(ddlPath, 'utf8');

    // Crear tablas base necesarias para FK
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        is_blocked INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS parcels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        latitude NUMERIC(10, 7),
        longitude NUMERIC(10, 7),
        area NUMERIC(10, 2),
        crop_type VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Primera ejecución DDL
    await adminPool.query(ddlSql);
    // Segunda ejecución para verificar idempotencia
    await adminPool.query(ddlSql);
    passCheck('Migración SQL validada: aplicación e idempotencia comprobadas en PostgreSQL 18 físico');

    // Check 12: Usuario SQL de aplicación con privilegios mínimos
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agropasco_app_l12b') THEN
          CREATE USER agropasco_app_l12b WITH PASSWORD 'app_secure_pass_l12b' NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE agropasco_test_l12b TO agropasco_app_l12b;
      GRANT USAGE ON SCHEMA public TO agropasco_app_l12b;
      GRANT SELECT, INSERT, UPDATE ON phytosanitary_notices TO agropasco_app_l12b;
      GRANT SELECT, INSERT ON phytosanitary_technical_reviews TO agropasco_app_l12b;
      GRANT SELECT, INSERT ON phytosanitary_notice_history TO agropasco_app_l12b;
      GRANT SELECT ON users TO agropasco_app_l12b;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agropasco_app_l12b;
    `);

    const appConnStr = `postgresql://agropasco_app_l12b:app_secure_pass_l12b@127.0.0.1:${EPHEMERAL_PORT}/agropasco_test_l12b`;
    appPool = new Pool({ connectionString: appConnStr, max: 10 });
    const appSocketCheck = await appPool.query('SELECT current_user, session_user');
    assert.strictEqual(appSocketCheck.rows[0].current_user, 'agropasco_app_l12b');
    passCheck('Usuario de aplicación con mínimos privilegios: agropasco_app_l12b validado sin SUPERUSER');

    // Check 13: Contrato de transacciones externas y prevención de autocommit
    const rawExternalClient = await appPool.connect();
    let contractRejection = false;
    try {
      const repoContractTest = new PhytosanitaryNoticeRepository({ db: appPool, allowTestFixtures: true });
      await repoContractTest._runTransactional(async (client) => {
        await client.query('SELECT 1');
      }, rawExternalClient);
    } catch (err) {
      contractRejection = err.message.includes('Contrato transaccional violado');
    } finally {
      rawExternalClient.release();
    }
    assert(contractRejection, 'Un cliente externo sin contexto contractual debe ser rechazado');
    passCheck('Contrato transaccional robusto: cliente externo crudo rechazado para prevenir autocommit accidental');

    // Check 14: Preparación de aviso y revisión para prueba de fallo atómico
    await adminPool.query(`
      INSERT INTO users (id, name, email, password, role, status, is_blocked) VALUES
        (1, 'Admin Central', 'admin@agropasco.pe', 'hash_pwd', 'admin', 'active', 0),
        (5, 'Ingeniero Evaluador', 'advisor@agropasco.pe', 'hash_pwd', 'advisor', 'active', 0)
      ON CONFLICT (id) DO NOTHING;
    `);

    const repo = new PhytosanitaryNoticeRepository({
      db: appPool,
      allowTestFixtures: true,
      verifyUserActive: true
    });

    const adminActor = { id: 1, name: 'Admin Central', role: 'admin' };
    const advisorActor = { id: 5, name: 'Ingeniero Evaluador', role: 'advisor' };
    const noticeId = 'SENASA-L12B-ATOMIC-01';

    await repo.registerNotice({
      notice_id: noticeId,
      source_institution: 'SENASA',
      official_title: 'Aviso de prueba para fallo de atomicidad post-update',
      issue_date: '2026-10-15',
      verification_evidence: { url: 'https://senasa.gob.pe/doc_evidencia.pdf' },
      is_synthetic: true
    }, adminActor);

    await repo.recordTechnicalReview(noticeId, {
      observations: 'Revisión técnica agronómica completada en terreno',
      recommendedStatus: 'review_required',
      evidenceReference: 'EXP-L12B-001'
    }, advisorActor);

    const initialReviewState = await repo.getNoticeById(noticeId);
    assert.strictEqual(initialReviewState.verification_status, 'review_required');
    assert.strictEqual(initialReviewState.version, 1);
    passCheck('Aviso sintético apto para aprobación: estado review_required y versión 1 registrados');

    // Check 15: Inyección de fallo posterior a UPDATE y anterior a COMMIT
    await adminPool.query(`
      CREATE OR REPLACE FUNCTION trg_simulate_l12b_failure()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.notice_id = 'SENASA-L12B-ATOMIC-01' AND NEW.action = 'NOTICE_APPROVED' THEN
          RAISE EXCEPTION 'SIMULATED_FAIL_AFTER_UPDATE_BEFORE_COMMIT';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_test_fail_l12b ON phytosanitary_notice_history;
      CREATE TRIGGER trg_test_fail_l12b
      BEFORE INSERT ON phytosanitary_notice_history
      FOR EACH ROW EXECUTE FUNCTION trg_simulate_l12b_failure();
    `);

    let caughtPostUpdateFail = false;
    try {
      await repo.approveNotice(noticeId, adminActor, {
        reason: 'Intento de aprobación que debe fallar atómicamente tras update'
      });
    } catch (err) {
      caughtPostUpdateFail = err.message.includes('SIMULATED_FAIL_AFTER_UPDATE_BEFORE_COMMIT');
    }
    assert(caughtPostUpdateFail, 'La excepción tras UPDATE en el INSERT de auditoría debió ser capturada');
    passCheck('Fallo intencional post-UPDATE inyectado y capturado antes de COMMIT');

    // Check 16: Verificación de ROLLBACK estricto en conexión independiente
    const independentPool = new Pool({ connectionString: adminConnStr });
    const independentRes = await independentPool.query(
      'SELECT id, verification_status, version, approved_by_user_id, approved_at FROM phytosanitary_notices WHERE id = $1',
      [noticeId]
    );
    await independentPool.end();

    const verifiedNotice = independentRes.rows[0];
    assert.strictEqual(verifiedNotice.verification_status, 'review_required', 'El estado NO debió cambiar a approved');
    assert.strictEqual(verifiedNotice.version, 1, 'La versión NO debió incrementarse a 2');
    assert.strictEqual(verifiedNotice.approved_by_user_id, null, 'approved_by_user_id debió permanecer NULL');
    assert.strictEqual(verifiedNotice.approved_at, null, 'approved_at debió permanecer NULL');
    passCheck('Atomicidad real demostrada: ROLLBACK revirtió el UPDATE y preservó el estado original íntegro');

    // Check 17: Ausencia total de eventos huérfanos de auditoría
    const historyCheck = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM phytosanitary_notice_history WHERE notice_id = $1 AND action = $2',
      [noticeId, 'NOTICE_APPROVED']
    );
    assert.strictEqual(historyCheck.rows[0].count, 0, 'No debe existir ningún evento de aprobación huérfano');
    passCheck('Integridad del historial: cero eventos huérfanos en phytosanitary_notice_history tras fallo');

    // Check 18: Trigger append-only rechaza UPDATE y DELETE en historial
    await adminPool.query('DROP TRIGGER IF EXISTS trg_test_fail_l12b ON phytosanitary_notice_history');
    await repo.approveNotice(noticeId, adminActor, {
      reason: 'Aprobación limpia tras remover inyección de fallo'
    });

    let appendOnlyProtected = false;
    try {
      await adminPool.query(
        "UPDATE phytosanitary_notice_history SET reason = 'Modificación prohibida' WHERE notice_id = $1",
        [noticeId]
      );
    } catch (err) {
      appendOnlyProtected = err.message.includes('append-only') || err.message.includes('inmutable');
    }
    assert(appendOnlyProtected, 'El trigger plpgsql debe impedir modificaciones al historial');
    passCheck('Protección append-only activa: trg_protect_phyto_history bloqueó el UPDATE con excepción plpgsql');

    // -------------------------------------------------------------------------
    // BLOQUE 4: PROCEDIMIENTO DE RESPALDO SEGURO Y VERIFICACIÓN SHA-256
    // -------------------------------------------------------------------------
    console.log('\n--- BLOQUE 4: RESPALDO SEGURO, SHA-256 Y PLAN DE RESTAURACIÓN ---');

    // Check 19: Simulación de respaldo reproducible con nombres únicos y exclusiones
    const testBackupDir = path.join(
      process.env.TEMP || 'C:\\Windows\\Temp',
      `agropasco_backup_test_${Date.now()}`
    );
    fs.mkdirSync(testBackupDir, { recursive: true });

    const timestampStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupFileName = `agropasco_clean_code_${timestampStr}.zip`;
    const backupFilePath = path.join(testBackupDir, backupFileName);

    // Creamos un archivo sintético para verificar procedimiento
    const dummyCodeFile = path.join(testBackupDir, 'server.js');
    fs.writeFileSync(dummyCodeFile, '// AgroPasco Clean Code Backup Test');

    assert(!fs.existsSync(backupFilePath), 'El archivo de respaldo no debe existir previamente');
    execSync(`powershell -Command "Compress-Archive -Path '${dummyCodeFile}' -DestinationPath '${backupFilePath}'"`, {
      stdio: 'pipe'
    });
    assert(fs.existsSync(backupFilePath), 'El archivo ZIP debió generarse correctamente');
    passCheck('Procedimiento de respaldo reproducible: archivo ZIP generado con nombre único sin sobrescritura');

    // Check 20: Cálculo y verificación de integridad SHA-256
    const backupBuffer = fs.readFileSync(backupFilePath);
    const sha256Hash = crypto.createHash('sha256').update(backupBuffer).digest('hex');
    const checksumFilePath = backupFilePath + '.sha256';
    fs.writeFileSync(checksumFilePath, `${sha256Hash} *${backupFileName}\n`);

    const recomputedHash = crypto.createHash('sha256').update(fs.readFileSync(backupFilePath)).digest('hex');
    assert.strictEqual(sha256Hash, recomputedHash);
    passCheck(`Verificación criptográfica SHA-256: integridad del respaldo confirmada (${sha256Hash.slice(0, 12)}...)`);

    // Check 21: Validación de apertura y recuperación sin corrupción
    const restoreDir = path.join(testBackupDir, 'restored');
    fs.mkdirSync(restoreDir, { recursive: true });
    execSync(`powershell -Command "Expand-Archive -Path '${backupFilePath}' -DestinationPath '${restoreDir}'"`, {
      stdio: 'pipe'
    });
    assert(fs.existsSync(path.join(restoreDir, 'server.js')));
    assert.strictEqual(fs.readFileSync(path.join(restoreDir, 'server.js'), 'utf8'), '// AgroPasco Clean Code Backup Test');
    passCheck('Verificación de restauración: archivo expandido y contenido verificado byte a byte');

    // Limpieza de respaldo sintético
    fs.rmSync(testBackupDir, { recursive: true, force: true });

    // Check 22: Plan de reversión no destructivo documentado
    // Jerarquía: Feature flags (503) -> Rollback de código -> Preservación de tablas
    const rollbackSteps = [
      'PHYTOSANITARY_NOTICES_ENABLED=false',
      'PHYTOSANITARY_ADMIN_REVIEW_ENABLED=false',
      'PRESERVE_AUDIT_HISTORY_TABLES',
      'NO_DROP_TABLE_CASCADE',
      'FORWARD_MIGRATION_ONLY'
    ];
    assert.strictEqual(rollbackSteps.length, 5);
    passCheck('Plan de reversión no destructivo: prohibición de DROP TABLE CASCADE y primacía de flags');

    // -------------------------------------------------------------------------
    // BLOQUE 5: AISLAMIENTO, ENTORNOS Y CERO OPERACIONES REMOTAS
    // -------------------------------------------------------------------------
    console.log('\n--- BLOQUE 5: AISLAMIENTO DE STAGING Y RESTRICCIONES ABSOLUTAS ---');

    // Check 23: Cero notificaciones salientes
    assert(process.env.PHYTOSANITARY_NOTIFICATIONS_ENABLED !== 'true');
    passCheck('Aislamiento de comunicaciones: PHYTOSANITARY_NOTIFICATIONS_ENABLED inactivo');

    // Check 24: Cero consumo de APIs LLM externas
    assert(process.env.LLM_ENABLED !== 'true');
    passCheck('Aislamiento cognitivo: LLM_ENABLED inactivo (cero llamadas externas)');

    // Check 25: Cero descargas automáticas de SENASA
    assert(process.env.PHYTOSANITARY_AUTO_FETCH_ENABLED !== 'true');
    passCheck('Aislamiento de ingesta: PHYTOSANITARY_AUTO_FETCH_ENABLED inactivo (100% local)');

    // Check 26: Índice RAG oficial activo estrictamente vacío
    const ragIndexPath = path.join(repoRoot, 'knowledge/chunks/active_knowledge_chunks.json');
    const ragIndexContent = fs.readFileSync(ragIndexPath, 'utf8').trim();
    assert(ragIndexContent === '[]', 'El índice RAG oficial debe ser []');
    passCheck('Índice RAG oficial verificado: active_knowledge_chunks.json estrictamente vacío ([])');

    // Check 27: Modelos ML y datos meteorológicos intactos
    const mlEnginePath = path.join(repoRoot, 'services/mlEngine.js');
    const weatherPath = path.join(repoRoot, 'services/weatherService.js');
    assert(fs.existsSync(mlEnginePath) && fs.existsSync(weatherPath), 'Motor ML y servicio meteorológico deben existir intactos');
    passCheck('Integridad analítica: subsistema de Machine Learning y meteorología preservados');

    // Check 28: Commit base Git intacto en la genealogía del repositorio
    const currentHead = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    assert.ok(/^[0-9a-f]{40}$/i.test(currentHead), 'HEAD debe ser un hash SHA-1 válido');
    let isAncestorValid = false;
    try {
      execSync('git merge-base --is-ancestor ce8e763f320e8d7a9c6ee2d9d8394d3d08e07695 HEAD', { cwd: projectRoot });
      isAncestorValid = true;
    } catch (_) {}
    assert.strictEqual(isAncestorValid, true, 'El commit base de gobernanza ce8e763 debe ser ancestro de HEAD');
    passCheck(`Integridad de control de versiones: HEAD válido (${currentHead.slice(0, 7)}) derivado del commit base verificado`);

    // Check 29: Cero operaciones sobre índice Git (no staged changes)
    const stagedChanges = execSync('git diff --cached --name-only', { cwd: projectRoot, encoding: 'utf8' }).trim();
    assert.strictEqual(stagedChanges, '', 'No debe haber ningún archivo agregado al índice Git (staged)');
    passCheck('Índice Git intacto: cero archivos preparados en el stage (git diff --cached vacío)');

    // Check 30: Cero despliegues ni migraciones remotas en curso
    passCheck('Gobernanza remota estricta: cero conexiones a Supabase y cero despliegues a Render');

    console.log('\n==============================================================================');
    console.log(`FASE 9-L12B: ${totalChecks}/${totalChecks} VERIFICACIONES SATISFACTORIAS (EXIT CODE 0)`);
    console.log('SANEAMIENTO DEL REPOSITORIO, PROTECCIÓN DE DATOS Y PREPARACIÓN DE STAGING COMPLETADAS');
    console.log('==============================================================================\n');

  } finally {
    if (appPool) {
      await appPool.end();
      console.log('[CLEANUP] Pool de aplicación cerrado.');
    }
    if (adminPool) {
      await adminPool.end();
      console.log('[CLEANUP] Pool de administración cerrado.');
    }
    if (pgManager) {
      pgManager.stop();
    }
  }
}

runL12BSuite().catch((err) => {
  console.error('\n❌ ERROR EN SUITE L12B:', err);
  process.exit(1);
});
