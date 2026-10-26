import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';
import { CERRADOS } from '../estado.js';
import { randomUUID } from 'node:crypto';
import { eliminarObjeto, urlDeSubidaTarjeta } from '../almacenamiento.js';
import { analizarTarjeta, type CaraTarjeta } from '../ocr.js';

// Datos del documento del vehiculo. Al cliente no se le PIDEN en el
// formulario: los identificadores de la licencia de transito (VIN, chasis,
// motor) los toma el tecnico en sitio con el documento en la mano, al
// verificar el expediente. Pedirlos al registrar solo lograria que el cliente
// los dejara vacios o los inventara.
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

// La placa es el identificador natural del vehiculo y con ella se consulta el
// historial, por eso se guarda siempre en mayusculas y sin espacios.
const vehiculo = z
  .object({
    placa: z.string().min(5).max(6).transform((p) => p.toUpperCase().replace(/\s/g, '')),
    marca: z.string().min(2),
    modelo: z.string().min(2),
    color: z.string().min(3),
    // opcional: cuando lo registra el propio cliente se toma de su sesion.
    clienteId: z.coerce.number().int().positive().optional(),
  })
  // Los datos del documento se ACEPTAN al registrar, pero no se piden. La
  // diferencia importa: al cliente se le piden solo los cuatro datos que sabe
  // de memoria, y si ademas fotografia la licencia de transito, lo que se leyo
  // de ella se guarda en vez de tirarse para que el tecnico lo vuelva a
  // teclear. Lo que entre por aqui es lo que diga el documento del cliente;
  // la comprobacion de quien entrega el vehiculo la hace el tecnico en sitio,
  // aparte, y es la que tiene valor como soporte.
  .merge(documentos);

// Tope de vehiculos que un cliente puede registrar por su cuenta. Si necesita
// mas, lo registra la central. Cambiar aqui el valor ajusta la regla.
export const MAX_VEHICULOS_CLIENTE = 5;

const objeto = z.object({
  descripcion: z.string().min(3),
  cantidad: z.coerce.number().int().positive().default(1),
});

export const rutasVehiculos = Router();
rutasVehiculos.use(autenticar);

// El TECNICO tambien lee la tarjeta, y no es un permiso de adorno: si el
// cliente registro el vehiculo sin los datos del documento —que es lo normal,
// porque no se los pedimos—, quien tiene la licencia de transito en la mano es
// el tecnico en el sitio. Sin esto tendria que teclear el VIN a ojo.
const LEEN_TARJETA = ['ADMINISTRADOR', 'CENTRAL', 'CLIENTE', 'TECNICO'] as const;

rutasVehiculos.post('/leer-tarjeta/preparar', exigirRol(...LEEN_TARJETA), async (_req, res) => {
  const subida = await urlDeSubidaTarjeta(randomUUID());
  if (!subida.url) return res.status(503).json({ error: 'La lectura automática requiere OCR AWS configurado.' });
  res.json(subida);
});

rutasVehiculos.post('/leer-tarjeta/analizar', exigirRol(...LEEN_TARJETA), async (req, res) => {
  const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';
  if (!clave) return res.status(400).json({ error: 'Falta la imagen de la tarjeta.' });
  // Por omision el frente: es la cara que trae los datos del vehiculo y la
  // unica que se leia antes de que existiera el paso del reverso.
  const cara: CaraTarjeta = req.body?.cara === 'reverso' ? 'reverso' : 'frente';
  try {
    res.json(await analizarTarjeta(clave, cara));
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'No se pudo leer la tarjeta.';
    res.status(422).json({ error: mensaje });
  }
});

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

/** El cliente solo puede eliminar un vehiculo propio que aun no haya entrado
 *  al flujo operativo. Un expediente o un servicio abierto debe conservarse
 *  para no romper el historial del sistema. */
rutasVehiculos.delete('/:id', exigirRol('ADMINISTRADOR', 'CENTRAL', 'CLIENTE'), async (req, res) => {
  const id = Number(req.params.id);
  const encontrado = await prisma.vehiculo.findUnique({
    where: { id },
    include: {
      servicios: { select: { id: true, estado: true, expediente: { select: { id: true } } } },
    },
  });
  if (!encontrado) return res.status(404).json({ error: 'Vehiculo no encontrado' });

  if (req.sesion!.rol === 'CLIENTE') {
    const cliente = await prisma.cliente.findUnique({ where: { usuarioId: req.sesion!.id } });
    if (encontrado.clienteId !== cliente?.id) {
      return res.status(403).json({ error: 'No tiene permiso para esta accion' });
    }
  }

  if (encontrado.servicios.some((servicio) => servicio.expediente)) {
    return res.status(409).json({ error: 'No puede eliminar el vehiculo porque tiene un expediente' });
  }
  if (encontrado.servicios.some((servicio) => !CERRADOS.includes(servicio.estado))) {
    return res.status(409).json({ error: 'No puede eliminar el vehiculo porque tiene un servicio abierto' });
  }

  await prisma.vehiculo.delete({ where: { id } });
  res.json({ eliminado: true });
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
