import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

const cliente = z.object({
  documento: z.string().min(5),
  nombre: z.string().min(3),
  telefono: z.string().min(7),
  correo: z.string().email().optional().or(z.literal('')),
});

export const rutasClientes = Router();
rutasClientes.use(autenticar);

// El directorio completo lleva el documento y el telefono de terceros: no lo
// ve el tecnico ni el cliente, solo quien administra la operacion.
rutasClientes.get('/', exigirRol('ADMINISTRADOR', 'CENTRAL'), async (_req, res) => {
  const lista = await prisma.cliente.findMany({
    orderBy: { nombre: 'asc' },
    include: { _count: { select: { vehiculos: true, servicios: true } } },
  });
  res.json(lista);
});

rutasClientes.get('/:id', async (req, res) => {
  const encontrado = await prisma.cliente.findUnique({
    where: { id: Number(req.params.id) },
    include: { vehiculos: true },
  });
  if (!encontrado) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(encontrado);
});

rutasClientes.post('/', exigirRol('ADMINISTRADOR', 'CENTRAL'), async (req, res) => {
  const datos = cliente.safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: 'Datos invalidos', detalle: datos.error.issues });
  }
  const repetido = await prisma.cliente.findUnique({
    where: { documento: datos.data.documento },
  });
  if (repetido) return res.status(409).json({ error: 'Ya existe un cliente con ese documento' });

  const creado = await prisma.cliente.create({ data: datos.data });
  res.status(201).json(creado);
});

rutasClientes.put('/:id', exigirRol('ADMINISTRADOR', 'CENTRAL'), async (req, res) => {
  const datos = cliente.partial().safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  const actualizado = await prisma.cliente.update({
    where: { id: Number(req.params.id) },
    data: datos.data,
  });
  res.json(actualizado);
});
