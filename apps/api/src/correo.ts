/**
 * Envio de correo, con tres transportes detras de una sola interfaz.
 *
 *   "consola": imprime en el log del API. Funciona sin credenciales y sin
 *              internet: es lo que permite desarrollar y hacer la
 *              demostracion sin cuenta de AWS.
 *   "ses":     Amazon SES, tomando las credenciales del rol de IAM de la
 *              tarea. Es el destino natural estando ya en AWS, pero una cuenta
 *              nueva arranca en el "sandbox" y solo envia a direcciones
 *              verificadas hasta que AWS aprueba el acceso a produccion.
 *   "smtp":    cualquier proveedor por SMTP (Gmail, Brevo, SendGrid,
 *              Mailgun...). Envia a CUALQUIER destinatario de inmediato,
 *              verificando solo el remitente. Es la salida cuando no se puede
 *              esperar la aprobacion de SES.
 *
 * Cambiar de uno a otro es una variable de entorno. No se toca codigo, y por
 * eso vale la pena que el contenido del mensaje viva aparte, en plantillas.ts.
 *
 * El CODIGO NUNCA VIAJA EN LA RESPUESTA HTTP salvo en modo consola y con
 * CORREO_REVELAR_CODIGO activado a proposito. Devolverlo siempre convertiria la
 * recuperacion en una forma de tomar cualquier cuenta sabiendo solo el
 * documento.
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

export type Mensaje = {
  para: string;
  asunto: string;
  texto: string;
  /** Version HTML. Opcional: si falta, se manda solo el texto. */
  html?: string;
};

const enviarPorConsola = ({ para, asunto, texto }: Mensaje) => {
  // Se imprime la version de TEXTO y no el HTML: en un log, el HTML es ruido
  // ilegible y lo que hace falta leer es el codigo.
  console.log('\n──────── CORREO (modo consola) ────────');
  console.log(`Para:   ${para}`);
  console.log(`Asunto: ${asunto}`);
  console.log(texto);
  console.log('───────────────────────────────────────\n');
};

// ── Amazon SES ───────────────────────────────────────────────────────────
// Las credenciales NO se configuran aqui: el SDK las toma del rol de IAM de la
// tarea en AWS y del perfil local en desarrollo.
let ses: SESv2Client | null = null;
const clienteSes = () => (ses ??= new SESv2Client({ region: config.AWS_REGION }));

const enviarPorSes = async ({ para, asunto, texto, html }: Mensaje) => {
  await clienteSes().send(
    new SendEmailCommand({
      FromEmailAddress: config.CORREO_REMITENTE,
      Destination: { ToAddresses: [para] },
      Content: {
        Simple: {
          Subject: { Data: asunto, Charset: 'UTF-8' },
          Body: {
            Text: { Data: texto, Charset: 'UTF-8' },
            ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
          },
        },
      },
    }),
  );
};

// ── SMTP ─────────────────────────────────────────────────────────────────
/**
 * El transporte se crea una sola vez y se reutiliza: con `pool` nodemailer
 * mantiene la conexion abierta, en lugar de negociar TLS en cada correo.
 */
let smtp: Transporter | null = null;
const clienteSmtp = () =>
  (smtp ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PUERTO,
    // true para el puerto 465 (TLS desde el saludo), false para el 587, que
    // empieza en claro y sube a TLS con STARTTLS. Mezclarlos es el error mas
    // comun al configurar esto y da un tiempo de espera agotado sin explicacion.
    secure: config.SMTP_SEGURO,
    auth: { user: config.SMTP_USUARIO, pass: config.SMTP_CLAVE },
    pool: true,
    maxConnections: 2,
  }));

const enviarPorSmtp = async ({ para, asunto, texto, html }: Mensaje) => {
  await clienteSmtp().sendMail({
    // El nombre visible hace que en la bandeja se lea "VialServi" y no una
    // direccion cruda, que es lo que mas se parece a un correo de phishing.
    from: `"VialServi" <${config.CORREO_REMITENTE}>`,
    to: para,
    subject: asunto,
    text: texto,
    ...(html ? { html } : {}),
  });
};

export const enviarCorreo = async (mensaje: Mensaje): Promise<void> => {
  try {
    if (config.CORREO_MODO === 'consola') return enviarPorConsola(mensaje);
    if (config.CORREO_MODO === 'smtp') return await enviarPorSmtp(mensaje);
    return await enviarPorSes(mensaje);
  } catch (error) {
    /**
     * Un fallo del proveedor no puede tumbar la peticion: el codigo ya quedo
     * guardado en la base y el usuario puede volver a pedirlo. Se registra el
     * motivo, que es lo unico que permite diagnosticarlo despues.
     *
     * Causas mas frecuentes, por si aparecen en CloudWatch:
     *   SES  · "Email address is not verified" -> la cuenta sigue en sandbox y
     *          el destinatario no esta verificado.
     *   SMTP · "Invalid login" con Gmail -> se puso la contrasena de la cuenta
     *          en vez de una contrasena de aplicacion.
     *   SMTP · tiempo de espera agotado -> el puerto y SMTP_SEGURO no concuerdan.
     */
    console.error(
      `[correo] el envio por ${config.CORREO_MODO} fallo:`,
      error instanceof Error ? error.message : error,
    );
    // En desarrollo se cae a la consola para no quedarse sin el codigo por un
    // problema de configuracion del proveedor.
    if (!config.esProduccion) enviarPorConsola(mensaje);
    throw new Error('No fue posible enviar el correo en este momento.');
  }
};

// Se reexporta para no cambiar los sitios que ya la importaban de aqui.
export { correoRecuperacion } from './plantillas.js';
