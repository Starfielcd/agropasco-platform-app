/**
 * AgroPasco — Módulo de Trazabilidad Digital
 */

async function renderTraceabilityPage(cropId) {
  if (!cropId) {
    // List crops to select
    const result = await api.getCrops();
    const crops = result.data || [];

    return `
      <div class="page-content">
        <div class="mb-lg">
          <h3 style="font-size: 18px; font-weight: 700;">Trazabilidad Digital</h3>
          <p class="text-sm text-muted">Selecciona un cultivo para generar su reporte de trazabilidad completo.</p>
        </div>
        ${crops.length > 0 ? `
          <div class="grid-3">
            ${crops.map(crop => `
              <div class="crop-card" onclick="window.location.hash='#/traceability/${crop.id}'">
                <div class="crop-card-header">
                  <div>
                    <div class="crop-card-name">${crop.name}</div>
                    <div class="crop-card-type">${crop.crop_type}</div>
                  </div>
                  <div style="font-size: 28px;">📋</div>
                </div>
                <div class="mt-sm">
                  <span class="badge badge-green">${crop.total_logs || 0} registros</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">Sin cultivos para trazabilidad</div>
            <div class="empty-state-text">Registra un cultivo primero.</div>
            <a href="#/crops" class="btn btn-primary">Ir a Mis Cultivos</a>
          </div>
        `}
      </div>
    `;
  }

  // Show traceability report
  const result = await api.getTraceability(cropId);
  if (!result.success) return `<div class="page-content"><div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">${result.error}</div></div></div>`;

  const report = result.data;
  const timeline = report.timeline || [];

  return `
    <div class="page-content">
      <div class="flex items-center gap-md mb-lg">
        <a href="#/traceability" class="btn btn-secondary btn-sm">← Volver</a>
        <div style="flex: 1;">
          <h3 style="font-size: 20px; font-weight: 700;">📋 Reporte de Trazabilidad</h3>
          <p class="text-sm text-muted">Código: ${report.traceability_code}</p>
        </div>
        <span class="badge badge-green" style="font-size: 14px; padding: 6px 16px;">✅ Certificado</span>
      </div>

      <div class="grid-2">
        <!-- Report Info -->
        <div>
          <div class="card mb-md">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">🌿</span> Datos del Cultivo</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              ${[
                ['Producto', report.crop.name],
                ['Tipo', report.crop.type],
                ['Variedad', report.crop.variety || 'Nativa'],
                ['Área', `${report.crop.area_hectares || 0} ha`],
                ['Altitud', `${report.crop.altitude || 4380} msnm`],
                ['Estado', report.crop.status],
                ['Siembra', report.crop.planting_date || 'No registrada'],
                ['Ubicación', report.crop.location || 'Región Pasco']
              ].map(([l, v]) => `
                <div style="padding: 10px; background: var(--bg-glass); border-radius: 6px;">
                  <div class="text-sm text-muted">${l}</div>
                  <div style="font-weight: 600; margin-top: 2px;">${v}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">👤</span> Productor</div>
            </div>
            <div style="display: flex; align-items: center; gap: 16px; padding: 12px; background: var(--bg-glass); border-radius: var(--radius-sm);">
              <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, var(--green-500), var(--blue-500)); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;">
                ${(report.farmer?.name || 'A')[0]}
              </div>
              <div>
                <div style="font-weight: 600;">${report.farmer?.name || 'Agricultor AgroPasco'}</div>
                <div class="text-sm text-muted">📍 ${report.farmer?.location || 'Región Pasco, Perú'}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon">📊</span> Resumen</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="stat-card" style="--stat-color: var(--green-500)">
                <div class="stat-card-value">${report.summary.total_activities}</div>
                <div class="stat-card-label">Actividades registradas</div>
              </div>
              <div class="stat-card" style="--stat-color: var(--blue-500)">
                <div class="stat-card-value">${report.summary.days_since_planting || '--'}</div>
                <div class="stat-card-label">Días desde siembra</div>
              </div>
            </div>
            ${report.summary.activities_by_type ? `
              <div class="mt-md">
                <div class="text-sm text-muted mb-md">Actividades por tipo:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${Object.entries(report.summary.activities_by_type).map(([type, count]) => `
                    <span class="badge badge-blue">${type}: ${count}</span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Timeline -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon">📅</span> Línea de Tiempo del Cultivo</div>
          </div>
          ${timeline.length > 0 ? `
            <div class="timeline">
              ${timeline.map(entry => {
                const actionIcons = { siembra: '🌱', riego: '💧', fertilizacion: '🌿', fumigacion: '🧴', aporque: '🏔️', poda: '✂️', cosecha: '🧺', inspeccion: '🔍', alerta_clima: '⚠️', otro: '📋' };
                return `
                  <div class="timeline-item">
                    <div class="timeline-date">${new Date(entry.date).toLocaleString('es-PE')}</div>
                    <div class="timeline-action">${actionIcons[entry.action] || '📋'} ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}</div>
                    <div class="timeline-description">${entry.description}</div>
                    ${entry.weather_at_time ? `
                      <div class="timeline-weather">
                        🌡️ ${entry.weather_at_time.temp?.toFixed(1) ?? '--'}°C | 
                        💧 ${entry.weather_at_time.humidity ?? '--'}% | 
                        ${entry.weather_at_time.condition ?? ''}
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="text-center text-muted mt-md">No hay registros en la línea de tiempo.</div>'}
        </div>
      </div>

      <div class="card mt-lg" style="border-left: 4px solid var(--green-500);">
        <div class="flex items-center gap-md">
          <div style="font-size: 32px;">✅</div>
          <div>
            <div style="font-weight: 700;">Verificación AgroPasco Digital</div>
            <div class="text-sm text-muted">Este reporte fue generado automáticamente por la plataforma AgroPasco. Código de trazabilidad: <strong>${report.traceability_code}</strong></div>
            <div class="text-sm text-muted mt-sm">Generado: ${new Date(report.generated_at).toLocaleString('es-PE')}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}
