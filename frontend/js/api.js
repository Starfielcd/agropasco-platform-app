/**
 * AgroPasco — Cliente HTTP Centralizado & Galería Visual de Campo
 * Integración directa con Open-Meteo API (Cerro de Pasco: -10.6674, -76.2567)
 */

const API_URL = (window.location.origin.includes('localhost:') || window.location.origin.includes('127.0.0.1:')) && !window.location.origin.includes(':5000')
  ? 'http://localhost:5000/api'
  : '/api';
const OPEN_METEO_LIVE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-10.6674&longitude=-76.2567&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,soil_temperature_0cm,soil_moisture_0_to_1cm,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FLima';

// ===== BANCO DE IMÁGENES ILUSTRATIVAS DE ALTA CALIDAD PARA AGRICULTORES =====
const FIELD_IMAGES = {
  // Labores de Siembra y Campo
  preparacion_suelo: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=800&q=80',
  siembra: 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=800&q=80',
  riego: 'https://images.unsplash.com/photo-1563514227147-6d2ff665a6a0?auto=format&fit=crop&w=800&q=80',
  fertilizacion: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&w=800&q=80',
  cosecha: 'https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=800&q=80',

  // Mitigación de Heladas y Riesgos Climáticos
  riego_aspersion: 'https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&w=800&q=80',
  mantas_termicas: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80',
  fogatas_humo: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=800&q=80',
  bioestimulantes: 'https://images.unsplash.com/photo-1530836369250-ef72a3f5cda8?auto=format&fit=crop&w=800&q=80',
  malla_sombra: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=800&q=80',
  zanjas_drenaje: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?auto=format&fit=crop&w=800&q=80',
  mulch_cobertura: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=800&q=80',

  // Cultivos de la Región Pasco
  papa: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=800&q=80',
  maca: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=800&q=80',
  quinua: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80',
  habas: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=800&q=80',
  palto: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=800&q=80',
  oca: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=800&q=80'
};

function getToken() { return localStorage.getItem('agropasco_token'); }
function setToken(token) { localStorage.setItem('agropasco_token', token); }
function removeToken() { localStorage.removeItem('agropasco_token'); }
function getUser() { const u = localStorage.getItem('agropasco_user'); return u ? JSON.parse(u) : null; }
function setUser(user) { localStorage.setItem('agropasco_user', JSON.stringify(user)); }
function removeUser() { localStorage.removeItem('agropasco_user'); }

async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };

  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(url, { ...options, headers });
    const data = await response.json();

    if (response.status === 401 || response.status === 403) {
      removeToken();
      removeUser();
      window.location.hash = '#/login';
      return data;
    }

    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { success: false, error: 'Error de conexión con el servidor.' };
  }
}

// ===== CONSULTA DIRECTA DE CLIMA EN VIVO (OPEN-METEO API) =====
async function getLiveWeatherData() {
  try {
    const res = await fetch(OPEN_METEO_LIVE_URL);
    if (!res.ok) throw new Error('Open-Meteo HTTP Error');
    const data = await res.json();
    const curr = data.current || {};
    const daily = data.daily || {};

    return {
      success: true,
      data: {
        name: 'Cerro de Pasco',
        latitude: -10.6674,
        longitude: -76.2567,
        altitude_masl: 4380,
        temp_2m: curr.temperature_2m ?? 4.5,
        humidity: curr.relative_humidity_2m ?? 75,
        pressure: curr.surface_pressure ?? 620,
        wind_speed: curr.wind_speed_10m ?? 4.2,
        soil_temp_0cm: curr.soil_temperature_0cm ?? 5.2,
        soil_moisture_1cm: curr.soil_moisture_0_to_1cm ?? 0.35,
        uv_index: curr.uv_index ?? 9.5,
        temp_min: daily.temperature_2m_min?.[0] ?? -2.0,
        temp_max: daily.temperature_2m_max?.[0] ?? 12.0,
        rain_prob: daily.precipitation_probability_max?.[0] ?? 20,
        condition: (curr.temperature_2m ?? 4.5) <= 0 ? 'Helada / Descenso térmico' : 'Cielo despejado',
        source: 'Open-Meteo Live (Lat -10.6674, Lon -76.2567)'
      }
    };
  } catch (err) {
    console.warn('Fallback a API local para clima:', err.message);
    return apiRequest('/weather/current');
  }
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

  // AI
  getRecommendations: (cropId) => apiRequest(`/ai/recommend/${cropId}`),
  getFrostRisk: () => apiRequest('/ai/frost-risk'),
  getIrrigationPlan: (cropId) => apiRequest(`/ai/irrigation/${cropId}`),
};

// Toast notification system
function showToast(message, type = 'success') {
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
