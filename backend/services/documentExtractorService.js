/**
 * AgroPasco Digital — Servicio de Extracción Documental Segura
 * ==============================================================================
 * FASE 9-L06: Extracción local con preservación de páginas, auditoría y ciberseguridad
 *
 * Controles de seguridad implementados:
 *  - Prevención estricta de Path Traversal
 *  - Límite de tamaño máximo (15 MB)
 *  - Validación de extensiones autorizadas (.pdf, .md, .txt, .json)
 *  - Detección de archivos cifrados o protegidos
 *  - Detección de páginas ilegibles (scanned / corrupted) sin inventar texto
 *  - Detección de tablas y advertencias de gráficos/imágenes no extraídos
 *  - Neutralización y detección de Prompt Injection indirecta
 *  - Cero exposición de rutas internas del servidor
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.md', '.txt', '.json']);

const PROMPT_INJECTION_PATTERNS = [
  /(?:ignore|olvida|ignora)\s+(?:todas\s+las|all)\s+(?:instrucciones|instructions)/i,
  /(?:system\s+prompt|prompt\s+del\s+sistema)\s*(?:override|reemplazo|bypass|reset)/i,
  /(?:you\s+are\s+now|ahora\s+eres)\s+(?:a\s+different|un\s+asistente\s+sin\s+restricciones|unrestricted)/i,
  /<\s*script[^>]*>/i,
  /javascript\s*:/i,
  /(?:modo\s+desarrollador|developer\s+mode)\s*(?:activado|enabled)/i
];

let pdfjsInstance = null;
async function loadPdfJs() {
  if (pdfjsInstance) return pdfjsInstance;
  try {
    const candidatePath = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    if (fs.existsSync(candidatePath)) {
      pdfjsInstance = await import(pathToFileURL(candidatePath).href);
    } else {
      pdfjsInstance = await import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsInstance;
  } catch (err) {
    return null;
  }
}

class DocumentExtractorService {
  constructor(options = {}) {
    this.maxSizeBytes = options.maxSizeBytes || MAX_FILE_SIZE_BYTES;
    this.allowedBaseDir = options.allowedBaseDir
      ? path.resolve(options.allowedBaseDir)
      : path.resolve(__dirname, '..', 'knowledge');
  }

  /**
   * Valida la ruta de un archivo contra Path Traversal y escape por symlinks
   */
  validatePathSafety(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      return { safe: false, error: 'Ruta de archivo no especificada o inválida.' };
    }

    // Caracteres nulos
    if (targetPath.includes('\0')) {
      return { safe: false, error: 'Intento de inyección de byte nulo detectado.' };
    }

    const resolved = path.resolve(targetPath);
    const allowedRoot = path.resolve(this.allowedBaseDir);

    // Debe residir dentro de allowedBaseDir o subdirectorios permitidos
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
      return { safe: false, error: 'Acceso no autorizado: la ruta se encuentra fuera del directorio de conocimiento permitido.' };
    }

    // Comprobación de symlinks si el archivo existe
    if (fs.existsSync(resolved)) {
      try {
        const real = fs.realpathSync(resolved);
        if (!real.startsWith(allowedRoot + path.sep) && real !== allowedRoot) {
          return { safe: false, error: 'Acceso no autorizado: enlace simbólico apunta fuera del directorio permitido.' };
        }
      } catch (_) {}
    }

    return { safe: true, resolvedPath: resolved };
  }

  /**
   * Analiza un texto en busca de patrones de Prompt Injection indirecta
   */
  detectPromptInjectionRisk(text) {
    if (!text || typeof text !== 'string') return false;
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sanitiza el texto extraído para prevenir ejecución accidental de código
   */
  sanitizeExtractedText(text) {
    if (!text || typeof text !== 'string') return '';
    // Eliminar etiquetas de script HTML
    let cleaned = text.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '[CONTENIDO SCRIPT REMOVIDO POR SEGURIDAD]');
    cleaned = cleaned.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '[IFRAME REMOVIDO]');
    cleaned = cleaned.replace(/javascript\s*:/gi, 'blocked_script:');
    return cleaned;
  }

  /**
   * Extrae y procesa un documento local de manera segura
   */
  async extractDocument(filePath, docId = 'UNKNOWN') {
    // 1. Control de Path Traversal
    const pathCheck = this.validatePathSafety(filePath);
    if (!pathCheck.safe) {
      return {
        success: false,
        error: pathCheck.error,
        security_flags: { path_traversal_attempt: true }
      };
    }

    const safePath = pathCheck.resolvedPath;

    // 2. Comprobación de existencia
    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: 'El archivo especificado no existe en el almacenamiento local.',
        security_flags: { file_not_found: true }
      };
    }

    // 3. Comprobación de tamaño de archivo
    const stat = fs.statSync(safePath);
    if (stat.size > this.maxSizeBytes) {
      return {
        success: false,
        error: `El archivo excede el tamaño máximo permitido (${(this.maxSizeBytes / (1024 * 1024)).toFixed(1)} MB).`,
        security_flags: { oversized: true, file_size_bytes: stat.size }
      };
    }

    // 4. Comprobación de extensión
    const ext = path.extname(safePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: `Extensión de archivo "${ext}" no autorizada. Extensiones permitidas: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}.`,
        security_flags: { invalid_extension: true }
      };
    }

    // 5. Cálculo de hash SHA-256 de integridad del archivo fuente
    const fileBuffer = fs.readFileSync(safePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 6. Extracción según el formato
    try {
      if (ext === '.pdf') {
        return await this.extractFromPdfBuffer(fileBuffer, docId, safePath, fileHash, stat.size);
      } else if (ext === '.json') {
        return this.extractFromJsonBuffer(fileBuffer, docId, safePath, fileHash, stat.size);
      } else {
        // .txt o .md
        return this.extractFromTextBuffer(fileBuffer, docId, safePath, fileHash, stat.size, ext);
      }
    } catch (err) {
      return {
        success: false,
        error: `Error durante la extracción documental: ${err.message}`,
        security_flags: { extraction_error: true }
      };
    }
  }

  /**
   * Extractor para archivos de texto plano y Markdown (.txt, .md)
   */
  extractFromTextBuffer(buffer, docId, safePath, fileHash, fileSize, ext) {
    const rawContent = buffer.toString('utf8');
    const hasInjection = this.detectPromptInjectionRisk(rawContent);
    const sanitized = this.sanitizeExtractedText(rawContent);

    // Segmentación por páginas explícitas (e.g. "--- PAGE X ---" o cortes de página FF \x0C)
    let pageChunks = sanitized.split(/\x0C|(?:\r?\n-{3,}\s*(?:PÁGINA|PAGINA|PAGE)\s*(\d+)\s*-{3,})/i);

    let pages = [];
    if (pageChunks.length <= 1) {
      // Documento continuo sin marcas de página
      pages.push({
        page_number: 1,
        raw_text: sanitized.trim(),
        is_unreadable: sanitized.trim().length === 0,
        has_table: /\|.*\|.*\|/.test(sanitized),
        table_fallback: false,
        has_unextracted_images: /!\[.*?\]\(.*?\)/.test(sanitized),
        warnings: []
      });
    } else {
      let currentPageNum = 1;
      for (let i = 0; i < pageChunks.length; i++) {
        const chunk = pageChunks[i];
        if (!chunk) continue;
        if (/^\d+$/.test(chunk.trim())) {
          currentPageNum = parseInt(chunk.trim(), 10);
          continue;
        }
        const text = chunk.trim();
        if (text.length > 0) {
          pages.push({
            page_number: currentPageNum,
            raw_text: text,
            is_unreadable: false,
            has_table: /\|.*\|.*\|/.test(text),
            table_fallback: false,
            has_unextracted_images: /!\[.*?\]\(.*?\)/.test(text),
            warnings: []
          });
          currentPageNum++;
        }
      }
    }

    return {
      success: true,
      document_id: docId,
      file_name: path.basename(safePath),
      file_size_bytes: fileSize,
      file_hash_sha256: fileHash,
      file_type: ext.substring(1),
      page_count: pages.length,
      pages,
      full_text: sanitized,
      security_flags: {
        prompt_injection_risk: hasInjection,
        oversized: false,
        encrypted: false,
        malformed: false
      }
    };
  }

  /**
   * Extractor para archivos estructurados JSON (.json)
   */
  extractFromJsonBuffer(buffer, docId, safePath, fileHash, fileSize) {
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch (_) {
      return {
        success: false,
        error: 'El archivo JSON está malformado y no pudo ser interpretado.',
        security_flags: { malformed: true }
      };
    }

    const pages = [];
    if (Array.isArray(parsed.pages)) {
      for (let i = 0; i < parsed.pages.length; i++) {
        const p = parsed.pages[i];
        const pageNum = p.page_number || (i + 1);
        const text = this.sanitizeExtractedText(p.text || p.content || '');
        const isUnreadable = Boolean(p.is_unreadable || text.trim().length === 0);
        pages.push({
          page_number: pageNum,
          raw_text: text,
          is_unreadable: isUnreadable,
          has_table: Boolean(p.has_table),
          table_fallback: Boolean(p.table_fallback),
          has_unextracted_images: Boolean(p.has_unextracted_images),
          warnings: isUnreadable ? ['Página marcada como ilegible en origen.'] : []
        });
      }
    } else {
      const fullText = this.sanitizeExtractedText(typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed));
      pages.push({
        page_number: 1,
        raw_text: fullText,
        is_unreadable: fullText.trim().length === 0,
        has_table: false,
        table_fallback: false,
        has_unextracted_images: false,
        warnings: []
      });
    }

    const fullText = pages.map(p => p.raw_text).join('\n\n');
    const hasInjection = this.detectPromptInjectionRisk(fullText);

    return {
      success: true,
      document_id: docId,
      file_name: path.basename(safePath),
      file_size_bytes: fileSize,
      file_hash_sha256: fileHash,
      file_type: 'json',
      page_count: pages.length,
      pages,
      full_text: fullText,
      security_flags: {
        prompt_injection_risk: hasInjection,
        oversized: false,
        encrypted: false,
        malformed: false
      }
    };
  }

  /**
   * Extractor robusto y seguro para formato PDF
   * Utiliza motor especializado pdfjs-dist con aislamiento estricto (isEvalSupported: false)
   * y fallback determinista nativo.
   */
  async extractFromPdfBuffer(buffer, docId, safePath, fileHash, fileSize) {
    const rawHead = buffer.subarray(0, 1024).toString('binary');

    // 1. Detección de encabezado PDF válido
    if (!rawHead.includes('%PDF-')) {
      return {
        success: false,
        error: 'El archivo no tiene un encabezado PDF válido (%PDF-). Archivo malformado o corrupto.',
        security_flags: { malformed: true }
      };
    }

    // 2. Detección de PDF cifrado (/Encrypt)
    if (/\/Encrypt\s+/i.test(buffer.toString('binary'))) {
      return {
        success: false,
        error: 'Documento PDF protegido o cifrado. No se puede procesar automáticamente.',
        security_flags: { encrypted: true }
      };
    }

    // 3. Intento con motor especializado pdfjs-dist
    const pdfjs = await loadPdfJs();
    if (pdfjs) {
      try {
        const uint8Data = new Uint8Array(buffer);
        const loadingTask = pdfjs.getDocument({
          data: uint8Data,
          isEvalSupported: false,
          disableFontFace: true,
          stopAtErrors: false
        });

        // Timeout defensivo de 30 segundos
        const docPromise = loadingTask.promise;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de extracción PDF (30s superado)')), 30000)
        );

        const pdfDoc = await Promise.race([docPromise, timeoutPromise]);
        const numPages = pdfDoc.numPages;
        const pages = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();

          let lastY = null;
          let pageTextLines = [];
          let currentLine = '';

          for (const item of textContent.items) {
            if (typeof item.str !== 'string') continue;
            const itemY = item.transform ? item.transform[5] : null;
            if (lastY !== null && itemY !== null && Math.abs(itemY - lastY) > 5) {
              if (currentLine.trim()) pageTextLines.push(currentLine.trim());
              currentLine = item.str;
            } else {
              currentLine += (currentLine.length > 0 && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
            }
            lastY = itemY;
          }
          if (currentLine.trim()) pageTextLines.push(currentLine.trim());

          const rawText = pageTextLines.join('\n').replace(/[ \t]+/g, ' ').trim();
          const isUnreadable = rawText.length < 20;
          const sanitized = this.sanitizeExtractedText(rawText);
          const hasTable = /\b(?:tabla|cuadro|rendimiento|dosis|tratamiento)\b/i.test(sanitized) && (/\t|\s{4,}/.test(sanitized) || /\|.*\|/.test(sanitized));

          const warnings = [];
          if (isUnreadable) {
            warnings.push(`Página ${pageNum} ilegible o basada en imágenes escaneadas sin capa de texto OCR.`);
          }
          if (hasTable) {
            warnings.push(`Página ${pageNum} contiene posibles estructuras tabulares extraídas en flujo de texto.`);
          }

          pages.push({
            page_number: pageNum,
            raw_text: isUnreadable ? '' : sanitized,
            is_unreadable: isUnreadable,
            has_table: hasTable,
            table_fallback: hasTable,
            has_unextracted_images: false,
            warnings
          });
        }

        const fullText = pages.filter(p => !p.is_unreadable).map(p => p.raw_text).join('\n\n');
        const hasInjection = this.detectPromptInjectionRisk(fullText);

        return {
          success: true,
          document_id: docId,
          file_name: path.basename(safePath),
          file_size_bytes: fileSize,
          file_hash_sha256: fileHash,
          file_type: 'pdf',
          extraction_engine: 'pdfjs-dist',
          page_count: pages.length,
          pages,
          full_text: fullText,
          security_flags: {
            prompt_injection_risk: hasInjection,
            oversized: false,
            encrypted: false,
            malformed: false
          }
        };
      } catch (err) {
        if (/InvalidPDFException|malformed|corrupted|FormatError/i.test(err.message)) {
          return {
            success: false,
            error: `PDF malformado o estructura corrupta: ${err.message}`,
            security_flags: { malformed: true }
          };
        }
      }
    }

    // Fallback nativo determinista
    return this.extractFromPdfBufferNative(buffer, docId, safePath, fileHash, fileSize);
  }

  /**
   * Extractor nativo determinista para fallback de pruebas
   */
  extractFromPdfBufferNative(buffer, docId, safePath, fileHash, fileSize) {
    const rawPdf = buffer.toString('binary');
    const pageMatches = rawPdf.split(/\/Type\s*\/Page\b/g);
    const pages = [];
    const hasImagesGlobal = /\/Subtype\s*\/Image\b/i.test(rawPdf);

    if (pageMatches.length <= 1) {
      const text = this.extractTextFromPdfStream(rawPdf);
      const isUnreadable = text.trim().length < 20;
      const sanitized = this.sanitizeExtractedText(text);

      pages.push({
        page_number: 1,
        raw_text: isUnreadable ? '' : sanitized,
        is_unreadable: isUnreadable,
        has_table: /\b(?:tabla|cuadro|rendimiento|dosis)\b/i.test(text) && /\t|\s{4,}/.test(text),
        table_fallback: true,
        has_unextracted_images: hasImagesGlobal,
        warnings: isUnreadable
          ? ['Página ilegible o basada exclusivamente en imagen escaneada sin capa OCR.']
          : (hasImagesGlobal ? ['El documento contiene imágenes técnicas no extraídas.'] : [])
      });
    } else {
      for (let i = 1; i < pageMatches.length; i++) {
        const pageContent = pageMatches[i];
        const pageText = this.extractTextFromPdfStream(pageContent);
        const isUnreadable = pageText.trim().length < 15;
        const sanitized = this.sanitizeExtractedText(pageText);
        const hasTable = /\b(?:tabla|cuadro|rendimiento|dosis)\b/i.test(sanitized) && /\t|\s{4,}/.test(sanitized);

        const warnings = [];
        if (isUnreadable) {
          warnings.push(`Página ${i} ilegible o basada en imágenes escaneadas sin capa de texto.`);
        }
        if (hasImagesGlobal && /\/Image\b/i.test(pageContent)) {
          warnings.push(`Página ${i} contiene gráficos o imágenes técnicas no extraídas.`);
        }

        pages.push({
          page_number: i,
          raw_text: isUnreadable ? '' : sanitized,
          is_unreadable: isUnreadable,
          has_table: hasTable,
          table_fallback: hasTable,
          has_unextracted_images: Boolean(hasImagesGlobal && /\/Image\b/i.test(pageContent)),
          warnings
        });
      }
    }

    const fullText = pages.filter(p => !p.is_unreadable).map(p => p.raw_text).join('\n\n');
    const hasInjection = this.detectPromptInjectionRisk(fullText);

    return {
      success: true,
      document_id: docId,
      file_name: path.basename(safePath),
      file_size_bytes: fileSize,
      file_hash_sha256: fileHash,
      file_type: 'pdf',
      extraction_engine: 'native_regex_fallback',
      page_count: pages.length,
      pages,
      full_text: fullText,
      security_flags: {
        prompt_injection_risk: hasInjection,
        oversized: false,
        encrypted: false,
        malformed: false
      }
    };
  }

  /**
   * Decodifica y extrae secuencias de texto (Tj, TJ) de bloques PDF
   */
  extractTextFromPdfStream(streamBlock) {
    const textPieces = [];

    // Buscar cadenas dentro de paréntesis en operaciones Tj: (Texto) Tj
    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let match;
    while ((match = tjRegex.exec(streamBlock)) !== null) {
      textPieces.push(this.decodePdfString(match[1]));
    }

    // Buscar arrays de texto en operaciones TJ: [(Tex) 20 (to)] TJ
    const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((match = tjArrayRegex.exec(streamBlock)) !== null) {
      const inner = match[1];
      const strRegex = /\(([^)]+)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(inner)) !== null) {
        textPieces.push(this.decodePdfString(strMatch[1]));
      }
    }

    return textPieces.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Decodifica caracteres especiales escapados en literales de texto PDF
   */
  decodePdfString(pdfStr) {
    return pdfStr
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
  }
}

module.exports = {
  DocumentExtractorService,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS
};
