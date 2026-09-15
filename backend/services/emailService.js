/**
 * AgroPasco — Servicio de Email
 * Envío de correos SMTP con Nodemailer.
 * Fallback a console.log cuando SMTP no está configurado (desarrollo).
 */

const nodemailer = require('nodemailer');

// Verificar si SMTP está configurado
function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Crear transporter (solo si hay configuración SMTP)
function getTransporter() {
  if (!isSmtpConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: (parseInt(process.env.SMTP_PORT) || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

/**
 * Enviar un correo. Si SMTP no está configurado, imprime en consola.
 */
async function sendMail(to, subject, html) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('\n📧 ═══════════════════════════════════════════════════');
    console.log(`📧  EMAIL (modo desarrollo — SMTP no configurado)`);
    console.log(`📧  Para: ${to}`);
    console.log(`📧  Asunto: ${subject}`);
    console.log(`📧  Contenido HTML omitido (ver logs completos en producción)`);
    console.log('📧 ═══════════════════════════════════════════════════\n');
    return { success: true, mode: 'console' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || '"AgroPasco Digital" <notificaciones@agropasco.pe>',
      to,
      subject,
      html
    });
    console.log(`📧 Email enviado a ${to}: ${info.messageId}`);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error(`📧 Error al enviar email a ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Email de aprobación de cuenta — enviado al usuario cuando el Admin aprueba su solicitud
 */
async function sendApprovalEmail(user, tempPassword, loginUrl = '') {
  const subject = '✅ Tu cuenta ha sido aprobada — AgroPasco Digital';
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 32px; text-align: center;">
        <div style="font-size: 48px;">🌾</div>
        <h1 style="color: #ffffff; margin: 12px 0 4px; font-size: 24px;">AgroPasco Digital</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 0; font-size: 14px;">Plataforma Agrícola Inteligente — Región Pasco</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #22c55e; font-size: 20px; margin-bottom: 16px;">¡Bienvenido, ${user.name}! 🎉</h2>
        <p style="color: #cbd5e1; line-height: 1.6;">
          Su cuenta ha sido <strong style="color: #4ade80;">aprobada por el Administrador</strong>. 
          Bienvenido a AgroPasco Digital.
        </p>
        <div style="background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Credenciales de Acceso</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Correo:</strong> ${user.email}</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Contraseña temporal:</strong> <code style="background: rgba(34,197,94,0.2); padding: 2px 8px; border-radius: 4px; color: #4ade80;">${tempPassword}</code></p>
          <p style="margin: 12px 0 0; color: #f59e0b; font-size: 13px;">⚠️ Al iniciar sesión por primera vez, deberá cambiar su contraseña.</p>
        </div>
        ${loginUrl ? `<div style="text-align: center; margin: 24px 0;">
          <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">🔐 Iniciar Sesión</a>
        </div>` : ''}
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
          Este es un correo automático de AgroPasco Digital. No responda a este mensaje.
        </p>
      </div>
    </div>
  `;

  return sendMail(user.email, subject, html);
}

/**
 * Email de rechazo de cuenta — enviado al usuario cuando el Admin rechaza su solicitud
 */
async function sendRejectionEmail(user, reason) {
  const subject = '❌ Solicitud de cuenta rechazada — AgroPasco Digital';
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 32px; text-align: center;">
        <div style="font-size: 48px;">🌾</div>
        <h1 style="color: #ffffff; margin: 12px 0 4px; font-size: 24px;">AgroPasco Digital</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 0; font-size: 14px;">Plataforma Agrícola Inteligente — Región Pasco</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #ef4444; font-size: 20px; margin-bottom: 16px;">Solicitud No Aprobada</h2>
        <p style="color: #cbd5e1; line-height: 1.6;">
          Estimado/a <strong>${user.name}</strong>, lamentamos informarle que su solicitud de cuenta 
          como <strong>${user.role === 'advisor' ? 'Asesor Técnico' : 'Supermercado'}</strong> 
          ha sido rechazada por el Administrador del sistema.
        </p>
        ${reason ? `<div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Motivo</p>
          <p style="margin: 0; color: #fca5a5;">${reason}</p>
        </div>` : ''}
        <p style="color: #cbd5e1; line-height: 1.6;">
          Si cree que esto es un error, puede contactar al equipo de soporte de AgroPasco 
          para más información.
        </p>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
          Este es un correo automático de AgroPasco Digital. No responda a este mensaje.
        </p>
      </div>
    </div>
  `;

  return sendMail(user.email, subject, html);
}

/**
 * Email al Admin cuando llega una nueva solicitud de cuenta
 */
async function sendNewAccountRequestEmail(adminEmail, applicant) {
  const roleLabel = applicant.role === 'advisor' ? 'Asesor Técnico' : 'Supermercado';
  const subject = `📬 Nueva solicitud de cuenta: ${roleLabel} — AgroPasco Digital`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); padding: 32px; text-align: center;">
        <div style="font-size: 48px;">📬</div>
        <h1 style="color: #ffffff; margin: 12px 0 4px; font-size: 24px;">Nueva Solicitud de Cuenta</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 0; font-size: 14px;">AgroPasco Digital — Panel de Administración</p>
      </div>
      <div style="padding: 32px;">
        <p style="color: #cbd5e1; line-height: 1.6;">
          Se ha recibido una nueva solicitud de registro que requiere su aprobación:
        </p>
        <div style="background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Nombre:</strong> ${applicant.name}</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Email:</strong> ${applicant.email}</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Rol solicitado:</strong> ${roleLabel}</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Ubicación:</strong> ${applicant.location || 'No especificada'}</p>
          <p style="margin: 4px 0; color: #e2e8f0;"><strong>Teléfono:</strong> ${applicant.phone || 'No proporcionado'}</p>
        </div>
        <p style="color: #cbd5e1; line-height: 1.6;">
          Ingrese al <strong>Panel de Administración</strong> → <strong>Solicitudes de Cuenta</strong> 
          para aprobar o rechazar esta solicitud.
        </p>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
          Este es un correo automático de AgroPasco Digital.
        </p>
      </div>
    </div>
  `;

  return sendMail(adminEmail, subject, html);
}

module.exports = {
  sendMail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendNewAccountRequestEmail,
  isSmtpConfigured
};
