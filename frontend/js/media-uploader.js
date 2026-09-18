/**
 * AgroPasco — Componente Reutilizable de Cámara en Vivo y Carga de Fotos
 * API de MediaDevices (getUserMedia) con captura en Canvas y subida al backend.
 */

const AgroMediaUploader = (function() {
  let activeStream = null;
  let currentFacingMode = 'environment'; // 'environment' (trasera) o 'user' (frontal)

  /**
   * Renderiza el contenedor HTML para la captura/subida de foto.
   * @param {Object} options
   * @param {string} options.id - Prefijo de ID (ej: 'pest-photo', 'product-photo')
   * @param {string} options.folder - Carpeta de destino en backend ('pests', 'products')
   * @param {string} options.label - Etiqueta del campo
   * @param {string} [options.existingUrl] - URL existente (para edición)
   */
  function render(options) {
    const { id, folder = 'general', label = 'Fotografía en Vivo o Archivo', existingUrl = '' } = options;

    return `
      <div class="agro-media-uploader" id="${id}-container" data-folder="${folder}">
        <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
          <span>📸 ${label}</span>
          <span class="badge badge-green text-xs" id="${id}-status-badge" style="display: ${existingUrl ? 'inline-block' : 'none'};">
            ${existingUrl ? '✓ Foto cargada' : ''}
          </span>
        </label>

        <!-- Botones de Acción: Abrir Cámara y Subir Imagen -->
        <div style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-primary" id="${id}-btn-camera" style="flex: 1; min-width: 140px; display: flex; align-items: center; justify-content: center; gap: 6px;"
                  onclick="AgroMediaUploader.openCamera('${id}')">
            <span>📷</span>
            <strong id="${id}-btn-camera-text">Abrir Cámara</strong>
          </button>

          <button type="button" class="btn btn-secondary" style="flex: 1; min-width: 140px; display: flex; align-items: center; justify-content: center; gap: 6px;"
                  onclick="document.getElementById('${id}-file-input').click()">
            <span>📁</span>
            <strong>Subir Imagen</strong>
          </button>
        </div>

        <!-- Input de archivo nativo oculto (con capture para cámara directa en móviles) -->
        <input type="file" id="${id}-file-input" accept="image/*" capture="environment" style="display: none;"
               onchange="AgroMediaUploader.handleFileSelected('${id}', this.files[0])">

        <!-- Input oculto que guarda la URL final para el formulario -->
        <input type="hidden" id="${id}-value" value="${existingUrl || ''}">

        <!-- Previsualización de la Imagen -->
        <div id="${id}-preview-box" style="display: ${existingUrl ? 'block' : 'none'}; position: relative; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--border); background: rgba(0,0,0,0.3); max-height: 220px; text-align: center;">
          <img id="${id}-preview-img" src="${existingUrl || ''}" alt="Previsualización"
               style="max-height: 200px; max-width: 100%; object-fit: contain; cursor: pointer;"
               onclick="AgroMediaUploader.previewEnlarged(this.src)">

          <!-- Barra de controles sobre la imagen -->
          <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 6px;">
            <button type="button" class="btn btn-sm btn-secondary" style="background: rgba(15,23,42,0.8); font-size: 11px; padding: 4px 8px;"
                    title="Ver tamaño completo" onclick="AgroMediaUploader.previewEnlarged(document.getElementById('${id}-preview-img').src)">
              🔍 Ampliar
            </button>
            <button type="button" class="btn btn-sm btn-danger" style="background: rgba(239,68,68,0.85); font-size: 11px; padding: 4px 8px;"
                    title="Quitar foto" onclick="AgroMediaUploader.removePhoto('${id}')">
              ✕ Quitar
            </button>
          </div>

          <div id="${id}-file-meta" style="padding: 4px 8px; background: rgba(15,23,42,0.85); font-size: 11px; color: #94a3b8; border-top: 1px solid var(--border); text-align: left;">
            ✓ Fotografía lista para asociar al registro
          </div>
        </div>

        <!-- Indicador de carga -->
        <div id="${id}-loading" style="display: none; padding: 12px; text-align: center; background: rgba(59,130,246,0.1); border-radius: 6px; border: 1px dashed var(--blue-500); margin-top: 6px;">
          <span style="display: inline-block; animation: spin 1s infinite linear;">⏳</span> Subiendo y procesando imagen en el servidor...
        </div>
      </div>
    `;
  }

  /**
   * Abre el modal con la cámara en vivo del dispositivo usando getUserMedia
   * con timeout de seguridad y fallback fluido para evitar congelamientos.
   */
  async function openCamera(targetId) {
    const btn = document.getElementById(`${targetId}-btn-camera`);
    const btnText = document.getElementById(`${targetId}-btn-camera-text`);
    if (btn) {
      btn.disabled = true;
      if (btnText) btnText.textContent = 'Conectando...';
    }

    const restoreBtn = () => {
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.textContent = 'Abrir Cámara';
      }
    };

    // Verificar soporte de MediaDevices
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      restoreBtn();
      showToast('Tu navegador no soporta WebRTC directo. Abriendo cámara/galería del sistema...', 'info');
      document.getElementById(`${targetId}-file-input`)?.click();
      return;
    }

    // Modal de la cámara
    const existingModal = document.getElementById('camera-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'camera-modal';
    modal.style.zIndex = '99999';

    modal.innerHTML = `
      <div class="modal" style="max-width: 620px; padding: 0; overflow: hidden; background: #0b1120; border: 1.5px solid #3b82f6;">
        <!-- Cabecera de la Cámara -->
        <div style="padding: 14px 18px; background: #0f172a; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">📷</span>
            <strong style="color: #ffffff; font-size: 15px;">Captura en Vivo — AgroPasco</strong>
          </div>
          <button class="modal-close" onclick="AgroMediaUploader.closeCameraModal('${targetId}')">✕</button>
        </div>

        <!-- Visor de Video en Directo -->
        <div style="position: relative; width: 100%; height: 380px; background: #000000; display: flex; align-items: center; justify-content: center; overflow: hidden;">
          <!-- Pantalla de carga mientras se conecta la cámara -->
          <div id="camera-loading-overlay" style="position: absolute; inset: 0; background: #0b1120; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 5; gap: 12px; padding: 20px; text-align: center;">
            <div style="font-size: 38px; animation: spin 1.2s infinite linear;">📷</div>
            <strong style="color: #60a5fa; font-size: 15px;">Conectando con la cámara...</strong>
            <p style="color: #94a3b8; font-size: 12px; margin: 0; max-width: 340px;">
              Si el navegador te solicita permisos de cámara, selecciona <strong>"Permitir"</strong>.
            </p>
            <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px;"
                    onclick="AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click();">
              📁 Tomar foto o elegir imagen del dispositivo
            </button>
          </div>

          <!-- Video en directo -->
          <video id="camera-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
          <canvas id="camera-canvas" style="display: none;"></canvas>

          <!-- Guía visual de encuadre agrícola -->
          <div style="position: absolute; inset: 24px; border: 2px dashed rgba(34,197,94,0.65); border-radius: 12px; pointer-events: none; display: flex; align-items: center; justify-content: center;">
            <span style="background: rgba(0,0,0,0.6); color: #4ade80; font-size: 11.5px; padding: 3px 10px; border-radius: 20px;">
              Encuadre: Parcela, cultivo, plaga o producto
            </span>
          </div>

          <!-- Destello de disparo simulado -->
          <div id="camera-shutter-flash" style="position: absolute; inset: 0; background: white; opacity: 0; pointer-events: none; transition: opacity 0.15s ease;"></div>
        </div>

        <!-- Barra de Botones de Control de la Cámara -->
        <div style="padding: 14px 18px; background: #0f172a; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="AgroMediaUploader.toggleCameraFacing('${targetId}')" title="Alternar cámara trasera / frontal">
              🔄 Girar Cámara
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click();" title="Abrir cámara del sistema o galería">
              📁 Galería / Cámara Nativa
            </button>
          </div>

          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-primary btn-lg" style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 10px 24px; font-weight: 700; box-shadow: 0 4px 16px rgba(34,197,94,0.4);"
                    onclick="AgroMediaUploader.captureFrame('${targetId}')">
              📸 Capturar Foto
            </button>
            <button type="button" class="btn btn-secondary" onclick="AgroMediaUploader.closeCameraModal('${targetId}')">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    restoreBtn();

    // Iniciar el stream de video con protección de timeout
    await startVideoStream(currentFacingMode, targetId);
  }

  async function startVideoStream(facingMode, targetId) {
    const video = document.getElementById('camera-video');
    const loadingOverlay = document.getElementById('camera-loading-overlay');
    if (!video) return;

    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }

    const getUserMediaWithTimeout = (constraints, ms = 4500) => {
      return Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_CAMARA')), ms))
      ]);
    };

    try {
      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      activeStream = await getUserMediaWithTimeout(constraints, 4500);
      video.srcObject = activeStream;
      await video.play().catch(() => {});
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (err) {
      console.warn('Primer intento de cámara falló o tardó:', err.message);
      // Fallback a configuración básica sin constraints de resolución
      try {
        activeStream = await getUserMediaWithTimeout({ video: true, audio: false }, 3500);
        video.srcObject = activeStream;
        await video.play().catch(() => {});
        if (loadingOverlay) loadingOverlay.style.display = 'none';
      } catch (fallbackErr) {
        console.warn('Fallback WebRTC falló:', fallbackErr.message);
        if (loadingOverlay) {
          loadingOverlay.innerHTML = `
            <div style="font-size: 34px;">📷⚠️</div>
            <strong style="color: #f87171; font-size: 14px;">No se pudo acceder a la cámara en vivo</strong>
            <p style="color: #94a3b8; font-size: 12px; margin: 0; max-width: 320px;">
              ${fallbackErr.message === 'TIMEOUT_CAMARA' ? 'La cámara tardó demasiado en responder o está en uso por otra app.' : 'Tu navegador requiere permisos o no detectó cámara física disponible.'}
            </p>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button type="button" class="btn btn-primary" onclick="AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click();">
                📸 Tomar foto con Cámara Nativa / Archivo
              </button>
              <button type="button" class="btn btn-secondary" onclick="AgroMediaUploader.closeCameraModal('${targetId}')">
                Cerrar
              </button>
            </div>
          `;
        }
        showToast('Puedes tomar foto o subir archivo directamente desde tu dispositivo.', 'info');
      }
    }
  }

  async function toggleCameraFacing(targetId) {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    await startVideoStream(currentFacingMode, targetId);
  }

  function closeCameraModal(targetId) {
    if (activeStream) {
      try {
        activeStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      activeStream = null;
    }
    const video = document.getElementById('camera-video');
    if (video) video.srcObject = null;
    document.getElementById('camera-modal')?.remove();

    if (targetId) {
      const btn = document.getElementById(`${targetId}-btn-camera`);
      const btnText = document.getElementById(`${targetId}-btn-camera-text`);
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.textContent = 'Abrir Cámara';
      }
    }
  }

  /**
   * Captura el fotograma actual del elemento <video> en un <canvas> y lo envía al backend
   */
  async function captureFrame(targetId) {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const flash = document.getElementById('camera-shutter-flash');
    if (!video || !canvas) return;

    // Efecto visual de obturador
    if (flash) {
      flash.style.opacity = '0.9';
      setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    // Configurar dimensiones reales
    const width = video.videoWidth || 800;
    const height = video.videoHeight || 600;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    // Obtener imagen en Base64 JPEG con 88% de calidad
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

    // Detener la cámara y cerrar modal
    closeCameraModal(targetId);

    // Obtener la carpeta de destino desde el contenedor
    const container = document.getElementById(`${targetId}-container`);
    const folder = container ? (container.getAttribute('data-folder') || 'general') : 'general';

    // Subir imagen al servidor
    await uploadBase64ToServer(targetId, dataUrl, folder);
  }

  /**
   * Maneja la selección de un archivo desde la galería, explorador o gestor de archivos
   */
  async function handleFileSelected(targetId, file) {
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.webm');

    if (!isImage && !isPdf && !isVideo) {
      showToast('Formato no compatible. Por favor sube una imagen (JPG/PNG), documento PDF o video MP4.', 'warning');
      return;
    }

    const container = document.getElementById(`${targetId}-container`);
    const folder = container ? (container.getAttribute('data-folder') || 'general') : 'general';

    if (isImage) {
      // Mostrar previsualización instantánea local de imagen
      const reader = new FileReader();
      reader.onload = async function(e) {
        const dataUrl = e.target.result;
        showPreview(targetId, dataUrl, `${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
        await uploadMultipartToServer(targetId, file, folder);
      };
      reader.readAsDataURL(file);
    } else if (isPdf) {
      showDocPreview(targetId, '📄 ' + file.name, `PDF · ${(file.size / 1024).toFixed(1)} KB`);
      await uploadMultipartToServer(targetId, file, folder);
    } else if (isVideo) {
      showVideoPreview(targetId, URL.createObjectURL(file), `Video · ${(file.size / (1024 * 1024)).toFixed(1)} MB`);
      await uploadMultipartToServer(targetId, file, folder);
    }
  }

  /**
   * Envía imagen capturada en Base64 al backend (/api/upload/base64)
   */
  async function uploadBase64ToServer(targetId, dataUrl, folder) {
    showLoading(targetId, true);
    showPreview(targetId, dataUrl, 'Captura en vivo');

    try {
      const token = localStorage.getItem('agropasco_token');
      const response = await fetch('/api/upload/base64', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ image: dataUrl, folder })
      });

      const result = await response.json();
      showLoading(targetId, false);

      if (result.success && result.url) {
        document.getElementById(`${targetId}-value`).value = result.url;
        document.getElementById(`${targetId}-preview-img`).src = result.url;
        updateBadge(targetId, true);
        showToast('✅ Fotografía guardada y procesada correctamente.', 'success');
      } else {
        showToast(result.error || 'Error al guardar la fotografía en el servidor.', 'error');
      }
    } catch (err) {
      showLoading(targetId, false);
      console.error('Error en subida:', err);
      showToast('Error de conexión al subir la fotografía.', 'error');
    }
  }

  /**
   * Envía archivo multipart al backend (/api/upload)
   */
  async function uploadMultipartToServer(targetId, file, folder) {
    showLoading(targetId, true);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('folder', folder);

      const token = localStorage.getItem('agropasco_token');
      const response = await fetch(`/api/upload?folder=${folder}`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      const result = await response.json();
      showLoading(targetId, false);

      if (result.success && result.url) {
        document.getElementById(`${targetId}-value`).value = result.url;
        document.getElementById(`${targetId}-preview-img`).src = result.url;
        updateBadge(targetId, true);
        showToast('✅ Imagen subida exitosamente.', 'success');
      } else {
        showToast(result.error || 'Error al subir la imagen.', 'error');
      }
    } catch (err) {
      showLoading(targetId, false);
      console.error('Error en subida multipart:', err);
      showToast('Error al subir imagen al servidor.', 'error');
    }
  }

  function showPreview(targetId, src, metaText = '') {
    const previewBox = document.getElementById(`${targetId}-preview-box`);
    const previewImg = document.getElementById(`${targetId}-preview-img`);
    const metaBox = document.getElementById(`${targetId}-file-meta`);

    if (previewBox && previewImg) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      const videoEl = document.getElementById(`${targetId}-preview-video`);
      if (videoEl) videoEl.style.display = 'none';
      previewBox.style.display = 'block';
    }
    if (metaBox && metaText) {
      metaBox.textContent = `✓ ${metaText}`;
    }
  }

  function showDocPreview(targetId, docTitle, metaText = '') {
    const previewBox = document.getElementById(`${targetId}-preview-box`);
    const previewImg = document.getElementById(`${targetId}-preview-img`);
    const metaBox = document.getElementById(`${targetId}-file-meta`);

    if (previewBox) {
      if (previewImg) previewImg.style.display = 'none';
      let docIcon = document.getElementById(`${targetId}-doc-icon`);
      if (!docIcon) {
        docIcon = document.createElement('div');
        docIcon.id = `${targetId}-doc-icon`;
        docIcon.style.padding = '24px';
        docIcon.style.fontSize = '32px';
        previewBox.prepend(docIcon);
      }
      docIcon.innerHTML = `📄 <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-top: 6px;">${docTitle}</div>`;
      docIcon.style.display = 'block';
      previewBox.style.display = 'block';
    }
    if (metaBox && metaText) {
      metaBox.textContent = `✓ ${metaText}`;
    }
  }

  function showVideoPreview(targetId, videoSrc, metaText = '') {
    const previewBox = document.getElementById(`${targetId}-preview-box`);
    const previewImg = document.getElementById(`${targetId}-preview-img`);
    const metaBox = document.getElementById(`${targetId}-file-meta`);

    if (previewBox) {
      if (previewImg) previewImg.style.display = 'none';
      let videoEl = document.getElementById(`${targetId}-preview-video`);
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = `${targetId}-preview-video`;
        videoEl.controls = true;
        videoEl.style.maxHeight = '200px';
        videoEl.style.maxWidth = '100%';
        previewBox.prepend(videoEl);
      }
      videoEl.src = videoSrc;
      videoEl.style.display = 'block';
      previewBox.style.display = 'block';
    }
    if (metaBox && metaText) {
      metaBox.textContent = `✓ ${metaText}`;
    }
  }

  /**
   * Componente para adjuntar materiales educativos y guías técnicas (PDFs y Videos)
   */
  function renderAttachmentUploader(options) {
    const { id, folder = 'documents', label = 'Guía Técnica PDF o Video Explicativo', existingUrl = '' } = options;
    return `
      <div class="agro-media-uploader" id="${id}-container" data-folder="${folder}">
        <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
          <span>📎 ${label}</span>
          <span class="badge badge-blue text-xs" id="${id}-status-badge" style="display: ${existingUrl ? 'inline-block' : 'none'};">
            ${existingUrl ? '✓ Archivo adjunto' : ''}
          </span>
        </label>

        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" style="display: flex; align-items: center; gap: 6px;"
                  onclick="document.getElementById('${id}-file-input').click()">
            <span>📁</span>
            <strong>Seleccionar Archivo (PDF / Video)</strong>
          </button>
        </div>

        <input type="file" id="${id}-file-input" accept=".pdf,video/mp4,video/webm" style="display: none;"
               onchange="AgroMediaUploader.handleFileSelected('${id}', this.files[0])">
        <input type="hidden" id="${id}-value" value="${existingUrl || ''}">

        <div id="${id}-preview-box" style="display: ${existingUrl ? 'block' : 'none'}; padding: 10px; border-radius: 6px; border: 1px dashed var(--border); background: rgba(0,0,0,0.25);">
          <div id="${id}-file-meta" style="font-size: 12px; color: #38bdf8;">
            ${existingUrl ? '✓ Archivo cargado: ' + existingUrl : ''}
          </div>
          <button type="button" class="btn btn-sm btn-danger mt-xs" style="font-size: 10px; padding: 2px 6px;" onclick="AgroMediaUploader.removePhoto('${id}')">Quitar adjunto</button>
        </div>

        <div id="${id}-loading" style="display: none; padding: 8px; text-align: center; font-size: 12px; color: var(--blue-400);">
          ⏳ Subiendo material al servidor...
        </div>
      </div>
    `;
  }

  function removePhoto(targetId) {
    const valInput = document.getElementById(`${targetId}-value`);
    const previewBox = document.getElementById(`${targetId}-preview-box`);
    const fileInput = document.getElementById(`${targetId}-file-input`);

    if (valInput) valInput.value = '';
    if (previewBox) previewBox.style.display = 'none';
    if (fileInput) fileInput.value = '';

    updateBadge(targetId, false);
    showToast('Archivo retirado.', 'info');
  }

  function showLoading(targetId, isLoading) {
    const loader = document.getElementById(`${targetId}-loading`);
    if (loader) loader.style.display = isLoading ? 'block' : 'none';
  }

  function updateBadge(targetId, hasPhoto) {
    const badge = document.getElementById(`${targetId}-status-badge`);
    if (badge) {
      badge.style.display = hasPhoto ? 'inline-block' : 'none';
      badge.textContent = hasPhoto ? '✓ Foto cargada' : '';
    }
  }

  /**
   * Visor ampliado (Lightbox) para cualquier imagen de la plataforma
   */
  function previewEnlarged(imgUrl, title = 'Fotografía en Detalle') {
    if (!imgUrl) return;

    const existingModal = document.getElementById('lightbox-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'lightbox-modal';
    modal.style.zIndex = '100000';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
      <div class="modal" style="max-width: 780px; padding: 0; overflow: hidden; background: rgba(15, 23, 42, 0.98); border: 1.5px solid var(--border);">
        <div style="padding: 12px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
          <strong style="color: #ffffff; font-size: 14px;">🔍 ${title}</strong>
          <button class="modal-close" onclick="document.getElementById('lightbox-modal').remove()">✕</button>
        </div>
        <div style="padding: 16px; text-align: center; background: #000000;">
          <img src="${imgUrl}" alt="${title}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px;">
        </div>
        <div style="padding: 10px 18px; background: rgba(15, 23, 42, 0.95); display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted);">
          <span>AgroPasco Digital — Inspección Técnica Visual</span>
          <a href="${imgUrl}" target="_blank" class="btn btn-sm btn-secondary" style="font-size: 11px;">Descargar / Abrir en pestaña</a>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  return {
    render,
    renderAttachmentUploader,
    openCamera,
    captureFrame,
    closeCameraModal,
    toggleCameraFacing,
    handleFileSelected,
    removePhoto,
    previewEnlarged
  };
})();
