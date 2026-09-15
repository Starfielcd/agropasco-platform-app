const http = require('http');

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(responseBody);
        } catch (e) {
          parsed = responseBody;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

async function runAudit() {
  const results = {
    roles: {},
    security: {},
    stats: {},
    adminApprovals: {},
    functionalChecks: []
  };

  console.log('🔍 ====================================================');
  console.log('🔍 AUDITORÍA DE SISTEMA Y CUMPLIMIENTO FUNCIONAL AGROPASCO');
  console.log('🔍 ====================================================\n');

  // --- 1. AUTENTICACIÓN DE ROLES ---
  console.log('1. Autenticación de credenciales por rol...');
  const adminRes = await request('POST', '/api/auth/login', { email: 'admin@agropasco.pe', password: 'password123' }).then(r => r.statusCode === 200 ? r : request('POST', '/api/auth/login', { email: 'admin@agropasco.pe', password: '123456' }));
  const farmerRes = await request('POST', '/api/auth/login', { email: 'agricultor@agropasco.pe', password: '123456' });
  const advisorRes = await request('POST', '/api/auth/login', { email: 'asesor@agropasco.pe', password: '123456' });
  const superRes = await request('POST', '/api/auth/login', { email: 'supermercado@agropasco.pe', password: '123456' });

  const tokens = {
    admin: adminRes.data?.data?.token,
    farmer: farmerRes.data?.data?.token,
    advisor: advisorRes.data?.data?.token,
    supermarket: superRes.data?.data?.token
  };

  console.log('Tokens obtenidos:', {
    admin: !!tokens.admin,
    farmer: !!tokens.farmer,
    advisor: !!tokens.advisor,
    supermarket: !!tokens.supermarket
  });

  if (!tokens.admin || !tokens.farmer || !tokens.advisor || !tokens.supermarket) {
    console.error('Error obteniendo tokens de prueba. Abortando auditoría.');
    return;
  }

  // --- 2. AUDITORÍA DEL ADMINISTRADOR ---
  console.log('\n2. Auditoría Administrador (Estadísticas, Usuarios, Logs)...');
  const statsRes = await request('GET', '/api/admin/stats', null, tokens.admin);
  const usersRes = await request('GET', '/api/admin/users', null, tokens.admin);
  const auditRes = await request('GET', '/api/admin/audit', null, tokens.admin);
  const pendingAccountsRes = await request('GET', '/api/admin/pending-accounts', null, tokens.admin);
  const ticketsRes = await request('GET', '/api/admin/support/tickets', null, tokens.admin);
  const photosRes = await request('GET', '/api/admin/moderation/photos', null, tokens.admin);
  const anomaliesRes = await request('GET', '/api/admin/moderation/anomalies', null, tokens.admin);

  results.stats = statsRes.data?.data || {};
  results.usersCount = (usersRes.data?.data || []).length;
  results.auditLogCount = (auditRes.data?.data || []).length;
  results.pendingAccountsCount = (pendingAccountsRes.data?.data || []).length;
  results.ticketsCount = (ticketsRes.data?.data || []).length;
  results.moderationPhotosCount = (photosRes.data?.data || []).length;
  results.anomaliesCount = (anomaliesRes.data?.data || []).length;

  console.log('Estadísticas globales:', results.stats);
  console.log(`Usuarios: ${results.usersCount} | Auditoría: ${results.auditLogCount} | Pendientes: ${results.pendingAccountsCount} | Tickets: ${results.ticketsCount}`);

  // --- 3. RECORRIDO COMPLETO: AGRICULTOR ---
  console.log('\n3. Recorrido Funcional: AGRICULTOR...');
  // a) Listar parcelas
  const parcelsRes = await request('GET', '/api/parcels', null, tokens.farmer);
  // b) Crear parcela con altitud
  const uniqueSuffix = Date.now();
  const geoJsonData = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[-76.51, -10.49], [-76.51, -10.50], [-76.50, -10.50], [-76.51, -10.49]]]
    },
    properties: { name: `Parcela Yanahuanca ${uniqueSuffix}` }
  };

  const newParcelRes = await request('POST', '/api/parcels', {
    name: `Parcela Auditoría ${uniqueSuffix}`,
    geo_json: JSON.stringify(geoJsonData),
    area_hectares: 2.75,
    altitude_masl: 3180,
    center_lat: -10.495,
    center_lng: -76.505,
    crop_type: 'papa',
    notes: 'Parcela de prueba integral de auditoría'
  }, tokens.farmer);
  const parcelId = newParcelRes.data?.data?.id;

  // c) Crear cultivo con altitud
  const newCropRes = await request('POST', '/api/crops', {
    parcel_id: parcelId,
    name: 'Papa Amarilla Tumbay',
    crop_type: 'papa',
    variety: 'Tumbay',
    area_hectares: 1.2,
    altitude_masl: 3180,
    location_detail: 'Sector Quebrada Yanahuanca',
    planting_date: '2026-03-01'
  }, tokens.farmer);
  const cropId = newCropRes.data?.data?.id;

  // d) Reportar plaga (Agricultor -> Asesor)
  const newPestRes = await request('POST', '/api/pest-reports', {
    parcel_id: parcelId,
    pest_name: 'Gorgojo de los Andes (Premnotrypes)',
    description: 'Tubérculos con galerías y larvas en aporque',
    severity: 'grave',
    location_lat: -10.491,
    location_lng: -76.512
  }, tokens.farmer);
  const pestReportId = newPestRes.data?.data?.id;

  // e) Venta de producto hacia el catálogo de supermercado
  const basePrice = 6.00;
  const newProductRes = await request('POST', '/api/v1/supermarket/products', {
    crop_id: cropId,
    name: `Papa Nativa Tumbay ${uniqueSuffix}`,
    crop_type: 'papa',
    quality: 'primera',
    origin: 'Yanahuanca, Pasco',
    stock_kg: 850,
    price_per_kg: basePrice,
    unit: 'kg',
    description: 'Papa nativa orgánica seleccionada a mano'
  }, tokens.farmer);
  const productId = newProductRes.data?.data?.id;

  // f) Alertas climáticas para el agricultor
  const weatherAlertsRes = await request('GET', '/api/weather/alerts?lat=-10.49&lon=-76.51', null, tokens.farmer);

  results.roles.farmer = {
    parcelsListed: (parcelsRes.data?.data || []).length,
    parcelCreated: !!parcelId,
    parcelAltitude: newParcelRes.data?.data?.altitude_masl,
    cropCreated: !!cropId,
    cropAltitude: newCropRes.data?.data?.altitude_masl,
    pestReported: !!pestReportId,
    productOffered: !!productId,
    basePriceOffered: basePrice,
    weatherAlertsReceived: (weatherAlertsRes.data?.data || []).length
  };
  console.log('Resultado Agricultor:', results.roles.farmer);

  // --- 4. RECORRIDO COMPLETO: ASESOR TÉCNICO ---
  console.log('\n4. Recorrido Funcional: ASESOR TÉCNICO...');
  // a) Listar reportes de plagas
  const pestListRes = await request('GET', '/api/pest-reports', null, tokens.advisor);
  const reports = pestListRes.data?.data || [];
  const targetReport = reports.find(r => r.id === pestReportId);

  // b) Responder reporte de plaga
  let pestResponded = false;
  if (pestReportId) {
    const pestRespRes = await request('PUT', `/api/pest-reports/${pestReportId}/respond`, {
      advisor_response: 'Aplicar hongo entomopatógeno Beauveria bassiana al aporque y barreras de plástico.',
      status: 'resuelto'
    }, tokens.advisor);
    pestResponded = pestRespRes.statusCode === 200;
  }

  // c) Crear recomendación agronómica
  const recRes = await request('POST', '/api/advisor/recommendations', {
    category: 'plagas',
    title: 'Manejo Agroecológico de Gorgojo en Yanahuanca',
    recommendation: 'Instalar mantas al momento del aporque y cosecha para atrapar adultos.',
    priority: 'alta'
  }, tokens.advisor);

  // d) Listar productos pendientes de validación
  const pendingProdsRes = await request('GET', '/api/v1/supermarket/products/pending', null, tokens.advisor);
  const pendingProductsList = pendingProdsRes.data?.data || [];
  const targetProdInPending = pendingProductsList.find(p => p.id === productId);

  // e) Validar producto técnico con certificación 100% natural (+30% surcharge)
  let productValidated = false;
  let finalValidatedPrice = null;
  let naturalCertified = false;
  if (productId) {
    const valRes = await request('PUT', `/api/v1/supermarket/products/${productId}/validate`, {
      validation_status: 'approved',
      validation_notes: 'Verificado en campo: libre de síntesis química. Certificado 100% Natural Pasco.',
      is_natural: true
    }, tokens.advisor);
    productValidated = valRes.statusCode === 200;
    finalValidatedPrice = valRes.data?.data?.price_per_kg;
    naturalCertified = valRes.data?.data?.certified_natural === 1;
  }

  results.roles.advisor = {
    pestReportsCount: reports.length,
    foundFarmerReport: !!targetReport,
    pestResponded,
    recommendationCreated: recRes.statusCode === 200 || recRes.statusCode === 201,
    pendingProductsFound: pendingProductsList.length,
    productValidated,
    finalValidatedPrice,
    expectedPriceSurcharge30Pct: parseFloat((basePrice * 1.30).toFixed(2)),
    naturalCertified
  };
  console.log('Resultado Asesor:', results.roles.advisor);

  // --- 5. RECORRIDO COMPLETO: SUPERMERCADO ---
  console.log('\n5. Recorrido Funcional: SUPERMERCADO...');
  // a) Listar catálogo de productos validados
  const catalogRes = await request('GET', '/api/v1/supermarket/products', null, tokens.supermarket);
  const catalog = catalogRes.data?.data || [];
  const auditedProductInCatalog = catalog.find(p => p.id === productId);

  // b) Consultar trazabilidad completa del producto
  let traceData = null;
  if (productId) {
    const traceRes = await request('GET', `/api/v1/supermarket/products/${productId}/trace`, null, tokens.supermarket);
    if (traceRes.statusCode === 200) {
      traceData = traceRes.data?.data;
    }
  }

  results.roles.supermarket = {
    catalogTotalItems: catalog.length,
    productVisibleInCatalog: !!auditedProductInCatalog,
    catalogItemPrice: auditedProductInCatalog?.price_per_kg,
    catalogNaturalBadge: auditedProductInCatalog?.certified_natural === 1,
    traceabilityVerified: !!traceData,
    traceabilityHasFarmerInfo: !!traceData?.farmer,
    traceabilityHasValidationNotes: !!traceData?.validation_notes
  };
  console.log('Resultado Supermercado:', results.roles.supermarket);

  // --- 6. GESTIÓN DE ROLES SENSIBLES: FLUJO DE APROBACIÓN / RECHAZO ---
  console.log('\n6. Flujo de Aprobación/Rechazo de Cuentas Sensibles (Admin)...');
  
  // Registro de Asesor (debe quedar en pending)
  const advisorEmailTest = `solicitud.asesor.${uniqueSuffix}@agropasco.pe`;
  const regAdvRes = await request('POST', '/api/auth/register', {
    name: 'Ing. Elena Morales CIP',
    email: advisorEmailTest,
    password: 'Password123!',
    role: 'advisor',
    location: 'Oxapampa, Pasco',
    phone: '963111222'
  });
  const advisorPending = regAdvRes.data?.pending === true;

  // Registro de Supermercado (debe quedar en pending)
  const superEmailTest = `solicitud.super.${uniqueSuffix}@agropasco.pe`;
  const regSupRes = await request('POST', '/api/auth/register', {
    name: 'Cencosud Pasco Retail',
    email: superEmailTest,
    password: 'Password123!',
    role: 'supermarket',
    location: 'Cerro de Pasco',
    phone: '963333444'
  });
  const superPending = regSupRes.data?.pending === true;

  // Admin lista solicitudes pendientes
  const pendingAfterReg = await request('GET', '/api/admin/pending-accounts', null, tokens.admin);
  const pendingUsers = pendingAfterReg.data?.data || [];
  const advisorToApprove = pendingUsers.find(u => u.email === advisorEmailTest);
  const superToReject = pendingUsers.find(u => u.email === superEmailTest);

  // Admin APROBAR Asesor
  let approvedOk = false;
  let tempPasswordReceived = null;
  if (advisorToApprove) {
    const appRes = await request('PUT', `/api/admin/accounts/${advisorToApprove.id}/approve`, {
      notes: 'CIP y colegiatura verificadas correctamente.'
    }, tokens.admin);
    approvedOk = appRes.statusCode === 200;
    tempPasswordReceived = appRes.data?.tempPassword;
  }

  // Verificar que el Asesor Aprobado ahora puede loguearse con la credencial temporal
  let advisorCanLogin = false;
  let mustChangePasswordFlag = false;
  if (tempPasswordReceived) {
    const advLoginAfterApprove = await request('POST', '/api/auth/login', {
      email: advisorEmailTest,
      password: tempPasswordReceived
    });
    advisorCanLogin = advLoginAfterApprove.statusCode === 200;
    mustChangePasswordFlag = advLoginAfterApprove.data?.data?.mustChangePassword === true;
  }

  // Admin RECHAZAR Supermercado
  let rejectedOk = false;
  if (superToReject) {
    const rejRes = await request('PUT', `/api/admin/accounts/${superToReject.id}/reject`, {
      rejection_reason: 'RUC inactivo o domicilio fiscal no habido en SUNAT.'
    }, tokens.admin);
    rejectedOk = rejRes.statusCode === 200;
  }

  // Verificar que el Supermercado Rechazado NO puede loguearse (403 Forbidden)
  const supLoginAfterReject = await request('POST', '/api/auth/login', {
    email: superEmailTest,
    password: 'Password123!'
  });
  const supermarketRejectedBlocked = supLoginAfterReject.statusCode === 403;

  results.adminApprovals = {
    advisorRegisteredPending: advisorPending,
    supermarketRegisteredPending: superPending,
    pendingAccountsDetected: pendingUsers.length,
    advisorApprovedByAdmin: approvedOk,
    advisorLoginWithTempPassword: advisorCanLogin,
    mustChangePasswordEnforced: mustChangePasswordFlag,
    supermarketRejectedByAdmin: rejectedOk,
    rejectedAccountLoginBlocked: supermarketRejectedBlocked
  };
  console.log('Resultado Aprobaciones Admin:', results.adminApprovals);

  // --- 7. PRUEBAS DE SEGURIDAD Y AISLAMIENTO DE ROLES ---
  console.log('\n7. Pruebas de Seguridad y Aislamiento de Roles...');
  // Agricultor intenta acceder a panel admin
  const sec1 = await request('GET', '/api/admin/stats', null, tokens.farmer);
  // Asesor intenta crear parcelas de agricultores
  const sec2 = await request('POST', '/api/parcels', { name: 'Parcela Hacker' }, tokens.advisor);
  // Supermercado intenta crear cultivos
  const sec3 = await request('POST', '/api/crops', { name: 'Cultivo Hacker' }, tokens.supermarket);
  // Agricultor intenta validar productos
  const sec4 = await request('PUT', `/api/v1/supermarket/products/${productId}/validate`, { validation_status: 'approved' }, tokens.farmer);
  // Usuario no autenticado intenta ver admin
  const sec5 = await request('GET', '/api/admin/users', null, null);
  // Intento de registrar rol 'admin' por registro público
  const sec6 = await request('POST', '/api/auth/register', {
    name: 'Admin Falso',
    email: `fake.admin.${uniqueSuffix}@hacker.com`,
    password: 'Password123!',
    role: 'admin'
  });

  results.security = {
    farmerBlockedFromAdmin: sec1.statusCode === 403,
    advisorBlockedFromParcels: sec2.statusCode === 403,
    supermarketBlockedFromCrops: sec3.statusCode === 403,
    farmerBlockedFromProductValidation: sec4.statusCode === 403,
    unauthenticatedBlocked: sec5.statusCode === 401,
    publicAdminRegistrationForbidden: sec6.statusCode === 403
  };
  console.log('Seguridad y Aislamiento:', results.security);

  // --- RESUMEN FINAL ---
  console.log('\n🎉 ====================================================');
  console.log('🎉 AUDITORÍA COMPLETADA CON ÉXITO');
  console.log('🎉 ====================================================\n');
  console.log(JSON.stringify(results, null, 2));
}

runAudit().catch(err => {
  console.error('Error fatal durante la suite de auditoría:', err);
  process.exit(1);
});
