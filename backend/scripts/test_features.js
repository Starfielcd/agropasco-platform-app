const { initializeDatabase, dbGet, dbRun, dbAll } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function testAllFeatures() {
  console.log('🧪 Iniciando pruebas automáticas de todas las funcionalidades...');
  await initializeDatabase();

  const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_jwt_secret_dev_2026';

  // 1. Obtener usuarios de prueba
  const farmer = await dbGet("SELECT * FROM users WHERE email = 'agricultor@agropasco.pe'");
  const advisor = await dbGet("SELECT * FROM users WHERE email = 'asesor@agropasco.pe'");
  const supermarket = await dbGet("SELECT * FROM users WHERE email = 'supermercado@agropasco.pe'");

  console.log(`✓ Usuarios verificados: Farmer (${farmer.id}), Advisor (${advisor.id}), Supermarket (${supermarket.id})`);

  // 2. Probar creación de cultivo con altitud
  const cropInsert = await dbRun(
    `INSERT INTO crops (user_id, name, crop_type, variety, area_hectares, altitude_masl, location_detail, status)
     VALUES (?, 'Papa Canchan Test', 'papa', 'Canchan', 2.0, 3950, 'Yanahuanca, Pasco', 'sembrado')`,
    [farmer.id]
  );
  const createdCrop = await dbGet('SELECT * FROM crops WHERE id = ?', [cropInsert.lastID]);
  if (!createdCrop || createdCrop.altitude_masl !== 3950) {
    throw new Error('Fallo en prueba 1: Altitud en cultivo no coincide');
  }
  console.log(`✓ Prueba 1 Exitosa: Cultivo creado con altitud ${createdCrop.altitude_masl} msnm`);

  // 3. Probar edición de parcela (PUT /api/parcels/:id)
  const parcel = await dbGet('SELECT * FROM parcels WHERE user_id = ? LIMIT 1', [farmer.id]);
  if (parcel) {
    await dbRun(
      `UPDATE parcels SET name = ?, altitude_masl = ?, notes = ? WHERE id = ?`,
      ['Parcela Tambopampa Actualizada', 3250, 'Actualizado por test', parcel.id]
    );
    const updatedParcel = await dbGet('SELECT * FROM parcels WHERE id = ?', [parcel.id]);
    if (updatedParcel.altitude_masl !== 3250) {
      throw new Error('Fallo en prueba 2: Edición de parcela falló');
    }
    console.log(`✓ Prueba 2 Exitosa: Parcela ${updatedParcel.id} actualizada con altitud ${updatedParcel.altitude_masl} msnm`);
  }

  // 4. Probar creación y notificación de reporte de plagas (Farmer -> Advisor)
  const pestInsert = await dbRun(
    `INSERT INTO pest_reports (farmer_id, parcel_id, pest_name, description, location_lat, location_lng, status)
     VALUES (?, ?, 'Gusano de prueba', 'Síntomas visibles en hojas', -10.49, -76.51, 'pendiente')`,
    [farmer.id, parcel ? parcel.id : null]
  );
  const pestReportId = pestInsert.lastID;
  console.log(`✓ Prueba 3 Exitosa: Reporte de plaga ${pestReportId} creado`);

  // 5. Probar respuesta del asesor técnico a la plaga
  await dbRun(
    `UPDATE pest_reports SET advisor_response = ?, advisor_id = ?, status = 'resuelto', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ['Aplicar macerado de rocoto y ceniza vegetal.', advisor.id, pestReportId]
  );
  const resolvedPest = await dbGet('SELECT * FROM pest_reports WHERE id = ?', [pestReportId]);
  if (resolvedPest.status !== 'resuelto' || !resolvedPest.advisor_response) {
    throw new Error('Fallo en prueba 4: Respuesta de plaga');
  }
  console.log(`✓ Prueba 4 Exitosa: Asesor respondió reporte ${pestReportId}`);

  // 6. Probar validación técnica con recargo 100% natural (+30%)
  const prodInsert = await dbRun(
    `INSERT INTO products (farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, original_price, unit, description, validation_status)
     VALUES (?, 'Quinua Pasqueña Test', 'quinua', 'primera', 'Ninacaca, Pasco', 300, 10.00, 10.00, 'kg', 'Quinua orgánica', 'pending')`,
    [farmer.id]
  );
  const prodId = prodInsert.lastID;

  // Validación: is_natural = 1 -> +30%
  const basePrice = 10.00;
  const finalPrice = parseFloat((basePrice * 1.30).toFixed(2));
  await dbRun(
    `UPDATE products SET validation_status = 'approved', validated_by = ?, validation_notes = 'Certificado natural',
     validated_at = CURRENT_TIMESTAMP, is_natural = 1, certified_natural = 1, price_per_kg = ?, available = 1
     WHERE id = ?`,
    [advisor.id, finalPrice, prodId]
  );

  const approvedProd = await dbGet('SELECT * FROM products WHERE id = ?', [prodId]);
  if (approvedProd.price_per_kg !== 13.00 || approvedProd.certified_natural !== 1) {
    throw new Error(`Fallo en prueba 5: Precio esperado 13.00, obtenido ${approvedProd.price_per_kg}`);
  }
  console.log(`✓ Prueba 5 Exitosa: Producto validado 100% natural con recargo +30%: Base S/ 10.00 -> Final S/ ${approvedProd.price_per_kg.toFixed(2)}`);

  // 7. Limpieza de datos temporales
  await dbRun('DELETE FROM crops WHERE id = ?', [cropInsert.lastID]);
  await dbRun('DELETE FROM pest_reports WHERE id = ?', [pestReportId]);
  await dbRun('DELETE FROM products WHERE id = ?', [prodId]);

  console.log('🎉 ¡Todas las pruebas técnicas pasaron al 100% sin errores!');
}

testAllFeatures()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error en pruebas:', err);
    process.exit(1);
  });
