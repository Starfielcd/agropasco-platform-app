/**
 * AgroPasco — Motor de Recomendaciones IA (Sistema Experto basado en reglas)
 * Genera recomendaciones personalizadas según cultivo, clima y etapa
 */

const { getCurrentWeather, getForecast } = require('./weatherService');
const { dbGet, dbAll } = require('../config/database');
const { cropCalendar } = require('../data/advisory-knowledge');

/**
 * Genera recomendaciones personalizadas para un cultivo específico
 */
async function getRecommendations(cropId) {
  const crop = await dbGet('SELECT * FROM crops WHERE id = ?', [cropId]);
  if (!crop) return { error: 'Cultivo no encontrado' };

  const weather = await getCurrentWeather();
  const forecast = await getForecast();
  const temp = weather.main?.temp ?? 5;
  const tempMin = weather.main?.temp_min ?? temp - 3;
  const humidity = weather.main?.humidity ?? 70;

  const recommendations = [];

  // === REGLA 1: Protección contra heladas ===
  if (tempMin <= 2) {
    const severity = tempMin <= -2 ? 'critical' : tempMin <= 0 ? 'high' : 'medium';
    const frostTips = getFrostProtection(crop.crop_type, crop.status, tempMin);
    recommendations.push({
      category: 'proteccion_helada',
      severity,
      title: '🥶 Protección contra Helada',
      message: frostTips.message,
      actions: frostTips.actions,
      urgency: severity === 'critical' ? 'INMEDIATA' : 'En las próximas 6 horas'
    });
  }

  // === REGLA 2: Recomendación de riego ===
  const irrigationRec = getIrrigationRecommendation(crop, temp, humidity, forecast);
  recommendations.push(irrigationRec);

  // === REGLA 3: Fertilización según etapa ===
  const fertRec = getFertilizationRecommendation(crop);
  if (fertRec) recommendations.push(fertRec);

  // === REGLA 4: Alertas por pronóstico futuro ===
  if (forecast && Array.isArray(forecast)) {
    const futureThreats = analyzeFutureThreats(forecast, crop);
    recommendations.push(...futureThreats);
  }

  // === REGLA 5: Calendario de actividades ===
  const calendarRec = getCalendarRecommendation(crop);
  if (calendarRec) recommendations.push(calendarRec);

  return {
    crop: { id: crop.id, name: crop.name, type: crop.crop_type, status: crop.status },
    weather_summary: {
      temp: temp, temp_min: tempMin, humidity: humidity,
      condition: weather.weather?.[0]?.description ?? 'desconocido'
    },
    recommendations,
    generated_at: new Date().toISOString(),
    ai_model: 'AgroPasco Expert System v1.0'
  };
}

function getFrostProtection(cropType, stage, tempMin) {
  const sensitivity = {
    papa: { floracion: 'MUY ALTA', crecimiento: 'ALTA', sembrado: 'MEDIA', maduracion: 'MEDIA' },
    maca: { floracion: 'MEDIA', crecimiento: 'BAJA', sembrado: 'MEDIA', maduracion: 'BAJA' },
    quinua: { floracion: 'MUY ALTA', crecimiento: 'MEDIA', sembrado: 'ALTA', maduracion: 'MEDIA' },
    habas: { floracion: 'ALTA', crecimiento: 'MEDIA', sembrado: 'MEDIA', maduracion: 'BAJA' },
    cafe: { floracion: 'MUY ALTA', crecimiento: 'ALTA', sembrado: 'ALTA', maduracion: 'ALTA' },
  };

  const cropSens = sensitivity[cropType] || sensitivity.papa;
  const stageSens = cropSens[stage] || 'MEDIA';

  let message, actions;

  if (tempMin <= -3) {
    message = `⛔ HELADA SEVERA (${tempMin}°C). Su cultivo de ${cropType} en etapa de ${stage} tiene sensibilidad ${stageSens}. ACCIÓN INMEDIATA REQUERIDA.`;
    actions = [
      'Activar riego por aspersión AHORA (el agua al congelarse libera calor)',
      `Cubrir todo el campo de ${cropType} con plástico agrícola o paja gruesa`,
      'Encender fogatas/humaredas en los bordes del campo',
      'Si tiene ventiladores agrícolas, activarlos para mover el aire frío',
      'Revisar daños al amanecer y aplicar fungicida preventivo si hay daño foliar'
    ];
  } else if (tempMin <= 0) {
    message = `⚠️ Helada moderada esperada (${tempMin}°C). Cultivo de ${cropType} en ${stage}, sensibilidad: ${stageSens}.`;
    actions = [
      'Aplicar riego ligero por aspersión antes de las 4:00 AM',
      `Cubrir las plantas más vulnerables de ${cropType}`,
      'Monitorear temperatura cada hora entre 2:00-6:00 AM',
      'Preparar coberturas adicionales por si la temperatura baja más'
    ];
  } else {
    message = `🌡️ Temperatura baja (${tempMin}°C). Precaución para ${cropType} en ${stage}.`;
    actions = [
      'Tener coberturas preparadas por precaución',
      'Monitorear pronóstico para las próximas noches',
      'Asegurar que el sistema de riego esté operativo'
    ];
  }

  return { message, actions };
}

function getIrrigationRecommendation(crop, temp, humidity, forecast) {
  const irrigationNeeds = {
    papa: { base: 'medio', critical_stages: ['floracion', 'crecimiento'] },
    maca: { base: 'bajo', critical_stages: ['crecimiento'] },
    quinua: { base: 'bajo', critical_stages: ['floracion'] },
    habas: { base: 'medio', critical_stages: ['floracion', 'crecimiento'] },
    cafe: { base: 'medio', critical_stages: ['floracion', 'crecimiento'] },
    olluco: { base: 'medio', critical_stages: ['crecimiento'] },
  };

  const needs = irrigationNeeds[crop.crop_type] || irrigationNeeds.papa;
  const isCriticalStage = needs.critical_stages.includes(crop.status);

  // Calculate rain probability from forecast
  let rainExpected = false;
  if (forecast && Array.isArray(forecast)) {
    rainExpected = forecast.slice(0, 2).some(d => d.rain_prob > 50);
  }

  let severity = 'info';
  let title = '💧 Plan de Riego';
  let message, actions;

  if (humidity < 50 && !rainExpected && isCriticalStage) {
    severity = 'high';
    title = '💧 RIEGO URGENTE RECOMENDADO';
    message = `Humedad baja (${humidity}%), sin lluvia esperada, y su ${crop.crop_type} está en etapa crítica (${crop.status}). Se recomienda riego inmediato.`;
    actions = [
      `Aplicar riego profundo de 25-30mm para ${crop.crop_type}`,
      'Regar en las primeras horas de la mañana (6-9 AM) para reducir evaporación',
      'Aplicar mulch después del riego para conservar humedad',
      `Programar siguiente riego en 5-7 días según evolución`
    ];
  } else if (humidity < 60 && !rainExpected) {
    severity = 'medium';
    message = `Humedad moderada (${humidity}%). Su ${crop.crop_type} puede necesitar riego suplementario.`;
    actions = [
      'Verificar humedad del suelo a 20cm de profundidad',
      'Si el suelo se siente seco, aplicar riego ligero de 15-20mm',
      'Mantener monitoreo diario de la humedad'
    ];
  } else if (rainExpected) {
    message = `Se esperan lluvias en los próximos días. No es necesario regar. Humedad actual: ${humidity}%.`;
    actions = [
      'Suspender riego programado',
      'Verificar que los canales de drenaje estén limpios',
      'Monitorear que no haya encharcamiento'
    ];
  } else {
    message = `Condiciones hídricas adecuadas. Humedad: ${humidity}%.`;
    actions = [
      'Continuar con el plan de riego regular',
      `Para ${crop.crop_type}: riego cada 7-10 días en condiciones normales`
    ];
  }

  return { category: 'riego', severity, title, message, actions };
}

function getFertilizationRecommendation(crop) {
  const daysSincePlanting = crop.planting_date
    ? Math.floor((Date.now() - new Date(crop.planting_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const fertSchedule = {
    papa: [
      { day_range: [0, 15], msg: 'Aplicar abono base: 2-3 t/ha de estiércol compostado en el surco de siembra.' },
      { day_range: [30, 45], msg: 'Primer aporque + aplicación de guano de isla (1 t/ha) o compost al pie de la planta.' },
      { day_range: [60, 75], msg: 'Segundo aporque. Si el follaje se ve pálido, aplicar biol foliar cada 15 días.' },
      { day_range: [90, 110], msg: 'No fertilizar. La planta está en tuberización. Mantener solo riego adecuado.' },
    ],
    maca: [
      { day_range: [0, 30], msg: 'No fertilizar después de la siembra. La maca prefiere suelos con abono incorporado previamente.' },
      { day_range: [60, 120], msg: 'Aplicación ligera de biol foliar si el crecimiento es lento. No exceder.' },
    ],
    quinua: [
      { day_range: [0, 15], msg: 'Aplicar 2 t/ha de compost al momento de la siembra.' },
      { day_range: [30, 50], msg: 'Aplicar biol foliar. La quinua responde bien a fertilización foliar orgánica.' },
      { day_range: [60, 90], msg: 'Última aplicación de biol antes de floración. No fertilizar durante floración.' },
    ],
  };

  if (!daysSincePlanting || daysSincePlanting < 0) {
    return {
      category: 'fertilizacion', severity: 'info',
      title: '🌿 Fertilización',
      message: `Registre la fecha de siembra de su ${crop.crop_type} para recibir recomendaciones de fertilización personalizadas.`,
      actions: ['Actualizar la fecha de siembra en el registro del cultivo']
    };
  }

  const schedule = fertSchedule[crop.crop_type] || fertSchedule.papa;
  const applicable = schedule.find(s => daysSincePlanting >= s.day_range[0] && daysSincePlanting <= s.day_range[1]);

  if (applicable) {
    return {
      category: 'fertilizacion', severity: 'medium',
      title: '🌿 Fertilización Recomendada',
      message: `Día ${daysSincePlanting} después de la siembra. ${applicable.msg}`,
      actions: [applicable.msg, 'Registrar la aplicación en el historial del cultivo para trazabilidad']
    };
  }

  return null;
}

function analyzeFutureThreats(forecast, crop) {
  const threats = [];

  forecast.forEach(day => {
    if (day.temp_min <= -1 && day.date !== 'Hoy') {
      threats.push({
        category: 'alerta_futura', severity: 'warning',
        title: `📅 Helada pronosticada para ${day.date}`,
        message: `Se espera ${day.temp_min}°C el ${day.date}. Prepare protección para su ${crop.crop_type}.`,
        actions: ['Preparar coberturas', 'Verificar sistema de riego', 'Alertar a personal de campo']
      });
    }
    if (day.rain_prob > 70 && day.date !== 'Hoy') {
      threats.push({
        category: 'alerta_futura', severity: 'info',
        title: `🌧️ Lluvia probable ${day.date}`,
        message: `${day.rain_prob}% de probabilidad de lluvia el ${day.date}. Ajuste sus actividades.`,
        actions: ['Postergar aplicación de fertilizantes', 'Limpiar canales de drenaje', 'Proteger cosechas almacenadas']
      });
    }
  });

  return threats;
}

function getCalendarRecommendation(crop) {
  const calendar = cropCalendar[crop.crop_type];
  if (!calendar) return null;

  const currentMonth = new Date().toLocaleString('es-PE', { month: 'short' });
  const monthCapitalized = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  if (calendar.siembra.includes(monthCapitalized)) {
    return {
      category: 'calendario', severity: 'info',
      title: '📅 Temporada de Siembra',
      message: `Este mes es ideal para sembrar ${crop.crop_type} en la región Pasco. Ciclo del cultivo: ${calendar.ciclo_dias} días.`,
      actions: [`Preparar terreno para siembra de ${crop.crop_type}`, 'Seleccionar semillas de calidad', 'Realizar análisis de suelo si no se ha hecho']
    };
  }

  if (calendar.cosecha.includes(monthCapitalized)) {
    return {
      category: 'calendario', severity: 'info',
      title: '📅 Temporada de Cosecha',
      message: `Este mes es época de cosecha para ${crop.crop_type}. Prepare la logística de recolección y almacenamiento.`,
      actions: ['Verificar madurez del cultivo antes de cosechar', 'Preparar almacenamiento adecuado', 'Coordinar con compradores/supermercados']
    };
  }

  return null;
}

/**
 * Evaluación de riesgo de helada
 */
async function assessFrostRisk() {
  const weather = await getCurrentWeather();
  const forecast = await getForecast();

  const temp = weather.main?.temp ?? 5;
  const tempMin = weather.main?.temp_min ?? temp - 3;
  const humidity = weather.main?.humidity ?? 70;
  const windSpeed = weather.wind?.speed ?? 3;

  // Frost risk calculation
  let riskScore = 0;
  let riskLevel = 'bajo';

  if (tempMin <= -5) riskScore += 40;
  else if (tempMin <= -2) riskScore += 30;
  else if (tempMin <= 0) riskScore += 20;
  else if (tempMin <= 3) riskScore += 10;

  if (humidity > 85) riskScore += 10;
  if (windSpeed < 2) riskScore += 15; // calm conditions increase frost risk
  if (windSpeed < 1) riskScore += 10;

  // Check forecast
  if (forecast && Array.isArray(forecast)) {
    const tomorrowMin = forecast[1]?.temp_min ?? 5;
    if (tomorrowMin <= 0) riskScore += 15;
    else if (tomorrowMin <= 3) riskScore += 5;
  }

  if (riskScore >= 50) riskLevel = 'critico';
  else if (riskScore >= 30) riskLevel = 'alto';
  else if (riskScore >= 15) riskLevel = 'medio';

  return {
    risk_score: Math.min(riskScore, 100),
    risk_level: riskLevel,
    current_temp: temp,
    temp_min: tempMin,
    humidity,
    wind_speed: windSpeed,
    factors: {
      temperature_factor: tempMin <= 3 ? 'RIESGO' : 'OK',
      humidity_factor: humidity > 85 ? 'RIESGO (condensación)' : 'OK',
      wind_factor: windSpeed < 2 ? 'RIESGO (calma favorece helada)' : 'OK'
    },
    recommendation: riskScore >= 50
      ? '⛔ Activar protocolo anti-helada INMEDIATAMENTE'
      : riskScore >= 30
        ? '⚠️ Preparar medidas de protección'
        : riskScore >= 15
          ? '🌡️ Monitorear temperatura durante la noche'
          : '✅ Riesgo bajo, condiciones favorables'
  };
}

/**
 * Plan de riego personalizado
 */
async function getIrrigationPlan(cropId) {
  const crop = await dbGet('SELECT * FROM crops WHERE id = ?', [cropId]);
  if (!crop) return { error: 'Cultivo no encontrado' };

  const weather = await getCurrentWeather();
  const forecast = await getForecast();

  const rec = getIrrigationRecommendation(
    crop,
    weather.main?.temp ?? 5,
    weather.main?.humidity ?? 70,
    forecast
  );

  // Build weekly plan
  const weeklyPlan = [];
  if (forecast && Array.isArray(forecast)) {
    forecast.forEach(day => {
      const needsIrrigation = day.rain_prob < 40 && day.humidity < 70;
      weeklyPlan.push({
        day: day.date,
        rain_probability: `${day.rain_prob}%`,
        humidity: `${day.humidity}%`,
        irrigation_needed: needsIrrigation,
        recommendation: needsIrrigation
          ? `Regar ${crop.crop_type}: 15-25mm en la mañana`
          : 'No regar (lluvia esperada o humedad suficiente)'
      });
    });
  }

  return {
    crop: { id: crop.id, name: crop.name, type: crop.crop_type, status: crop.status },
    current_recommendation: rec,
    weekly_plan: weeklyPlan,
    general_guidelines: {
      frequency: `Cada 7-10 días para ${crop.crop_type} en condiciones normales`,
      best_time: '6:00 AM - 9:00 AM (menor evaporación)',
      method: 'Riego por surcos o aspersión según disponibilidad',
      amount: `15-25mm por aplicación para ${crop.crop_type}`
    }
  };
}

module.exports = { getRecommendations, assessFrostRisk, getIrrigationPlan };
