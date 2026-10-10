import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { createPrismaPgAdapter } from 'data-api-client/compat/prisma';

// Prueba del contrato REAL de Prisma 6, no solamente del adaptador aislado.
// No usa credenciales AWS ni modifica ninguna base de datos.
function clienteSimulado() {
  const comandos: string[] = [];
  const client = new RDSDataClient({ region: 'us-east-1' });
  client.send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const nombre = command.constructor.name;
    comandos.push(nombre);
    if (nombre === 'BeginTransactionCommand') return { transactionId: 'transaccion-prueba' };
    if (nombre === 'CommitTransactionCommand' || nombre === 'RollbackTransactionCommand') return {};
    return {
      columnMetadata: [{ name: 'valor', typeName: 'int8', type: -5 }],
      records: [[{ longValue: 42 }]],
      numberOfRecordsUpdated: 0,
    };
  }) as typeof client.send;
  const prisma = new PrismaClient({ adapter: createPrismaPgAdapter({
    resourceArn: 'arn:aws:rds:us-east-1:000000000000:cluster:prueba',
    secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:prueba',
    database: 'prueba', client,
  }) });
  return { prisma, comandos };
}

describe('Prisma 6 sobre Aurora Data API', () => {
  it('conserva bigint en consultas crudas', async () => {
    const { prisma } = clienteSimulado();
    try {
      expect(await prisma.$queryRaw`SELECT 42::bigint AS valor`).toEqual([{ valor: 42n }]);
    } finally { await prisma.$disconnect(); }
  });
  it('confirma transacciones sin dejar conexiones abiertas', async () => {
    const { prisma, comandos } = clienteSimulado();
    try {
      await prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT 42::bigint AS valor`; });
      expect(comandos).toContain('BeginTransactionCommand');
      expect(comandos).toContain('CommitTransactionCommand');
    } finally { await prisma.$disconnect(); }
  });
  it('revierte una transaccion si falla la operacion', async () => {
    const { prisma, comandos } = clienteSimulado();
    try {
      await expect(prisma.$transaction(async () => { throw new Error('fallo esperado'); })).rejects.toThrow('fallo esperado');
      expect(comandos).toContain('RollbackTransactionCommand');
    } finally { await prisma.$disconnect(); }
  });
});
