/**
 * AgroPasco — Servicio de Georreferenciación y Clasificación Territorial de Pasco (Frontend)
 * =========================================================================================
 * Clasifica rigurosamente coordenadas de parcelas en las 3 provincias oficiales de Pasco:
 *  1. Provincia de Pasco
 *  2. Provincia Daniel Alcides Carrión
 *  3. Provincia de Oxapampa
 *
 * Sin asignar provincias basadas en altitud ni en coincidencias falsas como 'paucar' en 'paucartambo'.
 */

const PascoAdminGeo = (function() {
  const PASCO_PROVINCES = {
    pasco: {
      name: 'Pasco',
      fullName: 'Provincia de Pasco',
      districts: ['Chaupimarca', 'Yanacancha', 'Tinyahuarco', 'Simón Bolívar', 'Huayllay', 'Vicco', 'Ninacaca', 'Paucartambo', 'Huariaca', 'Huachón', 'Pallanchacra', 'San Francisco de Asís de Yarusyacán', 'Ticlacayán']
    },
    carrion: {
      name: 'Daniel Alcides Carrión',
      fullName: 'Provincia Daniel Alcides Carrión',
      districts: ['Yanahuanca', 'Chacayán', 'Goyllarisquizga', 'Páucar', 'San Pedro de Pillao', 'Santa Ana de Tusi', 'Tápuc', 'Vilcabamba']
    },
    oxapampa: {
      name: 'Oxapampa',
      fullName: 'Provincia de Oxapampa',
      districts: ['Oxapampa', 'Chontabamba', 'Huancabamba', 'Palcazú', 'Pozuzo', 'Puerto Bermúdez', 'Villa Rica', 'Constitución']
    }
  };

  /**
   * Determina la provincia oficial a partir de latitud y longitud.
   */
  function classifyProvince(lat, lng) {
    const nLat = Number(lat);
    const nLng = Number(lng);

    if (isNaN(nLat) || isNaN(nLng)) {
      return { province: null, label: 'Ubicación administrativa por verificar', isVerified: false };
    }

    // Fuera de envoltura de Pasco
    if (nLat > -9.40 || nLat < -11.35 || nLng > -74.00 || nLng < -76.85) {
      return { province: null, label: 'Ubicación fuera del ámbito de la Región Pasco', isVerified: false };
    }

    // 1. Sector Oriental: Selva Alta / Oxapampa
    if (nLng >= -75.76) {
      // Ajuste franja limítrofe Paucartambo vs Oxapampa
      if (nLng < -75.72 && nLat <= -10.65 && nLat >= -10.85) {
        const dPaucar = Math.hypot(nLat - (-10.7719), nLng - (-75.8236));
        const dVilla = Math.hypot(nLat - (-10.7389), nLng - (-75.2722));
        if (dPaucar < dVilla) {
          return { province: 'Pasco', label: 'Provincia de Pasco', isVerified: true };
        }
      }
      return { province: 'Oxapampa', label: 'Provincia de Oxapampa', isVerified: true };
    }

    // 2. Sector Occidental Sur/Central: Provincia de Pasco (Cerro de Pasco, Yanacancha, Huayllay, etc.)
    if (nLat <= -10.60) {
      return { province: 'Pasco', label: 'Provincia de Pasco', isVerified: true };
    }

    // 3. Sector Noroccidental: Daniel Alcides Carrión (Yanahuanca, etc.) vs Huallaga Alto (Huariaca, Pasco)
    if (nLng <= -76.33) {
      return { province: 'Daniel Alcides Carrión', label: 'Provincia Daniel Alcides Carrión', isVerified: true };
    } else {
      return { province: 'Pasco', label: 'Provincia de Pasco', isVerified: true };
    }
  }

  /**
   * Extrae centroide de un GeoJSON
   */
  function extractCentroid(geoJson) {
    if (!geoJson) return null;
    try {
      const geo = typeof geoJson === 'string' ? JSON.parse(geoJson) : geoJson;
      let coords = null;
      if (geo.type === 'Polygon' && Array.isArray(geo.coordinates?.[0])) coords = geo.coordinates[0];
      else if (geo.type === 'Feature' && geo.geometry?.coordinates?.[0]) coords = geo.geometry.coordinates[0];
      else if (Array.isArray(geo) && geo.length > 0) coords = geo;

      if (coords && coords.length > 0) {
        let sumLat = 0, sumLng = 0, count = 0;
        for (const pt of coords) {
          const lat = Array.isArray(pt) ? Number(pt[1]) : Number(pt.lat ?? pt.latitude);
          const lng = Array.isArray(pt) ? Number(pt[0]) : Number(pt.lng ?? pt.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            sumLat += lat;
            sumLng += lng;
            count++;
          }
        }
        if (count > 0) {
          return { latitude: Number((sumLat / count).toFixed(6)), longitude: Number((sumLng / count).toFixed(6)) };
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Resuelve la localización de la parcela compartida entre módulos.
   */
  function resolveParcelLocation(parcel) {
    if (!parcel) return { province: null, label: 'Ubicación administrativa por verificar', isVerified: false };

    let lat = Number(parcel.latitude ?? parcel.center_lat);
    let lng = Number(parcel.longitude ?? parcel.center_lng);

    if ((isNaN(lat) || isNaN(lng)) && parcel.geo_json) {
      const c = extractCentroid(parcel.geo_json);
      if (c) { lat = c.latitude; lng = c.longitude; }
    }

    if (isNaN(lat) || isNaN(lng)) {
      // Fallback a campos textuales explícitos
      const text = ((parcel.farmer_location || '') + ' ' + (parcel.notes || '') + ' ' + (parcel.name || '')).toLowerCase();
      if (text.includes('oxapampa') || text.includes('villa rica') || text.includes('pozuzo')) {
        return { province: 'Oxapampa', label: 'Provincia de Oxapampa', isVerified: false };
      }
      if (text.includes('yanahuanca') || text.includes('chacayán') || text.includes('tusi') || text.includes('tapuc')) {
        return { province: 'Daniel Alcides Carrión', label: 'Provincia Daniel Alcides Carrión', isVerified: false };
      }
      if (text.includes('cerro de pasco') || text.includes('chaupimarca') || text.includes('yanacancha') || text.includes('paucartambo')) {
        return { province: 'Pasco', label: 'Provincia de Pasco', isVerified: false };
      }
      return { province: null, label: 'Ubicación administrativa por verificar', isVerified: false };
    }

    const res = classifyProvince(lat, lng);
    return {
      province: res.province,
      label: res.label,
      isVerified: res.isVerified,
      latitude: lat,
      longitude: lng,
      altitude: parcel.altitude_masl || parcel.altitude || null
    };
  }

  return {
    PASCO_PROVINCES,
    classifyProvince,
    extractCentroid,
    resolveParcelLocation
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PascoAdminGeo;
}
