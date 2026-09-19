import { Router } from 'express';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

export const rutasReportes = Router();
rutasReportes.use(autenticar, exigirRol('ADMINISTRADOR', 'CENTRAL'));

rutasReportes.get('/indicadores', async (_req, res) => {
  const [porEstado, porTipo, expedientes, cerrados, evidencias, novedades] = await Promise.all([
    prisma.servicio.groupBy({ by: ['estado'], _count: true }),
    prisma.servicio.groupBy({ by: ['tipo'], _count: true }),
    prisma.expediente.count(),
    prisma.expediente.count({ where: { cerradoEn: { not: null } } }),
    prisma.evidencia.count(),
    prisma.novedad.count(),
  ]);

  res.json({
    porEstado: porEstado.map((e) => ({ estado: e.estado, total: e._count })),
    porTipo: porTipo.filter((t) => t.tipo).map((t) => ({ tipo: t.tipo, total: t._count })),
    expedientes,
    cerrados,
    abiertos: expedientes - cerrados,
    evidencias,
    novedades,
  });
});

// Historial por placa: es la consulta que resuelve una reclamacion meses despues.
rutasReportes.get('/historial', async (req, res) => {
  const placa = String(req.query.placa ?? '').toUpperCase();
  if (!placa) return res.json([]);

  const servicios = await prisma.servicio.findMany({
    where: { vehiculo: { placa: { contains: placa } } },
    orderBy: { solicitadoEn: 'desc' },
    include: {
      vehiculo: true,
      cliente: { select: { nombre: true } },
      tecnico: { select: { nombre: true } },
      expediente: { include: { _count: { select: { evidencias: true, novedades: true } } } },
    },
  });
  res.json(servicios);
});
