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

// Historial por placa y/o categoría: es la consulta que resuelve una
// reclamación meses después, y la que alimenta el gráfico de la central.
rutasReportes.get('/historial', async (req, res) => {
  const placa = String(req.query.placa ?? '').toUpperCase();
  const tipo = String(req.query.tipo ?? '');
  const porTipo = ['GRUA', 'CARRO_TALLER', 'CONDUCTOR_ELEGIDO'] as const;

  const servicios = await prisma.servicio.findMany({
    where: {
      // insensitive: en PostgreSQL `contains` distingue mayusculas (ver vehiculos.ts)
      ...(placa ? { vehiculo: { placa: { contains: placa, mode: 'insensitive' as const } } } : {}),
      ...(porTipo.includes(tipo as (typeof porTipo)[number]) ? { tipo: tipo as (typeof porTipo)[number] } : {}),
    },
    orderBy: { solicitadoEn: 'desc' },
    include: {
      vehiculo: true,
      cliente: { select: { nombre: true, documento: true, telefono: true } },
      tecnico: { select: { nombre: true, especialidades: true } },
      expediente: { include: { _count: { select: { evidencias: true, novedades: true } } } },
    },
  });
  res.json(servicios);
});
