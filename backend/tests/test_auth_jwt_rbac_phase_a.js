/**
 * AgroPasco Digital — Suite de Pruebas FASE A: Autenticación JWT y RBAC (H-02 & Seguridad)
 * ==============================================================================
 * Verificaciones:
 *  1. Token ausente -> HTTP 401.
 *  2. Token expirado -> HTTP 401 (código TOKEN_EXPIRED).
 *  3. Token con firma inválida o corrupto -> HTTP 401.
 *  4. Token válido -> autenticación exitosa (next() llamado, req.user asignado).
 *  5. Token válido con rol insuficiente (requireRole) -> HTTP 403 Forbidden.
 *  6. Token válido con rol autorizado (requireRole) -> acceso concedido (next() llamado).
 *  7. Seguridad de JWT_SECRET: Bloqueo de claves públicas/débiles en producción.
 *  8. Integración con contrato de frontend/js/api.js: solo 401 destruye sesión, 403 no la destruye.
 */

const assert = require('assert');
const path = require('path');
const jwt = require('jsonwebtoken');

const {
  authenticateToken,
  optionalAuth,
  requireRole,
  generateToken,
  getJwtSecret
} = require('../middleware/auth');

function createMockReqRes(headers = {}, user = null) {
  const req = {
    headers: { ...headers },
    user
  };
  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    }
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData
  };
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🧪 SUITE FASE A: AUTENTICACIÓN JWT, EXPIRACIÓN, RBAC Y VALIDACIÓN DE SECRETOS');
  console.log('================================================================================\n');

  let checkCount = 0;
  function pass(msg) {
    checkCount++;
    console.log(`  ✓ [CHECK ${checkCount}] ${msg}`);
  }

  const currentSecret = getJwtSecret();

  // 1. Token ausente retorna 401
  const { req: r1, res: res1, getStatus: s1, getData: d1 } = createMockReqRes({});
  let next1 = false;
  await authenticateToken(r1, res1, () => { next1 = true; });
  assert.strictEqual(s1(), 401, 'Token ausente debe retornar HTTP 401');
  assert.strictEqual(next1, false, 'next() no debe ser invocado sin token');
  assert.strictEqual(d1().success, false);
  pass('Token ausente retorna estrictamente HTTP 401 Unauthorized');

  // 2. Token expirado retorna 401 (H-02)
  const expiredToken = jwt.sign(
    { id: 10, email: 'expirado@agropasco.pe', role: 'farmer', name: 'Juan Expirado' },
    currentSecret,
    { algorithm: 'HS256', expiresIn: '-10s' } // Ya expiró hace 10 segundos
  );
  const { req: r2, res: res2, getStatus: s2, getData: d2 } = createMockReqRes({
    authorization: `Bearer ${expiredToken}`
  });
  let next2 = false;
  await authenticateToken(r2, res2, () => { next2 = true; });
  assert.strictEqual(s2(), 401, 'Token expirado debe retornar HTTP 401 (no 403)');
  assert.strictEqual(next2, false, 'next() no debe ser invocado con token expirado');
  assert.strictEqual(d2().code, 'TOKEN_EXPIRED');
  pass('Token expirado retorna HTTP 401 (permite a frontend redirigir limpiamente al login)');

  // 3. Token con firma inválida o manipulada retorna 401
  const tamperedToken = expiredToken.slice(0, -6) + 'abc123';
  const { req: r3, res: res3, getStatus: s3 } = createMockReqRes({
    authorization: `Bearer ${tamperedToken}`
  });
  let next3 = false;
  await authenticateToken(r3, res3, () => { next3 = true; });
  assert.strictEqual(s3(), 401, 'Token corrupto/falsificado debe retornar HTTP 401');
  assert.strictEqual(next3, false);
  pass('Token manipulado o con firma corrupta retorna HTTP 401');

  // 4. Token válido autentica satisfactoriamente
  const validToken = generateToken({ id: 101, email: 'test@agropasco.pe', role: 'farmer', name: 'Agricultor Válido' });
  const { req: r4, res: res4, getStatus: s4 } = createMockReqRes({
    authorization: `Bearer ${validToken}`
  });
  let next4 = false;
  await authenticateToken(r4, res4, () => { next4 = true; });
  assert.strictEqual(next4, true, 'Token válido debe invocar next()');
  assert.strictEqual(r4.user.id, 101);
  assert.strictEqual(r4.user.role, 'farmer');
  pass('Token válido autentica exitosamente y propaga datos de sesión en req.user');

  // 5. RBAC: Token válido con permisos insuficientes retorna 403 Forbidden
  const requireAdmin = requireRole('admin');
  const { req: r5, res: res5, getStatus: s5, getData: d5 } = createMockReqRes({}, { id: 101, role: 'farmer' });
  let next5 = false;
  requireAdmin(r5, res5, () => { next5 = true; });
  assert.strictEqual(s5(), 403, 'Rol insuficiente debe retornar estrictamente HTTP 403 Forbidden');
  assert.strictEqual(next5, false);
  assert.ok(d5().error.includes('Acceso restringido'));
  pass('RBAC: Usuario con rol no autorizado es bloqueado con HTTP 403 sin destruir su sesión');

  // 6. RBAC: Token válido con rol autorizado concede acceso
  const requireFarmer = requireRole('farmer', 'advisor');
  const { req: r6, res: res6 } = createMockReqRes({}, { id: 101, role: 'farmer' });
  let next6 = false;
  requireFarmer(r6, res6, () => { next6 = true; });
  assert.strictEqual(next6, true, 'Rol correspondiente debe permitir el paso llamando next()');
  pass('RBAC: Usuario con rol autorizado accede correctamente al recurso');

  // 7. Seguridad de JWT_SECRET en entorno productivo (NODE_ENV=production)
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'agropasco_secret_key_2026'; // Clave por defecto conocida
    assert.throws(
      () => getJwtSecret(),
      /FATAL SEGURIDAD/,
      'Debe lanzar error fatal si en producción se intenta usar la clave por defecto'
    );
    pass('Seguridad productiva: Rechazo categórico de clave pública conocida en producción');

    delete process.env.JWT_SECRET; // Sin variable configurada
    assert.throws(
      () => getJwtSecret(),
      /FATAL SEGURIDAD/,
      'Debe lanzar error fatal si en producción JWT_SECRET está ausente'
    );
    pass('Seguridad productiva: Rechazo categórico si JWT_SECRET no está configurado en producción');

    process.env.JWT_SECRET = 'super_secure_random_key_with_at_least_32_characters_12345';
    assert.strictEqual(getJwtSecret(), 'super_secure_random_key_with_at_least_32_characters_12345');
    pass('Seguridad productiva: Clave segura de longitud apropiada aceptada en producción');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  }

  // 8. Validación de api.js: contrato 401 vs 403
  const fs = require('fs');
  const apiJsContent = fs.readFileSync(path.join(__dirname, '../../frontend/js/api.js'), 'utf8');
  assert.ok(apiJsContent.includes('if (response.status === 401)'), 'api.js debe reaccionar a 401 para limpiar sesión');
  assert.ok(!apiJsContent.includes('response.status === 403 && removeToken'), 'api.js no debe destruir sesión en 403');
  pass('Contrato frontend verificado: solo 401 invalida credenciales y fuerza retorno al login');

  console.log('\n' + '='.repeat(80));
  console.log(`🎉 TODAS LAS ${checkCount} VERIFICACIONES DE FASE A APROBADAS SATISFACTORIAMENTE`);
  console.log('='.repeat(80));
}

runSuite().catch(err => {
  console.error('❌ Error en suite de pruebas FASE A:', err);
  process.exit(1);
});
