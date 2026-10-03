import { Router } from 'express';
import { z } from 'zod';
import { EstadoServicio } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

const tecnico = z.object({
  documento: z.string().min(5),
  nombre: z.string().min(3),
  telefono: z.string().min(7),
  especialidades: z.string().min(3), // "MECANICA,CERRAJERIA,GRUA,CONDUCTOR"
  licencia: z.string().optional(),
  disponible: z.boolean().optional(),
});

export const rutasTecnicos = Router();
rutasTecnicos.use(autenticar);

// Servicios en curso: lo que la central mira para saber si el técnico
// está ocupado antes de asignarle más trabajo.
const EN_CURSO = [EstadoServicio.ASIGNADO, EstadoServicio.EN_EJECUCION];

rutasTecnicos.get('/', async (_req, res) => {
  const lista = await prisma.tecnico.findMany({
    orderBy: { nombre: 'asc' },
    include: {
      _count: { select: { servicios: true } },
      servicios: { where: { estado: { in: EN_CURSO } }, select: { id: true } },
    },
  });
  res.json(lista.map((t) => ({ ...t, servicios: undefined, activos: t.servicios.length })));
});

// Hoja de vida propia del técnico autenticado.
rutasTecnicos.get('/yo', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const propio = await prisma.tecnico.findUnique({
    where: { usuarioId: req.sesion!.id },
    include: {
      _count: { select: { servicios: true } },
      servicios: { where: { estado: { in: EN_CURSO } }, select: { id: true } },
    },
  });
  if (!propio) return res.status(404).json({ error: 'Su usuario no tiene ficha de técnico' });
  res.json({ ...propio, servicios: undefined, activos: propio.servicios.length });
});

// El técnico actualiza su disponibilidad: la central la ve en tiempo real
// y con ella decide a quién asignar.
rutasTecnicos.patch('/yo/disponibilidad', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z.object({ disponible: z.boolean() }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Se esperaba { disponible: true|false }' });

  const propio = await prisma.tecnico.findUnique({ where: { usuarioId: req.sesion!.id } });
  if (!propio) return res.status(404).json({ error: 'Su usuario no tiene ficha de técnico' });

  res.json(await prisma.tecnico.update({
    where: { id: propio.id },
    data: { disponible: datos.data.disponible },
  }));
});

rutasTecnicos.post('/', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnico.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  const creado = await prisma.tecnico.create({ data: datos.data });
  res.status(201).json(creado);
});

rutasTecnicos.put('/:id', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnico.partial().safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  res.json(await prisma.tecnico.update({ where: { id: Number(req.params.id) }, data: datos.data }));
});
