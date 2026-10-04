/**
 * Envio de correo con adaptador enchufable.
 *
 * El proyecto no tiene todavia un proveedor de correo contratado, y esperar a
 * tenerlo habria dejado la recuperacion de clave sin construir. Por eso el
 * envio esta detras de una interfaz:
 *
 *   - modo "consola" (el de hoy): el mensaje se imprime en el log del API.
 *     La recuperacion funciona de punta a punta en desarrollo y en la
 *     demostracion, sin credenciales ni internet.
 *   - modo "ses" / "resend": se implementa en `enviarPorProveedor` cuando
 *     existan las credenciales. Nada mas del sistema cambia.
 *
 * Lo importante es que el CODIGO NUNCA VIAJA EN LA RESPUESTA HTTP salvo en
 * modo consola y con CORREO_REVELAR_CODIGO activado a proposito. Devolverlo
 * siempre convertiria la recuperacion en una forma de tomar cualquier cuenta
 * sabiendo solo el documento.
 */
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

const enviarPorProveedor = async (mensaje: Mensaje) => {
  // Punto de extension. Con AWS SES serian unas pocas lineas con
  // @aws-sdk/client-ses usando SES_REGION y las credenciales del entorno.
  // Mientras no este implementado se avisa y se cae a consola, para que una
  // configuracion incompleta no deje al usuario sin poder recuperar su clave.
  console.warn(
    `[correo] CORREO_MODO=${config.CORREO_MODO} no esta implementado todavia; se imprime en consola.`,
  );
  enviarPorConsola(mensaje);
};

export const enviarCorreo = async (mensaje: Mensaje): Promise<void> => {
  if (config.CORREO_MODO === 'consola') return enviarPorConsola(mensaje);
  return enviarPorProveedor(mensaje);
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
