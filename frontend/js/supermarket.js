/**
 * AgroPasco — Módulo de Catálogo Supermercado y Validación
 * Conexión completa entre Agricultor, Asesor Técnico y Supermercado.
 */

// ==========================================
// 1. CATÁLOGO DEL SUPERMERCADO (ROL SUPERMERCADO & PÚBLICO)
// ==========================================

async function renderSupermarketPage() {
  const result = await api.getProducts();
  const products = result.data || [];
  const user = getUser();

  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡', mashua: '🟠' };
  const qualityColors = { primera: 'green', segunda: 'amber', gourmet: 'purple', organica: 'green', premium: 'blue' };

  window.activeSupermarketCategory = 'all';

  return `
    <div class="page-content supermarket-catalog-container">
      <!-- Encabezado Comercial Profesional -->
      <div class="supermarket-header-card">
        <div>
          <div class="supermarket-header-title">
            <span>🏪</span> Catálogo de Productos Certificados — Supermercado
          </div>
          <div class="supermarket-header-subtitle">
            Cosechas agrícolas de la Región Pasco validadas por asesores técnicos con trazabilidad digital y comercio justo.
          </div>
        </div>
        <div>
          <span class="badge badge-green" style="font-size: 13.5px; font-weight: 700; padding: 7px 16px; border-radius: 99px;">
            🛒 <span id="supermarket-count-badge">${products.length}</span> Productos Disponibles
          </span>
        </div>
      </div>

      <!-- Banner de Certificación y Origen Garantizado -->
      <div class="supermarket-cert-banner">
        <div class="supermarket-cert-info">
          <div class="supermarket-cert-icon">🛡️</div>
          <div>
            <div class="supermarket-cert-title">Garantía de Origen y Certificación AgroPasco</div>
            <div class="supermarket-cert-desc">
              Todos los lotes han sido verificados en campo por asesores agronómicos. Los productos catalogados como <strong>🌿 100% Natural</strong> cuentan con +30% de bonificación garantizada al agricultor por ausencia comprobada de agroquímicos sintéticos u hormonas.
            </div>
          </div>
        </div>
        <div class="supermarket-cert-tags">
          <span class="supermarket-cert-pill">🌿 100% Natural Certificado</span>
          <span class="supermarket-cert-pill">📋 Trazabilidad Digital</span>
          <span class="supermarket-cert-pill">🤝 Comercio Justo</span>
        </div>
      </div>

      <!-- Barra de Búsqueda y Filtros de Categorías -->
      <div class="supermarket-filter-bar">
        <div class="supermarket-search-box">
          <span style="font-size: 15px; color: #64748B;">🔍</span>
          <input type="text" id="supermarket-search-input" placeholder="Buscar por producto, variedad o procedencia..." oninput="window.filterSupermarketCatalog(this.value)">
        </div>
        <div class="supermarket-category-pills">
          <button type="button" class="supermarket-pill active" data-category="all" onclick="window.filterSupermarketCategory('all', this)">Todos (${products.length})</button>
          <button type="button" class="supermarket-pill" data-category="papa" onclick="window.filterSupermarketCategory('papa', this)">🥔 Papas Nativas</button>
          <button type="button" class="supermarket-pill" data-category="maca" onclick="window.filterSupermarketCategory('maca', this)">🌿 Maca</button>
          <button type="button" class="supermarket-pill" data-category="olluco" onclick="window.filterSupermarketCategory('olluco', this)">🟡 Olluco</button>
          <button type="button" class="supermarket-pill" data-category="habas" onclick="window.filterSupermarketCategory('habas', this)">🫘 Habas</button>
          <button type="button" class="supermarket-pill" data-category="quinua" onclick="window.filterSupermarketCategory('quinua', this)">🌾 Quinua</button>
          <button type="button" class="supermarket-pill" data-category="cafe" onclick="window.filterSupermarketCategory('cafe', this)">☕ Café</button>
        </div>
      </div>

      <!-- Grilla del Catálogo de Productos -->
      ${products.length > 0 ? `
        <div class="supermarket-grid" id="supermarket-products-grid">
          ${products.map(prod => {
            const isNatural = prod.is_natural || prod.certified_natural;
            const originalP = prod.original_price || (isNatural ? prod.price_per_kg / 1.30 : prod.price_per_kg);
            const photoSrc = (prod.photo_url && prod.photo_url.trim()) ? prod.photo_url.trim() : null;
            const originText = prod.origin || prod.farmer_location || 'Región Pasco';
            const farmerText = prod.farmer_name || 'Carlos (Agricultor de Pasco)';
            const searchIndex = `${prod.name} ${prod.crop_type} ${originText} ${farmerText} ${prod.quality || ''}`.toLowerCase();

            return `
              <div class="product-card" data-crop="${prod.crop_type}" data-search="${searchIndex}" onclick="showProductDetailModal(${prod.id})">
                <!-- Imagen Fotográfica o Fallback Botánico -->
                <div class="product-card-media">
                  ${photoSrc ? `
                    <img src="${photoSrc}" alt="${prod.name}" loading="lazy">
                  ` : `
                    <div class="product-card-media-fallback">
                      <div class="product-card-media-icon">${cropIcons[prod.crop_type] || '🌾'}</div>
                      <div class="product-card-media-label">${prod.crop_type || 'Cultivo Pasco'}</div>
                    </div>
                  `}

                  <!-- Badge 100% Natural / Convencional (Superior Izquierda) -->
                  <div class="product-badge-top-left">
                    ${isNatural ? `
                      <span class="badge badge-green" style="font-weight: 700; box-shadow: 0 2px 8px rgba(16,185,129,0.35); font-size: 11px;">
                        🌿 100% Natural (+30%)
                      </span>
                    ` : `
                      <span class="badge badge-blue" style="font-weight: 600; font-size: 11px;">
                        📦 Convencional
                      </span>
                    `}
                  </div>

                  <!-- Badge Calidad Comercial (Superior Derecha) -->
                  <div class="product-badge-top-right">
                    <span class="badge badge-${qualityColors[prod.quality] || 'green'}" style="text-transform: capitalize; font-size: 11px; font-weight: 700;">
                      ${prod.quality || 'Primera'}
                    </span>
                  </div>
                </div>

                <!-- Contenido Informativo y Comercial -->
                <div class="product-card-body">
                  <div class="product-card-title">
                    ${prod.name}
                  </div>

                  <div class="product-card-meta-row">
                    <span class="product-card-origin">
                      📍 ${originText}
                    </span>
                    <span class="product-card-farmer">
                      👨‍🌾 ${farmerText}
                    </span>
                  </div>

                  <!-- Descripción resumida -->
                  <p class="product-card-desc">
                    ${prod.description || 'Producto agrícola cultivado en los valles andinos de Pasco bajo buenas prácticas agrícolas e inspección técnica.'}
                  </p>

                  <!-- Validación del Asesor Técnico -->
                  <div class="product-card-validation">
                    <span class="product-card-validation-label">
                      ✅ Validado por Asesor
                    </span>
                    <span class="product-card-validation-badge">
                      ${prod.validator_name ? prod.validator_name : 'Ing. Asesor Certificado'}
                    </span>
                  </div>

                  <!-- Footer con Precio Prominente y Stock -->
                  <div class="product-card-footer">
                    <div class="product-price-section">
                      <div class="product-price-amount">
                        S/ ${prod.price_per_kg?.toFixed(2)}
                        <span class="product-price-unit">/ ${prod.unit || 'kg'}</span>
                      </div>
                      ${isNatural && originalP ? `
                        <div class="product-price-subtext">
                          Base S/ ${originalP.toFixed(2)} + 30% bonif.
                        </div>
                      ` : ''}
                    </div>

                    <div class="product-stock-section">
                      <span class="product-stock-badge">
                        ${prod.stock_kg || 0} ${prod.unit || 'kg'} disp.
                      </span>
                    </div>
                  </div>

                  <!-- Botón Funcional Ficha Completa -->
                  <button type="button" class="product-action-btn" onclick="event.stopPropagation(); showProductDetailModal(${prod.id})">
                    Ver Ficha Completa →
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="empty-state card" style="padding: 48px; text-align: center;">
          <div class="empty-state-icon" style="font-size: 48px;">📦</div>
          <h4 class="empty-state-title" style="margin: 12px 0 6px;">No hay productos validados en el catálogo</h4>
          <p class="empty-state-text text-muted">
            Los agricultores están preparando sus cosechas. En cuanto el Asesor Técnico valide las prácticas agrícolas, los productos aparecerán automáticamente aquí.
          </p>
        </div>
      `}
    </div>
  `;
}

// Controladores de Filtrado y Búsqueda en Vivo
window.filterSupermarketCatalog = function(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll('#supermarket-products-grid .product-card');
  let visible = 0;
  cards.forEach(card => {
    const text = (card.getAttribute('data-search') || '').toLowerCase();
    const crop = card.getAttribute('data-crop');
    const matchesQuery = !q || text.includes(q);
    const matchesCat = !window.activeSupermarketCategory || window.activeSupermarketCategory === 'all' || crop === window.activeSupermarketCategory;
    if (matchesQuery && matchesCat) {
      card.style.display = 'flex';
      visible++;
    } else {
      card.style.display = 'none';
    }
  });
  const countEl = document.getElementById('supermarket-count-badge');
  if (countEl) countEl.textContent = visible;
};

window.filterSupermarketCategory = function(cat, btn) {
  window.activeSupermarketCategory = cat;
  document.querySelectorAll('.supermarket-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const input = document.getElementById('supermarket-search-input');
  window.filterSupermarketCatalog(input ? input.value : '');
};

// ==========================================
// 2. MODAL DETALLADO DE PRODUCTO (SUPERMERCADO / CATÁLOGO)
// ==========================================

async function showProductDetailModal(productId) {
  const result = await api.getProduct(productId);
  if (!result.success || !result.data) {
    showToast('Error al cargar la ficha del producto', 'error');
    return;
  }

  const prod = result.data;
  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡', mashua: '🟠' };
  const photoSrc = (prod.photo_url && prod.photo_url.trim()) ? prod.photo_url.trim() : null;
  const isNatural = prod.is_natural || prod.certified_natural;
  const originalPrice = prod.original_price || (isNatural ? prod.price_per_kg / 1.30 : prod.price_per_kg);
  const naturalBonus = isNatural ? (prod.price_per_kg - originalPrice) : 0;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'product-detail-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'product-detail-title');

  const closeDetailModal = () => {
    window.removeEventListener('keydown', handleEsc);
    modal.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeDetailModal();
  };
  window.addEventListener('keydown', handleEsc);

  modal.onclick = (e) => { if (e.target === modal) closeDetailModal(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto; background: #FFFFFF; color: #0F172A;" onclick="event.stopPropagation()">
      <div class="modal-header" style="border-bottom: 1px solid #E2E8F0; padding-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">${cropIcons[prod.crop_type] || '🌾'}</span>
          <div>
            <h3 id="product-detail-title" style="margin: 0; font-size: 20px; font-weight: 800; color: #0F172A;">${prod.name}</h3>
            <span class="text-xs" style="color: #64748B;">Código Trazabilidad: <strong>${prod.traceability_code || 'AP-PASCO-2026'}</strong></span>
          </div>
        </div>
        <button class="modal-close" aria-label="Cerrar modal" onclick="document.getElementById('product-detail-modal')?.remove()">✕</button>
      </div>

      <!-- Badges Superiores -->
      <div style="display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap;">
        <span class="badge badge-green" style="text-transform: capitalize; font-weight: 700;">Calidad: ${prod.quality || 'Primera'}</span>
        ${isNatural ? `
          <span class="badge badge-green" style="font-weight: 700; padding: 4px 10px;">
            🌿 Certificación: 100% Natural (+30%)
          </span>
        ` : `
          <span class="badge badge-blue">📦 Cultivo Convencional</span>
        `}
        <span class="badge badge-purple">✅ Validado para Supermercado</span>
      </div>

      <!-- Foto del Producto -->
      ${photoSrc ? `
        <div style="margin-bottom: 16px; border-radius: 12px; overflow: hidden; max-height: 280px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
          <img src="${photoSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${prod.name}">
        </div>
      ` : `
        <div style="margin-bottom: 16px; border-radius: 12px; padding: 24px; text-align: center; background: linear-gradient(135deg, rgba(34,197,94,0.1), rgba(59,130,246,0.1)); border: 1px solid #E2E8F0;">
          <div style="font-size: 54px;">${cropIcons[prod.crop_type] || '🌾'}</div>
          <div class="text-sm text-muted mt-sm">Producto certificado de la Región Pasco</div>
        </div>
      `}

      <!-- Descripción -->
      <div class="card mb-md" style="background: var(--bg-card); border-left: 4px solid var(--green-500);">
        <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px; color: var(--text-primary);">📝 Descripción del Producto:</div>
        <p class="text-sm text-muted" style="margin: 0; line-height: 1.5;">
          ${prod.description || 'Cosechado bajo altos estándares de calidad e inocuidad en la Región Pasco.'}
        </p>
      </div>

      <!-- DATOS DEL AGRICULTOR -->
      <div class="card mb-md" style="background: var(--bg-card);">
        <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
          <span>👨‍🌾</span> Datos del Productor / Agricultor
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; font-size: 13px;">
          <div style="padding: 8px; background: var(--bg-glass); border-radius: 6px;">
            <span class="text-muted" style="display: block; font-size: 11px;">Nombre Completo:</span>
            <strong>${prod.farmer_name || 'Agricultor Pasqueño'}</strong>
          </div>
          <div style="padding: 8px; background: var(--bg-glass); border-radius: 6px;">
            <span class="text-muted" style="display: block; font-size: 11px;">📍 Ubicación / Comunidad:</span>
            <strong>${prod.origin || prod.farmer_location || 'Región Pasco'}</strong>
          </div>
          <div style="padding: 8px; background: var(--bg-glass); border-radius: 6px;">
            <span class="text-muted" style="display: block; font-size: 11px;">📞 Contacto Directo:</span>
            <strong>${prod.farmer_phone || '+51 901387303'}</strong>
          </div>
          <div style="padding: 8px; background: var(--bg-glass); border-radius: 6px;">
            <span class="text-muted" style="display: block; font-size: 11px;">📅 Fecha de Cosecha:</span>
            <strong>${prod.harvest_date || new Date().toLocaleDateString('es-PE')}</strong>
          </div>
        </div>
      </div>

      <!-- VALIDACIÓN DEL ASESOR TÉCNICO -->
      <div class="card mb-md" style="background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.3);">
        <div style="font-weight: 700; font-size: 14px; color: var(--green-400); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>👨‍🔬</span> Dictamen de Validación Técnica
        </div>
        <div style="font-size: 13px; line-height: 1.5; margin-bottom: 10px;">
          <div><strong>Asesor Inspector:</strong> ${prod.validator_name || 'Ing. Agrónomo Asesor Técnico'}</div>
          ${prod.validated_at ? `<div><span class="text-muted">Fecha de Inspección:</span> ${new Date(prod.validated_at).toLocaleString('es-PE')}</div>` : ''}
          <div style="margin-top: 6px; padding: 8px; background: var(--bg-card); border-radius: 6px; font-style: italic;">
            "${prod.validation_notes || (isNatural ? 'Producto 100% natural, sin presencia de pesticidas químicos ni aceleradores hormonales. Certificado para supermercado con incremento del 30%.' : 'Producto verificado cumpliendo estándares de sanidad vegetal convencional.')}"
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="badge ${isNatural ? 'badge-green' : 'badge-blue'}">
            ${isNatural ? '🌿 100% Natural Certificado (Sin Químicos ni Hormonas)' : '📦 Cultivo Convencional Autorizado'}
          </span>
        </div>
      </div>

      <!-- PRECIO FINAL Y DESGLOSE COMPLETO -->
      <div style="background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(59,130,246,0.12)); border: 2px solid var(--green-500); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
              Precio Final de Venta al Supermercado:
            </div>
            <div style="font-size: 30px; font-weight: 900; color: #15803D;">
              S/ ${prod.price_per_kg?.toFixed(2)}
              <span style="font-size: 14px; font-weight: 600; color: #475569;">/ ${prod.unit || 'kg'}</span>
            </div>
            <div class="text-xs text-muted">Stock Disponible: <strong>${prod.stock_kg || 0} kg</strong></div>
          </div>

          <!-- Desglose si es 100% natural -->
          <div style="background: var(--bg-card); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); font-size: 12px; min-width: 220px;">
            <div style="font-weight: 700; margin-bottom: 6px; border-bottom: 1px solid var(--border); padding-bottom: 4px;">
              📊 Desglose de Liquidación:
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span>Precio Base Solicitado:</span>
              <span>S/ ${originalPrice.toFixed(2)}</span>
            </div>
            ${isNatural ? `
              <div style="display: flex; justify-content: space-between; color: var(--green-400); font-weight: 600; margin-bottom: 3px;">
                <span>+ Bonificación 100% Natural (+30%):</span>
                <span>+ S/ ${naturalBonus.toFixed(2)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; color: var(--text-muted); margin-bottom: 3px;">
                <span>Bonificación Natural:</span>
                <span>S/ 0.00 (Convencional)</span>
              </div>
            `}
            <div style="display: flex; justify-content: space-between; font-weight: 800; border-top: 1px dashed var(--border); padding-top: 4px; margin-top: 4px;">
              <span>Total por ${prod.unit || 'kg'}:</span>
              <span style="color: var(--green-400);">S/ ${prod.price_per_kg?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Acciones del Modal -->
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-secondary" style="flex: 1;" onclick="event.stopPropagation(); viewProductTrace(${prod.id})">
          📋 Ver Historial de Trazabilidad Digital
        </button>
        <button class="btn btn-primary" style="flex: 1;" onclick="handleSupermarketPurchaseOrder(${prod.id})">
          🛒 Generar Orden de Compra B2B
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function handleSupermarketPurchaseOrder(productId) {
  showToast('🛒 Orden de compra B2B generada exitosamente. Se notificó al agricultor para despacho.', 'success');
  document.getElementById('product-detail-modal')?.remove();
}

// ==========================================
// 3. VENTA DE PRODUCTOS (ROL AGRICULTOR)
// ==========================================

async function renderFarmerSalesPage() {
  const result = await api.getProducts();
  const user = getUser();
  const myProducts = (result.data || []).filter(p => p.farmer_id === user?.id || p.farmer_name === user?.name);

  const statusIcons = { pending: '⏳', approved: '✅', rejected: '❌' };
  const statusLabels = { pending: 'En Revisión Técnica', approved: 'Aprobado y en Catálogo', rejected: 'Rechazado' };
  const statusColors = { pending: 'amber', approved: 'green', rejected: 'red' };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
            💰 Mis Productos en Venta (${myProducts.length})
          </h2>
          <p class="text-sm text-muted">
            Ofrece tus cosechas directamente a los supermercados. El asesor técnico revisará tu historial de prácticas antes de publicarlo.
          </p>
        </div>
        <!-- Botón VENDER destacado -->
        <button class="btn btn-primary btn-lg" onclick="showPublishModal()" style="box-shadow: 0 4px 14px rgba(16,185,129,0.35); font-weight: 700;">
          💰 Vender Producto
        </button>
      </div>

      <!-- Banner Explicativo del Proceso de Venta -->
      <div class="card mb-lg" style="border-left: 4px solid var(--green-500); background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(59,130,246,0.05));">
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div style="font-size: 32px;">💡</div>
          <div style="font-size: 13px; line-height: 1.5;">
            <strong style="color: var(--green-400); font-size: 14px;">¿Cómo funciona la venta hacia el supermercado?</strong><br>
            1. Haces clic en <strong>"Vender Producto"</strong> con los datos de tu cosecha.<br>
            2. La solicitud pasa primero al <strong>Asesor Técnico</strong>, quien analiza tu cuaderno de campo.<br>
            3. Si el asesor certifica que tu cultivo es <strong>100% natural</strong> (sin químicos ni hormonas), <strong>¡tu precio aumentará automáticamente un +30%!</strong><br>
            4. Tu producto validado aparecerá en el <strong>Catálogo del Supermercado</strong> para su compra inmediata.
          </div>
        </div>
      </div>

      <!-- Listado de Productos del Agricultor -->
      ${myProducts.length > 0 ? `
        <div style="display: grid; gap: 14px;">
          ${myProducts.map(p => {
            const isApproved = p.validation_status === 'approved';
            const isNatural = p.is_natural || p.certified_natural;
            return `
              <div class="card" style="border-left: 4px solid var(--${statusColors[p.validation_status] || 'amber'}-500);">
                <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
                  <div style="font-size: 16px; font-weight: 700;">${p.name}</div>
                  <span class="badge badge-${statusColors[p.validation_status] || 'amber'}" style="font-size: 12px;">
                    ${statusIcons[p.validation_status] || '⏳'} ${statusLabels[p.validation_status] || 'En Revisión'}
                  </span>
                </div>

                <!-- Fotografía Original Subida por el Agricultor -->
                ${p.photo_url ? `
                  <div style="display: flex; align-items: center; gap: 12px; margin: 10px 0; padding: 10px 14px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 8px;">
                    <img src="${p.photo_url}" alt="${p.name}" style="width: 58px; height: 58px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid var(--border);"
                         onclick="AgroMediaUploader.previewEnlarged('${p.photo_url}', 'Foto Cosecha: ${p.name.replace(/'/g, "\\'")}')">
                    <div style="font-size: 12px; flex: 1;">
                      <div style="color: var(--green-400); font-weight: 700;">📸 Fotografía Original Registrada</div>
                      <div class="text-muted" style="margin-top: 2px;">Imagen auténtica de campo vinculada a la trazabilidad y visible para el supermercado.</div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px;"
                            onclick="AgroMediaUploader.previewEnlarged('${p.photo_url}', 'Foto Cosecha: ${p.name.replace(/'/g, "\\'")}')">
                      🔍 Ver
                    </button>
                  </div>
                ` : `
                  <div style="margin: 8px 0; font-size: 12px; color: var(--amber-400);">
                    📷 Sin fotografía adjunta. Puedes editar el producto para subir su foto original.
                  </div>
                `}

                <div style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; margin-bottom: 8px;">
                  <span>🌱 <strong>Cultivo:</strong> ${p.crop_type}</span>
                  <span>📍 <strong>Lugar:</strong> ${p.origin || 'Pasco'}</span>
                  <span>📦 <strong>Stock:</strong> ${p.stock_kg} kg</span>
                  <span style="font-weight: 700; color: var(--green-400);">
                    💰 S/ ${p.price_per_kg?.toFixed(2)} / ${p.unit || 'kg'}
                  </span>
                  ${isNatural ? `
                    <span class="badge badge-green">🌿 100% Natural (+30% Aplicado)</span>
                  ` : ''}
                </div>

                ${p.validation_notes ? `
                  <div style="padding: 10px; background: var(--bg-glass); border-radius: 6px; font-size: 12px; border-left: 3px solid var(--${statusColors[p.validation_status] || 'amber'}-400);">
                    <strong>Dictamen del Asesor:</strong> ${p.validation_notes}
                    ${p.validator_name ? `<span class="text-muted"> (por ${p.validator_name})</span>` : ''}
                  </div>
                ` : ''}

                <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
                  <button class="btn btn-secondary btn-sm" onclick="window.editFarmerProduct(${p.id})">
                    ✏️ Editar Producto / Foto
                  </button>
                  ${isApproved ? `
                    <button class="btn btn-primary btn-sm" onclick="showProductDetailModal(${p.id})">
                      👁️ Ver Ficha Pública en Supermercado
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="empty-state card" style="padding: 48px; text-align: center;">
          <div class="empty-state-icon" style="font-size: 48px;">🌾</div>
          <h4 class="empty-state-title" style="margin: 12px 0 6px;">No tienes productos en venta todavía</h4>
          <p class="empty-state-text text-muted mb-md">
            Comienza a comercializar tu cosecha con los supermercados asociados de AgroPasco.
          </p>
          <button class="btn btn-primary btn-lg" onclick="showPublishModal()">
            💰 Vender mi primer producto
          </button>
        </div>
      `}
    </div>
  `;
}

// Modal para poner producto en venta o editarlo (Agricultor)
async function showPublishModal(editProduct = null) {
  const user = getUser();
  window._currentEditingProductId = editProduct ? editProduct.id : null;

  // Obtener parcelas y cultivos del agricultor para facilitar selección
  let myCrops = [];
  try {
    const cropsRes = await api.getCrops();
    if (cropsRes.success && cropsRes.data) {
      myCrops = cropsRes.data;
    }
  } catch (err) {
    console.warn('No se pudieron cargar cultivos previos:', err);
  }

  const isEditing = !!editProduct;
  const initialName = editProduct ? (editProduct.name || '') : '';
  const initialType = editProduct ? (editProduct.crop_type || 'papa') : 'papa';
  const initialQuality = editProduct ? (editProduct.quality || 'primera') : 'primera';
  const initialOrigin = editProduct ? (editProduct.origin || user?.location || 'Yanahuanca, Pasco') : (user?.location || 'Yanahuanca, Pasco');
  const initialStock = editProduct ? (editProduct.stock_kg || '') : '';
  const initialPrice = editProduct ? (editProduct.original_price || editProduct.price_per_kg || '') : '';
  const initialDesc = editProduct ? (editProduct.description || '') : '';
  const initialPhoto = editProduct ? (editProduct.photo_url || '') : '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'publish-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'publish-modal-title');

  const closePublishModal = () => {
    window._currentEditingProductId = null;
    window.removeEventListener('keydown', handleEsc);
    modal.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closePublishModal();
  };
  window.addEventListener('keydown', handleEsc);

  modal.onclick = (e) => { if (e.target === modal) closePublishModal(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 580px;" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="publish-modal-title" style="display: flex; align-items: center; gap: 8px;">
          <span>${isEditing ? '✏️' : '💰'}</span> ${isEditing ? 'Editar Producto en Venta al Supermercado' : 'Poner Producto en Venta al Supermercado'}
        </h3>
        <button class="modal-close" aria-label="Cerrar modal" onclick="window._currentEditingProductId=null; document.getElementById('publish-modal')?.remove()">✕</button>
      </div>

      <!-- Banner de Bonificación Natural -->
      <div style="background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(59,130,246,0.1)); border: 1px solid rgba(34,197,94,0.3); border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px;">
        <div style="font-weight: 700; color: var(--green-400); margin-bottom: 2px;">
          🌿 Incentivo por Prácticas 100% Naturales
        </div>
        <div class="text-muted">
          Tu producto pasará a revisión del <strong>Asesor Técnico</strong>. Si tu historial de actividades demuestra que no utilizaste químicos ni hormonas, el sistema aplicará un <strong>+30% de incremento automático</strong> sobre tu precio base al publicarlo al supermercado.
        </div>
      </div>

      <form onsubmit="handlePublishProduct(event)">
        ${!isEditing && myCrops.length > 0 ? `
          <div class="form-group">
            <label class="form-label">🌾 Cargar desde cultivo registrado (opcional)</label>
            <select class="form-select" id="pub-crop-autofill" onchange="autoFillPublishFromCrop(this.value)">
              <option value="">-- Seleccionar cultivo para auto-completar --</option>
              ${myCrops.map(c => `
                <option value="${c.id}" data-name="${c.name}" data-type="${c.crop_type}" data-location="${c.location_detail || ''}">
                  ${c.name} (${c.crop_type}) - ${c.location_detail || 'Pasco'}
                </option>
              `).join('')}
            </select>
          </div>
        ` : ''}

        <div class="form-group">
          <label class="form-label">Nombre del Producto *</label>
          <input type="text" class="form-input" id="pub-name" value="${initialName}" placeholder="Ej: Papa Nativa Huayro Orgánica" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Cultivo *</label>
            <select class="form-select" id="pub-type" required>
              <option value="papa" ${initialType === 'papa' ? 'selected' : ''}>🥔 Papa</option>
              <option value="maca" ${initialType === 'maca' ? 'selected' : ''}>🌿 Maca</option>
              <option value="quinua" ${initialType === 'quinua' ? 'selected' : ''}>🌾 Quinua</option>
              <option value="habas" ${initialType === 'habas' ? 'selected' : ''}>🫘 Habas</option>
              <option value="cafe" ${initialType === 'cafe' ? 'selected' : ''}>☕ Café</option>
              <option value="olluco" ${initialType === 'olluco' ? 'selected' : ''}>🟡 Olluco</option>
              <option value="mashua" ${initialType === 'mashua' ? 'selected' : ''}>🟠 Mashua</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Calidad del Producto</label>
            <select class="form-select" id="pub-quality">
              <option value="primera" ${initialQuality === 'primera' ? 'selected' : ''}>Primera</option>
              <option value="premium" ${initialQuality === 'premium' ? 'selected' : ''}>Premium</option>
              <option value="organica" ${initialQuality === 'organica' ? 'selected' : ''}>Orgánica</option>
              <option value="gourmet" ${initialQuality === 'gourmet' ? 'selected' : ''}>Gourmet</option>
              <option value="segunda" ${initialQuality === 'segunda' ? 'selected' : ''}>Segunda</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">📍 Lugar de Cosecha / Origen *</label>
          <input type="text" class="form-input" id="pub-origin" value="${initialOrigin}" placeholder="Ej: Yanahuanca, Daniel Alcides Carrión" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Cantidad Disponible (kg) *</label>
            <input type="number" class="form-input" id="pub-stock" value="${initialStock}" placeholder="Ej: 500" min="1" step="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Precio Base por kg (S/) *</label>
            <input type="number" class="form-input" id="pub-price" value="${initialPrice}" step="0.10" min="0.10" placeholder="Ej: 4.50" required oninput="updatePriceEstimate(this.value)">
          </div>
        </div>

        <!-- Estimación dinámica de precio -->
        <div id="price-estimate-box" style="display: ${initialPrice ? 'block' : 'none'}; background: rgba(34,197,94,0.08); border-radius: 6px; padding: 10px; margin-bottom: 14px; font-size: 13px;">
          <div style="font-weight: 600; color: var(--green-400);">Simulación de Precio de Venta:</div>
          <div id="price-estimate-text" class="text-muted mt-xs">
            ${initialPrice ? `
              • Si es validado como <strong>100% Natural (+30%)</strong>: <strong>S/ ${(parseFloat(initialPrice) * 1.30).toFixed(2)} / kg</strong><br>
              • Si es validado como <strong>Convencional</strong>: <strong>S/ ${parseFloat(initialPrice).toFixed(2)} / kg</strong>
            ` : ''}
          </div>
        </div>

        <!-- Fotografía en Vivo (Cámara) o Subir Imagen -->
        <div class="form-group">
          ${AgroMediaUploader.render({
            id: 'pub-photo',
            folder: 'products',
            existingUrl: initialPhoto,
            label: 'Fotografía Original del Producto / Cosecha (Cámara en Vivo o Subir Imagen) — OBLIGATORIA *'
          })}
        </div>

        <div class="form-group">
          <label class="form-label">Descripción y Prácticas Empleadas</label>
          <textarea class="form-textarea" id="pub-description" rows="3" placeholder="Describe los métodos de siembra, si utilizaste abonos naturales (biol, compost), fecha aproximada de cosecha...">${initialDesc}</textarea>
        </div>

        <button type="submit" id="publish-submit-btn" class="btn btn-primary btn-block btn-lg" style="box-shadow: 0 4px 14px rgba(16,185,129,0.3); font-weight: 700;">
          ${isEditing ? '💾 Guardar Cambios y Enviar a Validación' : '🚀 Vender Producto al Supermercado (Enviar a Validación)'}
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Helper autofill
  window.autoFillPublishFromCrop = function(cropId) {
    if (!cropId) return;
    const select = document.getElementById('pub-crop-autofill');
    const selectedOpt = select.options[select.selectedIndex];
    if (selectedOpt) {
      document.getElementById('pub-name').value = selectedOpt.getAttribute('data-name') || '';
      const type = selectedOpt.getAttribute('data-type');
      if (type) document.getElementById('pub-type').value = type;
      const loc = selectedOpt.getAttribute('data-location');
      if (loc) document.getElementById('pub-origin').value = loc;
    }
  };

  // Helper price estimate
  window.updatePriceEstimate = function(val) {
    const p = parseFloat(val);
    const box = document.getElementById('price-estimate-box');
    const text = document.getElementById('price-estimate-text');
    if (!box || !text) return;

    if (!isNaN(p) && p > 0) {
      const naturalPrice = (p * 1.30).toFixed(2);
      box.style.display = 'block';
      text.innerHTML = `
        • Si es validado como <strong>100% Natural (+30%)</strong>: <strong>S/ ${naturalPrice} / kg</strong><br>
        • Si es validado como <strong>Convencional</strong>: <strong>S/ ${p.toFixed(2)} / kg</strong>
      `;
    } else {
      box.style.display = 'none';
    }
  };
}

window.editFarmerProduct = async function(productId) {
  const result = await api.getProduct(productId);
  if (result.success && result.data) {
    showPublishModal(result.data);
  } else {
    showToast('No se pudo cargar el producto para edición', 'error');
  }
};

async function handlePublishProduct(e) {
  e.preventDefault();
  const name = document.getElementById('pub-name')?.value?.trim();
  const crop_type = document.getElementById('pub-type')?.value;
  const quality = document.getElementById('pub-quality')?.value;
  const origin = document.getElementById('pub-origin')?.value?.trim();
  const stock_kg = parseFloat(document.getElementById('pub-stock')?.value);
  const price_per_kg = parseFloat(document.getElementById('pub-price')?.value);
  const photo_url = document.getElementById('pub-photo-value')?.value || null;
  const photoContainer = document.getElementById('pub-photo-container');
  const description = document.getElementById('pub-description')?.value?.trim();

  // Validación de fotografía obligatoria
  if (!photo_url || photo_url.trim() === '') {
    if (photoContainer) {
      photoContainer.style.border = '2px solid #ef4444';
      photoContainer.style.boxShadow = '0 0 14px rgba(239, 68, 68, 0.4)';
      photoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showToast('⚠️ La fotografía del producto o cosecha es obligatoria para certificar la trazabilidad.', 'error');
    if (window.AgroLogger) AgroLogger.warn('SUPERMARKET', 'Intento de publicación sin fotografía obligatoria', { name });
    return;
  }

  const submitBtn = document.getElementById('publish-submit-btn') || e.target.querySelector('button[type="submit"]');

  const executePublish = async () => {
    if (window._currentEditingProductId) {
      if (window.AgroLogger) AgroLogger.action('SUPERMARKET', `Actualizando producto "${name}"`);
      const result = await api.updateProduct(window._currentEditingProductId, {
        name, crop_type, quality, origin, stock_kg, price_per_kg, photo_url: photo_url.trim(), description
      });

      if (result.success) {
        if (window.AgroLogger) AgroLogger.info('SUPERMARKET', `Producto "${name}" actualizado exitosamente`);
        document.getElementById('publish-modal')?.remove();
        window._currentEditingProductId = null;
        showToast('¡Producto y fotografía actualizados! Enviado al Asesor Técnico para revalidación.', 'success');
        navigateTo('/farmer/sales');
      } else {
        const errorMsg = result.error || 'Error al actualizar producto';
        if (window.AgroLogger) AgroLogger.error('SUPERMARKET', 'Fallo al actualizar producto', { error: errorMsg });
        showToast(`Error al actualizar producto: ${errorMsg}`, 'error');
      }
    } else {
      if (window.AgroLogger) AgroLogger.action('SUPERMARKET', `Publicando producto "${name}"`);

      const result = await api.publishProduct({
        name, crop_type, quality, origin, stock_kg, price_per_kg, photo_url: photo_url.trim(), description
      });

      if (result.success) {
        if (window.AgroLogger) AgroLogger.info('SUPERMARKET', `Producto "${name}" publicado exitosamente`);
        document.getElementById('publish-modal')?.remove();
        showToast('¡Producto puesto en venta! Enviado al Asesor Técnico para validación.', 'success');
        navigateTo('/farmer/sales');
      } else {
        const errorMsg = result.error || 'Error al publicar producto';
        if (window.AgroLogger) AgroLogger.error('SUPERMARKET', 'Fallo al publicar producto', { error: errorMsg });
        showToast(`Error al publicar producto: ${errorMsg}`, 'error');
      }
    }
  };

  if (window.AgroLogger && AgroLogger.wrapButtonAction) {
    await AgroLogger.wrapButtonAction(submitBtn, window._currentEditingProductId ? '💾 Guardando Cambios...' : '🚀 Publicando Producto...', executePublish);
  } else {
    await executePublish();
  }
}

// ==========================================
// 4. VALIDACIÓN DE PRODUCTOS (ROL ASESOR TÉCNICO)
// ==========================================

async function renderValidateProductsPage() {
  const result = await api.getPendingProducts();
  const products = result.data || [];

  // Obtener también productos validados para el historial del asesor
  const allResult = await api.getProducts();
  const allProducts = allResult.data || [];
  const validated = allProducts.filter(p => p.validation_status === 'approved' || p.validation_status === 'rejected');

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
            🔬 Validación de Productos para Supermercado
          </h2>
          <p class="text-sm text-muted">
            Evalúa el historial de prácticas del agricultor para certificar productos 100% naturales (+30% precio) o convencionales.
          </p>
        </div>
        <span class="badge badge-amber" style="font-size: 13px; padding: 6px 12px;">
          ⏳ ${products.length} Pendientes de Evaluación
        </span>
      </div>

      <!-- Sección de Productos Pendientes -->
      ${products.length > 0 ? `
        <div class="card mb-xl">
          <div class="card-header">
            <div class="card-title">
              <span class="card-title-icon">⏳</span> Productos que Requieren Dictamen Técnico
            </div>
          </div>
          <div style="display: grid; gap: 20px;">
            ${products.map(p => {
              const basePrice = p.original_price || p.price_per_kg;
              const naturalPrice = (basePrice * 1.30).toFixed(2);
              const history = p.farmer_history || [];
              const hasChemicals = history.some(h =>
                (h.action_type && h.action_type.toLowerCase().includes('fumig')) ||
                (h.description && (h.description.toLowerCase().includes('quimic') || h.description.toLowerCase().includes('pesticida') || h.description.toLowerCase().includes('hormona')))
              );

              return `
                <div style="padding: 18px; background: var(--bg-glass); border-radius: 10px; border-left: 5px solid ${hasChemicals ? 'var(--amber-500)' : 'var(--green-500)'};">
                  <!-- Cabecera de la Solicitud -->
                  <div class="flex items-center justify-between mb-sm" style="flex-wrap: wrap; gap: 8px;">
                    <div>
                      <h4 style="font-size: 17px; font-weight: 700; margin: 0;">${p.name}</h4>
                      <span class="text-xs text-muted">Código temporal: ${p.traceability_code || 'AP-PENDING'}</span>
                    </div>
                    <span class="badge badge-amber">⏳ Pendiente de Validación</span>
                  </div>

                  <p class="text-sm text-muted mb-md">${p.description || 'El agricultor no incluyó notas adicionales.'}</p>

                  <!-- Ficha Técnica Resumida -->
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 14px;">
                    <div style="padding: 8px 10px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                      <span class="text-muted">👨‍🌾 Agricultor:</span><br>
                      <strong>${p.farmer_name || 'No registrado'}</strong>
                    </div>
                    <div style="padding: 8px 10px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                      <span class="text-muted">📍 Origen / Finca:</span><br>
                      <strong>${p.origin || p.farmer_location || 'Región Pasco'}</strong>
                    </div>
                    <div style="padding: 8px 10px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                      <span class="text-muted">🌱 Cultivo / Calidad:</span><br>
                      <strong>${p.crop_type} (${p.quality})</strong>
                    </div>
                    <div style="padding: 8px 10px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                      <span class="text-muted">📦 Volumen:</span><br>
                      <strong>${p.stock_kg} kg</strong>
                    </div>
                    <div style="padding: 8px 10px; background: var(--bg-card); border-radius: 6px; font-size: 12px;">
                      <span class="text-muted">💰 Precio Base Solicitado:</span><br>
                      <strong style="color: var(--green-400);">S/ ${basePrice.toFixed(2)} / kg</strong>
                    </div>
                    <div style="padding: 8px 10px; background: rgba(34,197,94,0.1); border-radius: 6px; font-size: 12px; border: 1px solid rgba(34,197,94,0.25);">
                      <span class="text-muted">🌿 Precio con +30% Natural:</span><br>
                      <strong style="color: var(--green-400); font-size: 13px;">S/ ${naturalPrice} / kg</strong>
                    </div>
                  </div>

                  <!-- FOTOGRAFÍA DEL PRODUCTO SUBIDA POR EL AGRICULTOR -->
                  ${p.photo_url ? `
                    <div style="margin-bottom: 14px; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); max-width: 440px; background: #FFFFFF; box-shadow: var(--shadow-sm);">
                      <div style="background: #F8FAFC; padding: 6px 12px; font-size: 11.5px; color: var(--forest-green); font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border);">
                        <span>📸 Fotografía de la Cosecha enviada por el Agricultor</span>
                        <button type="button" class="btn btn-sm btn-secondary" style="font-size: 10.5px; padding: 2px 8px;"
                                onclick="AgroMediaUploader.previewEnlarged('${p.photo_url}', 'Foto Cosecha: ${p.name.replace(/'/g, "\\'")}')">
                          🔍 Ver Tamaño Completo
                        </button>
                      </div>
                      <img src="${p.photo_url}" alt="${p.name}" style="max-height: 220px; width: 100%; object-fit: contain; cursor: pointer; display: block;"
                           onclick="AgroMediaUploader.previewEnlarged('${p.photo_url}', 'Foto Cosecha: ${p.name.replace(/'/g, "\\'")}')">
                    </div>
                  ` : `
                    <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 12px; color: var(--text-muted);">
                      📷 Sin fotografía adjunta por el agricultor.
                    </div>
                  `}

                  <!-- REVISIÓN DEL HISTORIAL DE PRÁCTICAS DEL AGRICULTOR -->
                  <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border);">
                    <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                      <span>📅 Historial de Prácticas del Agricultor (${history.length} actividades)</span>
                      ${hasChemicals ? `
                        <span class="badge badge-amber">⚠️ Alerta: Registros de Fumigación/Químicos</span>
                      ` : `
                        <span class="badge badge-green">✅ Prácticas Limpias / Orgánicas</span>
                      `}
                    </div>

                    ${history.length > 0 ? `
                      <div style="max-height: 140px; overflow-y: auto; padding-right: 4px;">
                        ${history.map(h => `
                          <div style="font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center;">
                            <span>${h.action_type === 'fumigacion' ? '🧴' : h.action_type === 'fertilizacion' ? '🌿' : '📋'}</span>
                            <strong style="text-transform: capitalize;">${h.action_type}:</strong>
                            <span class="text-muted" style="flex: 1;">${h.description || 'Sin detalle'}</span>
                            <span class="text-xs text-muted">${new Date(h.created_at).toLocaleDateString('es-PE')}</span>
                          </div>
                        `).join('')}
                      </div>
                    ` : `
                      <div class="text-xs text-muted" style="padding: 6px 0;">
                        El agricultor no cuenta con registros previos de fumigación con agroquímicos.
                      </div>
                    `}
                  </div>

                  <!-- Campo de Notas Técnicas del Asesor -->
                  <div class="form-group mb-md">
                    <label class="form-label" style="font-size: 12px;">Notas / Justificación del Dictamen Técnico:</label>
                    <input type="text" class="form-input" id="validation-notes-${p.id}"
                           placeholder="${hasChemicals ? 'Ej: Se detectó fumigación convencional. Se aprueba bajo estándar convencional sin bonificación.' : 'Ej: Verificado en campo e historial: 100% natural, sin químicos ni hormonas.'}">
                  </div>

                  <!-- Botones de Decisión Técnica -->
                  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="submitProductValidation(${p.id}, 'approved', true)" style="flex: 1; min-width: 220px; font-weight: 700; background: var(--green-600);">
                      🌿 Certificar 100% Natural (+30% Precio)
                    </button>
                    <button class="btn btn-secondary" onclick="submitProductValidation(${p.id}, 'approved', false)" style="flex: 1; min-width: 200px;">
                      📦 Validar Convencional (Precio Base)
                    </button>
                    <button class="btn btn-danger" onclick="showRejectModal(${p.id})" style="min-width: 120px;">
                      ❌ Rechazar
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : `
        <div class="card mb-xl">
          <div class="empty-state" style="padding: 40px; text-align: center;">
            <div class="empty-state-icon" style="font-size: 44px;">✅</div>
            <h4 class="empty-state-title" style="margin: 10px 0 4px;">Al día: Sin productos pendientes</h4>
            <p class="empty-state-text text-muted">
              Todos los productos registrados por los agricultores han sido evaluados y clasificados.
            </p>
          </div>
        </div>
      `}

      <!-- Historial de Validaciones Realizadas -->
      ${validated.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <span class="card-title-icon">📋</span> Registro Histórico de Validaciones Técnicas (${validated.length})
            </div>
          </div>
          <div style="display: grid; gap: 10px;">
            ${validated.slice(0, 15).map(p => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg-glass); border-radius: 8px; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <span style="font-size: 24px;">${p.validation_status === 'approved' ? '✅' : '❌'}</span>
                  <div>
                    <div style="font-weight: 700; font-size: 14px;">${p.name}</div>
                    <div class="text-xs text-muted">
                      👨‍🌾 ${p.farmer_name || 'Agricultor'} · 📍 ${p.origin || 'Pasco'} · S/ ${p.price_per_kg?.toFixed(2)} / ${p.unit || 'kg'}
                    </div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  ${p.is_natural ? `<span class="badge badge-green">🌿 100% Natural (+30%)</span>` : `<span class="badge badge-blue">📦 Convencional</span>`}
                  <span class="badge badge-${p.validation_status === 'approved' ? 'green' : 'red'}">
                    ${p.validation_status === 'approved' ? 'Aprobado' : 'Rechazado'}
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function submitProductValidation(productId, status, isNatural) {
  const notesInput = document.getElementById(`validation-notes-${productId}`);
  let notes = notesInput ? notesInput.value.trim() : '';

  if (!notes) {
    notes = isNatural
      ? 'Certificado por Asesor Técnico: Producto 100% natural, sin presencia de químicos ni hormonas (+30% de bonificación).'
      : 'Aprobado por Asesor Técnico bajo estándares de calidad convencional.';
  }

  const result = await api.validateProduct(productId, {
    validation_status: status,
    is_natural: isNatural,
    validation_notes: notes
  });

  if (result.success) {
    showToast(
      isNatural
        ? '🌿 ¡Producto certificado como 100% Natural (+30% de precio aplicado)!'
        : '✅ Producto validado como convencional y publicado en catálogo.',
      'success'
    );
    navigateTo('/advisor/validate-products');
  } else {
    showToast(result.error || 'Error al procesar la validación', 'error');
  }
}

function showRejectModal(productId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'reject-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'reject-modal-title');

  const closeRejectModal = () => {
    window.removeEventListener('keydown', handleEsc);
    modal.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeRejectModal();
  };
  window.addEventListener('keydown', handleEsc);

  modal.onclick = (e) => { if (e.target === modal) closeRejectModal(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 480px;" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="reject-modal-title" style="color: var(--red-400);">❌ Rechazar Producto</h3>
        <button class="modal-close" aria-label="Cerrar modal" onclick="document.getElementById('reject-modal')?.remove()">✕</button>
      </div>
      <p class="text-sm text-muted mb-md">
        Indica el motivo técnico por el cual este producto no puede ser publicado en el catálogo del supermercado.
      </p>
      <form onsubmit="handleRejectProduct(event, ${productId})">
        <div class="form-group">
          <label class="form-label">Motivo del Rechazo *</label>
          <textarea class="form-textarea" id="reject-notes" rows="4" placeholder="Ej: No cumple con los estándares mínimos de inocuidad o presenta residuos no autorizados..." required></textarea>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('reject-modal')?.remove()">Cancelar</button>
          <button type="submit" id="reject-submit-btn" class="btn btn-danger" style="flex: 1;">Confirmar Rechazo</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleRejectProduct(e, productId) {
  e.preventDefault();
  const notes = document.getElementById('reject-notes')?.value?.trim();
  const submitBtn = document.getElementById('reject-submit-btn') || e.target.querySelector('button[type="submit"]');

  const executeReject = async () => {
    const result = await api.validateProduct(productId, {
      validation_status: 'rejected',
      is_natural: false,
      validation_notes: notes
    });

    if (result.success) {
      document.getElementById('reject-modal')?.remove();
      showToast('Producto rechazado. Se notificó al agricultor con las observaciones técnicas.', 'warning');
      navigateTo('/advisor/validate-products');
    } else {
      const errMsg = result.error || 'Error al rechazar producto';
      showToast(`Error al rechazar producto: ${errMsg}`, 'error');
      // Modal stays open so advisor does not lose typed notes
    }
  };

  if (window.AgroLogger && AgroLogger.wrapButtonAction) {
    await AgroLogger.wrapButtonAction(submitBtn, 'Rechazando...', executeReject);
  } else {
    await executeReject();
  }
}

// ==========================================
// 5. TRAZABILIDAD COMPLETA (PÚBLICA Y AUDITABLE)
// ==========================================

async function viewProductTrace(productId) {
  const result = await api.getProductTrace(productId);
  if (!result.success || !result.data) {
    showToast('Error al cargar la trazabilidad digital', 'error');
    return;
  }

  const trace = result.data;
  const isNatural = trace.product.is_natural || trace.product.certified_natural;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'trace-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'trace-modal-title');

  const closeTraceModal = () => {
    window.removeEventListener('keydown', handleEsc);
    modal.remove();
  };

  const handleEsc = (e) => {
    if (e.key === 'Escape') closeTraceModal();
  };
  window.addEventListener('keydown', handleEsc);

  modal.onclick = (e) => { if (e.target === modal) closeTraceModal(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto;" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div>
          <h3 id="trace-modal-title" style="margin: 0; font-size: 18px;">📋 Certificado de Trazabilidad Digital</h3>
          <span class="text-xs text-muted">Hash Blockchain: ${trace.traceability_code}</span>
        </div>
        <button class="modal-close" aria-label="Cerrar certificado" onclick="document.getElementById('trace-modal')?.remove()">✕</button>
      </div>

      <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
        <span class="badge badge-green">🛡️ Verificación Criptográfica: Válida</span>
        <span class="badge badge-purple">${trace.traceability_code}</span>
        ${isNatural ? `<span class="badge badge-green">🌿 100% Natural Certificado</span>` : `<span class="badge badge-blue">📦 Convencional</span>`}
      </div>

      <!-- Resumen del Producto y Productor -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
        <div style="padding: 10px; background: var(--bg-card); border-radius: 8px; font-size: 13px;">
          <div class="text-xs text-muted">PRODUCTO:</div>
          <strong>${trace.product.name}</strong> (${trace.product.quality})<br>
          <span class="text-muted">Precio:</span> S/ ${trace.product.price_per_kg?.toFixed(2)} / kg
        </div>
        <div style="padding: 10px; background: var(--bg-card); border-radius: 8px; font-size: 13px;">
          <div class="text-xs text-muted">PRODUCTOR:</div>
          <strong>${trace.farmer?.name || 'Productor Pasqueño'}</strong><br>
          <span class="text-muted">Zona:</span> ${trace.farmer?.location || 'Pasco, Perú'}
        </div>
      </div>

      <!-- Dictamen del Asesor -->
      <div style="padding: 12px; background: rgba(16,185,129,0.08); border-radius: 8px; border-left: 4px solid var(--green-500); margin-bottom: 16px; font-size: 13px;">
        <strong>Validación Técnica:</strong> ${trace.validator ? trace.validator.name : 'Asesor Certificado AgroPasco'}<br>
        <span class="text-muted">${trace.product.validation_notes || 'Validado conforme a la normativa de sanidad agraria.'}</span>
      </div>

      <!-- Historial de Cuaderno de Campo -->
      ${trace.crop_history && trace.crop_history.activities?.length > 0 ? `
        <div>
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px;">
            📅 Cuaderno de Campo Digital (${trace.crop_history.activities.length} registros)
          </div>
          <div class="timeline" style="max-height: 220px; overflow-y: auto;">
            ${trace.crop_history.activities.map(a => `
              <div class="timeline-item">
                <div class="timeline-date">${new Date(a.date).toLocaleDateString('es-PE')}</div>
                <div class="timeline-action" style="text-transform: capitalize;">${a.action}</div>
                <div class="timeline-description">${a.description}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="card" style="padding: 16px; text-align: center; font-size: 13px; color: var(--text-muted);">
          Sin actividades adicionales de campo vinculadas.
        </div>
      `}
    </div>
  `;

  document.body.appendChild(modal);
}
