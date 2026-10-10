// dotenv se carga aqui y no solo en config.ts porque prisma.ts es el punto de
// entrada de procesos que no pasan por el servidor —el seed y los scripts de
// migracion—, y sin DATABASE_URL el cliente de Prisma falla al construirse.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaPgAdapter } from 'data-api-client/compat/prisma';
import { RDSDataClient } from '@aws-sdk/client-rds-data';

// Data API no mantiene conexiones TCP abiertas: Aurora puede pausar a 0 ACU.
// El desarrollo y los procesos de migracion conservan PostgreSQL directo.
const dataApi = process.env.BASE_MODO === 'data-api';
if (dataApi && (!process.env.AURORA_CLUSTER_ARN || !process.env.AURORA_SECRET_ARN || !process.env.AURORA_DATABASE)) {
  throw new Error('BASE_MODO=data-api exige AURORA_CLUSTER_ARN, AURORA_SECRET_ARN y AURORA_DATABASE.');
}
const clienteDataApi = new RDSDataClient({ region: process.env.AWS_REGION ?? 'us-east-1', maxAttempts: 1 });
// Reintentar SOLO el despertar, cuando AWS aun no ejecuto la consulta.
// Un timeout de escritura no garantiza que no se haya guardado: repetirlo
// podria duplicar filas. Los reintentos genericos del wrapper se desactivan.
clienteDataApi.middlewareStack.add((next) => async (args) => {
  for (let intento = 0; ; intento++) {
    try { return await next(args); }
    catch (error) {
      if (!(error instanceof Error) || error.name !== 'DatabaseResumingException' || intento >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, [2000, 5000, 10000][intento]));
    }
  }
}, { name: 'reanudarAurora', step: 'initialize' });
const adapter = dataApi ? createPrismaPgAdapter({
  resourceArn: process.env.AURORA_CLUSTER_ARN!,
  secretArn: process.env.AURORA_SECRET_ARN!,
  database: process.env.AURORA_DATABASE!,
  region: process.env.AWS_REGION ?? 'us-east-1',
  client: clienteDataApi,
  retryOptions: { enabled: false },
}) : undefined;

/**
 * En produccion conviene ver los errores en el log de CloudWatch, pero no
 * cada consulta: el ruido oculta lo que importa y las consultas pueden llevar
 * datos personales.
 */
export const prisma = new PrismaClient({
  ...(adapter ? { adapter } : {}),
  ...(dataApi ? { transactionOptions: { maxWait: 20000, timeout: 25000 } } : {}),
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error'],
});
