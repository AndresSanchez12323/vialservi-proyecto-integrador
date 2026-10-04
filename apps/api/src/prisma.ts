// dotenv se carga aqui y no solo en config.ts porque prisma.ts es el punto de
// entrada de procesos que no pasan por el servidor —el seed y los scripts de
// migracion—, y sin DATABASE_URL el cliente de Prisma falla al construirse.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * En produccion conviene ver los errores en el log de CloudWatch, pero no
 * cada consulta: el ruido oculta lo que importa y las consultas pueden llevar
 * datos personales.
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error'],
});
