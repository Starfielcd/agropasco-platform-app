/**
 * AgroPasco — Servicio de Geocodificación
 * Nominatim (gratuito) con fallback a Google Geocoding API
 * Ubicación: /services/maps/geocoding.js
 */

const GeocodingService = {

  /**
   * Geocodificación inversa: coordenadas → dirección
   * @param {number} lat - Latitud
   * @param {number} lng - Longitud
   * @returns {Promise<Object>} Dirección y detalles
   */
  async reverseGeocode(lat, lng) {
    try {
      // Usar Google si hay API key configurada
      if (MapsConfig.API_KEY && MapsConfig.PROVIDER === 'google') {
        return await this._googleReverseGeocode(lat, lng);
      }
      // Nominatim (gratuito, por defecto)
      return await this._nominatimReverseGeocode(lat, lng);
    } catch (err) {
      console.error('GeocodingService: Error en geocodificación inversa:', err);
      return { success: false, error: err.message, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }
  },

  /**
   * Geocodificación directa: dirección → coordenadas
   * @param {string} address - Dirección o nombre de lugar
   * @returns {Promise<Object>} Coordenadas y detalles
   */
  async forwardGeocode(address) {
    try {
      if (MapsConfig.API_KEY && MapsConfig.PROVIDER === 'google') {
        return await this._googleForwardGeocode(address);
      }
      return await this._nominatimForwardGeocode(address);
    } catch (err) {
      console.error('GeocodingService: Error en geocodificación directa:', err);
      return { success: false, error: err.message };
    }
  },

  // ===== NOMINATIM (GRATUITO) =====

  async _nominatimReverseGeocode(lat, lng) {
    const url = `${MapsConfig.NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=es`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgroPasco-Platform/1.0' }
    });

    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();

    return {
      success: true,
      address: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      details: {
        road: data.address?.road,
        village: data.address?.village || data.address?.town,
        city: data.address?.city,
        state: data.address?.state,
        country: data.address?.country,
        postcode: data.address?.postcode
      },
      source: 'Nominatim/OSM'
    };
  },

  async _nominatimForwardGeocode(address) {
    const query = encodeURIComponent(address + ', Pasco, Peru');
    const url = `${MapsConfig.NOMINATIM_BASE}/search?format=json&q=${query}&limit=5&addressdetails=1&accept-language=es`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgroPasco-Platform/1.0' }
    });

    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();

    if (!data.length) {
      return { success: false, error: 'No se encontraron resultados.' };
    }

    return {
      success: true,
      results: data.map(r => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        address: r.display_name,
        type: r.type
      })),
      source: 'Nominatim/OSM'
    };
  },

  // ===== GOOGLE GEOCODING (OPCIONAL, requiere API key) =====

  async _googleReverseGeocode(lat, lng) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${MapsConfig.API_KEY}&language=es`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
    const data = await res.json();

    if (data.status !== 'OK' || !data.results?.length) {
      return { success: false, error: data.status, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }

    return {
      success: true,
      address: data.results[0].formatted_address,
      details: {
        place_id: data.results[0].place_id,
        types: data.results[0].types
      },
      source: 'Google Geocoding API'
    };
  },

  async _googleForwardGeocode(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MapsConfig.API_KEY}&language=es&region=pe`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
    const data = await res.json();

    if (data.status !== 'OK' || !data.results?.length) {
      return { success: false, error: data.status };
    }

    return {
      success: true,
      results: data.results.map(r => ({
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        address: r.formatted_address,
        type: r.types?.[0]
      })),
      source: 'Google Geocoding API'
    };
  }
};
