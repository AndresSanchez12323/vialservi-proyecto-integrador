// Solo sobre la COPIA previa al corte. Las escrituras se revierten; no seed.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createPrismaPgAdapter } from 'data-api-client/compat/prisma';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { fromIni } from '@aws-sdk/credential-provider-ini';

assert.equal(process.env.AURORA_CLUSTER_ARN, 'arn:aws:rds:us-east-1:102098709715:cluster:vialservi-aurora');
assert.ok(process.env.AURORA_SECRET_ARN?.startsWith('arn:aws:secretsmanager:us-east-1:102098709715:secret:'));
const client = new RDSDataClient({ region: 'us-east-1', credentials: fromIni({ profile: 'personal' }), maxAttempts: 1 });
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter({ resourceArn: process.env.AURORA_CLUSTER_ARN,
    secretArn: process.env.AURORA_SECRET_ARN, database: 'vialservi', client,
    retryOptions: { enabled: false },
  }), transactionOptions: { timeout: 25000 },
});
try {
  const usuarios = await prisma.usuario.findMany({ orderBy: { id: 'asc' }, take: 1 });
  assert.ok(usuarios.length);
  assert.ok(usuarios[0].creadoEn instanceof Date);
  await prisma.servicio.findMany({ take: 3, include: { cliente: true, vehiculo: true, tecnico: true, expediente: true } });
  await prisma.tecnico.findMany({ include: { _count: { select: { servicios: true } } } });
  await prisma.servicio.groupBy({ by: ['estado'], _count: { id: true } });
  const filasAntes = await prisma.usuario.count();
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.usuario.create({ data: {
      id: -999999999, documento: 'prueba-migracion-rollback', nombre: 'Prueba temporal',
      correo: 'no-enviar@example.invalid', clave: 'no-autenticar', rol: 'CLIENTE',
    } });
    throw new Error('REVERTIR_PRUEBA');
  }), /REVERTIR_PRUEBA/);
  assert.equal(await prisma.usuario.count(), filasAntes);
  assert.equal(await prisma.usuario.findUnique({ where: { id: -999999999 } }), null);
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.usuario.create({ data: {
      id: -999999998, documento: usuarios[0].documento, nombre: 'Prueba duplicado',
      correo: 'no-enviar@example.invalid', clave: 'no-autenticar', rol: 'CLIENTE',
    } });
  }), (error) => error.code === 'P2002');
  await prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1`; });
  console.log('DATA_API_VERIFICADA: fechas, relaciones, agrupacion, conteos, commit, rollback y P2002. Sin imprimir datos personales.');
} finally { await prisma.$disconnect(); }
