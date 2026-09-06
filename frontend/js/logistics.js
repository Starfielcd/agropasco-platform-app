/**
 * AgroPasco — Módulo de Logística (Supermercado)
 * Rutas de recogida, trazabilidad con mapa, inventario
 */

let logisticsMap = null;

async function renderLogisticsPage() {
  const productsRes = await api.getProducts();
  const products = productsRes.data || [];

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🚛 Rutas de Recogida</h3>
          <p class="text-sm text-muted">Optimiza las rutas desde los campos hasta tu centro de distribución.</p>
        </div>
        <button class="btn btn-primary" onclick="calculatePickupRoute()">📍 Calcular Ruta Óptima</button>
      </div>

      <!-- Mapa de Rutas -->
      <div class="card mb-lg" style="padding: 0; overflow: hidden;">
        <div id="logistics-map" class="map-container" style="height: 450px; width: 100%;"></div>
      </div>

      <!-- Resultado de la Ruta -->
      <div id="route-result" class="card mb-lg" style="display: none; border-left: 4px solid var(--blue-500);">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">🗺️</span> Ruta Calculada</div>
        </div>
        <div class="stats-grid">
          <div class="stat-card" style="--stat-color: var(--blue-500)">
            <div class="stat-card-icon">📏</div>
            <div class="stat-card-value" id="route-distance">--</div>
            <div class="stat-card-label">Distancia Total</div>
          </div>
          <div class="stat-card" style="--stat-color: var(--amber-500)">
            <div class="stat-card-icon">⏱️</div>
            <div class="stat-card-value" id="route-duration">--</div>
            <div class="stat-card-label">Tiempo Estimado</div>
          </div>
          <div class="stat-card" style="--stat-color: var(--green-500)">
            <div class="stat-card-icon">📦</div>
            <div class="stat-card-value" id="route-stops">--</div>
            <div class="stat-card-label">Paradas</div>
          </div>
        </div>
      </div>

      <!-- Config de puntos -->
      <div class="card mb-lg">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">📍</span> Puntos de Recogida</div>
        </div>
        <div class="form-group">
          <label class="form-label">Centro de Distribución (destino)</label>
          <div class="form-row">
            <input type="number" class="form-input" id="dest-lat" step="0.0001" value="-10.6868" placeholder="Latitud">
            <input type="number" class="form-input" id="dest-lng" step="0.0001" value="-76.2625" placeholder="Longitud">
          </div>
        </div>
        <div id="pickup-points-list">
          <p class="text-sm text-muted">Los puntos de recogida se obtienen de las parcelas registradas con productos disponibles.</p>
        </div>
      </div>
    </div>
  `;
}

async function renderInventoryPage() {
  const productsRes = await api.getProducts();
  const products = productsRes.data || [];

  const totalStock = products.reduce((s, p) => s + (p.stock_kg || 0), 0);
  const totalValue = products.reduce((s, p) => s + ((p.stock_kg || 0) * (p.price_per_kg || 0)), 0);
  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡' };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">📦 Gestión de Inventario</h3>
          <p class="text-sm text-muted">Control de stock y ofertas de productos certificados.</p>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid mb-lg">
        <div class="stat-card" style="--stat-color: var(--green-500)">
          <div class="stat-card-icon">📦</div>
          <div class="stat-card-value">${products.length}</div>
          <div class="stat-card-label">Productos en Catálogo</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--blue-500)">
          <div class="stat-card-icon">⚖️</div>
          <div class="stat-card-value">${totalStock.toLocaleString()} kg</div>
          <div class="stat-card-label">Stock Total</div>
        </div>
        <div class="stat-card" style="--stat-color: var(--amber-500)">
          <div class="stat-card-icon">💰</div>
          <div class="stat-card-value">S/ ${totalValue.toLocaleString('es-PE', {minimumFractionDigits: 0})}</div>
          <div class="stat-card-label">Valor Total Estimado</div>
        </div>
      </div>

      <!-- Tabla de Inventario -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-title-icon">📋</span> Detalle de Inventario</div>
        </div>
        ${products.length > 0 ? `
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Calidad</th>
                  <th>Stock (kg)</th>
                  <th>Precio/kg</th>
                  <th>Origen</th>
                  <th>Trazabilidad</th>
                </tr>
              </thead>
              <tbody>
                ${products.map(p => `
                  <tr>
                    <td style="font-weight: 600;">${cropIcons[p.crop_type] || '🌾'} ${p.name}</td>
                    <td>${p.crop_type}</td>
                    <td><span class="badge badge-green">${p.quality}</span></td>
                    <td>${p.stock_kg || 0}</td>
                    <td>S/ ${p.price_per_kg?.toFixed(2)}</td>
                    <td>${p.origin || 'Pasco'}</td>
                    <td>
                      <span style="cursor: pointer; color: var(--blue-400);" onclick="viewProductTrace(${p.id})">
                        ${p.traceability_code || '—'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">📦</div>
            <div class="empty-state-title">Sin productos</div>
          </div>
        `}
      </div>
    </div>
  `;
}

// ===== MAPA DE LOGÍSTICA =====

function initLogisticsMap() {
  if (logisticsMap) { logisticsMap.destroy(); logisticsMap = null; }
  const container = document.getElementById('logistics-map');
  if (!container) return;

  logisticsMap = new AgroMap('logistics-map', {
    satellite: false,
    zoom: 10
  }).init();

  // Agregar marcador del centro de distribución
  logisticsMap.addMarker(
    parseFloat(document.getElementById('dest-lat')?.value) || -10.6868,
    parseFloat(document.getElementById('dest-lng')?.value) || -76.2625,
    {
      icon: '🏢',
      popup: '<strong>Centro de Distribución</strong><br>Cerro de Pasco',
      tooltip: 'Centro de Distribución'
    }
  );
}

async function calculatePickupRoute() {
  if (!logisticsMap) {
    initLogisticsMap();
    setTimeout(calculatePickupRoute, 500);
    return;
  }

  const destLat = parseFloat(document.getElementById('dest-lat')?.value) || -10.6868;
  const destLng = parseFloat(document.getElementById('dest-lng')?.value) || -76.2625;

  // Simular puntos de recogida de campos en la región Pasco
  const pickupPoints = [
    { lat: -10.4970, lng: -76.5100, name: 'Yanahuanca — Papa Huayro' },
    { lat: -10.8560, lng: -76.2360, name: 'Ninacaca — Maca Orgánica' },
    { lat: -10.7300, lng: -76.2800, name: 'Tinyahuarco — Quinua' },
    { lat: -10.5800, lng: -76.2000, name: 'Paucartambo — Habas' }
  ];

  showToast('Calculando ruta óptima...', 'info');

  const origin = { lat: destLat, lng: destLng };
  const result = await RoutingService.optimizeRoute(origin, pickupPoints, { lat: destLat, lng: destLng });

  if (result.success) {
    RoutingService.drawRouteOnMap(logisticsMap, result, {
      originName: 'Centro de Distribución',
      destName: 'Centro de Distribución (retorno)'
    });

    // Mostrar resultado
    document.getElementById('route-result').style.display = 'block';
    document.getElementById('route-distance').textContent = result.distanceKm + ' km';
    document.getElementById('route-duration').textContent = result.durationText;
    document.getElementById('route-stops').textContent = pickupPoints.length;

    // Marcadores de paradas
    pickupPoints.forEach((p, i) => {
      logisticsMap.addMarker(p.lat, p.lng, {
        icon: '📦',
        popup: `<strong>Parada ${i + 1}</strong><br>${p.name}`,
        tooltip: `${i + 1}. ${p.name}`
      });
    });

    showToast(`Ruta optimizada: ${result.distanceKm} km en ${result.durationText}`, 'success');
  } else {
    showToast('No se pudo calcular la ruta. Verifica los puntos.', 'error');
  }
}
