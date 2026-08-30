/**
 * AgroPasco — Módulo de Catálogo Supermercado
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
        ${user?.role === 'farmer' ? `<button class="btn btn-primary" onclick="showPublishModal()">📦 Publicar Producto</button>` : ''}
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
            <div class="product-card">
              <div class="product-card-img">
                ${cropIcons[prod.crop_type] || '🌾'}
                <div class="product-card-badge">
                  <span class="badge badge-${qualityColors[prod.quality] || 'green'}">${prod.quality}</span>
                </div>
                ${prod.certified_natural ? `<div style="position: absolute; top: 12px; left: 12px;"><span class="badge badge-green">🌿 Natural</span></div>` : ''}
              </div>
              <div class="product-card-body">
                <div class="product-card-name">${prod.name}</div>
                <div class="product-card-origin" style="color: var(--green-400); font-weight: 600; font-size: 13px;">
                  📍 Natural de ${prod.quality.charAt(0).toUpperCase() + prod.quality.slice(1)} de ${prod.origin || 'Yanahuanca, Pasco'}
                </div>
                <div class="text-sm text-muted" style="margin-top: 4px; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  ${prod.description || 'Producto agrícola certificado de la región Pasco.'}
                </div>
                ${prod.traceability_code ? `
                  <div style="font-size: 11px; color: var(--green-400); cursor: pointer;" onclick="viewProductTrace(${prod.id})">
                    📋 Trazabilidad: ${prod.traceability_code}
                  </div>
                ` : ''}
                <div class="product-card-footer">
                  <div class="product-card-price">S/ ${prod.price_per_kg?.toFixed(2)} <span>/ ${prod.unit || 'kg'}</span></div>
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
          <div class="empty-state-text">Los agricultores pueden publicar sus productos aquí.</div>
        </div>
      `}
    </div>
  `;
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
      <div style="margin-bottom: 16px;">
        <span class="badge badge-green">✅ ${trace.verification.verified ? 'Verificado' : 'No verificado'}</span>
        <span class="badge badge-blue" style="margin-left: 4px;">${trace.traceability_code}</span>
      </div>
      <div style="display: grid; gap: 10px; margin-bottom: 16px;">
        ${[
          ['Producto', trace.product.name],
          ['Calidad', trace.product.quality],
          ['Origen', trace.product.origin],
          ['Natural', trace.product.certified_natural ? '✅ Certificado Natural' : '❌ No certificado'],
          ['Productor', trace.farmer?.name || 'No registrado'],
          ['Ubicación', trace.farmer?.location || 'Región Pasco']
        ].map(([l, v]) => `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
            <span class="text-muted text-sm">${l}</span>
            <span style="font-weight: 600; font-size: 14px;">${v}</span>
          </div>
        `).join('')}
      </div>
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

function showPublishModal() {
  const user = getUser();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'publish-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>📦 Publicar Producto en Catálogo</h3>
        <button class="modal-close" onclick="document.getElementById('publish-modal').remove()">✕</button>
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
          <label class="form-label">📍 Lugar / Zona de Origen de Cosecha</label>
          <input type="text" class="form-input" id="pub-origin" value="${user?.location || 'Yanahuanca, Pasco'}" placeholder="Ej: Yanahuanca, Pasco" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Stock (kg)</label>
            <input type="number" class="form-input" id="pub-stock" placeholder="500" required>
          </div>
          <div class="form-group">
            <label class="form-label">Precio por kg (S/)</label>
            <input type="number" class="form-input" id="pub-price" step="0.01" placeholder="5.00" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Descripción</label>
          <textarea class="form-textarea" id="pub-description" placeholder="Describe tu producto..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">📦 Publicar en Catálogo</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handlePublishProduct(e) {
  e.preventDefault();
  const originVal = document.getElementById('pub-origin').value;
  const result = await api.publishProduct({
    name: document.getElementById('pub-name').value,
    crop_type: document.getElementById('pub-type').value,
    quality: document.getElementById('pub-quality').value,
    origin: originVal,
    stock_kg: parseFloat(document.getElementById('pub-stock').value),
    price_per_kg: parseFloat(document.getElementById('pub-price').value),
    description: document.getElementById('pub-description').value
  });

  if (result.success) {
    document.getElementById('publish-modal')?.remove();
    showToast('¡Producto publicado en el catálogo!', 'success');
    navigateTo('/supermarket');
  } else {
    showToast(result.error || 'Error al publicar', 'error');
  }
}
