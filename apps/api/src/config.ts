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
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Configuracion invalida en .env:\n${detalle}`);
}

export const config = resultado.data;
