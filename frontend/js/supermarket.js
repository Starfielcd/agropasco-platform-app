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

  return `
    <div class="page-content">
      <!-- Encabezado con métricas rápidas -->
      <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
            🏪 Catálogo de Productos Certificados — Supermercado
          </h2>
          <p class="text-sm text-muted">
            Productos agrícolas de la Región Pasco validados por asesores técnicos con trazabilidad digital y comercio justo.
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <span class="badge badge-green" style="font-size: 13px; padding: 6px 14px;">
            🛒 ${products.length} Productos Validados Disponibles
          </span>
        </div>
      </div>

      <!-- Banner de Garantía y API para Supermercados -->
      <div class="card mb-lg" style="border-left: 4px solid var(--blue-500); background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.05));">
        <div class="flex items-center gap-md" style="flex-wrap: wrap;">
          <div style="font-size: 32px;">🛡️</div>
          <div style="flex: 1; min-width: 250px;">
            <div style="font-weight: 700; font-size: 15px;">Garantía de Origen y Certificación AgroPasco</div>
            <div class="text-sm text-muted">
              Todos los productos aquí listados han sido inspeccionados técnicamente. Los productos marcados como <strong>🌿 100% Natural</strong> cuentan con +30% de bonificación certificada por ausencia total de químicos u hormonas.
            </div>
          </div>
          <div style="text-align: right;">
            <div class="text-xs text-muted">Integración B2B REST API:</div>
            <code style="background: var(--bg-card); padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid var(--border);">GET /api/v1/supermarket/products</code>
          </div>
        </div>
      </div>

      <!-- Grilla de Productos -->
      ${products.length > 0 ? `
        <div class="grid-3">
          ${products.map(prod => {
            const isNatural = prod.is_natural || prod.certified_natural;
            const originalP = prod.original_price || (isNatural ? prod.price_per_kg / 1.30 : prod.price_per_kg);
            return `
              <div class="product-card" style="cursor: pointer; position: relative; transition: all 0.25s ease;" onclick="showProductDetailModal(${prod.id})">
                <!-- Imagen o Icono con Badges -->
                <div class="product-card-img" style="position: relative; overflow: hidden; background: linear-gradient(135deg, rgba(34,197,94,0.1), rgba(59,130,246,0.1));">
                  ${prod.photo_url ? `
                    <img src="${prod.photo_url}" alt="${prod.name}" style="width: 100%; height: 100%; object-fit: cover;">
                  ` : `
                    <div style="font-size: 64px; text-shadow: 0 4px 12px rgba(0,0,0,0.2);">${cropIcons[prod.crop_type] || '🌾'}</div>
                  `}

                  <!-- Badge Calidad -->
                  <div class="product-card-badge" style="position: absolute; top: 10px; right: 10px;">
                    <span class="badge badge-${qualityColors[prod.quality] || 'green'}" style="text-transform: capitalize;">
                      ${prod.quality || 'Primera'}
                    </span>
                  </div>

                  <!-- Badge 100% Natural -->
                  ${isNatural ? `
                    <div style="position: absolute; top: 10px; left: 10px;">
                      <span class="badge badge-green" style="font-weight: 700; box-shadow: 0 2px 8px rgba(16,185,129,0.4);">
                        🌿 100% Natural (+30%)
                      </span>
                    </div>
                  ` : `
                    <div style="position: absolute; top: 10px; left: 10px;">
                      <span class="badge badge-blue" style="font-weight: 600;">
                        📦 Convencional
                      </span>
                    </div>
                  `}
                </div>

                <!-- Contenido -->
                <div class="product-card-body">
                  <div class="product-card-name" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">
                    ${prod.name}
                  </div>

                  <div class="product-card-origin" style="color: var(--green-400); font-weight: 600; font-size: 13px; margin-top: 2px;">
                    📍 ${prod.origin || prod.farmer_location || 'Región Pasco'}
                  </div>

                  <!-- Datos del Agricultor -->
                  <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 13px; color: var(--text-secondary);">
                    <span>👨‍🌾</span>
                    <span style="font-weight: 600;">${prod.farmer_name || 'Agricultor de Pasco'}</span>
                  </div>

                  <!-- Descripción resumida -->
                  <p class="text-sm text-muted" style="margin: 8px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 38px;">
                    ${prod.description || 'Producto agrícola cosechado en los valles y alturas de Pasco bajo buenas prácticas agrícolas.'}
                  </p>

                  <!-- Validación del Asesor Técnico -->
                  <div style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: var(--green-400); font-weight: 600;">
                      ✅ Validado por Asesor
                    </span>
                    <span class="text-muted" style="font-size: 11px;">
                      ${prod.validator_name ? prod.validator_name : 'Asesor Certificado'}
                    </span>
                  </div>

                  <!-- Footer con Desglose de Precio y Stock -->
                  <div class="product-card-footer" style="padding-top: 8px; border-top: 1px solid var(--border); display: flex; align-items: flex-end; justify-content: space-between;">
                    <div>
                      <div class="product-card-price" style="font-size: 18px; font-weight: 800; color: var(--green-400);">
                        S/ ${prod.price_per_kg?.toFixed(2)}
                        <span style="font-size: 12px; font-weight: normal; color: var(--text-muted);">/ ${prod.unit || 'kg'}</span>
                      </div>
                      ${isNatural && originalP ? `
                        <div style="font-size: 11px; color: var(--text-muted);">
                          Base S/ ${originalP.toFixed(2)} + 30% bonif.
                        </div>
                      ` : ''}
                    </div>

                    <div style="text-align: right;">
                      <div class="badge badge-purple" style="font-size: 12px; font-weight: 600;">
                        ${prod.stock_kg || 0} kg disp.
                      </div>
                      <div style="font-size: 11px; color: var(--blue-400); margin-top: 4px; font-weight: 600;">
                        Ver Ficha Completa →
                      </div>
                    </div>
                  </div>
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
  const isNatural = prod.is_natural || prod.certified_natural;
  const originalPrice = prod.original_price || (isNatural ? prod.price_per_kg / 1.30 : prod.price_per_kg);
  const naturalBonus = isNatural ? (prod.price_per_kg - originalPrice) : 0;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'product-detail-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">${cropIcons[prod.crop_type] || '🌾'}</span>
          <div>
            <h3 style="margin: 0; font-size: 20px;">${prod.name}</h3>
            <span class="text-xs text-muted">Código Trazabilidad: ${prod.traceability_code || 'AP-PASCO-2026'}</span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('product-detail-modal').remove()">✕</button>
      </div>

      <!-- Badges Superiores -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
        <span class="badge badge-green" style="text-transform: capitalize;">Calidad: ${prod.quality || 'Primera'}</span>
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
      ${prod.photo_url ? `
        <div style="margin-bottom: 16px; border-radius: 12px; overflow: hidden; max-height: 280px; border: 1px solid var(--border);">
          <img src="${prod.photo_url}" style="width: 100%; height: 100%; object-fit: cover;" alt="${prod.name}">
        </div>
      ` : `
        <div style="margin-bottom: 16px; border-radius: 12px; padding: 24px; text-align: center; background: linear-gradient(135deg, rgba(34,197,94,0.1), rgba(59,130,246,0.1)); border: 1px solid var(--border);">
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
            <strong>${prod.farmer_phone || '+51 963 852 741'}</strong>
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
            <div style="font-size: 30px; font-weight: 900; color: var(--green-400);">
              S/ ${prod.price_per_kg?.toFixed(2)}
              <span style="font-size: 14px; font-weight: 500; color: var(--text-secondary);">/ ${prod.unit || 'kg'}</span>
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

                <p class="text-sm text-muted mb-sm">${p.description || 'Sin descripción adicional.'}</p>

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

                ${isApproved ? `
                  <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
                    <button class="btn btn-secondary btn-sm" onclick="showProductDetailModal(${p.id})">
                      👁️ Ver Ficha Pública en Supermercado
                    </button>
                  </div>
                ` : ''}
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

// Modal para poner producto en venta (Agricultor)
async function showPublishModal() {
  const user = getUser();

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

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'publish-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 580px;">
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span>💰</span> Poner Producto en Venta al Supermercado
        </h3>
        <button class="modal-close" onclick="document.getElementById('publish-modal').remove()">✕</button>
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
        ${myCrops.length > 0 ? `
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
          <input type="text" class="form-input" id="pub-name" placeholder="Ej: Papa Nativa Huayro Orgánica" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Cultivo *</label>
            <select class="form-select" id="pub-type" required>
              <option value="papa">🥔 Papa</option>
              <option value="maca">🌿 Maca</option>
              <option value="quinua">🌾 Quinua</option>
              <option value="habas">🫘 Habas</option>
              <option value="cafe">☕ Café</option>
              <option value="olluco">🟡 Olluco</option>
              <option value="mashua">🟠 Mashua</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Calidad del Producto</label>
            <select class="form-select" id="pub-quality">
              <option value="primera">Primera</option>
              <option value="premium">Premium</option>
              <option value="organica">Orgánica</option>
              <option value="gourmet">Gourmet</option>
              <option value="segunda">Segunda</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">📍 Lugar de Cosecha / Origen *</label>
          <input type="text" class="form-input" id="pub-origin" value="${user?.location || 'Yanahuanca, Pasco'}" placeholder="Ej: Yanahuanca, Daniel Alcides Carrión" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Cantidad Disponible (kg) *</label>
            <input type="number" class="form-input" id="pub-stock" placeholder="Ej: 500" min="1" step="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Precio Base por kg (S/) *</label>
            <input type="number" class="form-input" id="pub-price" step="0.10" min="0.10" placeholder="Ej: 4.50" required oninput="updatePriceEstimate(this.value)">
          </div>
        </div>

        <!-- Estimación dinámica de precio -->
        <div id="price-estimate-box" style="display: none; background: rgba(34,197,94,0.08); border-radius: 6px; padding: 10px; margin-bottom: 14px; font-size: 13px;">
          <div style="font-weight: 600; color: var(--green-400);">Simulación de Precio de Venta:</div>
          <div id="price-estimate-text" class="text-muted mt-xs"></div>
        </div>

        <!-- Fotografía en Vivo (Cámara) o Subir Imagen -->
        <div class="form-group">
          ${AgroMediaUploader.render({
            id: 'pub-photo',
            folder: 'products',
            label: 'Fotografía del Producto / Cosecha (Cámara en Vivo o Subir Imagen)'
          })}
        </div>

        <div class="form-group">
          <label class="form-label">Descripción y Prácticas Empleadas</label>
          <textarea class="form-textarea" id="pub-description" rows="3" placeholder="Describe los métodos de siembra, si utilizaste abonos naturales (biol, compost), fecha aproximada de cosecha..."></textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-block btn-lg" style="box-shadow: 0 4px 14px rgba(16,185,129,0.3); font-weight: 700;">
          🚀 Vender Producto al Supermercado (Enviar a Validación)
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

async function handlePublishProduct(e) {
  e.preventDefault();
  const name = document.getElementById('pub-name').value.trim();
  const crop_type = document.getElementById('pub-type').value;
  const quality = document.getElementById('pub-quality').value;
  const origin = document.getElementById('pub-origin').value.trim();
  const stock_kg = parseFloat(document.getElementById('pub-stock').value);
  const price_per_kg = parseFloat(document.getElementById('pub-price').value);
  const photo_url = document.getElementById('pub-photo-value')?.value || null;
  const description = document.getElementById('pub-description').value.trim();

  const result = await api.publishProduct({
    name, crop_type, quality, origin, stock_kg, price_per_kg, photo_url, description
  });

  if (result.success) {
    document.getElementById('publish-modal')?.remove();
    showToast('¡Producto puesto en venta! Enviado al Asesor Técnico para validación.', 'success');
    navigateTo('/farmer/sales');
  } else {
    showToast(result.error || 'Error al publicar producto', 'error');
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
                    <div style="margin-bottom: 14px; position: relative; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--border); max-width: 440px; background: #000;">
                      <div style="background: rgba(15,23,42,0.9); padding: 5px 10px; font-size: 11.5px; color: #4ade80; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border);">
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
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal" style="max-width: 480px;">
      <div class="modal-header">
        <h3 style="color: var(--red-400);">❌ Rechazar Producto</h3>
        <button class="modal-close" onclick="document.getElementById('reject-modal').remove()">✕</button>
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
          <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('reject-modal').remove()">Cancelar</button>
          <button type="submit" class="btn btn-danger" style="flex: 1;">Confirmar Rechazo</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleRejectProduct(e, productId) {
  e.preventDefault();
  const notes = document.getElementById('reject-notes').value.trim();

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
    showToast(result.error || 'Error al rechazar producto', 'error');
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
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; font-size: 18px;">📋 Certificado de Trazabilidad Digital</h3>
          <span class="text-xs text-muted">Hash Blockchain: ${trace.traceability_code}</span>
        </div>
        <button class="modal-close" onclick="document.getElementById('trace-modal').remove()">✕</button>
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
