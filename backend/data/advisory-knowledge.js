/**
 * AgroPasco — Base de Conocimiento Agrícola
 * Consejos y recomendaciones para cultivos de la Región Pasco, Perú
 * Fuente: INIA, MINAGRI, prácticas tradicionales andinas
 */

const advisoryKnowledge = [
  // ========== PAPA ==========
  { crop_type: 'papa', category: 'siembra', condition: 'general', recommendation: 'La papa en Pasco se siembra entre septiembre y noviembre. Seleccionar tubérculos-semilla de 40-60g, sanos y con brotes cortos. Profundidad de siembra: 10-15 cm.' },
  { crop_type: 'papa', category: 'siembra', condition: 'altitud', recommendation: 'En altitudes superiores a 3800 msnm, preferir variedades nativas como Huayro, Peruanita o Canchan que toleran mejor el frío y las heladas.' },
  { crop_type: 'papa', category: 'riego', condition: 'seco', recommendation: 'En época seca, aplicar riego por surcos cada 7-10 días. El suelo debe mantenerse húmedo pero no encharcado. Riego crítico durante floración y tuberización.' },
  { crop_type: 'papa', category: 'riego', condition: 'lluvia', recommendation: 'En temporada de lluvias (diciembre-marzo), asegurar buen drenaje. Evitar encharcamiento que causa pudrición de tubérculos. Construir surcos de drenaje.' },
  { crop_type: 'papa', category: 'fertilizacion', condition: 'general', recommendation: 'Aplicar abono orgánico (estiércol de ovino o vacuno compostado) 2-3 t/ha al momento de la siembra. Complementar con guano de isla 1 t/ha al aporque.' },
  { crop_type: 'papa', category: 'fertilizacion', condition: 'organico', recommendation: 'Para certificación orgánica: usar biol (biofertilizante líquido), compost y humus de lombriz. Evitar agroquímicos. Rotación con leguminosas (habas, trébol).' },
  { crop_type: 'papa', category: 'proteccion', condition: 'helada', recommendation: '⚠️ ALERTA HELADA: Aplicar riego por aspersión antes del amanecer (3-5 AM). Cubrir con paja o plástico agrícola. La papa en floración es extremadamente vulnerable a temperaturas bajo 0°C.' },
  { crop_type: 'papa', category: 'proteccion', condition: 'granizo', recommendation: '⚠️ ALERTA GRANIZO: Proteger con malla antigranizo si es posible. Después del granizo, aplicar fungicida orgánico (caldo bordelés) para prevenir infecciones en heridas del follaje.' },
  { crop_type: 'papa', category: 'proteccion', condition: 'plaga', recommendation: 'Para el gorgojo de los Andes (principal plaga en Pasco): rotar cultivos, recoger adultos manualmente al anochecer, usar trampas de luz, aplicar Beauveria bassiana (control biológico).' },
  { crop_type: 'papa', category: 'cosecha', condition: 'general', recommendation: 'Cosechar cuando el follaje se ha secado naturalmente (120-150 días post-siembra). Dejar secar los tubérculos al sol 2-3 horas. Almacenar en lugar fresco, oscuro y ventilado.' },
  { crop_type: 'papa', category: 'calidad', condition: 'primera', recommendation: 'Para calidad de primera: seleccionar tubérculos de 80-120g, sin daño mecánico, sin verdeo, sin plagas visibles. Clasificar por tamaño. Presentar en costales limpios de 50 kg.' },

  // ========== MACA ==========
  { crop_type: 'maca', category: 'siembra', condition: 'general', recommendation: 'La maca se siembra entre septiembre y noviembre en altitudes de 3800-4500 msnm. Usar semillas de maca seleccionada. Suelo bien preparado, suelto y con materia orgánica.' },
  { crop_type: 'maca', category: 'siembra', condition: 'altitud', recommendation: 'La maca de Pasco (Junín/Pasco) es la más valorada del mundo. Sembrar en terrenos con descanso mínimo de 5 años para asegurar calidad premium.' },
  { crop_type: 'maca', category: 'riego', condition: 'general', recommendation: 'La maca es mayormente de secano (depende de lluvias). En años secos, riego suplementario ligero. No tolera encharcamiento.' },
  { crop_type: 'maca', category: 'fertilizacion', condition: 'organico', recommendation: 'Solo fertilización orgánica para maca de exportación: estiércol descompuesto de ovino aplicado 3 meses antes de la siembra durante la preparación del terreno.' },
  { crop_type: 'maca', category: 'proteccion', condition: 'helada', recommendation: 'La maca tolera heladas moderadas (-5°C). Sin embargo, heladas severas prolongadas pueden dañar las plántulas jóvenes. Monitorear temperatura nocturna.' },
  { crop_type: 'maca', category: 'cosecha', condition: 'general', recommendation: 'Cosecha a los 8-9 meses (mayo-julio). Extraer hipocótilos manualmente. Secar al sol durante 45-60 días sobre mantas limpias, protegiendo de lluvias.' },
  { crop_type: 'maca', category: 'calidad', condition: 'primera', recommendation: 'Maca de primera: hipocótilos de 3-5 cm de diámetro, sin rajaduras, bien secos (humedad <12%), color uniforme. Clasificar por color: amarilla, roja, negra.' },

  // ========== HABAS ==========
  { crop_type: 'habas', category: 'siembra', condition: 'general', recommendation: 'Sembrar habas entre octubre y diciembre. Distancia entre surcos: 60-80 cm. Entre plantas: 25-30 cm. Profundidad: 5-8 cm. Excelente para rotación después de papa.' },
  { crop_type: 'habas', category: 'riego', condition: 'general', recommendation: 'Riego moderado cada 10-12 días en ausencia de lluvias. Crítico durante floración y llenado de vainas. Evitar exceso de agua que favorece hongos.' },
  { crop_type: 'habas', category: 'fertilizacion', condition: 'general', recommendation: 'Las habas fijan nitrógeno del aire (leguminosa). Aplicar solo fósforo y potasio. Abono orgánico: 1.5 t/ha de compost al momento de la siembra.' },
  { crop_type: 'habas', category: 'proteccion', condition: 'helada', recommendation: '⚠️ Las habas son moderadamente tolerantes a heladas (-3°C). Proteger solo en heladas severas. Las vainas tiernas son más vulnerables que la planta vegetativa.' },
  { crop_type: 'habas', category: 'cosecha', condition: 'general', recommendation: 'Cosecha en verde: cuando las vainas están turgentes y los granos han llenado. Cosecha en seco: cuando las vainas se tornan negras y la planta se seca.' },

  // ========== QUINUA ==========
  { crop_type: 'quinua', category: 'siembra', condition: 'general', recommendation: 'Siembra de octubre a noviembre. Densidad: 8-10 kg/ha de semilla. Surcos a 40-60 cm. Suelo bien nivelado. La quinua tolera suelos pobres y salinos.' },
  { crop_type: 'quinua', category: 'riego', condition: 'general', recommendation: 'La quinua es tolerante a sequía. Riego suplementario solo en fases críticas: emergencia, ramificación y llenado de grano. Evitar encharcamiento.' },
  { crop_type: 'quinua', category: 'fertilizacion', condition: 'organico', recommendation: 'Aplicar 2 t/ha de compost o estiércol descompuesto. Complementar con biol al follaje cada 15 días durante crecimiento vegetativo.' },
  { crop_type: 'quinua', category: 'proteccion', condition: 'helada', recommendation: '⚠️ La quinua es sensible a heladas durante floración (-2°C puede destruir la panoja). En etapa vegetativa tolera hasta -4°C.' },
  { crop_type: 'quinua', category: 'cosecha', condition: 'general', recommendation: 'Cosecha cuando los granos están duros y la panoja se seca (abril-mayo). Cortar, secar, trillar y ventar. Lavar bien para eliminar saponinas.' },
  { crop_type: 'quinua', category: 'calidad', condition: 'primera', recommendation: 'Quinua premium: grano limpio, seco (humedad <13%), sin impurezas, calibre uniforme >1.8mm. Lavado y desaponificado reduce amargor.' },

  // ========== CAFÉ (OXAPAMPA/VILLA RICA) ==========
  { crop_type: 'cafe', category: 'siembra', condition: 'general', recommendation: 'Café de Oxapampa y Villa Rica (selva de Pasco) se planta a 1200-1800 msnm. Variedades: Typica, Caturra, Catimor. Sombra con pacae o plátano.' },
  { crop_type: 'cafe', category: 'riego', condition: 'general', recommendation: 'En selva alta generalmente no requiere riego adicional. En época seca prolongada (junio-agosto), riego de mantenimiento cada 15 días.' },
  { crop_type: 'cafe', category: 'fertilizacion', condition: 'organico', recommendation: 'Café orgánico de exportación: compost de pulpa de café + guano de isla + roca fosfórica. Aplicar 200g/planta/año fraccionado en 2 dosis.' },
  { crop_type: 'cafe', category: 'cosecha', condition: 'general', recommendation: 'Cosecha selectiva de cerezas maduras (rojas) entre abril y agosto. Procesamiento húmedo: despulpar, fermentar 18-24h, lavar y secar al sol hasta 11-12% humedad.' },
  { crop_type: 'cafe', category: 'calidad', condition: 'primera', recommendation: 'Café especial de Pasco: puntaje >80 en catación SCA. Seleccionar solo cerezas maduras, secado controlado, almacenamiento en grano pergamino seco.' },

  // ========== OLLUCO ==========
  { crop_type: 'olluco', category: 'siembra', condition: 'general', recommendation: 'Siembra de septiembre a noviembre, a 3200-3900 msnm. Usar tubérculos-semilla sanos de 20-30g. Distancia: 70cm entre surcos, 30cm entre plantas.' },
  { crop_type: 'olluco', category: 'proteccion', condition: 'helada', recommendation: '⚠️ El olluco es sensible a heladas. Proteger con aporque alto y mulch de paja. Si la helada daña el follaje, la planta puede rebrotar desde el tubérculo.' },
  { crop_type: 'olluco', category: 'cosecha', condition: 'general', recommendation: 'Cosecha a los 180-210 días. Tubérculos alargados, lisos, sin daño. Lavar con agua limpia para presentación comercial. Almacenar en lugar fresco.' },

  // ========== MASHUA ==========
  { crop_type: 'mashua', category: 'siembra', condition: 'general', recommendation: 'Siembra de octubre a noviembre, a 3500-4100 msnm. Cultivo rústico que tolera suelos pobres. Excelente para rotación y control de nematodos.' },
  { crop_type: 'mashua', category: 'proteccion', condition: 'helada', recommendation: 'La mashua tolera heladas moderadas (-3°C). Es uno de los tubérculos más resistentes al frío en la agricultura alto-andina de Pasco.' },

  // ========== CONSEJOS GENERALES PARA PASCO ==========
  { crop_type: 'general', category: 'clima', condition: 'helada', recommendation: 'PROTOCOLO ANTI-HELADA PASCO: 1) Monitorear temperatura desde las 2 AM. 2) Si baja de 2°C, activar riego por aspersión. 3) Encender fogatas alrededor del campo (humo reduce radiación). 4) Cubrir cultivos sensibles con plástico o paja.' },
  { crop_type: 'general', category: 'clima', condition: 'granizo', recommendation: 'PROTOCOLO ANTI-GRANIZO: 1) Instalar mallas antigranizo en cultivos de alto valor. 2) Después del evento, evaluar daño, podar partes dañadas, aplicar fungicida preventivo. 3) Documentar daños para seguro agrario.' },
  { crop_type: 'general', category: 'clima', condition: 'sequia', recommendation: 'PROTOCOLO SEQUÍA: 1) Implementar mulch (cobertura muerta) para conservar humedad. 2) Riego por goteo si está disponible. 3) Priorizar riego en cultivos en fase crítica (floración). 4) Cosecha de agua de lluvia.' },
  { crop_type: 'general', category: 'clima', condition: 'lluvia_intensa', recommendation: 'PROTOCOLO LLUVIA INTENSA: 1) Asegurar canales de drenaje limpios. 2) Construir zanjas de infiltración en laderas. 3) Monitorear riesgo de deslizamientos. 4) Proteger almacenes de semillas y cosechas.' },
  { crop_type: 'general', category: 'suelo', condition: 'general', recommendation: 'Suelos de Pasco: generalmente ácidos (pH 4.5-5.5). Aplicar cal agrícola (1-2 t/ha) 2-3 meses antes de la siembra para corregir acidez. Análisis de suelo cada 2 años.' },
  { crop_type: 'general', category: 'calidad', condition: 'primera', recommendation: 'Para demostrar calidad de primera: mantener registros de trazabilidad (fecha de siembra, insumos usados, clima, cuidados), análisis de suelo, y certificaciones orgánicas si aplica.' },
  { crop_type: 'general', category: 'mercado', condition: 'general', recommendation: 'Productos de Pasco con mayor demanda: maca orgánica (exportación), café especial de Oxapampa, papas nativas (gourmet), quinua orgánica. Buscar certificaciones para valor agregado.' },
  { crop_type: 'general', category: 'sostenibilidad', condition: 'general', recommendation: 'Prácticas sostenibles para Pasco: rotación de cultivos (papa-habas-descanso), terrazas en laderas, agroforestería, conservación de semillas nativas, abonos verdes.' },
];

// Calendario agrícola de Pasco
const cropCalendar = {
  papa:    { siembra: ['Sep', 'Oct', 'Nov'], cosecha: ['Feb', 'Mar', 'Abr'], ciclo_dias: '120-150' },
  maca:    { siembra: ['Sep', 'Oct', 'Nov'], cosecha: ['May', 'Jun', 'Jul'], ciclo_dias: '240-270' },
  habas:   { siembra: ['Oct', 'Nov', 'Dic'], cosecha: ['Mar', 'Abr', 'May'], ciclo_dias: '150-180' },
  quinua:  { siembra: ['Oct', 'Nov'],        cosecha: ['Abr', 'May'],        ciclo_dias: '150-180' },
  cafe:    { siembra: ['Ene', 'Feb', 'Mar'], cosecha: ['Abr', 'May', 'Jun', 'Jul', 'Ago'], ciclo_dias: 'Perenne (1a cosecha: 2-3 años)' },
  olluco:  { siembra: ['Sep', 'Oct', 'Nov'], cosecha: ['Abr', 'May', 'Jun'], ciclo_dias: '180-210' },
  mashua:  { siembra: ['Oct', 'Nov'],        cosecha: ['May', 'Jun'],        ciclo_dias: '180-240' },
  oca:     { siembra: ['Oct', 'Nov'],        cosecha: ['May', 'Jun'],        ciclo_dias: '180-240' },
  cebada:  { siembra: ['Oct', 'Nov'],        cosecha: ['Abr', 'May'],        ciclo_dias: '150-170' },
  trigo:   { siembra: ['Nov', 'Dic'],        cosecha: ['May', 'Jun'],        ciclo_dias: '160-180' },
};

// Datos climáticos simulados realistas para Cerro de Pasco (4380 msnm)
const mockWeatherData = {
  current: {
    name: 'Cerro de Pasco',
    coord: { lat: -10.6868, lon: -76.2625 },
    main: { temp: 4.2, feels_like: 1.8, humidity: 72, pressure: 620, temp_min: -2.1, temp_max: 11.5 },
    weather: [{ id: 802, main: 'Clouds', description: 'nubes dispersas', icon: '03d' }],
    wind: { speed: 4.5, deg: 180 },
    visibility: 8000,
    sys: { country: 'PE', sunrise: 1693299600, sunset: 1693342800 },
    altitude: 4380
  },
  forecast: [
    { date: 'Hoy',    temp_min: -2.1, temp_max: 11.5, condition: 'Parcialmente nublado', humidity: 72, rain_prob: 20, icon: '⛅' },
    { date: 'Mañana', temp_min: -3.5, temp_max: 10.2, condition: 'Helada probable', humidity: 85, rain_prob: 40, icon: '🥶' },
    { date: 'Día 3',  temp_min: 0.8,  temp_max: 12.1, condition: 'Soleado', humidity: 65, rain_prob: 10, icon: '☀️' },
    { date: 'Día 4',  temp_min: 1.2,  temp_max: 13.0, condition: 'Soleado con nubes', humidity: 60, rain_prob: 15, icon: '🌤️' },
    { date: 'Día 5',  temp_min: -1.0, temp_max: 9.8,  condition: 'Lluvia ligera', humidity: 88, rain_prob: 70, icon: '🌧️' },
  ]
};

// Guías de Siembra Paso a Paso por Cultivo Regional de Pasco
const plantingGuides = {
  papa: {
    crop_name: 'Papa Nativa',
    icon: '🥔',
    soil_prep: 'Mullir el suelo a 30 cm de profundidad. pH óptimo: 5.5 - 6.5. Desinfectar con ceniza de madera o caldo limosulfocalcio 15 días antes. Incorporar 2-3 t/ha de compost.',
    density: '0.70 a 0.80 m entre surcos y 0.30 m entre golpes/plantas. Densidad: ~40,000 plantas/ha.',
    depth: '10 a 15 cm de profundidad. Cubrir con tierra suelta sin presionar en exceso.',
    initial_fertilization: 'Abonado base: 2.5 t/ha de estiércol descompuesto de ovino/vacuno + 800 kg/ha de guano de isla en el fondo del surco.',
    phenological_stages: {
      siembra: 'Usar semillas-tubérculos sanos de 40-60g con brotes verdes de 1 cm. Tratar contra hongos de suelo.',
      crecimiento: 'Primer aporque a los 30-40 días para cubrir estolones. Aplicar biol foliar (10%) para estimular follaje vigoroso.',
      floracion: 'Fase crítica hídrica: asegurar riego por surcos cada 7-8 días. Aplicar fertilizante rico en potasio y fósforo para desarrollo de tubérculos.',
      cosecha: 'Suspender riego 15 días antes. Cosechar cuando la planta esté seca al 80%. Dejar orear tubérculos 2 horas a la sombra.'
    }
  },
  maca: {
    crop_name: 'Maca Andina',
    icon: '🌿',
    soil_prep: 'Terrenos de puna (3800-4500 msnm) con descanso previo de 3-5 años. Suelo franco-arenoso rico en materia orgánica natural.',
    density: 'Siembra al voleo mezclando la semilla con arena fina limpia en proporción 1:10. Densidad: 2.5 - 3.5 kg/ha de semilla pura.',
    depth: 'Superficial (0.5 a 1 cm). Pasar suavemente una rama de quinual para tapar ligeramente la semilla.',
    initial_fertilization: 'Solo abonado orgánico previo: 3 t/ha de guano descompuesto de ovino incorporado 2 meses antes de la siembra.',
    phenological_stages: {
      siembra: 'Sembrar al inicio de lluvias (sep-nov). Proteger las plántulas recién emergidas de viento desecante.',
      crecimiento: 'Deshierbe manual cuidadoso a los 45 y 90 días. Aplicar abonado foliar orgánico líquido si se aprecia amarillamiento.',
      floracion: 'En la maca para consumo de raíz, evitar que florezca en exceso antes de la maduración del hipocótilo.',
      cosecha: 'Cosechar a los 8-9 meses (mayo-julio). Extraer a mano con pick. Secar al sol de puna durante 45-60 días en mantas.'
    }
  },
  quinua: {
    crop_name: 'Quinua Real / Pasco',
    icon: '🌾',
    soil_prep: 'Rastra fina para mullir perfectamente el suelo. pH tolerado: 5.0 - 8.0. Terrenos bien nivelados para evitar estancamiento.',
    density: 'Surcos distanciados a 0.40 - 0.50 m. Densidad de siembra: 8 a 10 kg/ha.',
    depth: '1 a 2 cm de profundidad. La semilla es muy pequeña; profundidad excesiva impedirá la emergencia.',
    initial_fertilization: 'Abono base al surco: 2 t/ha de humus de lombriz o compost fino. La quinua responde muy bien a biofertilizantes azotados en etapa inicial.',
    phenological_stages: {
      siembra: 'Siembra de octubre a noviembre. Mantener el suelo con humedad constante para asegurar germinación uniforme en 5-7 días.',
      crecimiento: 'Desahije o raleo cuando las plantas tengan 10 cm, dejando 10-15 cm entre plantas. Aplicar biol foliar al 5%.',
      floracion: 'Fase muy sensible a heladas. Evitar estrés hídrico. Monitorear presencia de polilla de la quinua (Kona Kona).',
      cosecha: 'Cosechar cuando el grano rompa al presionar con la uña y la panoja adquiera color pajizo. Secar en parvas antes del trillado.'
    }
  },
  habas: {
    crop_name: 'Habas Verdes / Secas',
    icon: '🫘',
    soil_prep: 'Suelo de textura media con buen drenaje. pH: 6.0 - 7.5. Rotación idónea tras cultivo de papa para fijación de nitrógeno.',
    density: '0.60 a 0.70 m entre surcos y 0.25 a 0.30 m entre golpazos (2 semillas por golpe). Densidad: 80-100 kg/ha de semilla.',
    depth: '5 a 8 cm de profundidad.',
    initial_fertilization: 'Aplicar fósforo (roca fosfórica 300 kg/ha) y potasio. No requiere exceso de nitrógeno (fija nitrógeno atmosférico).',
    phenological_stages: {
      siembra: 'Sembrar de octubre a diciembre. Inocular semillas con Rhizobium leguminosarum para maximizar nódulos radiculares.',
      crecimiento: 'Aporque a los 30 cm de altura para fortalecer tallos contra el viento de altura. Control de pulgón negro.',
      floracion: 'No asperjar agroquímicos fuertes durante la antesis para no ahuyentar abejas polinizadoras. Riego moderado.',
      cosecha: 'Verde (capulí): cuando la vaina esté turgente. Seca: cuando la planta y vaina adquieran color negro brillante.'
    }
  },
  palto: {
    crop_name: 'Palto Hass / Fuerte (Valles de Pasco / Oxapampa)',
    icon: '🥑',
    soil_prep: 'Suelos francos profundos (> 1m) con excelente drenaje interno. pH: 6.0 - 7.0. Hoyos de 80x80x80 cm.',
    density: '5m x 5m o 6m x 4m (400 a 500 árboles/ha).',
    depth: 'Plantar el pilón de la bolsa dejando el cuello de la planta 5 cm por encima del nivel del suelo para evitar fitoftora.',
    initial_fertilization: 'Mezclar en el hoyo de siembra: 15 kg de compost maduro + 500g de guano de isla + 200g de micorrizas.',
    phenological_stages: {
      siembra: 'Instalar al inicio de la temporada húmeda. Proteger los plantones recién trasplantados con tutores de madera.',
      crecimiento: 'Poda de formación para estructurar 3-4 ramas principales. Riego por goteo continuo. Aplicación de zinc y boro foliar.',
      floracion: 'Mantener humedad estable sin saturar el suelo. Aplicación de calcio-boro para mejorar el cuajado del fruto.',
      cosecha: 'Cosechar cuando el fruto alcance el porcentaje de materia seca adecuado (>21.5% para Hass). Usar tijeras con pedúnculo corto.'
    }
  },
  oca: {
    crop_name: 'Oca Andina',
    icon: '🔴',
    soil_prep: 'Mullido profundo de surcos. Tolera suelos ácidos (pH 5.0 - 6.5). Excelente comportamiento en valles interandinos y mesetas.',
    density: '0.70 m entre surcos y 0.30 m entre plantas. Densidad: 1.2 t/ha de tubérculos-semilla.',
    depth: '8 a 12 cm de profundidad.',
    initial_fertilization: 'Incorporar 2 t/ha de estiércol o compost enriquecido con ceniza de madera en el fondo del surco.',
    phenological_stages: {
      siembra: 'Siembra en octubre-noviembre. Seleccionar tubérculos medianos de 30-40g bien brotados.',
      crecimiento: 'Realizar 2 aporques altos para favorecer la estolonización. La oca responde con gran follaje que protege la tierra.',
      floracion: 'Floración de color amarillo-anaranjado. Mantener humedad constante durante la iniciación de tuberización.',
      cosecha: 'Cosechar a los 7-8 meses. Exponer las ocas cosechadas al sol durante 4-7 días (soleado/soleado de oca) para endulzar y reducir oxalatos.'
    }
  }
};

module.exports = { advisoryKnowledge, cropCalendar, mockWeatherData, plantingGuides };

