/**
 * AgroPasco — Módulo de Catálogo Supermercado
 * Con validación de productos y catálogo detallado
 */

async function renderSupermarketPage() {
  const result = await api.getProducts();
  const products = result.data || [];
  const user = getUser();

  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡', mashua: '🟠' };
  const qualityColors = { primera: 'green', segunda: 'amber', gourmet: 'purple', organica: 'green', premium: 'amber' };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">🏪 Catálogo de Productos — Supermercado</h3>
          <p class="text-sm text-muted">Productos certificados de la Región Pasco, con trazabilidad digital.</p>
        </div>
      </div>

      <!-- API Info Card -->
      <div class="card mb-lg" style="border-left: 4px solid var(--blue-500);">
        <div class="flex items-center gap-md">
          <div style="font-size: 28px;">🔗</div>
          <div style="flex: 1;">
            <div style="font-weight: 600;">API de Integración para Supermercados</div>
            <div class="text-sm text-muted">Endpoint público: <code style="background: var(--bg-glass); padding: 2px 8px; border-radius: 4px; font-size: 12px;">GET /api/v1/supermarket/products</code></div>
          </div>
          <span class="badge badge-green">API Activa</span>
        </div>
      </div>

      ${products.length > 0 ? `
        <div class="grid-3">
          ${products.map(prod => `
            <div class="product-card" style="cursor: pointer;" onclick="showProductDetailModal(${prod.id})">
              <div class="product-card-img">
                ${cropIcons[prod.crop_type] || '🌾'}
                <div class="product-card-badge">
                  <span class="badge badge-${qualityColors[prod.quality] || 'green'}">${prod.quality}</span>
                </div>
                ${prod.is_natural || prod.certified_natural ? `<div style="position: absolute; top: 12px; left: 12px;"><span class="badge badge-green">🌿 Natural +30%</span></div>` : ''}
              </div>
              <div class="product-card-body">
                <div class="product-card-name">${prod.name}</div>
                <div class="product-card-origin" style="color: var(--green-400); font-weight: 600; font-size: 13px;">
                  📍 ${prod.origin || 'Región Pasco'}
                </div>
                ${prod.farmer_name ? `<div class="text-sm text-muted" style="margin-top: 2px;">👨‍🌾 ${prod.farmer_name}</div>` : ''}
                <div class="text-sm text-muted" style="margin-top: 4px; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  ${prod.description || 'Producto agrícola certificado de la región Pasco.'}
                </div>
                ${prod.validation_status === 'approved' && prod.validator_name ? `
                  <div style="font-size: 11px; color: var(--green-400); margin-bottom: 4px;">
                    ✅ Validado por ${prod.validator_name}
                  </div>
                ` : ''}
                ${prod.traceability_code ? `
                  <div style="font-size: 11px; color: var(--blue-400); cursor: pointer;" onclick="event.stopPropagation(); viewProductTrace(${prod.id})">
                    📋 Trazabilidad: ${prod.traceability_code}
                  </div>
                ` : ''}
                <div class="product-card-footer">
                  <div class="product-card-price">
                    S/ ${prod.price_per_kg?.toFixed(2)} <span>/ ${prod.unit || 'kg'}</span>
                    ${prod.is_natural && prod.original_price && prod.original_price !== prod.price_per_kg ? `
                      <div style="font-size: 10px; color: var(--text-muted); text-decoration: line-through;">S/ ${prod.original_price?.toFixed(2)}</div>
                    ` : ''}
                  </div>
                  <div class="product-card-stock">${prod.stock_kg || 0} kg disp.</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">No hay productos en el catálogo</div>
          <div class="empty-state-text">Los productos aparecerán aquí cuando sean validados por el asesor técnico.</div>
        </div>
      `}
    </div>
  `;
}

// Modal detallado de producto
async function showProductDetailModal(productId) {
  const result = await api.getProduct(productId);
  if (!result.success) { showToast('Error al cargar producto', 'error'); return; }

  const prod = result.data;
  const cropIcons = { papa: '🥔', maca: '🌿', cafe: '☕', quinua: '🌾', habas: '🫘', olluco: '🟡' };

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'product-detail-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal" style="max-width: 640px;">
      <div class="modal-header">
        <h3>${cropIcons[prod.crop_type] || '🌾'} ${prod.name}</h3>
        <button class="modal-close" onclick="document.getElementById('product-detail-modal').remove()">✕</button>
      </div>

      <!-- Badges -->
      <div style="display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;">
        <span class="badge badge-green">${prod.quality}</span>
        ${prod.is_natural || prod.certified_natural ? `<span class="badge badge-green" style="font-size: 12px;">🌿 100% Natural</span>` : ''}
        ${prod.validation_status === 'approved' ? `<span class="badge badge-blue">✅ Validado</span>` : ''}
        ${prod.traceability_code ? `<span class="badge badge-purple">${prod.traceability_code}</span>` : ''}
      </div>

      ${prod.photo_url ? `<img src="${prod.photo_url}" style="width: 100%; max-height: 250px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;" alt="${prod.name}">` : ''}

      <div class="text-sm text-muted mb-md">${prod.description || 'Producto agrícola certificado de la Región Pasco.'}</div>

      <!-- Precio -->
      <div style="background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,211,238,0.1)); padding: 16px; border-radius: 10px; margin-bottom: 16px; text-align: center;">
        <div style="font-size: 28px; font-weight: 800; color: var(--green-400);">S/ ${prod.price_per_kg?.toFixed(2)} <span style="font-size: 14px; font-weight: 400;">/ ${prod.unit || 'kg'}</span></div>
        ${prod.is_natural && prod.original_price && prod.original_price !== prod.price_per_kg ? `
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
            <span style="text-decoration: line-through;">S/ ${prod.original_price?.toFixed(2)}</span> → Incremento +30% por producto natural
          </div>
        ` : ''}
        <div class="text-sm text-muted mt-sm">${prod.stock_kg || 0} kg disponibles</div>
      </div>

      <!-- Info Grid -->
      <div style="display: grid; gap: 8px; margin-bottom: 16px;">
        ${[
          ['📍 Origen', prod.origin || 'Región Pasco'],
          ['👨‍🌾 Agricultor', prod.farmer_name || 'No registrado'],
          ['📍 Ubicación', prod.farmer_location || 'Región Pasco'],
          ['🌿 Tipo', prod.crop_type],
          ['⭐ Calidad', prod.quality],
          ['📅 Cosecha', prod.harvest_date || 'No registrada']
        ].map(([l, v]) => `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
            <span class="text-muted text-sm">${l}</span>
            <span style="font-weight: 600; font-size: 13px;">${v}</span>
          </div>
        `).join('')}
      </div>

      <!-- Validación del asesor -->
      ${prod.validation_status === 'approved' && prod.validator_name ? `
        <div style="padding: 12px; background: rgba(34,197,94,0.1); border-radius: 8px; border-left: 4px solid var(--green-400); margin-bottom: 12px;">
          <div style="font-weight: 600; color: var(--green-400); margin-bottom: 4px;">✅ Validado por: ${prod.validator_name}</div>
          ${prod.validation_notes ? `<div class="text-sm text-muted">${prod.validation_notes}</div>` : ''}
          ${prod.validated_at ? `<div class="text-sm text-muted mt-sm">📅 ${new Date(prod.validated_at).toLocaleDateString('es-PE')}</div>` : ''}
          ${prod.is_natural ? `<div class="text-sm mt-sm" style="color: var(--green-400);">🌿 Certificado como producto 100% natural</div>` : ''}
        </div>
      ` : ''}

      <!-- Historial del agricultor -->
      ${prod.farmer_history && prod.farmer_history.length > 0 ? `
        <div style="margin-top: 12px;">
          <div style="font-weight: 600; margin-bottom: 8px;">📅 Historial de Prácticas del Agricultor</div>
          <div class="timeline" style="max-height: 200px; overflow-y: auto;">
            ${prod.farmer_history.slice(0, 8).map(h => `
              <div class="timeline-item">
                <div class="timeline-date">${new Date(h.created_at).toLocaleDateString('es-PE')}</div>
                <div class="timeline-action">${h.action_type} — ${h.crop_name || ''}</div>
                <div class="timeline-description">${h.description}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <button class="btn btn-primary btn-block btn-lg mt-md" onclick="event.stopPropagation(); viewProductTrace(${prod.id})">📋 Ver Trazabilidad Completa</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function viewProductTrace(productId) {
  const result = await api.getProductTrace(productId);
  if (!result.success) { showToast('Error al cargar trazabilidad', 'error'); return; }

  const trace = result.data;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'trace-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal" style="max-width: 640px;">
      <div class="modal-header">
        <h3>📋 Trazabilidad: ${trace.product.name}</h3>
        <button class="modal-close" onclick="document.getElementById('trace-modal').remove()">✕</button>
      </div>
      <div style="margin-bottom: 16px; display: flex; gap: 6px; flex-wrap: wrap;">
        <span class="badge badge-green">✅ ${trace.verification.verified ? 'Verificado' : 'No verificado'}</span>
        <span class="badge badge-blue">${trace.traceability_code}</span>
        ${trace.product.is_natural ? `<span class="badge badge-green">🌿 Natural</span>` : ''}
      </div>
      <div style="display: grid; gap: 10px; margin-bottom: 16px;">
        ${[
          ['Producto', trace.product.name],
          ['Calidad', trace.product.quality],
          ['Origen', trace.product.origin],
          ['Natural', trace.product.is_natural ? '✅ Certificado Natural (+30% precio)' : trace.product.certified_natural ? '✅ Certificado' : '❌ No certificado'],
          ['Precio Final', `S/ ${trace.product.price_per_kg?.toFixed(2)} / kg`],
          ['Productor', trace.farmer?.name || 'No registrado'],
          ['Ubicación', trace.farmer?.location || 'Región Pasco'],
          ['Validación', trace.product.validation_status === 'approved' ? '✅ Aprobado' : trace.product.validation_status]
        ].map(([l, v]) => `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
            <span class="text-muted text-sm">${l}</span>
            <span style="font-weight: 600; font-size: 14px;">${v}</span>
          </div>
        `).join('')}
      </div>

      ${trace.validator ? `
        <div style="padding: 10px; background: rgba(34,197,94,0.1); border-radius: 6px; border-left: 3px solid var(--green-400); margin-bottom: 12px;">
          <div class="text-sm" style="color: var(--green-400);">✅ Validado por: ${trace.validator.name}</div>
          ${trace.product.validation_notes ? `<div class="text-sm text-muted">${trace.product.validation_notes}</div>` : ''}
        </div>
      ` : ''}

      ${trace.crop_history ? `
        <div style="margin-top: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px;">📅 Historial del Cultivo (${trace.crop_history.activities?.length || 0} actividades)</div>
          <div class="timeline" style="max-height: 250px; overflow-y: auto;">
            ${(trace.crop_history.activities || []).map(a => `
              <div class="timeline-item">
                <div class="timeline-date">${new Date(a.date).toLocaleDateString('es-PE')}</div>
                <div class="timeline-action">${a.action}</div>
                <div class="timeline-description">${a.description}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '<p class="text-muted text-sm">No hay historial de cultivo vinculado.</p>'}
    </div>
  `;
  document.body.appendChild(modal);
}

// ===== PUBLICAR PRODUCTO (FARMER) =====
function showPublishModal() {
  const user = getUser();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'publish-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>📦 Poner Producto en Venta</h3>
        <button class="modal-close" onclick="document.getElementById('publish-modal').remove()">✕</button>
      </div>
      <div class="alert-card info" style="margin-bottom: 16px;">
        <span class="alert-icon">ℹ️</span>
        <div class="alert-content">
          <div class="alert-message">Tu producto será revisado por un asesor técnico antes de aparecer en el catálogo del supermercado. Si se verifica como 100% natural, el precio aumentará un 30%.</div>
        </div>
      </div>
      <form onsubmit="handlePublishProduct(event)">
        <div class="form-group">
          <label class="form-label">Nombre del Producto</label>
          <input type="text" class="form-input" id="pub-name" placeholder="Ej: Papa Nativa Huayro" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Cultivo</label>
            <select class="form-select" id="pub-type" required>
              <option value="papa">🥔 Papa</option>
              <option value="maca">🌿 Maca</option>
              <option value="quinua">🌾 Quinua</option>
              <option value="habas">🫘 Habas</option>
              <option value="cafe">☕ Café</option>
              <option value="olluco">🟡 Olluco</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Calidad</label>
            <select class="form-select" id="pub-quality">
              <option value="primera">Primera</option>
              <option value="premium">Premium</option>
              <option value="gourmet">Gourmet</option>
              <option value="organica">Orgánica</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">📍 Lugar / Zona de Cosecha</label>
          <input type="text" class="form-input" id="pub-origin" value="${user?.location || 'Yanahuanca, Pasco'}" placeholder="Ej: Yanahuanca, Pasco" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Cantidad (kg)</label>
            <input type="number" class="form-input" id="pub-stock" placeholder="500" required>
          </div>
          <div class="form-group">
            <label class="form-label">Precio por kg (S/)</label>
            <input type="number" class="form-input" id="pub-price" step="0.01" placeholder="5.00" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">URL de Fotos (opcional)</label>
          <input type="url" class="form-input" id="pub-photo" placeholder="https://...">
        </div>
        <div class="form-group">
          <label class="form-label">Descripción</label>
          <textarea class="form-textarea" id="pub-description" placeholder="Describe tu producto, métodos de cultivo, si es orgánico..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">📦 Enviar a Validación</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handlePublishProduct(e) {
  e.preventDefault();
  const result = await api.publishProduct({
    name: document.getElementById('pub-name').value,
    crop_type: document.getElementById('pub-type').value,
    quality: document.getElementById('pub-quality').value,
    origin: document.getElementById('pub-origin').value,
    stock_kg: parseFloat(document.getElementById('pub-stock').value),
    price_per_kg: parseFloat(document.getElementById('pub-price').value),
    photo_url: document.getElementById('pub-photo').value || null,
    description: document.getElementById('pub-description').value
  });

  if (result.success) {
    document.getElementById('publish-modal')?.remove();
    showToast('¡Producto enviado para validación del asesor!', 'success');
    navigateTo('/farmer/sales');
  } else {
    showToast(result.error || 'Error al publicar', 'error');
  }
}

// ===== VISTA DE VENTAS DEL AGRICULTOR =====
async function renderFarmerSalesPage() {
  const result = await api.getProducts();
  const user = getUser();
  const myProducts = (result.data || []).filter(p => p.farmer_id === user?.id || p.farmer_name === user?.name);

  const statusIcons = { pending: '⏳', approved: '✅', rejected: '❌' };
  const statusLabels = { pending: 'En Revisión', approved: 'Aprobado', rejected: 'Rechazado' };
  const statusColors = { pending: 'amber', approved: 'green', rejected: 'red' };

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">📦 Mis Productos en Venta (${myProducts.length})</h3>
          <p class="text-sm text-muted">Publica productos y el asesor técnico los validará para el catálogo del supermercado.</p>
        </div>
        <button class="btn btn-primary" onclick="showPublishModal()">📦 Vender Producto</button>
      </div>

      ${myProducts.length > 0 ? `
        <div style="display: grid; gap: 12px;">
          ${myProducts.map(p => `
            <div class="card" style="border-left: 4px solid var(--${statusColors[p.validation_status] || 'amber'}-500);">
              <div class="flex items-center justify-between mb-sm">
                <div style="font-weight: 600;">${p.name}</div>
                <span class="badge badge-${statusColors[p.validation_status] || 'amber'}">
                  ${statusIcons[p.validation_status] || '⏳'} ${statusLabels[p.validation_status] || 'Pendiente'}
                </span>
              </div>
              <div class="text-sm text-muted mb-sm">${p.description || ''}</div>
              <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px;">
                <span>🌱 ${p.crop_type}</span>
                <span>📍 ${p.origin || ''}</span>
                <span>📦 ${p.stock_kg} kg</span>
                <span style="font-weight: 700; color: var(--green-400);">S/ ${p.price_per_kg?.toFixed(2)} / ${p.unit || 'kg'}</span>
                ${p.is_natural ? `<span style="color: var(--green-400);">🌿 Natural (+30%)</span>` : ''}
              </div>
              ${p.validation_notes ? `
                <div style="margin-top: 8px; padding: 8px; background: var(--bg-glass); border-radius: 6px; font-size: 12px;">
                  <span class="text-muted">Nota del asesor:</span> ${p.validation_notes}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">No has publicado productos</div>
          <div class="empty-state-text">Publica tus productos para que sean revisados por el asesor técnico y aparezcan en el catálogo del supermercado.</div>
          <button class="btn btn-primary btn-lg" onclick="showPublishModal()">📦 Publicar mi primer producto</button>
        </div>
      `}
    </div>
  `;
}

// ===== VALIDACIÓN DE PRODUCTOS (ASESOR TÉCNICO) =====
async function renderValidateProductsPage() {
  const result = await api.getPendingProducts();
  const products = result.data || [];

  // Also get approved/rejected for history
  const allResult = await api.getProducts();
  const allProducts = allResult.data || [];
  const validated = allProducts.filter(p => p.validation_status === 'approved' || p.validation_status === 'rejected');

  return `
    <div class="page-content">
      <div class="flex items-center justify-between mb-lg">
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">✅ Validar Productos para Catálogo</h3>
          <p class="text-sm text-muted">${products.length} productos pendientes de revisión</p>
        </div>
      </div>

      <!-- Pending Products -->
      ${products.length > 0 ? `
        <div class="card mb-lg">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">⏳</span> Productos Pendientes</div>
          </div>
          <div style="display: grid; gap: 16px;">
            ${products.map(p => `
              <div style="padding: 16px; background: var(--bg-glass); border-radius: 8px; border-left: 4px solid var(--amber-500);">
                <div class="flex items-center justify-between mb-sm">
                  <div style="font-weight: 700; font-size: 16px;">${p.name}</div>
                  <span class="badge badge-amber">⏳ Pendiente</span>
                </div>
                <div class="text-sm text-muted mb-sm">${p.description || 'Sin descripción'}</div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                  ${[
                    ['👨‍🌾 Agricultor', p.farmer_name || '—'],
                    ['📍 Ubicación', p.farmer_location || '—'],
                    ['🌱 Cultivo', p.crop_type],
                    ['⭐ Calidad', p.quality],
                    ['📦 Stock', `${p.stock_kg} kg`],
                    ['💰 Precio', `S/ ${p.price_per_kg?.toFixed(2)}`]
                  ].map(([l, v]) => `
                    <div style="padding: 6px 8px; background: var(--bg-card); border-radius: 4px; font-size: 12px;">
                      <span class="text-muted">${l}:</span> <strong>${v}</strong>
                    </div>
                  `).join('')}
                </div>

                ${p.farmer_history && p.farmer_history.length > 0 ? `
                  <div style="margin-bottom: 12px; padding: 10px; background: var(--bg-card); border-radius: 6px;">
                    <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px;">📅 Historial del Agricultor (${p.farmer_history.length} actividades recientes)</div>
                    ${p.farmer_history.slice(0, 5).map(h => `
                      <div style="font-size: 12px; padding: 3px 0; color: var(--text-muted);">
                        ${h.action_type === 'fumigacion' ? '🧴' : h.action_type === 'fertilizacion' ? '🌿' : '📋'} ${h.action_type} — ${h.description?.substring(0, 80) || ''} (${new Date(h.created_at).toLocaleDateString('es-PE')})
                      </div>
                    `).join('')}
                    ${p.farmer_history.some(h => h.action_type === 'fumigacion') ? `
                      <div style="margin-top: 6px; font-size: 12px; color: var(--amber-400); font-weight: 600;">
                        ⚠️ El agricultor ha registrado actividades de fumigación
                      </div>
                    ` : `
                      <div style="margin-top: 6px; font-size: 12px; color: var(--green-400); font-weight: 600;">
                        ✅ Sin registros de fumigación con químicos
                      </div>
                    `}
                  </div>
                ` : `
                  <div style="margin-bottom: 12px; padding: 8px; background: var(--bg-card); border-radius: 6px; font-size: 12px; color: var(--text-muted);">
                    📋 Sin historial de actividades registradas
                  </div>
                `}

                <div style="display: flex; gap: 8px;">
                  <button class="btn btn-primary" onclick="handleValidateProduct(${p.id}, 'approved', true)" style="flex: 1;">
                    🌿 Aprobar Natural (+30%)
                  </button>
                  <button class="btn btn-secondary" onclick="handleValidateProduct(${p.id}, 'approved', false)" style="flex: 1;">
                    ✅ Aprobar Convencional
                  </button>
                  <button class="btn btn-danger" onclick="showRejectModal(${p.id})" style="flex: 0.5;">
                    ❌ Rechazar
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="card mb-lg">
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-title">Sin productos pendientes</div>
            <div class="empty-state-text">Todos los productos han sido revisados.</div>
          </div>
        </div>
      `}

      <!-- Validated History -->
      ${validated.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">📋</span> Historial de Validaciones</div>
          </div>
          <div style="display: grid; gap: 8px;">
            ${validated.slice(0, 10).map(p => `
              <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-glass); border-radius: 6px;">
                <span style="font-size: 20px;">${p.validation_status === 'approved' ? '✅' : '❌'}</span>
                <div style="flex: 1;">
                  <div style="font-weight: 600; font-size: 14px;">${p.name}</div>
                  <div class="text-sm text-muted">👨‍🌾 ${p.farmer_name || '—'} · ${p.is_natural ? '🌿 Natural' : '📦 Convencional'} · S/ ${p.price_per_kg?.toFixed(2)}</div>
                </div>
                <span class="badge badge-${p.validation_status === 'approved' ? 'green' : 'red'}">${p.validation_status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function handleValidateProduct(productId, status, isNatural) {
  const notes = isNatural
    ? 'Producto verificado como 100% natural. Sin uso de químicos ni hormonas.'
    : status === 'approved'
    ? 'Producto aprobado para el catálogo.'
    : '';

  const result = await api.validateProduct(productId, {
    validation_status: status,
    is_natural: isNatural,
    validation_notes: notes
  });

  if (result.success) {
    showToast(status === 'approved' ? '✅ Producto aprobado' : '❌ Producto rechazado', 'success');
    navigateTo('/advisor/validate-products');
  } else {
    showToast(result.error || 'Error al validar', 'error');
  }
}

function showRejectModal(productId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'reject-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal" style="max-width: 480px;">
      <div class="modal-header">
        <h3>❌ Rechazar Producto</h3>
        <button class="modal-close" onclick="document.getElementById('reject-modal').remove()">✕</button>
      </div>
      <form onsubmit="handleRejectProduct(event, ${productId})">
        <div class="form-group">
          <label class="form-label">Motivo del Rechazo</label>
          <textarea class="form-textarea" id="reject-notes" rows="3" placeholder="Explica por qué el producto no es apto..." required></textarea>
        </div>
        <button type="submit" class="btn btn-danger btn-block btn-lg">❌ Confirmar Rechazo</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleRejectProduct(e, productId) {
  e.preventDefault();
  const result = await api.validateProduct(productId, {
    validation_status: 'rejected',
    is_natural: false,
    validation_notes: document.getElementById('reject-notes').value
  });

  if (result.success) {
    document.getElementById('reject-modal')?.remove();
    showToast('Producto rechazado', 'warning');
    navigateTo('/advisor/validate-products');
  } else {
    showToast(result.error || 'Error', 'error');
  }
}
