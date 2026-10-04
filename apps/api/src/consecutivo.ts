/**
 * Numero de expediente.
 *
 * Lo entrega una SECUENCIA de PostgreSQL y no un COUNT(*) + 1. La diferencia
 * importa al salir a AWS: alli el API corre en mas de una instancia, y dos
 * expedientes creados en el mismo segundo leerian el mismo total, pedirian el
 * mismo numero y uno fallaria por el indice unico. Una secuencia nunca entrega
 * el mismo valor dos veces, ni siquiera a transacciones concurrentes.
 *
 * La secuencia no se devuelve al hacer ROLLBACK, asi que la numeracion puede
 * tener huecos. Es a proposito: un hueco en el consecutivo es inofensivo, dos
 * expedientes con el mismo numero no.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/** Cliente de Prisma o el de una transaccion en curso. */
type Ejecutor = Pick<Prisma.TransactionClient, '$queryRaw'> | typeof prisma;

/**
 * Siguiente consecutivo, con el ano en curso como prefijo.
 * La secuencia es global y no se reinicia cada ano: asi el numero identifica al
 * expediente sin ambiguedad aunque se consulte el historico de varios anos.
 */
export const siguienteConsecutivo = async (tx: Ejecutor = prisma): Promise<string> => {
  const filas = await tx.$queryRaw<{ valor: bigint }[]>`
    SELECT nextval('expediente_consecutivo_seq') AS valor
  `;
  const valor = Number(filas[0].valor);
  return `EXP-${new Date().getFullYear()}-${String(valor).padStart(4, '0')}`;
};

/**
 * Deja la secuencia por encima de los expedientes que ya existen. La usa el
 * seed, que inserta consecutivos fijos para que la demostracion sea legible:
 * sin esto, el primer expediente que creara el aplicativo repetiria un numero.
 */
export const sincronizarSecuencia = async (): Promise<void> => {
  await prisma.$executeRaw`
    SELECT setval(
      'expediente_consecutivo_seq',
      GREATEST((SELECT COUNT(*) FROM "Expediente"), 1),
      (SELECT COUNT(*) > 0 FROM "Expediente")
    )
  `;
};
