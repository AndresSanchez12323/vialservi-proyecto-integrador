import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

export const rutasServicios = Router();
rutasServicios.use(autenticar);

const solicitud = z.object({
  clienteId: z.coerce.number().int().positive(),
  vehiculoId: z.coerce.number().int().positive(),
  direccion: z.string().min(5),
  descripcion: z.string().min(5),
});

const clasificacion = z.object({
  tipo: z.enum(['GRUA', 'CARRO_TALLER', 'CONDUCTOR_ELEGIDO']),
  tecnicoId: z.coerce.number().int().positive(),
});

const incluir = {
  cliente: { select: { id: true, nombre: true, documento: true, telefono: true } },
  vehiculo: { select: { id: true, placa: true, marca: true, modelo: true, color: true } },
  tecnico: { select: { id: true, nombre: true, especialidades: true } },
  expediente: { select: { id: true, consecutivo: true, cerradoEn: true } },
};

/** Cada rol ve lo suyo: el tecnico solo sus servicios, el cliente solo los de
 *  su vehiculo. El filtro se aplica aqui, en el servidor. */
rutasServicios.get('/', async (req, res) => {
  const sesion = req.sesion!;
  let where = {};

  if (sesion.rol === 'TECNICO') {
    const t = await prisma.tecnico.findUnique({ where: { usuarioId: sesion.id } });
    where = { tecnicoId: t?.id ?? -1 };
  } else if (sesion.rol === 'CLIENTE') {
    const c = await prisma.cliente.findUnique({ where: { usuarioId: sesion.id } });
    where = { clienteId: c?.id ?? -1 };
  }

  res.json(
    await prisma.servicio.findMany({ where, orderBy: { solicitadoEn: 'desc' }, include: incluir }),
  );
});

rutasServicios.get('/:id', async (req, res) => {
  const s = await prisma.servicio.findUnique({
    where: { id: Number(req.params.id) },
    include: incluir,
  });
  if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
  res.json(s);
});

rutasServicios.post('/', exigirRol('CENTRAL', 'ADMINISTRADOR', 'CLIENTE'), async (req, res) => {
  const datos = solicitud.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  const creado = await prisma.servicio.create({ data: datos.data, include: incluir });
  res.status(201).json(creado);
});

/** La central clasifica el servicio, lo asigna y con eso nace el expediente. */
rutasServicios.patch('/:id/clasificar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const datos = clasificacion.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Falta el tipo o el tecnico' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({ where: { id }, include: { expediente: true } });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (servicio.estado === 'CANCELADO' || servicio.estado === 'CERRADO') {
    return res.status(409).json({ error: 'El servicio ya no admite cambios' });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.servicio.update({
      where: { id },
      data: { tipo: datos.data.tipo, tecnicoId: datos.data.tecnicoId, estado: 'ASIGNADO' },
    });

    if (!servicio.expediente) {
      const total = await tx.expediente.count();
      const consecutivo = `EXP-2026-${String(total + 1).padStart(4, '0')}`;
      await tx.expediente.create({ data: { consecutivo, servicioId: id } });
    }
    return tx.servicio.findUnique({ where: { id }, include: incluir });
  });

  res.json(resultado);
});

/** El tecnico avanza el estado: son hechos que solo el conoce en el sitio. */
rutasServicios.patch('/:id/estado', exigirRol('TECNICO', 'CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const estado = z.enum(['EN_EJECUCION', 'TERMINADO']).safeParse(req.body?.estado);
  if (!estado.success) return res.status(400).json({ error: 'Estado no permitido' });

  const servicio = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (servicio.estado === 'CERRADO' || servicio.estado === 'CANCELADO') {
    return res.status(409).json({ error: 'El servicio ya esta cerrado o cancelado' });
  }

  res.json(
    await prisma.servicio.update({
      where: { id: servicio.id },
      data: { estado: estado.data },
      include: incluir,
    }),
  );
});

/** Cancelar exige motivo: un servicio que desaparece sin explicacion es
 *  justamente el hueco de trazabilidad que el sistema quiere evitar. */
rutasServicios.patch('/:id/cancelar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const motivo = z.string().min(5).safeParse(req.body?.motivo);
  if (!motivo.success) return res.status(400).json({ error: 'La cancelacion exige un motivo' });

  const servicio = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (servicio.estado === 'CERRADO') {
    return res.status(409).json({ error: 'Un servicio cerrado no se puede cancelar' });
  }

  res.json(
    await prisma.servicio.update({
      where: { id: servicio.id },
      data: {
        estado: 'CANCELADO',
        canceladoEn: new Date(),
        canceladoPor: req.sesion!.id,
        motivoCancelacion: motivo.data,
      },
      include: incluir,
    }),
  );
});
