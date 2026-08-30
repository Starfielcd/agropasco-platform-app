/**
 * AgroPasco — Controlador de Supermercado
 */

const { dbRun, dbGet, dbAll } = require('../config/database');

async function getProducts(req, res) {
  try {
    const { quality, crop_type, available, search } = req.query;

    let sql = 'SELECT p.*, u.name as farmer_name FROM products p LEFT JOIN users u ON p.farmer_id = u.id WHERE 1=1';
    const params = [];

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
      'SELECT p.*, u.name as farmer_name, u.location as farmer_location FROM products p LEFT JOIN users u ON p.farmer_id = u.id WHERE p.id = ?',
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    res.json({ success: true, data: product });
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

    // Try to find linked crop traceability
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
          harvest_date: product.harvest_date,
          description: product.description
        },
        farmer: farmer ? { name: farmer.name, location: farmer.location } : null,
        crop_history: cropTrace,
        verification: {
          platform: 'AgroPasco Digital',
          verified: true,
          verification_date: new Date().toISOString()
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener trazabilidad.' });
  }
}

async function publishProduct(req, res) {
  try {
    const { name, crop_type, quality, origin, stock_kg, price_per_kg, unit, description } = req.body;

    if (!name || !crop_type || !price_per_kg) {
      return res.status(400).json({ success: false, error: 'Nombre, tipo de cultivo y precio son obligatorios.' });
    }

    const traceabilityCode = `AP-${crop_type.toUpperCase().substring(0, 4)}-${Date.now().toString(36).toUpperCase()}`;

    const user = await dbGet('SELECT location FROM users WHERE id = ?', [req.user.id]);
    const finalOrigin = origin || user?.location || 'Yanahuanca, Pasco';

    const result = await dbRun(
      `INSERT INTO products (farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, unit, description, traceability_code, certified_natural, harvest_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, date('now'))`,
      [req.user.id, name, crop_type, quality || 'primera', finalOrigin,
       stock_kg || 0, price_per_kg, unit || 'kg', description || '', traceabilityCode]
    );

    const product = await dbGet('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, message: 'Producto publicado en el catálogo.', data: product });
  } catch (err) {
    console.error('Error al publicar producto:', err);
    res.status(500).json({ success: false, error: 'Error al publicar producto.' });
  }
}

module.exports = { getProducts, getProduct, getProductTrace, publishProduct };
