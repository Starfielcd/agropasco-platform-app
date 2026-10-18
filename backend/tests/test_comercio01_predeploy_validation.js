/**
 * AgroPasco Digital — Test Suite COMERCIO01: Validación Final Pre-Despliegue
 * ==============================================================================
 * Verificaciones técnicas requeridas antes de autorizar publicación:
 * 1. Idempotencia y seguridad de esquema ante ejecuciones repetidas y reinicios.
 * 2. Control de concurrencia y sobreventa: reserva, liberación y descuento de stock.
 * 3. Notificación detallada al agricultor con datos del comprador.
 * 4. Recepción de cotización de flete por el supermercado.
 * 5. Imposibilidad de entrega unilateral por el agricultor (solo supermercado confirma).
 * 6. Persistencia independiente tras cierre de sesión y reingreso con JWT renovado.
 * 7. Privacidad y aislamiento estricto contra terceros (HTTP 403).
 * ==============================================================================
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(backendDir, '.env') });
const { Pool } = require(path.join(backendDir, 'node_modules/pg'));

const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const TEST_PORT = 55435;
const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026_pasco_peru';

let passed = 0;
let failed = 0;

function report(name, isOk, detail = '') {
  if (isOk) {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${name}`);
    if (detail) console.error(`     Detalle: ${detail}`);
    failed++;
  }
}

class EphemeralPostgresManager {
  constructor(port = TEST_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_predeploy_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'postgres_server.log');
    this.started = false;
  }

  start() {
    fs.mkdirSync(this.tempDir, { recursive: true });
    execSync(`"${path.join(pgBin, 'initdb.exe')}" -D "${this.tempDir}" -U postgres -A trust --no-locale -E UTF8`, { stdio: 'ignore' });
    execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -o "-p ${this.port} -h 127.0.0.1" -l "${this.logFile}" start`, { stdio: 'ignore' });
    this.started = true;

    for (let i = 0; i < 30; i++) {
      try {
        execSync(`"${path.join(pgBin, 'pg_isready.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres`, { stdio: 'ignore' });
        break;
      } catch (_) {
        execSync('ping 127.0.0.1 -n 1 > nul', { shell: true });
      }
    }
  }

  stop() {
    if (this.started) {
      try {
        execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" stop -m immediate`, { stdio: 'ignore' });
      } catch (_) {}
      this.started = false;
    }
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

function mockReqRes(user, body = {}, params = {}, query = {}) {
  const req = { user, body, params, query };
  let statusCode = 200;
  let responseBody = null;

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseBody = data;
      return res;
    }
  };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

async function runPreDeployValidationSuite() {
  console.log('=============================================================================');
  console.log('🧪 COMERCIO01 — VALIDACIÓN TÉCNICA FINAL PRE-DESPLIEGUE EN POSTGRESQL');
  console.log('=============================================================================\n');

  const pgMgr = new EphemeralPostgresManager();
  let pool;

  try {
    pgMgr.start();
    const testDbUrl = `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres`;
    process.env.DATABASE_URL = testDbUrl;

    pool = new Pool({ connectionString: testDbUrl });

    // Configurar databaseConfig
    const databaseConfig = require('../config/database.js');
    databaseConfig.pool = pool;

    // -------------------------------------------------------------------------
    // 1. Verificación de Idempotencia y Reinicios (3 ejecuciones consecutivas)
    // -------------------------------------------------------------------------
    console.log('[CHECKPOINT 1] Verificando idempotencia de esquema ante reinicios y ejecuciones repetidas...');
    await databaseConfig.initializeSchema(pool);
    await databaseConfig.initializeCommercialSchema(pool);

    // Ejecución repetida 1
    await databaseConfig.initializeCommercialSchema(pool);
    // Ejecución repetida 2
    await databaseConfig.initializeCommercialSchema(pool);

    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('purchase_orders', 'order_status_history', 'notifications')
    `);
    report('Esquema comercial 100% idempotente tras 3 inicializaciones repetidas', tablesRes.rows.length === 3);

    // -------------------------------------------------------------------------
    // 2. Sembrado de Usuarios y Producto Inicial
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 2] Sembrando cuentas independientes y producto con stock controlado...');
    const farmerRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Pedro Mendoza Huaricapcha', 'pedro.mendoza@agropasco.pe', 'hash123', 'farmer', '+51 963777888', 'Paucartambo, Pasco')
      RETURNING id, name, email, role, phone
    `);
    const farmer = farmerRes.rows[0];

    const farmerBRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Lucía Alania', 'lucia.alania@agropasco.pe', 'hash123', 'farmer', '+51 955111222', 'Yanahuanca, Pasco')
      RETURNING id, name, email, role, phone
    `);
    const farmerB = farmerBRes.rows[0];

    const smRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Alberto Ramos Poma', 'aramos@plazapasco.pe', 'hash123', 'supermarket', '+51 988444555', 'Av. Minería 450, Chaupimarca')
      RETURNING id, name, email, role, phone
    `);
    const supermarket = smRes.rows[0];
    supermarket.supermarket_name = 'Plaza Pasco Hipermercado';

    const smBRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Rosa Quispe', 'rquispe@tottuspasco.pe', 'hash123', 'supermarket', '+51 977222333', 'Av. Los Próceres 800, Yanacancha')
      RETURNING id, name, email, role, phone
    `);
    const supermarketB = smBRes.rows[0];

    // Producto con 100 kg exactos
    const prodRes = await pool.query(`
      INSERT INTO products (
        farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, validation_status, available
      ) VALUES (
        $1, 'Papa Nativa Huayro Roja', 'papa', 'primera', 'Paucartambo, Pasco', 100.00, 4.50, 'approved', 1
      ) RETURNING id, name, stock_kg, price_per_kg, farmer_id
    `, [farmer.id]);
    const product = prodRes.rows[0];

    report('Cuentas y producto sembrados con stock inicial de 100.00 kg', parseFloat(product.stock_kg) === 100.00);

    const orderController = require('../controllers/orderController.js');
    const notificationController = require('../controllers/notificationController.js');

    // -------------------------------------------------------------------------
    // 3. Control de Concurrencia, Reserva de Stock y Prevención de Sobreventa
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 3] Verificando reserva de stock y prevención de sobreventa...');

    // Orden 1: Supermercado A solicita 60 kg (quedan 40 kg disponibles)
    const mOrder1 = mockReqRes(supermarket, {
      product_id: product.id,
      quantity_kg: 60,
      transport_modality: 'farmer_delivery',
      delivery_address: 'Av. Minería 450, Muelle Central',
      delivery_date: '2026-11-05',
      contact_phone: '+51 988444555'
    });
    await orderController.createOrder(mOrder1.req, mOrder1.res);
    report('Supermercado A reserva 60 kg exitosamente (HTTP 201)', mOrder1.getStatus() === 201);
    const order1 = mOrder1.getBody()?.data;

    // Orden 2: Supermercado B intenta solicitar 50 kg (sobreventa: 60 + 50 = 110 > 100)
    const mOrderOver = mockReqRes(supermarketB, {
      product_id: product.id,
      quantity_kg: 50,
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Paucartambo',
      delivery_date: '2026-11-06',
      contact_phone: '+51 977222333'
    });
    await orderController.createOrder(mOrderOver.req, mOrderOver.res);
    report('Supermercado B es rechazado por sobreventa (50 kg > 40 kg libres) (HTTP 400)',
      mOrderOver.getStatus() === 400 && mOrderOver.getBody()?.code === 'INSUFFICIENT_STOCK'
    );

    // Orden 3: Supermercado B solicita exactamente los 40 kg restantes
    const mOrderExact = mockReqRes(supermarketB, {
      product_id: product.id,
      quantity_kg: 40,
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Paucartambo',
      delivery_date: '2026-11-06',
      contact_phone: '+51 977222333'
    });
    await orderController.createOrder(mOrderExact.req, mOrderExact.res);
    report('Supermercado B compromete los 40 kg restantes exitosamente (HTTP 201)', mOrderExact.getStatus() === 201);
    const order2 = mOrderExact.getBody()?.data;

    // Liberación de stock: Supermercado B cancela la orden 2
    const mCancel2 = mockReqRes(supermarketB, { action: 'cancel', notes: 'Reajuste presupuestario' }, { id: order2.id });
    await orderController.supermarketResponse(mCancel2.req, mCancel2.res);
    report('Supermercado B cancela su orden y se libera el inventario (HTTP 200)', mCancel2.getStatus() === 200);

    // Tras liberación, Supermercado B ahora sí puede solicitar 30 kg
    const mOrderReallocated = mockReqRes(supermarketB, {
      product_id: product.id,
      quantity_kg: 30,
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Paucartambo',
      delivery_date: '2026-11-06',
      contact_phone: '+51 977222333'
    });
    await orderController.createOrder(mOrderReallocated.req, mOrderReallocated.res);
    report('Inventario liberado reasignado exitosamente a nueva solicitud de 30 kg (HTTP 201)', mOrderReallocated.getStatus() === 201);

    // -------------------------------------------------------------------------
    // 4. Verificación de Notificación Detallada al Agricultor
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 4] Verificando notificación detallada en la campana del agricultor...');
    const notifRow = await pool.query(`
      SELECT * FROM notifications WHERE user_id = $1 AND order_id = $2
    `, [farmer.id, order1.id]);
    const notif = notifRow.rows[0];

    report('Notificación persistida en tabla notifications', notif !== undefined);
    report('Notificación incluye nombre del representante (Alberto Ramos Poma)', notif.message.includes('Alberto Ramos Poma'));
    report('Notificación incluye teléfono autorizado (+51 988444555)', notif.message.includes('+51 988444555'));
    report('Notificación incluye cantidad (60 kg)', notif.message.includes('60 kg'));
    report('Notificación incluye dirección (Av. Minería 450, Muelle Central)', notif.message.includes('Av. Minería 450, Muelle Central'));
    report('Notificación indica modalidad de entrega y estado pendiente de cotización',
      notif.message.includes('Modalidad: el agricultor entrega en el supermercado') &&
      notif.message.includes('pendiente de cotización')
    );

    // -------------------------------------------------------------------------
    // 5. Negociación de Flete y Recepción por el Supermercado
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 5] Verificando cotización de flete y notificación al supermercado...');
    const mQuote = mockReqRes(farmer, { action: 'quote_transport', transport_cost: 75.00, notes: 'Camión furgón térmico' }, { id: order1.id });
    await orderController.farmerResponse(mQuote.req, mQuote.res);
    report('Agricultor cotiza flete en S/ 75.00 (HTTP 200)', mQuote.getStatus() === 200);

    const smNotif = await pool.query(`
      SELECT * FROM notifications WHERE user_id = $1 AND order_id = $2
    `, [supermarket.id, order1.id]);
    report('Supermercado recibe notificación con propuesta de flete de S/ 75.00',
      smNotif.rows.length >= 1 && smNotif.rows[0].message.includes('75.00')
    );

    // Supermercado acepta flete
    const mSmAccept = mockReqRes(supermarket, { action: 'accept_transport' }, { id: order1.id });
    await orderController.supermarketResponse(mSmAccept.req, mSmAccept.res);
    report('Supermercado acepta el flete y la orden pasa a "aceptada" (HTTP 200)', mSmAccept.getStatus() === 200);

    // -------------------------------------------------------------------------
    // 6. Imposibilidad de Entrega Unilateral por el Agricultor
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 6] Verificando que el agricultor NO pueda marcar la orden como entregada...');
    // Agricultor avanza preparación y traslado
    await orderController.farmerResponse(mockReqRes(farmer, { action: 'start_preparation' }, { id: order1.id }).req, mockReqRes(farmer, {}).res);
    await orderController.farmerResponse(mockReqRes(farmer, { action: 'ready_for_dispatch' }, { id: order1.id }).req, mockReqRes(farmer, {}).res);
    await orderController.farmerResponse(mockReqRes(farmer, { action: 'start_transit' }, { id: order1.id }).req, mockReqRes(farmer, {}).res);

    // Agricultor intenta marcar "confirm_delivery" o "entregada"
    const mFarmerIllegalDeliver = mockReqRes(farmer, { action: 'confirm_delivery' }, { id: order1.id });
    await orderController.farmerResponse(mFarmerIllegalDeliver.req, mFarmerIllegalDeliver.res);
    report('Agricultor bloqueado si intenta marcar entrega en farmerResponse (HTTP 400 Acción no reconocida)',
      mFarmerIllegalDeliver.getStatus() === 400
    );

    const mFarmerIllegalSmRoute = mockReqRes(farmer, { action: 'confirm_delivery' }, { id: order1.id });
    await orderController.supermarketResponse(mFarmerIllegalSmRoute.req, mFarmerIllegalSmRoute.res);
    report('Agricultor bloqueado si intenta invocar endpoint de confirmación del supermercado (HTTP 403 Forbidden)',
      mFarmerIllegalSmRoute.getStatus() === 403
    );

    // Solo el supermercado confirma la entrega
    const mSmDeliver = mockReqRes(supermarket, { action: 'confirm_delivery' }, { id: order1.id });
    await orderController.supermarketResponse(mSmDeliver.req, mSmDeliver.res);
    report('Supermercado confirma recepción y orden culmina como "entregada" (HTTP 200)',
      mSmDeliver.getStatus() === 200 && mSmDeliver.getBody()?.data?.status === 'entregada'
    );

    // Descuento definitivo de stock tras entrega
    const finalProdRow = await pool.query('SELECT stock_kg FROM products WHERE id = $1', [product.id]);
    report('Descuento de inventario verificado en PostgreSQL (100 kg - 60 kg = 40 kg)',
      parseFloat(finalProdRow.rows[0].stock_kg) === 40.00
    );

    // -------------------------------------------------------------------------
    // 7. Persistencia y Reingreso tras Cierre de Sesión (Simulación JWT)
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 7] Verificando persistencia y recarga de sesión tras logout/login...');
    // Nuevo token de sesión emitido tras login
    const freshFarmerTokenUser = { id: farmer.id, name: farmer.name, email: farmer.email, role: farmer.role };
    const mFreshOrders = mockReqRes(freshFarmerTokenUser);
    await orderController.getOrders(mFreshOrders.req, mFreshOrders.res);

    const freshOrdersList = mFreshOrders.getBody()?.data || [];
    report('Sesión renovada del agricultor recupera exactamente sus órdenes persistidas en PostgreSQL',
      freshOrdersList.length >= 1 && freshOrdersList.some(o => o.id === order1.id)
    );

    // -------------------------------------------------------------------------
    // 8. Privacidad Estricta de Datos contra Terceros (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n[CHECKPOINT 8] Verificando protección y privacidad de datos contra terceros...');
    // Agricultor B (ajeno a la orden) intenta consultar orden 1
    const mSpyFarmer = mockReqRes(farmerB, {}, { id: order1.id });
    await orderController.getOrderById(mSpyFarmer.req, mSpyFarmer.res);
    report('Tercero (Agricultor B) recibe HTTP 403 al intentar acceder a la orden 1',
      mSpyFarmer.getStatus() === 403
    );

    // Supermercado B (ajeno a la orden 1) intenta consultar orden 1
    const mSpySm = mockReqRes(supermarketB, {}, { id: order1.id });
    await orderController.getOrderById(mSpySm.req, mSpySm.res);
    report('Tercero (Supermercado B) recibe HTTP 403 al intentar acceder a la orden 1',
      mSpySm.getStatus() === 403
    );

  } catch (err) {
    console.error('Error crítico en suite de validación pre-despliegue:', err);
    failed++;
  } finally {
    if (pool) await pool.end().catch(() => {});
    pgMgr.stop();
  }

  console.log('\n=============================================================================');
  console.log(` RESULTADOS VALIDACIÓN PRE-DESPLIEGUE: ${passed} PASARON | ${failed} FALLARON`);
  console.log('=============================================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runPreDeployValidationSuite();
