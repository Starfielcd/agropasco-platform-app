/**
 * AgroPasco — Componente Reutilizable de Cámara en Vivo y Carga de Fotos
 * API de MediaDevices (getUserMedia) con captura en Canvas y subida al backend.
 * Refactorizado y blindado contra bloqueos de WebRTC, ghost clicks y desacoples de UI.
 */

const AgroMediaUploader = (function () {
  let activeStream = null;
  let currentFacingMode = 'environment'; // 'environment' (trasera) o 'user' (frontal)
  let isOpeningCamera = false;
  let isCapturing = false;

  /**
   * Renderiza el contenedor HTML para la captura/subida de foto.
   * @param {Object} options
   * @param {string} options.id - Prefijo de ID (ej: 'pest-photo', 'product-photo')
   * @param {string} options.folder - Carpeta de destino en backend ('pests', 'products', 'crops', 'parcels')
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
                  onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.openCamera('${id}', event); return false;">
            <span>📷</span>
            <strong id="${id}-btn-camera-text">Abrir Cámara</strong>
          </button>

          <button type="button" class="btn btn-secondary" id="${id}-btn-upload" style="flex: 1; min-width: 140px; display: flex; align-items: center; justify-content: center; gap: 6px;"
                  onclick="event.preventDefault(); event.stopPropagation(); document.getElementById('${id}-file-input')?.click(); return false;">
            <span>📁</span>
            <strong>Subir Imagen</strong>
          </button>
        </div>

        <!-- Input de archivo nativo aislado (sin capture para evitar conflictos con WebRTC) -->
        <input type="file" id="${id}-file-input" accept="image/*" style="display: none;"
               tabindex="-1" aria-hidden="true"
               onclick="event.stopPropagation();"
               onchange="AgroMediaUploader.handleFileSelected('${id}', this.files[0]); this.value = '';">

        <!-- Input oculto que almacena la URL final para el formulario -->
        <input type="hidden" id="${id}-value" value="${existingUrl || ''}">

        <!-- Previsualización de la Imagen -->
        <div id="${id}-preview-box" style="display: ${existingUrl ? 'block' : 'none'}; position: relative; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--border); background: rgba(0,0,0,0.3); max-height: 220px; text-align: center;">
          <img id="${id}-preview-img" src="${existingUrl || ''}" alt="Previsualización"
               style="max-height: 200px; max-width: 100%; object-fit: contain; cursor: pointer;"
               onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.previewEnlarged(this.src);">

          <!-- Barra de controles flotante sobre la imagen -->
          <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 6px;">
            <button type="button" class="btn btn-sm btn-secondary" style="background: rgba(15,23,42,0.85); font-size: 11px; padding: 4px 8px; backdrop-filter: blur(4px);"
                    title="Ver tamaño completo" onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.previewEnlarged(document.getElementById('${id}-preview-img')?.src);">
              🔍 Ampliar
            </button>
            <button type="button" class="btn btn-sm btn-danger" style="background: rgba(239,68,68,0.9); font-size: 11px; padding: 4px 8px;"
                    title="Quitar foto" onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.removePhoto('${id}', event);">
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
   * Abre el modal con la cámara en vivo del dispositivo usando getUserMedia.
   * Totalmente aislado contra submits accidentales, ghost clicks y bloqueos de interfaz.
   */
  async function openCamera(targetId, evt) {
    if (evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
      if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
    }

    if (isOpeningCamera) return;
    isOpeningCamera = true;

    const btn = document.getElementById(`${targetId}-btn-camera`);
    const btnText = document.getElementById(`${targetId}-btn-camera-text`);
    if (btn) {
      btn.disabled = true;
      if (btnText) btnText.textContent = 'Conectando...';
    }

    // Verificar soporte de MediaDevices
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      isOpeningCamera = false;
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.textContent = 'Abrir Cámara';
      }
      if (typeof showToast === 'function') {
        showToast('Tu navegador no admite WebRTC directo. Abriendo selector de archivos...', 'info');
      }
      document.getElementById(`${targetId}-file-input`)?.click();
      return;
    }

    // Limpiar modal previo y streams huérfanos antes de crear nuevo modal
    closeCameraModal();

    if (window.AgroLogger) AgroLogger.action('CAMERA', `Iniciando visor de cámara para ${targetId}`);

    // Modal de la cámara con accesibilidad y estilos explícitos anti-opacidad
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'camera-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Captura de Cámara en Vivo — AgroPasco');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 99999; opacity: 1 !important; visibility: visible !important; padding: 16px; box-sizing: border-box;';

    // Cierre al pulsar fondo oscuro (backdrop)
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        e.preventDefault();
        e.stopPropagation();
        closeCameraModal(targetId);
      }
    });

    // Soporte accesible de tecla Escape
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        closeCameraModal(targetId);
      }
    };
    window._cameraEscHandler = handleEscKey;
    window.addEventListener('keydown', handleEscKey);

    modal.innerHTML = `
      <div class="modal" style="max-width: 620px; width: 100%; padding: 0; overflow: hidden; background: #0b1120; border: 1.5px solid #3b82f6; border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,0.75); position: relative; display: flex; flex-direction: column;" onclick="event.stopPropagation()">
        
        <!-- Cabecera del Visor -->
        <div style="padding: 14px 18px; background: #0f172a; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">📷</span>
            <strong style="color: #ffffff; font-size: 15px; letter-spacing: -0.01em;">Captura en Vivo — AgroPasco</strong>
          </div>
          <button type="button" class="modal-close" aria-label="Cerrar cámara" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px; line-height: 1;"
                  onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); return false;">✕</button>
        </div>

        <!-- Visor de Video en Directo -->
        <div style="position: relative; width: 100%; height: 380px; background: #000000; display: flex; align-items: center; justify-content: center; overflow: hidden;">
          
          <!-- Pantalla de carga mientras se conecta la cámara -->
          <div id="camera-loading-overlay" style="position: absolute; inset: 0; background: #0b1120; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 5; gap: 12px; padding: 20px; text-align: center;">
            <div style="font-size: 38px; animation: spin 1.2s infinite linear;">📷</div>
            <strong style="color: #60a5fa; font-size: 15px;">Conectando con la cámara...</strong>
            <p style="color: #94a3b8; font-size: 12px; margin: 0; max-width: 340px; line-height: 1.4;">
              Si tu navegador solicita permisos de cámara, selecciona <strong>"Permitir"</strong>.
            </p>
            <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px;"
                    onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click(); return false;">
              📁 Tomar foto o elegir imagen del dispositivo
            </button>
          </div>

          <!-- Pantalla de error amigable con diagnóstico de permisos -->
          <div id="camera-error-overlay" style="position: absolute; inset: 0; background: #0b1120; display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 6; gap: 10px; padding: 24px; text-align: center;">
          </div>

          <!-- Elementos de Video y Canvas -->
          <video id="camera-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
          <canvas id="camera-canvas" style="display: none;"></canvas>

          <!-- Guía visual de encuadre agrícola -->
          <div style="position: absolute; inset: 24px; border: 2px dashed rgba(34,197,94,0.65); border-radius: 12px; pointer-events: none; display: flex; align-items: center; justify-content: center;">
            <span style="background: rgba(0,0,0,0.65); color: #4ade80; font-size: 11.5px; padding: 3px 10px; border-radius: 20px; font-weight: 500;">
              Encuadre: Parcela, cultivo, plaga o producto
            </span>
          </div>

          <!-- Destello simulado de disparo -->
          <div id="camera-shutter-flash" style="position: absolute; inset: 0; background: white; opacity: 0; pointer-events: none; transition: opacity 0.15s ease;"></div>
        </div>

        <!-- Barra de Botones de Control de la Cámara -->
        <div style="padding: 14px 18px; background: #0f172a; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; flex-shrink: 0;">
          <div style="display: flex; gap: 8px;">
            <button type="button" id="camera-btn-facing" class="btn btn-secondary btn-sm" disabled
                    onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.toggleCameraFacing('${targetId}', event); return false;" title="Alternar cámara trasera / frontal">
              🔄 Girar Cámara
            </button>
            <button type="button" id="camera-btn-gallery" class="btn btn-secondary btn-sm"
                    onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click(); return false;" title="Abrir cámara del sistema o galería">
              📁 Galería / Cámara Nativa
            </button>
          </div>

          <div style="display: flex; gap: 8px;">
            <button type="button" id="camera-btn-capture" class="btn btn-primary btn-lg" disabled
                    style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 10px 24px; font-weight: 700; box-shadow: 0 4px 16px rgba(34,197,94,0.4);"
                    onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.capturePhoto('${targetId}', event); return false;">
              📸 Capturar Foto
            </button>
            <button type="button" id="camera-btn-cancel" class="btn btn-secondary"
                    onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); return false;">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    try {
      await startVideoStream(currentFacingMode, targetId);
    } catch (err) {
      console.error('Error al inicializar cámara:', err);
    } finally {
      isOpeningCamera = false;
    }
  }

  /**
   * Conecta el flujo de la cámara con estrategia de doble intento (alta resolución ideal y fallback básico).
   */
  async function startVideoStream(facingMode, targetId) {
    const video = document.getElementById('camera-video');
    const loadingOverlay = document.getElementById('camera-loading-overlay');
    const errorOverlay = document.getElementById('camera-error-overlay');
    const btnCapture = document.getElementById('camera-btn-capture');
    const btnFacing = document.getElementById('camera-btn-facing');

    if (!video) return;

    // Detener tracks anteriores para liberar el hardware del dispositivo
    if (activeStream) {
      try {
        activeStream.getTracks().forEach(t => {
          try { t.stop(); } catch (_) {}
        });
      } catch (_) {}
      activeStream = null;
    }
    video.srcObject = null;

    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (errorOverlay) errorOverlay.style.display = 'none';
    if (btnCapture) btnCapture.disabled = true;
    if (btnFacing) btnFacing.disabled = true;

    try {
      // 1. Intento primario con resolución ideal y facingMode
      const primaryConstraints = {
        video: {
          facingMode: { ideal: facingMode || 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      try {
        activeStream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
        if (window.AgroLogger) AgroLogger.info('CAMERA', `Stream conectado con restricciones primarias (${facingMode})`);
      } catch (primaryErr) {
        console.warn('Fallo intento primario de cámara:', primaryErr.name || primaryErr.message);

        // Si fue una denegación explícita de permiso o problema de seguridad, no intentar fallback y propagar
        if (primaryErr.name === 'NotAllowedError' || primaryErr.name === 'PermissionDeniedError' || primaryErr.name === 'SecurityError') {
          throw primaryErr;
        }

        // 2. Fallback resiliente con video genérico
        if (window.AgroLogger) AgroLogger.info('CAMERA', 'Iniciando intento con fallback básico de video');
        activeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (!activeStream) {
        throw new Error('No se recibió ningún flujo de video del dispositivo.');
      }

      // Conectar stream al elemento <video>
      video.srcObject = activeStream;

      // Esperar a que los metadatos estén listos antes de reproducir para evitar AbortError
      await new Promise((resolve) => {
        if (video.readyState >= 2) {
          resolve();
        } else {
          const onReady = () => {
            video.removeEventListener('loadedmetadata', onReady);
            video.removeEventListener('canplay', onReady);
            resolve();
          };
          video.addEventListener('loadedmetadata', onReady);
          video.addEventListener('canplay', onReady);
          setTimeout(onReady, 1200); // Respaldo temporal de seguridad
        }
      });

      try {
        await video.play();
      } catch (playErr) {
        console.warn('Reproducción automática de video pausada o interrumpida:', playErr);
      }

      // UI en estado activo y listo
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (errorOverlay) errorOverlay.style.display = 'none';
      if (btnCapture) btnCapture.disabled = false;
      if (btnFacing) btnFacing.disabled = false;

    } catch (err) {
      console.warn('No se pudo iniciar el stream de video:', err.name || err.message);
      if (window.AgroLogger) AgroLogger.warn('CAMERA', 'Fallo de acceso a cámara WebRTC', { error: err.name || err.message });

      let errorTitle = 'No se pudo acceder a la cámara';
      let errorMessage = 'Verifica los permisos en tu navegador y asegúrate de que ninguna otra aplicación esté usando la cámara.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorTitle = 'Permiso de Cámara Denegado';
        errorMessage = 'El navegador o el usuario denegó el acceso a la cámara. Por favor habilita los permisos de cámara en la barra de direcciones y haz clic en "Reintentar".';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorTitle = 'Cámara No Encontrada';
        errorMessage = 'No se detectó ningún dispositivo de cámara en este equipo. Puedes usar la opción de subir una imagen desde tus archivos o galería.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorTitle = 'Cámara Ocupada o Bloqueada';
        errorMessage = 'La cámara está siendo utilizada por otra aplicación (Zoom, Meet, WhatsApp, etc.) o por el sistema operativo. Ciérrala y reintenta.';
      } else if (err.name === 'OverconstrainedError') {
        errorTitle = 'Resolución no Compatible';
        errorMessage = 'La cámara del dispositivo no admite la configuración solicitada.';
      } else if (err.name === 'SecurityError') {
        errorTitle = 'Conexión No Segura';
        errorMessage = 'El acceso a la cámara requiere una conexión HTTPS segura o entorno localhost.';
      }

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (errorOverlay) {
        errorOverlay.innerHTML = `
          <div style="font-size: 36px; margin-bottom: 4px;">📷⚠️</div>
          <strong style="color: #f87171; font-size: 15px; display: block; margin-bottom: 6px;">${errorTitle}</strong>
          <p style="color: #94a3b8; font-size: 12.5px; line-height: 1.4; margin: 0 0 16px 0; max-width: 380px;">
            ${errorMessage}
          </p>
          <div style="display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; justify-content: center;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.startVideoStream('${facingMode}', '${targetId}'); return false;">
              🔄 Reintentar
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); document.getElementById('${targetId}-file-input')?.click(); return false;">
              📁 Subir Imagen / Galería
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.closeCameraModal('${targetId}'); return false;">
              ✕ Cerrar
            </button>
          </div>
        `;
        errorOverlay.style.display = 'flex';
      }

      if (typeof showToast === 'function') {
        showToast(errorTitle, 'warning');
      }
    }
  }

  /**
   * Alterna entre cámara trasera y frontal.
   */
  async function toggleCameraFacing(targetId, evt) {
    if (evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    }

    const btnFacing = document.getElementById('camera-btn-facing');
    const btnCapture = document.getElementById('camera-btn-capture');
    if (btnFacing) btnFacing.disabled = true;
    if (btnCapture) btnCapture.disabled = true;

    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    const loadingOverlay = document.getElementById('camera-loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
      const strong = loadingOverlay.querySelector('strong');
      if (strong) {
        strong.textContent = currentFacingMode === 'user' ? 'Cambiando a cámara frontal...' : 'Cambiando a cámara trasera...';
      }
    }

    try {
      await startVideoStream(currentFacingMode, targetId);
    } finally {
      if (btnFacing) btnFacing.disabled = false;
    }
  }

  /**
   * Cierra el modal de la cámara, libera los tracks de hardware y restablece la UI.
   */
  function closeCameraModal(targetId) {
    if (window._cameraEscHandler) {
      window.removeEventListener('keydown', window._cameraEscHandler);
      window._cameraEscHandler = null;
    }

    if (activeStream) {
      try {
        const tracks = activeStream.getTracks();
        tracks.forEach(t => {
          try { t.stop(); } catch (_) {}
        });
      } catch (e) {
        console.warn('Error al detener tracks multimedia:', e);
      }
      activeStream = null;
    }

    const video = document.getElementById('camera-video');
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
      } catch (_) {}
    }

    const modal = document.getElementById('camera-modal');
    if (modal) {
      modal.remove();
    }

    isOpeningCamera = false;
    isCapturing = false;

    // Restaurar botones de apertura
    if (targetId) {
      const btn = document.getElementById(`${targetId}-btn-camera`);
      const btnText = document.getElementById(`${targetId}-btn-camera-text`);
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.textContent = 'Abrir Cámara';
      }
    } else {
      document.querySelectorAll('[id$="-btn-camera"]').forEach(b => {
        b.disabled = false;
        const textEl = b.querySelector('[id$="-btn-camera-text"]');
        if (textEl) textEl.textContent = 'Abrir Cámara';
      });
    }
  }

  /**
   * Captura el fotograma actual en un canvas y lo convierte a Blob/File de manera asíncrona no bloqueante.
   */
  async function capturePhoto(targetId, evt) {
    if (evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    }

    if (isCapturing) return;

    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const flash = document.getElementById('camera-shutter-flash');
    const btnCapture = document.getElementById('camera-btn-capture');

    if (!video || !canvas) return;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      if (typeof showToast === 'function') {
        showToast('La cámara aún se está inicializando. Espera un momento...', 'warning');
      }
      return;
    }

    isCapturing = true;
    if (btnCapture) {
      btnCapture.disabled = true;
      btnCapture.textContent = '📸 Procesando...';
    }

    // Efecto visual de obturador
    if (flash) {
      flash.style.opacity = '0.95';
      setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    try {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      // Invertir horizontalmente si es cámara frontal para modo espejo natural
      if (currentFacingMode === 'user') {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, width, height);

      // Conversión limpia a Blob sin bloquear el hilo de renderizado principal
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('No se pudo convertir el fotograma a Blob.'));
          }, 'image/jpeg', 0.88);
        } catch (err) {
          reject(err);
        }
      });

      // Vista previa local instantánea
      const localUrl = URL.createObjectURL(blob);
      showPreview(targetId, localUrl, `Captura en vivo (${(blob.size / 1024).toFixed(1)} KB)`);

      // Carpeta de destino
      const container = document.getElementById(`${targetId}-container`);
      const folder = container ? (container.getAttribute('data-folder') || 'general') : 'general';

      // Cerrar modal y liberar cámara inmediatamente
      closeCameraModal(targetId);

      // Crear objeto File para la subida multipart
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // Subir archivo al backend
      await uploadMultipartToServer(targetId, file, folder);

    } catch (err) {
      console.error('Error al capturar imagen:', err);
      if (typeof showToast === 'function') {
        showToast('Error al procesar la captura de imagen.', 'error');
      }
      if (btnCapture) {
        btnCapture.disabled = false;
        btnCapture.textContent = '📸 Capturar Foto';
      }
    } finally {
      isCapturing = false;
    }
  }

  // Alias para mantener compatibilidad con cualquier código que llame captureFrame
  const captureFrame = capturePhoto;

  /**
   * Maneja la selección de un archivo desde la galería o explorador nativo.
   */
  async function handleFileSelected(targetId, file) {
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.webm');

    if (!isImage && !isPdf && !isVideo) {
      if (typeof showToast === 'function') {
        showToast('Formato no compatible. Por favor sube una imagen (JPG/PNG), PDF o video MP4.', 'warning');
      }
      return;
    }

    const container = document.getElementById(`${targetId}-container`);
    const folder = container ? (container.getAttribute('data-folder') || 'general') : 'general';

    try {
      if (isImage) {
        const localUrl = URL.createObjectURL(file);
        showPreview(targetId, localUrl, `${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
        await uploadMultipartToServer(targetId, file, folder);
      } else if (isPdf) {
        showDocPreview(targetId, '📄 ' + file.name, `PDF · ${(file.size / 1024).toFixed(1)} KB`);
        await uploadMultipartToServer(targetId, file, folder);
      } else if (isVideo) {
        showVideoPreview(targetId, URL.createObjectURL(file), `Video · ${(file.size / (1024 * 1024)).toFixed(1)} MB`);
        await uploadMultipartToServer(targetId, file, folder);
      }
    } catch (err) {
      console.error('Error al manejar archivo seleccionado:', err);
      if (typeof showToast === 'function') {
        showToast('Error al procesar el archivo seleccionado.', 'error');
      }
    }
  }

  /**
   * Envía archivo multipart al backend (/api/upload).
   */
  async function uploadMultipartToServer(targetId, file, folder) {
    showLoading(targetId, true);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('folder', folder);

      const token = localStorage.getItem('agropasco_token');
      const response = await fetch(`/api/upload?folder=${encodeURIComponent(folder)}`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      const result = await response.json();

      if (result.success && result.url) {
        const valInput = document.getElementById(`${targetId}-value`);
        if (valInput) valInput.value = result.url;

        const previewImg = document.getElementById(`${targetId}-preview-img`);
        if (previewImg) previewImg.src = result.url;

        updateBadge(targetId, true);
        if (typeof showToast === 'function') {
          showToast('✅ Fotografía guardada y procesada correctamente.', 'success');
        }
        return result;
      } else {
        const errorMsg = result.error || 'Error al subir la fotografía al servidor.';
        if (typeof showToast === 'function') {
          showToast(errorMsg, 'error');
        }
        return null;
      }
    } catch (err) {
      console.error('Error en subida multipart:', err);
      if (typeof showToast === 'function') {
        showToast('Error de conexión al subir la fotografía al servidor.', 'error');
      }
      return null;
    } finally {
      showLoading(targetId, false);
    }
  }

  /**
   * Envía imagen en Base64 al backend (/api/upload/base64). Mantenido para retrocompatibilidad.
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

      if (result.success && result.url) {
        const valInput = document.getElementById(`${targetId}-value`);
        if (valInput) valInput.value = result.url;

        const previewImg = document.getElementById(`${targetId}-preview-img`);
        if (previewImg) previewImg.src = result.url;

        updateBadge(targetId, true);
        if (typeof showToast === 'function') {
          showToast('✅ Fotografía guardada y procesada correctamente.', 'success');
        }
        return result;
      } else {
        const errorMsg = result.error || 'Error al guardar la fotografía en el servidor.';
        if (typeof showToast === 'function') {
          showToast(errorMsg, 'error');
        }
        return null;
      }
    } catch (err) {
      console.error('Error en subida Base64:', err);
      if (typeof showToast === 'function') {
        showToast('Error de conexión al subir la fotografía.', 'error');
      }
      return null;
    } finally {
      showLoading(targetId, false);
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
      const docIcon = document.getElementById(`${targetId}-doc-icon`);
      if (docIcon) docIcon.style.display = 'none';
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
        docIcon.style.textAlign = 'center';
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
   * Componente para adjuntar materiales educativos y guías técnicas (PDFs y Videos).
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
                  onclick="event.preventDefault(); event.stopPropagation(); document.getElementById('${id}-file-input')?.click(); return false;">
            <span>📁</span>
            <strong>Seleccionar Archivo (PDF / Video)</strong>
          </button>
        </div>

        <input type="file" id="${id}-file-input" accept=".pdf,video/mp4,video/webm" style="display: none;"
               tabindex="-1" aria-hidden="true"
               onclick="event.stopPropagation();"
               onchange="AgroMediaUploader.handleFileSelected('${id}', this.files[0]); this.value = '';">
        <input type="hidden" id="${id}-value" value="${existingUrl || ''}">

        <div id="${id}-preview-box" style="display: ${existingUrl ? 'block' : 'none'}; padding: 10px; border-radius: 6px; border: 1px dashed var(--border); background: rgba(0,0,0,0.25);">
          <div id="${id}-file-meta" style="font-size: 12px; color: #38bdf8;">
            ${existingUrl ? '✓ Archivo cargado: ' + existingUrl : ''}
          </div>
          <button type="button" class="btn btn-sm btn-danger mt-xs" style="font-size: 10px; padding: 2px 6px;"
                  onclick="event.preventDefault(); event.stopPropagation(); AgroMediaUploader.removePhoto('${id}', event); return false;">
            Quitar adjunto
          </button>
        </div>

        <div id="${id}-loading" style="display: none; padding: 8px; text-align: center; font-size: 12px; color: var(--blue-400);">
          ⏳ Subiendo material al servidor...
        </div>
      </div>
    `;
  }

  function removePhoto(targetId, evt) {
    if (evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    }

    const valInput = document.getElementById(`${targetId}-value`);
    const previewBox = document.getElementById(`${targetId}-preview-box`);
    const fileInput = document.getElementById(`${targetId}-file-input`);
    const previewImg = document.getElementById(`${targetId}-preview-img`);
    const previewVideo = document.getElementById(`${targetId}-preview-video`);
    const docIcon = document.getElementById(`${targetId}-doc-icon`);

    if (valInput) valInput.value = '';
    if (previewBox) previewBox.style.display = 'none';
    if (fileInput) fileInput.value = '';
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (previewVideo) {
      previewVideo.src = '';
      previewVideo.style.display = 'none';
    }
    if (docIcon) {
      docIcon.style.display = 'none';
    }

    updateBadge(targetId, false);
    if (typeof showToast === 'function') {
      showToast('Archivo retirado.', 'info');
    }
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
   * Visor ampliado (Lightbox) para cualquier imagen de la plataforma.
   */
  function previewEnlarged(imgUrl, title = 'Fotografía en Detalle') {
    if (!imgUrl) return;

    const existingModal = document.getElementById('lightbox-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'lightbox-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100000; opacity: 1 !important; visibility: visible !important; padding: 16px; box-sizing: border-box;';

    const closeLightbox = () => {
      window.removeEventListener('keydown', handleEsc);
      modal.remove();
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', handleEsc);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      }
    });

    modal.innerHTML = `
      <div class="modal" style="max-width: 780px; width: 100%; padding: 0; overflow: hidden; background: rgba(15, 23, 42, 0.98); border: 1.5px solid var(--border); border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,0.8);" onclick="event.stopPropagation()">
        <div style="padding: 12px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
          <strong style="color: #ffffff; font-size: 14px;">🔍 ${title}</strong>
          <button type="button" class="modal-close" aria-label="Cerrar vista previa" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;"
                  onclick="event.preventDefault(); event.stopPropagation(); document.getElementById('lightbox-modal')?.remove();">✕</button>
        </div>
        <div style="padding: 16px; text-align: center; background: #000000; min-height: 200px; display: flex; align-items: center; justify-content: center;">
          <img src="${imgUrl}" alt="${title}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px;">
        </div>
        <div style="padding: 10px 18px; background: rgba(15, 23, 42, 0.95); display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; gap: 8px;">
          <span>AgroPasco Digital — Inspección Técnica Visual</span>
          <a href="${imgUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="font-size: 11px;">Descargar / Abrir en pestaña</a>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  return {
    render,
    renderAttachmentUploader,
    openCamera,
    capturePhoto,
    captureFrame,
    closeCameraModal,
    toggleCameraFacing,
    handleFileSelected,
    removePhoto,
    previewEnlarged,
    startVideoStream,
    uploadBase64ToServer,
    uploadMultipartToServer,
    showPreview,
    showDocPreview,
    showVideoPreview,
    getCurrentFacingMode: () => currentFacingMode
  };
})();
