/**
 * AgroPasco — Controlador de Supermercado
 * Catálogo de productos con validación del asesor técnico
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

async function getProducts(req, res) {
  try {
    const { quality, crop_type, available, search } = req.query;

    let sql = `SELECT p.*, u.name as farmer_name, u.location as farmer_location,
                      val.name as validator_name
               FROM products p
               LEFT JOIN users u ON p.farmer_id = u.id
               LEFT JOIN users val ON p.validated_by = val.id
               WHERE 1=1`;
    const params = [];

    // Supermercado solo ve productos aprobados
    if (req.user && req.user.role === 'supermarket') {
      sql += " AND p.validation_status = 'approved'";
    }

    if (quality) { sql += ' AND p.quality = ?'; params.push(quality); }
    if (crop_type) { sql += ' AND p.crop_type = ?'; params.push(crop_type); }
    if (available !== undefined) { sql += ' AND p.available = ?'; params.push(available === 'true' ? 1 : 0); }
    if (search) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    sql += ' ORDER BY p.certified_natural DESC, p.updated_at DESC';

    const products = await dbAll(sql, params);

    res.json({
      provenance: 'Región Pasco, Perú',
      platform: 'AgroPasco Digital',
      certified_natural: true,
      success: true,
      data: products,
      total: products.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener productos.' });
  }
}

async function getProduct(req, res) {
  try {
    const product = await dbGet(
      `SELECT p.*, u.name as farmer_name, u.location as farmer_location,
              val.name as validator_name
       FROM products p
       LEFT JOIN users u ON p.farmer_id = u.id
       LEFT JOIN users val ON p.validated_by = val.id
       WHERE p.id = ?`,
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    // Obtener historial del agricultor (crop_logs)
    let farmerHistory = [];
    if (product.farmer_id) {
      farmerHistory = await dbAll(
        `SELECT cl.action_type, cl.description, cl.created_at, c.name as crop_name
         FROM crop_logs cl
         JOIN crops c ON cl.crop_id = c.id
         WHERE c.user_id = ?
         ORDER BY cl.created_at DESC LIMIT 20`,
        [product.farmer_id]
      );
    }

    res.json({ success: true, data: { ...product, farmer_history: farmerHistory } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener producto.' });
  }
}

async function getProductTrace(req, res) {
  try {
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    let cropTrace = null;
    if (product.farmer_id) {
      const crop = await dbGet(
        'SELECT * FROM crops WHERE user_id = ? AND crop_type = ? ORDER BY updated_at DESC LIMIT 1',
        [product.farmer_id, product.crop_type]
      );

      if (crop) {
        const logs = await dbAll(
          'SELECT action_type, description, weather_snapshot, created_at FROM crop_logs WHERE crop_id = ? ORDER BY created_at ASC',
          [crop.id]
        );
        cropTrace = {
          crop_name: crop.name,
          planting_date: crop.planting_date,
          status: crop.status,
          altitude: crop.altitude_masl,
          location: crop.location_detail,
          activities: logs.map(l => ({
            date: l.created_at,
            action: l.action_type,
            description: l.description,
            weather: l.weather_snapshot ? JSON.parse(l.weather_snapshot) : null
          }))
        };
      }
    }

    const farmer = product.farmer_id
      ? await dbGet('SELECT name, location FROM users WHERE id = ?', [product.farmer_id])
      : null;

    const validator = product.validated_by
      ? await dbGet('SELECT name FROM users WHERE id = ?', [product.validated_by])
      : null;

    res.json({
      success: true,
      data: {
        traceability_code: product.traceability_code,
        product: {
          name: product.name,
          type: product.crop_type,
          quality: product.quality,
          origin: product.origin,
          certified_natural: !!product.certified_natural,
          is_natural: !!product.is_natural,
          harvest_date: product.harvest_date,
          description: product.description,
          photo_url: product.photo_url,
          price_per_kg: product.price_per_kg,
          original_price: product.original_price,
          validation_status: product.validation_status,
          validation_notes: product.validation_notes
        },
        farmer: farmer ? { name: farmer.name, location: farmer.location } : null,
        validator: validator ? { name: validator.name, validated_at: product.validated_at } : null,
        crop_history: cropTrace,
        verification: {
          platform: 'AgroPasco Digital',
          verified: product.validation_status === 'approved',
          verification_date: product.validated_at || new Date().toISOString()
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener trazabilidad.' });
  }
}

async function publishProduct(req, res) {
  try {
    const { name, crop_type, quality, origin, stock_kg, price_per_kg, unit, description, photo_url } = req.body;

    if (!name || !crop_type || !price_per_kg) {
      return res.status(400).json({ success: false, error: 'Nombre, tipo de cultivo y precio son obligatorios.' });
    }

    const traceabilityCode = `AP-${crop_type.toUpperCase().substring(0, 4)}-${Date.now().toString(36).toUpperCase()}`;

    const user = await dbGet('SELECT location FROM users WHERE id = ?', [req.user.id]);
    const finalOrigin = origin || user?.location || 'Yanahuanca, Pasco';

    const result = await dbRun(
      `INSERT INTO products (farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, unit, description,
                             traceability_code, certified_natural, harvest_date, photo_url,
                             validation_status, original_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, date('now'), ?, 'pending', ?)`,
      [req.user.id, name, crop_type, quality || 'primera', finalOrigin,
       stock_kg || 0, price_per_kg, unit || 'kg', description || '', traceabilityCode,
       photo_url || null, price_per_kg]
    );

    // Notificar a asesores sobre producto pendiente
    const advisors = await dbAll("SELECT id FROM users WHERE role = 'advisor'");
    for (const adv of advisors) {
      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'mercado', ?, ?, 'info')`,
        [adv.id, `📦 Producto pendiente de validación: ${name}`,
         `El agricultor ${req.user.name} ha publicado "${name}" y necesita validación técnica.`]
      );
    }

    const product = await dbGet('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Producto enviado para validación del asesor técnico.', data: product });
  } catch (err) {
    console.error('Error al publicar producto:', err);
    res.status(500).json({ success: false, error: 'Error al publicar producto.' });
  }
}

// Asesor valida producto
async function validateProduct(req, res) {
  try {
    const { validation_status, validation_notes, is_natural } = req.body;

    if (!validation_status || !['approved', 'rejected'].includes(validation_status)) {
      return res.status(400).json({ success: false, error: 'Estado de validación inválido.' });
    }

    const product = await dbGet('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    let finalPrice = product.original_price || product.price_per_kg;
    let certifiedNatural = 0;

    if (validation_status === 'approved' && is_natural) {
      // Producto natural: +30% de precio
      finalPrice = parseFloat((finalPrice * 1.30).toFixed(2));
      certifiedNatural = 1;
    }

    await dbRun(
      `UPDATE products SET
        validation_status = ?,
        validated_by = ?,
        validation_notes = ?,
        validated_at = CURRENT_TIMESTAMP,
        is_natural = ?,
        certified_natural = ?,
        price_per_kg = ?,
        available = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [validation_status, req.user.id, validation_notes || '',
       is_natural ? 1 : 0, certifiedNatural, finalPrice,
       validation_status === 'approved' ? 1 : 0,
       req.params.id]
    );

    // Notificar al agricultor
    if (product.farmer_id) {
      const statusMsg = validation_status === 'approved'
        ? `✅ Tu producto "${product.name}" ha sido aprobado${is_natural ? ' como 100% Natural (+30% precio)' : ''}.`
        : `❌ Tu producto "${product.name}" ha sido rechazado. ${validation_notes || ''}`;

      await dbRun(
        `INSERT INTO notifications (user_id, type, title, message, severity)
         VALUES (?, 'mercado', ?, ?, ?)`,
        [product.farmer_id,
         validation_status === 'approved' ? `✅ Producto aprobado: ${product.name}` : `❌ Producto rechazado: ${product.name}`,
         statusMsg,
         validation_status === 'approved' ? 'info' : 'warning']
      );
    }

    const updated = await dbGet(
      `SELECT p.*, u.name as farmer_name FROM products p LEFT JOIN users u ON p.farmer_id = u.id WHERE p.id = ?`,
      [req.params.id]
    );
    res.json({ success: true, message: `Producto ${validation_status === 'approved' ? 'aprobado' : 'rechazado'}.`, data: updated });
  } catch (err) {
    console.error('Error al validar producto:', err);
    res.status(500).json({ success: false, error: 'Error al validar producto.' });
  }
}

// Listar productos pendientes de validación (advisor)
async function getPendingProducts(req, res) {
  try {
    const products = await dbAll(
      `SELECT p.*, u.name as farmer_name, u.location as farmer_location
       FROM products p
       LEFT JOIN users u ON p.farmer_id = u.id
       WHERE p.validation_status = 'pending'
       ORDER BY p.created_at DESC`
    );

    // Obtener historial de cada agricultor
    for (const prod of products) {
      if (prod.farmer_id) {
        prod.farmer_history = await dbAll(
          `SELECT cl.action_type, cl.description, cl.created_at, c.name as crop_name
           FROM crop_logs cl
           JOIN crops c ON cl.crop_id = c.id
           WHERE c.user_id = ?
           ORDER BY cl.created_at DESC LIMIT 10`,
          [prod.farmer_id]
        );
      }
    }

    res.json({ success: true, data: products, total: products.length });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener productos pendientes.' });
  }
}

module.exports = { getProducts, getProduct, getProductTrace, publishProduct, validateProduct, getPendingProducts };
