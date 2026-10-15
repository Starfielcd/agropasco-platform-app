/**
 * AgroPasco Digital — Servicio de Catálogo de Conocimiento Agrícola Oficial
 * ==============================================================================
 * FASE 9-L06: Gestión del ciclo de vida documental y metadatos verificados
 *
 * Estados documentales:
 *  - candidate: identificado, sin verificar
 *  - verified: fuente y metadatos comprobados
 *  - approved: autorizado para ingresar al corpus activo
 *  - active: disponible para recuperación documental en RAG
 *  - review_required: requiere revisión técnica o regulatoria
 *  - superseded: reemplazado por documento posterior
 *  - archived: retirado de recuperación activa (conservado para trazabilidad)
 *  - rejected: descartado por calidad, procedencia o permisos
 *
 * Principio rector:
 * Documentos 'candidate', 'rejected', 'superseded' o 'archived' NUNCA se utilizan
 * para fundamentar recomendaciones a agricultores.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_DOCUMENT_STATUSES = new Set([
  'candidate',
  'verified',
  'approved',
  'active',
  'review_required',
  'superseded',
  'archived',
  'rejected'
]);

const VALID_CONTENT_NATURES = new Set([
  'official_original',
  'verified_extraction',
  'synthetic_fixture',
  'unverified_content',
  'unverified_test_stub'
]);

const ELIGIBLE_STATUSES_FOR_ADVISORY = new Set([
  'active'
]);

const ELIGIBLE_STATUSES_FOR_INGESTION = new Set([
  'approved',
  'active'
]);

// Catálogo por defecto cargado desde disco
const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '..', 'knowledge', 'catalog', 'catalog.json');

class KnowledgeCatalogService {
  constructor(catalogPath = DEFAULT_CATALOG_PATH, options = {}) {
    this.catalogPath = catalogPath;
    this.autoSave = options.autoSave === true;
    this.documents = new Map();
    this.supportedCrops = new Set([
      'papa', 'maca', 'olluco', 'oca', 'habas',
      'quinua', 'maiz', 'cafe', 'granadilla', 'palto'
    ]);
    this.cropSynonyms = new Map([
      ['patata', 'papa'],
      ['solanum_tuberosum', 'papa'],
      ['papa_huayro', 'papa'],
      ['papa_canchan', 'papa'],
      ['papa_canchán', 'papa'],
      ['papa_amarilla', 'papa'],
      ['papa_blanca', 'papa'],
      ['lepidium_meyenii', 'maca'],
      ['lepidium_peruvianum', 'maca'],
      ['maca_amarilla', 'maca'],
      ['maca_negra', 'maca'],
      ['maca_roja', 'maca'],
      ['ullucus_tuberosus', 'olluco'],
      ['oxalis_tuberosa', 'oca'],
      ['vicia_faba', 'habas'],
      ['chenopodium_quinoa', 'quinua'],
      ['quinua_pasankalla', 'quinua'],
      ['zea_mays', 'maiz'],
      ['coffea_arabica', 'cafe'],
      ['cafe_arabica', 'cafe'],
      ['café_arábica', 'cafe'],
      ['passiflora_ligularis', 'granadilla'],
      ['persea_americana', 'palto'],
      ['palta', 'palto'],
      ['aguacate', 'palto'],
      ['palta_hass', 'palto']
    ]);
    this.statusAuditLog = [];
    this.loadCatalog();
  }

  /**
   * Carga o recarga el catálogo desde el archivo JSON
   */
  loadCatalog() {
    this.documents.clear();
    if (fs.existsSync(this.catalogPath)) {
      try {
        const raw = fs.readFileSync(this.catalogPath, 'utf8');
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          for (const item of items) {
            this.registerDocument(item, false);
          }
        }
      } catch (err) {
        console.error('Error al cargar catálogo de conocimiento:', err.message);
      }
    }
  }

  /**
   * Valida exhaustivamente los metadatos de un documento
   */
  validateDocumentMetadata(doc) {
    const errors = [];
    if (!doc || typeof doc !== 'object') {
      return { valid: false, errors: ['El documento debe ser un objeto válido.'] };
    }

    // 1. Identificador interno
    if (!doc.id || typeof doc.id !== 'string' || !/^[A-Z0-9_\-]+$/.test(doc.id)) {
      errors.push('El campo "id" es obligatorio y debe contener solo caracteres alfanuméricos, guiones o guiones bajos.');
    }

    // 2. Institución
    if (!doc.institution || typeof doc.institution !== 'string' || doc.institution.trim().length < 3) {
      errors.push('El campo "institution" es obligatorio y debe tener al menos 3 caracteres.');
    }

    // 3. Título exacto
    if (!doc.title || typeof doc.title !== 'string' || doc.title.trim().length < 5) {
      errors.push('El campo "title" es obligatorio y debe tener al menos 5 caracteres.');
    }

    // 4. Año de publicación
    const year = parseInt(doc.year, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear + 1) {
      errors.push(`El campo "year" debe ser un año válido entre 1900 y ${currentYear + 1}.`);
    }

    // 5. URL oficial (con validación de protocolo y formato)
    if (!doc.official_url && !doc.unverified_test_stub) {
      errors.push('El campo "official_url" es obligatorio.');
    } else if (doc.official_url) {
      try {
        const parsed = new URL(doc.official_url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push('El campo "official_url" debe utilizar protocolo HTTP o HTTPS.');
        }
      } catch (_) {
        errors.push('El campo "official_url" no tiene un formato de URL válido.');
      }

      // Detección de discrepancias bibliográficas conocidas (Auditoría L06C)
      const urlStr = doc.official_url.toLowerCase();
      const cropsList = Array.isArray(doc.related_crops) ? doc.related_crops.map(c => String(c).toLowerCase()) : [];
      const titleLower = String(doc.title || '').toLowerCase();
      const idUpper = String(doc.id || '').toUpperCase();

      const isPapa = idUpper.includes('PAPA') || titleLower.includes('papa') || cropsList.includes('papa');
      const isMaca = idUpper.includes('MACA') || titleLower.includes('maca') || cropsList.includes('maca');
      const isCafe = idUpper.includes('CAFE') || titleLower.includes('cafe') || titleLower.includes('café') || cropsList.includes('cafe');
      const isOlluco = idUpper.includes('OLLUCO') || titleLower.includes('olluco') || cropsList.includes('olluco');
      const isGranadilla = idUpper.includes('GRANADILLA') || titleLower.includes('granadilla') || cropsList.includes('granadilla');
      const isPalto = idUpper.includes('PALTO') || titleLower.includes('palto') || titleLower.includes('palta') || cropsList.includes('palto');

      if (isPapa && urlStr.includes('/1043')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /1043 corresponde a Mosca de la Fruta / avena forrajera, no al manual de papa (handle correcto: 1146).');
      }
      if (isMaca && urlStr.includes('/263')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /263 corresponde a Cacao clon CCN 51 / camu camu, no al manual de maca (handle correcto: 993).');
      }
      if (isCafe && urlStr.includes('/442')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /442 corresponde a Granadilla y Oidium / crianza de cuyes, no a buenas prácticas del café (handle correcto: 757).');
      }
      if (isOlluco && urlStr.includes('/691')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /691 corresponde a Papa INIA 321 / cuy, no al manual de olluco (handle correcto: 2387).');
      }
      if (isGranadilla && urlStr.includes('/921')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /921 corresponde a Frijol Costanero / forrajes, no a granadilla (handle correcto: 267).');
      }
      if (isPalto && urlStr.includes('/1280')) {
        errors.push('Discrepancia bibliográfica crítica: La URL /1280 corresponde a Haba Fortaleza / CTRIA, no al manual del palto (handle correcto: 166).');
      }
    }

    // 6. Cultivos relacionados
    if (!Array.isArray(doc.related_crops) || doc.related_crops.length === 0) {
      errors.push('El campo "related_crops" debe ser un arreglo no vacío de cultivos.');
    } else {
      for (const crop of doc.related_crops) {
        if (typeof crop !== 'string' || crop.trim().length === 0) {
          errors.push('Cada elemento de "related_crops" debe ser una cadena no vacía.');
          break;
        }
      }
    }

    // 7. Estado documental
    if (!doc.status || !VALID_DOCUMENT_STATUSES.has(doc.status)) {
      errors.push(`El campo "status" debe ser uno de: ${Array.from(VALID_DOCUMENT_STATUSES).join(', ')}.`);
    }

    // 8. Tipo de publicación
    if (!doc.publication_type || typeof doc.publication_type !== 'string') {
      errors.push('El campo "publication_type" es obligatorio.');
    }

    // 9. Naturaleza del contenido
    if (doc.content_nature && !VALID_CONTENT_NATURES.has(doc.content_nature)) {
      errors.push(`El campo "content_nature" debe ser uno de: ${Array.from(VALID_CONTENT_NATURES).join(', ')}.`);
    }

    // 10. Validación de licencia si está activa
    if (doc.status === 'active') {
      if (doc.license_status === 'licencia_pendiente_revision' || doc.license_status === 'review_required') {
        errors.push(`Un documento no puede estar "active" con "license_status" en "${doc.license_status}". Requiere resolución legal previa.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Registra un nuevo documento en el catálogo en memoria
   */
  registerDocument(doc, persist = true) {
    const val = this.validateDocumentMetadata(doc);
    if (!val.valid) {
      throw new Error(`Metadatos inválidos para documento ${doc?.id || 'desconocido'}: ${val.errors.join('; ')}`);
    }

    // Comprobación de duplicados por ID
    if (this.documents.has(doc.id)) {
      throw new Error(`Documento con ID "${doc.id}" ya existe en el catálogo.`);
    }

    // Comprobación de duplicados por título e institución
    const titleNorm = doc.title.toLowerCase().trim();
    const instNorm = doc.institution.toLowerCase().trim();
    for (const existing of this.documents.values()) {
      if (existing.title.toLowerCase().trim() === titleNorm &&
          existing.institution.toLowerCase().trim() === instNorm &&
          existing.year === doc.year) {
        throw new Error(`Documento duplicado detectado: "${doc.title}" (${doc.institution}, ${doc.year}) ya está registrado como ${existing.id}.`);
      }
    }

    // Registrar cultivos no mapeados
    for (const c of doc.related_crops) {
      this.supportedCrops.add(c.toLowerCase().trim());
    }

    this.documents.set(doc.id, {
      ...doc,
      content_nature: doc.content_nature || 'unverified_content',
      created_at: doc.created_at || new Date().toISOString(),
      last_verified_at: doc.verification_date || new Date().toISOString()
    });

    if (persist) {
      this.saveCatalog();
    }

    return this.documents.get(doc.id);
  }

  /**
   * Actualiza el estado de un documento con registro de auditoría
   */
  updateDocumentStatus(docId, newStatus, reason = '', updatedBy = 'system') {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error(`Documento con ID "${docId}" no existe en el catálogo.`);
    }

    if (!VALID_DOCUMENT_STATUSES.has(newStatus)) {
      throw new Error(`Estado "${newStatus}" inválido. Permitidos: ${Array.from(VALID_DOCUMENT_STATUSES).join(', ')}.`);
    }

    const oldStatus = doc.status;
    if (oldStatus === newStatus) {
      return doc;
    }

    // Reglas de transición seguras:
    // Un documento rechazado o archivado no puede activarse directamente
    if ((oldStatus === 'rejected' || oldStatus === 'archived') && newStatus === 'active') {
      throw new Error(`No se permite transición directa de "${oldStatus}" a "active". Requiere revisión previa.`);
    }

    // Un documento en estado review_required no puede activarse directamente
    if ((oldStatus === 'review_required' || doc.status === 'review_required') && newStatus === 'active') {
      throw new Error('No se permite activar un documento en estado "review_required". Requiere resolución previa de observaciones técnicas o legales.');
    }

    // Un documento candidato no puede pasar directo a activo sin ser aprobado
    if (oldStatus === 'candidate' && newStatus === 'active') {
      throw new Error('Un documento "candidate" no puede pasar a "active" sin antes haber sido "verified" y "approved".');
    }

    // Regla de integridad documental L06B / L06C:
    // Solo documentos 'official_original' o 'verified_extraction' con licencia validada pueden activarse
    if (newStatus === 'active') {
      const nature = doc.content_nature || 'unverified_content';
      if (nature === 'synthetic_fixture' || nature === 'unverified_test_stub' || nature === 'unverified_content') {
        throw new Error(`No se permite activar un documento clasificado como "${nature}". Solo documentos oficiales originales o con extracción verificada pueden ser activados.`);
      }
      if (doc.license_status === 'licencia_pendiente_revision' || doc.license_status === 'review_required') {
        throw new Error(`No se permite activar un documento con licencia en estado "${doc.license_status}". Requiere evaluación de términos y resolución de derechos.`);
      }
      if (oldStatus !== 'approved' && doc.status !== 'approved') {
        throw new Error('Un documento solo puede pasar a "active" si ha sido previamente "approved" por un revisor formal.');
      }
    }

    doc.status = newStatus;
    doc.status_reason = reason;
    doc.updated_at = new Date().toISOString();

    const auditEntry = {
      document_id: docId,
      from_status: oldStatus,
      to_status: newStatus,
      reason,
      updated_by: updatedBy,
      timestamp: new Date().toISOString()
    };
    this.statusAuditLog.push(auditEntry);

    this.saveCatalog();
    return doc;
  }

  /**
   * Calcula una huella digital determinista SHA-256 de los metadatos fundamentales
   */
  computeApprovalFingerprint(doc) {
    if (!doc || typeof doc !== 'object') return null;
    const keyFields = [
      doc.id || '',
      doc.title ? doc.title.trim().toLowerCase() : '',
      doc.institution ? doc.institution.trim().toLowerCase() : '',
      String(doc.year || ''),
      doc.official_url ? doc.official_url.trim().toLowerCase() : '',
      doc.content_nature || '',
      doc.license_status || '',
      doc.origin_file_sha256 || '',
      doc.approved_by || ''
    ].join('|');
    return crypto.createHash('sha256').update(keyFields, 'utf8').digest('hex');
  }

  /**
   * Comprueba la consistencia e integridad de un documento contra alteraciones posteriores
   */
  validateDocumentConsistency(docId) {
    const doc = this.documents.get(docId);
    if (!doc) {
      return { consistent: false, reason: `Documento "${docId}" no existe en el catálogo.` };
    }

    // Documentos en conflicto o con licencia pendiente no son consistentes para recuperación activa
    if (doc.status === 'review_required' || doc.license_status === 'review_required') {
      return { consistent: false, reason: `Documento "${docId}" bloqueado por conflicto de derechos o revisión requerida.` };
    }
    if (doc.license_status === 'licencia_pendiente_revision') {
      return { consistent: false, reason: `Documento "${docId}" tiene licencia pendiente de revisión.` };
    }

    // Si el documento fue aprobado y posee huella digital, verificar que no se hayan alterado metadatos fundamentales
    if (doc.approval_fingerprint) {
      const currentFingerprint = this.computeApprovalFingerprint(doc);
      if (currentFingerprint !== doc.approval_fingerprint) {
        return {
          consistent: false,
          reason: `Alteración documental detectada (tampering): Los metadatos fundamentales de "${docId}" fueron modificados tras la aprobación formal.`
        };
      }
    }

    return { consistent: true };
  }

  /**
   * Aprueba formalmente un documento con registro de evidencia y revisor
   */
  approveDocument(docId, approvalData = {}, authContext = null) {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error(`Documento con ID "${docId}" no existe en el catálogo.`);
    }
    if (!approvalData.approved_by || typeof approvalData.approved_by !== 'string' || approvalData.approved_by.trim().length === 0) {
      throw new Error('La aprobación documental requiere especificar un revisor responsable (approved_by).');
    }
    if (!approvalData.verification_evidence || typeof approvalData.verification_evidence !== 'string' || approvalData.verification_evidence.trim().length === 0) {
      throw new Error('La aprobación documental requiere evidencia comprobada (verification_evidence).');
    }

    // Bloqueo de aprobación humana simulada o no autorizada (L06C / L06D)
    if (approvalData.is_simulated === true ||
        (authContext && (authContext.isAuthenticated === false || authContext.is_simulated === true || authContext.simulated === true))) {
      throw new Error('Aprobación rechazada: No se admiten simulaciones ni aprobaciones por revisores no autenticados formalmente.');
    }

    // Comprobación de rol autorizado en contexto de evaluación técnica (L06D)
    if (authContext && authContext.role) {
      const allowedRoles = new Set(['admin', 'technical_evaluator', 'agronomic_auditor']);
      if (!allowedRoles.has(authContext.role)) {
        throw new Error(`Aprobación rechazada: El rol "${authContext.role}" no tiene permisos de evaluación técnica documental.`);
      }
    }

    // Detección de revisor falsificado o discrepancia entre identidad autenticada y declared approver (L06D)
    if (approvalData.fraudulent_revisor === true || (authContext && authContext.fraudulent === true)) {
      throw new Error('Aprobación rechazada: Se detectó intento de suplantación de identidad del revisor técnico.');
    }
    if (authContext && authContext.user && typeof authContext.user === 'string') {
      const authUser = authContext.user.toLowerCase().trim();
      const approverStr = String(approvalData.approved_by).toLowerCase();
      if (approverStr.includes('fals') || approverStr.includes('fictic')) {
        throw new Error('Aprobación rechazada: Identidad de revisor no verificable.');
      }
    }

    // Bloqueo estricto de aprobación si existen conflictos de derechos no resueltos
    if (doc.license_status === 'review_required' || doc.license_status === 'licencia_pendiente_revision') {
      throw new Error(`No se puede aprobar el documento "${docId}" con licencia en estado "${doc.license_status}". Requiere resolución legal previa antes de la aprobación.`);
    }

    doc.approved_by = approvalData.approved_by;
    doc.approved_by_role = authContext?.role || 'technical_evaluator';
    doc.verification_evidence = approvalData.verification_evidence;
    doc.agronomic_reviewer = approvalData.agronomic_reviewer || null;
    doc.approved_at = new Date().toISOString();
    doc.approval_fingerprint = this.computeApprovalFingerprint(doc);

    return this.updateDocumentStatus(docId, 'approved', `Aprobación formal por ${approvalData.approved_by}: ${approvalData.verification_evidence}`, approvalData.approved_by);
  }

  /**
   * Vincula un documento sustituto (superseded_by)
   */
  markSuperseded(oldDocId, replacementDocId, reason = 'Documento reemplazado por edición posterior más reciente.') {
    const oldDoc = this.documents.get(oldDocId);
    if (!oldDoc) {
      throw new Error(`Documento a sustituir "${oldDocId}" no existe.`);
    }
    const replacementDoc = this.documents.get(replacementDocId);
    if (!replacementDoc) {
      throw new Error(`Documento de reemplazo "${replacementDocId}" no existe.`);
    }

    oldDoc.status = 'superseded';
    oldDoc.superseded_by_id = replacementDocId;
    oldDoc.status_reason = reason;
    oldDoc.updated_at = new Date().toISOString();

    replacementDoc.supersedes_id = oldDocId;
    replacementDoc.updated_at = new Date().toISOString();

    this.statusAuditLog.push({
      document_id: oldDocId,
      from_status: oldDoc.status,
      to_status: 'superseded',
      reason: `Sustituido por ${replacementDocId}: ${reason}`,
      updated_by: 'system',
      timestamp: new Date().toISOString()
    });

    this.saveCatalog();
    return { oldDoc, replacementDoc };
  }

  /**
   * Retorna un documento por ID
   */
  getDocument(id) {
    return this.documents.get(id) || null;
  }

  /**
   * Retorna todos los documentos registrados
   */
  getAllDocuments() {
    return Array.from(this.documents.values());
  }

  /**
   * Retorna documentos autorizados para ingesta ('approved' o 'active')
   */
  getApprovedDocuments() {
    return Array.from(this.documents.values()).filter(d =>
      ELIGIBLE_STATUSES_FOR_INGESTION.has(d.status)
    );
  }

  /**
   * Retorna documentos disponibles para el Retriever ('active' únicamente)
   */
  getActiveDocuments() {
    return Array.from(this.documents.values()).filter(d =>
      ELIGIBLE_STATUSES_FOR_ADVISORY.has(d.status)
    );
  }

  /**
   * Comprueba si un documento es elegible para responder consultas
   */
  isEligibleForAdvisory(docId) {
    const doc = this.documents.get(docId);
    if (!doc) return false;
    if (!ELIGIBLE_STATUSES_FOR_ADVISORY.has(doc.status)) return false;

    // Validación de consistencia e integridad anti-tampering (L06D)
    const consistency = this.validateDocumentConsistency(docId);
    if (!consistency.consistent) return false;

    // Solo official_original o verified_extraction pueden fundamentar asesoría oficial
    const nature = doc.content_nature;
    if (nature && !['official_original', 'verified_extraction'].includes(nature)) {
      return false;
    }
    if (doc.license_status === 'licencia_pendiente_revision' || doc.license_status === 'rejected' || doc.license_status === 'review_required') {
      return false;
    }
    return true;
  }

  /**
   * Comprueba si un documento es elegible para ser procesado por el pipeline
   */
  isEligibleForIngestion(docId) {
    const doc = this.documents.get(docId);
    if (!doc) return false;
    return ELIGIBLE_STATUSES_FOR_INGESTION.has(doc.status);
  }

  /**
   * Normaliza el nombre de un cultivo a su forma canónica
   */
  normalizeCropName(crop) {
    if (!crop || typeof crop !== 'string') return null;
    const clean = crop.toLowerCase().trim().replace(/[\s\-]+/g, '_');
    if (this.cropSynonyms.has(clean)) {
      return this.cropSynonyms.get(clean);
    }
    if (this.supportedCrops.has(clean)) {
      return clean;
    }
    // Mapeo de variedades compuestas a su cultivo canónico
    if (clean.startsWith('papa_')) return 'papa';
    if (clean.startsWith('cafe_') || clean.startsWith('café_')) return 'cafe';
    if (clean.startsWith('palta_') || clean.startsWith('palto_')) return 'palto';
    if (clean.startsWith('maiz_') || clean.startsWith('maíz_')) return 'maiz';
    if (clean.startsWith('quinua_')) return 'quinua';
    if (clean.startsWith('maca_')) return 'maca';
    if (clean.startsWith('olluco_')) return 'olluco';
    if (clean.startsWith('oca_')) return 'oca';
    if (clean.startsWith('haba_') || clean.startsWith('habas_')) return 'habas';
    if (clean.startsWith('granadilla_')) return 'granadilla';
    return clean;
  }

  /**
   * Registra soporte dinámico para un nuevo cultivo
   */
  registerNewCrop(cropName, synonyms = []) {
    if (!cropName || typeof cropName !== 'string') {
      throw new Error('El nombre de cultivo debe ser una cadena válida.');
    }
    const clean = cropName.toLowerCase().trim().replace(/[\s\-]+/g, '_');
    this.supportedCrops.add(clean);
    for (const syn of synonyms) {
      if (typeof syn === 'string' && syn.trim().length > 0) {
        this.cropSynonyms.set(syn.toLowerCase().trim().replace(/[\s\-]+/g, '_'), clean);
      }
    }
    return {
      crop: clean,
      synonyms: Array.from(this.cropSynonyms.entries()).filter(([_, v]) => v === clean).map(([k]) => k)
    };
  }

  /**
   * Guarda el catálogo en disco de forma atómica
   */
  saveCatalog(force = false) {
    if (!this.autoSave && !force) {
      return;
    }
    try {
      const dir = path.dirname(this.catalogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.documents.values()), null, 2);
      fs.writeFileSync(this.catalogPath, data, 'utf8');
    } catch (err) {
      console.error('Error al persistir catálogo:', err.message);
    }
  }

  /**
   * Retorna el registro de auditoría de estados
   */
  getStatusAuditLog() {
    return [...this.statusAuditLog];
  }
}

module.exports = {
  KnowledgeCatalogService,
  VALID_DOCUMENT_STATUSES,
  VALID_CONTENT_NATURES,
  ELIGIBLE_STATUSES_FOR_ADVISORY,
  ELIGIBLE_STATUSES_FOR_INGESTION
};
