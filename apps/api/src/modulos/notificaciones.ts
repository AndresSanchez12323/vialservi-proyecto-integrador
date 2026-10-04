/**
 * Notificaciones.
 *
 * Son filas por destinatario: una misma cosa que pasa (la central asigno un
 * servicio) genera una fila para el tecnico y otra para el cliente, con el
 * texto que a cada uno le sirve. Eso evita tener que decidir en pantalla que
 * parte del mensaje puede ver cada rol, y permite que cada quien marque como
 * leida SU fila sin tocar la del otro —que es otra vez la regla de no
 * compartir campos entre roles.
 *
 * La entrega es por consulta del cliente (polling), no por websocket: con
 * TanStack Query ya refrescando, una consulta cada pocos segundos es
 * suficiente para esta operacion y no obliga a mantener conexiones abiertas
 * ni a cambiar la infraestructura.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Rol, type TipoNotificacion } from '@prisma/client';
import { prisma } from '../prisma.js';
import { autenticar } from '../auth.js';

type Aviso = {
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  servicioId?: number;
  expedienteId?: number;
};

/** Crea una notificacion para cada destinatario indicado. */
export const avisar = async (usuarioIds: number[], aviso: Aviso) => {
  // Sin destinatarios no hay nada que insertar, y createMany con lista vacia
  // es una ida a la base para nada.
  const destinos = [...new Set(usuarioIds.filter((id): id is number => !!id))];
  if (destinos.length === 0) return;

  await prisma.notificacion.createMany({
    data: destinos.map((usuarioId) => ({ ...aviso, usuarioId })),
  });
};

/** Usuarios de la central y administradores: los que atienden la operacion. */
export const usuariosCentral = async (): Promise<number[]> => {
  const lista = await prisma.usuario.findMany({
    where: { activo: true, rol: { in: [Rol.CENTRAL, Rol.ADMINISTRADOR] } },
    select: { id: true },
  });
  return lista.map((u) => u.id);
};

/** Usuario del cliente de un servicio (puede no tener cuenta: la central lo creo). */
export const usuarioDelCliente = async (clienteId: number): Promise<number[]> => {
  const c = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { usuarioId: true },
  });
  return c?.usuarioId ? [c.usuarioId] : [];
};

/** Usuario del tecnico asignado, si tiene cuenta. */
export const usuarioDelTecnico = async (tecnicoId?: number | null): Promise<number[]> => {
  if (!tecnicoId) return [];
  const t = await prisma.tecnico.findUnique({
    where: { id: tecnicoId },
    select: { usuarioId: true },
  });
  return t?.usuarioId ? [t.usuarioId] : [];
};

export const rutasNotificaciones = Router();
rutasNotificaciones.use(autenticar);

/**
 * Bandeja del usuario autenticado. Nadie puede pedir la de otro: el
 * destinatario sale de la sesion, no de la URL.
 */
rutasNotificaciones.get('/', async (req, res) => {
  const soloNoLeidas = req.query.noLeidas === 'true';
  const lista = await prisma.notificacion.findMany({
    where: {
      usuarioId: req.sesion!.id,
      ...(soloNoLeidas ? { leidaEn: null } : {}),
    },
    orderBy: { creadaEn: 'desc' },
    take: 50,
    include: {
      servicio: {
        select: {
          id: true,
          estado: true,
          vehiculo: { select: { placa: true } },
          expediente: { select: { id: true, consecutivo: true } },
        },
      },
    },
  });

  const sinLeer = await prisma.notificacion.count({
    where: { usuarioId: req.sesion!.id, leidaEn: null },
  });

  res.json({ sinLeer, lista });
});

/** Marca una notificacion propia como leida. */
rutasNotificaciones.patch('/:id/leida', async (req, res) => {
  const id = Number(req.params.id);
  // El where incluye el usuario de la sesion: si la notificacion es de otro,
  // updateMany afecta cero filas y se responde 404 sin revelar que existe.
  const { count } = await prisma.notificacion.updateMany({
    where: { id, usuarioId: req.sesion!.id, leidaEn: null },
    data: { leidaEn: new Date() },
  });
  if (count === 0) return res.status(404).json({ error: 'Notificacion no encontrada' });
  res.json({ ok: true });
});

/** Marca todas las propias como leidas. */
rutasNotificaciones.patch('/leidas', async (req, res) => {
  const { count } = await prisma.notificacion.updateMany({
    where: { usuarioId: req.sesion!.id, leidaEn: null },
    data: { leidaEn: new Date() },
  });
  res.json({ marcadas: count });
});

// Validacion reutilizable por si mas adelante la central quiere enviar un
// aviso manual a un cliente.
export const avisoManual = z.object({
  usuarioId: z.coerce.number().int().positive(),
  titulo: z.string().min(3),
  mensaje: z.string().min(3),
});
