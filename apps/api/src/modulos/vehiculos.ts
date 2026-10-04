import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';

// La placa es el identificador natural del vehiculo y con ella se consulta
// el historial, por eso se guarda siempre en mayusculas y sin espacios.
// Lo que el cliente sabe de memoria. Los identificadores de la licencia de
// transito (VIN, chasis, motor) NO se piden aqui a proposito: los toma el
// tecnico en sitio con la tarjeta de propiedad en la mano, al verificar el
// expediente. Pedirlos al registrar solo lograria que el cliente los dejara
// vacios o los inventara.
const vehiculo = z.object({
  placa: z.string().min(5).max(8).transform((p) => p.toUpperCase().replace(/\s/g, '')),
  marca: z.string().min(2),
  modelo: z.string().min(2),
  color: z.string().min(3),
  linea: z.string().optional(),
  clase: z.string().optional(),
  // opcional: cuando lo registra el propio cliente se toma de su sesion.
  clienteId: z.coerce.number().int().positive().optional(),
});

// Datos del documento del vehiculo: los completa el tecnico al verificar o la
// central por telefono, nunca el cliente al registrarse.
const documentos = z.object({
  linea: z.string().optional(),
  clase: z.string().optional(),
  licenciaTransito: z.string().optional(),
  vin: z.string().optional(),
  chasis: z.string().optional(),
  motor: z.string().optional(),
  propietarioNombre: z.string().optional(),
  propietarioDocumento: z.string().optional(),
});

// Tope de vehiculos que un cliente puede registrar por su cuenta. Si necesita
// mas, lo registra la central. Cambiar aqui el valor ajusta la regla.
export const MAX_VEHICULOS_CLIENTE = 5;

const objeto = z.object({
  descripcion: z.string().min(3),
  cantidad: z.coerce.number().int().positive().default(1),
});

export const rutasVehiculos = Router();
rutasVehiculos.use(autenticar);

/** La lista tambien se filtra por rol: el cliente necesita ver sus vehiculos
 *  para poder solicitar un servicio, pero no los de los demas, porque cada
 *  registro lleva el nombre y el documento de su dueño. */
rutasVehiculos.get('/', async (req, res) => {
  const placa = String(req.query.placa ?? '').toUpperCase();
  const sesion = req.sesion!;
  // mode: 'insensitive' es obligatorio en PostgreSQL. En SQLite `contains` ya
  // ignoraba mayusculas, pero Postgres distingue: sin esto, buscar "abc123" no
  // encontraria la placa "ABC123" y la busqueda se romperia en silencio.
  const where: Record<string, unknown> = placa
    ? { placa: { contains: placa, mode: 'insensitive' } }
    : {};

  if (sesion.rol === 'CLIENTE') {
    const c = await prisma.cliente.findUnique({ where: { usuarioId: sesion.id } });
    where.clienteId = c?.id ?? -1;
  } else if (sesion.rol === 'TECNICO') {
    // El tecnico solo ve los vehiculos de los servicios que le asignaron.
    const t = await prisma.tecnico.findUnique({ where: { usuarioId: sesion.id } });
    where.servicios = { some: { tecnicoId: t?.id ?? -1 } };
  }

  const lista = await prisma.vehiculo.findMany({
    where,
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

  // El detalle trae los datos completos del propietario y el inventario del
  // vehiculo, asi que el cliente solo puede abrir los suyos.
  if (req.sesion!.rol === 'CLIENTE') {
    const c = await prisma.cliente.findUnique({ where: { usuarioId: req.sesion!.id } });
    if (encontrado.clienteId !== c?.id) {
      return res.status(403).json({ error: 'No tiene permiso para esta accion' });
    }
  }

  res.json(encontrado);
});

/** El cliente registra su propio vehiculo, y la central registra el de
 *  cualquiera. Registrarlo es el primer paso para poder pedir un servicio. */
rutasVehiculos.post('/', exigirRol('ADMINISTRADOR', 'CENTRAL', 'CLIENTE'), async (req, res) => {
  const datos = vehiculo.safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: 'Datos invalidos', detalle: datos.error.issues });
  }

  const sesion = req.sesion!;
  let clienteId = datos.data.clienteId;

  if (sesion.rol === 'CLIENTE') {
    // Igual que en la solicitud: el dueño sale de la sesion y se ignora el
    // que venga en la peticion, para que nadie registre un vehiculo a
    // nombre de otra persona.
    const propio = await prisma.cliente.findUnique({ where: { usuarioId: sesion.id } });
    if (!propio) return res.status(403).json({ error: 'Su usuario no esta enlazado a un cliente' });
    const cuantos = await prisma.vehiculo.count({ where: { clienteId: propio.id } });
    if (cuantos >= MAX_VEHICULOS_CLIENTE) {
      return res.status(403).json({
        error: `Ya tiene ${MAX_VEHICULOS_CLIENTE} vehiculos registrados. Para registrar otro, comuniquese con la central.`,
      });
    }
    clienteId = propio.id;
  } else if (!clienteId) {
    return res.status(400).json({ error: 'Falta indicar el propietario' });
  } else if (!(await prisma.cliente.findUnique({ where: { id: clienteId } }))) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }

  // La placa identifica al vehiculo en todo el sistema: el historial se
  // consulta con ella, asi que no puede repetirse.
  const repetido = await prisma.vehiculo.findUnique({ where: { placa: datos.data.placa } });
  if (repetido) return res.status(409).json({ error: 'Ya existe un vehiculo con esa placa' });

  const creado = await prisma.vehiculo.create({
    data: { ...datos.data, clienteId: clienteId! },
    include: { cliente: { select: { id: true, nombre: true, documento: true } } },
  });
  res.status(201).json(creado);
});

/** La central completa los datos de la licencia de transito. */
rutasVehiculos.put('/:id/documentos', exigirRol('ADMINISTRADOR', 'CENTRAL'), async (req, res) => {
  const datos = documentos.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const existe = await prisma.vehiculo.findUnique({ where: { id: Number(req.params.id) } });
  if (!existe) return res.status(404).json({ error: 'Vehiculo no encontrado' });

  res.json(
    await prisma.vehiculo.update({ where: { id: existe.id }, data: datos.data }),
  );
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
