/**
 * AgroPasco — Cliente HTTP Centralizado & Galería Visual de Campo
 * Integración directa con Open-Meteo API (Cerro de Pasco: -10.6674, -76.2567)
 */

const API_URL = (typeof window !== 'undefined' && window.location && (window.location.origin.includes('localhost:') || window.location.origin.includes('127.0.0.1:')) && !window.location.origin.includes(':5000'))
  ? 'http://localhost:5000/api'
  : '/api';
const OPEN_METEO_LIVE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-10.6674&longitude=-76.2567&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,soil_temperature_0cm,soil_moisture_0_to_1cm,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FLima';

// ===== BANCO DE IMÁGENES LOCALES DE ALTA CALIDAD PARA AGRICULTORES (NATURAL MODERNO) =====
const FIELD_IMAGES = {
  // Paisajes y Fondos
  login_bg: 'frontend/assets/images/login/login_bg.jpg',
  dashboard_hero: 'frontend/assets/images/landscapes/dashboard_hero.jpg',

  // Fenómenos Meteorológicos ML
  frost: 'frontend/assets/images/phenomena/frost.jpg',
  heavy_rain: 'frontend/assets/images/phenomena/heavy_rain.jpg',
  snow: 'frontend/assets/images/phenomena/snow.jpg',
  hail: 'frontend/assets/images/phenomena/hail.jpg',

  // Condiciones Climáticas
  sunny: 'frontend/assets/images/weather/sunny.jpg',
  cloudy: 'frontend/assets/images/weather/cloudy.jpg',
  rain: 'frontend/assets/images/weather/rain.jpg',
  storm: 'frontend/assets/images/weather/storm.jpg',
  syncing: 'frontend/assets/images/weather/syncing.jpg',

  // Cultivos de la Región Pasco (Locales)
  papa: 'frontend/assets/images/crops/papa.jpg',
  maca: 'frontend/assets/images/crops/maca.jpg',
  habas: 'frontend/assets/images/crops/habas.jpg',
  cebada: 'frontend/assets/images/crops/cebada.jpg',
  quinua: 'frontend/assets/images/crops/cebada.jpg',
  cafe: 'frontend/assets/images/crops/habas.jpg',
  palto: 'frontend/assets/images/crops/maca.jpg',
  oca: 'frontend/assets/images/crops/papa.jpg',

  // Mitigación y Labores Agrícolas
  preparacion_suelo: 'frontend/assets/images/crops/papa.jpg',
  siembra: 'frontend/assets/images/crops/maca.jpg',
  riego: 'frontend/assets/images/weather/rain.jpg',
  fertilizacion: 'frontend/assets/images/crops/papa.jpg',
  cosecha: 'frontend/assets/images/crops/cebada.jpg',
  riego_aspersion: 'frontend/assets/images/weather/rain.jpg',
  mantas_termicas: 'frontend/assets/images/phenomena/frost.jpg',
  fogatas_humo: 'frontend/assets/images/landscapes/dashboard_hero.jpg',
  bioestimulantes: 'frontend/assets/images/crops/habas.jpg',
  malla_sombra: 'frontend/assets/images/weather/sunny.jpg',
  zanjas_drenaje: 'frontend/assets/images/phenomena/heavy_rain.jpg',
  mulch_cobertura: 'frontend/assets/images/crops/maca.jpg'
};

/**
 * Determina determinísticamente la imagen meteorológica basada estrictamente
 * en datos reales entregados por el backend (sin Math.random).
 */
function getDynamicWeatherImage(liveData, frostData) {
  const live = liveData || {};
  const isAvailable = live.is_available !== false && live.status !== 'unavailable' && (live.temp_2m !== null || live.main?.temp !== null);
  
  if (!isAvailable || live.status === 'pending' || live.status === 'unavailable') {
    return FIELD_IMAGES.syncing;
  }

  const temp = live.temp_2m ?? live.main?.temp ?? 10;
  const condition = (live.condition || live.weather?.[0]?.description || '').toLowerCase();
  const weatherCode = live.weather_code ?? live.weathercode;
  const frostRisk = (frostData?.risk_level || '').toLowerCase();

  // 1. Helada confirmada o riesgo crítico/alto con temp <= 2°C
  if (frostRisk === 'critico' || frostRisk === 'alto' || temp <= 0 || condition.includes('helada')) {
    return FIELD_IMAGES.frost;
  }

  // 2. Nieve / Nevadas (códigos WMO 71-77, 85-86)
  if (condition.includes('nieve') || condition.includes('nevada') || (weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) {
    return FIELD_IMAGES.snow;
  }

  // 3. Granizo / Tormenta eléctrica severa (códigos WMO 95, 96, 99)
  if (condition.includes('granizo') || condition.includes('tormenta') || weatherCode === 96 || weatherCode === 99) {
    return FIELD_IMAGES.hail;
  }

  // 4. Lluvia Intensa (código WMO 65, 82)
  if (condition.includes('intensa') || condition.includes('fuerte') || weatherCode === 65 || weatherCode === 82) {
    return FIELD_IMAGES.heavy_rain;
  }

  // 5. Lluvia moderada o llovizna (códigos WMO 51-63, 80-81)
  if (condition.includes('lluvia') || condition.includes('llovizna') || (weatherCode >= 51 && weatherCode <= 63) || weatherCode === 80 || weatherCode === 81) {
    return FIELD_IMAGES.rain;
  }

  // 6. Nublado / Cubierto (códigos WMO 1, 2, 3)
  if (condition.includes('nub') || condition.includes('cubierto') || (weatherCode >= 1 && weatherCode <= 3)) {
    return FIELD_IMAGES.cloudy;
  }

  // 7. Por defecto: Despejado / Soleado
  return FIELD_IMAGES.sunny;
}

// Generación / Epoch de sesión global en cliente para invalidación determinista (H-02)
let _mlSessionEpoch = 1;

function getClientSessionScope() {
  try {
    const u = getUser();
    return u && u.id ? `u_${u.id}_${u.role || 'user'}` : 'anon';
  } catch (_) {
    return 'anon';
  }
}

function clearMLClientCacheInternal() {
  _mlSessionEpoch++;
  if (typeof _mlClientCache !== 'undefined') {
    _mlClientCache.user = { data: null, timestamp: 0, promise: null, epoch: 0, scope: null };
    _mlClientCache.all = { data: null, timestamp: 0, promise: null, epoch: 0, scope: null };
    _mlClientCache.status = { data: null, timestamp: 0, promise: null, epoch: 0, scope: null };
  }
  if (typeof clearAdvisoryChatState === 'function') {
    try { clearAdvisoryChatState(); } catch (_) {}
  }
}

function getToken() { try { return localStorage.getItem('agropasco_token'); } catch (_) { return null; } }
function setToken(token) {
  try { localStorage.setItem('agropasco_token', token); } catch (_) {}
  clearMLClientCacheInternal();
}
function removeToken() {
  try { localStorage.removeItem('agropasco_token'); } catch (_) {}
  clearMLClientCacheInternal();
}
function getUser() {
  try {
    const u = localStorage.getItem('agropasco_user');
    return u ? JSON.parse(u) : null;
  } catch (_) {
    return null;
  }
}
function setUser(user) {
  try { localStorage.setItem('agropasco_user', JSON.stringify(user)); } catch (_) {}
  clearMLClientCacheInternal();
}
function removeUser() {
  try { localStorage.removeItem('agropasco_user'); } catch (_) {}
  clearMLClientCacheInternal();
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };

  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(url, { ...options, headers });
    const data = await response.json();

    if (data && typeof data === 'object') {
      data.httpStatus = response.status;
    }

    if (response.status === 401 || response.status === 403) {
      const isAuthEndpoint = endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/register');
      if (!isAuthEndpoint) {
        clearMLClientCacheInternal();
        removeToken();
        removeUser();
        if (typeof window !== 'undefined' && window.location) {
          window.location.hash = '#/login';
        }
      }
      return data;
    }

    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { success: false, error: 'Error de conexión con el servidor.' };
  }
}

// ===== CONSULTA CENTRALIZADA DE CLIMA EN VIVO (VÍA BACKEND PROTEGIDO) =====
async function getLiveWeatherData() {
  try {
    return await apiRequest('/weather/current');
  } catch (err) {
    console.warn('Aviso: Utilizando respaldo de clima local:', err.message);
    return {
      success: true,
      data: {
        name: 'Cerro de Pasco',
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        temp_2m: 4.5,
        humidity: 75,
        pressure: 620,
        wind_speed: 4.2,
        soil_temp_0cm: 5.2,
        soil_moisture_1cm: 0.35,
        uv_index: 9.5,
        temp_min: -2.0,
        temp_max: 12.0,
        rain_prob: 20,
        condition: 'Cielo despejado',
        source: 'AgroPasco Clima Protegido'
      }
    };
  }
}

// Caché ligera en memoria aislada por sesión y usuario (FASE 8L-G16: Corrección H-02)
const _mlClientCache = {
  user: { data: null, timestamp: 0, promise: null, epoch: 0, scope: null },
  all: { data: null, timestamp: 0, promise: null, epoch: 0, scope: null },
  status: { data: null, timestamp: 0, promise: null, epoch: 0, scope: null }
};

function fetchCachedML(key, url, ttlMs = 30000) {
  const now = Date.now();
  const currentEpoch = _mlSessionEpoch;
  const currentScope = (key === 'status') ? 'global_status' : getClientSessionScope();
  const entry = _mlClientCache[key];

  // 1. Verificación estricta de coincidencia de generación y alcance de usuario
  if (entry.data && entry.epoch === currentEpoch && entry.scope === currentScope && (now - entry.timestamp < ttlMs)) {
    return Promise.resolve(entry.data);
  }

  // 2. Si existe una promesa en vuelo de la MISMA sesión y alcance, reutilizarla
  if (entry.promise && entry.epoch === currentEpoch && entry.scope === currentScope) {
    return entry.promise;
  }

  // 3. Si la promesa era de una sesión anterior o alcance distinto, descartarla
  entry.promise = null;
  entry.data = null;
  entry.epoch = currentEpoch;
  entry.scope = currentScope;

  const capturedEpoch = currentEpoch;
  const capturedScope = currentScope;

  entry.promise = apiRequest(url)
    .then(res => {
      // 4. Protección contra peticiones pendientes: si la sesión cambió mientras la petición
      // estaba en vuelo (logout, login nuevo, 401), NUNCA repoblar la caché de la nueva sesión
      const stillSameEpoch = (_mlSessionEpoch === capturedEpoch);
      const stillSameScope = (getClientSessionScope() === capturedScope || key === 'status');

      if (stillSameEpoch && stillSameScope) {
        entry.data = res;
        entry.timestamp = Date.now();
        entry.epoch = capturedEpoch;
        entry.scope = capturedScope;
        return res;
      }

      // Sesión expirada o cambiada en vuelo: descartar respuesta para evitar fuga entre usuarios
      return { success: false, session_expired: true, error: 'Sesión invalidada durante la consulta.' };
    })
    .finally(() => {
      if (entry.epoch === capturedEpoch) {
        entry.promise = null;
      }
    });

  return entry.promise;
}

const api = {
  // Auth
  register: (data) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: () => apiRequest('/auth/me'),

  // Crops
  getCrops: () => apiRequest('/crops'),
  createCrop: (data) => apiRequest('/crops', { method: 'POST', body: JSON.stringify(data) }),
  getCrop: (id) => apiRequest(`/crops/${id}`),
  updateCrop: (id, data) => apiRequest(`/crops/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCrop: (id) => apiRequest(`/crops/${id}`, { method: 'DELETE' }),
  addCropLog: (id, data) => apiRequest(`/crops/${id}/logs`, { method: 'POST', body: JSON.stringify(data) }),
  getTraceability: (id) => apiRequest(`/crops/${id}/traceability`),

  // Parcels (Farmer / Advisor)
  getParcels: () => apiRequest('/parcels'),
  createParcel: (data) => apiRequest('/parcels', { method: 'POST', body: JSON.stringify(data) }).then(res => {
    if (res && res.success) clearMLClientCacheInternal();
    return res;
  }),
  getParcel: (id) => apiRequest(`/parcels/${id}`),
  updateParcel: (id, data) => apiRequest(`/parcels/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(res => {
    if (res && res.success) clearMLClientCacheInternal();
    return res;
  }),
  deleteParcel: (id) => apiRequest(`/parcels/${id}`, { method: 'DELETE' }).then(res => {
    if (res && res.success) clearMLClientCacheInternal();
    return res;
  }),

  // Advisor — Pest Markers
  getPestMarkers: (params = '') => apiRequest(`/advisor/markers${params ? '?' + params : ''}`),
  createPestMarker: (data) => apiRequest('/advisor/markers', { method: 'POST', body: JSON.stringify(data) }),
  resolvePestMarker: (id) => apiRequest(`/advisor/markers/${id}/resolve`, { method: 'PUT' }),

  // Advisor — Recommendations
  getRecommendations: () => apiRequest('/advisor/recommendations'),
  createRecommendation: (data) => apiRequest('/advisor/recommendations', { method: 'POST', body: JSON.stringify(data) }),
  getAdvisorFarmers: () => apiRequest('/advisor/farmers'),

  // Admin
  getAdminUsers: (params = '') => apiRequest(`/admin/users${params ? '?' + params : ''}`),
  updateUserRole: (id, data) => apiRequest(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleUserStatus: (id, data) => apiRequest(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserPassword: (id, data = {}) => apiRequest(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),
  getDuplicates: () => apiRequest('/admin/duplicates'),
  deleteUser: (id) => apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
  getAuditLog: (params = '') => apiRequest(`/admin/audit${params ? '?' + params : ''}`),
  getAdminStats: () => apiRequest('/admin/stats'),
  getMetricDetail: (type) => apiRequest(`/admin/stats/metric-detail?type=${type}`),
  getActivityReport: () => apiRequest('/admin/reports/activity'),
  getModerationPhotos: () => apiRequest('/admin/moderation/photos'),
  removeModerationPhoto: (data) => apiRequest('/admin/moderation/photos', { method: 'DELETE', body: JSON.stringify(data) }),
  getAnomalies: () => apiRequest('/admin/moderation/anomalies'),
  getSupportTickets: (params = '') => apiRequest(`/admin/support/tickets${params ? '?' + params : ''}`),
  respondSupportTicket: (id, data) => apiRequest(`/admin/support/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify(data) }),
  escalateSupportTicket: (id) => apiRequest(`/admin/support/tickets/${id}/escalate`, { method: 'POST' }),

  // Admin — Solicitudes de Cuenta (Aprobación / Rechazo / Credenciales)
  getPendingAccounts: () => apiRequest('/admin/pending-accounts'),
  approveAccount: (id, data = {}) => apiRequest(`/admin/accounts/${id}/approve`, { method: 'PUT', body: JSON.stringify(data) }),
  rejectAccount: (id, data) => apiRequest(`/admin/accounts/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }),
  resendCredentials: (id) => apiRequest(`/admin/users/${id}/resend-credentials`, { method: 'POST' }),

  // Consulta de Estado de Solicitud (Stepper Reactivo)
  getApplicationStatus: (identifier) => {
    const param = identifier ? (String(identifier).includes('@') ? `?email=${encodeURIComponent(identifier)}` : `?requestId=${encodeURIComponent(identifier)}`) : '';
    return apiRequest(`/users/application-status${param}`);
  },
  setupApprovedPassword: (data) => apiRequest('/users/setup-approved-password', { method: 'POST', body: JSON.stringify(data) }),

  // Admin — Transferencia de Administración Única
  transferAdministration: (data) => apiRequest('/admin/transfer', { method: 'POST', body: JSON.stringify(data) }),

  // Auth — Setup Inicial y Cambio de Contraseña
  getSetupStatus: () => apiRequest('/auth/setup-status'),
  setupInitialAdmin: (data) => apiRequest('/auth/setup-admin', { method: 'POST', body: JSON.stringify(data) }),
  changePassword: (data) => apiRequest('/auth/change-password', { method: 'PUT', body: JSON.stringify(data) }),

  // Weather
  getCurrentWeather: () => apiRequest('/weather/current'),
  getLiveWeather: getLiveWeatherData,
  getForecast: () => apiRequest('/weather/forecast'),
  getAlerts: (simType = '') => apiRequest(`/weather/alerts${simType ? '?sim=' + simType : ''}`),

  // Advisory
  getTips: (params = '') => apiRequest(`/advisory/tips${params ? '?' + params : ''}`),
  getEmergencyTips: () => apiRequest('/advisory/emergency'),
  getCalendar: (cropType) => apiRequest(`/advisory/calendar/${cropType || ''}`),
  getPlantingGuide: (cropType) => apiRequest(`/advisory/guide/${cropType || ''}`),

  // Supermarket
  getProducts: (params = '') => apiRequest(`/v1/supermarket/products${params ? '?' + params : ''}`),
  getProduct: (id) => apiRequest(`/v1/supermarket/products/${id}`),
  getProductTrace: (id) => apiRequest(`/v1/supermarket/products/${id}/trace`),
  publishProduct: (data) => apiRequest('/v1/supermarket/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) => apiRequest(`/v1/supermarket/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getPendingProducts: () => apiRequest('/v1/supermarket/products/pending'),
  validateProduct: (id, data) => apiRequest(`/v1/supermarket/products/${id}/validate`, { method: 'PUT', body: JSON.stringify(data) }),

  // Pest Reports (farmer → advisor)
  createPestReport: (data) => apiRequest('/pest-reports', { method: 'POST', body: JSON.stringify(data) }),
  getPestReports: (params = '') => apiRequest(`/pest-reports${params ? '?' + params : ''}`),
  respondPestReport: (id, data) => {
    const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
    return apiRequest(`/pest-reports/${id}/respond`, {
      method: 'PUT',
      body: isFormData ? data : JSON.stringify(data)
    });
  },
  confirmPestFeedback: (id, data) => apiRequest(`/pest-reports/${id}/feedback`, { method: 'POST', body: JSON.stringify(data) }),
  reportPestPersists: (id, data) => apiRequest(`/pest-reports/${id}/persist`, { method: 'POST', body: JSON.stringify(data) }),
  getPestReportResponses: (id) => apiRequest(`/pest-reports/${id}/responses`),

  // AI
  getRecommendationsAI: (cropId) => apiRequest(`/ai/recommend/${cropId}`),
  getFrostRisk: () => apiRequest('/ai/frost-risk'),
  getIrrigationPlan: (cropId) => apiRequest(`/ai/irrigation/${cropId}`),
  sendAdvisoryChat: (data, options = {}) => apiRequest('/ai/advisory-chat', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options
  }),

  // Machine Learning Meteorológico
  getMLPrediction: (parcelId) => apiRequest(`/ml/predict/${parcelId}`),
  getMLPredictions: (force = false) => force ? apiRequest('/ml/predictions') : fetchCachedML('user', '/ml/predictions'),
  getMLPredictionsAll: (force = false) => force ? apiRequest('/ml/predictions/all') : fetchCachedML('all', '/ml/predictions/all'),
  getMLModelsStatus: (force = false) => force ? apiRequest('/ml/models/status') : fetchCachedML('status', '/ml/models/status', 15000),
  clearMLClientCache: () => {
    clearMLClientCacheInternal();
  },
  generateMLAlerts: () => apiRequest('/ml/alerts/generate', { method: 'POST' }),
  getMLAdminDashboard: () => apiRequest('/ml/admin/dashboard'),
  getMLAlerts: (unread = false) => apiRequest(`/ml/alerts${unread ? '?unread=true' : ''}`),
  markMLAlertRead: (id) => apiRequest(`/ml/alerts/${id}/read`, { method: 'PUT' }),
  getMLPreferences: () => apiRequest('/ml/preferences'),
  updateMLPreferences: (data) => apiRequest('/ml/preferences', { method: 'PUT', body: JSON.stringify(data) }),
  getMLObservations: (phenomenon = '') => apiRequest(`/ml/observations${phenomenon ? `?phenomenon=${phenomenon}` : ''}`),
  createMLObservation: (data) => apiRequest('/ml/observations', { method: 'POST', body: JSON.stringify(data) }),
};

// Toast notification system
function showToast(message, type = 'success') {
  if (typeof document === 'undefined') return;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 4000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    api,
    _mlClientCache,
    fetchCachedML,
    clearMLClientCacheInternal,
    getClientSessionScope,
    getToken,
    setToken,
    removeToken,
    getUser,
    setUser,
    removeUser,
    getMLSessionEpoch: () => _mlSessionEpoch
  };
}
