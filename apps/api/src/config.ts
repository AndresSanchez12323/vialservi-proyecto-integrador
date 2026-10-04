import 'dotenv/config';
import { z } from 'zod';

/**
 * La configuracion se valida al arrancar: si falta algo el proceso falla de
 * inmediato en lugar de fallar a mitad de una peticion. En AWS eso importa mas
 * que en local: una tarea que arranca mal debe morir rapido para que el
 * despliegue se marque como fallido, en vez de quedar sirviendo errores.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  // En AWS el puerto lo fija la plataforma; API_PORT se conserva para no
  // romper el flujo local que ya usaba el equipo.
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  /**
   * Lista separada por comas: en produccion el SPA va detras de CloudFront y
   * comparte origen con el API, pero en desarrollo son dos puertos distintos.
   * "*" desactiva la comprobacion y solo deberia usarse para depurar.
   */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // ── AWS ──
  AWS_REGION: z.string().default('us-east-1'),

  /**
   * Almacenamiento de las evidencias.
   *   "local": no sube nada, solo registra la referencia. Es lo que habia
   *            hasta ahora y permite trabajar sin cuenta de AWS.
   *   "s3":   el navegador sube el archivo directo a S3 con una URL
   *           prefirmada. Un video de 15 MB no pasa por el API.
   */
  ALMACENAMIENTO_MODO: z.enum(['local', 's3']).default('local'),
  S3_BUCKET_EVIDENCIAS: z.string().optional(),
  /** Minutos de vida de las URL prefirmadas. Cortas a proposito. */
  S3_URL_MINUTOS: z.coerce.number().int().positive().max(60).default(15),

  // ── Correo (recuperacion de clave) ──
  // "consola" imprime en el log y funciona sin credenciales; "ses" envia de
  // verdad con Amazon SES.
  CORREO_MODO: z.enum(['consola', 'ses']).default('consola'),
  CORREO_REMITENTE: z.string().default('no-responde@vialservi.co'),
  /**
   * Solo para desarrollo: devuelve el codigo en la respuesta HTTP. En
   * produccion debe quedar en false, porque si no cualquiera que sepa un
   * documento puede pedir el codigo y leerlo.
   */
  CORREO_REVELAR_CODIGO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CODIGO_VIGENCIA_MINUTOS: z.coerce.number().int().positive().default(15),
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Configuracion invalida en .env:\n${detalle}`);
}

export const config = {
  ...resultado.data,
  /** El puerto efectivo: la plataforma manda sobre el valor local. */
  puerto: resultado.data.PORT ?? resultado.data.API_PORT,
  esProduccion: resultado.data.NODE_ENV === 'production',
  /** Origenes permitidos, ya separados. */
  origenes: resultado.data.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
};

// ── Comprobaciones que dependen de varias variables a la vez ──────────────
// Zod valida campo por campo; estas combinaciones no se pueden expresar ahi
// sin volver el esquema ilegible.

if (config.ALMACENAMIENTO_MODO === 's3' && !config.S3_BUCKET_EVIDENCIAS) {
  throw new Error(
    'ALMACENAMIENTO_MODO=s3 exige S3_BUCKET_EVIDENCIAS con el nombre del bucket.',
  );
}

// Revelar el codigo solo tiene sentido con el correo en consola. Si alguien
// deja la bandera encendida con un proveedor real, se ignora y se avisa.
if (config.CORREO_REVELAR_CODIGO && config.CORREO_MODO !== 'consola') {
  console.warn('[config] CORREO_REVELAR_CODIGO se ignora porque CORREO_MODO no es "consola".');
  config.CORREO_REVELAR_CODIGO = false;
}

// En produccion estas dos cosas son fallas de seguridad, no descuidos: mejor
// no arrancar que quedar en linea con la clave de ejemplo o filtrando codigos.
if (config.esProduccion) {
  if (config.CORREO_REVELAR_CODIGO) {
    throw new Error('CORREO_REVELAR_CODIGO no puede estar en true con NODE_ENV=production.');
  }
  if (config.JWT_SECRET.includes('cambiar-en-produccion')) {
    throw new Error('JWT_SECRET sigue siendo el de ejemplo. Genere uno y guardelo en SSM.');
  }
  if (config.origenes.includes('*')) {
    console.warn('[config] CORS_ORIGIN="*" en produccion: cualquier sitio puede llamar al API.');
  }

  // El fallo mas desconcertante que puede tener este sistema: en produccion con
  // el correo en modo consola, pedir la recuperacion responde "enviamos un
  // codigo", el codigo queda en el log, y al usuario no le llega nada. No se
  // puede avisar en la respuesta HTTP —eso revelaria si la cuenta existe— ni
  // se puede impedir el arranque, porque dejaria el aplicativo caido por algo
  // que no es critico. Asi que se grita en el log, que es el unico lugar donde
  // el equipo puede verlo.
  if (config.CORREO_MODO === 'consola') {
    console.warn(
      '\n' +
        '┌──────────────────────────────────────────────────────────────────┐\n' +
        '│ AVISO: la recuperacion de contrasena NO ENVIARA CORREOS.         │\n' +
        '│ CORREO_MODO=consola en produccion: el codigo solo se imprime     │\n' +
        '│ aqui, en el log. El usuario no recibira nada.                    │\n' +
        '│ Para enviar de verdad: verifique un remitente en SES y vuelva a  │\n' +
        '│ desplegar con CorreoRemitente. Ver docs/despliegue-aws.md §5.    │\n' +
        '└──────────────────────────────────────────────────────────────────┘\n',
    );
  }
}
