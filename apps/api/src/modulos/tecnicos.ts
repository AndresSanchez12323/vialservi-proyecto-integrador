import { Router } from 'express';
import { z } from 'zod';
import { EstadoServicio } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';
import { distanciaRecorridoKm, estimarMinutos, puntoDe } from '../geo.js';

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

const fichaCompleta = {
  _count: { select: { servicios: true } },
  servicios: {
    where: { estado: { in: EN_CURSO } },
    select: { id: true, estado: true, vehiculo: { select: { placa: true } } },
  },
};

type FichaTecnico = Awaited<
  ReturnType<typeof prisma.tecnico.findMany<{ include: typeof fichaCompleta }>>
>[number];

/** Aplana la ficha: `activos` es el numero y `enCurso` el detalle. */
const resumir = ({ servicios, ...resto }: FichaTecnico) => ({
  ...resto,
  enCurso: servicios,
  activos: servicios.length,
});

rutasTecnicos.get('/', async (_req, res) => {
  const lista = await prisma.tecnico.findMany({
    orderBy: { nombre: 'asc' },
    include: fichaCompleta,
  });
  res.json(lista.map(resumir));
});

/**
 * Tablero de asignacion de la central.
 *
 * Con `servicioId` ordena a los tecnicos por cercania al sitio del servicio y
 * dice cuanto tardaria cada uno en llegar. Es lo que convierte la asignacion
 * en una decision con datos —"este esta a 3 km y libre"— en lugar de escoger
 * un nombre de una lista desplegable.
 *
 * La cercania solo se puede calcular si el servicio tiene coordenadas y el
 * tecnico reporto su ubicacion; si falta alguna, el tecnico aparece igual pero
 * sin distancia, porque seguir siendo asignable importa mas que el mapa.
 */
rutasTecnicos.get('/tablero', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const servicioId = req.query.servicioId ? Number(req.query.servicioId) : null;

  const servicio = servicioId
    ? await prisma.servicio.findUnique({
        where: { id: servicioId },
        select: { id: true, lat: true, lng: true, tipo: true, tipoSolicitado: true, direccion: true },
      })
    : null;
  if (servicioId && !servicio) {
    return res.status(404).json({ error: 'Servicio no encontrado' });
  }

  const destino = puntoDe(servicio?.lat, servicio?.lng);
  // El tipo definitivo si ya se clasifico; si no, lo que pidio el cliente,
  // para poder resaltar quien tiene la especialidad que probablemente hara
  // falta.
  const tipo = servicio?.tipo ?? servicio?.tipoSolicitado ?? null;
  const requerida =
    tipo === 'GRUA' ? 'GRUA' : tipo === 'CONDUCTOR_ELEGIDO' ? 'CONDUCTOR' : tipo ? 'MECANICA' : null;

  const lista = await prisma.tecnico.findMany({
    orderBy: { nombre: 'asc' },
    include: fichaCompleta,
  });

  const conDistancia = lista.map((t) => {
    const origen = puntoDe(t.lat, t.lng);
    const hayRuta = origen && destino;
    const base = resumir(t);
    return {
      ...base,
      distanciaKm: hayRuta ? Number(distanciaRecorridoKm(origen, destino).toFixed(1)) : null,
      minutosEstimados: hayRuta ? estimarMinutos(origen, destino) : null,
      apto: requerida ? t.especialidades.includes(requerida) : true,
    };
  });

  // Orden del tablero: primero quien puede hacerlo y esta libre, y entre esos
  // el mas cercano. Los que no aplican quedan al final pero visibles.
  conDistancia.sort((a, b) => {
    if (a.apto !== b.apto) return a.apto ? -1 : 1;
    const libreA = a.disponible && a.activos === 0;
    const libreB = b.disponible && b.activos === 0;
    if (libreA !== libreB) return libreA ? -1 : 1;
    if (a.distanciaKm !== null && b.distanciaKm !== null) return a.distanciaKm - b.distanciaKm;
    if (a.distanciaKm !== null) return -1;
    if (b.distanciaKm !== null) return 1;
    return a.activos - b.activos;
  });

  res.json({ servicio, especialidadRequerida: requerida, tecnicos: conDistancia });
});

// Hoja de vida propia del técnico autenticado.
rutasTecnicos.get('/yo', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const propio = await prisma.tecnico.findUnique({
    where: { usuarioId: req.sesion!.id },
    include: fichaCompleta,
  });
  if (!propio) return res.status(404).json({ error: 'Su usuario no tiene ficha de técnico' });
  res.json(resumir(propio));
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

/**
 * El tecnico reporta donde esta. Campo suyo: nadie mas lo escribe.
 *
 * Se guarda la hora para poder decir "hace 2 minutos" en el mapa del cliente:
 * una posicion sin hora no se puede interpretar, porque no se sabe si es de
 * ahora o de ayer.
 */
rutasTecnicos.patch('/yo/ubicacion', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Coordenadas invalidas' });

  const propio = await prisma.tecnico.findUnique({ where: { usuarioId: req.sesion!.id } });
  if (!propio) return res.status(404).json({ error: 'Su usuario no tiene ficha de técnico' });

  res.json(
    await prisma.tecnico.update({
      where: { id: propio.id },
      data: { lat: datos.data.lat, lng: datos.data.lng, ubicacionEn: new Date() },
    }),
  );
});

rutasTecnicos.post('/', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnico.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const repetido = await prisma.tecnico.findUnique({ where: { documento: datos.data.documento } });
  if (repetido) return res.status(409).json({ error: 'Ya existe un tecnico con ese documento' });

  const creado = await prisma.tecnico.create({ data: datos.data });
  res.status(201).json(creado);
});

rutasTecnicos.put('/:id', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnico.partial().safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  res.json(await prisma.tecnico.update({ where: { id: Number(req.params.id) }, data: datos.data }));
});
