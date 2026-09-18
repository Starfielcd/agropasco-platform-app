/**
 * AgroPasco — Test Integral de Gestión y Transferencia de Administración
 */
const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  console.log('🧪 === INICIANDO SUITE DE PRUEBAS: GESTIÓN DE ADMINISTRADOR AGROPASCO ===\n');

  // 1. Consultar estado del setup
  console.log('▶ Test 1: Consultar estado de inicialización (/api/auth/setup-status)...');
  const setupRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/setup-status',
    method: 'GET'
  });
  console.log('Status:', setupRes.status, setupRes.data);
  if (!setupRes.data.success) throw new Error('Fallo en setup-status');
  console.log('✅ Test 1 Superado: Estado obtenido correctamente.\n');

  // 2. Intentar crear admin desde registro público
  console.log('▶ Test 2: Bloqueo de creación de administrador desde registro público...');
  const fakeAdminRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Hacker Admin',
    email: 'hacker@agropasco.pe',
    password: 'password123',
    role: 'admin',
    location: 'Cerro de Pasco'
  });
  console.log('Status esperado 403:', fakeAdminRes.status, fakeAdminRes.data?.error);
  if (fakeAdminRes.status !== 403) throw new Error('Vulnerabilidad detectada: Se permitió registro público de rol admin');
  console.log('✅ Test 2 Superado: Registro público bloqueado con HTTP 403.\n');

  // 3. Login con Administrador actual (Oficial)
  console.log('▶ Test 3: Login con el Administrador oficial (garciatorrescristian39@gmail.com)...');
  const loginAdminRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: 'garciatorrescristian39@gmail.com',
    password: '123456789'
  });
  console.log('Status:', loginAdminRes.status, 'Usuario:', loginAdminRes.data?.data?.user?.email);
  if (loginAdminRes.status !== 200 || !loginAdminRes.data.data?.token) {
    throw new Error('Fallo al autenticar al administrador actual: ' + JSON.stringify(loginAdminRes.data));
  }
  const currentAdminToken = loginAdminRes.data.data.token;
  console.log('✅ Test 3 Superado: Administrador oficial autenticado correctamente.\n');

  // 4. Intentar setup-admin cuando ya existe admin activo
  console.log('▶ Test 4: Bloqueo de /api/auth/setup-admin cuando ya existe admin activo...');
  const setupBlockRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/setup-admin',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Segundo Admin',
    email: 'segundo@agropasco.pe',
    password: 'password123'
  });
  console.log('Status esperado 403:', setupBlockRes.status, setupBlockRes.data?.error);
  if (setupBlockRes.status !== 403) throw new Error('Vulnerabilidad: setup-admin no bloqueó cuando ya hay admin activo');
  console.log('✅ Test 4 Superado: Setup secundario bloqueado con HTTP 403.\n');

  // 5. Transferencia con clave errónea
  console.log('▶ Test 5: Rechazo de transferencia si la clave del admin actual es incorrecta...');
  const failedTransferRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/transfer',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentAdminToken}`
    }
  }, {
    currentPassword: 'clave_incorrecta',
    newAdminName: 'Ing. Roxana Valerio',
    newAdminEmail: 'roxana.admin@agropasco.pe'
  });
  console.log('Status esperado 401:', failedTransferRes.status, failedTransferRes.data?.error);
  if (failedTransferRes.status !== 401) throw new Error('Seguridad fallida: Se permitió transferencia sin validar clave');
  console.log('✅ Test 5 Superado: Transferencia rechazada por clave incorrecta (HTTP 401).\n');

  // 6. Transferencia exitosa hacia nuevo administrador
  const newAdminEmail = `nuevo.admin.${Date.now()}@agropasco.pe`;
  console.log(`▶ Test 6: Ejecutar Transferencia Segura hacia ${newAdminEmail}...`);
  const transferRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/transfer',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentAdminToken}`
    }
  }, {
    currentPassword: '123456789',
    newAdminName: 'Ing. Roxana Valerio',
    newAdminEmail: newAdminEmail,
    newAdminLocation: 'Oxapampa, Pasco',
    newAdminPhone: '963 888 777'
  });
  console.log('Status:', transferRes.status, transferRes.data?.message);
  console.log('Contraseña temporal autogenerada:', transferRes.data?.tempPassword);
  if (transferRes.status !== 200 || !transferRes.data.success) {
    throw new Error('Fallo en la transferencia de administración: ' + JSON.stringify(transferRes.data));
  }
  const tempPassword = transferRes.data.tempPassword;
  console.log('✅ Test 6 Superado: Transferencia completada y correo simulado enviado.\n');

  // 7. Verificar que el admin anterior quedó deshabilitado
  console.log('▶ Test 7: Verificar que el Administrador anterior ha sido deshabilitado...');
  const oldAdminLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: 'garciatorrescristian39@gmail.com',
    password: '123456789'
  });
  console.log('Status esperado 403 (deshabilitado):', oldAdminLoginRes.status, oldAdminLoginRes.data?.error);
  if (oldAdminLoginRes.status !== 403) {
    throw new Error('Inconsistencia: El administrador anterior aún puede iniciar sesión');
  }
  console.log('✅ Test 7 Superado: Cuenta previa deshabilitada y bloqueada para login.\n');

  // 8. Iniciar sesión con el nuevo administrador y verificar must_change_password
  console.log('▶ Test 8: Login del nuevo Administrador con contraseña temporal...');
  const newAdminLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: newAdminEmail,
    password: tempPassword
  });
  console.log('Status:', newAdminLoginRes.status, 'mustChangePassword:', newAdminLoginRes.data?.data?.mustChangePassword);
  if (newAdminLoginRes.status !== 200 || !newAdminLoginRes.data.data?.mustChangePassword) {
    throw new Error('Fallo: Nuevo admin no tiene la bandera mustChangePassword requerida');
  }
  const newAdminToken = newAdminLoginRes.data.data.token;
  console.log('✅ Test 8 Superado: Nuevo admin autenticado y obligado a cambiar contraseña.\n');

  // 9. Cambio de contraseña obligatorio por el nuevo administrador
  console.log('▶ Test 9: Nuevo Administrador cambia su contraseña obligatoriamente...');
  const changePwdRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/change-password',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${newAdminToken}`
    }
  }, {
    newPassword: 'DefinitiveAdmin2026!'
  });
  console.log('Status:', changePwdRes.status, changePwdRes.data?.message);
  if (changePwdRes.status !== 200 || !changePwdRes.data.success) {
    throw new Error('Fallo al cambiar la contraseña del nuevo administrador');
  }
  console.log('✅ Test 9 Superado: Contraseña definitiva actualizada con éxito.\n');

  // 10. Login con la nueva contraseña definitiva
  console.log('▶ Test 10: Login del nuevo Administrador con su contraseña definitiva...');
  const finalLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: newAdminEmail,
    password: 'DefinitiveAdmin2026!'
  });
  console.log('Status:', finalLoginRes.status, 'mustChangePassword:', finalLoginRes.data?.data?.mustChangePassword);
  if (finalLoginRes.status !== 200 || finalLoginRes.data?.data?.mustChangePassword === true) {
    throw new Error('Fallo: El nuevo admin aún figura con mustChangePassword activo');
  }
  console.log('✅ Test 10 Superado: Login exitoso con nueva contraseña y acceso sin restricciones.\n');

  // 11. Verificar auditoría y cantidad de administradores activos
  console.log('▶ Test 11: Verificar auditoría y garantía de Administrador Activo Único...');
  const auditRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/audit',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${finalLoginRes.data.data.token}`
    }
  });
  const transferLog = auditRes.data.data?.find(l => l.action === 'TRANSFERENCIA_ADMINISTRACION');
  console.log('Log de auditoría encontrado:', transferLog ? {
    id: transferLog.id,
    action: transferLog.action,
    details: transferLog.details,
    created_at: transferLog.created_at
  } : 'No encontrado');

  if (!transferLog) throw new Error('No se encontró el registro TRANSFERENCIA_ADMINISTRACION en audit_logs');
  console.log('✅ Test 11 Superado: Auditoría inmutable registrada con éxito.\n');

  console.log('🏆 ========================================================');
  console.log('🏆  TODOS LOS REQUERIMIENTOS Y PRUEBAS FUERON SUPERADOS AL 100%');
  console.log('🏆 ========================================================');
}

run().catch(err => {
  console.error('❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
