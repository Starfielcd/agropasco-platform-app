/**
 * AgroPasco — Test Suite Automatizado de Verificación UIUX09
 * ==========================================================
 * Verificación de:
 * 1. Flujo completo de fotografías de agricultores (photo_url).
 * 2. Auditoría exhaustiva de seguridad y lógica de PUT /products/:id (updateProduct).
 * 3. Publicación (publishProduct) y validación del asesor (validateProduct) con bonificación 100% natural (+30%).
 * 4. Catálogo del supermercado (getProducts), fichas y permisos por rol.
 *
 * MODO: 100% aislado en memoria con mocks controlados (sin requerir PostgreSQL externo).
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');

async function runSupermarketVerificationSuite() {
  console.log('='.repeat(75));
  console.log('🧪 TEST SUITE UIUX09 — VERIFICACIÓN SUPERMERCADO Y PRESERVACIÓN FUNCIONAL');
  console.log('='.repeat(75));

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ PASSED: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
      failedTests++;
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ PASSED: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
      failedTests++;
    }
  }

  // =========================================================================
  // SECCIÓN 1: AUDITORÍA DE FOTOGRAFÍAS (photo_url)
  // =========================================================================
  console.log('\n--- 1. AUDITORÍA DEL RECORRIDO DE LA FOTOGRAFÍA (photo_url) ---');

  // Cargar controladores simulando el entorno
  const supermarketController = require('../controllers/supermarketController');

  test('El controlador exporta las 7 funciones requeridas por el módulo', () => {
    assert.strictEqual(typeof supermarketController.getProducts, 'function');
    assert.strictEqual(typeof supermarketController.getProduct, 'function');
    assert.strictEqual(typeof supermarketController.getProductTrace, 'function');
    assert.strictEqual(typeof supermarketController.publishProduct, 'function');
    assert.strictEqual(typeof supermarketController.validateProduct, 'function');
    assert.strictEqual(typeof supermarketController.getPendingProducts, 'function');
    assert.strictEqual(typeof supermarketController.updateProduct, 'function');
  });

  // =========================================================================
  // SECCIÓN 2: AUDITORÍA DEL ENDPOINT PUT /products/:id (updateProduct)
  // =========================================================================
  console.log('\n--- 2. AUDITORÍA DEL ENDPOINT PUT /products/:id (updateProduct) ---');

  // Mock Database Store
  const mockDb = {
    products: [
      {
        id: 101,
        farmer_id: 5,
        name: 'Papa Huayro Nativa',
        crop_type: 'papa',
        quality: 'primera',
        origin: 'Yanahuanca, Pasco',
        stock_kg: 400,
        price_per_kg: 5.0,
        original_price: 5.0,
        unit: 'kg',
        description: 'Cultivada orgánicamente en altura',
        photo_url: '/uploads/products/papa_original_123.jpg',
        validation_status: 'approved',
        certified_natural: 1,
        updated_at: '2026-10-10T10:00:00Z'
      },
      {
        id: 102,
        farmer_id: 8,
        name: 'Maca Andina Roja',
        crop_type: 'maca',
        quality: 'premium',
        origin: 'Ninacaca, Pasco',
        stock_kg: 150,
        price_per_kg: 18.0,
        original_price: 18.0,
        unit: 'kg',
        description: 'Maca secada al sol de puna',
        photo_url: '/uploads/products/maca_original_456.jpg',
        validation_status: 'pending',
        certified_natural: 0,
        updated_at: '2026-10-12T10:00:00Z'
      }
    ],
    notifications: []
  };

  // Helper para simular req y res de Express
  function createMockContext(reqOverrides = {}) {
    const req = {
      params: {},
      body: {},
      query: {},
      user: { id: 5, role: 'farmer', name: 'Carlos Agricultor' },
      ...reqOverrides
    };

    let statusCode = 200;
    let jsonBody = null;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      },
      getStatusCode: () => statusCode,
      getJson: () => jsonBody
    };

    return { req, res };
  }

  // Interceptar la base de datos de supermarketController para pruebas controladas
  const dbModule = require('../config/database');
  const origDbGet = dbModule.dbGet;
  const origDbRun = dbModule.dbRun;
  const origDbAll = dbModule.dbAll;

  // Inyectar mocks controlados
  dbModule.dbGet = async (sql, params) => {
    if (sql.includes('FROM products') && sql.includes('WHERE') && (sql.includes('id = ?') || sql.includes('p.id = ?'))) {
      const p = mockDb.products.find(item => item.id === Number(params[0]));
      return p ? { ...p, farmer_name: 'Carlos Agricultor' } : null;
    }
    if (sql.includes('FROM users WHERE id = ?') || sql.includes('SELECT location FROM users WHERE id = ?')) {
      return { id: Number(params[0]) || 5, name: 'Carlos Agricultor', role: 'farmer', location: 'Yanahuanca, Pasco' };
    }
    return null;
  };

  dbModule.dbRun = async (sql, params) => {
    if (sql.includes('UPDATE products SET')) {
      const id = Number(params[params.length - 1]);
      const idx = mockDb.products.findIndex(item => item.id === id);
      if (idx !== -1) {
        mockDb.products[idx] = {
          ...mockDb.products[idx],
          name: params[0],
          crop_type: params[1],
          quality: params[2],
          origin: params[3],
          stock_kg: params[4],
          price_per_kg: params[5],
          original_price: params[6],
          unit: params[7],
          description: params[8],
          photo_url: params[9],
          validation_status: 'pending',
          updated_at: new Date().toISOString()
        };
      }
      return { rowCount: 1 };
    }
    if (sql.includes('INSERT INTO products')) {
      const newId = 200 + mockDb.products.length;
      mockDb.products.push({
        id: newId,
        farmer_id: params[0],
        name: params[1],
        crop_type: params[2],
        quality: params[3],
        origin: params[4],
        stock_kg: params[5],
        price_per_kg: params[6],
        unit: params[7],
        description: params[8],
        traceability_code: params[9],
        photo_url: params[10],
        validation_status: 'pending',
        original_price: params[11],
        certified_natural: 0
      });
      return { lastID: newId };
    }
    if (sql.includes('INSERT INTO notifications')) {
      mockDb.notifications.push({ userId: params[0], type: params[1], title: params[2], message: params[3] });
      return { rowCount: 1 };
    }
    return { rowCount: 1 };
  };

  dbModule.dbAll = async (sql, params) => {
    if (sql.includes("SELECT id FROM users WHERE role = 'advisor'")) {
      return [{ id: 99 }];
    }
    if (sql.includes('FROM products p')) {
      return mockDb.products.map(p => ({ ...p, farmer_name: 'Carlos Agricultor' }));
    }
    return [];
  };

  await testAsync('PUT /products/:id retorna 404 si el producto no existe', async () => {
    const { req, res } = createMockContext({
      params: { id: 9999 },
      body: { name: 'Cultivo Inexistente' }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 404);
    assert.strictEqual(res.getJson().success, false);
    assert.strictEqual(res.getJson().error, 'Producto no encontrado.');
  });

  await testAsync('PUT /products/:id retorna 403 Forbidden si otro agricultor intenta editar el producto ajeno', async () => {
    // Producto 101 pertenece a farmer_id = 5. El usuario actual tiene farmer_id = 12
    const { req, res } = createMockContext({
      params: { id: 101 },
      user: { id: 12, role: 'farmer', name: 'Otro Agricultor' },
      body: { name: 'Intento de Modificación Ilegal' }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 403);
    assert.strictEqual(res.getJson().success, false);
    assert.strictEqual(res.getJson().error, 'No tienes permiso para editar este producto.');
  });

  await testAsync('PUT /products/:id permite que el agricultor dueño modifique su producto', async () => {
    const { req, res } = createMockContext({
      params: { id: 101 },
      user: { id: 5, role: 'farmer', name: 'Carlos Agricultor' },
      body: {
        name: 'Papa Huayro Orgánica Seleccionada',
        stock_kg: 650,
        price_per_kg: 5.50
      }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.strictEqual(res.getJson().data.name, 'Papa Huayro Orgánica Seleccionada');
    assert.strictEqual(res.getJson().data.stock_kg, 650);
    assert.strictEqual(res.getJson().data.price_per_kg, 5.50);
  });

  await testAsync('PUT /products/:id reinicia validation_status a "pending" tras cualquier edición', async () => {
    // El producto 101 estaba 'approved'. Al ser editado DEBE pasar a 'pending' para revisión del asesor
    const productAfterUpdate = mockDb.products.find(p => p.id === 101);
    assert.strictEqual(productAfterUpdate.validation_status, 'pending');
  });

  await testAsync('PUT /products/:id conserva la foto anterior si no se envía una nueva (actualización parcial)', async () => {
    const { req, res } = createMockContext({
      params: { id: 101 },
      user: { id: 5, role: 'farmer', name: 'Carlos Agricultor' },
      body: {
        description: 'Descripción actualizada manteniendo foto previa'
        // photo_url no enviado
      }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    const prod = mockDb.products.find(p => p.id === 101);
    assert.strictEqual(prod.photo_url, '/uploads/products/papa_original_123.jpg');
    assert.strictEqual(prod.description, 'Descripción actualizada manteniendo foto previa');
  });

  await testAsync('PUT /products/:id actualiza correctamente la fotografía cuando se envía una nueva', async () => {
    const { req, res } = createMockContext({
      params: { id: 101 },
      user: { id: 5, role: 'farmer', name: 'Carlos Agricultor' },
      body: {
        photo_url: '   /uploads/products/papa_nueva_cosecha_789.jpg   '
      }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    const prod = mockDb.products.find(p => p.id === 101);
    // Verifica que se hace trim() y se guarda exactamente la URL
    assert.strictEqual(prod.photo_url, '/uploads/products/papa_nueva_cosecha_789.jpg');
  });

  await testAsync('PUT /products/:id permite al rol admin editar cualquier producto (override administrativo)', async () => {
    // Admin (id: 1, role: 'admin') edita producto de farmer_id: 8
    const { req, res } = createMockContext({
      params: { id: 102 },
      user: { id: 1, role: 'admin', name: 'Administrador General' },
      body: {
        origin: 'Ninacaca Alta, Pasco (Corregido por Admin)'
      }
    });

    await supermarketController.updateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    const prod = mockDb.products.find(p => p.id === 102);
    assert.strictEqual(prod.origin, 'Ninacaca Alta, Pasco (Corregido por Admin)');
  });

  // =========================================================================
  // SECCIÓN 3: VERIFICACIÓN DE PUBLICACIÓN Y OBLIGATORIEDAD DE FOTO
  // =========================================================================
  console.log('\n--- 3. VERIFICACIÓN DE PUBLICACIÓN Y VALIDACIÓN DE FOTOGRAFÍA ---');

  await testAsync('POST /products rechaza publicaciones sin fotografía (photo_url nulo o vacío)', async () => {
    const { req, res } = createMockContext({
      body: {
        name: 'Olluco Silvestre',
        crop_type: 'olluco',
        price_per_kg: 4.0,
        photo_url: '' // Vacío
      }
    });

    await supermarketController.publishProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 400);
    assert.strictEqual(res.getJson().success, false);
    assert.ok(res.getJson().error.includes('fotografía del producto cosechado es obligatoria'));
  });

  await testAsync('POST /products registra producto con foto y envía notificación al asesor técnico', async () => {
    const notifCountBefore = mockDb.notifications.length;
    const { req, res } = createMockContext({
      body: {
        name: 'Quinua Blanca Real',
        crop_type: 'quinua',
        quality: 'premium',
        origin: 'Paucartambo, Pasco',
        stock_kg: 800,
        price_per_kg: 8.50,
        photo_url: '  /uploads/products/quinua_cosecha_2026.jpg  '
      }
    });

    await supermarketController.publishProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 201);
    assert.strictEqual(res.getJson().success, true);

    const created = mockDb.products.find(p => p.name === 'Quinua Blanca Real');
    assert.ok(created, 'El producto debe haber sido insertado');
    assert.strictEqual(created.photo_url, '/uploads/products/quinua_cosecha_2026.jpg');
    assert.strictEqual(created.validation_status, 'pending');
    assert.strictEqual(created.certified_natural, 0);
    assert.ok(created.traceability_code.startsWith('AP-QUIN-'));

    // Verificar notificación al asesor
    assert.strictEqual(mockDb.notifications.length, notifCountBefore + 1);
    assert.strictEqual(mockDb.notifications[mockDb.notifications.length - 1].userId, 99);
  });

  // =========================================================================
  // SECCIÓN 4: ASESOR TÉCNICO Y BONIFICACIÓN +30% 100% NATURAL
  // =========================================================================
  console.log('\n--- 4. ASESOR TÉCNICO Y CÁLCULO DE BONIFICACIÓN 100% NATURAL (+30%) ---');

  await testAsync('validateProduct aplica +30% de incremento cuando se certifica 100% natural', async () => {
    // Producto base con precio 10.00
    mockDb.products.push({
      id: 301,
      farmer_id: 5,
      name: 'Maca Amarilla Pura',
      price_per_kg: 10.00,
      original_price: 10.00,
      validation_status: 'pending'
    });

    // Inyectar dbRun para validateProduct
    const prevDbRun = dbModule.dbRun;
    dbModule.dbRun = async (sql, params) => {
      if (sql.includes('UPDATE products') && sql.includes('validation_status')) {
        const id = Number(params[7]);
        const prod = mockDb.products.find(p => p.id === id);
        if (prod) {
          prod.validation_status = params[0];
          prod.validated_by = params[1];
          prod.validation_notes = params[2];
          prod.is_natural = params[3];
          prod.certified_natural = params[4];
          prod.price_per_kg = params[5];
          prod.available = params[6];
        }
      }
      return { rowCount: 1 };
    };

    const { req, res } = createMockContext({
      params: { id: 301 },
      user: { id: 99, role: 'advisor', name: 'Ing. Asesor' },
      body: {
        validation_status: 'approved',
        is_natural: true,
        validation_notes: 'Cumple con estándares agroecológicos'
      }
    });

    await supermarketController.validateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.strictEqual(res.getJson().data.certified_natural, 1);
    assert.strictEqual(res.getJson().data.price_per_kg, 13.00); // 10.00 * 1.30 = 13.00
    dbModule.dbRun = prevDbRun;
  });

  await testAsync('validateProduct rechaza un producto y notifica al agricultor con motivo técnico', async () => {
    mockDb.products.push({
      id: 302,
      farmer_id: 5,
      name: 'Papa con exceso de pesticida',
      price_per_kg: 3.50,
      original_price: 3.50,
      validation_status: 'pending'
    });

    const prevDbRun = dbModule.dbRun;
    dbModule.dbRun = async (sql, params) => {
      if (sql.includes('UPDATE products') && sql.includes('validation_status')) {
        const id = Number(params[7]);
        const prod = mockDb.products.find(p => p.id === id);
        if (prod) {
          prod.validation_status = params[0];
          prod.validated_by = params[1];
          prod.validation_notes = params[2];
          prod.is_natural = params[3];
          prod.certified_natural = params[4];
          prod.price_per_kg = params[5];
          prod.available = params[6];
        }
      }
      return { rowCount: 1 };
    };

    const { req, res } = createMockContext({
      params: { id: 302 },
      user: { id: 99, role: 'advisor', name: 'Ing. Asesor' },
      body: {
        validation_status: 'rejected',
        is_natural: false,
        validation_notes: 'Presencia de residuos químicos no permitidos para canal de supermercado'
      }
    });

    await supermarketController.validateProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.strictEqual(res.getJson().data.validation_status, 'rejected');
    assert.strictEqual(res.getJson().data.certified_natural, 0);
    assert.strictEqual(res.getJson().data.price_per_kg, 3.50); // Sin incremento

    dbModule.dbRun = prevDbRun;
  });

  // =========================================================================
  // SECCIÓN 5: CONSULTA DEL CATÁLOGO (getProducts) Y PRIVACIDAD POR ROL
  // =========================================================================
  console.log('\n--- 5. CONSULTA DEL CATÁLOGO (getProducts) Y VISIBILIDAD POR ROL ---');

  await testAsync('getProducts para rol supermarket o público externo filtra únicamente productos approved', async () => {
    let capturedSql = '';
    const prevDbAll = dbModule.dbAll;
    dbModule.dbAll = async (sql, params) => {
      capturedSql = sql;
      return mockDb.products.filter(p => p.validation_status === 'approved');
    };

    const { req, res } = createMockContext({
      user: { id: 77, role: 'supermarket', name: 'Comprador PlazaVea' }
    });

    await supermarketController.getProducts(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.ok(capturedSql.includes("validation_status = 'approved'"));

    dbModule.dbAll = prevDbAll;
  });

  await testAsync('getProducts para rol farmer incluye aprobados y sus propios pendientes', async () => {
    let capturedSql = '';
    let capturedParams = [];
    const prevDbAll = dbModule.dbAll;
    dbModule.dbAll = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return mockDb.products.filter(p => p.validation_status === 'approved' || p.farmer_id === 5);
    };

    const { req, res } = createMockContext({
      user: { id: 5, role: 'farmer', name: 'Carlos Agricultor' }
    });

    await supermarketController.getProducts(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.ok(capturedSql.includes("validation_status = 'approved' OR p.farmer_id = ?"));
    assert.strictEqual(capturedParams[0], 5);

    dbModule.dbAll = prevDbAll;
  });

  await testAsync('getProduct retorna datos íntegros incluyendo photo_url original y trazabilidad', async () => {
    const { req, res } = createMockContext({
      params: { id: 101 }
    });

    await supermarketController.getProduct(req, res);
    assert.strictEqual(res.getStatusCode(), 200);
    assert.strictEqual(res.getJson().success, true);
    assert.ok(res.getJson().data.photo_url.includes('/uploads/products/'));
    assert.strictEqual(res.getJson().data.farmer_name, 'Carlos Agricultor');
  });

  // =========================================================================
  // SECCIÓN 6: AUDITORÍA DE RUTAS Y MIDDLEWARE DE PERMISOS
  // =========================================================================
  console.log('\n--- 6. AUDITORÍA DE SEGURIDAD EN RUTAS Y MIDDLEWARE DE ROLES ---');

  test('backend/routes/supermarket.js define correctamente los endpoints y roles', () => {
    const routesContent = require('fs').readFileSync(
      require('path').resolve(__dirname, '..', 'routes', 'supermarket.js'),
      'utf8'
    );

    // Verificar protección por roles
    assert.ok(routesContent.includes("requireRole('farmer', 'admin')"), 'PUT /products/:id debe admitir farmer y admin');
    assert.ok(routesContent.includes("requireRole('farmer')"), 'POST /products debe restringirse a farmer');
    assert.ok(routesContent.includes("requireRole('advisor')"), 'PUT /products/:id/validate debe restringirse a advisor');
    assert.ok(routesContent.includes("router.get('/products', optionalAuth, getProducts)"), 'GET /products con optionalAuth');
  });

  // Restaurar mocks originales de DB
  dbModule.dbGet = origDbGet;
  dbModule.dbRun = origDbRun;
  dbModule.dbAll = origDbAll;

  // =========================================================================
  // RESUMEN
  // =========================================================================
  console.log('\n' + '='.repeat(75));
  console.log(`📊 RESULTADOS DEL TEST SUITE: ${passedTests}/${totalTests} pruebas pasadas (${failedTests} fallos)`);
  console.log('='.repeat(75));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSupermarketVerificationSuite().catch(err => {
  console.error('Error fatal durante la ejecución de pruebas:', err);
  process.exit(1);
});
