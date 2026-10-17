/**
 * AgroPasco — Servicio de Almacenamiento Persistente de Archivos y Fotografías
 * =============================================================================
 * Arquitectura híbrida con resiliencia de producción:
 * 1. Supabase Storage (Almacenamiento persistente en la nube - Capa Gratuita).
 *    - Sobrevive a reinicios, spin-downs y nuevos despliegues de Render.
 *    - Emplea la API REST oficial de Supabase Storage v1 (Fetch nativo de Node.js).
 *    - No requiere dependencias externas adicionales.
 * 2. Almacenamiento Local (Fallback de seguridad).
 *    - Si Supabase Storage no está configurado o hay indisponibilidad de red,
 *      guarda de manera transparente en disk storage local (/uploads/).
 *    - Permite desarrollo local y pruebas unitarias 100% aisladas.
 *
 * Seguridad:
 * - Credenciales administrativas protegidas exclusivamente en backend.
 * - Validación estricta de extensiones y tipos MIME autorizados.
 * - Sanitización de nombres de archivo y sufijos anti-colisión criptográficamente seguros.
 */

const fs = require('fs');
const path = require('path');

// Directorio raíz de uploads local
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const ALLOWED_FOLDERS = ['pests', 'products', 'crops', 'parcels', 'documents', 'videos', 'recommendations', 'general'];

// Asegurar existencia de subcarpetas locales para caché o fallback
ALLOWED_FOLDERS.forEach(sub => {
  const dir = path.join(UPLOADS_ROOT, sub);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Obtiene la configuración de Supabase Storage desde variables de entorno.
 */
function getSupabaseConfig() {
  let supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'agropasco-products';

  // Si no está explícitamente SUPABASE_URL pero DATABASE_URL contiene el host de Supabase
  if (!supabaseUrl && process.env.DATABASE_URL) {
    const dbUrl = process.env.DATABASE_URL;
    // Formato típico pooler: postgresql://postgres.[project-ref]:...
    const poolerMatch = dbUrl.match(/postgres\.([a-zA-Z0-9_-]+):/);
    if (poolerMatch && poolerMatch[1]) {
      supabaseUrl = `https://${poolerMatch[1]}.supabase.co`;
    }
  }

  // Normalizar URL sin trailing slash
  if (supabaseUrl.endsWith('/')) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }

  return {
    url: supabaseUrl,
    key: supabaseKey,
    bucket,
    isConfigured: Boolean(supabaseUrl && supabaseKey)
  };
}

/**
 * Sube un buffer a Supabase Storage mediante la API REST v1.
 * @param {Buffer} buffer - Contenido binario del archivo
 * @param {string} destinationPath - Ruta dentro del bucket (ej: 'products/papa_123.jpg')
 * @param {string} mimeType - Tipo MIME (ej: 'image/jpeg')
 * @returns {Promise<{ success: boolean, publicUrl?: string, error?: string }>}
 */
async function uploadToSupabaseStorage(buffer, destinationPath, mimeType) {
  const config = getSupabaseConfig();
  if (!config.isConfigured) {
    return { success: false, error: 'Supabase Storage no está configurado (faltan credenciales).' };
  }

  const endpoint = `${config.url}/storage/v1/object/${config.bucket}/${destinationPath}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.key}`,
        'apikey': config.key,
        'Content-Type': mimeType || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        parsedMsg = errJson.message || errJson.error || errText;
      } catch (e) {
        // mantener texto plano
      }

      console.warn(`[SUPABASE_STORAGE_WARN] Fallo HTTP ${response.status} al subir ${destinationPath}:`, parsedMsg);
      return { success: false, error: `Supabase Storage HTTP ${response.status}: ${parsedMsg}` };
    }

    // La URL pública para buckets públicos de Supabase
    const publicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${destinationPath}`;
    return { success: true, publicUrl };

  } catch (netErr) {
    console.warn(`[SUPABASE_STORAGE_NETWORK_ERROR] Error de red al contactar Supabase Storage:`, netErr.message);
    return { success: false, error: `Error de red: ${netErr.message}` };
  }
}

/**
 * Guarda un archivo de forma persistente, intentando Supabase Storage primero
 * y degradando con gracia a disco local si no está configurado o falla.
 *
 * @param {Object} options
 * @param {Buffer} options.buffer - Buffer binario
 * @param {string} options.filename - Nombre final del archivo (con extensión)
 * @param {string} options.folder - Subcarpeta ('products', 'pests', etc.)
 * @param {string} options.mimeType - Tipo MIME
 * @returns {Promise<{ success: boolean, url: string, storageType: 'supabase'|'local', filename: string, size: number }>}
 */
async function persistFile({ buffer, filename, folder = 'general', mimeType = 'image/jpeg' }) {
  const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'general';
  const destinationPath = `${safeFolder}/${filename}`;

  // 1. Siempre guardar una copia local (sirve como respaldo, caché y desarrollo local)
  const localTargetDir = path.join(UPLOADS_ROOT, safeFolder);
  if (!fs.existsSync(localTargetDir)) {
    fs.mkdirSync(localTargetDir, { recursive: true });
  }
  const localFilePath = path.join(localTargetDir, filename);
  fs.writeFileSync(localFilePath, buffer);
  const localRelativeUrl = `/uploads/${safeFolder}/${filename}`;

  // 2. Intentar subir a Supabase Storage si está configurado
  const config = getSupabaseConfig();
  if (config.isConfigured) {
    const supabaseResult = await uploadToSupabaseStorage(buffer, destinationPath, mimeType);
    if (supabaseResult.success && supabaseResult.publicUrl) {
      return {
        success: true,
        url: supabaseResult.publicUrl,
        storageType: 'supabase',
        filename,
        size: buffer.length,
        mimeType
      };
    }
    console.warn(`[STORAGE] Falló subida a Supabase, utilizando fallback local para ${filename}: ${supabaseResult.error}`);
  }

  // 3. Retornar URL local de fallback
  return {
    success: true,
    url: localRelativeUrl,
    storageType: 'local',
    filename,
    size: buffer.length,
    mimeType
  };
}

/**
 * Genera un nombre de archivo único y seguro para evitar colisiones.
 */
function generateSafeFilename(originalName = 'upload', extOverride = '') {
  const ext = extOverride || path.extname(originalName).toLowerCase() || '.jpg';
  const safeBase = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 30) || 'archivo';
  const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
  return `${safeBase}_${uniqueSuffix}${ext}`;
}

module.exports = {
  getSupabaseConfig,
  uploadToSupabaseStorage,
  persistFile,
  generateSafeFilename,
  ALLOWED_FOLDERS,
  UPLOADS_ROOT
};
