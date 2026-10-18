/**
 * AgroPasco Digital — Motor de Recomendaciones y Estrategias Agrícolas (Fase 5)
 * ==============================================================================
 * Sistema experto de apoyo a decisiones (DSS) que transforma predicciones ML
 * y distribuciones estocásticas Monte Carlo en acciones agronómicas preventivas
 * específicas para cultivos de la Región Pasco (Papa, Maca, Quinua, Maíz, Habas).
 *
 * Basado en guías técnicas de:
 *  - INIA (Instituto Nacional de Innovación Agraria del Perú)
 *  - SENAMHI (Servicio Nacional de Meteorología e Hidrología)
 *  - FAO (Gestión del riesgo agroclimático en zonas altoandinas)
 *
 * Principio de Gobernanza Técnica:
 *  Las recomendaciones agronómicas son determinadas por reglas expertas
 *  documentadas y trazables. No se permite a modelos de lenguaje inventar
 *  umbrales de temperatura ni procedimientos fitosanitarios.
 */

const db = require('../config/database');

/**
 * Catálogo maestro de estrategias agronómicas por fenómeno meteorológico
 */
const STRATEGY_CATALOG = {
  // =========================================================================
  // 1. ESTRATEGIAS ANTE HELADAS (FROST)
  // =========================================================================
  frost: [
    {
      id_template: 'STRAT-FROST-AGROTEX',
      title: 'Despliegue de Coberturas Agrotéxtiles (Mantas Térmicas)',
      category: 'cobertura_fisica',
      applicable_crops: ['papa', 'maca', 'hortalizas', 'semilleros', 'quinua'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Instalar entre las 16:30 y 18:00 h antes del ocaso',
      time_window: 'Atardecer previo al evento hasta 08:00 h del día siguiente',
      resources_needed: 'Mantas térmicas no tejidas de polipropileno (17 a 30 g/m²), estacas de madera o piedras suaves para fijación perimetral.',
      instructions: [
        'Extender la manta térmica sobre los camellones o surcos cubriendo completamente el dosel foliar.',
        'Asegurar los bordes cada 2 metros para evitar desprendimientos por ráfagas de viento catabático.',
        'Retirar la cobertura a la mañana siguiente (08:30 - 09:00 h) una vez que la radiación solar haya elevado la temperatura sobre 5°C para permitir fotosíntesis y ventilación.',
      ],
      precautions: 'No colocar mantas sobre follaje mojado para evitar puentes térmicos de hielo. No usar plásticos negros en contacto directo con las hojas (conducen frío por contacto).',
      technical_rationale: 'La manta de polipropileno atrapa el calor latente irradiado por el suelo durante la noche, generando un microclima que incrementa la temperatura foliar entre 2.0°C y 3.5°C por encima del ambiente (INIA, Guía Técnica Papa Nativa).',
      limitations: 'Eficaz principalmente en heladas radiantes (cielo despejado y calma de viento). Menor eficacia en heladas advectivas con viento fuerte (>6 m/s).',
    },
    {
      id_template: 'STRAT-FROST-SPRINKLER',
      title: 'Riego por Aspersión Preventivo de Liberación Térmica',
      category: 'manejo_hidrico',
      applicable_crops: ['papa', 'maca', 'maiz', 'habas'],
      min_risk_level: 'high',
      priority: 'critica',
      lead_time_desc: 'Activar entre 02:30 y 04:00 h, antes del punto de congelación',
      time_window: 'Madrugada previa al amanecer (03:00 a 06:30 h)',
      resources_needed: 'Sistema de riego por aspersión operativo, fuente de agua con caudal continuo (mínimo 3.0 mm/h), motobomba o presión por gravedad.',
      instructions: [
        'Monitorear termómetro de mínima al nivel del cultivo a partir de la medianoche.',
        'Iniciar el riego continuo cuando la temperatura descienda a +0.5°C.',
        'Mantener la aspersión ininterrumpida hasta que el sol ilumine la parcela y la capa de hielo comience a derretirse naturalmente.',
      ],
      precautions: 'CRÍTICO: No interrumpir la aspersión mientras la temperatura esté bajo 0°C (la evaporación forzada enfriaría la planta aún más). NO aplicar si la temperatura ambiental cae por debajo de -4.0°C (riesgo de congelamiento de tuberías y aspersores) o si la parcela carece de drenaje (asfixia radicular).',
      technical_rationale: 'El cambio de fase del agua de líquido a sólido libera 80 calorías por gramo (calor latente de congelación), manteniendo el tejido foliar a 0°C mientras exista una película continua de agua congelándose sobre la hoja (FAO - Irrigation and Frost Protection).',
      limitations: 'Requiere disponibilidad hídrica garantizada y ausencia de viento severo (<3.5 m/s).',
    },
    {
      id_template: 'STRAT-FROST-OSMOPROTECT',
      title: 'Aplicación Foliar de Bioestimulantes Osmoprotectores',
      category: 'bioestimulacion',
      applicable_crops: ['papa', 'maca', 'quinua', 'habas', 'maiz'],
      min_risk_level: 'low',
      priority: 'media',
      lead_time_desc: 'Aplicar 12 a 24 horas antes del descenso térmico',
      time_window: 'Mañana o tarde previa (evitar horas de radiación cenital)',
      resources_needed: 'Mochila pulverizadora calibrada, bioestimulante rico en L-Prolina, extracto de algas (Ascophyllum nodosum) o sulfato de potasio foliar soluble.',
      instructions: [
        'Preparar la dilución de bioestimulante osmoprotector o sulfato de potasio soluble siguiendo estrictamente la recomendación del fabricante y la indicación del asesor agronómico.',
        'Pulverizar uniformemente el haz y envés de las hojas asegurando cobertura homogénea.',
      ],
      precautions: 'SUPERVISIÓN AGRONÓMICA: No aplicar concentraciones elevadas sin prescripción técnica colegiada para evitar fitotoxicidad por estrés osmótico en hojas tiernas. No aplicar inmediatamente antes de lluvias (riesgo de lavado). Referencia: CIP/INIA Boletín Técnico Papa N° 14 (2018).',
      technical_rationale: 'El potasio soluble y la prolina aumentan la concentración de solutos en las vacuolas celulares vegetales, provocando un descenso crioscópico del punto de congelación intracelular de 1.0°C a 1.8°C y reduciendo la ruptura de membranas celulares (SENAMHI / INIA).',
      limitations: 'Medida preventiva de apoyo; insuficiente por sí sola frente a heladas severas (< -3.0°C). Requiere validación de dosis con el asesor técnico de la parcela.',
    },
    {
      id_template: 'STRAT-FROST-MULCH',
      title: 'Acolchado Orgánico Edáfico (Mulch de Rastrojo)',
      category: 'conservacion_suelo',
      applicable_crops: ['maca', 'papa', 'hortalizas'],
      min_risk_level: 'low',
      priority: 'baja',
      lead_time_desc: 'Aplicar durante labores culturales o 24-48h antes',
      time_window: 'Horas diurnas previas',
      resources_needed: 'Rastrojo seco de quinua, cebada o avena (capa de 5 a 8 cm), rastrillos.',
      instructions: [
        'Distribuir el rastrojo uniformemente entre las hileras de siembra y alrededor del cuello de las plantas.',
        'Dejar libre la zona de insolación directa si el suelo está húmedo.',
      ],
      precautions: 'Evitar rastrojos infestados con esclerocios de Rhizoctonia o huevos de Gorgojo de los Andes.',
      technical_rationale: 'Reduce la pérdida de calor por convección nocturna y preserva la humedad del bulbo/tubérculo en los primeros 10 cm del perfil de suelo.',
      limitations: 'Protege principalmente la zona radicular y cuello; no protege el follaje aéreo alto.',
    },
  ],

  // =========================================================================
  // 2. ESTRATEGIAS ANTE NEVADAS (SNOW)
  // =========================================================================
  snow: [
    {
      id_template: 'STRAT-SNOW-STRUCTURAL',
      title: 'Refuerzo Mecánico de Invernaderos, Viveros y Cobertizos',
      category: 'infraestructura',
      applicable_crops: ['todos', 'semilleros', 'hortalizas'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Ejecutar 6 a 12 horas antes del evento',
      time_window: 'Previa a la precipitación sólida',
      resources_needed: 'Puntales de eucalipto o tubos galvanizados, alambre galvanizado #16, tensores, escobas suaves de ramas.',
      instructions: [
        'Colocar puntales centrales adicionales debajo de las cumbreras y cerchas de túneles o cobertizos.',
        'Aumentar la tensión de vientos y anclajes laterales.',
        'Durante y después de la nevada, sacudir suavemente las mallas o plásticos con escobillones para evacuar acumulaciones de nieve que superen los 5 cm de espesor.',
      ],
      precautions: 'No golpear los plásticos tensos ni usar objetos punzantes que puedan rasgar la lámina con el frío.',
      technical_rationale: 'La nieve húmeda andina tiene una densidad de 100 a 250 kg/m³. Una capa de 10 cm sobre una estructura de 50 m² genera una sobrecarga de 500 a 1,250 kg, superando el límite elástico de estructuras rústicas (FAO).',
      limitations: 'Aplica a infraestructura agrícola protegida; en campo abierto se prioriza drenaje.',
    },
    {
      id_template: 'STRAT-SNOW-DRAINAGE',
      title: 'Despeje de Zanjas de Evacuación de Deshielo Rápido',
      category: 'manejo_hidrico',
      applicable_crops: ['maca', 'papa', 'quinua'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Revisar y despejar 12 horas antes',
      time_window: 'Antes y durante el derretimiento de nieve',
      resources_needed: 'Palas, zapapicos, azadones.',
      instructions: [
        'Limpiar zanjas perimetrales y desagües naturales eliminando sedimentos y malezas.',
        'Conectar las cabeceras de surcos a la zanja colectora principal.',
      ],
      precautions: 'Evitar excavar zanjas profundas que desestabilicen terrazas o generen cárcavas en laderas.',
      technical_rationale: 'El derretimiento acelerado de la nieve tras la salida del sol satura el suelo en pocas horas, provocando asfixia radicular en tubérculos y condiciones propicias para pudriciones bacterianas (INIA).',
      limitations: 'Eficaz en parcelas con pendiente moderada (>2%). En terrenos planos requiere bombeo auxiliar.',
    },
  ],

  // =========================================================================
  // 3. ESTRATEGIAS ANTE GRANIZADAS (HAIL)
  // =========================================================================
  hail: [
    {
      id_template: 'STRAT-HAIL-NETTING',
      title: 'Despliegue de Mallas Antigranizo en Parcelas de Alto Valor',
      category: 'cobertura_fisica',
      applicable_crops: ['semilleros', 'hortalizas', 'papa', 'maca'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Desplegar ante alertas convectivas o inicio de nubes cumulonimbus',
      time_window: '2 a 6 horas previas a la tormenta de la tarde (13:00 - 17:00 h)',
      resources_needed: 'Mallas antigranizo de polietileno de alta densidad (HDPE) con tejido Raschel o monofilamento, postes de anclaje.',
      instructions: [
        'Extender las mallas tensadas con una pendiente mínima de 20° para permitir que el granizo ruede y no colapse la estructura por peso.',
        'Verificar que las uniones centrales no queden con bolsas donde se deposite granizo acumulado.',
      ],
      precautions: 'Verificar la solidez de los anclajes; las tormentas de granizo suelen ir acompañadas de vientos racheados convectivos.',
      technical_rationale: 'El impacto cinético de piedras de granizo de 5-15 mm alcanza velocidades terminales de 10-20 m/s, defoliando hasta el 80% del cultivo e inutilizando la producción comercial (SENAMHI / INIA).',
      limitations: 'Costo de inversión elevado; priorizado para semilleros certificados y huertos intensivos.',
    },
    {
      id_template: 'STRAT-HAIL-POSTDAMAGE',
      title: 'Tratamiento Fitosanitario Cicatrizante Post-Impacto',
      category: 'fitosanitario',
      applicable_crops: ['papa', 'maca', 'maiz', 'habas'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Aplicar dentro de las 24 a 48 horas posteriores al granizo',
      time_window: 'Primer día soleado tras la granizada',
      resources_needed: 'Fungicida cúprico preventivo (Oxicloruro de Cobre o Sulfato de Cobre pentahidratado) + bioestimulante con aminoácidos libres.',
      instructions: [
        'Realizar una evaluación de severidad del daño mecánico en campo (porcentaje de defoliación y rotura de tallos).',
        'Pulverizar caldo preventivo con fungicida cúprico autorizado según la etiqueta comercial y prescripción de un asesor agronómico para sellar heridas.',
        'Complementar con bioestimulante rico en aminoácidos para inducir brotación de yemas secundarias bajo supervisión técnica.',
      ],
      precautions: 'ADVERTENCIA FITOSANITARIA OBLIGATORIA: La dosificación y aplicación de sales de cobre o fungicidas post-granizada requiere receta agronómica de un profesional colegiado o técnico de SENASA/INIA para evitar fitotoxicidad en tejidos expuestos. No demorar más de 48 horas tras el evento. Referencia: INIA Guía Técnica de Manejo de Papa ante Granizo (2021).',
      technical_rationale: 'Las heridas mecánicas causadas por el granizo rompen la cutícula cerosa protectora. El ion cobre (Cu²⁺) actúa como bactericida y fungicida de contacto por desnaturalización proteica, evitando infecciones secundarias devastadoras (INIA, Manejo Integrado de Plagas).',
      limitations: 'Solo previene infecciones secundarias; no recupera tejido vegetal ya destruido. Requiere supervisión profesional para la calibración de la dosis de campo.',
    },
  ],

  // =========================================================================
  // 4. ESTRATEGIAS ANTE LLUVIAS INTENSAS (HEAVY RAIN)
  // =========================================================================
  heavy_rain: [
    {
      id_template: 'STRAT-RAIN-DRAINAGE',
      title: 'Apertura y Descolmatación de Drenes de Coronación',
      category: 'manejo_hidrico',
      applicable_crops: ['papa', 'maca', 'quinua', 'habas', 'maiz'],
      min_risk_level: 'moderate',
      priority: 'critica',
      lead_time_desc: 'Ejecutar 12 a 24 horas antes del temporal pluvial',
      time_window: 'Previo a lluvias continuas',
      resources_needed: 'Azadones, palas, carretillas, estacas de nivelación.',
      instructions: [
        'Abrir o profundizar zanjas de coronación en la parte alta de la parcela para interceptar la escorrentía superficial proveniente de laderas superiores.',
        'Limpiar los canales de desagüe eliminando ramas, rastrojos y sedimentos acumulados.',
        'Dirigir el agua hacia quebradas naturales o pozas de infiltración protegidas con vegetación.',
      ],
      precautions: 'No verter el agua de los canales sobre taludes inestables que puedan generar deslizamientos (huaycos menores).',
      technical_rationale: 'Las lluvias intensas (>20 mm/día) generan caudales superficiales que erosionan la capa arable fértil y causan anegamiento radicular. El drenaje interceptor reduce hasta un 70% la escorrentía directa sobre el cultivo (FAO / INIA).',
      limitations: 'Requiere mantenimiento continuo y mano de obra comunitaria en laderas compartidas.',
    },
    {
      id_template: 'STRAT-RAIN-HILLING',
      title: 'Aporque Alto y Refuerzo de Camellones en Tubérculos',
      category: 'manejo_agronomico',
      applicable_crops: ['papa', 'maca'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Realizar en labores de cultivo preventivas o 24-48h antes',
      time_window: 'Antes de saturación del suelo',
      resources_needed: 'Lampa andina, chakitaklla o azadón de campo.',
      instructions: [
        'Elevar la altura del camellón entre 25 y 35 cm alrededor de la base del cultivo.',
        'Conformar una cresta redondeada que facilite el escurrimiento lateral del agua hacia el fondo del surco.',
      ],
      precautions: 'No arrancar raíces activas durante la labor de aporque. No manipular suelo completamente saturado (riesgo de sellado superficial y compactación).',
      technical_rationale: 'Mantiene los tubérculos en formación por encima del nivel freático transitorio, previniendo asfixia celular, lenticelosis y pudriciones en postcosecha (INIA).',
      limitations: 'Solo es posible en etapas fenológicas tempranas a intermedias (hasta inicio de floración en papa).',
    },
    {
      id_template: 'STRAT-RAIN-PHYTO',
      title: 'Monitoreo Preventivo y Protección contra Rancha (Phytophthora)',
      category: 'fitosanitario',
      applicable_crops: ['papa'],
      min_risk_level: 'moderate',
      priority: 'alta',
      lead_time_desc: 'Fumigar antes de lluvia si el follaje está seco, o inmediatamente después',
      time_window: 'Ventana seca antes o después de la saturación hídrica',
      resources_needed: 'Fungicida protectante autorizado con registro SENASA, mochila de fumigación calibrada con boquilla de cono hueco.',
      instructions: [
        'Revisar las hojas basales en busca de manchas acuosas verde-oscuras con halo verde claro y pelusa blanquecina en el envés.',
        'Aplicar fungicida protectante autorizado por SENASA siguiendo estrictamente la dosificación de la etiqueta oficial y bajo prescripción del asesor técnico.',
      ],
      precautions: 'ADVERTENCIA FITOSANITARIA OBLIGATORIA: El uso de plaguicidas químicos de síntesis está condicionado a la prescripción del asesor técnico. Usar equipo de protección personal completo (EPP) y respetar los periodos de carencia y reingreso al lote. Rotar ingredientes activos para evitar generación de resistencia fúngica. Referencia: INIA Manual N° 32 Manejo Integrado de Rancha (2019).',
      technical_rationale: 'Las condiciones de lluvia continua con humedad relativa saturada (>85%) y temperaturas templadas constituyen la regla bioclimática de Mills/Wallin para la esporulación masiva de Phytophthora infestans (INIA / CIP).',
      limitations: 'Requiere ventana de al menos 2 horas sin lluvia posterior para que el producto fije adecuadamente en la lámina foliar. Dosificación sujeta a supervisión agronómica.',
    },
  ],
};

/**
 * Servicio principal de Estrategias y Recomendaciones de Mitigación
 */
class MitigationService {
  /**
   * Genera recomendaciones agronómicas estructuradas para una parcela y contexto dados.
   *
   * @param {object} params
   * @param {number} params.parcel_id
   * @param {string} params.crop Tipo de cultivo ('papa', 'maca', 'quinua', 'maiz', 'habas')
   * @param {string} params.phenological_stage Etapa fenológica (ej. 'floracion', 'tuberizacion', 'vegetativo', 'emergencia')
   * @param {string} params.phenomenon Fenómeno ('frost', 'heavy_rain', 'snow', 'hail')
   * @param {string} params.horizon Horizonte ('24h', '48h', '72h')
   * @param {object} params.operational_forecast Datos del pronóstico (temp_min, temp_max, precipitation, humidity, altitude_masl)
   * @param {object} params.ml_prediction Resultado de inferencia ML (risk_level, probability, risk_score)
   * @param {object} params.monte_carlo_results Resultados de simulación (p10, p50, p90, spread, is_supervised_ml)
   * @param {Array}  params.available_resources Recursos registrados por el agricultor
   * @returns {object} Conjunto de recomendaciones estructuradas y justificadas
   */
  generateRecommendations(params) {
    const {
      parcel_id,
      crop = 'papa',
      phenological_stage = 'tuberizacion',
      phenomenon = 'frost',
      horizon = '24h',
      operational_forecast = {},
      ml_prediction = {},
      monte_carlo_results = null,
      available_resources = [],
    } = params;

    const cleanCrop = (crop || 'papa').toLowerCase().trim();
    const cleanPhenomenon = (phenomenon || 'frost').toLowerCase().trim();
    const cleanHorizon = horizon || '24h';
    const altitude = Number(operational_forecast.altitude_masl || 4000);

    const isExplicitRisk = ml_prediction && ml_prediction.risk_level !== undefined;
    const riskLevel = isExplicitRisk ? ml_prediction.risk_level : 'moderate';
    const riskScore = Number(ml_prediction.risk_score ?? (riskLevel === 'moderate' ? 45 : 0));
    const probability = Number(ml_prediction.probability ?? (riskScore / 100));

    // Obtener catálogo de estrategias para el fenómeno
    const candidateStrategies = STRATEGY_CATALOG[cleanPhenomenon] || [];

    // Calcular horas estimadas restantes
    const hoursRemaining = cleanHorizon === '72h' ? 68 : cleanHorizon === '48h' ? 44 : 20;

    // Sensibilidad estocástica según Monte Carlo
    const mcP90 = monte_carlo_results?.percentiles?.p90 ?? probability;
    const mcP10 = monte_carlo_results?.percentiles?.p10 ?? probability;
    const mcSpread = monte_carlo_results?.uncertainty_interval_80?.spread ?? 0;
    const isHighUncertainty = mcSpread > 0.35;

    // Evaluar cada estrategia contra las condiciones agronómicas y de riesgo
    const recommendations = [];

    for (const strat of candidateStrategies) {
      // 1. Verificar si aplica al cultivo de la parcela
      const matchesCrop = strat.applicable_crops.includes(cleanCrop) || strat.applicable_crops.includes('todos');
      if (!matchesCrop) continue;

      // 2. Verificar umbral de activación por nivel de riesgo ML
      const meetsRisk = this._meetsRiskLevel(riskLevel, strat.min_risk_level);
      if (riskLevel === 'none' && !meetsRisk && strat.min_risk_level !== 'low') continue;

      // 3. Modulación de prioridad según cultivo y etapa fenológica
      let adjustedPriority = strat.priority;
      let agronomicNote = '';

      if (cleanPhenomenon === 'frost') {
        if (cleanCrop === 'papa' && (phenological_stage === 'floracion' || phenological_stage === 'tuberizacion')) {
          if (strat.priority === 'alta') adjustedPriority = 'critica';
          agronomicNote = 'Prioridad crítica: la papa se encuentra en fase de floración/tuberización; temperaturas bajo cero destruyen irreversiblemente el área fotosintética.';
        } else if (cleanCrop === 'maca') {
          if (strat.priority === 'critica' && riskLevel !== 'high') adjustedPriority = 'alta';
          agronomicNote = 'La maca tolera heladas moderadas hasta -4°C en fase vegetativa; la prioridad se calibra según rusticidad andina.';
        }
      } else if (cleanPhenomenon === 'heavy_rain') {
        if (cleanCrop === 'maca') {
          agronomicNote = 'La maca es altamente vulnerable a la asfixia por anegamiento prolongado (pudrición de hipocótilos). Se exige drenaje continuo.';
        }
      }

      // 4. Generar ID determinista y trazable
      const strategyId = `${strat.id_template}-${cleanCrop.toUpperCase()}-${cleanHorizon.toUpperCase()}`;

      // 5. Análisis de sensibilidad estocástica
      let sensitivityText = '';
      if (monte_carlo_results) {
        if (mcP90 >= 0.70 && probability < 0.70) {
          sensitivityText = `Alerta de sensibilidad Monte Carlo: Aunque el pronóstico medio indica riesgo moderado (${(probability * 100).toFixed(1)}%), el percentil P90 crítico alcanza ${(mcP90 * 100).toFixed(1)}% bajo variabilidad andina. Se recomienda no postergar esta medida.`;
        } else if (isHighUncertainty) {
          sensitivityText = `Incertidumbre estocástica amplia (dispersión P90-P10: ${(mcSpread * 100).toFixed(1)}%). La severidad del evento puede fluctuar fuertemente según microcuenca.`;
        } else {
          sensitivityText = `Convergencia estocástica robusta: los escenarios simulados confirman de manera consistente el nivel de riesgo ${riskLevel.toUpperCase()}.`;
        }
      } else {
        sensitivityText = 'Evaluación calculada con el pronóstico operativo puntual.';
      }

      // 6. Determinar disponibilidad de recursos
      const resourceAvailable = available_resources.length > 0
        ? available_resources.some(r => strat.resources_needed.toLowerCase().includes(r.toLowerCase()))
        : null;

      recommendations.push({
        strategy_id: strategyId,
        phenomenon: cleanPhenomenon,
        title: strat.title,
        category: strat.category,
        priority: adjustedPriority,
        target_crop: cleanCrop,
        phenological_stage,
        horizon: cleanHorizon,
        time_remaining_hours: hoursRemaining,
        time_window: strat.time_window,
        lead_time_desc: strat.lead_time_desc,
        resources_needed: strat.resources_needed,
        resource_available: resourceAvailable,
        instructions: strat.instructions,
        precautions: strat.precautions,
        technical_rationale: strat.technical_rationale,
        agronomic_context_note: agronomicNote || null,
        limitations: strat.limitations,
        stochastic_sensitivity: sensitivityText,
        source_standard: 'INIA Perú / SENAMHI / FAO Andina',
        status: 'pendiente', // Estado por defecto para seguimiento
        tracking: {
          last_updated: new Date().toISOString(),
          executed_by: null,
          notes: null,
        },
      });
    }

    // Ordenar recomendaciones por prioridad agronómica
    const priorityWeight = { critica: 4, alta: 3, media: 2, baja: 1 };
    recommendations.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));

    return {
      success: true,
      parcel_id: Number(parcel_id),
      context: {
        crop: cleanCrop,
        phenological_stage,
        altitude_masl: altitude,
        phenomenon: cleanPhenomenon,
        horizon: cleanHorizon,
        hours_to_event: hoursRemaining,
        operational_risk: {
          level: riskLevel,
          score: riskScore,
          probability,
        },
        monte_carlo_sensitivity: monte_carlo_results ? {
          p10: mcP10,
          p50: monte_carlo_results?.percentiles?.p50 ?? probability,
          p90: mcP90,
          spread: mcSpread,
          high_dispersion: isHighUncertainty,
        } : null,
      },
      strategies_count: recommendations.length,
      strategies: recommendations,
      governance_disclaimer: {
        nature: 'Estrategias de mitigación agronómica basadas en guías oficiales INIA y SENAMHI.',
        distinction: 'Las recomendaciones son de carácter consultivo preventivo y no reemplazan la inspección técnica presencial del extensionista agrario.',
        action_confirmation: 'Ninguna compra o alteración de inventario se ejecuta de forma automática sin confirmación expresa del agricultor.',
      },
    };
  }

  /**
   * Determina si el nivel de riesgo actual cumple el requisito mínimo de la estrategia
   */
  _meetsRiskLevel(current, required) {
    const ranks = { none: 0, low: 1, moderate: 2, high: 3 };
    const currentRank = ranks[current] || 0;
    const requiredRank = ranks[required] || 0;
    return currentRank >= requiredRank;
  }

  /**
   * Inicializa la tabla de acciones de mitigación en PostgreSQL de manera idempotente
   */
  async ensureSchema() {
    try {
      await db.dbRun(`
        CREATE TABLE IF NOT EXISTS mitigation_actions (
          id SERIAL PRIMARY KEY,
          parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          strategy_id TEXT NOT NULL,
          phenomenon TEXT NOT NULL,
          action_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'en_proceso', 'realizada', 'no_aplicable')),
          horizon TEXT NOT NULL DEFAULT '24h',
          risk_level TEXT NOT NULL DEFAULT 'moderate',
          priority TEXT NOT NULL DEFAULT 'alta',
          time_window TEXT,
          resources_needed TEXT,
          precautions TEXT,
          notes TEXT,
          advisor_notes TEXT,
          advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          executed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT unique_parcel_strategy UNIQUE (parcel_id, strategy_id)
        )
      `);
      await db.dbRun(`CREATE INDEX IF NOT EXISTS idx_mitigation_parcel_id ON mitigation_actions(parcel_id)`);
      await db.dbRun(`CREATE INDEX IF NOT EXISTS idx_mitigation_status ON mitigation_actions(status)`);
    } catch (err) {
      // Ignorar error si ya existe en esquemas alternativos o mocks
    }
  }

  /**
   * Guarda o actualiza el estado de seguimiento de una acción de mitigación
   */
  async updateActionStatus(parcelId, userId, actionData) {
    await this.ensureSchema();

    const {
      strategy_id,
      phenomenon,
      action_name,
      status = 'pendiente',
      horizon = '24h',
      risk_level = 'moderate',
      priority = 'alta',
      time_window = null,
      resources_needed = null,
      precautions = null,
      notes = null,
      executed_at = null,
    } = actionData;

    const validStatuses = ['pendiente', 'en_proceso', 'realizada', 'no_aplicable'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Estado inválido: ${status}. Permitidos: ${validStatuses.join(', ')}`);
    }

    const execTime = status === 'realizada' ? (executed_at || new Date().toISOString()) : null;

    // UPSERT idempotente en PostgreSQL
    const sql = `
      INSERT INTO mitigation_actions (
        parcel_id, user_id, strategy_id, phenomenon, action_name,
        status, horizon, risk_level, priority, time_window,
        resources_needed, precautions, notes, executed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON CONFLICT (parcel_id, strategy_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        notes = COALESCE(EXCLUDED.notes, mitigation_actions.notes),
        executed_at = EXCLUDED.executed_at,
        updated_at = NOW()
      RETURNING *
    `;

    return await db.dbGet(sql, [
      parcelId, userId, strategy_id, phenomenon, action_name,
      status, horizon, risk_level, priority, time_window,
      resources_needed, precautions, notes, execTime
    ]);
  }

  /**
   * Agrega nota técnica de asesor a una acción de parcela
   */
  async addAdvisorNote(parcelId, strategyId, advisorId, advisorNotes) {
    await this.ensureSchema();

    const sql = `
      UPDATE mitigation_actions
      SET advisor_notes = ?, advisor_id = ?, updated_at = NOW()
      WHERE parcel_id = ? AND strategy_id = ?
      RETURNING *
    `;

    return await db.dbGet(sql, [advisorNotes, advisorId, parcelId, strategyId]);
  }

  /**
   * Recupera el historial de acciones y seguimiento para una parcela
   */
  async getParcelActions(parcelId) {
    await this.ensureSchema();

    const sql = `
      SELECT ma.*, u.name as farmer_name, adv.name as advisor_name
      FROM mitigation_actions ma
      LEFT JOIN users u ON ma.user_id = u.id
      LEFT JOIN users adv ON ma.advisor_id = adv.id
      WHERE ma.parcel_id = ?
      ORDER BY ma.updated_at DESC
    `;

    return await db.dbAll(sql, [parcelId]);
  }
}

const defaultMitigationService = new MitigationService();

module.exports = {
  MitigationService,
  defaultMitigationService,
  STRATEGY_CATALOG,
};
