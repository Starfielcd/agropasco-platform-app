/**
 * AgroPasco — Configuración Central de Mapas
 * Soporta Leaflet/OSM (gratuito) y Google Maps (opcional)
 * Todas las claves se leen desde .env vía endpoint /api/config/maps
 */

const MapsConfig = {
  // Se carga dinámicamente desde el backend
  API_KEY: '',
  PROVIDER: 'leaflet', // 'leaflet' | 'google'

  // Centro por defecto: Cerro de Pasco
  DEFAULT_CENTER: { lat: -10.6868, lng: -76.2625 },
  DEFAULT_ZOOM: 12,
  MAX_ZOOM: 18,
  MIN_ZOOM: 6,

  // Tiles OpenStreetMap (gratuito)
  OSM_TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  OSM_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',

  // Tiles Esri Satelital (gratuito)
  ESRI_SAT_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ESRI_SAT_ATTRIBUTION: '&copy; Esri, Maxar, Earthstar Geographics',

  // Nominatim API (geocodificación gratuita)
  NOMINATIM_BASE: 'https://nominatim.openstreetmap.org',

  // OSRM API (rutas gratuitas)
  OSRM_BASE: 'https://router.project-osrm.org',

  // Colores de polígonos por estado
  POLYGON_COLORS: {
    planificado: '#3b82f6',
    sembrado: '#22c55e',
    crecimiento: '#4ade80',
    floracion: '#f59e0b',
    maduracion: '#f97316',
    cosechado: '#a855f7',
    cancelado: '#ef4444',
    default: '#22c55e'
  },

  // Íconos de marcadores
  MARKER_ICONS: {
    pest: '🐛',
    disease: '🦠',
    weed: '🌿',
    damage: '⚠️',
    observation: '📋',
    default: '📍'
  },

  /**
   * Carga configuración desde el backend
   */
  async loadConfig() {
    try {
      const res = await fetch('/api/config/maps');
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) this.API_KEY = data.apiKey;
        if (data.provider) this.PROVIDER = data.provider;
      }
    } catch (e) {
      console.warn('MapsConfig: usando configuración por defecto (Leaflet/OSM)');
    }
  },

  /**
   * Obtiene el color del polígono según el estado del cultivo
   */
  getPolygonColor(status) {
    return this.POLYGON_COLORS[status] || this.POLYGON_COLORS.default;
  }
};
