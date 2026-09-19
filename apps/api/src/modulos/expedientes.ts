import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

export const rutasExpedientes = Router();
rutasExpedientes.use(autenticar);

rutasExpedientes.get('/:id', async (req, res) => {
  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      servicio: {
        include: {
          cliente: true,
          vehiculo: { include: { inventario: true } },
          tecnico: true,
        },
      },
      evidencias: {
        orderBy: { tomadaEn: 'asc' }, // hora del dispositivo, no de llegada
        include: { subidaPor: { select: { nombre: true, rol: true } } },
      },
      novedades: { orderBy: { ocurridaEn: 'asc' } },
    },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  res.json(exp);
});

/** Observaciones: campo del tecnico. El contador de version descarta un
 *  reintento viejo que llegue despues de una edicion mas reciente. */
rutasExpedientes.patch('/:id/observaciones', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({ observaciones: z.string(), version: z.coerce.number().int().nonnegative() })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({ where: { id: Number(req.params.id) } });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

  if (datos.data.version <= exp.observacionesVersion) {
    // llego tarde: no es un error, simplemente ya hay algo mas nuevo
    return res.json({ ...exp, descartado: true });
  }

  res.json(
    await prisma.expediente.update({
      where: { id: exp.id },
      data: { observaciones: datos.data.observaciones, observacionesVersion: datos.data.version },
    }),
  );
});

const evidencia = z.object({
  idLocal: z.string().min(6),
  tipo: z.enum(['FOTO', 'VIDEO']),
  archivo: z.string().min(3),
  tomadaEn: z.coerce.date().optional(),
});

/** El tecnico y el cliente pueden aportar evidencia. Si el expediente ya se
 *  cerro no se rechaza: se guarda marcada, porque perder evidencia es peor
 *  que tener un registro tardio. */
rutasExpedientes.post('/:id/evidencias', async (req, res) => {
  const datos = evidencia.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({ where: { id: Number(req.params.id) } });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

  const yaExiste = await prisma.evidencia.findUnique({ where: { idLocal: datos.data.idLocal } });
  if (yaExiste) return res.status(200).json(yaExiste); // reintento: no duplica

  const creada = await prisma.evidencia.create({
    data: {
      idLocal: datos.data.idLocal,
      tipo: datos.data.tipo,
      archivo: datos.data.archivo,
      tomadaEn: datos.data.tomadaEn ?? new Date(),
      posteriorAlCierre: exp.cerradoEn !== null,
      subidaPorId: req.sesion!.id,
      expedienteId: exp.id,
    },
    include: { subidaPor: { select: { nombre: true, rol: true } } },
  });
  res.status(201).json(creada);
});

rutasExpedientes.post('/:id/novedades', exigirRol('TECNICO', 'CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({ idLocal: z.string().min(6), descripcion: z.string().min(3) })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({ where: { id: Number(req.params.id) } });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

  const yaExiste = await prisma.novedad.findUnique({ where: { idLocal: datos.data.idLocal } });
  if (yaExiste) return res.status(200).json(yaExiste);

  res.status(201).json(
    await prisma.novedad.create({
      data: { ...datos.data, expedienteId: exp.id, posteriorAlCierre: exp.cerradoEn !== null },
    }),
  );
});

/** Cerrar es exclusivo de la central: quien presta el servicio no declara
 *  cerrada la evidencia de que existio. */
rutasExpedientes.post('/:id/cerrar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: { servicio: true, _count: { select: { evidencias: true } } },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (exp.cerradoEn) return res.status(409).json({ error: 'El expediente ya estaba cerrado' });
  if (exp.servicio.estado !== 'TERMINADO') {
    return res.status(409).json({
      error: 'Solo se cierra un servicio que el tecnico haya marcado como terminado',
    });
  }
  if (exp._count.evidencias === 0) {
    return res.status(409).json({ error: 'No se puede cerrar un expediente sin evidencias' });
  }

  const cerrado = await prisma.$transaction(async (tx) => {
    await tx.servicio.update({ where: { id: exp.servicioId }, data: { estado: 'CERRADO' } });
    return tx.expediente.update({
      where: { id: exp.id },
      data: { cerradoEn: new Date(), cerradoPor: req.sesion!.id },
    });
  });
  res.json(cerrado);
});
