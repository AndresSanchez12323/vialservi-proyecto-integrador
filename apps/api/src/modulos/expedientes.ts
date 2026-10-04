import { Router } from 'express';
import { z } from 'zod';
import { CategoriaEvidencia, type TipoServicio } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar, exigirRol } from '../auth.js';
import { recalcularEstado } from '../estado.js';
import { evidenciasRequeridas, faltantes, formatoDe } from '../formatos.js';
import {
  avisar,
  usuarioDelCliente,
  usuarioDelTecnico,
  usuariosCentral,
} from './notificaciones.js';

export const rutasExpedientes = Router();
rutasExpedientes.use(autenticar);

/**
 * Quien puede abrir este expediente. El expediente lleva el telefono y el
 * documento del cliente y las evidencias del servicio: no puede quedar
 * expuesto a cualquiera que cambie el numero en la URL.
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

/** Cuantas evidencias hay de cada categoria, para medir contra el formato. */
const conteoPorCategoria = async (expedienteId: number) => {
  const filas = await prisma.evidencia.groupBy({
    by: ['categoria'],
    where: { expedienteId },
    _count: { _all: true },
  });
  return Object.fromEntries(filas.map((f) => [f.categoria, f._count._all])) as Record<string, number>;
};

/**
 * Lo que le falta al expediente para poder cerrarse. Se calcula y se devuelve
 * con el expediente para que el tecnico vea su lista de pendientes en pantalla
 * en lugar de descubrir el faltante cuando la central le rebote el cierre.
 */
const pendientesDe = async (exp: {
  id: number;
  esPropietario: boolean | null;
  servicio: { tipo: TipoServicio | null; terminadoEn: Date | null };
  formatoTipo: string | null;
  formatoVersion: number | null;
}) => {
  const porCategoria = await conteoPorCategoria(exp.id);
  const requeridas = evidenciasRequeridas(exp.servicio.tipo, exp.formatoVersion);
  const faltanEvidencias = faltantes(requeridas, porCategoria);

  const avisos: string[] = [];
  if (exp.esPropietario === null) {
    avisos.push('Registrar si quien entrega el vehiculo es el propietario');
  }
  if (exp.esPropietario === false && !porCategoria[CategoriaEvidencia.FIRMA_CEDULA]) {
    avisos.push('Foto de la cedula con la firma de autorizacion');
  }
  for (const f of faltanEvidencias) {
    avisos.push(`${f.etiqueta} (faltan ${f.minimo - (porCategoria[f.categoria] ?? 0)})`);
  }
  if (!exp.servicio.terminadoEn) {
    avisos.push('El tecnico aun no marco el servicio como terminado');
  }

  return {
    porCategoria,
    requeridas,
    faltantes: faltanEvidencias,
    avisos,
    listoParaCerrar: avisos.length === 0,
  };
};

rutasExpedientes.get('/:id', async (req, res) => {
  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      servicio: {
        include: {
          cliente: true,
          vehiculo: { include: { inventario: true } },
          tecnico: {
            select: {
              id: true, nombre: true, telefono: true, especialidades: true,
              lat: true, lng: true, ubicacionEn: true,
            },
          },
        },
      },
      evidencias: {
        orderBy: { tomadaEn: 'asc' }, // hora del dispositivo, no de llegada
        include: { subidaPor: { select: { nombre: true, rol: true } } },
      },
      novedades: { orderBy: { ocurridaEn: 'asc' } },
    },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!(await puedeVer(req.sesion!, exp.servicio))) {
    return res.status(403).json({ error: 'No tiene permiso para esta accion' });
  }

  const formato = exp.servicio.tipo ? formatoDe(exp.servicio.tipo) : null;
  res.json({ ...exp, formato, control: await pendientesDe(exp) });
});

/** Observaciones: campo del tecnico. El contador de version descarta un
 *  reintento viejo que llegue despues de una edicion mas reciente. */
rutasExpedientes.patch('/:id/observaciones', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({ observaciones: z.string(), version: z.coerce.number().int().nonnegative() })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: { servicio: { select: { clienteId: true, tecnicoId: true } } },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!(await puedeVer(req.sesion!, exp.servicio))) {
    return res.status(403).json({ error: 'Ese expediente no esta asignado a usted' });
  }

  if (datos.data.version <= exp.observacionesVersion) {
    // llego tarde: no es un error, simplemente ya hay algo mas nuevo
    return res.json({ ...exp, descartado: true });
  }

  res.json(
    await prisma.expediente.update({
      where: { id: exp.id },
      data: { observaciones: datos.data.observaciones, observacionesVersion: datos.data.version },
    }),
  );
});

/**
 * Verificacion de quien entrega el vehiculo. La hace el TECNICO en sitio.
 *
 * Es el punto que decide si el formulario sigue por el camino normal o por el
 * de "no es el propietario", que exige la foto de la cedula con la firma.
 *
 * VialServi no comprueba procedencia ni hurto, y este registro no es una
 * certificacion de propiedad: solo deja constancia de lo que el tecnico vio y
 * de quien autorizo la maniobra.
 */
const verificacion = z.object({
  esPropietario: z.boolean(),
  version: z.coerce.number().int().nonnegative(),
  solicitanteNombre: z.string().min(3).optional(),
  solicitanteDocumento: z.string().min(5).optional(),
  solicitanteRelacion: z.string().min(3).optional(),
  // Datos que el tecnico toma de la licencia de transito con el documento en
  // la mano. Van al vehiculo, no al expediente: describen al vehiculo.
  vehiculo: z
    .object({
      linea: z.string().optional(),
      clase: z.string().optional(),
      licenciaTransito: z.string().optional(),
      vin: z.string().optional(),
      chasis: z.string().optional(),
      motor: z.string().optional(),
      propietarioNombre: z.string().optional(),
      propietarioDocumento: z.string().optional(),
    })
    .optional(),
});

rutasExpedientes.patch('/:id/verificacion', exigirRol('TECNICO', 'ADMINISTRADOR'), async (req, res) => {
  const datos = verificacion.safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: datos.error.issues[0]?.message ?? 'Datos invalidos' });
  }

  // Si no es el propietario hay que saber QUIEN entrega: una casilla marcada
  // sin nombre ni documento no sirve de soporte ante una reclamacion.
  if (!datos.data.esPropietario) {
    if (!datos.data.solicitanteNombre || !datos.data.solicitanteDocumento) {
      return res.status(400).json({
        error: 'Si no es el propietario, registre el nombre y el documento de quien entrega',
      });
    }
  }

  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      servicio: { select: { id: true, clienteId: true, tecnicoId: true, vehiculoId: true } },
    },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!(await puedeVer(req.sesion!, exp.servicio))) {
    return res.status(403).json({ error: 'Ese expediente no esta asignado a usted' });
  }
  if (exp.cerradoEn) {
    return res.status(409).json({ error: 'El expediente ya esta cerrado' });
  }

  // Mismo criterio que en observaciones: un envio viejo no pisa uno nuevo.
  if (datos.data.version <= exp.verificacionVersion) {
    return res.json({ ...exp, descartado: true });
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const e = await tx.expediente.update({
      where: { id: exp.id },
      data: {
        esPropietario: datos.data.esPropietario,
        // Si resulta que SI es el propietario se limpian los datos del
        // tercero: dejarlos de un cambio anterior haria creer que hubo una
        // autorizacion que ya no aplica.
        solicitanteNombre: datos.data.esPropietario ? null : datos.data.solicitanteNombre,
        solicitanteDocumento: datos.data.esPropietario ? null : datos.data.solicitanteDocumento,
        solicitanteRelacion: datos.data.esPropietario ? null : datos.data.solicitanteRelacion,
        verificadoEn: new Date(),
        verificadoPor: req.sesion!.id,
        verificacionVersion: datos.data.version,
      },
    });

    if (datos.data.vehiculo && Object.keys(datos.data.vehiculo).length > 0) {
      await tx.vehiculo.update({
        where: { id: exp.servicio.vehiculoId },
        data: datos.data.vehiculo,
      });
    }
    return e;
  });

  // Que alguien distinto del dueno entregue el vehiculo es justamente el caso
  // que la central debe poder revisar despues, asi que se avisa.
  if (!datos.data.esPropietario) {
    await avisar(await usuariosCentral(), {
      tipo: 'VERIFICACION_NO_PROPIETARIO',
      titulo: 'Quien entrega el vehiculo no es el propietario',
      mensaje: `${exp.consecutivo}: entrega ${datos.data.solicitanteNombre} (CC ${datos.data.solicitanteDocumento})${datos.data.solicitanteRelacion ? `, ${datos.data.solicitanteRelacion}` : ''}. Verifique la foto de la cedula con firma.`,
      servicioId: exp.servicio.id,
      expedienteId: exp.id,
    });
  }

  res.json(actualizado);
});

const evidencia = z.object({
  idLocal: z.string().min(6),
  tipo: z.enum(['FOTO', 'VIDEO']),
  categoria: z
    .enum(['GENERAL', 'RECEPCION', 'ENTREGA', 'DANO', 'FIRMA_CEDULA', 'DOCUMENTO'])
    .default('GENERAL'),
  archivo: z.string().min(3),
  tomadaEn: z.coerce.date().optional(),
});

// Categorias que solo puede aportar el tecnico. La firma de autorizacion y los
// documentos son el soporte de que el tecnico verifico algo: si el cliente
// pudiera subirlos, el control se lo estaria dando a la parte interesada.
const SOLO_TECNICO: string[] = [CategoriaEvidencia.FIRMA_CEDULA, CategoriaEvidencia.DOCUMENTO];

/** El tecnico y el cliente pueden aportar evidencia. Si el expediente ya se
 *  cerro no se rechaza: se guarda marcada, porque perder evidencia es peor
 *  que tener un registro tardio. */
rutasExpedientes.post('/:id/evidencias', async (req, res) => {
  const datos = evidencia.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: { servicio: { select: { id: true, clienteId: true, tecnicoId: true } } },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!(await puedeVer(req.sesion!, exp.servicio))) {
    return res.status(403).json({ error: 'No tiene permiso para esta accion' });
  }

  const rol = req.sesion!.rol;
  if (SOLO_TECNICO.includes(datos.data.categoria) && rol !== 'TECNICO' && rol !== 'ADMINISTRADOR') {
    return res.status(403).json({
      error: 'Esa clase de evidencia solo la puede aportar el tecnico que atiende el servicio',
    });
  }

  const yaExiste = await prisma.evidencia.findUnique({ where: { idLocal: datos.data.idLocal } });
  if (yaExiste) return res.status(200).json(yaExiste); // reintento: no duplica

  const creada = await prisma.evidencia.create({
    data: {
      idLocal: datos.data.idLocal,
      tipo: datos.data.tipo,
      categoria: datos.data.categoria,
      archivo: datos.data.archivo,
      tomadaEn: datos.data.tomadaEn ?? new Date(),
      posteriorAlCierre: exp.cerradoEn !== null,
      subidaPorId: req.sesion!.id,
      expedienteId: exp.id,
    },
    include: { subidaPor: { select: { nombre: true, rol: true } } },
  });

  // Cuando el cliente aporta su propia version de los hechos, el tecnico y la
  // central deben saberlo: es la evidencia que puede contradecir la del
  // tecnico en una reclamacion.
  if (rol === 'CLIENTE') {
    await avisar([...(await usuarioDelTecnico(exp.servicio.tecnicoId)), ...(await usuariosCentral())], {
      tipo: 'EVIDENCIA_CLIENTE',
      titulo: 'El cliente aporto una evidencia',
      mensaje: `${exp.consecutivo}: el cliente subio ${datos.data.tipo === 'FOTO' ? 'una fotografia' : 'un video'}.`,
      servicioId: exp.servicio.id,
      expedienteId: exp.id,
    });
  }

  res.status(201).json(creada);
});

rutasExpedientes.post('/:id/novedades', exigirRol('TECNICO', 'CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z
    .object({ idLocal: z.string().min(6), descripcion: z.string().min(3) })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: { servicio: { select: { clienteId: true, tecnicoId: true } } },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (!(await puedeVer(req.sesion!, exp.servicio))) {
    return res.status(403).json({ error: 'No tiene permiso para esta accion' });
  }

  const yaExiste = await prisma.novedad.findUnique({ where: { idLocal: datos.data.idLocal } });
  if (yaExiste) return res.status(200).json(yaExiste);

  res.status(201).json(
    await prisma.novedad.create({
      data: { ...datos.data, expedienteId: exp.id, posteriorAlCierre: exp.cerradoEn !== null },
    }),
  );
});

/** Nota de revision de la central. Campo suyo: el tecnico no lo escribe. */
rutasExpedientes.patch('/:id/revision', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const datos = z.object({ revisionCentral: z.string().min(3) }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos invalidos' });

  const exp = await prisma.expediente.findUnique({ where: { id: Number(req.params.id) } });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

  res.json(
    await prisma.expediente.update({
      where: { id: exp.id },
      data: { revisionCentral: datos.data.revisionCentral },
    }),
  );
});

/** Cerrar es exclusivo de la central: quien presta el servicio no declara
 *  cerrada la evidencia de que existio. */
rutasExpedientes.post('/:id/cerrar', exigirRol('CENTRAL', 'ADMINISTRADOR'), async (req, res) => {
  const exp = await prisma.expediente.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      servicio: { include: { vehiculo: true, tecnico: true } },
      _count: { select: { evidencias: true } },
    },
  });
  if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
  if (exp.cerradoEn) return res.status(409).json({ error: 'El expediente ya estaba cerrado' });

  if (!exp.servicio.terminadoEn) {
    return res.status(409).json({
      error: 'Solo se cierra un servicio que el tecnico haya marcado como terminado',
    });
  }
  if (exp._count.evidencias === 0) {
    return res.status(409).json({ error: 'No se puede cerrar un expediente sin evidencias' });
  }

  // El cierre se mide contra el formato con el que se diligencio, no contra el
  // vigente: si manana se agrega un campo obligatorio, este expediente sigue
  // valido con la regla que tenia cuando se lleno.
  const control = await pendientesDe(exp);
  if (!control.listoParaCerrar) {
    return res.status(409).json({
      error: `El expediente esta incompleto: ${control.avisos.join('; ')}`,
      avisos: control.avisos,
    });
  }

  const cerrado = await prisma.$transaction(async (tx) => {
    const e = await tx.expediente.update({
      where: { id: exp.id },
      data: { cerradoEn: new Date(), cerradoPor: req.sesion!.id },
    });
    // El estado del servicio se deriva: cerrar el expediente lo pone CERRADO.
    await recalcularEstado(exp.servicioId, tx);
    return e;
  });

  await Promise.all([
    avisar(await usuarioDelCliente(exp.servicio.clienteId), {
      tipo: 'EXPEDIENTE_CERRADO',
      titulo: 'Su servicio quedo cerrado',
      mensaje: `Expediente ${exp.consecutivo} de ${exp.servicio.vehiculo.placa} cerrado. Puede consultarlo cuando lo necesite.`,
      servicioId: exp.servicioId,
      expedienteId: exp.id,
    }),
    avisar(await usuarioDelTecnico(exp.servicio.tecnicoId), {
      tipo: 'EXPEDIENTE_CERRADO',
      titulo: 'La central cerro un expediente suyo',
      mensaje: `${exp.consecutivo} · ${exp.servicio.vehiculo.placa}`,
      servicioId: exp.servicioId,
      expedienteId: exp.id,
    }),
  ]);

  res.json(cerrado);
});
