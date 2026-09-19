import { Router } from 'express';
import { z } from 'zod';
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

rutasTecnicos.get('/', async (_req, res) => {
  const lista = await prisma.tecnico.findMany({
    orderBy: { nombre: 'asc' },
    include: { _count: { select: { servicios: true } } },
  });
  res.json(lista);
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
