import 'dotenv/config';
import { z } from 'zod';

/**
 * La configuracion se valida al arrancar: si falta algo el proceso falla de
 * inmediato en lugar de fallar a mitad de una peticion.
 */
const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // ── Correo (recuperacion de clave) ──
  // Sin proveedor contratado el modo por defecto imprime en el log del API,
  // de modo que la recuperacion funciona en desarrollo sin credenciales.
  CORREO_MODO: z.enum(['consola', 'ses', 'resend']).default('consola'),
  CORREO_REMITENTE: z.string().default('no-responde@vialservi.co'),
  /**
   * Solo para desarrollo y para la demostracion: devuelve el codigo en la
   * respuesta HTTP. En produccion debe quedar en false, porque si no,
   * cualquiera que sepa un documento puede pedir el codigo y leerlo.
   */
  CORREO_REVELAR_CODIGO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Minutos de vida del codigo de recuperacion. */
  CODIGO_VIGENCIA_MINUTOS: z.coerce.number().int().positive().default(15),
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Configuracion invalida en .env:\n${detalle}`);
}

export const config = resultado.data;

// Revelar el codigo solo tiene sentido con el correo en consola. Si alguien
// deja la bandera encendida con un proveedor real, se ignora y se avisa.
if (config.CORREO_REVELAR_CODIGO && config.CORREO_MODO !== 'consola') {
  console.warn(
    '[config] CORREO_REVELAR_CODIGO se ignora porque CORREO_MODO no es "consola".',
  );
  config.CORREO_REVELAR_CODIGO = false;
}
