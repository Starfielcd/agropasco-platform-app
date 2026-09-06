/**
 * AgroPasco — Configuración Central de Mapas
 * Soporta Leaflet/OSM (gratuito) y Google Maps JavaScript API (pago)
 * Las claves se leen desde el backend via GET /api/config/maps
 */

const MapsConfig = {
  API_KEY: '',
  PROVIDER: 'leaflet',
  GOOGLE_LOADED: false,

  DEFAULT_CENTER: { lat: -10.6868, lng: -76.2625 },
  DEFAULT_ZOOM: 12,
  MAX_ZOOM: 18,
  MIN_ZOOM: 6,

  OSM_TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  OSM_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',

  ESRI_SAT_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ESRI_SAT_ATTRIBUTION: '&copy; Esri, Maxar, Earthstar Geographics',

  NOMINATIM_BASE: 'https://nominatim.openstreetmap.org',
  OSRM_BASE: 'https://router.project-osrm.org',

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

  MARKER_ICONS: {
    pest: '🐛',
    disease: '🦠',
    weed: '🌿',
    damage: '⚠️',
    observation: '📋',
    default: '📍'
  },

  /**
   * Carga configuración desde el backend y, si el proveedor es Google,
   * inyecta el script de Google Maps JavaScript API en el DOM.
   */
  async loadConfig() {
    try {
      const res = await fetch('/api/config/maps');
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) this.API_KEY = data.apiKey;
        if (data.provider) this.PROVIDER = data.provider;
        if (data.defaultCenter) {
          this.DEFAULT_CENTER.lat = data.defaultCenter.lat;
          this.DEFAULT_CENTER.lng = data.defaultCenter.lng;
        }
      }
    } catch (e) {
      console.warn('MapsConfig: usando configuración por defecto (Leaflet/OSM)');
    }

    if (this.PROVIDER === 'google' && this.API_KEY) {
      await this._loadGoogleMapsScript();
    }
  },

  /**
   * Inyecta el script de Google Maps JavaScript API dinámicamente.
   * Solo se carga una vez; las llamadas posteriores son no-op.
   */
  _loadGoogleMapsScript() {
    if (this.GOOGLE_LOADED) return Promise.resolve();

    return new Promise((resolve, reject) => {
      if (document.getElementById('google-maps-script')) {
        this.GOOGLE_LOADED = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = 'google-maps-script';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.API_KEY}&libraries=drawing,geometry&language=es&region=PE`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.GOOGLE_LOADED = true;
        console.log('Google Maps JavaScript API cargada correctamente');
        resolve();
      };

      script.onerror = () => {
        console.error('Error al cargar Google Maps JavaScript API — usando Leaflet como fallback');
        this.PROVIDER = 'leaflet';
        this.API_KEY = '';
        reject(new Error('Google Maps API load failed'));
      };

      document.head.appendChild(script);
    });
  },

  getPolygonColor(status) {
    return this.POLYGON_COLORS[status] || this.POLYGON_COLORS.default;
  },

  isGoogleProvider() {
    return this.PROVIDER === 'google' && this.API_KEY && this.GOOGLE_LOADED;
  }
};
