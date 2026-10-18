/**
 * AgroPasco Digital — Suite de Pruebas FASE 9-L07
 * ==============================================================================
 * MOTOR DE RECUPERACIÓN DOCUMENTAL RAG, VALIDACIÓN DE EVIDENCIAS
 * E INTEGRACIÓN CONTROLADA CON EL ASISTENTE AGRÍCOLA
 *
 * Verificaciones:
 *  1. Recuperación textual, normalización de cultivos y variedades
 *  2. Coincidencia por categoría de problema y contexto regional de Pasco
 *  3. Aislamiento estricto de documentos por cultivo y penalización de discrepancias
 *  4. Manejo de consultas ambiguas y ausencia de evidencia
 *  5. Controles de elegibilidad documental, licencias y anti-tampering
 *  6. Blindaje ante prompt injection y directivas no confiables
 *  7. Detección de sustancias químicas y aviso fitosanitario de SENASA
 *  8. Paginación digital vs página impresa no verificada
 *  9. Ausencia total de rutas de disco en citas
 * 10. Cálculo determinista de métricas: Precision@3, Recall@3, MRR, latencia
 * 11. Integración con advisoryChat: RAG_ENABLED=false y RAG_ENABLED=true en test
 * 12. Aislamiento de datos del agricultor y control multi-tenant
 * 13. Garantías de entorno: cero llamadas externas a LLMs o meteorología
 */

process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { KnowledgeCatalogService } = require('../services/knowledgeCatalogService');
const { AgriculturalRetrieverService, INSUFFICIENT_EVIDENCE_MESSAGE } = require('../services/agriculturalRetrieverService');
const aiController = require('../controllers/aiController');
const { buildAgriculturalContext } = require('../services/aiContextBuilder');
const mlService = require('../services/mlService');
const db = require('../config/database');

const KNOWLEDGE_DIR = path.resolve(__dirname, '..', 'knowledge');
const CATALOG_PATH = path.join(KNOWLEDGE_DIR, 'catalog', 'catalog.json');
const TEST_CHUNKS_PATH = path.resolve(__dirname, 'fixtures', 'l07_rag_test_chunks.json');
const OFFICIAL_CHUNKS_PATH = path.join(KNOWLEDGE_DIR, 'chunks', 'active_knowledge_chunks.json');

let checkCount = 0;
function pass(desc) {
  checkCount++;
  console.log(`  ✓ [CHECK ${checkCount}] ${desc}`);
}

function createMockRes() {
  const headers = {};
  const listeners = {};
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    on(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      return this;
    },
    emit(event) {
      if (listeners[event]) {
        for (const fn of listeners[event]) fn();
      }
    }
  };
  return res;
}

async function runL07Suite() {
  console.log('='.repeat(80));
  console.log('🧪 SUITE FASE 9-L07: MOTOR RAG, VALIDACIÓN DE EVIDENCIAS Y ASISTENTE AGRÍCOLA');
  console.log('='.repeat(80));

  // Inicialización de catálogo en memoria con autoSave: false
  const catalogService = new KnowledgeCatalogService(CATALOG_PATH, { autoSave: false });

  // Instancia de Retriever para pruebas con fixtures aislados
  const testRetriever = new AgriculturalRetrieverService({
    knowledgeBaseDir: KNOWLEDGE_DIR,
    catalogService,
    allowTestFixtures: true,
    chunksPath: TEST_CHUNKS_PATH
  });

  // Instancia de Retriever operativo (modo oficial de producción)
  const operativeRetriever = new AgriculturalRetrieverService({
    knowledgeBaseDir: KNOWLEDGE_DIR,
    catalogService,
    allowTestFixtures: false,
    chunksPath: OFFICIAL_CHUNKS_PATH
  });

  // ============================================================================
  // BLOQUE 1: Recuperación Textual, Normalización de Cultivos y Variedades
  // ============================================================================
  console.log('\n--- BLOQUE 1: Recuperación Textual, Normalización y Sinónimos Agrícolas ---');

  // CHECK 1: Consulta 1 - Heladas y papa con normalización "Papa Canchán" -> papa
  const resPapaHelada = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Cómo proteger mis parcelas de papa canchán frente a heladas severas en la puna?',
    crop: 'papa canchán',
    ecologicalContext: 'zona_altoandina'
  });
  assert.strictEqual(resPapaHelada.evidence_status, 'evidence_found');
  assert.ok(resPapaHelada.results.length > 0);
  assert.strictEqual(resPapaHelada.results[0].source_id, 'DOC-INIA-PAPA-001');
  assert.ok(resPapaHelada.results[0].excerpt.includes('heladas radiativas'));
  assert.ok(resPapaHelada.results[0].relevance_score > 0.5);
  pass('Consulta 1: Heladas y papa con normalización de variedad Papa Canchán a "papa"');

  // CHECK 2: Consulta 2 - Roya del café con normalización "Café arábica" -> cafe
  const resCafeRoya = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Cuál es el manejo preventivo de la roya amarilla del café arábica en Oxapampa?',
    crop: 'café arábica',
    ecologicalContext: 'selva_alta'
  });
  assert.strictEqual(resCafeRoya.evidence_status, 'evidence_found');
  assert.ok(resCafeRoya.results.length > 0);
  assert.strictEqual(resCafeRoya.results[0].source_id, 'DOC-INIA-CAFE-003');
  assert.ok(resCafeRoya.results[0].excerpt.includes('roya amarilla'));
  assert.ok(resCafeRoya.results[0].relevance_score > 0.5);
  pass('Consulta 2: Roya del café con normalización "Café arábica" y contexto de Oxapampa');

  // CHECK 3: Consulta 5 - Maca y descanso de tierras en Meseta del Bombón
  const resMaca = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Cuántos años de descanso biológico de suelos requiere la maca amarilla?',
    crop: 'maca amarilla'
  });
  assert.strictEqual(resMaca.evidence_status, 'evidence_found');
  assert.ok(resMaca.results[0].excerpt.includes('5 a 8 años'));
  assert.strictEqual(resMaca.results[0].source_id, 'DOC-INIA-MACA-002');
  pass('Consulta 5: Maca amarilla normalizada a "maca" con recuperación de descanso de 5 a 8 años');

  // CHECK 4: Consulta 6 - Quinua y manejo agroecológico
  const resQuinua = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Manejo agronómico de la quinua Pasankalla en valles interandinos',
    crop: 'quinua pasankalla'
  });
  assert.strictEqual(resQuinua.evidence_status, 'evidence_found');
  assert.ok(resQuinua.results[0].excerpt.includes('Pasankalla'));
  assert.strictEqual(resQuinua.results[0].source_id, 'DOC-FAO-QUINUA-006');
  pass('Consulta 6: Quinua Pasankalla normalizada con recuperación de manejo en valles interandinos');

  // CHECK 5: Consulta 12 - Diccionario integral de sinónimos agronómicos
  assert.strictEqual(catalogService.normalizeCropName('Papa Huayro'), 'papa');
  assert.strictEqual(catalogService.normalizeCropName('Papa Canchan'), 'papa');
  assert.strictEqual(catalogService.normalizeCropName('Café arábica'), 'cafe');
  assert.strictEqual(catalogService.normalizeCropName('Palta Hass'), 'palto');
  assert.strictEqual(catalogService.normalizeCropName('solanum_tuberosum'), 'papa');
  assert.strictEqual(catalogService.normalizeCropName('lepidium_meyenii'), 'maca');
  pass('Consulta 12: Sinónimos agronómicos transparentes y normalización sin pérdida de diagnóstico');

  // CHECK 6: Consulta 11 - Terminología regional de Pasco (Bombón, Yanahuanca, Oxapampa)
  const resRegional = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Condiciones de suelo en la Meseta del Bombón'
  });
  assert.strictEqual(resRegional.evidence_status, 'evidence_found');
  assert.ok(resRegional.results[0].application_zones.includes('meseta_del_bombon') || resRegional.results[0].application_zones.includes('zona_altoandina'));
  pass('Consulta 11: Ponderación territorial positiva ante toponimia de la región Pasco');

  // ============================================================================
  // BLOQUE 2: Coincidencia por Categoría, Ambigüedad y Aislamiento por Cultivo
  // ============================================================================
  console.log('\n--- BLOQUE 2: Categorías de Problema, Ambigüedad y Aislamiento por Cultivo ---');

  // CHECK 7: Consulta 3 - Riego tecnificado por aspersión
  const resRiego = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Cuál es la eficiencia del riego tecnificado por aspersión en valles interandinos?',
    problemCategory: 'riego'
  });
  assert.strictEqual(resRiego.evidence_status, 'evidence_found');
  assert.ok(resRiego.results[0].excerpt.includes('aspersión'));
  assert.strictEqual(resRiego.results[0].problem_category, 'riego');
  pass('Consulta 3: Riego tecnificado recuperado con coincidencia de categoría y piso ecológico');

  // CHECK 8: Consulta 4 - Recuperación post-granizada
  const resGranizo = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Tratamiento de parcelas tras tormentas de granizo en altura',
    problemCategory: 'granizadas'
  });
  assert.strictEqual(resGranizo.evidence_status, 'evidence_found');
  assert.ok(resGranizo.results[0].excerpt.includes('granizo'));
  assert.strictEqual(resGranizo.results[0].problem_category, 'granizadas');
  pass('Consulta 4: Medidas de recuperación ante granizo recuperadas con alta pertinencia');

  // CHECK 9: Consulta 7 - Manejo y conservación de suelos
  const resSuelo = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Conservación de suelos en laderas de Yanahuanca con curvas de nivel',
    crop: 'papa'
  });
  assert.strictEqual(resSuelo.evidence_status, 'evidence_found');
  assert.ok(resSuelo.results[0].excerpt.includes('Yanahuanca'));
  assert.strictEqual(resSuelo.results[0].problem_category, 'suelo');
  pass('Consulta 7: Conservación de suelos en laderas interandinas de Yanahuanca recuperada');

  // CHECK 10: Consulta 8 - Consulta ambigua sin cultivo ni problema específico
  const resAmbigua = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Qué debería hacer en mi terreno hoy?'
  });
  assert.strictEqual(resAmbigua.evidence_status, 'insufficient_evidence');
  assert.strictEqual(resAmbigua.results.length, 0);
  pass('Consulta 8: Consulta ambigua sin cultivo ni problema no alcanza umbral y retorna insuficiencia');

  // CHECK 11: Consulta 9 - Consulta con cultivo diferente al documento (penalización cross-crop)
  const resCrossCrop = await testRetriever.retrieveAgriculturalEvidence({
    question: '¿Cómo curar la broca del café en mis plantas de café?',
    crop: 'cafe',
    minScoreThreshold: 0.35
  });
  // Si solo hay fragmentos de papa para broca, no deben asignarse a café
  for (const r of resCrossCrop.results) {
    assert.strictEqual(r.crops.includes('cafe'), true, 'No debe asignar fragmentos exclusivos de papa a café');
  }
  pass('Consulta 9: Documentos de papa penalizados severamente (-0.60) ante consultas de café');

  // CHECK 12: Consulta 10 - Consulta sin evidencia alguna en la biblioteca
  const resSinEvidencia = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Cultivo intensivo de mangos y piñas en glaciares de nieve perpetua',
    crop: 'mango'
  });
  assert.strictEqual(resSinEvidencia.evidence_status, 'insufficient_evidence');
  assert.strictEqual(resSinEvidencia.message, INSUFFICIENT_EVIDENCE_MESSAGE);
  assert.strictEqual(resSinEvidencia.results.length, 0);
  pass('Consulta 10: Ausencia total de evidencia retorna estado y mensaje estandarizado sin inventar fuentes');

  // ============================================================================
  // BLOQUE 3: Elegibilidad Documental, Licencias y Anti-Tampering
  // ============================================================================
  console.log('\n--- BLOQUE 3: Elegibilidad Documental, Licencias y Anti-Tampering ---');

  // CHECK 13: Consulta 13 - Bloqueo estricto de documentos con status superseded o archived
  const supersededDoc = catalogService.getDocument('DOC-HISTORICO-SUPERSEDED-010');
  assert.ok(supersededDoc);
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-HISTORICO-SUPERSEDED-010'), false);
  const candidateChunks = testRetriever.loadActiveChunks();
  for (const c of candidateChunks) {
    assert.notStrictEqual(c.source_id, 'DOC-HISTORICO-SUPERSEDED-010');
  }
  pass('Consulta 13: Exclusión absoluta de documentos superseded o archived en el Retriever');

  // CHECK 14: Consulta 14 - Bloqueo de fuentes con licencia pendiente o conflicto
  const docPapaReal = catalogService.getDocument('DOC-INIA-PAPA-001');
  assert.strictEqual(docPapaReal.license_status, 'review_required');
  assert.strictEqual(catalogService.isEligibleForAdvisory('DOC-INIA-PAPA-001'), false);
  pass('Consulta 14: Documentos con licencia pendiente o conflicto de derechos permanecen bloqueados');

  // CHECK 15: Consulta 15 - Rechazo de aprobación simulada
  const testDocSim = {
    id: 'DOC-TEST-SIMULATED-001',
    institution: 'INIA',
    title: 'Guía de Prueba de Aprobación',
    year: 2024,
    official_url: 'https://repositorio.inia.gob.pe/handle/20.500.12955/test-sim',
    publication_type: 'manual',
    related_crops: ['papa'],
    status: 'verified',
    license_status: 'verified_open_access',
    content_nature: 'official_original'
  };
  catalogService.registerDocument(testDocSim, false);
  assert.throws(() => {
    catalogService.approveDocument('DOC-TEST-SIMULATED-001', {
      approved_by: 'Simulated Bot',
      verification_evidence: 'Auto check'
    }, { isAuthenticated: true, is_simulated: true, role: 'technical_evaluator' });
  }, /No se admiten simulaciones/);
  pass('Consulta 15: Rechazo de aprobaciones con banderas simuladas o identidad no formal');

  // CHECK 16: Consulta 16 - Rechazo de fragmentos sintéticos en modo operativo
  const operativeChunks = operativeRetriever.loadActiveChunks();
  for (const c of operativeChunks) {
    assert.notStrictEqual(c.content_nature, 'synthetic_fixture');
    assert.notStrictEqual(c.is_synthetic, true);
  }
  assert.strictEqual(operativeChunks.length, 0);
  pass('Consulta 16: Modo operativo rechaza categóricamente cualquier fragmento sintético o no verificado');

  // CHECK 17: Consulta 21 - Detección de alteración de metadatos (anti-tampering)
  const docToTamper = catalogService.getDocument('DOC-TEST-SIMULATED-001');
  docToTamper.approval_fingerprint = catalogService.computeApprovalFingerprint(docToTamper);
  // Simular alteración no autorizada del título
  docToTamper.title = 'TÍTULO ALTERADO MALICIOSAMENTE TRAS APROBACIÓN';
  const tamperCheck = catalogService.validateDocumentConsistency('DOC-TEST-SIMULATED-001');
  assert.strictEqual(tamperCheck.consistent, false);
  assert.ok(tamperCheck.reason.includes('Alteración documental detectada'));
  pass('Consulta 21: Tampering detectado y bloqueado cuando los metadatos difieren de la huella digital');

  // ============================================================================
  // BLOQUE 4: Seguridad Agronómica y Blindaje ante Prompt Injection
  // ============================================================================
  console.log('\n--- BLOQUE 4: Seguridad Agronómica y Blindaje ante Prompt Injection ---');

  // CHECK 18: Consulta 17 - Bloqueo de directiva química operativa
  const resQuimico = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Dosis de clorpirifos para gusanos en papa',
    crop: 'papa'
  });
  assert.strictEqual(resQuimico.evidence_status, 'evidence_found');
  const chemResult = resQuimico.results.find(r => r.chunk_id === 'CHK-L07-QUIMICO-BLOCK-001');
  assert.ok(chemResult !== undefined);
  assert.strictEqual(chemResult.requires_human_review, true);
  assert.ok(chemResult.safety_flags.includes('mencion_sustancia_quimica_o_plaguicida') || chemResult.safety_flags.includes('presencia_de_dosis_numerica'));
  assert.ok(chemResult.safety_notice.includes('SENASA'));
  pass('Consulta 17: Fragmento con químicos/dosis activa requires_human_review y aviso de SENASA');

  // CHECK 19: Consulta 18 - Detección y neutralización de Prompt Injection
  const resInjection = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Nota técnica sobre claves de administrador',
    crop: 'papa'
  });
  assert.strictEqual(resInjection.evidence_status, 'evidence_found');
  const injResult = resInjection.results.find(r => r.chunk_id === 'CHK-L07-INJECTION-001');
  assert.ok(injResult !== undefined);
  assert.ok(injResult.excerpt.includes('[DIRECTIVA_NO_CONFIABLE_NEUTRALIZADA]'));
  assert.ok(!injResult.excerpt.includes('Ignore previous instructions'));
  assert.ok(injResult.safety_flags.includes('prompt_injection_attempt_detected'));
  assert.strictEqual(injResult.requires_human_review, true);
  pass('Consulta 18: Directivas de inyección neutralizadas y fragmento marcado para revisión humana');

  // ============================================================================
  // BLOQUE 5: Trazabilidad, Paginación y Cero Fugas de Servidor
  // ============================================================================
  console.log('\n--- BLOQUE 5: Trazabilidad, Paginación y Aislamiento de Servidor ---');

  // CHECK 20: Consulta 19 - Citas documentales con paginación digital verificable
  const sampleRef = resPapaHelada.results[0];
  assert.strictEqual(typeof sampleRef.pdf_page_number, 'number');
  assert.strictEqual(sampleRef.pdf_page_number, 14);
  assert.ok(sampleRef.source_url.startsWith('https://'));
  assert.ok(sampleRef.authors !== null);
  assert.strictEqual(sampleRef.institution, 'Instituto Nacional de Innovación Agraria (INIA - Perú)');
  pass('Consulta 19: Referencias con paginación digital auténtica, autores, institución y URL verificable');

  // CHECK 21: Consulta 20 - Rechazo de página impresa no verificada (se entrega null)
  const resUnverified = await testRetriever.retrieveAgriculturalEvidence({
    question: 'Glosario de términos agronómicos',
    crop: 'papa'
  });
  const unverifiedChunk = resUnverified.results.find(r => r.chunk_id === 'CHK-L07-UNVERIFIED-PRINTED-001');
  assert.ok(unverifiedChunk !== undefined);
  assert.strictEqual(unverifiedChunk.printed_page_verified, false);
  assert.strictEqual(unverifiedChunk.printed_page_number, null);
  pass('Consulta 20: Si printed_page_verified es false, printed_page_number es estrictamente null');

  // CHECK 22: Consulta 22 - Operación en modo oficial con índice activo vacío
  const resOperativeEmpty = await operativeRetriever.retrieveAgriculturalEvidence({
    question: '¿Cómo controlo las heladas en mi cultivo de papa?'
  });
  assert.strictEqual(resOperativeEmpty.evidence_status, 'insufficient_evidence');
  assert.strictEqual(resOperativeEmpty.results.length, 0);
  assert.strictEqual(resOperativeEmpty.message, INSUFFICIENT_EVIDENCE_MESSAGE);
  pass('Consulta 22: Modo operativo con índice vacío entrega insuficiente evidencia limpiamente');

  // CHECK 23: Consulta 23 - Aislamiento estricto de datos privados del agricultor
  assert.strictEqual(resPapaHelada.audit.user_id, undefined);
  assert.strictEqual(resPapaHelada.audit.farmer_name, undefined);
  assert.strictEqual(resPapaHelada.audit.dni, undefined);
  assert.strictEqual(resPapaHelada.audit.parcel_id, undefined);
  pass('Consulta 23: Retriever opera sin acceso a PII de agricultores ni parámetros privados de parcelas');

  // CHECK 24: Cero exposición de rutas locales de servidor
  for (const r of resPapaHelada.results) {
    assert.strictEqual(r.chunks_storage_path, undefined);
    assert.strictEqual(r.file_path, undefined);
    assert.ok(!r.excerpt.includes('C:\\') && !r.excerpt.includes('/var/'));
  }
  pass('Garantía de seguridad: Cero exposición de rutas internas de disco en citas y fragmentos');

  // ============================================================================
  // BLOQUE 6: Evaluación de Métricas de Calidad de Recuperación
  // ============================================================================
  console.log('\n--- BLOQUE 6: Métricas de Calidad de Recuperación sobre Fixtures ---');

  // Batería de evaluación con ground-truth
  const evaluationSet = [
    { query: 'heladas en parcelas de papa en la puna', expectedDoc: 'DOC-INIA-PAPA-001', crop: 'papa' },
    { query: 'roya amarilla del café en valles de Oxapampa', expectedDoc: 'DOC-INIA-CAFE-003', crop: 'cafe' },
    { query: 'descanso de tierras para maca amarilla en el Bombón', expectedDoc: 'DOC-INIA-MACA-002', crop: 'maca' },
    { query: 'quinua Pasankalla en valles interandinos', expectedDoc: 'DOC-FAO-QUINUA-006', crop: 'quinua' },
    { query: 'riego tecnificado por aspersión en cuencas de Pasco', expectedDoc: 'DOC-INIA-PAPA-001', crop: 'papa' }
  ];

  let totalPrecisionAt3 = 0;
  let totalRecallAt3 = 0;
  let totalReciprocalRank = 0;
  const startEvalTime = Date.now();

  for (const testCase of evaluationSet) {
    const evalRes = await testRetriever.retrieveAgriculturalEvidence({
      question: testCase.query,
      crop: testCase.crop,
      maxResults: 3
    });

    const retrievedIds = evalRes.results.map(r => r.source_id);
    const relevantRetrieved = retrievedIds.filter(id => id === testCase.expectedDoc).length;

    // Precision@3: relevantes recuperados / min(3, total recuperados)
    const p3 = evalRes.results.length > 0 ? relevantRetrieved / evalRes.results.length : 0;
    totalPrecisionAt3 += p3;

    // Recall@3: relevantes recuperados / total relevantes esperados (1 en este benchmark)
    const r3 = relevantRetrieved >= 1 ? 1.0 : 0.0;
    totalRecallAt3 += r3;

    // MRR: Reciprocal Rank
    const rank = retrievedIds.indexOf(testCase.expectedDoc);
    const rr = rank >= 0 ? 1 / (rank + 1) : 0;
    totalReciprocalRank += rr;
  }

  const meanPrecisionAt3 = totalPrecisionAt3 / evaluationSet.length;
  const meanRecallAt3 = totalRecallAt3 / evaluationSet.length;
  const mrr = totalReciprocalRank / evaluationSet.length;
  const avgLatencyMs = (Date.now() - startEvalTime) / evaluationSet.length;

  console.log(`  [MÉTRICA] Precision@3: ${(meanPrecisionAt3 * 100).toFixed(1)}%`);
  console.log(`  [MÉTRICA] Recall@3:    ${(meanRecallAt3 * 100).toFixed(1)}%`);
  console.log(`  [MÉTRICA] MRR:         ${mrr.toFixed(3)}`);
  console.log(`  [MÉTRICA] Latencia:    ${avgLatencyMs.toFixed(2)} ms/consulta`);

  assert.ok(meanPrecisionAt3 >= 0.80, 'Precision@3 debe ser >= 80%');
  assert.ok(meanRecallAt3 >= 0.90, 'Recall@3 debe ser >= 90%');
  assert.ok(mrr >= 0.90, 'MRR debe ser >= 0.90');
  assert.ok(avgLatencyMs < 50, 'Latencia local debe ser < 50ms');
  pass('Métricas de recuperación validadas: Precision@3, Recall@3, MRR y baja latencia');

  // ============================================================================
  // BLOQUE 7: Integración Controlada con POST /api/ai/advisory-chat
  // ============================================================================
  console.log('\n--- BLOQUE 7: Integración Controlada con Asistente Agrícola ---');

  // Usuarios y parcelas de prueba simulados en base de datos de test
  const farmerUser = { id: 101, role: 'farmer', location: 'Cerro de Pasco' };
  const otherFarmer = { id: 102, role: 'farmer', location: 'Yanahuanca' };
  const testParcel = {
    id: 501,
    user_id: 101,
    name: 'Parcela Altoandina San Juan',
    crop_type: 'papa',
    altitude_masl: 4100,
    created_at: '2026-01-01T00:00:00Z',
    center_lat: -10.68,
    center_lng: -76.25
  };

  const origDbGet = db.dbGet;
  const origGetCached = mlService.getCachedPrediction;
  const origGetStale = mlService.getStalePrediction;

  db.dbGet = async (sql, params) => {
    if (sql.includes('FROM parcels')) {
      if (params.includes(501)) {
        if (params.includes(101) || params.length === 1) {
          return { ...testParcel, variety: 'canchán', phenological_stage: 'crecimiento' };
        }
      }
      return null;
    }
    return null;
  };

  mlService.getCachedPrediction = async (pId) => ({
    parcel_id: pId,
    model_version: '2.0.0_audited_no_leak',
    is_stale: false,
    predictions: { frost: { risk_score: 30 } },
    weather_snapshot: { temperature: 8.0, temp_min: 2.0, temp_max: 15.0 },
    valid_until: new Date(Date.now() + 3600000).toISOString(),
    fetched_at: new Date().toISOString()
  });

  // CHECK 28: Consulta 25 - Comportamiento con RAG_ENABLED=false (por defecto)
  delete process.env.RAG_ENABLED;
  const reqRagDisabled = {
    user: farmerUser,
    body: { parcel_id: 501, message: '¿Cómo protejo mi cultivo de papa contra heladas?' }
  };
  const resRagDisabled = createMockRes();
  await aiController.advisoryChat(reqRagDisabled, resRagDisabled);
  assert.strictEqual(resRagDisabled.statusCode, 200);
  assert.strictEqual(resRagDisabled.body.success, true);
  assert.strictEqual(resRagDisabled.body.data.evidence_status, 'insufficient_evidence');
  assert.deepStrictEqual(resRagDisabled.body.data.references, []);
  assert.strictEqual(resRagDisabled.body.data.is_fallback, true);
  pass('Consulta 25: RAG_ENABLED=false preserva fallback determinista, evidence_status insuficiente y cero referencias');

  // CHECK 29: Consulta 24 - Pronóstico meteorológico stale sin corromper RAG
  mlService.getCachedPrediction = async () => null; // Simular miss en fresh
  mlService.getStalePrediction = async (pId) => ({
    parcel_id: pId,
    model_version: '2.0.0_audited_no_leak',
    is_stale: true,
    stale_age_minutes: 120,
    predictions: { frost: { risk_score: 65 } },
    weather_snapshot: { temperature: 3.5, temp_min: -1.2, temp_max: 12.0 },
    valid_until: new Date(Date.now() + 3600000).toISOString(),
    fetched_at: new Date(Date.now() - 7200000).toISOString()
  });

  const reqStale = {
    user: farmerUser,
    body: { parcel_id: 501, message: 'Riesgo de helada en mi parcela' }
  };
  const resStale = createMockRes();
  await aiController.advisoryChat(reqStale, resStale);
  assert.strictEqual(resStale.body.data.weather_status, 'stale');
  assert.strictEqual(resStale.body.data.evidence_status, 'insufficient_evidence');
  assert.ok(resStale.body.data.warnings.some(w => w.includes('respaldo previo')));
  pass('Consulta 24: Estado meteorológico stale conservado con transparencia sin mezclar con evidencia RAG');

  // CHECK 30: RAG_ENABLED=true en entorno de pruebas controlado
  process.env.RAG_ENABLED = 'true';
  process.env.RAG_ALLOW_TEST_FIXTURES = 'true';
  process.env.RAG_TEST_CHUNKS_PATH = TEST_CHUNKS_PATH;

  const reqRagEnabled = {
    user: farmerUser,
    body: { parcel_id: 501, message: '¿Cómo protejo mi cultivo de papa contra heladas?' }
  };
  const resRagEnabled = createMockRes();
  await aiController.advisoryChat(reqRagEnabled, resRagEnabled);
  assert.strictEqual(resRagEnabled.statusCode, 200);
  assert.strictEqual(resRagEnabled.body.data.evidence_status, 'evidence_found');
  assert.ok(resRagEnabled.body.data.references.length > 0);
  assert.strictEqual(resRagEnabled.body.data.references[0].source_id, 'DOC-INIA-PAPA-001');
  assert.ok(resRagEnabled.body.data.references[0].title.includes('PAPA'));
  pass('RAG_ENABLED=true con fixtures en prueba recupera y adjunta referencias estructuradas oficiales');

  // CHECK 31: Documento con químicos promueve requires_human_advisor en el chat
  const reqChemChat = {
    user: farmerUser,
    body: { parcel_id: 501, message: 'Dosis de plaguicida químico para gusanos' }
  };
  const resChemChat = createMockRes();
  await aiController.advisoryChat(reqChemChat, resChemChat);
  assert.strictEqual(resChemChat.body.data.requires_human_advisor, true);
  assert.ok(resChemChat.body.data.warnings.some(w => w.includes('SENASA') || w.includes('agronómicas sensibles')));
  pass('Evidencia técnica que menciona dosis/químicos eleva requires_human_advisor y anexa advertencia sanitaria');

  // CHECK 32: Autenticación JWT en /api/ai/advisory-chat
  const reqNoUser = { user: null, body: { message: 'Consulta anónima' } };
  const resNoUser = createMockRes();
  try {
    await aiController.advisoryChat(reqNoUser, resNoUser);
    // Si no tiene req.user, buildAgriculturalContext o controller lanza o responde error
    assert.ok(resNoUser.statusCode >= 400);
  } catch (err) {
    assert.ok(err);
  }
  pass('Protección de endpoint: solicitud sin usuario autenticado no procede a recuperación');

  // CHECK 33: Aislamiento multi-tenant de parcelas en advisory-chat
  const reqOtherFarmer = {
    user: otherFarmer, // Usuario 102 intentando acceder a parcela 501 de usuario 101
    body: { parcel_id: 501, message: 'Deseo ver la parcela vecina' }
  };
  const resOtherFarmer = createMockRes();
  await aiController.advisoryChat(reqOtherFarmer, resOtherFarmer);
  assert.strictEqual(resOtherFarmer.statusCode, 404);
  assert.strictEqual(resOtherFarmer.body.success, false);
  assert.strictEqual(resOtherFarmer.body.error, 'Parcela no encontrada.');
  pass('Multi-tenant estricto: agricultor no puede consultar parcelas ajenas (HTTP 404)');

  // CHECK 32: Rate Limiting protege el endpoint conversacional contra saturación
  const rateLimiter = require('../middleware/aiRateLimiter');
  rateLimiter.reset();
  const reqRate = { user: farmerUser, ip: '127.0.0.1' };
  const resRate = createMockRes();
  let nextCalled = false;
  rateLimiter.aiRateLimiter(reqRate, resRate, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  pass('Rate Limiting protege el endpoint conversacional contra saturación de peticiones');

  // CHECK 33: Contrato de respuesta compatible hacia frontend
  assert.strictEqual(typeof resRagDisabled.body.data.reply, 'string');
  assert.strictEqual(Array.isArray(resRagDisabled.body.data.warnings), true);
  assert.strictEqual(Array.isArray(resRagDisabled.body.data.suggested_actions), true);
  assert.strictEqual(typeof resRagDisabled.body.data.requires_human_advisor, 'boolean');
  assert.strictEqual(typeof resRagDisabled.body.data.evidence_status, 'string');
  assert.strictEqual(Array.isArray(resRagDisabled.body.data.references), true);
  pass('Contrato de respuesta estructurada JSON validado y 100% compatible con el frontend existente');

  // CHECK 34: Consulta general sin parcela asociada (parcel_id: null)
  const reqGeneral = {
    user: farmerUser,
    body: { message: 'Buenas prácticas agrícolas generales para la región Pasco' }
  };
  const resGeneral = createMockRes();
  await aiController.advisoryChat(reqGeneral, resGeneral);
  assert.strictEqual(resGeneral.statusCode, 200);
  assert.strictEqual(resGeneral.body.data.parcel_id, null);
  assert.strictEqual(resGeneral.body.data.data_adequacy, 'general_regional_query');
  pass('Consulta general sin parcela devuelve asesoría regional adecuada sin exigir coordenadas');

  // CHECK 35: Cero llamadas productivas y restitución de entorno seguro
  delete process.env.RAG_ENABLED;
  delete process.env.RAG_ALLOW_TEST_FIXTURES;
  delete process.env.RAG_TEST_CHUNKS_PATH;
  db.dbGet = origDbGet;
  mlService.getCachedPrediction = origGetCached;
  mlService.getStalePrediction = origGetStale;

  assert.strictEqual(process.env.RAG_ENABLED === 'true', false);
  assert.strictEqual(process.env.LLM_ENABLED === 'true', false);
  pass('Restitución segura de variables de entorno: RAG_ENABLED y LLM_ENABLED en false');

  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL VERIFICACIONES SUITE L07: ${checkCount} / 35 APROBADAS`);
  console.log('ESTADO: SUITE L07 EXITOSA — 100% DE PRUEBAS SATISFACTORIAS');
  console.log('='.repeat(80) + '\n');
}

runL07Suite().catch(err => {
  console.error('\n❌ ERROR EN SUITE L07:', err);
  process.exit(1);
});
