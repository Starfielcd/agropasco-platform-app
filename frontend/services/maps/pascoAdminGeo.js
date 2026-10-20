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
    const provKey = res.province === 'Oxapampa' ? 'oxapampa' : (res.province === 'Daniel Alcides Carrión' ? 'carrion' : (res.province === 'Pasco' ? 'pasco' : null));
    let nearestDist = null;
    if (provKey) {
      nearestDist = resolveNearestDistrict(lat, lng, provKey);
    }

    return {
      province: res.province,
      district: nearestDist?.name || null,
      label: nearestDist?.name ? `Distrito de ${nearestDist.name}, Prov. ${res.province}` : res.label,
      isVerified: res.isVerified,
      latitude: lat,
      longitude: lng,
      altitude: parcel.altitude_masl || parcel.altitude || null
    };
  }

  const DISTRICT_CENTERS = {
    pasco: [
      { name: 'Chaupimarca', lat: -10.6868, lng: -76.2625 },
      { name: 'Yanacancha', lat: -10.6625, lng: -76.2486 },
      { name: 'Tinyahuarco', lat: -10.7411, lng: -76.2731 },
      { name: 'Simón Bolívar', lat: -10.7225, lng: -76.3214 },
      { name: 'Huayllay', lat: -11.0036, lng: -76.3353 },
      { name: 'Vicco', lat: -10.9525, lng: -76.2417 },
      { name: 'Ninacaca', lat: -10.8617, lng: -76.1219 },
      { name: 'Paucartambo', lat: -10.7719, lng: -75.8236 },
      { name: 'Huariaca', lat: -10.4358, lng: -76.1856 },
      { name: 'Huachón', lat: -10.6289, lng: -75.9722 },
      { name: 'Pallanchacra', lat: -10.5139, lng: -76.2139 },
      { name: 'San Francisco de Asís de Yarusyacán', lat: -10.5519, lng: -76.2081 },
      { name: 'Ticlacayán', lat: -10.5317, lng: -76.0822 }
    ],
    carrion: [
      { name: 'Yanahuanca', lat: -10.4931, lng: -76.5133 },
      { name: 'Chacayán', lat: -10.4722, lng: -76.4319 },
      { name: 'Goyllarisquizga', lat: -10.5056, lng: -76.4444 },
      { name: 'Páucar', lat: -10.3750, lng: -76.4889 },
      { name: 'San Pedro de Pillao', lat: -10.4500, lng: -76.5833 },
      { name: 'Santa Ana de Tusi', lat: -10.4611, lng: -76.3556 },
      { name: 'Tápuc', lat: -10.4250, lng: -76.4833 },
      { name: 'Vilcabamba', lat: -10.4528, lng: -76.5250 }
    ],
    oxapampa: [
      { name: 'Oxapampa', lat: -10.5750, lng: -75.4028 },
      { name: 'Chontabamba', lat: -10.6083, lng: -75.4528 },
      { name: 'Huancabamba', lat: -10.4056, lng: -75.5528 },
      { name: 'Palcazú', lat: -10.2000, lng: -75.1500 },
      { name: 'Pozuzo', lat: -10.0722, lng: -75.5528 },
      { name: 'Puerto Bermúdez', lat: -10.3000, lng: -74.9333 },
      { name: 'Villa Rica', lat: -10.7389, lng: -75.2722 },
      { name: 'Constitución', lat: -9.8500, lng: -75.0167 }
    ]
  };

  function resolveNearestDistrict(lat, lng, provKey) {
    const list = DISTRICT_CENTERS[provKey];
    if (!list || list.length === 0) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const d of list) {
      const dist = Math.hypot(lat - d.lat, lng - d.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = d;
      }
    }
    return {
      name: nearest?.name || null,
      distanceKm: Math.round(minDist * 111),
      isExact: minDist < 0.12
    };
  }

  /**
   * Identifica provincia y distrito para el monitor ML y paneles
   */
  function identifyProvinceDistrict(lat, lng, parcelName = '') {
    const pRes = classifyProvince(lat, lng);
    if (!pRes.isVerified || !pRes.province) {
      return {
        province: pRes.province || 'Ubicación por verificar',
        district: null,
        label: pRes.label || 'Ubicación administrativa por verificar',
        isVerified: false
      };
    }

    const provKey = pRes.province === 'Oxapampa' ? 'oxapampa' : (pRes.province === 'Daniel Alcides Carrión' ? 'carrion' : 'pasco');
    const pName = (parcelName || '').toLowerCase();

    // Comprobar coincidencia explícita con nombre de distrito en parcelName
    let matchedDist = null;
    const distList = DISTRICT_CENTERS[provKey] || [];
    for (const d of distList) {
      if (pName.includes(d.name.toLowerCase())) {
        matchedDist = d.name;
        break;
      }
    }

    if (!matchedDist) {
      const nearest = resolveNearestDistrict(Number(lat), Number(lng), provKey);
      if (nearest?.name) {
        matchedDist = nearest.name;
      }
    }

    return {
      province: pRes.province,
      district: matchedDist,
      label: matchedDist ? `${matchedDist}, Prov. ${pRes.province}` : `Prov. ${pRes.province}`,
      isVerified: true
    };
  }

  return {
    PASCO_PROVINCES,
    classifyProvince,
    extractCentroid,
    resolveParcelLocation,
    resolveNearestDistrict,
    identifyProvinceDistrict
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PascoAdminGeo;
}
