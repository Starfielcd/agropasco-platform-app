/**
 * AgroPasco — Mapa Interactivo con Leaflet.js
 * Clase AgroMap para gestión de mapas, polígonos y marcadores
 * Ubicación: /services/maps/leafletMap.js
 */

class AgroMap {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.map = null;
    this.layers = {
      parcels: null,
      markers: null,
      routes: null
    };
    this.drawControl = null;
    this.drawnItems = null;
    this.options = {
      center: options.center || [MapsConfig.DEFAULT_CENTER.lat, MapsConfig.DEFAULT_CENTER.lng],
      zoom: options.zoom || MapsConfig.DEFAULT_ZOOM,
      satellite: options.satellite !== undefined ? options.satellite : true,
      drawEnabled: options.drawEnabled || false,
      onClick: options.onClick || null,
      onPolygonCreated: options.onPolygonCreated || null,
      onMarkerClick: options.onMarkerClick || null
    };
  }

  /**
   * Inicializa el mapa en el contenedor dado
   */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`AgroMap: contenedor #${this.containerId} no encontrado`);
      return this;
    }

    // Crear instancia del mapa
    this.map = L.map(this.containerId, {
      center: this.options.center,
      zoom: this.options.zoom,
      zoomControl: true,
      attributionControl: true
    });

    // Capa base: OpenStreetMap
    const osmLayer = L.tileLayer(MapsConfig.OSM_TILE_URL, {
      attribution: MapsConfig.OSM_ATTRIBUTION,
      maxZoom: MapsConfig.MAX_ZOOM
    });

    // Capa satelital: Esri World Imagery
    const satLayer = L.tileLayer(MapsConfig.ESRI_SAT_URL, {
      attribution: MapsConfig.ESRI_SAT_ATTRIBUTION,
      maxZoom: MapsConfig.MAX_ZOOM
    });

    // Control de capas
    const baseLayers = {
      '🗺️ Mapa': osmLayer,
      '🛰️ Satélite': satLayer
    };

    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(this.map);

    // Capa inicial
    if (this.options.satellite) {
      satLayer.addTo(this.map);
    } else {
      osmLayer.addTo(this.map);
    }

    // Grupos de capas
    this.layers.parcels = L.featureGroup().addTo(this.map);
    this.layers.markers = L.featureGroup().addTo(this.map);
    this.layers.routes = L.featureGroup().addTo(this.map);

    // Click handler
    if (this.options.onClick) {
      this.map.on('click', (e) => this.options.onClick(e.latlng));
    }

    // Habilitar dibujo si se solicita
    if (this.options.drawEnabled) {
      this.enableDraw();
    }

    // Forzar re-render después de que el contenedor sea visible
    setTimeout(() => this.map.invalidateSize(), 200);

    return this;
  }

  /**
   * Habilita herramientas de dibujo de polígonos
   */
  enableDraw() {
    if (!this.map || typeof L.Control.Draw === 'undefined') {
      console.warn('AgroMap: Leaflet.Draw no disponible');
      return this;
    }

    this.drawnItems = new L.FeatureGroup();
    this.map.addLayer(this.drawnItems);

    this.drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: {
            color: MapsConfig.POLYGON_COLORS.default,
            weight: 3,
            fillOpacity: 0.25
          },
          metric: true
        }
      },
      edit: {
        featureGroup: this.drawnItems,
        remove: true
      }
    });

    this.map.addControl(this.drawControl);

    // Capturar polígonos creados
    this.map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      this.drawnItems.addLayer(layer);

      // Extraer coordenadas
      const coords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);

      // Calcular área en hectáreas
      const areaM2 = L.GeometryUtil ? L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) : 0;
      const areaHa = (areaM2 / 10000).toFixed(2);

      if (this.options.onPolygonCreated) {
        this.options.onPolygonCreated({
          coordinates: coords,
          geoJSON: layer.toGeoJSON(),
          areaHectares: parseFloat(areaHa),
          layer: layer
        });
      }
    });

    return this;
  }

  /**
   * Agrega un polígono al mapa
   */
  addPolygon(coordinates, options = {}) {
    if (!this.map) return null;

    const color = options.color || MapsConfig.POLYGON_COLORS.default;
    const polygon = L.polygon(coordinates, {
      color: color,
      weight: options.weight || 3,
      fillOpacity: options.fillOpacity || 0.2,
      fillColor: color
    });

    if (options.popup) {
      polygon.bindPopup(options.popup);
    }

    if (options.tooltip) {
      polygon.bindTooltip(options.tooltip, { permanent: true, direction: 'center', className: 'parcel-tooltip' });
    }

    polygon.addTo(this.layers.parcels);

    if (options.onClick) {
      polygon.on('click', () => options.onClick(polygon));
    }

    return polygon;
  }

  /**
   * Agrega un marcador al mapa
   */
  addMarker(lat, lng, options = {}) {
    if (!this.map) return null;

    const markerOptions = {};

    // Usar ícono personalizado si se proporciona
    if (options.icon) {
      markerOptions.icon = L.divIcon({
        html: `<div class="custom-marker ${options.className || ''}" style="font-size: 24px;">${options.icon}</div>`,
        className: 'custom-marker-container',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });
    }

    const marker = L.marker([lat, lng], markerOptions);

    if (options.popup) {
      marker.bindPopup(options.popup, { maxWidth: 320 });
    }

    if (options.tooltip) {
      marker.bindTooltip(options.tooltip);
    }

    marker.addTo(this.layers.markers);

    if (options.onClick) {
      marker.on('click', () => options.onClick(marker));
    }

    return marker;
  }

  /**
   * Dibuja una ruta (polilínea) en el mapa
   */
  drawRoute(coordinates, options = {}) {
    if (!this.map) return null;

    const polyline = L.polyline(coordinates, {
      color: options.color || '#3b82f6',
      weight: options.weight || 4,
      opacity: options.opacity || 0.8,
      dashArray: options.dashed ? '10, 10' : null
    });

    polyline.addTo(this.layers.routes);

    if (options.fitBounds) {
      this.map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
    }

    return polyline;
  }

  /**
   * Limpia una capa específica
   */
  clearLayer(layerName) {
    if (this.layers[layerName]) {
      this.layers[layerName].clearLayers();
    }
    return this;
  }

  /**
   * Ajusta el mapa para mostrar todas las parcelas
   */
  fitToParcels() {
    if (this.layers.parcels && this.layers.parcels.getLayers().length > 0) {
      this.map.fitBounds(this.layers.parcels.getBounds(), { padding: [30, 30] });
    }
    return this;
  }

  /**
   * Ajusta el mapa para mostrar todos los marcadores
   */
  fitToMarkers() {
    if (this.layers.markers && this.layers.markers.getLayers().length > 0) {
      this.map.fitBounds(this.layers.markers.getBounds(), { padding: [30, 30] });
    }
    return this;
  }

  /**
   * Centra el mapa en una ubicación
   */
  setCenter(lat, lng, zoom) {
    if (this.map) {
      this.map.setView([lat, lng], zoom || this.options.zoom);
    }
    return this;
  }

  /**
   * Re-renderiza el mapa (útil cuando el contenedor cambia de tamaño)
   */
  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize();
    }
    return this;
  }

  /**
   * Destruye el mapa
   */
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  /**
   * Obtiene la altitud (msnm) de una coordenada usando Open-Meteo Elevation API
   * @param {number} lat - Latitud
   * @param {number} lng - Longitud
   * @returns {Promise<number|null>} Altitud en metros sobre el nivel del mar
   */
  static async getElevation(lat, lng) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
      if (!res.ok) throw new Error('Elevation API error');
      const data = await res.json();
      const elevation = data.elevation?.[0];
      return elevation != null ? Math.round(elevation) : null;
    } catch (err) {
      console.warn('Error al obtener altitud:', err.message);
      return null;
    }
  }
}
