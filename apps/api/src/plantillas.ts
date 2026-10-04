/**
 * Plantillas de los correos.
 *
 * Van aparte del transporte (correo.ts) porque son dos cosas distintas: esto es
 * el CONTENIDO, y sirve igual se mande por SES, por SMTP o se imprima en la
 * consola. Cambiar de proveedor no deberia obligar a reescribir el mensaje.
 *
 * ── Por que el HTML se ve "anticuado" ───────────────────────────────────
 * Los clientes de correo no son navegadores. Gmail, Outlook y Apple Mail
 * soportan un subconjunto pobre de CSS y cada uno distinto:
 *
 *   - Se maqueta con TABLAS, no con flexbox ni grid: Outlook usa el motor de
 *     Word para renderizar y no entiende layout moderno.
 *   - Los estilos van EN LINEA: Gmail descarta buena parte de lo que este en
 *     una hoja de estilos o en <style>.
 *   - Ancho maximo 600 px, que es lo que caben los paneles de lectura.
 *   - Sin imagenes de fondo y con fuentes del sistema: una fuente web que no
 *     carga deja el texto en Times New Roman.
 *
 * ── Por que el logo es tipografico y no una imagen ──────────────────────
 * La mayoria de los clientes BLOQUEAN las imagenes hasta que el usuario las
 * autoriza, y las imagenes incrustadas en base64 (data:) Gmail las descarta
 * directamente. Un logo que no carga deja un recuadro roto en lo primero que
 * se ve. Asi que la marca se dibuja con texto y color, que siempre se ve.
 *
 * Si mas adelante quieren una imagen de verdad, se pone CORREO_LOGO_URL
 * apuntando a un archivo publico (por ejemplo el del SPA en CloudFront) y
 * aparece arriba, con el texto como alternativa si no carga.
 */
import { config } from './config.js';

/**
 * Escapa el texto que se inserta en el HTML.
 *
 * NO es opcional: el nombre lo escribe el propio usuario al registrarse. Quien
 * se registre como `<b>Juan` desmaquetaria el correo, y una cadena con
 * `<a href=...>` convertiria nuestro mensaje en un vehiculo de phishing con
 * nuestro remitente. El codigo tambien se escapa por disciplina, aunque solo
 * contenga digitos.
 */
export const escapar = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Los colores de la aplicacion, para que el correo no parezca de otro sistema.
const FONDO = '#0b1220';
const AMBAR = '#fbbf24';
const TEXTO = '#1f2937';
const SUAVE = '#6b7280';
const BORDE = '#e5e7eb';

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Cabecera con la marca: imagen si hay URL configurada, texto si no. */
const cabecera = (): string => {
  const marca = config.CORREO_LOGO_URL
    ? `<img src="${escapar(config.CORREO_LOGO_URL)}" alt="VialServi" width="160" style="display:block;border:0;outline:none;text-decoration:none;max-width:160px;height:auto;">`
    : `<div style="font-family:${FUENTE};font-size:28px;font-weight:700;letter-spacing:-0.5px;color:${AMBAR};">VialServi</div>`;

  return `
  <tr>
    <td style="background-color:${FONDO};padding:28px 32px;text-align:left;">
      ${marca}
      <div style="font-family:${FUENTE};font-size:13px;color:#cbd5e1;padding-top:6px;">
        Gestión de expedientes de servicios viales
      </div>
    </td>
  </tr>`;
};

const pie = (): string => `
  <tr>
    <td style="padding:24px 32px;border-top:1px solid ${BORDE};">
      <div style="font-family:${FUENTE};font-size:12px;color:${SUAVE};line-height:18px;">
        Este es un mensaje automático de VialServi; no responda a este correo.<br>
        Proyecto Integrador · Politécnico Colombiano Jaime Isaza Cadavid
      </div>
    </td>
  </tr>`;

/**
 * Envoltura del mensaje. La tabla exterior centra el contenido y pinta el
 * fondo: muchos clientes ignoran los margenes del <body>.
 */
const envoltura = (contenido: string, encabezado: string): string => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(encabezado)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  <!-- Texto de vista previa: es lo que la bandeja muestra junto al asunto.
       Va oculto para que no se repita dentro del mensaje. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(encabezado)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          ${cabecera()}
          ${contenido}
          ${pie()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export type Plantilla = { asunto: string; texto: string; html: string };

/**
 * Correo del codigo de recuperacion.
 *
 * Se devuelven las DOS versiones. El texto plano no es un adorno: hay clientes
 * configurados para no mostrar HTML, y un correo que solo trae HTML cae mas
 * facil en spam porque los filtros lo leen como sospechoso.
 */
export const correoRecuperacion = (
  nombre: string,
  codigo: string,
  minutos: number,
): Plantilla => {
  const asunto = `Su código para restablecer la contraseña: ${codigo}`;

  const texto =
    `Hola ${nombre},\n\n` +
    `Su código para restablecer la contraseña de VialServi es:\n\n` +
    `    ${codigo}\n\n` +
    `Vence en ${minutos} minutos y solo se puede usar una vez.\n\n` +
    `Si no solicitó este cambio, ignore este mensaje: su contraseña sigue igual.\n` +
    `Nadie de VialServi le va a pedir este código por teléfono ni por WhatsApp.\n\n` +
    `— VialServi · Central de Operaciones`;

  const html = envoltura(
    `
  <tr>
    <td style="padding:32px 32px 8px 32px;">
      <div style="font-family:${FUENTE};font-size:16px;color:${TEXTO};line-height:24px;">
        Hola <strong>${escapar(nombre)}</strong>,
      </div>
      <div style="font-family:${FUENTE};font-size:16px;color:${TEXTO};line-height:24px;padding-top:12px;">
        Recibimos una solicitud para restablecer la contraseña de su cuenta.
        Use este código:
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:20px 32px;">
      <!-- El codigo en una tabla propia: asi el bloque conserva el fondo y el
           borde en Outlook, que descarta el padding de un <div>. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="background-color:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:22px 16px;">
            <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:#92400e;line-height:44px;">
              ${escapar(codigo)}
            </div>
            <div style="font-family:${FUENTE};font-size:13px;color:#b45309;padding-top:8px;">
              Vence en ${minutos} minutos · un solo uso
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 32px 32px 32px;">
      <div style="font-family:${FUENTE};font-size:14px;color:${SUAVE};line-height:22px;">
        Si no solicitó este cambio, ignore este mensaje: su contraseña sigue igual.
      </div>
      <div style="font-family:${FUENTE};font-size:14px;color:${TEXTO};line-height:22px;padding-top:12px;">
        <strong>Nadie de VialServi le va a pedir este código</strong> por teléfono
        ni por WhatsApp. Si alguien se lo pide, no lo entregue.
      </div>
    </td>
  </tr>`,
    `Su código es ${codigo}. Vence en ${minutos} minutos.`,
  );

  return { asunto, texto, html };
};
