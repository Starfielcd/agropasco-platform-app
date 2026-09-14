/**
 * AgroPasco — Controlador de Carga de Imágenes
 * Soporte dual: Multipart/form-data (Multer) y Base64 directo (Canvas/Cámara)
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Directorio raíz de uploads
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

// Asegurar existencia de subcarpetas
['pests', 'products', 'general'].forEach(sub => {
  const dir = path.join(UPLOADS_ROOT, sub);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configuración de Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folder = req.query.folder || req.body.folder || 'general';
    const targetDir = path.join(UPLOADS_ROOT, ['pests', 'products'].includes(folder) ? folder : 'general');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen (JPG, PNG, WEBP).'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max
  fileFilter
});

// Middleware multer para un archivo
const uploadSingle = upload.single('image');

// Handler de carga multipart
function handleFileUpload(req, res) {
  uploadSingle(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, error: `Error de subida: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se envió ningún archivo de imagen.' });
    }

    const folder = req.query.folder || req.body.folder || 'general';
    const safeFolder = ['pests', 'products'].includes(folder) ? folder : 'general';
    const relativeUrl = `/uploads/${safeFolder}/${req.file.filename}`;

    res.json({
      success: true,
      message: 'Imagen cargada exitosamente.',
      url: relativeUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  });
}

// Handler de carga Base64 (DataURL directo de Canvas / Cámara)
async function handleBase64Upload(req, res) {
  try {
    const { image, folder } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: 'Cadena de imagen requerida (Base64 DataURL).' });
    }

    // Parsear DataURL (ej: "data:image/jpeg;base64,...")
    const matches = image.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: 'Formato de imagen Base64 inválido.' });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    let ext = '.jpg';
    if (mimeType.includes('png')) ext = '.png';
    else if (mimeType.includes('webp')) ext = '.webp';

    const safeFolder = ['pests', 'products'].includes(folder) ? folder : 'general';
    const targetDir = path.join(UPLOADS_ROOT, safeFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filename = `capture_${Date.now()}_${Math.round(Math.random() * 1E6)}${ext}`;
    const filePath = path.join(targetDir, filename);

    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `/uploads/${safeFolder}/${filename}`;

    res.json({
      success: true,
      message: 'Fotografía guardada exitosamente.',
      url: relativeUrl,
      filename: filename,
      size: buffer.length
    });
  } catch (err) {
    console.error('Error al guardar imagen Base64:', err);
    res.status(500).json({ success: false, error: 'Error al procesar la imagen capturada.' });
  }
}

module.exports = { handleFileUpload, handleBase64Upload };
