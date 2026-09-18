/**
 * AgroPasco — Sistema Centralizado de Logs y Auditoría de Interacciones (Frontend)
 * Registra eventos de UI, clics en botones críticos, errores de cámara y respuestas de red.
 */

const AgroLogger = (function() {
  const MAX_LOGS = 100;
  const STORAGE_KEY = 'agropasco_client_logs';

  function getStoredLogs() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLogs(logs) {
    try {
      if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {}
  }

  function addLog(level, category, message, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(), // 'INFO', 'WARN', 'ERROR', 'ACTION'
      category: category,        // 'CAMERA', 'CROP', 'PARCEL', 'PEST', 'PRODUCT', 'AUTH'
      message: message,
      details: details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : null
    };

    // Imprimir en consola con estilo visual profesional
    const badgeColors = {
      INFO: 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px;',
      ACTION: 'background: #22c55e; color: white; padding: 2px 6px; border-radius: 4px;',
      WARN: 'background: #f59e0b; color: black; padding: 2px 6px; border-radius: 4px;',
      ERROR: 'background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px;'
    };

    const style = badgeColors[entry.level] || 'color: #94a3b8;';
    console.log(`%c[${entry.level}]%c [${entry.category}] ${entry.message}`, style, 'color: #38bdf8;', details || '');

    const logs = getStoredLogs();
    logs.push(entry);
    saveLogs(logs);

    return entry;
  }

  return {
    info: (category, message, details) => addLog('INFO', category, message, details),
    action: (category, message, details) => addLog('ACTION', category, message, details),
    warn: (category, message, details) => addLog('WARN', category, message, details),
    error: (category, message, details) => addLog('ERROR', category, message, details),

    getLogs: () => getStoredLogs(),
    clearLogs: () => {
      sessionStorage.removeItem(STORAGE_KEY);
      console.log('🧹 Logs de AgroPasco limpiados.');
    },

    /**
     * Envoltorio seguro para botones que previene doble-clic
     * @param {HTMLElement} buttonElement
     * @param {string} loadingText
     * @param {Function} asyncFn
     */
    wrapButtonAction: async function(buttonElement, loadingText, asyncFn) {
      if (!buttonElement || buttonElement.disabled) return;

      const originalHtml = buttonElement.innerHTML;
      buttonElement.disabled = true;
      buttonElement.setAttribute('aria-busy', 'true');
      buttonElement.innerHTML = `<span>⏳</span> ${loadingText}`;

      try {
        return await asyncFn();
      } catch (err) {
        addLog('ERROR', 'UI_BUTTON', 'Error durante ejecución de acción de botón', { error: err.message, stack: err.stack });
        throw err;
      } finally {
        if (buttonElement && document.body.contains(buttonElement)) {
          buttonElement.disabled = false;
          buttonElement.removeAttribute('aria-busy');
          buttonElement.innerHTML = originalHtml;
        }
      }
    }
  };
})();

// Exponer en objeto global
window.AgroLogger = AgroLogger;
