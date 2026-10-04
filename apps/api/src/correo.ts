/**
 * Envio de correo con adaptador enchufable.
 *
 * El proyecto no tiene todavia un proveedor de correo contratado, y esperar a
 * tenerlo habria dejado la recuperacion de clave sin construir. Por eso el
 * envio esta detras de una interfaz:
 *
 *   - modo "consola": el mensaje se imprime en el log del API. La
 *     recuperacion funciona de punta a punta en desarrollo y en la
 *     demostracion, sin credenciales ni internet.
 *   - modo "ses": envia de verdad con Amazon SES, tomando las credenciales del
 *     rol de IAM de la instancia. Cambiar de uno a otro es una variable de
 *     entorno; no se toca codigo.
 *
 * Lo importante es que el CODIGO NUNCA VIAJA EN LA RESPUESTA HTTP salvo en
 * modo consola y con CORREO_REVELAR_CODIGO activado a proposito. Devolverlo
 * siempre convertiria la recuperacion en una forma de tomar cualquier cuenta
 * sabiendo solo el documento.
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { config } from './config.js';

export type Mensaje = {
  para: string;
  asunto: string;
  cuerpo: string;
};

const enviarPorConsola = ({ para, asunto, cuerpo }: Mensaje) => {
  // Se separa con lineas para que en la demostracion sea facil de ver en el
  // log mientras pasan otras peticiones.
  console.log('\n──────── CORREO (modo consola) ────────');
  console.log(`Para:   ${para}`);
  console.log(`Asunto: ${asunto}`);
  console.log(cuerpo);
  console.log('───────────────────────────────────────\n');
};

/**
 * Las credenciales NO se configuran aqui: el SDK las toma del rol de IAM de la
 * instancia en AWS y del perfil local en desarrollo.
 */
let ses: SESv2Client | null = null;
const cliente = () => (ses ??= new SESv2Client({ region: config.AWS_REGION }));

const enviarPorSes = async ({ para, asunto, cuerpo }: Mensaje) => {
  try {
    await cliente().send(
      new SendEmailCommand({
        FromEmailAddress: config.CORREO_REMITENTE,
        Destination: { ToAddresses: [para] },
        Content: {
          Simple: {
            Subject: { Data: asunto, Charset: 'UTF-8' },
            Body: { Text: { Data: cuerpo, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  } catch (error) {
    // Un fallo de SES no puede tumbar la peticion: el usuario ya tiene su
    // codigo guardado en la base y puede volver a pedirlo. Se registra para
    // poder verlo en CloudWatch.
    //
    // La causa mas comun en una cuenta nueva es el "sandbox" de SES, que solo
    // permite enviar a direcciones verificadas. Esta en el runbook.
    console.error('[correo] SES rechazo el envio:', error instanceof Error ? error.message : error);
    if (!config.esProduccion) enviarPorConsola({ para, asunto, cuerpo });
    throw new Error('No fue posible enviar el correo en este momento.');
  }
};

export const enviarCorreo = async (mensaje: Mensaje): Promise<void> => {
  if (config.CORREO_MODO === 'consola') return enviarPorConsola(mensaje);
  return enviarPorSes(mensaje);
};

/** Plantilla del codigo de recuperacion. */
export const correoRecuperacion = (nombre: string, codigo: string, minutos: number): Omit<Mensaje, 'para'> => ({
  asunto: 'Código para recuperar su contraseña · VialServi',
  cuerpo:
    `Hola ${nombre},\n\n` +
    `Su código para restablecer la contraseña es: ${codigo}\n\n` +
    `Vence en ${minutos} minutos y solo se puede usar una vez.\n` +
    `Si no solicitó este cambio, ignore este mensaje: su contraseña sigue igual.\n\n` +
    `VialServi · Central de Operaciones`,
});
