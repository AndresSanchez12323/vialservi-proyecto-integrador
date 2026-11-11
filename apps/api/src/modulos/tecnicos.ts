import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { EstadoServicio, Rol, TipoVerificacionCorreo } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar, crearVerificacion, exigirRol, validarVerificacion } from '../auth.js';
import { distanciaRecorridoKm, estimarMinutos, puntoDe } from '../geo.js';
import { CERRADOS } from '../estado.js';

const tecnico = z.object({
  documento: z.string().min(5),
  nombre: z.string().min(3),
  telefono: z.string().min(7),
  especialidades: z.string().min(3), // "MECANICA,CERRAJERIA,GRUA,CONDUCTOR"
  licencia: z.string().optional(),
  disponible: z.boolean().optional(),
});
const tecnicoConCorreo = tecnico.extend({ correo: z.string().email() });
const claveInicial = () => `Vial${Math.random().toString(36).slice(2, 8).toUpperCase()}!`;

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
    where: { archivadoEn: null },
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
  const tipoSolicitado = typeof req.query.tipo === 'string' ? req.query.tipo : null;

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
  const tipo = tipoSolicitado ?? servicio?.tipo ?? servicio?.tipoSolicitado ?? null;
  const requerida =
    tipo === 'GRUA' ? 'GRUA' : tipo === 'CONDUCTOR_ELEGIDO' ? 'CONDUCTOR' : tipo ? 'MECANICA' : null;

  const lista = await prisma.tecnico.findMany({
    where: requerida ? { archivadoEn: null, especialidades: { contains: requerida } } : { archivadoEn: null },
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
  if (propio.archivadoEn) return res.status(409).json({ error: 'Su ficha de técnico está archivada' });
  res.json(resumir(propio));
});

// El técnico actualiza su disponibilidad: la central la ve en tiempo real
// y con ella decide a quién asignar.
rutasTecnicos.patch('/yo/disponibilidad', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z.object({ disponible: z.boolean() }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Se esperaba { disponible: true|false }' });

  const propio = await prisma.tecnico.findUnique({ where: { usuarioId: req.sesion!.id } });
  if (!propio) return res.status(404).json({ error: 'Su usuario no tiene ficha de técnico' });
  if (propio.archivadoEn) return res.status(409).json({ error: 'Su ficha de técnico está archivada' });

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
  if (propio.archivadoEn) return res.status(409).json({ error: 'Su ficha de técnico está archivada' });

  res.json(
    await prisma.tecnico.update({
      where: { id: propio.id },
      data: { lat: datos.data.lat, lng: datos.data.lng, ubicacionEn: new Date() },
    }),
  );
});

rutasTecnicos.post('/iniciar', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnicoConCorreo.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const repetido = await prisma.tecnico.findUnique({ where: { documento: datos.data.documento } });
  if (repetido) return res.status(409).json({ error: 'Ya existe un tecnico con ese documento' });
  const usuarioRepetido = await prisma.usuario.findFirst({
    where: { OR: [{ documento: datos.data.documento }, { correo: datos.data.correo.toLowerCase() }] },
  });
  if (usuarioRepetido) return res.status(409).json({ error: 'El documento o correo ya tiene una cuenta' });

  const verificacion = await crearVerificacion({
    tipo: TipoVerificacionCorreo.REGISTRO_TECNICO,
    correo: datos.data.correo.toLowerCase(),
    nombre: datos.data.nombre,
    datos: { ...datos.data, correo: datos.data.correo.toLowerCase() },
  });
  res.status(202).json({ verificacionId: verificacion.id, ...(verificacion.codigo ? { codigo: verificacion.codigo } : {}) });
});

rutasTecnicos.post('/confirmar', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = z.object({ verificacionId: z.string().min(1), codigo: z.string().length(6) }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Código inválido' });
  let pendiente;
  try {
    pendiente = await validarVerificacion(datos.data.verificacionId, datos.data.codigo, TipoVerificacionCorreo.REGISTRO_TECNICO);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Código inválido' });
  }
  const registro = JSON.parse(pendiente.datos) as z.infer<typeof tecnicoConCorreo>;
  const claveInicialTexto = claveInicial();
  const creado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: {
        documento: registro.documento,
        nombre: registro.nombre,
        correo: registro.correo,
        clave: await bcrypt.hash(claveInicialTexto, 10),
        rol: Rol.TECNICO,
      },
    });
    const ficha = await tx.tecnico.create({
      data: {
        documento: registro.documento,
        nombre: registro.nombre,
        telefono: registro.telefono,
        especialidades: registro.especialidades,
        licencia: registro.licencia,
        disponible: registro.disponible,
        usuarioId: usuario.id,
      },
    });
    await tx.verificacionCorreo.update({ where: { id: pendiente!.id }, data: { usadoEn: new Date() } });
    return ficha;
  });
  res.status(201).json({
    tecnico: creado,
    credenciales: { usuario: registro.documento, contraseñaInicial: claveInicialTexto, correo: registro.correo },
  });
});

rutasTecnicos.put('/:id', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const datos = tecnico.partial().safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });
  const existente = await prisma.tecnico.findUnique({
    where: { id: Number(req.params.id) },
    include: { usuario: true },
  });
  if (!existente) return res.status(404).json({ error: 'Tecnico no encontrado' });
  if (datos.data.documento && datos.data.documento !== existente.documento) {
    const [repetidoTecnico, repetidoUsuario] = await Promise.all([
      prisma.tecnico.findUnique({ where: { documento: datos.data.documento } }),
      prisma.usuario.findUnique({ where: { documento: datos.data.documento } }),
    ]);
    if (repetidoTecnico || repetidoUsuario) {
      return res.status(409).json({ error: 'Ya existe un tecnico o usuario con ese documento' });
    }
  }
  const actualizado = await prisma.$transaction(async (tx) => {
    const ficha = await tx.tecnico.update({ where: { id: existente.id }, data: datos.data });
    if (existente.usuarioId && existente.usuario) {
      await tx.usuario.update({
        where: { id: existente.usuarioId },
        data: {
          ...(datos.data.documento !== undefined ? { documento: datos.data.documento } : {}),
          ...(datos.data.nombre !== undefined ? { nombre: datos.data.nombre } : {}),
        },
      });
    }
    return ficha;
  });
  res.json(actualizado);
});

/**
 * Archivar no borra la ficha ni sus servicios: solo la saca de la operación.
 * Un técnico con trabajo activo o expediente sin cerrar no puede archivarse.
 */
rutasTecnicos.patch('/:id/archivar', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.tecnico.findUnique({
    where: { id },
    include: { servicios: { select: { estado: true, expediente: { select: { cerradoEn: true } } } } },
  });
  if (!existente) return res.status(404).json({ error: 'Tecnico no encontrado' });
  const tieneTrabajoAbierto = existente.servicios.some(
    (servicio) => !CERRADOS.includes(servicio.estado)
      || (servicio.expediente && !servicio.expediente.cerradoEn),
  );
  if (tieneTrabajoAbierto) {
    return res.status(409).json({ error: 'No puede archivar el técnico porque tiene un expediente o servicio abierto' });
  }
  const archivado = await prisma.tecnico.update({
    where: { id },
    data: { archivadoEn: new Date(), disponible: false },
  });
  res.json(archivado);
});

rutasTecnicos.patch('/:id/reactivar', exigirRol('ADMINISTRADOR'), async (req, res) => {
  const actualizado = await prisma.tecnico.updateMany({
    where: { id: Number(req.params.id), archivadoEn: { not: null } },
    data: { archivadoEn: null, disponible: true },
  });
  if (actualizado.count === 0) return res.status(404).json({ error: 'Tecnico archivado no encontrado' });
  res.json(await prisma.tecnico.findUniqueOrThrow({ where: { id: Number(req.params.id) } }));
});
