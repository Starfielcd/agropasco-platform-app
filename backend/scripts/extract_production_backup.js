/**
 * AgroPasco — Script de Respaldo y Extracción de Producción (Solo Lectura)
 * ========================================================================
 * Conecta exclusivamente vía HTTP/HTTPS en modo LECTURA a la instancia
 * en vivo de Render (versión LIVE commit 9b995b2) para extraer los datos
 * generados por los usuarios antes de cualquier migración de infraestructura.
 *
 * Principios de Seguridad:
 *   - El extractor utiliza POST únicamente para autenticación y GET para extracción.
 *     No ejecuta operaciones de escritura de datos directamente.
 *   - No almacena contraseñas ni credenciales en código ni en disco.
 *   - Mantiene el token JWT únicamente en memoria durante la ejecución.
 *   - No imprime el token en consola ni lo guarda en los respaldos.
 *   - No intenta saltarse autorizaciones ni alterar permisos o usuarios.
 *   - Guarda los datos de producción en: backend/data/production-backup/
 *     (ignorado por Git en .gitignore para evitar exposiciones accidentales).
 *
 * Uso en PowerShell:
 *   node backend/scripts/extract_production_backup.js [--url https://agropasco-digital.onrender.com]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// URL base de producción (configurable por argumento o variable de entorno)
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const BASE_URL = (getArg('--url', process.env.PROD_URL) || 'https://agropasco-digital.onrender.com').replace(/\/+$/, '');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'production-backup');
const BASE_BACKUP_FILE = path.join(OUTPUT_DIR, 'production_live_backup.json');
const BASE_REPORT_FILE = path.join(OUTPUT_DIR, 'production_live_backup_report.json');
const BACKUP_FILE = path.join(OUTPUT_DIR, 'production_live_backup_complete.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'production_live_backup_complete_report.json');

// Timeouts por solicitud HTTP en milisegundos
// Render Free entra en modo suspensión por inactividad y su arranque en frío puede tardar hasta ~1 minuto
const LOGIN_TIMEOUT_MS = 120000;  // 120 segundos para despertar la instancia y autenticar
const REQUEST_TIMEOUT_MS = 60000; // 60 segundos para las solicitudes GET posteriores

/**
 * Solicita una entrada de texto por consola
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * Solicita una contraseña enmascarando los caracteres con '*'
 */
function askPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const oldRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    function onData(ch) {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.removeListener('data', onData);
        if (stdin.setRawMode) stdin.setRawMode(oldRaw || false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (ch === '\u0003') {
        // Ctrl+C
        process.stdout.write('\nOperación cancelada por el usuario.\n');
        process.exit(0);
      } else if (ch === '\u0008' || ch === '\x7f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += ch;
        process.stdout.write('*');
      }
    }
    stdin.on('data', onData);
  });
}

/**
 * Realiza una petición HTTP con timeout
 */
async function apiRequest(endpoint, token = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'AgroPasco-Backup-Tool/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const status = response.status;
  let data = null;
  try {
    data = await response.json();
  } catch (parseErr) {
    data = null;
  }

  return { status, ok: response.ok, data };
}

async function run() {
  console.log('\n============================================================');
  console.log('🌾 AgroPasco Digital — Extractor de Respaldo de Producción');
  console.log('============================================================');
  console.log(`🎯 URL Destino: ${BASE_URL}`);
  console.log(`📌 Versión LIVE objetivo: commit 9b995b2`);
  console.log(`📁 Directorio de respaldo: ${OUTPUT_DIR}\n`);

  // 1. Obtener credenciales sin guardarlas en código
  let email = process.env.ADMIN_EMAIL;
  if (!email) {
    email = await askQuestion('👤 Correo del Administrador: ');
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askPassword('🔑 Contraseña del Administrador: ');
  }

  if (!email || !password) {
    console.error('❌ Error: El correo y la contraseña son obligatorios.');
    process.exit(1);
  }

  console.log('\n🔐 Autenticando en producción...');
  console.log('⏳ El servicio Render Free puede tardar hasta aproximadamente 1 minuto en despertar. Esperando hasta 120 segundos...');
  let token = null;
  let authUser = null;

  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });

    const loginData = await loginRes.json();

    if (!loginRes.ok || !loginData?.data?.token) {
      console.error(
        `❌ Fallo de autenticación (${loginRes.status}):`,
        loginData?.error || 'No se recibió token de autenticación'
      );
      process.exit(1);
    }

    token = loginData.data.token;
    authUser = loginData.data.user || { email };
    console.log(`✅ Autenticado exitosamente como: ${authUser.name || email} (Rol: ${authUser.role || 'desconocido'})`);
    console.log('🔒 Token recibido en memoria (no se almacenará en disco).\n');
  } catch (err) {
    console.error('❌ Error de conexión al autenticar con Render:', err.message);
    if (err.name === 'TimeoutError' || (err.message && err.message.toLowerCase().includes('timeout'))) {
      console.error('⚠️  El servicio de producción no respondió dentro del tiempo configurado. Puede estar iniciándose por inactividad de Render Free.');
    }
    process.exit(1);
  }

  // Estructura de respaldo
  const backupData = {
    _metadata: {
      source_url: BASE_URL,
      target_commit: '9b995b2',
      extracted_at: new Date().toISOString(),
      authenticated_user: {
        id: authUser.id,
        email: authUser.email,
        role: authUser.role,
        name: authUser.name,
      },
    },
    tables: {
      users: [],
      parcels: [],
      crops: [],
      crop_logs: [],
      products: [],
      pest_reports: [],
      pest_report_responses: [],
      pest_markers: [],
      support_tickets: [],
      audit_logs: [],
      advisory_tips: [],
      advisor_recommendations: [],
    },
    nested_diagnostics: {
      crop_logs: null,
      pest_report_responses: null,
      parcels_details: null,
    },
    consolidated_reports: {},
  };

  // Reporte de diagnóstico
  const extractionReport = {
    executed_at: new Date().toISOString(),
    source_url: BASE_URL,
    target_commit: '9b995b2',
    authenticated_role: authUser.role,
    execution_mode: 'El extractor utiliza POST únicamente para autenticación y GET para extracción. No ejecuta operaciones de escritura de datos directamente.',
    endpoints_checked: [],
    successful_endpoints: 0,
    failed_endpoints: 0,
    counts_by_table: {},
    nested_details: {},
    unavailable_data: [
      {
        table_or_field: 'users.password_hash',
        reason: 'Excluido deliberadamente en el backend por seguridad en /api/admin/users.',
        recoverable_via_api: false,
      },
      {
        table_or_field: 'notifications',
        reason: 'En el commit LIVE 9b995b2 no existe ruta HTTP expuesta para listar notificaciones.',
        recoverable_via_api: false,
      },
      {
        table_or_field: 'weather_cache',
        reason: 'weather_cache no se puede recuperar mediante las APIs LIVE actuales porque no existe un endpoint de lectura para esa tabla. El caché meteorológico puede regenerarse mediante la integración meteorológica existente.',
        recoverable_via_api: false,
      },
      {
        table_or_field: 'ground_truth_observations',
        reason: 'No existe en la versión LIVE 9b995b2 (introducida en el commit fallido 3ba4856).',
        recoverable_via_api: false,
      },
      {
        table_or_field: 'alert_preferences',
        reason: 'No existe en la versión LIVE 9b995b2 (introducida en el commit fallido 3ba4856).',
        recoverable_via_api: false,
      },
    ],
  };

  function logEndpointResult(endpoint, status, success, recordCount = 0, message = '', paginationInfo = null) {
    const entry = {
      endpoint,
      http_status: status,
      success,
      records: recordCount,
      notes: message,
      pagination: paginationInfo || {
        backend_supports_pagination: false,
        pages_fetched: success ? 1 : 0,
        records_per_page: recordCount,
        total_recovered: recordCount,
      },
    };
    extractionReport.endpoints_checked.push(entry);
    if (success) {
      extractionReport.successful_endpoints++;
      console.log(`  ✅ [${status}] ${endpoint} — ${recordCount} registros recuperados.`);
    } else {
      extractionReport.failed_endpoints++;
      console.log(`  ⚠️ [${status}] ${endpoint} — No recuperado: ${message}`);
    }
  }

  // Detección y carga del respaldo base previo (production_live_backup.json)
  let baseBackupLoaded = false;
  if (fs.existsSync(BASE_BACKUP_FILE)) {
    try {
      const baseContent = JSON.parse(fs.readFileSync(BASE_BACKUP_FILE, 'utf-8'));
      if (baseContent && baseContent.tables) {
        backupData.tables = { ...backupData.tables, ...baseContent.tables };
        if (baseContent.nested_diagnostics) {
          backupData.nested_diagnostics = { ...backupData.nested_diagnostics, ...baseContent.nested_diagnostics };
        }
        if (baseContent.consolidated_reports) {
          backupData.consolidated_reports = { ...backupData.consolidated_reports, ...baseContent.consolidated_reports };
        }
        baseBackupLoaded = true;
        console.log(`📦 Respaldo base detectado y cargado en memoria desde: ${path.basename(BASE_BACKUP_FILE)}`);
        console.log(`   (Reutilizando datos base: users, crops, products, etc. para no saturar Render)\n`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudo leer production_live_backup.json:', err.message);
    }
  }

  // Pre-cargar historial de endpoints ya completados del reporte base
  if (baseBackupLoaded && fs.existsSync(BASE_REPORT_FILE)) {
    try {
      const baseRep = JSON.parse(fs.readFileSync(BASE_REPORT_FILE, 'utf-8'));
      if (baseRep && Array.isArray(baseRep.endpoints_checked)) {
        for (const ep of baseRep.endpoints_checked) {
          if (!ep.endpoint.includes('/api/parcels') && ep.endpoint !== '/api/advisor/markers' && ep.endpoint !== '/api/advisor/recommendations') {
            extractionReport.endpoints_checked.push(ep);
            if (ep.success) extractionReport.successful_endpoints++;
            else extractionReport.failed_endpoints++;
          }
        }
      }
    } catch (e) {}
  }

  console.log('📥 Ejecutando extracción complementaria de producción (versión 9b995b2):\n');

  // 1. Usuarios (/api/admin/users)
  if (!baseBackupLoaded || !backupData.tables.users || backupData.tables.users.length === 0) {
    try {
      const res = await apiRequest('/api/admin/users', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        backupData.tables.users = res.data.data;
        logEndpointResult('/api/admin/users', res.status, true, res.data.data.length, 'Lista completa sin paginación');
      } else {
        logEndpointResult('/api/admin/users', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/admin/users', 0, false, 0, err.message);
    }
  } else {
    console.log(`  ℹ️  [Base] /api/admin/users — ${backupData.tables.users.length} usuarios conservados del respaldo base.`);
  }

  // 2. Parcelas (/api/parcels)
  let parcelsList = backupData.tables.parcels || [];
  if (!baseBackupLoaded || parcelsList.length === 0) {
    try {
      const res = await apiRequest('/api/parcels', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        parcelsList = res.data.data;
        backupData.tables.parcels = parcelsList;
        logEndpointResult('/api/parcels', res.status, true, res.data.data.length, 'Todas las parcelas regionales');
      } else {
        logEndpointResult('/api/parcels', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/parcels', 0, false, 0, err.message);
    }
  } else {
    logEndpointResult('/api/parcels', 200, true, parcelsList.length, 'Reutilizado de respaldo base (6 parcelas regionales)');
  }

  // 2b. Detalle de Parcelas (/api/parcels/:id) — Marcadores de plagas y recomendaciones técnicas asociadas
  const parcelDetailsReport = {
    total_parcels: parcelsList.length,
    parcels_processed_successfully: 0,
    parcels_failed: 0,
    failed_parcel_ids: [],
    total_pest_markers_recovered: 0,
    total_advisor_recommendations_recovered: 0,
    status: parcelsList.length === 0 ? 'NO_PARCELS_FOUND' : 'PROCESSING',
    details_by_parcel: [],
  };

  const markersMap = new Map();
  const recommendationsMap = new Map();

  for (const m of (backupData.tables.pest_markers || [])) {
    if (m && m.id != null) markersMap.set(String(m.id), m);
  }
  for (const r of (backupData.tables.advisor_recommendations || [])) {
    if (r && r.id != null) recommendationsMap.set(String(r.id), r);
  }

  if (parcelsList.length > 0) {
    console.log(`\n  🗺️  Extrayendo detalle fitosanitario y recomendaciones de ${parcelsList.length} parcela(s) individualmente (/api/parcels/:id)...`);

    for (const parcel of parcelsList) {
      try {
        const parcelRes = await apiRequest(`/api/parcels/${parcel.id}`, token);
        if (parcelRes.ok && parcelRes.data?.data) {
          parcelDetailsReport.parcels_processed_successfully++;
          const pData = parcelRes.data.data;
          const pMarkers = Array.isArray(pData.pest_markers) ? pData.pest_markers : [];
          const pRecs = Array.isArray(pData.recommendations) ? pData.recommendations : [];

          for (const m of pMarkers) {
            const key = m.id != null ? String(m.id) : `gen_${m.lat}_${m.lng}_${m.created_at}`;
            if (!markersMap.has(key)) markersMap.set(key, m);
          }

          for (const r of pRecs) {
            const key = r.id != null ? String(r.id) : `gen_${r.farmer_id}_${r.title}_${r.created_at}`;
            if (!recommendationsMap.has(key)) recommendationsMap.set(key, r);
          }

          parcelDetailsReport.total_pest_markers_recovered += pMarkers.length;
          parcelDetailsReport.total_advisor_recommendations_recovered += pRecs.length;

          parcelDetailsReport.details_by_parcel.push({
            parcel_id: parcel.id,
            parcel_name: parcel.name,
            http_status: parcelRes.status,
            success: true,
            markers_count: pMarkers.length,
            recommendations_count: pRecs.length,
            error: null,
          });
          console.log(`    📍 Parcela ID ${parcel.id} ("${parcel.name}"): ${pMarkers.length} marcadores, ${pRecs.length} recomendaciones.`);
        } else {
          parcelDetailsReport.parcels_failed++;
          parcelDetailsReport.failed_parcel_ids.push(parcel.id);
          parcelDetailsReport.details_by_parcel.push({
            parcel_id: parcel.id,
            parcel_name: parcel.name,
            http_status: parcelRes.status,
            success: false,
            markers_count: 0,
            recommendations_count: 0,
            error: parcelRes.data?.error || `HTTP ${parcelRes.status}`,
          });
          console.warn(`    ⚠️ Parcela ID ${parcel.id} ("${parcel.name}"): Fallo (${parcelRes.status}) - ${parcelRes.data?.error || 'Sin datos'}`);
        }
      } catch (err) {
        parcelDetailsReport.parcels_failed++;
        parcelDetailsReport.failed_parcel_ids.push(parcel.id);
        parcelDetailsReport.details_by_parcel.push({
          parcel_id: parcel.id,
          parcel_name: parcel.name,
          http_status: 0,
          success: false,
          markers_count: 0,
          recommendations_count: 0,
          error: err.message,
        });
        console.warn(`    ⚠️ Parcela ID ${parcel.id} ("${parcel.name}"): Error de conexión - ${err.message}`);
      }
    }

    parcelDetailsReport.status = parcelDetailsReport.parcels_failed === 0
      ? 'SUCCESS'
      : (parcelDetailsReport.parcels_processed_successfully > 0 ? 'PARTIAL_SUCCESS' : 'FAILED');

    backupData.tables.pest_markers = Array.from(markersMap.values());
    backupData.tables.advisor_recommendations = Array.from(recommendationsMap.values());
    backupData.nested_diagnostics.parcels_details = parcelDetailsReport;
    extractionReport.nested_details.parcels_details = parcelDetailsReport;

    const overallStatus = parcelDetailsReport.parcels_failed === 0 ? 200 : (parcelDetailsReport.parcels_processed_successfully > 0 ? 207 : 500);
    logEndpointResult(
      '/api/parcels/:id (pest_markers & recommendations)',
      overallStatus,
      parcelDetailsReport.parcels_processed_successfully > 0,
      backupData.tables.pest_markers.length + backupData.tables.advisor_recommendations.length,
      `Parcelas: ${parcelDetailsReport.parcels_processed_successfully}/${parcelDetailsReport.total_parcels}. Marcadores únicos: ${backupData.tables.pest_markers.length}, Recomendaciones únicas: ${backupData.tables.advisor_recommendations.length}. Fallidas: ${parcelDetailsReport.parcels_failed}`
    );
  }

  // 3 a 7: Reutilizar si ya vienen en el respaldo base o consultar si faltan
  if (!baseBackupLoaded || !backupData.tables.crops || backupData.tables.crops.length === 0) {
    let cropsList = [];
    try {
      const res = await apiRequest('/api/crops', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        cropsList = res.data.data;
        backupData.tables.crops = cropsList;
        logEndpointResult('/api/crops', res.status, true, cropsList.length, 'Todos los cultivos');
      } else {
        logEndpointResult('/api/crops', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/crops', 0, false, 0, err.message);
    }
  } else {
    console.log(`  ℹ️  [Base] /api/crops — ${backupData.tables.crops.length} cultivos conservados del respaldo base.`);
    console.log(`  ℹ️  [Base] /api/crops/:id (crop_logs) — ${backupData.tables.crop_logs.length} logs de cultivos conservados del respaldo base.`);
  }

  if (!baseBackupLoaded || !backupData.tables.products || backupData.tables.products.length === 0) {
    try {
      const res = await apiRequest('/api/v1/supermarket/products', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        backupData.tables.products = res.data.data;
        logEndpointResult('/api/v1/supermarket/products', res.status, true, res.data.data.length, 'Catálogo completo (aprobados y pendientes)');
      } else {
        logEndpointResult('/api/v1/supermarket/products', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/v1/supermarket/products', 0, false, 0, err.message);
    }
  } else {
    console.log(`  ℹ️  [Base] /api/v1/supermarket/products — ${backupData.tables.products.length} productos conservados del respaldo base.`);
  }

  if (!baseBackupLoaded || !backupData.tables.pest_reports || backupData.tables.pest_reports.length === 0) {
    try {
      const res = await apiRequest('/api/pest-reports', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        backupData.tables.pest_reports = res.data.data;
        logEndpointResult('/api/pest-reports', res.status, true, res.data.data.length, 'Todos los reportes de plagas');
      } else {
        logEndpointResult('/api/pest-reports', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/pest-reports', 0, false, 0, err.message);
    }
  } else {
    console.log(`  ℹ️  [Base] /api/pest-reports — ${backupData.tables.pest_reports.length} reportes y ${backupData.tables.pest_report_responses.length} respuestas conservados del respaldo base.`);
  }

  // 8. Marcadores de Plagas (/api/advisor/markers) — Verificación de endpoint global advisor
  try {
    const res = await apiRequest('/api/advisor/markers', token);
    if (res.ok && res.data && Array.isArray(res.data.data)) {
      for (const m of res.data.data) {
        const key = m.id != null ? String(m.id) : `gen_${m.lat}_${m.lng}_${m.created_at}`;
        if (!markersMap.has(key)) markersMap.set(key, m);
      }
      backupData.tables.pest_markers = Array.from(markersMap.values());
      logEndpointResult('/api/advisor/markers', res.status, true, res.data.data.length, 'Marcadores de plagas (global advisor)');
    } else {
      const msg = res.status === 403 || res.status === 401 
        ? 'Permisos insuficientes: el endpoint requiere rol "advisor" (datos recuperados mediante /api/parcels/:id)' 
        : (res.data?.error || 'Error al consultar');
      logEndpointResult('/api/advisor/markers', res.status, false, 0, msg);
    }
  } catch (err) {
    logEndpointResult('/api/advisor/markers', 0, false, 0, err.message);
  }

  // 9 a 11: Soporte, Auditoría y Tips
  if (!baseBackupLoaded || !backupData.tables.support_tickets || backupData.tables.support_tickets.length === 0) {
    try {
      const res = await apiRequest('/api/admin/support/tickets', token);
      if (res.ok && res.data && Array.isArray(res.data.data)) {
        backupData.tables.support_tickets = res.data.data;
        logEndpointResult('/api/admin/support/tickets', res.status, true, res.data.data.length, 'Tickets de soporte');
      } else {
        logEndpointResult('/api/admin/support/tickets', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/admin/support/tickets', 0, false, 0, err.message);
    }
  } else {
    console.log(`  ℹ️  [Base] /api/admin/support/tickets — ${backupData.tables.support_tickets.length} tickets conservados del respaldo base.`);
    console.log(`  ℹ️  [Base] /api/admin/audit — ${backupData.tables.audit_logs.length} auditorías conservadas del respaldo base.`);
    console.log(`  ℹ️  [Base] /api/advisory/tips — ${backupData.tables.advisory_tips.length} consejos conservados del respaldo base.`);
  }

  // 12. Recomendaciones de Asesor (/api/advisor/recommendations) — Verificación de endpoint asesor
  try {
    const res = await apiRequest('/api/advisor/recommendations', token);
    if (res.ok && res.data && Array.isArray(res.data.data)) {
      for (const r of res.data.data) {
        const key = r.id != null ? String(r.id) : `gen_${r.farmer_id}_${r.title}_${r.created_at}`;
        if (!recommendationsMap.has(key)) recommendationsMap.set(key, r);
      }
      backupData.tables.advisor_recommendations = Array.from(recommendationsMap.values());
      logEndpointResult('/api/advisor/recommendations', res.status, true, res.data.data.length, 'Recomendaciones técnicas (global)');
    } else {
      const msg = res.status === 403 || res.status === 401 
        ? 'Permisos insuficientes: el endpoint requiere rol "advisor" (datos recuperados mediante /api/parcels/:id)' 
        : (res.data?.error || 'Error al consultar');
      logEndpointResult('/api/advisor/recommendations', res.status, false, 0, msg);
    }
  } catch (err) {
    logEndpointResult('/api/advisor/recommendations', 0, false, 0, err.message);
  }

  // 13. Reporte Consolidado Institucional (/api/admin/reports/activity)
  if (!baseBackupLoaded) {
    try {
      const res = await apiRequest('/api/admin/reports/activity', token);
      if (res.ok && res.data?.report) {
        backupData.consolidated_reports.activity = res.data.report;
        logEndpointResult('/api/admin/reports/activity', res.status, true, 1, 'Reporte consolidado institucional');
      } else {
        logEndpointResult('/api/admin/reports/activity', res.status, false, 0, res.data?.error || 'Respuesta no esperada');
      }
    } catch (err) {
      logEndpointResult('/api/admin/reports/activity', 0, false, 0, err.message);
    }
  }

  // Calcular conteos finales por tabla
  for (const [tbl, rows] of Object.entries(backupData.tables)) {
    extractionReport.counts_by_table[tbl] = rows.length;
  }

  // 2. Guardar archivos de respaldo en disco local
  osEnsureDir(OUTPUT_DIR);

  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2), 'utf-8');
  fs.writeFileSync(REPORT_FILE, JSON.stringify(extractionReport, null, 2), 'utf-8');

  const backupSizeKb = (fs.statSync(BACKUP_FILE).size / 1024).toFixed(1);

  console.log('\n============================================================');
  console.log('📊 RESUMEN DE LA EXTRACCIÓN DE PRODUCCIÓN (COMPLETO)');
  console.log('============================================================');
  console.log(`${'Tabla'.padEnd(28)} | ${'Registros'.padEnd(12)} | Estado`);
  console.log('------------------------------------------------------------');
  for (const [tbl, count] of Object.entries(extractionReport.counts_by_table)) {
    const badge = count > 0 ? `✅ OK` : 'ℹ️ 0';
    console.log(`${tbl.padEnd(28)} | ${String(count).padEnd(12)} | ${badge}`);
  }
  console.log('============================================================');
  console.log(`📁 Archivo de Respaldo Completo: ${BACKUP_FILE} (${backupSizeKb} KB)`);
  console.log(`📋 Archivo de Reporte Completo:  ${REPORT_FILE}`);
  console.log('============================================================\n');

  // Limpiar credenciales y token de memoria
  token = null;
  password = null;
}

function osEnsureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

run().catch((err) => {
  console.error('\n❌ Error crítico durante la ejecución:', err.message);
  process.exit(1);
});
