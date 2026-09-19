import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

// La placa es el identificador natural del vehiculo y con ella se consulta
// el historial, por eso se guarda siempre en mayusculas y sin espacios.
const vehiculo = z.object({
  placa: z.string().min(5).max(8).transform((p) => p.toUpperCase().replace(/\s/g, '')),
  marca: z.string().min(2),
  modelo: z.string().min(2),
  color: z.string().min(3),
  clienteId: z.coerce.number().int().positive(),
});

const objeto = z.object({
  descripcion: z.string().min(3),
  cantidad: z.coerce.number().int().positive().default(1),
});

export const rutasVehiculos = Router();
rutasVehiculos.use(autenticar);

rutasVehiculos.get('/', async (req, res) => {
  const placa = String(req.query.placa ?? '').toUpperCase();
  const lista = await prisma.vehiculo.findMany({
    where: placa ? { placa: { contains: placa } } : undefined,
    orderBy: { placa: 'asc' },
    include: { cliente: { select: { id: true, nombre: true, documento: true } } },
  });
  res.json(lista);
});

rutasVehiculos.get('/:id', async (req, res) => {
  const encontrado = await prisma.vehiculo.findUnique({
    where: { id: Number(req.params.id) },
    include: { cliente: true, inventario: true },
  });
  if (!encontrado) return res.status(404).json({ error: 'Vehiculo no encontrado' });
  res.json(encontrado);
});

rutasVehiculos.post('/', exigirRol('ADMINISTRADOR', 'CENTRAL'), async (req, res) => {
  const datos = vehiculo.safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: 'Datos invalidos', detalle: datos.error.issues });
  }
  const repetido = await prisma.vehiculo.findUnique({ where: { placa: datos.data.placa } });
  if (repetido) return res.status(409).json({ error: 'Ya existe un vehiculo con esa placa' });

  const creado = await prisma.vehiculo.create({ data: datos.data });
  res.status(201).json(creado);
});

// Inventario de objetos del vehiculo: es la evidencia de lo que habia dentro
// cuando se recibio, y por eso vive junto al vehiculo y no dentro del servicio.
rutasVehiculos.post('/:id/inventario', exigirRol('ADMINISTRADOR', 'CENTRAL', 'TECNICO'), async (req, res) => {
  const datos = objeto.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const creado = await prisma.objetoInventario.create({
    data: { ...datos.data, vehiculoId: Number(req.params.id) },
  });
  res.status(201).json(creado);
});
