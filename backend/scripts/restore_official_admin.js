/**
 * Restablece al Administrador Inicial Oficial como único activo en la base de datos
 */
const bcrypt = require('bcryptjs');
const { getDb, dbRun, dbGet } = require('../config/database');

async function restore() {
  const officialEmail = 'garciatorrescristian39@gmail.com';
  const passwordHash = await bcrypt.hash('123456789', 12);

  // Deshabilitar cualquier otro administrador
  await dbRun("UPDATE users SET status = 'disabled', is_blocked = 1 WHERE role = 'admin' AND email != ?", [officialEmail]);

  // Asegurar que el admin oficial esté activo con la clave 123456789
  await dbRun(
    `UPDATE users SET
      name = 'Cristian Garcia Torres',
      role = 'admin',
      password_hash = ?,
      status = 'active',
      is_blocked = 0,
      must_change_password = 0,
      updated_at = CURRENT_TIMESTAMP
     WHERE email = ?`,
    [passwordHash, officialEmail]
  );

  const admin = await dbGet("SELECT id, name, email, role, status FROM users WHERE email = ?", [officialEmail]);
  console.log('✅ Administrador Central Inicial Restaurado y Activo:', admin);
  process.exit(0);
}

restore().catch(err => {
  console.error(err);
  process.exit(1);
});
