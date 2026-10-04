import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Rol } from '@prisma/client';
import { prisma } from './prisma.js';
import { config } from './config.js';
import { correoRecuperacion, enviarCorreo } from './correo.js';

export type Sesion = { id: number; rol: string; nombre: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sesion?: Sesion;
    }
  }
}

export const autenticar = (req: Request, res: Response, next: NextFunction) => {
  const cabecera = req.headers.authorization ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta el token de sesion' });

  try {
    req.sesion = jwt.verify(token, config.JWT_SECRET) as Sesion;
    next();
  } catch {
    res.status(401).json({ error: 'Sesion invalida o vencida' });
  }
};

/** Restringe una ruta a ciertos roles. Los permisos se resuelven aqui, en el
 *  back-end, no en la navegacion del cliente. */
export const exigirRol =
  (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.sesion || !roles.includes(req.sesion.rol)) {
      return res.status(403).json({ error: 'No tiene permiso para esta accion' });
    }
    next();
  };

const VUELTAS_BCRYPT = 10;
/** Una clave corta es el eslabon mas debil de todo lo demas. */
const clave = z.string().min(8, 'La contrasena debe tener al menos 8 caracteres');

const credenciales = z.object({
  documento: z.string().min(1),
  clave: z.string().min(1),
});

export const rutasAuth = Router();

rutasAuth.post('/login', async (req, res) => {
  const datos = credenciales.safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos incompletos' });

  const usuario = await prisma.usuario.findUnique({
    where: { documento: datos.data.documento },
  });

  if (!usuario || !usuario.activo || !(await bcrypt.compare(datos.data.clave, usuario.clave))) {
    // mismo mensaje en ambos casos: no se revela si el documento existe
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const sesion: Sesion = { id: usuario.id, rol: usuario.rol, nombre: usuario.nombre };
  const token = jwt.sign(sesion, config.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, usuario: sesion });
});

rutasAuth.get('/yo', autenticar, (req, res) => res.json(req.sesion));

// ── Registro publico ─────────────────────────────────────────────────────
// SOLO crea cuentas de cliente. Los roles de central, tecnico y administrador
// los asigna personal autorizado: si el registro publico pudiera elegir rol,
// cualquiera se haria central y cerraria expedientes ajenos.
const registro = z.object({
  documento: z.string().min(5).max(15).regex(/^\d+$/, 'El documento son solo numeros'),
  nombre: z.string().min(3),
  correo: z.string().email(),
  telefono: z.string().min(7).max(15),
  clave,
});

rutasAuth.post('/registro', async (req, res) => {
  const datos = registro.safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: datos.error.issues[0]?.message ?? 'Datos invalidos' });
  }
  const { documento, nombre, correo, telefono } = datos.data;

  // Se comprueban los dos unicos antes de insertar para poder decir cual
  // choca. El documento tambien se busca en Cliente: la central pudo haberlo
  // registrado por telefono, y en ese caso la cuenta se enlaza a esa ficha en
  // lugar de crear un cliente duplicado con la misma cedula.
  const [porDocumento, porCorreo] = await Promise.all([
    prisma.usuario.findUnique({ where: { documento } }),
    prisma.usuario.findUnique({ where: { correo: correo.toLowerCase() } }),
  ]);
  if (porDocumento) return res.status(409).json({ error: 'Ya existe una cuenta con ese documento' });
  if (porCorreo) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });

  const fichaPrevia = await prisma.cliente.findUnique({ where: { documento } });
  if (fichaPrevia?.usuarioId) {
    return res.status(409).json({ error: 'Ese documento ya tiene una cuenta asociada' });
  }

  const hash = await bcrypt.hash(datos.data.clave, VUELTAS_BCRYPT);

  const creado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: { documento, nombre, correo: correo.toLowerCase(), clave: hash, rol: Rol.CLIENTE },
    });

    if (fichaPrevia) {
      // Enlaza la cuenta nueva con la ficha que ya tenia la central, para no
      // perder los servicios y vehiculos que ya estuvieran a su nombre.
      await tx.cliente.update({
        where: { id: fichaPrevia.id },
        data: { usuarioId: usuario.id, correo: correo.toLowerCase(), telefono },
      });
    } else {
      await tx.cliente.create({
        data: { documento, nombre, telefono, correo: correo.toLowerCase(), usuarioId: usuario.id },
      });
    }
    return usuario;
  });

  // Se devuelve la sesion lista: obligar a iniciar sesion justo despues de
  // registrarse es un paso extra sin ninguna ganancia.
  const sesion: Sesion = { id: creado.id, rol: creado.rol, nombre: creado.nombre };
  const token = jwt.sign(sesion, config.JWT_SECRET, { expiresIn: '8h' });
  res.status(201).json({ token, usuario: sesion, enlazadoAFichaExistente: !!fichaPrevia });
});

// ── Recuperacion de clave por codigo ─────────────────────────────────────
const CODIGO_INTENTOS_MAX = 5;

const codigoNuevo = () => String(Math.floor(100000 + Math.random() * 900000));

/**
 * Paso 1: pedir el codigo.
 *
 * Responde 200 SIEMPRE, exista o no la cuenta. Si contestara 404 para un
 * documento desconocido, cualquiera podria usar esta ruta para averiguar que
 * cedulas tienen cuenta en VialServi.
 */
rutasAuth.post('/recuperar', async (req, res) => {
  const datos = z
    .object({ documento: z.string().min(1) })
    .safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Indique su documento' });

  const generico = {
    mensaje:
      'Si el documento corresponde a una cuenta, enviamos un codigo al correo registrado.',
  };

  const usuario = await prisma.usuario.findUnique({
    where: { documento: datos.data.documento },
  });
  if (!usuario || !usuario.activo) return res.json(generico);

  const codigo = codigoNuevo();
  const expiraEn = new Date(Date.now() + config.CODIGO_VIGENCIA_MINUTOS * 60_000);

  await prisma.$transaction(async (tx) => {
    // Un codigo nuevo invalida los anteriores: si no, pedir el codigo varias
    // veces dejaria varias puertas abiertas a la vez.
    await tx.recuperacionClave.updateMany({
      where: { usuarioId: usuario.id, usadoEn: null },
      data: { usadoEn: new Date() },
    });
    await tx.recuperacionClave.create({
      data: {
        usuarioId: usuario.id,
        codigo: await bcrypt.hash(codigo, VUELTAS_BCRYPT),
        expiraEn,
      },
    });
  });

  // El envio va en try/catch a proposito: si SES falla y la excepcion subiera,
  // esta ruta responderia 500 para una cuenta que existe y 200 para una que no,
  // y esa diferencia es justo lo que el mensaje generico trata de ocultar. El
  // codigo ya quedo guardado, asi que el usuario puede volver a pedirlo.
  try {
    await enviarCorreo({
      para: usuario.correo,
      ...correoRecuperacion(usuario.nombre, codigo, config.CODIGO_VIGENCIA_MINUTOS),
    });
  } catch (error) {
    console.error('[recuperar] no se pudo enviar el correo:', error instanceof Error ? error.message : error);
  }

  res.json({
    ...generico,
    // Solo en desarrollo y con la bandera encendida a proposito.
    ...(config.CORREO_REVELAR_CODIGO ? { codigo } : {}),
  });
});

/** Paso 2: confirmar el codigo y poner la clave nueva. */
rutasAuth.post('/recuperar/confirmar', async (req, res) => {
  const datos = z
    .object({
      documento: z.string().min(1),
      codigo: z.string().length(6),
      nuevaClave: clave,
    })
    .safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: datos.error.issues[0]?.message ?? 'Datos invalidos' });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { documento: datos.data.documento },
  });
  // Mensaje unico para codigo malo, vencido o documento inexistente: separar
  // los casos le diria a quien prueba a ciegas por donde seguir.
  const invalido = { error: 'El codigo no es valido o ya vencio' };
  if (!usuario || !usuario.activo) return res.status(400).json(invalido);

  const pendiente = await prisma.recuperacionClave.findFirst({
    where: { usuarioId: usuario.id, usadoEn: null, expiraEn: { gt: new Date() } },
    orderBy: { creadoEn: 'desc' },
  });
  if (!pendiente) return res.status(400).json(invalido);

  if (pendiente.intentos >= CODIGO_INTENTOS_MAX) {
    // Sin tope, un codigo de 6 digitos se adivina probando un millon de veces.
    await prisma.recuperacionClave.update({
      where: { id: pendiente.id },
      data: { usadoEn: new Date() },
    });
    return res.status(429).json({ error: 'Demasiados intentos. Solicite un codigo nuevo.' });
  }

  if (!(await bcrypt.compare(datos.data.codigo, pendiente.codigo))) {
    await prisma.recuperacionClave.update({
      where: { id: pendiente.id },
      data: { intentos: { increment: 1 } },
    });
    return res.status(400).json(invalido);
  }

  const hash = await bcrypt.hash(datos.data.nuevaClave, VUELTAS_BCRYPT);
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: usuario.id }, data: { clave: hash } }),
    prisma.recuperacionClave.update({
      where: { id: pendiente.id },
      data: { usadoEn: new Date() },
    }),
  ]);

  res.json({ ok: true, mensaje: 'Contrasena actualizada. Ya puede iniciar sesion.' });
});

/** Cambio de clave con la sesion abierta: exige la clave actual. */
rutasAuth.post('/clave', autenticar, async (req, res) => {
  const datos = z
    .object({ actual: z.string().min(1), nueva: clave })
    .safeParse(req.body);
  if (!datos.success) {
    return res.status(400).json({ error: datos.error.issues[0]?.message ?? 'Datos invalidos' });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.sesion!.id } });
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Pedir la actual evita que una sesion olvidada en un equipo ajeno sirva
  // para dejar al dueno sin cuenta.
  if (!(await bcrypt.compare(datos.data.actual, usuario.clave))) {
    return res.status(400).json({ error: 'La contrasena actual no es correcta' });
  }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { clave: await bcrypt.hash(datos.data.nueva, VUELTAS_BCRYPT) },
  });
  res.json({ ok: true, mensaje: 'Contrasena actualizada.' });
});
