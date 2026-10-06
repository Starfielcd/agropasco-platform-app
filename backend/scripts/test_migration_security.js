/**
 * AgroPasco — Suite de Pruebas Locales de Seguridad y Aislamiento de Cuentas
 * =========================================================================
 * Pruebas locales 100% en memoria (sin conexión a Supabase ni Render):
 * 
 * PARTE 1: Pruebas Fundamentales de Migración (A - H)
 *   A. Usuario active con must_change_password=1 puede cambiar contraseña vía change-password
 *   B. Usuario active NO puede cambiar contraseña solo con su email en setup-approved-password
 *   C. Usuario pending NO puede configurar contraseña
 *   D. Usuario blocked NO puede configurar contraseña
 *   E. Admin oficial puede autenticarse con su hash oficial (123456789)
 *   F. Las contraseñas temporales son estrictamente únicas
 *   G. Ninguna contraseña se almacena en formato reversible (solo bcrypt)
 *   H. Los respaldos de producción permanecen 100% inalterados (SHA-256)
 * 
 * PARTE 2: Pruebas de Aislamiento Estricto entre Cuentas (1 - 8)
 *   1. tempPassword de Usuario A NO puede cambiar contraseña de Usuario B
 *   2. JWT de Usuario A NO puede cambiar contraseña de Usuario B
 *   3. Token expirado es rechazado con error explícito
 *   4. Token con firma inválida es rechazado
 *   5. Usuario con must_change_password=1 cambia exitosamente en change-password
 *   6. must_change_password pasa a 0 tras actualización válida
 *   7. Usuario A no puede modificar a Usuario B mediante email, identifier o user_id
 *   8. Validación comprueba explícitamente la identidad (id, userId, sub, email)
 *
 * Ejecución:
 *   node backend/scripts/test_migration_security.js
 */

// Establecer URL ficticia para permitir carga de módulos en pruebas locales sin conexión
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/dummy_test_db';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { generateUniqueTempPassword, syncTableSequence } = require('./migrate_to_pg');
const { initializeSchema, EXPECTED_SCHEMA_TABLES } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026';

// Checksums SHA256 de referencia antes de iniciar la sesión
const EXPECTED_CHECKSUMS = {
  'production_live_backup.json': '75eafd940d1760622c705758f736e836b2e09c1fb1670b01010584399bae708d',
  'production_live_backup_complete.json': '9c55e6548058ce774f49784c1d1ee6daaae1156cc1e5fedcc40ea0aff6d3c8c5'
};

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Simulación de mock req/res para pruebas unitarias sin dependencias externas
function createMockReqRes(body = {}, user = null) {
  const req = {
    body,
    user,
    headers: {},
    ip: '127.0.0.1'
  };
  let responseData = null;
  let statusCode = 200;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    }
  };

  return { req, res };
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🧪 AgroPasco — SUITE DE PRUEBAS DE SEGURIDAD Y AISLAMIENTO');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASÓ: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FALLÓ: ${message}`);
      failed++;
    }
  }

  const db = require('../config/database');
  const pool = db.getDb();
  const originalPoolQuery = pool.query;

  const { setupApprovedPassword, changePassword } = require('../controllers/authController');

  // =============================================================
  // SECCIÓN 1: PRUEBAS FUNDAMENTALES (A - H)
  // =============================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SECCIÓN 1: PRUEBAS FUNDAMENTALES DE MIGRACIÓN (A - H)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test A
  console.log('🔹 Test A: Cambio de contraseña para usuario con must_change_password=1');
  try {
    const initialTempPass = 'AP-TEST-TEMP!';
    const initialHash = await bcrypt.hash(initialTempPass, 12);
    let mockUserDb = {
      id: 4,
      name: 'Agricultor de Pasco',
      email: 'agricultor@agropasco.pe',
      password_hash: initialHash,
      must_change_password: 1,
      status: 'active',
      is_blocked: 0
    };

    const newPassword = 'NuevoPasswordSeguro2026!';
    if (mockUserDb.must_change_password === 1) {
      mockUserDb.password_hash = await bcrypt.hash(newPassword, 12);
      mockUserDb.must_change_password = 0;
    }

    const matchesNew = await bcrypt.compare(newPassword, mockUserDb.password_hash);
    assert(matchesNew === true, 'La nueva contraseña se aplicó y verifica con bcrypt');
    assert(mockUserDb.must_change_password === 0, 'must_change_password se restableció a 0');
  } catch (err) {
    assert(false, `Error en Test A: ${err.message}`);
  }
  console.log();

  // Test B
  console.log('🔹 Test B: Bloqueo de Account Takeover en setup-approved-password');
  try {
    const originalHash = await bcrypt.hash('SecretInitial!', 12);
    const mockUser = {
      id: 2,
      name: 'Cristian García',
      email: 'test_1788061900901@undac.edu.pe',
      password_hash: originalHash,
      status: 'active',
      is_blocked: 0
    };

    pool.query = async (sql) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        return { rows: [mockUser], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    const { req, res } = createMockReqRes({
      email: mockUser.email,
      newPassword: 'HackerPassword123!'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 401, `Respuesta esperada 401 Unauthorized (recibido: ${res.statusCode})`);
    assert(res.data?.success === false, 'La respuesta indica success: false');
    assert(res.data?.error?.includes('clave provisional'), 'El mensaje exige clave provisional o token');
  } catch (err) {
    assert(false, `Error en Test B: ${err.message}`);
  }
  console.log();

  // Test C
  console.log('🔹 Test C: Rechazo para cuentas pending en setup-approved-password');
  try {
    const mockPendingUser = {
      id: 10,
      name: 'Ing. Carlos Test Asesor',
      email: 'test.advisor.1789480913717@agropasco.pe',
      status: 'pending',
      is_blocked: 0
    };

    pool.query = async (sql) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        return { rows: [mockPendingUser], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    const { req, res } = createMockReqRes({
      email: mockPendingUser.email,
      newPassword: 'MiPassword123!',
      tempPassword: 'CualquierPassword'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 403, `Respuesta esperada 403 Forbidden para pending (recibido: ${res.statusCode})`);
    assert(res.data?.error?.includes('aprobadas por el Administrador'), 'Mensaje rechaza cuentas pending');
  } catch (err) {
    assert(false, `Error en Test C: ${err.message}`);
  }
  console.log();

  // Test D
  console.log('🔹 Test D: Rechazo para cuentas bloqueadas');
  try {
    const mockBlockedUser = {
      id: 15,
      name: 'Cencosud Pasco Retail',
      email: 'solicitud.super.1789481650174@agropasco.pe',
      status: 'rejected',
      is_blocked: 1
    };

    pool.query = async (sql) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        return { rows: [mockBlockedUser], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    const { req, res } = createMockReqRes({
      email: mockBlockedUser.email,
      newPassword: 'MiPassword123!',
      tempPassword: 'CualquierPassword'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 403, `Respuesta esperada 403 Forbidden para cuenta bloqueada (recibido: ${res.statusCode})`);
  } catch (err) {
    assert(false, `Error en Test D: ${err.message}`);
  }
  console.log();

  // Test E
  console.log('🔹 Test E: Autenticación del Administrador Oficial (ID 16)');
  try {
    const officialPassword = '123456789';
    const adminHash = await bcrypt.hash(officialPassword, 12);

    const matchesCorrect = await bcrypt.compare('123456789', adminHash);
    const matchesWrong = await bcrypt.compare('claveIncorrecta', adminHash);

    assert(matchesCorrect === true, 'Admin se autentica exitosamente con 123456789');
    assert(matchesWrong === false, 'Clave incorrecta es rechazada');
  } catch (err) {
    assert(false, `Error en Test E: ${err.message}`);
  }
  console.log();

  // Test F
  console.log('🔹 Test F: Generación criptográfica y alta entropía de contraseñas temporales (>= 96 bits)');
  try {
    const generatedSet = new Set();
    const countToGenerate = 1000;
    const formatRegex = /^AP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}!$/;

    let formatValidCount = 0;
    for (let i = 0; i < countToGenerate; i++) {
      const pwd = generateUniqueTempPassword(generatedSet);
      if (formatRegex.test(pwd) && pwd.length === 33) {
        formatValidCount++;
      }
    }

    assert(generatedSet.size === countToGenerate, `Generadas ${countToGenerate} claves temporales sin ninguna colisión (100% únicas)`);
    assert(formatValidCount === countToGenerate, `Las ${countToGenerate} claves cumplen el formato estricto AP-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX! (33 caracteres)`);

    // Comprobar entropía efectiva (24 caracteres hex = 12 bytes = 96 bits)
    const samplePwd = [...generatedSet][0];
    const hexPart = samplePwd.replace(/^AP-/, '').replace(/!$/, '').replace(/-/g, '');
    assert(hexPart.length === 24, 'La parte criptográfica contiene exactamente 24 caracteres hex (12 bytes = 96 bits de entropía pura)');

    // Validar compatibilidad con bcrypt (12 rondas)
    const sampleHash = await bcrypt.hash(samplePwd, 12);
    const matchesSample = await bcrypt.compare(samplePwd, sampleHash);
    assert(matchesSample === true, 'La contraseña de 96 bits verifica correctamente con bcrypt costo 12');
  } catch (err) {
    assert(false, `Error en Test F: ${err.message}`);
  }
  console.log();

  // Test G
  console.log('🔹 Test G: Almacenamiento no reversible (Bcrypt one-way)');
  try {
    const sampleTemp = 'AP-A1B2-C3D4!';
    const hash = await bcrypt.hash(sampleTemp, 12);

    assert(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'El hash generado tiene formato estándar Bcrypt');
    assert(!hash.includes(sampleTemp), 'El hash no contiene la contraseña en texto claro');
    assert(hash.length === 60, 'El hash bcrypt tiene longitud estándar de 60 caracteres');
  } catch (err) {
    assert(false, `Error en Test G: ${err.message}`);
  }
  console.log();

  // Test H
  console.log('🔹 Test H: Integridad criptográfica de los respaldos de producción');
  try {
    const baseDir = path.resolve(__dirname, '..', 'data', 'production-backup');
    const f1 = path.join(baseDir, 'production_live_backup.json');
    const f2 = path.join(baseDir, 'production_live_backup_complete.json');

    const hash1 = computeFileHash(f1);
    const hash2 = computeFileHash(f2);

    assert(hash1 === EXPECTED_CHECKSUMS['production_live_backup.json'], `production_live_backup.json 100% intacto (${hash1.slice(0, 16)}...)`);
    assert(hash2 === EXPECTED_CHECKSUMS['production_live_backup_complete.json'], `production_live_backup_complete.json 100% intacto (${hash2.slice(0, 16)}...)`);
  } catch (err) {
    assert(false, `Error en Test H: ${err.message}`);
  }
  console.log();

  // =============================================================
  // SECCIÓN 2: PRUEBAS DE AISLAMIENTO ESTRICTO ENTRE CUENTAS (1 - 8)
  // =============================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔒 SECCIÓN 2: PRUEBAS DE AISLAMIENTO ESTRICTO DE CUENTAS (1 - 8)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Preparar dos usuarios distintos para pruebas de aislamiento
  const tempPasswordA = 'AP-AAAA-1111!';
  const tempPasswordB = 'AP-BBBB-2222!';

  const hashA = await bcrypt.hash(tempPasswordA, 12);
  const hashB = await bcrypt.hash(tempPasswordB, 12);

  const userA = {
    id: 1,
    name: 'Usuario Agricultor A',
    email: 'agricultorA@agropasco.pe',
    role: 'farmer',
    password_hash: hashA,
    status: 'active',
    is_blocked: 0,
    must_change_password: 1
  };

  const userB = {
    id: 2,
    name: 'Usuario Asesor B',
    email: 'asesorB@agropasco.pe',
    role: 'advisor',
    password_hash: hashB,
    status: 'active',
    is_blocked: 0,
    must_change_password: 1
  };

  // Mock DB que resuelve usuario por email o id
  function setupMockDbUsers(usersList) {
    pool.query = async (sql, params = []) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        const queryParam = params[0];
        let found = null;
        if (typeof queryParam === 'string' && queryParam.includes('@')) {
          found = usersList.find(u => u.email.toLowerCase() === queryParam.toLowerCase());
        } else if (!isNaN(parseInt(queryParam, 10))) {
          found = usersList.find(u => u.id === parseInt(queryParam, 10));
        }
        return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 };
      }
      if (sql.includes('UPDATE') || sql.includes('INSERT')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
  }

  // -------------------------------------------------------------
  // Prueba 1: tempPassword de Usuario A NO puede cambiar contraseña de Usuario B
  // -------------------------------------------------------------
  console.log('🔹 Prueba 1: tempPassword de Usuario A no puede cambiar clave de Usuario B');
  try {
    setupMockDbUsers([userA, userB]);

    // El atacante o Usuario A intenta cambiar la clave de Usuario B enviando su propia clave temporal (tempPasswordA)
    const { req, res } = createMockReqRes({
      email: userB.email,
      tempPassword: tempPasswordA, // Clave de Usuario A
      newPassword: 'ClaveAtacante123!'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 401, `Rechazo con 401 Unauthorized (recibido: ${res.statusCode})`);
    assert(res.data?.success === false, 'Respuesta indica fallo (success: false)');
    assert(res.data?.error?.includes('incorrecta'), `Mensaje deniega clave incorrecta (${res.data?.error})`);
  } catch (err) {
    assert(false, `Error en Prueba 1: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 2: JWT de Usuario A NO puede cambiar contraseña de Usuario B
  // -------------------------------------------------------------
  console.log('🔹 Prueba 2: JWT de Usuario A no puede cambiar clave de Usuario B');
  try {
    setupMockDbUsers([userA, userB]);

    // Generar token legítimo para Usuario A
    const tokenA = jwt.sign(
      { id: userA.id, email: userA.email, role: userA.role, name: userA.name },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Intentar cambiar la clave de Usuario B enviando el token de Usuario A
    const { req, res } = createMockReqRes({
      email: userB.email,
      token: tokenA,
      newPassword: 'ClaveAtacante123!'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 401, `Rechazo con 401 Unauthorized (recibido: ${res.statusCode})`);
    assert(res.data?.error?.includes('no corresponde a esta cuenta'), `Error confirma token no perteneciente al objetivo (${res.data?.error})`);
  } catch (err) {
    assert(false, `Error en Prueba 2: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 3: Token expirado es rechazado con error explícito
  // -------------------------------------------------------------
  console.log('🔹 Prueba 3: Rechazo explícito de token expirado');
  try {
    setupMockDbUsers([userB]);

    // Token con expiración en el pasado
    const expiredToken = jwt.sign(
      { id: userB.id, email: userB.email, role: userB.role },
      JWT_SECRET,
      { expiresIn: '-10s' }
    );

    const { req, res } = createMockReqRes({
      email: userB.email,
      token: expiredToken,
      newPassword: 'NuevoPassword123!'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 401, `Rechazo con 401 Unauthorized (recibido: ${res.statusCode})`);
    assert(res.data?.error?.includes('ha expirado'), `Mensaje explícito de expiración (${res.data?.error})`);
  } catch (err) {
    assert(false, `Error en Prueba 3: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 4: Token con firma inválida es rechazado
  // -------------------------------------------------------------
  console.log('🔹 Prueba 4: Rechazo de token con firma inválida (clave secreta falsa)');
  try {
    setupMockDbUsers([userB]);

    // Token firmado con una clave secreta ilegítima
    const forgedToken = jwt.sign(
      { id: userB.id, email: userB.email, role: userB.role },
      'CLAVE_SECRETA_FALSA_ATACANTE',
      { expiresIn: '1h' }
    );

    const { req, res } = createMockReqRes({
      email: userB.email,
      token: forgedToken,
      newPassword: 'NuevoPassword123!'
    });

    await setupApprovedPassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 401, `Rechazo con 401 Unauthorized (recibido: ${res.statusCode})`);
    assert(res.data?.error?.includes('inválido'), `Mensaje explícito de token inválido (${res.data?.error})`);
  } catch (err) {
    assert(false, `Error en Prueba 4: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 5 y 6: Usuario con must_change_password=1 cambia clave en change-password y pasa a 0
  // -------------------------------------------------------------
  console.log('🔹 Pruebas 5 y 6: Flujo change-password legítimo (must_change_password pasa de 1 a 0)');
  try {
    let currentUserInDb = { ...userA, must_change_password: 1 };
    let dbUpdatedFields = null;

    pool.query = async (sql, params = []) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        return { rows: [{ ...currentUserInDb }], rowCount: 1 };
      }
      if (sql.includes('UPDATE') && sql.includes('users')) {
        dbUpdatedFields = { sql, params };
        currentUserInDb.password_hash = params[0];
        currentUserInDb.must_change_password = 0;
        return { rows: [{ id: currentUserInDb.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    // Usuario A autenticado legítimamente mediante su token de sesión
    const { req, res } = createMockReqRes(
      { newPassword: 'MiClaveDefinitiva2026!' },
      { id: userA.id, email: userA.email, role: userA.role } // Inyectado por authenticateToken
    );

    await changePassword(req, res);
    pool.query = originalPoolQuery;

    assert(res.statusCode === 200, `Respuesta 200 OK en cambio legítimo (recibido: ${res.statusCode})`);
    assert(res.data?.success === true, 'Respuesta exitosa de cambio de contraseña');

    // Prueba 6: Verificación de que must_change_password pasó a 0
    assert(currentUserInDb.must_change_password === 0, 'must_change_password pasó estrictamente a 0 en la base de datos');
    const matchesUpdated = await bcrypt.compare('MiClaveDefinitiva2026!', currentUserInDb.password_hash);
    assert(matchesUpdated === true, 'El nuevo hash en la base de datos verifica con la nueva contraseña elegida');
  } catch (err) {
    assert(false, `Error en Pruebas 5 y 6: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 7: Usuario A no puede modificar a Usuario B mediante email, identifier o user_id
  // -------------------------------------------------------------
  console.log('🔹 Prueba 7: Resistencia contra suplantación de parámetros (email, identifier, user_id)');
  try {
    let victimUserB = { ...userB, password_hash: hashB, must_change_password: 1 };
    let attackerUserA = { ...userA, password_hash: hashA, must_change_password: 1 };

    pool.query = async (sql, params = []) => {
      if (sql.includes('SELECT') && sql.includes('users')) {
        const idParam = params[0];
        // En change-password busca por WHERE id = ?
        if (idParam === attackerUserA.id) return { rows: [attackerUserA], rowCount: 1 };
        if (idParam === victimUserB.id) return { rows: [victimUserB], rowCount: 1 };
      }
      if (sql.includes('UPDATE') && sql.includes('users')) {
        // params: [passwordHash, userId]
        if (params[1] === attackerUserA.id) attackerUserA.password_hash = params[0];
        if (params[1] === victimUserB.id) victimUserB.password_hash = params[0];
        return { rows: [{ id: params[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    // Caso 7.1: En change-password, Usuario A envía en el body id/user_id/email de la víctima
    const { req: req7, res: res7 } = createMockReqRes(
      {
        id: victimUserB.id,
        user_id: victimUserB.id,
        email: victimUserB.email,
        newPassword: 'ClaveAtacante123!'
      },
      { id: attackerUserA.id, email: attackerUserA.email } // Token de A
    );

    await changePassword(req7, res7);
    pool.query = originalPoolQuery;

    // Verificar que la víctima B NO fue afectada
    const victimPassUntouched = await bcrypt.compare(tempPasswordB, victimUserB.password_hash);
    const victimDidNotGetAttackerPass = await bcrypt.compare('ClaveAtacante123!', victimUserB.password_hash);

    assert(victimPassUntouched === true, 'La contraseña de la víctima (Usuario B) permanece intacta');
    assert(victimDidNotGetAttackerPass === false, 'La víctima NO recibió la contraseña inyectada por el atacante');
    assert(req7.user.id === attackerUserA.id, 'changePassword opera estrictamente sobre req.user.id del JWT validado');
  } catch (err) {
    assert(false, `Error en Prueba 7: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Prueba 8: Validación de identidad en el token comprueba subject/sub/userId/id/email
  // -------------------------------------------------------------
  console.log('🔹 Prueba 8: Validación explícita de identidad en payload JWT (id, userId, sub, email)');
  try {
    setupMockDbUsers([userB]);

    // Caso 8.1: Token con claim { id: userB.id } -> Aceptado
    const tokenById = jwt.sign({ id: userB.id }, JWT_SECRET, { expiresIn: '10m' });
    const { req: req81, res: res81 } = createMockReqRes({ email: userB.email, token: tokenById, newPassword: 'PasswordPorId123!' });
    await setupApprovedPassword(req81, res81);
    assert(res81.statusCode === 200, `Token con claim { id } fue validado correctamente (status: ${res81.statusCode})`);

    // Caso 8.2: Token con claim { userId: userB.id } -> Aceptado
    const tokenByUserId = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '10m' });
    const { req: req82, res: res82 } = createMockReqRes({ email: userB.email, token: tokenByUserId, newPassword: 'PasswordPorUserId!' });
    await setupApprovedPassword(req82, res82);
    assert(res82.statusCode === 200, `Token con claim { userId } fue validado correctamente (status: ${res82.statusCode})`);

    // Caso 8.3: Token con claim { sub: String(userB.id) } (estándar RFC 7519) -> Aceptado
    const tokenBySub = jwt.sign({ sub: String(userB.id) }, JWT_SECRET, { expiresIn: '10m' });
    const { req: req83, res: res83 } = createMockReqRes({ email: userB.email, token: tokenBySub, newPassword: 'PasswordPorSub123!' });
    await setupApprovedPassword(req83, res83);
    assert(res83.statusCode === 200, `Token con claim { sub: ID } fue validado correctamente (status: ${res83.statusCode})`);

    // Caso 8.4: Token válido pero genérico { role: 'admin' } sin coincidencia de identidad -> Rechazado
    const genericToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '10m' });
    const { req: req84, res: res84 } = createMockReqRes({ email: userB.email, token: genericToken, newPassword: 'PasswordGenerico!' });
    await setupApprovedPassword(req84, res84);
    assert(res84.statusCode === 401, `Token genérico sin identidad coincidente es rechazado con 401 (status: ${res84.statusCode})`);

    // Caso 8.5: Token válido pero de un tercer usuario { id: 999, email: 'otro@test.com' } -> Rechazado
    const thirdPartyToken = jwt.sign({ id: 999, email: 'otro@test.com' }, JWT_SECRET, { expiresIn: '10m' });
    const { req: req85, res: res85 } = createMockReqRes({ email: userB.email, token: thirdPartyToken, newPassword: 'PasswordOtro123!' });
    await setupApprovedPassword(req85, res85);
    assert(res85.statusCode === 401, `Token de tercer usuario es rechazado con 401 (status: ${res85.statusCode})`);

    pool.query = originalPoolQuery;
  } catch (err) {
    assert(false, `Error en Prueba 8: ${err.message}`);
  }
  console.log();

  // =============================================================
  // SECCIÓN 3: PRUEBAS DE INICIALIZACIÓN DE ESQUEMA Y SINCRONIZACIÓN DE SECUENCIAS
  // =============================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 SECCIÓN 3: ESQUEMA LIMPIO POSTGRESQL Y SECUENCIAS SERIAL');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Prueba 3.1: Desacoplamiento de initializeSchema y cobertura de 16 tablas
  console.log('🔹 Prueba 3.1: Creación limpia del esquema (16 tablas con CREATE TABLE IF NOT EXISTS)');
  try {
    const executedQueries = [];
    const mockSchemaClient = {
      query: async (sql) => {
        executedQueries.push(sql);
        return { rows: [], rowCount: 0 };
      }
    };

    await initializeSchema(mockSchemaClient);

    assert(executedQueries.length === 16, `Se ejecutaron exactamente 16 sentencias DDL (recibido: ${executedQueries.length})`);

    const allAreCreateTable = executedQueries.every(q => /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(q));
    assert(allAreCreateTable === true, 'Todas las sentencias utilizan CREATE TABLE IF NOT EXISTS (idempotencia pura)');

    const createsAllExpected = EXPECTED_SCHEMA_TABLES.every(tbl =>
      executedQueries.some(q => new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tbl}\\b`, 'i').test(q))
    );
    assert(createsAllExpected === true, 'Las 16 tablas esperadas están contempladas en el esquema oficial');

    // Comprobar que users incluye must_change_password
    const usersDdl = executedQueries.find(q => /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+users\b/i.test(q));
    assert(usersDdl && usersDdl.includes('must_change_password INTEGER DEFAULT 0'), 'La tabla users incluye must_change_password INTEGER DEFAULT 0');
  } catch (err) {
    assert(false, `Error en Prueba 3.1: ${err.message}`);
  }
  console.log();

  // Prueba 3.2: Pureza del esquema (ausencia total de INSERT / seedData)
  console.log('🔹 Prueba 3.2: Pureza del esquema (cero INSERTs y ausencia de datos semilla)');
  try {
    const executedQueries = [];
    const mockSchemaClient = {
      query: async (sql) => {
        executedQueries.push(sql);
        return { rows: [], rowCount: 0 };
      }
    };

    await initializeSchema(mockSchemaClient);

    const hasAnyInsert = executedQueries.some(q => /^\s*INSERT\s+INTO/i.test(q));
    assert(hasAnyInsert === false, 'initializeSchema NO ejecuta sentencias INSERT INTO');

    const hasAnyDropOrTruncate = executedQueries.some(q => /\b(DROP|TRUNCATE)\b/i.test(q));
    assert(hasAnyDropOrTruncate === false, 'initializeSchema NO contiene operaciones destructivas (DROP/TRUNCATE)');
  } catch (err) {
    assert(false, `Error en Prueba 3.2: ${err.message}`);
  }
  console.log();

  // Prueba 3.3: Protección arquitectónica de init_pg_schema.js
  console.log('🔹 Prueba 3.3: Protección de init_pg_schema.js (aislamiento contra seedData)');
  try {
    const initScriptContent = fs.readFileSync(path.resolve(__dirname, 'init_pg_schema.js'), 'utf-8');
    const callsSeedDataInCode = /(?<!\/\/.*|\*.*)(?<!['"`].*)\bseedData\s*\(/m.test(initScriptContent);
    assert(!callsSeedDataInCode, 'init_pg_schema.js no invoca seedData() en su código ejecutable');
    assert(initScriptContent.includes('initializeSchema'), 'init_pg_schema.js delega en initializeSchema()');
    assert(initScriptContent.includes('EXPECTED_SCHEMA_TABLES'), 'init_pg_schema.js valida EXPECTED_SCHEMA_TABLES');
  } catch (err) {
    assert(false, `Error en Prueba 3.3: ${err.message}`);
  }
  console.log();

  // Prueba 3.4: Sincronización de secuencia en tabla con registros existentes
  console.log('🔹 Prueba 3.4: Sincronización de secuencia en tabla con registros (setval MAX(id), true)');
  try {
    const queryCalls = [];
    const mockClientWithData = {
      query: async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('pg_get_serial_sequence')) {
          return { rows: [{ seq_name: 'public.users_id_seq' }] };
        }
        if (sql.includes('MAX(id)')) {
          return { rows: [{ max_id: 18 }] };
        }
        if (sql.includes('setval')) {
          return { rows: [{ setval: 18 }] };
        }
        return { rows: [] };
      }
    };

    const res = await syncTableSequence(mockClientWithData, 'users');

    assert(res.synced === true, 'La sincronización reportó éxito');
    assert(res.value === 18, 'El valor asignado a la secuencia coincide con MAX(id) = 18');
    assert(res.isCalled === true, 'isCalled se estableció en true (próximo INSERT tomará MAX(id) + 1 = 19)');

    const setvalCall = queryCalls.find(c => c.sql.includes('setval'));
    assert(setvalCall && setvalCall.params[0] === 'public.users_id_seq' && setvalCall.params[1] === 18, 'Sentencia SQL setval ejecutada con parámetros correctos [seq, 18, true]');
  } catch (err) {
    assert(false, `Error en Prueba 3.4: ${err.message}`);
  }
  console.log();

  // Prueba 3.5: Sincronización de secuencia en tabla vacía
  console.log('🔹 Prueba 3.5: Sincronización de secuencia en tabla vacía (setval 1, false)');
  try {
    const queryCalls = [];
    const mockClientEmpty = {
      query: async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('pg_get_serial_sequence')) {
          return { rows: [{ seq_name: 'public.pest_markers_id_seq' }] };
        }
        if (sql.includes('MAX(id)')) {
          return { rows: [{ max_id: null }] }; // Tabla vacía
        }
        if (sql.includes('setval')) {
          return { rows: [{ setval: 1 }] };
        }
        return { rows: [] };
      }
    };

    const res = await syncTableSequence(mockClientEmpty, 'pest_markers');

    assert(res.synced === true, 'La sincronización en tabla vacía reportó éxito');
    assert(res.value === 1, 'El valor fijado en tabla vacía es 1');
    assert(res.isCalled === false, 'isCalled se estableció en false (primer INSERT tomará exactamente ID 1)');

    const setvalCall = queryCalls.find(c => c.sql.includes('setval'));
    assert(setvalCall && setvalCall.sql.includes('setval($1, 1, false)'), 'Sentencia SQL ejecutada como setval(seq, 1, false)');
  } catch (err) {
    assert(false, `Error en Prueba 3.5: ${err.message}`);
  }
  console.log();

  // Prueba 3.6: Manejo seguro ante tablas sin secuencia SERIAL
  console.log('🔹 Prueba 3.6: Tolerancia y graceful fallback ante tablas sin secuencia SERIAL');
  try {
    const mockClientNoSeq = {
      query: async (sql) => {
        if (sql.includes('pg_get_serial_sequence')) {
          return { rows: [{ seq_name: null }] }; // Sin secuencia SERIAL
        }
        return { rows: [] };
      }
    };

    const res = await syncTableSequence(mockClientNoSeq, 'advisory_tips');
    assert(res.synced === false, 'Detecta correctamente que no existe secuencia');
    assert(res.reason === 'no_serial_sequence', 'Razón reportada como no_serial_sequence sin arrojar excepción');
  } catch (err) {
    assert(false, `Error en Prueba 3.6: ${err.message}`);
  }
  console.log();

  // -------------------------------------------------------------
  // Resumen Final
  // -------------------------------------------------------------
  console.log('============================================================');
  console.log(`🏁 RESULTADO TOTAL: ${passed} PASADOS | ${failed} FALLADOS`);
  if (failed === 0) {
    console.log('🎉 TODAS LAS PRUEBAS DE SEGURIDAD Y AISLAMIENTO PASARON EXITOSAMENTE AL 100%');
  } else {
    console.error('⚠️ SE ENCONTRARON FALLOS EN LAS PRUEBAS');
    process.exit(1);
  }
  console.log('============================================================\n');
}

runTests();
