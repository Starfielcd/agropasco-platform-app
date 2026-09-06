/**
 * AgroPasco — Servicio de Cálculo de Rutas
 * OSRM (gratuito) con fallback a Google Routes API
 * Ubicación: /services/maps/routing.js
 */

const RoutingService = {

  /**
   * Calcula la ruta entre dos o más puntos
   * @param {Array} waypoints - Array de {lat, lng} con al menos 2 puntos
   * @param {string} profile - Perfil de ruta: 'driving' | 'cycling' | 'walking'
   * @returns {Promise<Object>} Ruta con geometría, distancia y duración
   */
  async calculateRoute(waypoints, profile = 'driving') {
    if (!waypoints || waypoints.length < 2) {
      return { success: false, error: 'Se necesitan al menos 2 puntos para calcular ruta.' };
    }

    try {
      if (MapsConfig.API_KEY && MapsConfig.PROVIDER === 'google') {
        return await this._googleRoute(waypoints, profile);
      }
      return await this._osrmRoute(waypoints, profile);
    } catch (err) {
      console.error('RoutingService: Error al calcular ruta:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Calcula ruta optimizada para múltiples paradas (TSP)
   * @param {Object} origin - {lat, lng}
   * @param {Array} stops - Array de {lat, lng, name}
   * @param {Object} destination - {lat, lng} (opcional, si es diferente al origen)
   * @returns {Promise<Object>} Ruta optimizada con orden de paradas
   */
  async optimizeRoute(origin, stops, destination = null) {
    if (!stops || stops.length === 0) {
      return { success: false, error: 'Se necesita al menos una parada.' };
    }

    try {
      return await this._osrmTrip(origin, stops, destination);
    } catch (err) {
      console.error('RoutingService: Error al optimizar ruta:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Dibuja la ruta en un AgroMap
   * @param {AgroMap} agroMap - Instancia de AgroMap
   * @param {Object} routeData - Resultado de calculateRoute
   * @param {Object} options - Opciones de visualización
   */
  drawRouteOnMap(agroMap, routeData, options = {}) {
    if (!routeData.success || !routeData.geometry) return;

    agroMap.clearLayer('routes');

    // Dibujar la polilínea de la ruta
    const routeLine = agroMap.drawRoute(routeData.geometry, {
      color: options.color || '#3b82f6',
      weight: options.weight || 5,
      fitBounds: true
    });

    // Agregar marcadores de inicio y fin
    const first = routeData.geometry[0];
    const last = routeData.geometry[routeData.geometry.length - 1];

    agroMap.addMarker(first[0], first[1], {
      icon: '🚛',
      popup: `<strong>Inicio</strong><br>${options.originName || 'Punto de partida'}`,
      className: 'route-start-marker'
    });

    agroMap.addMarker(last[0], last[1], {
      icon: '🏢',
      popup: `<strong>Destino</strong><br>${options.destName || 'Centro de distribución'}`,
      className: 'route-end-marker'
    });

    // Marcadores de paradas intermedias
    if (routeData.waypoints) {
      routeData.waypoints.forEach((wp, i) => {
        if (i > 0 && i < routeData.waypoints.length - 1) {
          agroMap.addMarker(wp.lat, wp.lng, {
            icon: '📦',
            popup: `<strong>Parada ${i}</strong><br>${wp.name || 'Punto de recogida'}`,
            className: 'route-stop-marker'
          });
        }
      });
    }

    return routeLine;
  },

  // ===== OSRM (GRATUITO) =====

  async _osrmRoute(waypoints, profile) {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const osrmProfile = profile === 'cycling' ? 'bike' : profile === 'walking' ? 'foot' : 'car';
    const url = `${MapsConfig.OSRM_BASE}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&steps=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.length) {
      return { success: false, error: 'No se pudo calcular la ruta.' };
    }

    const route = data.routes[0];
    return {
      success: true,
      distance: route.distance, // metros
      distanceKm: (route.distance / 1000).toFixed(1),
      duration: route.duration, // segundos
      durationMin: Math.round(route.duration / 60),
      durationText: this._formatDuration(route.duration),
      geometry: route.geometry.coordinates.map(c => [c[1], c[0]]), // [lat, lng]
      steps: route.legs?.flatMap(leg => leg.steps?.map(s => ({
        instruction: s.maneuver?.type,
        name: s.name,
        distance: s.distance,
        duration: s.duration
      })) || []),
      waypoints: data.waypoints?.map(w => ({
        lat: w.location[1],
        lng: w.location[0],
        name: w.name
      })),
      source: 'OSRM'
    };
  },

  async _osrmTrip(origin, stops, destination) {
    const allPoints = [origin, ...stops, ...(destination ? [destination] : [])];
    const coords = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
    const roundtrip = destination ? 'false' : 'true';
    const source = 'first';
    const dest = destination ? 'last' : 'any';
    const url = `${MapsConfig.OSRM_BASE}/trip/v1/driving/${coords}?overview=full&geometries=geojson&roundtrip=${roundtrip}&source=${source}&destination=${dest}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM Trip HTTP ${res.status}`);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.trips?.length) {
      return { success: false, error: 'No se pudo optimizar la ruta.' };
    }

    const trip = data.trips[0];
    return {
      success: true,
      distance: trip.distance,
      distanceKm: (trip.distance / 1000).toFixed(1),
      duration: trip.duration,
      durationMin: Math.round(trip.duration / 60),
      durationText: this._formatDuration(trip.duration),
      geometry: trip.geometry.coordinates.map(c => [c[1], c[0]]),
      optimizedOrder: data.waypoints?.map(w => w.waypoint_index),
      waypoints: data.waypoints?.map((w, i) => ({
        lat: w.location[1],
        lng: w.location[0],
        name: allPoints[i]?.name || `Punto ${i + 1}`,
        originalIndex: i,
        optimizedIndex: w.waypoint_index
      })),
      source: 'OSRM'
    };
  },

  // ===== GOOGLE ROUTES (OPCIONAL) =====

  async _googleRoute(waypoints, profile) {
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.slice(1, -1);

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${MapsConfig.API_KEY}&language=es&mode=${profile}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Directions HTTP ${res.status}`);
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      return { success: false, error: data.status };
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      success: true,
      distance: leg.distance?.value || 0,
      distanceKm: ((leg.distance?.value || 0) / 1000).toFixed(1),
      duration: leg.duration?.value || 0,
      durationMin: Math.round((leg.duration?.value || 0) / 60),
      durationText: leg.duration?.text || '',
      geometry: this._decodeGooglePolyline(route.overview_polyline?.points || ''),
      source: 'Google Routes API'
    };
  },

  _decodeGooglePolyline(encoded) {
    const points = [];
    let lat = 0, lng = 0, index = 0;
    while (index < encoded.length) {
      let shift = 0, result = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  },

  _formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    if (hours === 0) return `${mins} min`;
    return `${hours}h ${mins}min`;
  }
};
