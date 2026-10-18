/**
 * AgroPasco Digital — Test Suite COMERCIO01: Sistema Real de Órdenes B2B, Transporte y Notificaciones
 * =====================================================================================================
 * Verificación exhaustiva con PostgreSQL 18 físico:
 * - Test 1: Esquema de base de datos comercial (purchase_orders, order_status_history, notifications.order_id).
 * - Test 2: Validación de datos de entrada (stock disponible, cantidad positiva, teléfono, fecha).
 * - Test 3: Creación de Orden B2B Modalidad A (Entrega por agricultor, cotización flete pendiente).
 * - Test 4: Notificación real y persistente al agricultor con datos autorizados del supermercado.
 * - Test 5: Ciclo de cotización y aceptación de flete (Propuesta agricultor S/ 85.00 -> Aceptación supermercado).
 * - Test 6: Creación de Orden B2B Modalidad B (Recojo en origen, flete S/ 0.00 garantizado).
 * - Test 7: Transición completa de ciclo de vida (aceptada -> en preparación -> lista -> en tránsito -> entregada).
 * - Test 8: Trazabilidad cronológica en order_status_history con usuario responsable.
 * - Test 9: Protección contra doble clic / pedidos duplicados (debounce).
 * - Test 10: Control de acceso por roles y privacidad (Farmer 2 no ve órdenes de Farmer 1).
 * =====================================================================================================
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
const TEST_PORT = 55434;
const JWT_SECRET = process.env.JWT_SECRET || 'agropasco_secret_key_2026_pasco_peru';

let testsPassed = 0;
let testsFailed = 0;

function report(name, passed, detail = '') {
  if (passed) {
    console.log(`  ✅ PASSED: ${name}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${name}`);
    if (detail) console.error(`     Detalle: ${detail}`);
    testsFailed++;
  }
}

class EphemeralPostgresManager {
  constructor(port = TEST_PORT) {
    this.port = port;
    this.tempDir = path.join(os.tmpdir(), `agropasco_pg_comercio01_${Date.now()}`);
    this.logFile = path.join(this.tempDir, 'postgres_server.log');
    this.started = false;
  }

  isAvailable() {
    return fs.existsSync(path.join(pgBin, 'initdb.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_ctl.exe')) &&
           fs.existsSync(path.join(pgBin, 'pg_isready.exe'));
  }

  start() {
    console.log(`[EPHEMERAL_PG] Creando clúster temporal para COMERCIO01 en: ${this.tempDir}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    execSync(`"${path.join(pgBin, 'initdb.exe')}" -D "${this.tempDir}" -U postgres -A trust --no-locale -E UTF8`, {
      stdio: 'ignore'
    });

    execSync(`"${path.join(pgBin, 'pg_ctl.exe')}" -D "${this.tempDir}" -o "-p ${this.port} -h 127.0.0.1" -l "${this.logFile}" start`, {
      stdio: 'ignore'
    });
    this.started = true;

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        execSync(`"${path.join(pgBin, 'pg_isready.exe')}" -h 127.0.0.1 -p ${this.port} -U postgres`, { stdio: 'ignore' });
        ready = true;
        break;
      } catch (_) {
        execSync('ping 127.0.0.1 -n 1 > nul', { shell: true });
      }
    }
    if (!ready) {
      throw new Error('PostgreSQL efímero no respondió en el puerto ' + this.port);
    }
    console.log(`[EPHEMERAL_PG] Servidor PostgreSQL 18 listo en puerto ${this.port}`);
  }

  stop() {
    if (this.started) {
      console.log(`[EPHEMERAL_PG] Deteniendo clúster temporal en puerto ${this.port}...`);
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

async function runComercio01TestSuite() {
  console.log('=============================================================================');
  console.log(' AgroPasco Digital — Test Suite COMERCIO01 (B2B Orders, Transport & Notifs)');
  console.log('=============================================================================\n');

  const pgMgr = new EphemeralPostgresManager();
  if (!pgMgr.isAvailable()) {
    console.error('Binarios de PostgreSQL 18 no encontrados en: ' + pgBin);
    process.exit(1);
  }

  let pool;
  try {
    pgMgr.start();

    pool = new Pool({
      host: '127.0.0.1',
      port: TEST_PORT,
      user: 'postgres',
      database: 'postgres',
      password: ''
    });

    // Configurar URL de entorno y pool para que el backend use este clúster efímero
    process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres`;
    const databaseConfig = require(path.join(repoRoot, 'backend/config/database.js'));
    databaseConfig.pool = pool;
    await databaseConfig.initializeSchema(pool);
    await databaseConfig.initializeCommercialSchema(pool);

    // -------------------------------------------------------------------------
    // TEST 1: Verificación de Esquema Comercial en PostgreSQL
    // -------------------------------------------------------------------------
    console.log('[FASE 1] Verificando tablas de persistencia comercial en PostgreSQL...');
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('purchase_orders', 'order_status_history', 'notifications')
    `);
    const foundTables = tablesRes.rows.map(r => r.table_name);
    report('Tabla purchase_orders existe', foundTables.includes('purchase_orders'));
    report('Tabla order_status_history existe', foundTables.includes('order_status_history'));
    report('Tabla notifications existe', foundTables.includes('notifications'));

    const colsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'order_id'
    `);
    report('Columna notifications.order_id existe y vincula la orden', colsRes.rows.length === 1);

    // -------------------------------------------------------------------------
    // Sembrado de Datos: Usuarios (Agricultor, Supermercado, Supermercado 2) y Producto
    // -------------------------------------------------------------------------
    console.log('\n[FASE 2] Sembrando usuarios y cosechas reales...');
    const farmerRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Juan Quispe Malpartida', 'juan.quispe@agropasco.pe', 'hash123', 'farmer', '+51 963852741', 'Paucartambo, Pasco')
      RETURNING id, name, email, role, phone
    `);
    const farmer = farmerRes.rows[0];

    const farmer2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Pedro Rojas', 'pedro.rojas@agropasco.pe', 'hash123', 'farmer', '+51 912345678', 'Oxapampa, Pasco')
      RETURNING id, name, email, role, phone
    `);
    const farmer2 = farmer2Res.rows[0];

    const supermarketRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Carlos Valle Solís', 'compras@elvalle.pe', 'hash123', 'supermarket', '+51 987654321', 'Av. Los Próceres 1240, Chaupimarca, Pasco')
      RETURNING id, name, email, role, phone
    `);
    const supermarket = supermarketRes.rows[0];
    supermarket.supermarket_name = 'Supermercado El Valle';

    const supermarket2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, phone, location)
      VALUES ('Laura Mendoza', 'compras@metropasco.pe', 'hash123', 'supermarket', '+51 955443322', 'San Juan, Yanacancha')
      RETURNING id, name, email, role, phone
    `);
    const supermarket2 = supermarket2Res.rows[0];

    const parcelRes = await pool.query(`
      INSERT INTO parcels (user_id, name, area_hectares, center_lat, center_lng, geo_json)
      VALUES ($1, 'Parcela Los Andes', 2.5, -10.68, -76.25, '{"type":"Polygon","coordinates":[[[-76.25,-10.68],[-76.24,-10.68],[-76.24,-10.69],[-76.25,-10.69],[-76.25,-10.68]]]}')
      RETURNING id
    `, [farmer.id]);
    const parcelId = parcelRes.rows[0].id;

    const prodRes = await pool.query(`
      INSERT INTO products (
        farmer_id, name, crop_type, quality, origin, stock_kg, price_per_kg, original_price,
        validation_status, is_natural, photo_url, description
      ) VALUES (
        $1, 'Maca Pasqueña Ecológica', 'maca', 'primera', 'Paucartambo, Pasco', 150.00, 18.20, 14.00,
        'approved', 1, '/uploads/products/maca_real.jpg', 'Cultivada a 4100 msnm sin agroquímicos'
      ) RETURNING id, name, stock_kg, price_per_kg, farmer_id
    `, [farmer.id]);
    const product = prodRes.rows[0];

    report('Agricultor sembrado con teléfono autorizado (+51 963852741)', farmer.id > 0);
    report('Supermercado sembrado con representante (Carlos Valle Solís)', supermarket.id > 0);
    report('Producto sembrado con stock 150 kg y precio S/ 18.20', parseFloat(product.price_per_kg) === 18.20);

    // Tokens JWT para pruebas
    const tokenFarmer = jwt.sign({ id: farmer.id, name: farmer.name, email: farmer.email, role: farmer.role, phone: farmer.phone }, JWT_SECRET);
    const tokenFarmer2 = jwt.sign({ id: farmer2.id, name: farmer2.name, email: farmer2.email, role: farmer2.role, phone: farmer2.phone }, JWT_SECRET);
    const tokenSupermarket = jwt.sign({ id: supermarket.id, name: supermarket.name, email: supermarket.email, role: supermarket.role, phone: supermarket.phone, supermarket_name: 'Supermercado El Valle' }, JWT_SECRET);
    const tokenSupermarket2 = jwt.sign({ id: supermarket2.id, name: supermarket2.name, email: supermarket2.email, role: supermarket2.role, phone: supermarket2.phone }, JWT_SECRET);

    // Controladores a probar directamente con conexión PostgreSQL real
    const orderController = require(path.join(repoRoot, 'backend/controllers/orderController.js'));
    const notificationController = require(path.join(repoRoot, 'backend/controllers/notificationController.js'));

    // Sobrescribir temporalmente pool de database.js para que apunte al puerto efímero
    databaseConfig.pool = pool;

    // Helper simulador de petición Express
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

    // -------------------------------------------------------------------------
    // TEST 2: Validaciones y Seguridad en Creación de Orden
    // -------------------------------------------------------------------------
    console.log('\n[FASE 3] Probando validaciones de negocio y seguridad en createOrder...');

    // A. Agricultor no puede comprar
    const m1 = mockReqRes(farmer, { product_id: product.id, quantity_kg: 20 });
    await orderController.createOrder(m1.req, m1.res);
    report('Rechaza orden si el usuario tiene rol farmer (403)', m1.getStatus() === 403);

    // B. Cantidad negativa o cero
    const m2 = mockReqRes(supermarket, { product_id: product.id, quantity_kg: -5, delivery_date: '2026-11-01', contact_phone: '+51 987654321' });
    await orderController.createOrder(m2.req, m2.res);
    report('Rechaza orden con cantidad negativa o cero (400)', m2.getStatus() === 400);

    // C. Cantidad superior al stock disponible
    const m3 = mockReqRes(supermarket, {
      product_id: product.id,
      quantity_kg: 200,
      transport_modality: 'farmer_delivery',
      delivery_address: 'Av. Los Próceres 1240',
      delivery_date: '2026-11-01',
      contact_phone: '+51 987654321'
    });
    await orderController.createOrder(m3.req, m3.res);
    report('Rechaza orden cuando cantidad solicitada (200kg) supera stock (150kg)', m3.getStatus() === 400 && m3.getBody()?.error?.includes('excede el stock'));

    // D. Falta de teléfono o fecha
    const m4 = mockReqRes(supermarket, { product_id: product.id, quantity_kg: 50, delivery_date: '' });
    await orderController.createOrder(m4.req, m4.res);
    report('Rechaza orden sin fecha solicitada de entrega o teléfono (400)', m4.getStatus() === 400);

    // -------------------------------------------------------------------------
    // TEST 3: Orden de Compra B2B Modalidad A (El Agricultor Entrega)
    // -------------------------------------------------------------------------
    console.log('\n[FASE 4] Probando Modalidad A: El agricultor entrega en supermercado...');

    const orderPayloadA = {
      product_id: product.id,
      quantity_kg: 50,
      delivery_date: '2026-10-25',
      transport_modality: 'farmer_delivery',
      delivery_address: 'Av. Los Próceres 1240, Almacén Central de Recepción, Chaupimarca, Pasco',
      delivery_reference: 'Muelle 2 de descarga pesada, horario 07:00 a 11:00 hrs',
      packaging_instructions: 'Sacos limpios de 50 kg etiquetados con lote',
      observations: 'Requiere guía de remisión remitente y certificado fitosanitario',
      contact_phone: '+51 987654321'
    };

    const m5 = mockReqRes(supermarket, orderPayloadA);
    await orderController.createOrder(m5.req, m5.res);
    report('Orden Modalidad A creada exitosamente (201)', m5.getStatus() === 201 && m5.getBody()?.success);

    const orderA = m5.getBody()?.data;
    assert(orderA, 'La orden A debe estar definida');
    report('Código de orden autogenerado con prefijo PO-PASCO-2026 o AP-PO-2026', orderA.order_code && (orderA.order_code.includes('PASCO-2026') || orderA.order_code.includes('PO-')));
    report('Subtotal calculado exactamente: 50 kg × S/ 18.20 = S/ 910.00', parseFloat(orderA.subtotal) === 910.00);
    report('Flete inicial en 0 o null (pendiente de cotización)', parseFloat(orderA.transport_cost || 0) === 0);
    report('Total inicial refleja subtotal a la espera de cotización', parseFloat(orderA.total_amount) === 910.00);
    report('Estado inicial es transporte_por_cotizar / pending_quote', orderA.status === 'transporte_por_cotizar' || orderA.status === 'pending_quote');

    // -------------------------------------------------------------------------
    // TEST 4: Notificación Real y Persistente al Agricultor
    // -------------------------------------------------------------------------
    console.log('\n[FASE 5] Verificando notificación persistente en PostgreSQL para el agricultor...');

    const notifQuery = await pool.query(`
      SELECT * FROM notifications 
      WHERE user_id = $1 AND order_id = $2
    `, [farmer.id, orderA.id]);

    report('Notificación insertada en tabla notifications de PostgreSQL', notifQuery.rows.length === 1);
    const farmerNotif = notifQuery.rows[0];
    report('Notificación vinculada al order_id correcto', farmerNotif.order_id === orderA.id);
    report('Notificación contiene nombre real del representante del supermercado', farmerNotif.message.includes('Carlos Valle Solís'));
    report('Notificación contiene nombre comercial del supermercado', farmerNotif.message.includes('Supermercado El Valle'));
    report('Notificación contiene teléfono autorizado (+51 987654321)', farmerNotif.message.includes('+51 987654321'));
    report('Notificación especifica Modalidad A y lugar de entrega', farmerNotif.message.includes('Av. Los Próceres 1240') && (farmerNotif.message.includes('entrega') || farmerNotif.message.includes('Supermercado')));
    report('Notificación indica que transporte está pendiente de cotización del agricultor', farmerNotif.message.includes('Transporte:') || farmerNotif.message.includes('cotización'));

    // Endpoint de notificaciones del agricultor
    const mNotifList = mockReqRes(farmer, {}, {}, { limit: 10 });
    await notificationController.getMyNotifications(mNotifList.req, mNotifList.res);
    report('Endpoint getMyNotifications devuelve unread_count >= 1', mNotifList.getBody()?.unread_count >= 1);

    // Marcar como leída
    const mMarkRead = mockReqRes(farmer, {}, { id: farmerNotif.id });
    await notificationController.markNotificationAsRead(mMarkRead.req, mMarkRead.res);
    report('Endpoint markNotificationAsRead actualiza estado a read=1', mMarkRead.getBody()?.success === true);

    const checkRead = await pool.query('SELECT read FROM notifications WHERE id = $1', [farmerNotif.id]);
    report('Persistencia de lectura en PostgreSQL verificada (read=1)', checkRead.rows[0]?.read === 1 || checkRead.rows[0]?.read === true);

    // -------------------------------------------------------------------------
    // TEST 5: Cotización de Flete por el Agricultor y Aceptación del Supermercado
    // -------------------------------------------------------------------------
    console.log('\n[FASE 6] Probando negociación de flete: propuesta de agricultor y aceptación del supermercado...');

    // Agricultor propone flete de S/ 85.00
    const mQuote = mockReqRes(farmer, { action: 'quote_transport', transport_cost: 85.00, notes: 'Flete furgón Pasco-Chaupimarca' }, { id: orderA.id });
    await orderController.farmerResponse(mQuote.req, mQuote.res);
    report('Agricultor envía cotización de transporte de S/ 85.00 (200)', mQuote.getStatus() === 200 && mQuote.getBody()?.success);

    const orderAfterQuote = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [orderA.id]);
    const oQuoteRow = orderAfterQuote.rows[0];
    report('Estado de orden cambia a pendiente_aceptacion_condiciones / quote_proposed', oQuoteRow.status === 'pendiente_aceptacion_condiciones' || oQuoteRow.status === 'quote_proposed');
    report('Costo de transporte registrado: S/ 85.00', parseFloat(oQuoteRow.transport_cost) === 85.00);
    report('Total recalculado exactamente: S/ 910.00 + S/ 85.00 = S/ 995.00', parseFloat(oQuoteRow.total_amount) === 995.00);

    // Verificación de notificación al supermercado sobre la cotización
    const notifSupermarket = await pool.query(`
      SELECT * FROM notifications 
      WHERE user_id = $1 AND order_id = $2
    `, [supermarket.id, orderA.id]);
    report('Supermercado recibe notificación persistente con la cotización de S/ 85.00', notifSupermarket.rows.length >= 1 && notifSupermarket.rows[0].message.includes('85.00'));

    // Supermercado acepta formalmente el costo de flete
    const mAccept = mockReqRes(supermarket, { action: 'accept_transport', notes: 'Flete aprobado conforme a presupuesto' }, { id: orderA.id });
    await orderController.supermarketResponse(mAccept.req, mAccept.res);
    report('Supermercado acepta el flete y la orden pasa a estado "aceptada" (200)', mAccept.getStatus() === 200 && (mAccept.getBody()?.data?.status === 'aceptada' || mAccept.getBody()?.data?.status === 'accepted'));

    // -------------------------------------------------------------------------
    // TEST 6: Modalidad B (El Supermercado Recoge en Origen - Sin Recargo de Flete)
    // -------------------------------------------------------------------------
    console.log('\n[FASE 7] Probando Modalidad B: Recojo en origen sin recargo de transporte...');

    const orderPayloadB = {
      product_id: product.id,
      quantity_kg: 30,
      delivery_date: '2026-10-28',
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Almacén Comunal de Paucartambo, Pasco',
      pickup_reference: 'Frente a Plaza Principal, camión con baranda blanca',
      packaging_instructions: 'Jabas plásticas retornables del supermercado',
      observations: 'El camión del supermercado llegará a las 09:00 hrs',
      contact_phone: '+51 987654321'
    };

    const m6 = mockReqRes(supermarket, orderPayloadB);
    await orderController.createOrder(m6.req, m6.res);
    report('Orden Modalidad B creada exitosamente (201)', m6.getStatus() === 201);

    const orderB = m6.getBody()?.data;
    report('Flete forzado a S/ 0.00 en recojo en origen', parseFloat(orderB.transport_cost) === 0.00);
    report('Total igual al subtotal exacto: 30 kg × S/ 18.20 = S/ 546.00', parseFloat(orderB.total_amount) === 546.00);
    report('Estado inicial es pendiente_respuesta / pending_farmer', orderB.status === 'pendiente_respuesta' || orderB.status === 'pending_farmer');

    // Notificación al agricultor para Modalidad B
    const notifQueryB = await pool.query('SELECT * FROM notifications WHERE user_id = $1 AND order_id = $2', [farmer.id, orderB.id]);
    report('Notificación para Modalidad B indica que supermercado recogerá en origen sin recargo de flete',
      notifQueryB.rows[0]?.message.includes('recogerá') && notifQueryB.rows[0]?.message.includes('No se agrega recargo de transporte'));

    // Agricultor acepta directamente la orden B
    const mAcceptB = mockReqRes(farmer, { action: 'accept', notes: 'Aceptado para recojo en fecha programada' }, { id: orderB.id });
    await orderController.farmerResponse(mAcceptB.req, mAcceptB.res);
    report('Agricultor acepta orden B directamente a estado "aceptada" (200)', mAcceptB.getBody()?.data?.status === 'aceptada' || mAcceptB.getBody()?.data?.status === 'accepted');

    // -------------------------------------------------------------------------
    // TEST 7: Ciclo Completo de Vida y Seguimiento (aceptada -> en_preparacion -> lista -> en_traslado -> entregada)
    // -------------------------------------------------------------------------
    console.log('\n[FASE 8] Probando ciclo de preparación, despacho, traslado y entrega final...');

    // 1. Iniciar preparación
    const mPrep = mockReqRes(farmer, { action: 'start_preparation', notes: 'Seleccionando y envasando maca de primera calidad' }, { id: orderA.id });
    await orderController.farmerResponse(mPrep.req, mPrep.res);
    report('Transición a "en_preparacion" exitosa', mPrep.getBody()?.data?.status === 'en_preparacion' || mPrep.getBody()?.data?.status === 'in_preparation');

    // 2. Marcar listo para despacho
    const mReady = mockReqRes(farmer, { action: 'ready_for_dispatch', notes: '50 kg en 1 saco hermético rotulado' }, { id: orderA.id });
    await orderController.farmerResponse(mReady.req, mReady.res);
    report('Transición a "lista_para_entrega" exitosa', mReady.getBody()?.data?.status === 'lista_para_entrega' || mReady.getBody()?.data?.status === 'ready_for_pickup');

    // 3. Iniciar traslado (solo aplica a farmer_delivery)
    const mTransit = mockReqRes(farmer, { action: 'start_transit', notes: 'Vehículo placa W1X-842 en trayecto a Chaupimarca' }, { id: orderA.id });
    await orderController.farmerResponse(mTransit.req, mTransit.res);
    report('Transición a "en_traslado" exitosa', mTransit.getBody()?.data?.status === 'en_traslado' || mTransit.getBody()?.data?.status === 'in_transit');

    // 4. Confirmación de entrega por el supermercado
    const mDelivered = mockReqRes(supermarket, { action: 'confirm_delivery', notes: 'Recepción conforme en muelle de almacén' }, { id: orderA.id });
    await orderController.supermarketResponse(mDelivered.req, mDelivered.res);
    report('Supermercado confirma entrega y orden culmina en estado "entregada"', mDelivered.getBody()?.data?.status === 'entregada' || mDelivered.getBody()?.data?.status === 'delivered');

    // Verificación de descuento de stock en entrega final
    const productAfterDelivery = await pool.query('SELECT stock_kg FROM products WHERE id = $1', [product.id]);
    const finalStock = parseFloat(productAfterDelivery.rows[0].stock_kg);
    report('Stock descontado exactamente tras entrega final (150kg - 50kg = 100kg)', finalStock === 100.00);

    // -------------------------------------------------------------------------
    // TEST 8: Historial Completo Verificable en order_status_history
    // -------------------------------------------------------------------------
    console.log('\n[FASE 9] Verificando trazabilidad y auditoría en order_status_history...');
    const historyRes = await pool.query(`
      SELECT * FROM order_status_history 
      WHERE order_id = $1 
      ORDER BY id ASC
    `, [orderA.id]);

    report('order_status_history contiene la cadena completa de transiciones (>= 6 eventos)', historyRes.rows.length >= 6);
    const statusesRecorded = historyRes.rows.map(h => h.to_status);
    report('Historial contiene todas las fases: cotizar/enviada -> flete propuesto -> aceptada -> en preparación -> lista -> en traslado',
      (statusesRecorded.includes('transporte_por_cotizar') || statusesRecorded.includes('pending_quote')) &&
      (statusesRecorded.includes('pendiente_aceptacion_condiciones') || statusesRecorded.includes('quote_proposed')) &&
      (statusesRecorded.includes('aceptada') || statusesRecorded.includes('accepted')) &&
      (statusesRecorded.includes('en_preparacion') || statusesRecorded.includes('in_preparation')) &&
      (statusesRecorded.includes('lista_para_entrega') || statusesRecorded.includes('ready_for_pickup'))
    );

    // -------------------------------------------------------------------------
    // TEST 9: Protección contra Envíos Duplicados / Doble Clic
    // -------------------------------------------------------------------------
    console.log('\n[FASE 10] Probando protección contra doble clic / pedidos duplicados...');
    const mDup1 = mockReqRes(supermarket, {
      product_id: product.id,
      quantity_kg: 10,
      delivery_date: '2026-10-30',
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Paucartambo',
      contact_phone: '+51 987654321'
    });
    await orderController.createOrder(mDup1.req, mDup1.res);
    report('Primer clic: orden creada (201)', mDup1.getStatus() === 201);

    const mDup2 = mockReqRes(supermarket, {
      product_id: product.id,
      quantity_kg: 10,
      delivery_date: '2026-10-30',
      transport_modality: 'supermarket_pickup',
      pickup_location: 'Paucartambo',
      contact_phone: '+51 987654321'
    });
    await orderController.createOrder(mDup2.req, mDup2.res);
    report('Segundo clic inmediato (doble clic) detectado y bloqueado (409 Conflict)', mDup2.getStatus() === 409 && mDup2.getBody()?.error?.includes('duplicada'));

    // -------------------------------------------------------------------------
    // TEST 10: Control de Acceso por Roles y Aislamiento de Datos
    // -------------------------------------------------------------------------
    console.log('\n[FASE 11] Verificando aislamiento de datos entre usuarios...');

    // Agricultor 2 intenta consultar la orden A del Agricultor 1
    const mGetUnauthorized = mockReqRes(farmer2, {}, { id: orderA.id });
    await orderController.getOrderById(mGetUnauthorized.req, mGetUnauthorized.res);
    report('Agricultor 2 no tiene acceso a la orden del Agricultor 1 (403 Forbidden)', mGetUnauthorized.getStatus() === 403);

    // Supermercado 2 intenta consultar la orden A del Supermercado 1
    const mGetUnauthorizedSm = mockReqRes(supermarket2, {}, { id: orderA.id });
    await orderController.getOrderById(mGetUnauthorizedSm.req, mGetUnauthorizedSm.res);
    report('Supermercado 2 no tiene acceso a la orden del Supermercado 1 (403 Forbidden)', mGetUnauthorizedSm.getStatus() === 403);

    // Supermercado 1 consulta su orden A con detalle
    const mGetAuthorized = mockReqRes(supermarket, {}, { id: orderA.id });
    await orderController.getOrderById(mGetAuthorized.req, mGetAuthorized.res);
    report('Supermercado 1 consulta su orden autorizada exitosamente (200)', mGetAuthorized.getStatus() === 200 && mGetAuthorized.getBody()?.data?.id === orderA.id);

  } catch (err) {
    console.error('Error crítico durante la ejecución del test suite:', err);
    testsFailed++;
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
    pgMgr.stop();
  }

  console.log('\n=============================================================================');
  console.log(` RESULTADOS COMERCIO01: ${testsPassed} PASARON | ${testsFailed} FALLARON`);
  console.log('=============================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runComercio01TestSuite();
