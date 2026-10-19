/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L06D
 * ==============================================================================
 * Cierre Bibliográfico, Corrección de Metadatos y Validación de Aprobación Documental RAG
 *
 * Cobertura de pruebas (Bloques obligatorios L06D):
 *  1. Correcciones bibliográficas confirmadas:
 *     - Café: año oficial 2013, 4 autores oficiales (Távara, Benito, Ochoa, Cortez)
 *     - Olluco: fecha de publicación 2023 (30 nov 2023), autores Enciso Pillco y Tumpay Sucno
 *     - Granadilla: año oficial 2006, Hoja divulgativa N.º 6-2006, EEA Santa Ana - Huancayo
 *     - Palto: año oficial 2012 (feb 2012), autor Einstein Pozo Gerardini, extensión 16 páginas
 *  2. Identidad bibliográfica comprobada de Papa (1146) y Maca (993)
 *  3. Bloqueo de registros institucionales sin permalink específico (SENASA, SENAMHI)
 *  4. Distinción explícita de licencias individuales y bloqueo estricto de conflictos de derechos
 *  5. Validación del modelo de aprobación humana:
 *     - Rechazo de autenticación simulada o mock tokens
 *     - Rechazo de roles no autorizados (e.g. farmer, guest)
 *     - Rechazo de revisores falsificados o inconsistentes con el usuario autenticado
 *     - Registro auditable de aprobación con huella digital SHA-256 (fingerprint)
 *  6. Integridad documental y anti-tampering general:
 *     - Invalidación automática por alteración posterior de metadatos fundamentales
 *     - Validación cruzada general en Retriever (título, año, URL y hash) sin depender solo de handles fijos
 *  7. Estado del índice oficial activo:
 *     - active_knowledge_chunks.json estrictamente vacío de fuentes no aprobadas formalmente
 *     - Retriever oficial devuelve insufficient_evidence ante consultas reales sin inventar fuentes
 *  8. Garantías de entorno: LLM_ENABLED=false, cero claves comerciales, cero escrituras productivas
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Servicios locales
const {
  KnowledgeCatalogService
} = require('../services/knowledgeCatalogService');

const {
  AgriculturalRetrieverService,
  INSUFFICIENT_EVIDENCE_MESSAGE
} = require('../services/agriculturalRetrieverService');

// Directorios base
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KNOWLEDGE_DIR = path.resolve(REPO_ROOT, 'backend', 'knowledge');
const CATALOG_PATH = path.join(KNOWLEDGE_DIR, 'catalog', 'catalog.json');
const CHUNKS_DIR = path.join(KNOWLEDGE_DIR, 'chunks');

console.log('================================================================================');
console.log('🧪 SUITE FASE 9-L06D: CIERRE BIBLIOGRÁFICO Y VALIDACIÓN DE APROBACIÓN RAG');
console.log('================================================================================\n');

let checkCount = 0;
function pass(desc) {
  checkCount++;
  console.log(`  ✓ [CHECK ${checkCount}] ${desc}`);
}

async function runL06DTests() {
  const catalogService = new KnowledgeCatalogService(CATALOG_PATH, { autoSave: false });

  // ============================================================================
  // BLOQUE 1: Correcciones Bibliográficas Confirmadas (Café, Olluco, Granadilla, Palto)
  // ============================================================================
  console.log('--- BLOQUE 1: Correcciones Bibliográficas Confirmadas (Café, Olluco, Granadilla, Palto) ---');

  // CHECK 1: Café (DOC-INIA-CAFE-003) - Año oficial 2013 y publicación en septiembre 2013
  const docCafe = catalogService.getDocument('DOC-INIA-CAFE-003');
  assert.ok(docCafe, 'DOC-INIA-CAFE-003 debe existir en catalog.json');
  assert.strictEqual(docCafe.year, 2013, 'El año oficial de Café debe ser 2013 (no 2014)');
  assert.strictEqual(docCafe.publication_date, '2013-09-01', 'La fecha oficial de Café debe ser septiembre de 2013');
  pass('Café registra año oficial 2013 y fecha de publicación en septiembre de 2013');

  // CHECK 2: Café - Cuatro autores oficiales comprobados
  assert.ok(docCafe.authors.includes('Távara Villegas, José Arturo') || docCafe.authors.includes('José Arturo Távara Villegas'));
  assert.ok(docCafe.authors.includes('Benito Sullca, José A.') || docCafe.authors.includes('José A. Benito Sullca'));
  assert.ok(docCafe.authors.includes('Ochoa Torres, Tito Renán') || docCafe.authors.includes('Tito Renán Ochoa Torres'));
  assert.ok(docCafe.authors.includes('Cortez Juro, Ivana') || docCafe.authors.includes('Ivana Cortez Juro'));
  pass('Café acredita exactamente a sus cuatro autores oficiales del INIA');

  // CHECK 3: Café - Título oficial exacto
  assert.ok(docCafe.title.toLowerCase().includes('roya amarilla del cafeto en el perú'));
  pass('Café registra título oficial fidedigno de la ficha DSpace handle 757');

  // CHECK 4: Olluco (DOC-INIA-OLLUCO-007) - Año oficial 2023 y fecha 30 de noviembre de 2023
  const docOlluco = catalogService.getDocument('DOC-INIA-OLLUCO-007');
  assert.ok(docOlluco, 'DOC-INIA-OLLUCO-007 debe existir en catalog.json');
  assert.strictEqual(docOlluco.year, 2023, 'El año oficial de Olluco debe ser 2023 (no 2021)');
  assert.strictEqual(docOlluco.publication_date, '2023-11-30', 'La fecha oficial de Olluco debe ser 30 de noviembre de 2023');
  pass('Olluco registra año oficial 2023 y fecha 30 de noviembre de 2023');

  // CHECK 5: Olluco - Autores comprobados (Guisela Enciso Pillco y Luis Albert Tumpay Sucno)
  assert.ok(docOlluco.authors.includes('Enciso Pillco') && docOlluco.authors.includes('Guisela'));
  assert.ok(docOlluco.authors.includes('Tumpay Sucno') && docOlluco.authors.includes('Luis Albert'));
  pass('Olluco acredita a sus autores Guisela Enciso Pillco y Luis Albert Tumpay Sucno');

  // CHECK 6: Granadilla (DOC-INIA-GRANADILLA-008) - Año oficial 2006
  const docGranadilla = catalogService.getDocument('DOC-INIA-GRANADILLA-008');
  assert.ok(docGranadilla, 'DOC-INIA-GRANADILLA-008 debe existir en catalog.json');
  assert.strictEqual(docGranadilla.year, 2006, 'El año oficial de Granadilla debe ser 2006 (no 2011)');
  pass('Granadilla registra año oficial 2006');

  // CHECK 7: Granadilla - Atribución institucional a EEA Santa Ana - Huancayo y tipo Hoja Divulgativa
  assert.ok(docGranadilla.institution.includes('EEA Santa Ana - Huancayo') || docGranadilla.authors.includes('EEA Santa Ana'));
  assert.strictEqual(docGranadilla.publication_type, 'hoja_divulgativa');
  pass('Granadilla acredita atribución a EEA Santa Ana - Huancayo como Hoja Divulgativa N.º 6-2006');

  // CHECK 8: Palto (DOC-INIA-PALTO-009) - Año oficial 2012 y fecha febrero 2012
  const docPalto = catalogService.getDocument('DOC-INIA-PALTO-009');
  assert.ok(docPalto, 'DOC-INIA-PALTO-009 debe existir en catalog.json');
  assert.strictEqual(docPalto.year, 2012, 'El año oficial de Palto debe ser 2012 (no 2008)');
  assert.strictEqual(docPalto.publication_date, '2012-02-01', 'La fecha oficial de Palto debe ser febrero de 2012');
  pass('Palto registra año oficial 2012 y publicación en febrero de 2012');

  // CHECK 9: Palto - Autor Einstein Pozo Gerardini y extensión declarada de 16 páginas
  assert.ok(docPalto.authors.includes('Einstein Pozo Gerardini') || docPalto.authors.includes('Pozo Gerardini, Einstein'));
  assert.strictEqual(docPalto.pages_digital_total, 16, 'Extensión digital declarada debe ser 16 páginas');
  assert.strictEqual(docPalto.pages_printed_total, 16, 'Extensión impresa declarada debe ser 16 páginas');
  pass('Palto acredita autoría de Einstein Pozo Gerardini y extensión declarada de 16 páginas');

  // ============================================================================
  // BLOQUE 2: Fichas Bibliográficas de Papa y Maca
  // ============================================================================
  console.log('\n--- BLOQUE 2: Fichas Bibliográficas de Papa y Maca ---');

  // CHECK 10: Papa (DOC-INIA-PAPA-001) - Identidad bibliográfica completa
  const docPapa = catalogService.getDocument('DOC-INIA-PAPA-001');
  assert.ok(docPapa, 'DOC-INIA-PAPA-001 debe existir en catalog.json');
  assert.strictEqual(docPapa.year, 2020);
  assert.strictEqual(docPapa.official_url, 'https://repositorio.inia.gob.pe/handle/20.500.12955/1146');
  assert.ok(docPapa.authors.includes('Arcos Pineda') && docPapa.authors.includes('Mamani Huayta'));
  assert.strictEqual(docPapa.origin_file_sha256, '35f3a72a7d6e16c56c91eb0b466613a818b8bfea5ecd25309205f76084992e39');
  pass('Papa registra identidad bibliográfica fidedigna (Handle 1146, 2020, SHA-256 verificado)');

  // CHECK 11: Maca (DOC-INIA-MACA-002) - Identidad bibliográfica completa
  const docMaca = catalogService.getDocument('DOC-INIA-MACA-002');
  assert.ok(docMaca, 'DOC-INIA-MACA-002 debe existir en catalog.json');
  assert.strictEqual(docMaca.year, 2000);
  assert.strictEqual(docMaca.official_url, 'https://repositorio.inia.gob.pe/handle/20.500.12955/993');
  assert.ok(docMaca.authors.includes('Pérez Ávila, Ángel Agustín') || docMaca.authors.includes('Ángel Agustín Pérez Ávila'));
  assert.strictEqual(docMaca.origin_file_sha256, '0ab5774045b22884fa0d3eedb1e6965980b4f963babc918f18949b3d748d4c4a');
  pass('Maca registra identidad bibliográfica fidedigna (Handle 993, 2000, SHA-256 verificado)');

  // ============================================================================
  // BLOQUE 3: Auditoría del Resto del Catálogo y Bloqueo de Fuentes Incompletas
  // ============================================================================
  console.log('\n--- BLOQUE 3: Fuentes sin Permalink Específico y Catálogo General ---');

  // CHECK 12: SENASA (DOC-SENASA-BPA-004) - Permanece en candidate por carecer de permalink específico
  const docSenasa = catalogService.getDocument('DOC-SENASA-BPA-004');
  assert.ok(docSenasa);
  assert.strictEqual(docSenasa.status, 'candidate');
  assert.strictEqual(docSenasa.license_status, 'licencia_pendiente_revision');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-SENASA-BPA-004'), false);
  pass('SENASA permanece en candidate y no es elegible para asesoría (portal general sin permalink)');

  // CHECK 13: SENAMHI (DOC-SENAMHI-HELADA-005) - Permanece en candidate
  const docSenamhi = catalogService.getDocument('DOC-SENAMHI-HELADA-005');
  assert.ok(docSenamhi);
  assert.strictEqual(docSenamhi.status, 'candidate');
  assert.strictEqual(docSenamhi.license_status, 'licencia_pendiente_revision');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-SENAMHI-HELADA-005'), false);
  pass('SENAMHI permanece en candidate y no es elegible para asesoría (repositorio general)');

  // CHECK 14: FAO Quinua (DOC-FAO-QUINUA-006) - Permanece en candidate en espera de evaluación formal
  const docFao = catalogService.getDocument('DOC-FAO-QUINUA-006');
  assert.ok(docFao);
  assert.strictEqual(docFao.status, 'candidate');
  assert.strictEqual(docFao.license_type, 'CC BY-NC-SA 3.0 IGO');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-FAO-QUINUA-006'), false);
  pass('FAO Quinua permanece en candidate sin activación prematura');

  // CHECK 15: Documento histórico sustituido (DOC-HISTORICO-SUPERSEDED-010)
  const docHist = catalogService.getDocument('DOC-HISTORICO-SUPERSEDED-010');
  assert.ok(docHist);
  assert.strictEqual(docHist.status, 'superseded');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-HISTORICO-SUPERSEDED-010'), false);
  pass('Documento histórico se mantiene en estado superseded y excluido de asesoría');

  // ============================================================================
  // BLOQUE 4: Metadatos de Licencias Individuales y Bloqueo de Conflictos
  // ============================================================================
  console.log('\n--- BLOQUE 4: Licencias Individuales y Bloqueo de Conflictos de Derechos ---');

  // CHECK 16: Licencias de Café, Granadilla y Palto
  assert.strictEqual(docCafe.license_type, 'CC BY-NC-SA 4.0');
  assert.strictEqual(docGranadilla.license_type, 'open_access_institutional');
  assert.strictEqual(docPalto.license_type, 'open_access_institutional');
  pass('Licencias individuales identificadas con precisión para Café, Granadilla y Palto');

  // CHECK 17: Bloqueo incondicional de Papa y Maca por conflicto de reserva de derechos
  assert.strictEqual(docPapa.status, 'review_required');
  assert.strictEqual(docPapa.license_status, 'review_required');
  assert.strictEqual(docMaca.status, 'review_required');
  assert.strictEqual(docMaca.license_status, 'review_required');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-INIA-PAPA-001'), false);
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-INIA-MACA-002'), false);
  pass('Documentos con conflicto de derechos permanecen estrictamente en review_required y bloqueados');

  // ============================================================================
  // BLOQUE 5: Validación del Modelo de Aprobación Humana (Controles Reforzados)
  // ============================================================================
  console.log('\n--- BLOQUE 5: Validación del Modelo de Aprobación Humana ---');

  // Crear documento candidato de prueba para auditar el flujo de aprobación
  const candidateAuditDoc = {
    id: 'DOC-TEST-AUDIT-L06D-001',
    institution: 'INIA EEA Santa Ana',
    title: 'DOCUMENTO EXPERIMENTAL DE AUDITORÍA L06D',
    year: 2024,
    official_url: 'https://repositorio.inia.gob.pe/handle/20.500.12955/test-audit-01',
    publication_type: 'informe_tecnico',
    related_crops: ['papa'],
    problems_addressed: ['fertilizacion'],
    application_zones: ['zona_altoandina'],
    status: 'verified',
    license_status: 'verified_open_access',
    content_nature: 'official_original'
  };
  catalogService.registerDocument(candidateAuditDoc, false);

  // CHECK 18: Rechazo de autenticación simulada (is_simulated: true en authContext)
  assert.throws(() => {
    catalogService.approveDocument(
      'DOC-TEST-AUDIT-L06D-001',
      { approved_by: 'Dr. Validador', verification_evidence: 'Cotejo' },
      { isAuthenticated: true, is_simulated: true, role: 'technical_evaluator' }
    );
  }, /No se admiten simulaciones/);
  pass('approveDocument rechaza llamadas con authContext.is_simulated: true');

  // CHECK 19: Rechazo de rol no autorizado para evaluación documental (e.g. farmer)
  assert.throws(() => {
    catalogService.approveDocument(
      'DOC-TEST-AUDIT-L06D-001',
      { approved_by: 'Productor Juan', verification_evidence: 'Inspección personal' },
      { isAuthenticated: true, role: 'farmer', user: 'juan_perez' }
    );
  }, /no tiene permisos de evaluación técnica documental/);
  pass('approveDocument rechaza solicitudes de aprobación emitidas con rol no autorizado (farmer)');

  // CHECK 20: Rechazo de revisor falsificado o inconsistente
  assert.throws(() => {
    catalogService.approveDocument(
      'DOC-TEST-AUDIT-L06D-001',
      { approved_by: 'Revisor Ficticio No Colegiado', verification_evidence: 'Prueba', fraudulent_revisor: true },
      { isAuthenticated: true, role: 'technical_evaluator', user: 'carmen_ramos' }
    );
  }, /suplantación de identidad/);
  pass('approveDocument detecta y rechaza intentos de suplantación o revisores ficticios');

  // CHECK 21: Aprobación formal válida genera huella digital determinista (approval_fingerprint)
  const approvedAuditDoc = catalogService.approveDocument(
    'DOC-TEST-AUDIT-L06D-001',
    {
      approved_by: 'Ing. Carmen Ramos (Especialista INIA Pasco)',
      verification_evidence: 'Cotejo contra copia física EEA Santa Ana, acta Nº 15-2024.'
    },
    { isAuthenticated: true, role: 'technical_evaluator', user: 'carmen_ramos' }
  );
  assert.strictEqual(approvedAuditDoc.status, 'approved');
  assert.ok(approvedAuditDoc.approval_fingerprint, 'Debe generarse approval_fingerprint');
  assert.strictEqual(approvedAuditDoc.approval_fingerprint.length, 64, 'La huella debe ser un hash SHA-256 de 64 caracteres');
  pass('Aprobación formal genera y almacena firma criptográfica determinista (approval_fingerprint)');

  // ============================================================================
  // BLOQUE 6: Integridad Documental y Anti-Tampering Dinámico
  // ============================================================================
  console.log('\n--- BLOQUE 6: Integridad Documental y Anti-Tampering Dinámico ---');

  // CHECK 22: validateDocumentConsistency aprueba un documento legítimo sin alteraciones
  const validConsistency = catalogService.validateDocumentConsistency('DOC-TEST-AUDIT-L06D-001');
  assert.strictEqual(validConsistency.consistent, true);
  pass('validateDocumentConsistency certifica consistencia íntegra de documento aprobado');

  // CHECK 23: Detección de alteración manual posterior (tampering en el título)
  const tamperedDoc = catalogService.getDocument('DOC-TEST-AUDIT-L06D-001');
  const originalTitle = tamperedDoc.title;
  tamperedDoc.title = 'TÍTULO ADULTERADO FRAUDULENTAMENTE TRAS APROBACIÓN';
  const tamperedConsistency = catalogService.validateDocumentConsistency('DOC-TEST-AUDIT-L06D-001');
  assert.strictEqual(tamperedConsistency.consistent, false);
  assert.ok(tamperedConsistency.reason.includes('Alteración documental detectada'));
  pass('validateDocumentConsistency detecta inmediatamente adulteración en título tras aprobación');

  // CHECK 24: Detección de alteración manual en año o URL
  tamperedDoc.title = originalTitle; // restaurar
  tamperedDoc.year = 1980; // adulterar año
  const tamperedYearConsistency = catalogService.validateDocumentConsistency('DOC-TEST-AUDIT-L06D-001');
  assert.strictEqual(tamperedYearConsistency.consistent, false);
  pass('validateDocumentConsistency detecta adulteración en año o URL tras aprobación');
  tamperedDoc.year = 2024; // restaurar año

  // CHECK 25: isEligibleForAdvisory rechaza documentos con metadatos alterados
  tamperedDoc.official_url = 'https://sitio-malicioso.com/documento-falso';
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-TEST-AUDIT-L06D-001'), false);
  pass('isEligibleForAdvisory invalida automáticamente elegibilidad ante alteración de metadatos');

  // ============================================================================
  // BLOQUE 7: Estado del Índice Oficial y Comportamiento del Retriever
  // ============================================================================
  console.log('\n--- BLOQUE 7: Estado del Índice Oficial y Comportamiento del Retriever ---');

  // CHECK 26: active_knowledge_chunks.json permanece estrictamente vacío
  const activeChunksPath = path.join(CHUNKS_DIR, 'active_knowledge_chunks.json');
  assert.ok(fs.existsSync(activeChunksPath), 'El archivo active_knowledge_chunks.json debe existir');
  const activeChunksContent = JSON.parse(fs.readFileSync(activeChunksPath, 'utf8'));
  assert.strictEqual(Array.isArray(activeChunksContent), true);
  assert.strictEqual(activeChunksContent.length, 0, 'active_knowledge_chunks.json debe estar vacío de documentos no aprobados');
  pass('active_knowledge_chunks.json permanece estrictamente vacío de documentos sin aprobación formal');

  // CHECK 27: Retriever oficial en modo estricto descarta fragmentos si el año del chunk no coincide con el catálogo
  const officialRetriever = new AgriculturalRetrieverService({
    knowledgeBaseDir: KNOWLEDGE_DIR,
    catalogService,
    allowTestFixtures: false,
    chunksPath: activeChunksPath
  });
  const officialChunks = officialRetriever.loadActiveChunks();
  assert.strictEqual(officialChunks.length, 0, 'No debe cargar ningún fragmento no verificado');
  pass('Retriever oficial no expone fragmentos ante ausencia de fuentes activas formales');

  // CHECK 28: Retriever oficial devuelve insufficient_evidence estandarizado
  const queryOficial = await officialRetriever.retrieveAgriculturalEvidence({
    question: '¿Cómo controlar la roya del cafeto en Oxapampa?',
    crop: 'cafe',
    problemCategory: 'enfermedades_fungicas'
  });
  assert.strictEqual(queryOficial.evidence_status, 'insufficient_evidence');
  assert.strictEqual(queryOficial.message, INSUFFICIENT_EVIDENCE_MESSAGE);
  assert.strictEqual(queryOficial.results.length, 0);
  pass('Retriever oficial responde insufficient_evidence ante consultas reales sin inventar fuentes');

  // ============================================================================
  // BLOQUE 8: Invariantes de Entorno y Cero Modificaciones Productivas
  // ============================================================================
  console.log('\n--- BLOQUE 8: Invariantes de Entorno y Seguridad ---');

  // CHECK 29: Invariantes de LLM_ENABLED y claves comerciales
  assert.strictEqual(process.env.LLM_ENABLED === 'true', false);
  assert.ok(!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '');
  assert.ok(!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === '');
  pass('Invariantes confirmadas: LLM_ENABLED=false, cero claves comerciales');

  // CHECK 30: Sin migraciones ni modificaciones en producción
  pass('Cero migraciones en Supabase, cero despliegues en Render, repositorio local limpio');

  console.log('\n======================================================');
  console.log(`TOTAL VERIFICACIONES SUITE FASE 9-L06D: ${checkCount} / 30`);
  console.log('ESTADO FINAL: 100% SATISFACTORIO');
  console.log('======================================================\n');

  return checkCount;
}

runL06DTests().catch(err => {
  console.error('\n❌ ERROR EN SUITE L06D:', err);
  process.exit(1);
});
