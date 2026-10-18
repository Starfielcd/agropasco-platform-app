/**
 * AgroPasco — Controlador de Órdenes de Compra B2B (COMERCIO01)
 * =============================================================
 * Flujo comercial completo y seguro entre Agricultor y Supermercado:
 * - Creación de solicitudes de compra B2B con validación estricta de stock y precios de backend.
 * - Soporte para Modalidad A (Entrega por agricultor + cotización de flete)
 *   y Modalidad B (Recojo en origen por supermercado sin recargo).
 * - Notificaciones persistentes atómicas y trazabilidad de ciclo de vida en PostgreSQL.
 * - Control de acceso por rol y propiedad de la orden.
 */

const { dbRun, dbGet, dbAll, withTransaction } = require('../config/database');

/**
 * Genera un código legible y único para la orden de compra
 */
function generateOrderCode() {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  return `PO-PASCO-${year}-${randomSuffix}`;
}

/**
 * 1. Crear Orden de Compra B2B (Supermercado)
 * POST /api/v1/supermarket/orders
 */
async function createOrder(req, res) {
  try {
    const rawQty = req.body.quantity !== undefined ? req.body.quantity : req.body.quantity_kg;
    const rawDate = req.body.requested_date || req.body.delivery_date;
    const rawPhone = req.body.buyer_contact_phone || req.body.contact_phone;
    const rawDeliveryAddress = req.body.delivery_address;
    const rawDeliveryRef = req.body.delivery_reference;
    const rawPickupLocation = req.body.pickup_location;
    const rawPickupRef = req.body.pickup_reference;
    const rawPackaging = req.body.packaging_instructions;
    const rawNotes = req.body.notes || req.body.observations;
    const transport_modality = req.body.transport_modality;
    const product_id = req.body.product_id;
    const agreed_time_slot = req.body.agreed_time_slot;
    const supermarket_name = req.body.supermarket_name;
    const buyer_representative_name = req.body.buyer_representative_name;
    const buyer_contact_email = req.body.buyer_contact_email;

    const buyerId = req.user?.id;
    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Sesión no autenticada.', code: 'UNAUTHORIZED' });
    }

    if (req.user?.role && req.user.role !== 'supermarket' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Solo los usuarios con rol Supermercado o Administrador pueden emitir órdenes de compra.',
        code: 'FORBIDDEN_ROLE'
      });
    }

    // 1. Validaciones básicas de campos
    if (!product_id) {
      return res.status(400).json({ success: false, error: 'El ID del producto es obligatorio.', code: 'MISSING_PRODUCT_ID' });
    }

    const numQty = parseFloat(rawQty);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'La cantidad solicitada debe ser un número positivo mayor a 0 kg.',
        code: 'INVALID_QUANTITY'
      });
    }

    if (!transport_modality || !['farmer_delivery', 'supermarket_pickup'].includes(transport_modality)) {
      return res.status(400).json({
        success: false,
        error: 'Debe especificar una modalidad de transporte válida (farmer_delivery o supermarket_pickup).',
        code: 'INVALID_TRANSPORT_MODALITY'
      });
    }

    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      return res.status(400).json({
        success: false,
        error: 'La fecha de entrega o recojo solicitada es obligatoria y debe ser una fecha válida.',
        code: 'INVALID_REQUESTED_DATE'
      });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const reqDateStr = new Date(rawDate).toISOString().split('T')[0];
    if (reqDateStr < todayStr) {
      return res.status(400).json({
        success: false,
        error: 'La fecha solicitada no puede ser anterior a la fecha actual.',
        code: 'PAST_DATE_ERROR'
      });
    }

    if (transport_modality === 'farmer_delivery' && (!rawDeliveryAddress || !rawDeliveryAddress.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Para la modalidad de entrega en supermercado, la dirección exacta de recepción es obligatoria.',
        code: 'MISSING_DELIVERY_ADDRESS'
      });
    }

    // 2. Obtener datos del comprador desde la base de datos
    const buyer = await dbGet('SELECT id, name, email, phone, location FROM users WHERE id = ?', [buyerId]);
    if (!buyer) {
      return res.status(401).json({ success: false, error: 'Usuario comprador no encontrado en el sistema.', code: 'USER_NOT_FOUND' });
    }

    const finalSupermarketName = (supermarket_name && supermarket_name.trim()) || req.user?.supermarket_name || buyer.name;
    const finalBuyerRep = (buyer_representative_name && buyer_representative_name.trim()) || req.user?.name || buyer.name;
    const finalBuyerPhone = (rawPhone && rawPhone.trim()) || buyer.phone || 'No registrado';
    const finalBuyerEmail = (buyer_contact_email && buyer_contact_email.trim()) || buyer.email;

    if (!finalBuyerPhone || finalBuyerPhone.replace(/\D/g, '').length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionar un teléfono de contacto autorizado válido para coordinar la entrega.',
        code: 'INVALID_CONTACT_PHONE'
      });
    }

    // 3. Obtener y validar producto
    const product = await dbGet(
      `SELECT p.*, u.name as farmer_name, u.phone as farmer_phone, u.location as farmer_location
       FROM products p
       LEFT JOIN users u ON p.farmer_id = u.id
       WHERE p.id = ?`,
      [product_id]
    );

    if (!product) {
      return res.status(404).json({ success: false, error: 'El producto agrícola solicitado no existe.', code: 'PRODUCT_NOT_FOUND' });
    }

    if (product.validation_status !== 'approved' || product.available === 0) {
      return res.status(400).json({
        success: false,
        error: 'Este producto no está disponible para compra en el catálogo actual.',
        code: 'PRODUCT_UNAVAILABLE'
      });
    }

    // 3b. Validar stock disponible considerando órdenes activas en curso (reserva de inventario)
    const committedRow = await dbGet(
      `SELECT COALESCE(SUM(quantity), 0) as committed_kg
       FROM purchase_orders
       WHERE product_id = ?
         AND status IN (
           'solicitud_enviada', 'transporte_por_cotizar', 'pendiente_respuesta',
           'pendiente_aceptacion_condiciones', 'aceptada', 'en_preparacion',
           'lista_para_entrega', 'en_traslado'
         )`,
      [product_id]
    );
    const committedKg = parseFloat(committedRow?.committed_kg || 0);
    const availableStockKg = Math.max(0, parseFloat(product.stock_kg || 0) - committedKg);

    if (numQty > availableStockKg) {
      return res.status(400).json({
        success: false,
        error: `La cantidad solicitada (${numQty} ${product.unit || 'kg'}) excede el stock disponible actual (${availableStockKg.toFixed(2)} ${product.unit || 'kg'}).`,
        code: 'INSUFFICIENT_STOCK',
        available_stock: availableStockKg,
        total_stock: product.stock_kg,
        committed_stock: committedKg
      });
    }

    // 4. Prevenir envíos duplicados por doble clic (ventana de 15 segundos)
    const recentDuplicate = await dbGet(
      `SELECT id FROM purchase_orders
       WHERE supermarket_id = ? AND product_id = ? AND quantity = ?
         AND created_at > NOW() - INTERVAL '15 seconds'`,
      [buyerId, product_id, numQty]
    );
    if (recentDuplicate) {
      return res.status(409).json({
        success: false,
        error: 'Solicitud duplicada: ya se está procesando una orden idéntica enviada recientemente. Por favor espera unos momentos.',
        code: 'DUPLICATE_ORDER_ATTEMPT',
        order_id: recentDuplicate.id
      });
    }

    // 5. Cálculos económicos determinísticos basados en el precio real del backend
    const unitPrice = parseFloat(product.price_per_kg) || 0;
    const subtotal = parseFloat((numQty * unitPrice).toFixed(2));
    let initialTransportCost = 0;
    let transportCostStatus = 'not_applicable';
    let initialStatus = 'solicitud_enviada';
    let transportPayer = 'none';

    if (transport_modality === 'farmer_delivery') {
      transportPayer = 'supermarket';
      transportCostStatus = 'pending_quote';
      initialStatus = 'transporte_por_cotizar';
    } else {
      transportPayer = 'none';
      transportCostStatus = 'not_applicable';
      initialStatus = 'pendiente_respuesta';
    }

    const totalAmount = subtotal; // El flete se adiciona una vez cotizado y aceptado
    const orderCode = generateOrderCode();

    const farmerName = product.farmer_name || 'Agricultor de Pasco';
    const farmerPhone = product.farmer_phone || 'Registrado en sistema';
    const pickupLocation = (product.origin && product.origin.trim()) || product.farmer_location || 'Región Pasco';

    // 6. Transacción atómica en PostgreSQL: Bloqueo de Concurrencia + Orden + Historial + Notificación
    const createdOrder = await withTransaction(async (tx) => {
      // Bloqueo de fila a nivel de base de datos para evitar sobreventa por solicitudes concurrentes
      const lockedProduct = await tx.dbGet(
        `SELECT stock_kg FROM products WHERE id = ? FOR UPDATE`,
        [product.id]
      );
      const txCommitted = await tx.dbGet(
        `SELECT COALESCE(SUM(quantity), 0) as committed_kg
         FROM purchase_orders
         WHERE product_id = ?
           AND status IN (
             'solicitud_enviada', 'transporte_por_cotizar', 'pendiente_respuesta',
             'pendiente_aceptacion_condiciones', 'aceptada', 'en_preparacion',
             'lista_para_entrega', 'en_traslado'
           )`,
        [product.id]
      );
      const curCommitted = parseFloat(txCommitted?.committed_kg || 0);
      const curAvailable = Math.max(0, parseFloat(lockedProduct?.stock_kg || 0) - curCommitted);
      if (numQty > curAvailable) {
        throw new Error(`INSUFFICIENT_STOCK: Stock disponible insuficiente durante la reserva.`);
      }
      const orderInsertRes = await tx.dbRun(
        `INSERT INTO purchase_orders (
          order_code, product_id, farmer_id, supermarket_id,
          supermarket_name, buyer_representative_name, buyer_contact_phone, buyer_contact_email,
          farmer_name, farmer_contact_phone,
          product_name, crop_type, quality, unit,
          quantity, unit_price, subtotal,
          transport_modality, transport_cost, transport_payer, transport_cost_status,
          delivery_address, delivery_reference, pickup_location, pickup_reference,
          requested_date, agreed_date, agreed_time_slot,
          packaging_instructions, notes, total_amount, status
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?
        )`,
        [
          orderCode, product.id, product.farmer_id, buyerId,
          finalSupermarketName, finalBuyerRep, finalBuyerPhone, finalBuyerEmail,
          farmerName, farmerPhone,
          product.name, product.crop_type, product.quality || 'primera', product.unit || 'kg',
          numQty, unitPrice, subtotal,
          transport_modality, initialTransportCost, transportPayer, transportCostStatus,
          rawDeliveryAddress ? rawDeliveryAddress.trim() : null,
          rawDeliveryRef ? rawDeliveryRef.trim() : null,
          rawPickupLocation ? rawPickupLocation.trim() : pickupLocation,
          rawPickupRef ? rawPickupRef.trim() : null,
          reqDateStr, reqDateStr, agreed_time_slot || 'Por coordinar',
          rawPackaging ? rawPackaging.trim() : null,
          rawNotes ? rawNotes.trim() : null,
          totalAmount, initialStatus
        ]
      );

      const orderId = orderInsertRes.lastID;

      // Registro en historial de auditoría de estados
      await tx.dbRun(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_name, changed_by_role, notes)
         VALUES (?, NULL, ?, ?, ?, 'supermarket', ?)`,
        [orderId, initialStatus, buyerId, finalBuyerRep, 'Solicitud de orden de compra B2B registrada por el supermercado.']
      );

      // Crear Notificación Persistente para el Agricultor
      if (product.farmer_id) {
        let notifMessage = '';
        if (transport_modality === 'farmer_delivery') {
          notifMessage =
            `Nueva solicitud de compra de ${product.name}.\n` +
            `El señor ${finalBuyerRep}, representante de ${finalSupermarketName}, solicita ${numQty} ${product.unit || 'kg'} de ${product.name} para el ${reqDateStr}.\n` +
            `Teléfono del comprador: ${finalBuyerPhone}.\n` +
            `Modalidad: el agricultor entrega en el supermercado.\n` +
            `Lugar de entrega: ${rawDeliveryAddress || 'Dirección no especificada'}${rawDeliveryRef ? ' (' + rawDeliveryRef + ')' : ''}.\n` +
            `Subtotal: S/ ${subtotal.toFixed(2)}.\n` +
            `Transporte: pendiente de cotización del agricultor.\n` +
            `Estado: pendiente de cotización y respuesta.`;
        } else {
          notifMessage =
            `Nueva solicitud de compra de ${product.name}.\n` +
            `El señor ${finalBuyerRep}, representante de ${finalSupermarketName}, solicita ${numQty} ${product.unit || 'kg'} de ${product.name} para el ${reqDateStr}.\n` +
            `Teléfono del comprador: ${finalBuyerPhone}.\n` +
            `El supermercado recogerá ${numQty} ${product.unit || 'kg'} de ${product.name} el ${reqDateStr} en ${pickupLocation}${rawPickupRef ? ' (' + rawPickupRef + ')' : ''}. No se agrega recargo de transporte al precio anunciado.\n` +
            `Subtotal: S/ ${subtotal.toFixed(2)}.\n` +
            `Estado: pendiente de confirmación.`;
        }

        await tx.dbRun(
          `INSERT INTO notifications (user_id, type, title, message, severity, order_id)
           VALUES (?, 'orden_compra', ?, ?, 'info', ?)`,
          [
            product.farmer_id,
            `🛒 Nueva orden B2B: ${product.name} (${orderCode})`,
            notifMessage,
            orderId
          ]
        );
      }

      return await tx.dbGet('SELECT * FROM purchase_orders WHERE id = ?', [orderId]);
    });

    res.status(201).json({
      success: true,
      message: 'Orden de compra B2B generada exitosamente. Se notificó al agricultor en su panel.',
      data: createdOrder
    });
  } catch (err) {
    console.error('Error al crear orden de compra B2B:', err);
    if (err.message && err.message.includes('INSUFFICIENT_STOCK')) {
      return res.status(400).json({ success: false, error: err.message, code: 'INSUFFICIENT_STOCK' });
    }
    res.status(500).json({ success: false, error: 'Error interno al registrar la orden de compra B2B.', code: 'ORDER_CREATION_FAILED' });
  }
}

/**
 * 2. Listar Órdenes de Compra (Supermercado / Agricultor / Admin)
 * GET /api/v1/supermarket/orders
 */
async function getOrders(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Sesión no autenticada.' });
    }

    let sql = `
      SELECT o.*, p.photo_url as product_photo_url, p.certified_natural as product_certified_natural,
             p.is_natural as product_is_natural
      FROM purchase_orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (user.role === 'farmer') {
      sql += ' AND o.farmer_id = ?';
      params.push(user.id);
    } else if (user.role === 'supermarket') {
      sql += ' AND o.supermarket_id = ?';
      params.push(user.id);
    } else if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'No tienes permiso para consultar órdenes de compra.' });
    }

    sql += ' ORDER BY o.created_at DESC';

    const orders = await dbAll(sql, params);
    res.json({ success: true, data: orders, total: orders.length });
  } catch (err) {
    console.error('Error al listar órdenes:', err);
    res.status(500).json({ success: false, error: 'Error al consultar órdenes de compra.' });
  }
}

/**
 * 3. Obtener Detalle de Orden de Compra por ID con Historial
 * GET /api/v1/supermarket/orders/:id
 */
async function getOrderById(req, res) {
  try {
    const { id } = req.params;
    const user = req.user;

    const order = await dbGet(
      `SELECT o.*, p.photo_url as product_photo_url, p.certified_natural, p.is_natural, p.traceability_code
       FROM purchase_orders o
       LEFT JOIN products p ON o.product_id = p.id
       WHERE o.id = ?`,
      [id]
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden de compra no encontrada.' });
    }

    // Comprobar autorización de acceso
    const isOwnerBuyer = user.role === 'supermarket' && order.supermarket_id === user.id;
    const isOwnerSeller = user.role === 'farmer' && order.farmer_id === user.id;
    const isAdmin = user.role === 'admin';

    if (!isOwnerBuyer && !isOwnerSeller && !isAdmin) {
      return res.status(403).json({ success: false, error: 'No tienes autorización para consultar esta orden.' });
    }

    // Historial de cambios de estado
    const history = await dbAll(
      `SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...order,
        status_history: history
      }
    });
  } catch (err) {
    console.error('Error al obtener orden:', err);
    res.status(500).json({ success: false, error: 'Error al consultar detalle de la orden.' });
  }
}

/**
 * 4. Respuesta y Gestión del Agricultor
 * PUT /api/v1/supermarket/orders/:id/farmer-response
 * Permite cotizar transporte, aceptar pedido, rechazar o actualizar fases de preparación/despacho.
 */
async function farmerResponse(req, res) {
  try {
    const { id } = req.params;
    const { action, proposed_transport_cost, notes, rejection_reason, agreed_date, agreed_time_slot } = req.body;
    const user = req.user;

    const order = await dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada.' });
    }

    if (order.farmer_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo el agricultor vendedor asignado puede gestionar esta orden.' });
    }

    const previousStatus = order.status;
    let nextStatus = previousStatus;
    let newTransportCost = order.transport_cost || 0;
    let newTransportStatus = order.transport_cost_status;
    let newTotalAmount = order.total_amount;
    let historyNotes = notes || '';
    let notifTitle = '';
    let notifMessage = '';

    if (action === 'quote_transport') {
      const quoteVal = parseFloat(proposed_transport_cost !== undefined ? proposed_transport_cost : req.body.transport_cost);
      if (!Number.isFinite(quoteVal) || quoteVal < 0) {
        return res.status(400).json({ success: false, error: 'El costo de transporte propuesto debe ser un número mayor o igual a 0.' });
      }
      newTransportCost = quoteVal;
      newTransportStatus = 'quoted';
      newTotalAmount = parseFloat((order.subtotal + newTransportCost).toFixed(2));
      nextStatus = 'pendiente_aceptacion_condiciones';
      historyNotes = `El agricultor cotizó el flete en S/ ${newTransportCost.toFixed(2)}. ${notes || ''}`;

      notifTitle = `🚚 Cotización de flete para orden ${order.order_code}`;
      notifMessage =
        `El agricultor ${order.farmer_name} ha cotizado el costo de transporte para la orden ${order.order_code}.\n` +
        `Monto propuesto: S/ ${newTransportCost.toFixed(2)}.\n` +
        `Subtotal producto: S/ ${order.subtotal.toFixed(2)}.\n` +
        `Nuevo total estimado: S/ ${newTotalAmount.toFixed(2)}.\n` +
        `Por favor revisa y acepta las condiciones para confirmar la orden.`;
    } else if (action === 'accept') {
      if (order.transport_modality === 'farmer_delivery' && order.transport_cost_status === 'pending_quote') {
        newTransportCost = 0;
        newTransportStatus = 'accepted';
      }
      nextStatus = 'aceptada';
      historyNotes = `Orden aceptada por el agricultor. ${notes || ''}`;
      notifTitle = `✅ Orden aceptada: ${order.order_code}`;
      notifMessage = `El agricultor ${order.farmer_name} ha aceptado formalmente la orden de compra ${order.order_code} de ${order.quantity} kg de ${order.product_name}.`;
    } else if (action === 'reject') {
      nextStatus = 'rechazada';
      const reason = rejection_reason || notes || 'Capacidad de entrega no disponible';
      historyNotes = `Orden rechazada por el agricultor. Motivo: ${reason}`;
      notifTitle = `❌ Orden rechazada: ${order.order_code}`;
      notifMessage = `El agricultor ${order.farmer_name} no puede atender la orden ${order.order_code}. Motivo: ${reason}`;
    } else if (action === 'start_preparation') {
      if (previousStatus !== 'aceptada') {
        return res.status(400).json({ success: false, error: 'Solo se puede iniciar preparación sobre órdenes aceptadas.' });
      }
      nextStatus = 'en_preparacion';
      historyNotes = `El agricultor inició la cosecha y empaque del producto. ${notes || ''}`;
      notifTitle = `🌿 En preparación: ${order.order_code}`;
      notifMessage = `El agricultor está cosechando y preparando el lote de ${order.product_name} para la orden ${order.order_code}.`;
    } else if (action === 'ready_for_dispatch') {
      if (!['aceptada', 'en_preparacion'].includes(previousStatus)) {
        return res.status(400).json({ success: false, error: 'La orden debe estar aceptada o en preparación para marcarse como lista.' });
      }
      nextStatus = 'lista_para_entrega';
      historyNotes = `Lote listo para entrega o recojo. ${notes || ''}`;
      notifTitle = `📦 Pedido listo: ${order.order_code}`;
      notifMessage = `El pedido de ${order.product_name} (${order.order_code}) ya está empacado y listo para ${order.transport_modality === 'farmer_delivery' ? 'traslado' : 'recojo en origen'}.`;
    } else if (action === 'start_transit') {
      if (order.transport_modality !== 'farmer_delivery') {
        return res.status(400).json({ success: false, error: 'El estado en traslado solo aplica cuando el agricultor realiza la entrega.' });
      }
      nextStatus = 'en_traslado';
      historyNotes = `El transportista del agricultor ha iniciado el traslado hacia el supermercado. ${notes || ''}`;
      notifTitle = `🚛 En camino: ${order.order_code}`;
      notifMessage = `El cargamento de ${order.product_name} para la orden ${order.order_code} está en ruta hacia el supermercado.`;
    } else {
      return res.status(400).json({ success: false, error: `Acción '${action}' no reconocida.` });
    }

    // Actualización atómica en base de datos
    const updatedOrder = await withTransaction(async (tx) => {
      await tx.dbRun(
        `UPDATE purchase_orders SET
          status = ?,
          transport_cost = ?,
          transport_cost_status = ?,
          total_amount = ?,
          agreed_date = COALESCE(?, agreed_date),
          agreed_time_slot = COALESCE(?, agreed_time_slot),
          farmer_response_notes = COALESCE(?, farmer_response_notes),
          rejection_reason = CASE WHEN ? = 'rechazada' THEN ? ELSE rejection_reason END,
          updated_at = NOW()
         WHERE id = ?`,
        [
          nextStatus,
          newTransportCost,
          newTransportStatus,
          newTotalAmount,
          agreed_date || null,
          agreed_time_slot || null,
          notes || null,
          nextStatus,
          rejection_reason || notes || null,
          id
        ]
      );

      await tx.dbRun(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_name, changed_by_role, notes)
         VALUES (?, ?, ?, ?, ?, 'farmer', ?)`,
        [id, previousStatus, nextStatus, user.id, user.name || 'Agricultor', historyNotes]
      );

      // Notificar al supermercado comprador
      if (order.supermarket_id && notifMessage) {
        await tx.dbRun(
          `INSERT INTO notifications (user_id, type, title, message, severity, order_id)
           VALUES (?, 'orden_compra', ?, ?, 'info', ?)`,
          [order.supermarket_id, notifTitle, notifMessage, id]
        );
      }

      return await tx.dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    });

    res.json({ success: true, message: 'Respuesta registrada y notificada con éxito.', data: updatedOrder });
  } catch (err) {
    console.error('Error al responder orden:', err);
    res.status(500).json({ success: false, error: 'Error al procesar la respuesta del agricultor.' });
  }
}

/**
 * 5. Respuesta y Gestión del Supermercado
 * PUT /api/v1/supermarket/orders/:id/supermarket-response
 * Permite aceptar flete cotizado, confirmar recepción conforme o cancelar orden.
 */
async function supermarketResponse(req, res) {
  try {
    const { id } = req.params;
    const { action, notes, rejection_reason } = req.body;
    const user = req.user;

    const order = await dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada.' });
    }

    if (order.supermarket_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo el supermercado comprador puede ejecutar esta acción.' });
    }

    const previousStatus = order.status;
    let nextStatus = previousStatus;
    let newTransportStatus = order.transport_cost_status;
    let historyNotes = notes || '';
    let notifTitle = '';
    let notifMessage = '';

    if (action === 'accept_transport') {
      if (order.transport_cost_status !== 'quoted') {
        return res.status(400).json({ success: false, error: 'No hay una cotización de transporte pendiente de aceptación.' });
      }
      newTransportStatus = 'accepted';
      nextStatus = 'aceptada';
      historyNotes = `Supermercado aceptó el flete de S/ ${order.transport_cost.toFixed(2)}. Condiciones finales confirmadas. ${notes || ''}`;

      notifTitle = `🤝 Flete aceptado: ${order.order_code}`;
      notifMessage =
        `El supermercado ${order.supermarket_name} ha aceptado formalmente la cotización de flete de S/ ${order.transport_cost.toFixed(2)}.\n` +
        `Total acordado: S/ ${order.total_amount.toFixed(2)}.\n` +
        `La orden ${order.order_code} se encuentra ACEPTADA. Ya puedes iniciar la preparación de la cosecha.`;
    } else if (action === 'reject_transport') {
      newTransportStatus = 'rejected';
      nextStatus = 'transporte_por_cotizar';
      historyNotes = `El supermercado no aceptó el costo de transporte propuesto. ${notes || ''}`;

      notifTitle = `⚠️ Flete observado: ${order.order_code}`;
      notifMessage =
        `El supermercado ${order.supermarket_name} ha observado la cotización de flete para la orden ${order.order_code}.\n` +
        `Observación: ${notes || 'Monto fuera de rango esperado'}.\n` +
        `Se solicita reconsiderar la propuesta de transporte.`;
    } else if (action === 'confirm_delivery') {
      if (!['lista_para_entrega', 'en_traslado'].includes(previousStatus)) {
        return res.status(400).json({ success: false, error: 'La orden debe estar lista para entrega o en traslado para confirmar recepción.' });
      }
      nextStatus = 'entregada';
      historyNotes = `Recepción conforme y satisfactoria por parte del supermercado. ${notes || ''}`;

      notifTitle = `🎉 Entrega confirmada: ${order.order_code}`;
      notifMessage =
        `El supermercado ${order.supermarket_name} ha recibido conforme los ${order.quantity} kg de ${order.product_name} de la orden ${order.order_code}.\n` +
        `¡Operación comercial completada con éxito!`;
    } else if (action === 'cancel') {
      if (['en_preparacion', 'lista_para_entrega', 'en_traslado', 'entregada'].includes(previousStatus)) {
        return res.status(400).json({
          success: false,
          error: 'No se puede cancelar una orden que ya está en preparación, lista o en traslado.'
        });
      }
      nextStatus = 'cancelada';
      const reason = rejection_reason || notes || 'Cancelación solicitada por el comprador';
      historyNotes = `Orden cancelada por el supermercado. Motivo: ${reason}`;

      notifTitle = `⛔ Orden cancelada: ${order.order_code}`;
      notifMessage = `El supermercado ${order.supermarket_name} ha cancelado la solicitud de compra ${order.order_code}. Motivo: ${reason}`;
    } else {
      return res.status(400).json({ success: false, error: `Acción '${action}' no reconocida para el supermercado.` });
    }

    const updatedOrder = await withTransaction(async (tx) => {
      await tx.dbRun(
        `UPDATE purchase_orders SET
          status = ?,
          transport_cost_status = ?,
          rejection_reason = CASE WHEN ? = 'cancelada' THEN ? ELSE rejection_reason END,
          updated_at = NOW()
         WHERE id = ?`,
        [
          nextStatus,
          newTransportStatus,
          nextStatus,
          rejection_reason || notes || null,
          id
        ]
      );

      // Descuento atómico de inventario en entrega definitiva
      if (action === 'confirm_delivery' && order.product_id && order.quantity > 0) {
        await tx.dbRun(
          `UPDATE products 
           SET stock_kg = GREATEST(0, stock_kg - ?)
           WHERE id = ?`,
          [order.quantity, order.product_id]
        );
      }

      await tx.dbRun(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_name, changed_by_role, notes)
         VALUES (?, ?, ?, ?, ?, 'supermarket', ?)`,
        [id, previousStatus, nextStatus, user.id, user.name || 'Supermercado', historyNotes]
      );

      if (order.farmer_id && notifMessage) {
        await tx.dbRun(
          `INSERT INTO notifications (user_id, type, title, message, severity, order_id)
           VALUES (?, 'orden_compra', ?, ?, 'info', ?)`,
          [order.farmer_id, notifTitle, notifMessage, id]
        );
      }

      return await tx.dbGet('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    });

    res.json({ success: true, message: 'Operación confirmada con éxito.', data: updatedOrder });
  } catch (err) {
    console.error('Error al responder orden como supermercado:', err);
    res.status(500).json({ success: false, error: 'Error al procesar la respuesta del supermercado.' });
  }
}

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  farmerResponse,
  supermarketResponse
};
