/**
 * ============================================
 * AgroPasco — Servidor Principal
 * Plataforma Agrícola Inteligente para Pasco
 * ============================================
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

//  Confía en el proxy de Render
app.set('trust proxy', 1);

// ===== SEGURIDAD =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' }
});
app.use('/api/', limiter);

// ===== SERVIR FRONTEND (archivos estáticos) =====
app.use(express.static(path.join(__dirname, '..')));

// ===== RUTAS API =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/crops', require('./routes/crops'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/advisory', require('./routes/advisory'));
app.use('/api/v1/supermarket', require('./routes/supermarket'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/parcels', require('./routes/parcels'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/advisor', require('./routes/advisor'));
app.use('/api/pest-reports', require('./routes/pestReports'));

// ===== CONFIGURACIÓN DE MAPAS (público, para frontend) =====
app.get('/api/config/maps', (req, res) => {
  res.json({
    provider: process.env.MAPS_PROVIDER || 'leaflet',
    apiKey: process.env.MAPS_PROVIDER === 'google' ? (process.env.MAPS_API_KEY || '') : '',
    defaultCenter: {
      lat: parseFloat(process.env.DEFAULT_LAT) || -10.6868,
      lng: parseFloat(process.env.DEFAULT_LON) || -76.2625
    }
  });
});

// ===== RUTA DE INFO =====
app.get('/api', (req, res) => {
  res.json({
    platform: 'AgroPasco Digital',
    version: '2.0.0',
    description: 'Plataforma Agrícola Inteligente para la Región Pasco, Perú',
    roles: ['farmer', 'advisor', 'supermarket', 'admin'],
    endpoints: {
      auth: { register: 'POST /api/auth/register', login: 'POST /api/auth/login', profile: 'GET /api/auth/me' },
      crops: { list: 'GET /api/crops', create: 'POST /api/crops', detail: 'GET /api/crops/:id', logs: 'POST /api/crops/:id/logs', traceability: 'GET /api/crops/:id/traceability' },
      parcels: { list: 'GET /api/parcels', create: 'POST /api/parcels', detail: 'GET /api/parcels/:id' },
      weather: { current: 'GET /api/weather/current', forecast: 'GET /api/weather/forecast', alerts: 'GET /api/weather/alerts' },
      advisory: { tips: 'GET /api/advisory/tips?crop=papa', emergency: 'GET /api/advisory/emergency', calendar: 'GET /api/advisory/calendar/:cropType' },
      advisor: { markers: 'GET /api/advisor/markers', create_marker: 'POST /api/advisor/markers', recommendations: 'GET /api/advisor/recommendations', create_recommendation: 'POST /api/advisor/recommendations' },
      supermarket: { products: 'GET /api/v1/supermarket/products', trace: 'GET /api/v1/supermarket/products/:id/trace' },
      admin: { users: 'GET /api/admin/users', update_role: 'PUT /api/admin/users/:id/role', audit: 'GET /api/admin/audit', stats: 'GET /api/admin/stats' },
      ai: { recommend: 'GET /api/ai/recommend/:cropId', frost_risk: 'GET /api/ai/frost-risk', irrigation: 'GET /api/ai/irrigation/:cropId' },
      maps: { config: 'GET /api/config/maps' }
    }
  });
});

// ===== MANEJO DE ERRORES =====
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ success: false, error: 'Error interno del servidor.' });
});

// ===== INICIAR SERVIDOR =====
async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`\n🌾 ============================================`);
      console.log(`🌾  AgroPasco Digital — Servidor Iniciado`);
      console.log(`🌾  Puerto: ${PORT}`);
      console.log(`🌾  Frontend: http://localhost:${PORT}`);
      console.log(`🌾  API Docs: http://localhost:${PORT}/api`);
      console.log(`🌾 ============================================\n`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar el servidor:', err);
    process.exit(1);
  }
}

start();