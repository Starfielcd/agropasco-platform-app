const { dbRun, dbGet, dbAll } = require('../config/database');

async function seedParcelsAndFeatures() {
  console.log('🌱 Ejecutando sembrado de datos para funcionalidades...');

  const farmer = await dbGet("SELECT id FROM users WHERE role = 'farmer' ORDER BY id DESC LIMIT 1");
  const advisor = await dbGet("SELECT id FROM users WHERE role = 'advisor' ORDER BY id DESC LIMIT 1");
  const farmerId = farmer ? farmer.id : 4;
  const advisorId = advisor ? advisor.id : 5;

  console.log(`Agricultor ID: ${farmerId}, Asesor ID: ${advisorId}`);

  // 1. Cultivos
  const cropCount = await dbGet('SELECT COUNT(*) as count FROM crops');
  if (!cropCount || cropCount.count === 0) {
    console.log('Insertando cultivos de muestra...');
    await dbRun(`INSERT INTO crops (user_id, name, crop_type, variety, planting_date, area_hectares, status, location_detail, altitude_masl)
      VALUES (?, 'Papa Huayro Orgánica', 'papa', 'Huayro', date('now', '-90 days'), 1.5, 'crecimiento', 'Sector Tambopampa, Yanahuanca', 3180)`, [farmerId]);
    await dbRun(`INSERT INTO crops (user_id, name, crop_type, variety, planting_date, area_hectares, status, location_detail, altitude_masl)
      VALUES (?, 'Maca Amarilla de Altura', 'maca', 'Amarilla', date('now', '-120 days'), 0.8, 'floracion', 'Meseta de Ninacaca, Pasco', 4140)`, [farmerId]);
    await dbRun(`INSERT INTO crops (user_id, name, crop_type, variety, planting_date, area_hectares, status, location_detail, altitude_masl)
      VALUES (?, 'Café Typica Especial', 'cafe', 'Typica', date('now', '-200 days'), 2.2, 'cosecha', 'Fundo San José, Villa Rica', 1470)`, [farmerId]);
  }

  // 2. Parcelas para las 3 provincias
  const parcelCount = await dbGet('SELECT COUNT(*) as count FROM parcels');
  if (!parcelCount || parcelCount.count === 0) {
    console.log('Insertando parcelas para las 3 provincias de Pasco...');

    // Daniel Alcides Carrión
    const polyDAC = JSON.stringify({
      type: 'Polygon',
      coordinates: [[
        [-76.516, -10.491],
        [-76.510, -10.490],
        [-76.511, -10.496],
        [-76.517, -10.495],
        [-76.516, -10.491]
      ]]
    });
    await dbRun(`INSERT INTO parcels (user_id, name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, status, altitude_masl, notes)
      VALUES (?, 'Parcela Tambopampa - Yanahuanca', ?, 1.5, -10.493, -76.513, 'papa', date('now', '-90 days'), 'activa', 3184, 'Provincia Daniel Alcides Carrión. Suelo franco-arcilloso, riego tecnificado y abonos orgánicos.')`,
      [farmerId, polyDAC]
    );

    // Provincia de Pasco
    const polyPasco = JSON.stringify({
      type: 'Polygon',
      coordinates: [[
        [-76.115, -10.848],
        [-76.105, -10.847],
        [-76.106, -10.853],
        [-76.116, -10.852],
        [-76.115, -10.848]
      ]]
    });
    await dbRun(`INSERT INTO parcels (user_id, name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, status, altitude_masl, notes)
      VALUES (?, 'Parcela Alto Andina - Ninacaca', ?, 0.8, -10.850, -76.110, 'maca', date('now', '-120 days'), 'activa', 4140, 'Provincia de Pasco. Altura extrema óptima para concentración de macamidas.')`,
      [farmerId, polyPasco]
    );

    // Provincia de Oxapampa
    const polyOxa = JSON.stringify({
      type: 'Polygon',
      coordinates: [[
        [-75.275, -10.735],
        [-75.267, -10.734],
        [-75.268, -10.742],
        [-75.276, -10.741],
        [-75.275, -10.735]
      ]]
    });
    await dbRun(`INSERT INTO parcels (user_id, name, geo_json, area_hectares, center_lat, center_lng, crop_type, planting_date, status, altitude_masl, notes)
      VALUES (?, 'Fundo Cafetalero - Villa Rica', ?, 2.2, -10.738, -75.271, 'cafe', date('now', '-200 days'), 'activa', 1470, 'Provincia de Oxapampa. Selva central con sombra de guaba y manejo ecológico.')`,
      [farmerId, polyOxa]
    );
  }

  // 3. Reportes de plagas
  const pestCount = await dbGet('SELECT COUNT(*) as count FROM pest_reports');
  if (!pestCount || pestCount.count === 0) {
    console.log('Insertando reportes de plagas...');
    const p1 = await dbGet('SELECT id FROM parcels ORDER BY id ASC LIMIT 1');
    const p1Id = p1 ? p1.id : null;

    // Plaga No Resuelta (Pendiente)
    await dbRun(`INSERT INTO pest_reports (farmer_id, parcel_id, pest_name, description, location_lat, location_lng, status)
      VALUES (?, ?, 'Gorgojo de los Andes (Premnotrypes spp.)', 'Se detectaron larvas y daño en follaje basal en el sector este de la parcela.', -10.493, -76.513, 'pendiente')`,
      [farmerId, p1Id]
    );

    // Plaga Completa (Resuelta con respuesta técnica)
    await dbRun(`INSERT INTO pest_reports (farmer_id, parcel_id, pest_name, description, location_lat, location_lng, status, advisor_response, advisor_id, responded_at)
      VALUES (?, ?, 'Polilla de la Papa (Phthorimaea operculella)', 'Aparición de galerías en hojas de papa.', -10.495, -76.515, 'resuelto', 'Se aplicó bio-repelente a base de extracto de muña y control etológico con trampas de luz solar. Se controló la incidencia al 100%.', ?, datetime('now', '-4 days'))`,
      [farmerId, p1Id, advisorId]
    );
  }

  // 4. Actualizar productos para catálogo de supermercado
  console.log('Configurando productos certificados y pendientes...');
  await dbRun(`UPDATE products SET farmer_id = ?, validated_by = ?, validation_status = 'approved',
    validated_at = datetime('now', '-2 days'),
    validation_notes = 'Certificación 100% Natural emitida por Asesor Técnico. Historial verificado libre de pesticidas sintéticos.',
    is_natural = 1, certified_natural = 1, original_price = 3.00, price_per_kg = 3.90
    WHERE id = 1`, [farmerId, advisorId]);

  await dbRun(`UPDATE products SET farmer_id = ?, validated_by = ?, validation_status = 'approved',
    validated_at = datetime('now', '-3 days'),
    validation_notes = 'Maca orgánica certificada en meseta andina. +30% bonificación aplicada.',
    is_natural = 1, certified_natural = 1, original_price = 17.00, price_per_kg = 22.10
    WHERE id = 2`, [farmerId, advisorId]);

  await dbRun(`UPDATE products SET farmer_id = ?, validated_by = ?, validation_status = 'approved',
    validated_at = datetime('now', '-1 days'),
    validation_notes = 'Café de especialidad con certificación de origen Villa Rica.',
    is_natural = 0, certified_natural = 0, original_price = 48.00, price_per_kg = 48.00
    WHERE id = 3`, [farmerId, advisorId]);

  // Insertar producto pendiente para que el asesor pueda probar la validación
  const pendingProd = await dbGet("SELECT id FROM products WHERE validation_status = 'pending'");
  if (!pendingProd) {
    await dbRun(`INSERT INTO products (farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, original_price, unit, description, traceability_code, validation_status)
      VALUES (?, 'Papa Amarilla Tumbay Orgánica', 'papa', 'primera', 'Yanahuanca, Pasco', 450, 4.00, 4.00, 'kg', 'Cosecha fresca cultivada exclusivamente con compost y biofertilizante biol, sin químicos.', 'AP-PAPA-NEW-001', 'pending')`,
      [farmerId]);
  }

  // 5. Historial de prácticas del agricultor
  const logCount = await dbGet('SELECT COUNT(*) as count FROM crop_logs');
  if (!logCount || logCount.count === 0) {
    const c1 = await dbGet('SELECT id FROM crops ORDER BY id ASC LIMIT 1');
    if (c1) {
      await dbRun(`INSERT INTO crop_logs (crop_id, action_type, description, created_at)
        VALUES (?, 'siembra', 'Siembra tradicional con semilla seleccionada y guano de isla.', datetime('now', '-90 days'))`, [c1.id]);
      await dbRun(`INSERT INTO crop_logs (crop_id, action_type, description, created_at)
        VALUES (?, 'riego', 'Riego por aspersión con agua de manantial.', datetime('now', '-60 days'))`, [c1.id]);
      await dbRun(`INSERT INTO crop_logs (crop_id, action_type, description, created_at)
        VALUES (?, 'fertilizacion', 'Aplicación de biol orgánico enriquecido con ceniza y ortiga.', datetime('now', '-30 days'))`, [c1.id]);
      await dbRun(`INSERT INTO crop_logs (crop_id, action_type, description, created_at)
        VALUES (?, 'deshierbe', 'Control manual de malezas sin uso de agroquímicos sintéticos.', datetime('now', '-15 days'))`, [c1.id]);
    }
  }

  console.log('✅ ¡Sembrado completado con éxito!');
}

seedParcelsAndFeatures()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error al sembrar:', err);
    process.exit(1);
  });
