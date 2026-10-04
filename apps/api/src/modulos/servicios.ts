import { Router } from 'express';
import { z } from 'zod';
import { TipoServicio } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';
import { estaCerrado, recalcularEstado } from '../estado.js';
import { versionVigente } from '../formatos.js';
import { distanciaRecorridoKm, estimarMinutos, puntoDe } from '../geo.js';
import {
  avisar,
  usuarioDelCliente,
  usuarioDelTecnico,
  usuariosCentral,
} from './notificaciones.js';

export const rutasServicios = Router();
rutasServicios.use(autenticar);

const TIPOS = ['GRUA', 'CARRO_TALLER', 'CONDUCTOR_ELEGIDO'] as const;

// Coordenadas: opcionales, porque un cliente puede negar el permiso de
// ubicacion del navegador y aun asi tiene derecho a pedir el servicio. Sin
// coordenadas se pierde el mapa y el tiempo estimado, no el servicio.
const coordenadas = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
};

const solicitud = z.object({
  // va opcional porque cuando solicita el propio cliente no se recibe: se
  // toma de su sesion. La central si lo envia, porque pide a nombre de otro.
  clienteId: z.coerce.number().int().positive().optional(),
  vehiculoId: z.coerce.number().int().positive(),
  // El cliente indica qué cree necesitar; la central confirma al clasificar.
  tipoSolicitado: z.enum(TIPOS).optional(),
  direccion: z.string().min(5),
  descripcion: z.string().min(5),
  contactoTelefono: z.string().min(7).max(15).optional(),
  ...coordenadas,
});

const clasificacion = z.object({
  tipo: z.enum(TIPOS),
  tecnicoId: z.coerce.number().int().positive(),
});

const incluir = {
  cliente: { select: { id: true, nombre: true, documento: true, telefono: true } },
  vehiculo: { select: { id: true, placa: true, marca: true, modelo: true, color: true } },
  tecnico: {
    select: {
      id: true, nombre: true, telefono: true, especialidades: true,
      lat: true, lng: true, ubicacionEn: true,
    },
  },
  expediente: {
    select: {
      id: true, consecutivo: true, cerradoEn: true,
      esPropietario: true, verificadoEn: true,
    },
  },
};

/**
 * Agrega al servicio lo que se calcula y no se guarda: cuanto falta para que
 * llegue el tecnico y a que distancia esta. Si el tecnico informo su propio
 * tiempo, ese manda sobre la estimacion, porque el esta en la via.
 */
const conSeguimiento = <T extends {
  lat: number | null; lng: number | null;
  etaMinutos: number | null; etaActualizadoEn: Date | null;
  tecnico: { lat: number | null; lng: number | null } | null;
}>(s: T) => {
  const destino = puntoDe(s.lat, s.lng);
  const origen = puntoDe(s.tecnico?.lat, s.tecnico?.lng);
  const hayRuta = destino && origen;

  return {
    ...s,
    seguimiento: {
      distanciaKm: hayRuta ? Number(distanciaRecorridoKm(origen, destino).toFixed(1)) : null,
      minutosEstimados: s.etaMinutos ?? (hayRuta ? estimarMinutos(origen, destino) : null),
      // Que el cliente sepa de donde sale el numero: no es lo mismo que el
      // tecnico diga "voy en 10" que una cuenta hecha con la distancia.
      origenDelTiempo: s.etaMinutos ? ('tecnico' as const) : hayRuta ? ('estimado' as const) : null,
      informadoEn: s.etaActualizadoEn,
    },
  };
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

  const lista = await prisma.servicio.findMany({
    where,
    orderBy: { solicitadoEn: 'desc' },
    include: incluir,
  });
  res.json(lista.map(conSeguimiento));
});

/**
 * Comprueba que la sesion pueda ver ese servicio concreto.
 * Sin esto, un cliente podria leer el servicio de otro cambiando el id en la
 * URL: la lista estaba filtrada, pero el detalle no.
 */
const puedeVer = async (
  sesion: { id: number; rol: string },
  servicio: { clienteId: number; tecnicoId: number | null },
): Promise<boolean> => {
  if (sesion.rol === 'CENTRAL' || sesion.rol === 'ADMINISTRADOR') return true;
  if (sesion.rol === 'CLIENTE') {
    const c = await prisma.cliente.findUnique({ where: { usuarioId: sesion.id } });
    return !!c && c.id === servicio.clienteId;
  }
  if (sesion.rol === 'TECNICO') {
    const t = await prisma.tecnico.findUnique({ where: { usuarioId: sesion.id } });
    return !!t && t.id === servicio.tecnicoId;
  }
  return false;
};

rutasServicios.get('/:id', async (req, res) => {
  const s = await prisma.servicio.findUnique({
    where: { id: Number(req.params.id) },
    include: incluir,
  });
  if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (!(await puedeVer(req.sesion!, s))) {
    return res.status(403).json({ error: 'No tiene permiso para esta accion' });
  }
  res.json(conSeguimiento(s));
});

/** La solicitud del servicio. La hace el cliente, o la central cuando el
 *  cliente llama por telefono. Nace en SOLICITADO, sin tipo y sin tecnico:
 *  eso lo decide despues la central al clasificar. */
rutasServicios.post('/', exigirRol('CENTRAL', 'ADMINISTRADOR', 'CLIENTE'), async (req, res) => {
  const datos = solicitud.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const sesion = req.sesion!;
  let clienteId = datos.data.clienteId;

  if (sesion.rol === 'CLIENTE') {
    // El cliente solo solicita para si mismo: el clienteId sale de la sesion
    // y se ignora el que venga en la peticion, para que nadie pueda pedir un
    // servicio a nombre de otra persona.
    const propio = await prisma.cliente.findUnique({ where: { usuarioId: sesion.id } });
    if (!propio) return res.status(403).json({ error: 'Su usuario no esta enlazado a un cliente' });
    clienteId = propio.id;
  } else if (!clienteId) {
    return res.status(400).json({ error: 'Falta indicar el cliente' });
  }

  // El vehiculo tiene que ser del cliente que solicita: el historial se
  // consulta por placa, y un cruce equivocado lo dañaria de raiz.
  const vehiculo = await prisma.vehiculo.findUnique({ where: { id: datos.data.vehiculoId } });
  if (!vehiculo) return res.status(404).json({ error: 'Vehiculo no encontrado' });
  if (vehiculo.clienteId !== clienteId) {
    return res.status(409).json({ error: 'El vehiculo no pertenece a ese cliente' });
  }

  // Un mismo vehiculo con dos servicios abiertos a la vez es casi siempre un
  // doble clic o un cliente impaciente, y le costaria a la central mandar dos
  // tecnicos al mismo sitio.
  const abierto = await prisma.servicio.findFirst({
    where: {
      vehiculoId: datos.data.vehiculoId,
      estado: { in: ['SOLICITADO', 'ASIGNADO', 'EN_EJECUCION', 'TERMINADO'] },
    },
  });
  if (abierto) {
    return res.status(409).json({
      error: `El vehiculo ${vehiculo.placa} ya tiene un servicio en curso (#${abierto.id}). Espere a que se cierre.`,
    });
  }

  const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });

  const creado = await prisma.servicio.create({
    data: {
      clienteId,
      vehiculoId: datos.data.vehiculoId,
      tipoSolicitado: datos.data.tipoSolicitado,
      direccion: datos.data.direccion,
      descripcion: datos.data.descripcion,
      // Si no lo informan, se usa el telefono de la ficha del cliente: la
      // central necesita a quien llamar, no un campo vacio.
      contactoTelefono: datos.data.contactoTelefono ?? cliente.telefono,
      lat: datos.data.lat,
      lng: datos.data.lng,
    },
    include: incluir,
  });

  // La central tiene que enterarse sola: nadie va a estar recargando la
  // pantalla a las 2 a.m. esperando que entre una solicitud.
  await avisar(await usuariosCentral(), {
    tipo: 'SERVICIO_SOLICITADO',
    titulo: 'Nueva solicitud de servicio',
    mensaje: `${cliente.nombre} solicita ${datos.data.tipoSolicitado ? `«${datos.data.tipoSolicitado}»` : 'un servicio'} para el vehiculo ${vehiculo.placa} en ${datos.data.direccion}.`,
    servicioId: creado.id,
  });

  res.status(201).json(conSeguimiento(creado));
});

/** La central clasifica el servicio, lo asigna y con eso nace el expediente. */
rutasServicios.patch('/:id/clasificar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const datos = clasificacion.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Falta el tipo o el tecnico' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({
    where: { id },
    include: { expediente: true, cliente: true, vehiculo: true },
  });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (estaCerrado(servicio.estado)) {
    return res.status(409).json({ error: 'El servicio ya no admite cambios' });
  }

  const tecnico = await prisma.tecnico.findUnique({ where: { id: datos.data.tecnicoId } });
  if (!tecnico) return res.status(404).json({ error: 'Tecnico no encontrado' });

  // La hoja de vida manda: no se le asigna una grua a quien no esta
  // habilitado para operarla, aunque la central se equivoque en la pantalla.
  const requerida =
    datos.data.tipo === 'GRUA' ? 'GRUA'
    : datos.data.tipo === 'CONDUCTOR_ELEGIDO' ? 'CONDUCTOR'
    : 'MECANICA';
  if (!tecnico.especialidades.includes(requerida)) {
    return res.status(409).json({
      error: `${tecnico.nombre} no tiene la especialidad ${requerida} para ese tipo de servicio`,
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.servicio.update({
      where: { id },
      data: {
        tipo: datos.data.tipo,
        tecnicoId: datos.data.tecnicoId,
        asignadoEn: new Date(),
        asignadoPor: req.sesion!.id,
      },
    });

    if (!servicio.expediente) {
      // El consecutivo se calcula contando: con un solo proceso basta, y la
      // unicidad la garantiza el indice de la columna.
      const total = await tx.expediente.count();
      const consecutivo = `EXP-2026-${String(total + 1).padStart(4, '0')}`;
      await tx.expediente.create({
        data: {
          consecutivo,
          servicioId: id,
          // Se sella la version del formato con la que se va a diligenciar:
          // un cambio posterior del catalogo no altera este expediente.
          formatoTipo: datos.data.tipo,
          formatoVersion: versionVigente(datos.data.tipo as TipoServicio),
        },
      });
    }

    await recalcularEstado(id, tx);
    return tx.servicio.findUnique({ where: { id }, include: incluir });
  });

  const expedienteId = resultado?.expediente?.id;

  // Al tecnico, para que sepa que tiene trabajo; al cliente, para que sepa
  // que su solicitud dejo de estar en verificacion y quien va a llegar.
  await Promise.all([
    avisar(await usuarioDelTecnico(datos.data.tecnicoId), {
      tipo: 'SERVICIO_ASIGNADO',
      titulo: 'Le asignaron un servicio',
      mensaje: `${servicio.vehiculo.placa} · ${servicio.direccion}. ${servicio.descripcion}`,
      servicioId: id,
      expedienteId,
    }),
    avisar(await usuarioDelCliente(servicio.clienteId), {
      tipo: 'SERVICIO_ASIGNADO',
      titulo: 'Su servicio fue asignado',
      mensaje: `${tecnico.nombre} va en camino para atender su ${servicio.vehiculo.placa}. Puede seguirlo en el mapa.`,
      servicioId: id,
      expedienteId,
    }),
  ]);

  res.json(resultado ? conSeguimiento(resultado) : null);
});

/**
 * El tecnico avanza el estado: son hechos que solo el conoce en el sitio.
 *
 * No escribe `estado` sino SU marca de tiempo (iniciadoEn o terminadoEn), y
 * el estado se recalcula. Asi una cancelacion de la central nunca la deshace
 * un envio del tecnico que llegue tarde.
 */
rutasServicios.patch('/:id/estado', exigirRol('TECNICO', 'CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const estado = z.enum(['EN_EJECUCION', 'TERMINADO']).safeParse(req.body?.estado);
  if (!estado.success) return res.status(400).json({ error: 'Estado no permitido' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({
    where: { id },
    include: {
      expediente: { include: { _count: { select: { evidencias: true } } } },
      vehiculo: true,
      tecnico: true,
    },
  });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (estaCerrado(servicio.estado)) {
    return res.status(409).json({ error: 'El servicio ya esta cerrado, cancelado o rechazado' });
  }
  if (!(await puedeVer(req.sesion!, servicio))) {
    return res.status(403).json({ error: 'Ese servicio no esta asignado a usted' });
  }

  if (estado.data === 'EN_EJECUCION') {
    if (!servicio.asignadoEn) {
      return res.status(409).json({ error: 'No se puede iniciar un servicio que no ha sido asignado' });
    }
    if (servicio.iniciadoEn) return res.json(conSeguimiento(servicio as never)); // ya estaba iniciado

    await prisma.servicio.update({ where: { id }, data: { iniciadoEn: new Date() } });
  } else {
    if (!servicio.iniciadoEn) {
      return res.status(409).json({ error: 'No se puede terminar un servicio que no se inicio' });
    }

    // La verificacion de quien entrega el vehiculo es obligatoria ANTES de
    // terminar: si se pudiera cerrar sin ella, el control no existiria en la
    // practica, porque nadie vuelve sobre un servicio ya hecho.
    const exp = servicio.expediente;
    if (!exp) return res.status(409).json({ error: 'El servicio no tiene expediente' });
    if (exp.esPropietario === null) {
      return res.status(409).json({
        error: 'Antes de terminar debe registrar si quien entrega el vehiculo es el propietario',
      });
    }
    if (exp.esPropietario === false) {
      // Quien no es propietario autoriza con su cedula y su firma. Esa foto
      // es el unico soporte de que alguien distinto del dueno autorizo la
      // maniobra, asi que sin ella el servicio no se puede dar por terminado.
      const firma = await prisma.evidencia.count({
        where: { expedienteId: exp.id, categoria: 'FIRMA_CEDULA' },
      });
      if (firma === 0) {
        return res.status(409).json({
          error:
            'Quien entrega no es el propietario: falta la foto de la cedula con la firma de autorizacion',
        });
      }
    }
    if (exp._count.evidencias === 0) {
      return res.status(409).json({ error: 'No se puede terminar un servicio sin ninguna evidencia' });
    }

    await prisma.servicio.update({ where: { id }, data: { terminadoEn: new Date() } });
  }

  await recalcularEstado(id);

  // Avisos distintos segun el paso: al cliente le importa que el tecnico
  // llego; a la central, que ya puede revisar y cerrar.
  if (estado.data === 'EN_EJECUCION') {
    await avisar(await usuarioDelCliente(servicio.clienteId), {
      tipo: 'SERVICIO_INICIADO',
      titulo: 'El tecnico llego y comenzo la atencion',
      mensaje: `${servicio.tecnico?.nombre ?? 'El tecnico'} esta atendiendo su ${servicio.vehiculo.placa}.`,
      servicioId: id,
      expedienteId: servicio.expediente?.id,
    });
  } else {
    await Promise.all([
      avisar(await usuariosCentral(), {
        tipo: 'SERVICIO_TERMINADO',
        titulo: 'Servicio terminado: pendiente de revisar y cerrar',
        mensaje: `${servicio.tecnico?.nombre ?? 'El tecnico'} termino el servicio de ${servicio.vehiculo.placa}. Revise el expediente para cerrarlo.`,
        servicioId: id,
        expedienteId: servicio.expediente?.id,
      }),
      avisar(await usuarioDelCliente(servicio.clienteId), {
        tipo: 'SERVICIO_TERMINADO',
        titulo: 'Atencion terminada',
        mensaje: 'El tecnico termino. La central revisara el expediente y lo cerrara.',
        servicioId: id,
        expedienteId: servicio.expediente?.id,
      }),
    ]);
  }

  const actualizado = await prisma.servicio.findUnique({ where: { id }, include: incluir });
  res.json(actualizado ? conSeguimiento(actualizado) : null);
});

/**
 * El tecnico informa cuanto le falta para llegar y donde esta.
 * Es campo suyo: la central no lo escribe, y por eso un envio tardio del
 * tecnico no puede pisar nada ajeno.
 */
rutasServicios.patch('/:id/eta', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({
      // Hasta 8 horas: mas que eso es un error de digitacion, no un trayecto.
      minutos: z.coerce.number().int().min(1).max(480),
      ...coordenadas,
    })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Indique los minutos de llegada' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({
    where: { id },
    include: { tecnico: true, vehiculo: true },
  });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (!(await puedeVer(req.sesion!, servicio))) {
    return res.status(403).json({ error: 'Ese servicio no esta asignado a usted' });
  }
  if (estaCerrado(servicio.estado)) {
    return res.status(409).json({ error: 'El servicio ya no admite cambios' });
  }

  await prisma.servicio.update({
    where: { id },
    data: { etaMinutos: datos.data.minutos, etaActualizadoEn: new Date() },
  });

  // Si el tecnico manda tambien su posicion, se guarda en SU ficha.
  if (datos.data.lat !== undefined && datos.data.lng !== undefined && servicio.tecnicoId) {
    await prisma.tecnico.update({
      where: { id: servicio.tecnicoId },
      data: { lat: datos.data.lat, lng: datos.data.lng, ubicacionEn: new Date() },
    });
  }

  await avisar(await usuarioDelCliente(servicio.clienteId), {
    tipo: 'TECNICO_EN_CAMINO',
    titulo: 'El tecnico informo su tiempo de llegada',
    mensaje: `${servicio.tecnico?.nombre ?? 'El tecnico'} llega en aproximadamente ${datos.data.minutos} minutos.`,
    servicioId: id,
  });

  const actualizado = await prisma.servicio.findUnique({ where: { id }, include: incluir });
  res.json(actualizado ? conSeguimiento(actualizado) : null);
});

/** Cancelar exige motivo: un servicio que desaparece sin explicacion es
 *  justamente el hueco de trazabilidad que el sistema quiere evitar. */
rutasServicios.patch('/:id/cancelar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const motivo = z.string().min(5).safeParse(req.body?.motivo);
  if (!motivo.success) return res.status(400).json({ error: 'La cancelacion exige un motivo' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({
    where: { id },
    include: { vehiculo: true, expediente: true },
  });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (servicio.estado === 'CERRADO') {
    return res.status(409).json({ error: 'Un servicio cerrado no se puede cancelar' });
  }

  await prisma.servicio.update({
    where: { id },
    data: {
      canceladoEn: new Date(),
      canceladoPor: req.sesion!.id,
      motivoCancelacion: motivo.data,
    },
  });
  await recalcularEstado(id);

  await Promise.all([
    avisar(await usuarioDelCliente(servicio.clienteId), {
      tipo: 'SERVICIO_CANCELADO',
      titulo: 'Su servicio fue cancelado',
      mensaje: `Servicio de ${servicio.vehiculo.placa} cancelado. Motivo: ${motivo.data}`,
      servicioId: id,
    }),
    avisar(await usuarioDelTecnico(servicio.tecnicoId), {
      tipo: 'SERVICIO_CANCELADO',
      titulo: 'Un servicio suyo fue cancelado',
      mensaje: `${servicio.vehiculo.placa}: ${motivo.data}. No se desplace.`,
      servicioId: id,
    }),
  ]);

  const actualizado = await prisma.servicio.findUnique({ where: { id }, include: incluir });
  res.json(actualizado ? conSeguimiento(actualizado) : null);
});

/**
 * Rechazar la solicitud. Es distinto de cancelar: cancelar es un servicio que
 * se iba a prestar y se suspende; rechazar es una solicitud que la central no
 * acepta (datos insuficientes, fuera de cobertura, vehiculo que no
 * corresponde). Se conserva el registro en lugar de borrarlo, porque el
 * historial de lo que NO se atendio tambien hace parte de la trazabilidad.
 */
rutasServicios.patch('/:id/rechazar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const motivo = z.string().min(5).safeParse(req.body?.motivo);
  if (!motivo.success) return res.status(400).json({ error: 'El rechazo exige un motivo' });

  const id = Number(req.params.id);
  const servicio = await prisma.servicio.findUnique({
    where: { id },
    include: { vehiculo: true },
  });
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  // Solo se rechaza lo que todavia no se empezo a atender: despues de que un
  // tecnico fue y volvio, lo que corresponde es cerrar, no negar el servicio.
  if (servicio.iniciadoEn || servicio.estado !== 'SOLICITADO') {
    return res.status(409).json({
      error: 'Solo se puede rechazar una solicitud que aun no ha sido asignada',
    });
  }

  await prisma.servicio.update({
    where: { id },
    data: {
      rechazadoEn: new Date(),
      rechazadoPor: req.sesion!.id,
      motivoRechazo: motivo.data,
    },
  });
  await recalcularEstado(id);

  await avisar(await usuarioDelCliente(servicio.clienteId), {
    tipo: 'SERVICIO_RECHAZADO',
    titulo: 'Su solicitud no fue aceptada',
    mensaje: `Solicitud para ${servicio.vehiculo.placa} rechazada. Motivo: ${motivo.data}`,
    servicioId: id,
  });

  const actualizado = await prisma.servicio.findUnique({ where: { id }, include: incluir });
  res.json(actualizado ? conSeguimiento(actualizado) : null);
});
