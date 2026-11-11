import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Rol, TipoVerificacionCorreo } from '@prisma/client';
import { prisma } from './prisma.js';
import { config } from './config.js';
import { enviarCorreo } from './correo.js';
import { correoRecuperacion, correoVerificacion } from './plantillas.js';

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

export const verificarCorreoDisponible = (_req: Request, res: Response, next: NextFunction) => {
  if (config.esProduccion && config.CORREO_MODO === 'consola') {
    return res.status(503).json({ error: 'La verificación por correo no está disponible temporalmente.' });
  }
  next();
};

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

rutasAuth.post('/registro/iniciar', verificarCorreoDisponible, async (req, res) => {
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

  const verificacion = await crearVerificacion({
    tipo: TipoVerificacionCorreo.REGISTRO_CLIENTE,
    correo: correo.toLowerCase(),
    nombre,
    datos: {
      documento, nombre, correo: correo.toLowerCase(), telefono, clave: hash,
      fichaPreviaId: fichaPrevia?.id ?? null,
    },
  });
  res.status(202).json({ verificacionId: verificacion.id, ...(config.CORREO_REVELAR_CODIGO ? { codigo: verificacion.codigo } : {}) });
});

rutasAuth.post('/registro/confirmar', async (req, res) => {
  const datos = z.object({ verificacionId: z.string().min(1), codigo: z.string().length(6) }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Código inválido' });
  let pendiente;
  try {
    pendiente = await validarVerificacion(datos.data.verificacionId, datos.data.codigo, TipoVerificacionCorreo.REGISTRO_CLIENTE);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Código inválido' });
  }
  const registro = JSON.parse(pendiente.datos) as {
    documento: string; nombre: string; correo: string; telefono: string; clave: string; fichaPreviaId: number | null;
  };
  const creado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: { documento: registro.documento, nombre: registro.nombre, correo: registro.correo, clave: registro.clave, rol: Rol.CLIENTE },
    });
    if (registro.fichaPreviaId) {
      await tx.cliente.update({ where: { id: registro.fichaPreviaId }, data: { usuarioId: usuario.id, correo: registro.correo, telefono: registro.telefono } });
    } else {
      await tx.cliente.create({ data: { documento: registro.documento, nombre: registro.nombre, telefono: registro.telefono, correo: registro.correo, usuarioId: usuario.id } });
    }
    await tx.verificacionCorreo.update({ where: { id: pendiente!.id }, data: { usadoEn: new Date() } });
    return usuario;
  });
  const sesion: Sesion = { id: creado.id, rol: creado.rol, nombre: creado.nombre };
  const token = jwt.sign(sesion, config.JWT_SECRET, { expiresIn: '8h' });
  res.status(201).json({ token, usuario: sesion, enlazadoAFichaExistente: !!registro.fichaPreviaId });
});

// ── Recuperacion de clave por codigo ─────────────────────────────────────
const CODIGO_INTENTOS_MAX = 5;

const codigoNuevo = () => String(Math.floor(100000 + Math.random() * 900000));

export const crearVerificacion = async (datos: {
  tipo: TipoVerificacionCorreo;
  correo: string;
  nombre: string;
  datos: Record<string, unknown>;
  usuarioId?: number;
}) => {
  const codigo = codigoNuevo();
  const expiraEn = new Date(Date.now() + config.CODIGO_VIGENCIA_MINUTOS * 60_000);
  const verificacion = await prisma.$transaction(async (tx) => {
    await tx.verificacionCorreo.updateMany({
      where: { correo: datos.correo, tipo: datos.tipo, usadoEn: null },
      data: { usadoEn: new Date() },
    });
    return tx.verificacionCorreo.create({
      data: {
        tipo: datos.tipo,
        correo: datos.correo,
        codigo: await bcrypt.hash(codigo, VUELTAS_BCRYPT),
        datos: JSON.stringify(datos.datos),
        expiraEn,
        usuarioId: datos.usuarioId,
      },
    });
  });
  await enviarCorreo({
    para: datos.correo,
    ...correoVerificacion(datos.nombre, codigo, config.CODIGO_VIGENCIA_MINUTOS),
  });
  return { id: verificacion.id, ...(config.CORREO_REVELAR_CODIGO ? { codigo } : {}) };
};

export const validarVerificacion = async (id: string, codigo: string, tipo: TipoVerificacionCorreo) => {
  const pendiente = await prisma.verificacionCorreo.findFirst({
    where: { id, tipo, usadoEn: null, expiraEn: { gt: new Date() } },
  });
  if (!pendiente || pendiente.intentos >= CODIGO_INTENTOS_MAX) {
    throw new Error('El código no es válido o ya venció');
  }
  if (!(await bcrypt.compare(codigo, pendiente.codigo))) {
    await prisma.verificacionCorreo.update({
      where: { id: pendiente.id },
      data: { intentos: { increment: 1 } },
    });
    throw new Error('El código no es válido o ya venció');
  }
  return pendiente;
};

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
    // Se registra la direccion a la que se intento enviar, NUNCA el codigo.
    // Sin esta linea, diagnosticar "no me llega el correo" obliga a entrar a la
    // base de datos para averiguar a que direccion se mando.
    console.log(`[recuperar] codigo emitido para el documento ${usuario.documento}, enviado a ${usuario.correo}`);
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

rutasAuth.post('/clave/iniciar', autenticar, verificarCorreoDisponible, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.sesion!.id } });
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const verificacion = await crearVerificacion({
    tipo: TipoVerificacionCorreo.CAMBIO_CLAVE,
    correo: usuario.correo,
    nombre: usuario.nombre,
    usuarioId: usuario.id,
    datos: {},
  });
  res.json({ verificacionId: verificacion.id, ...(verificacion.codigo ? { codigo: verificacion.codigo } : {}) });
});

rutasAuth.post('/clave/confirmar', autenticar, async (req, res) => {
  const datos = z.object({
    verificacionId: z.string().min(1),
    codigo: z.string().length(6),
    nueva: clave,
  }).safeParse(req.body);
  if (!datos.success) return res.status(400).json({ error: 'Datos inválidos' });
  let pendiente;
  try {
    pendiente = await validarVerificacion(datos.data.verificacionId, datos.data.codigo, TipoVerificacionCorreo.CAMBIO_CLAVE);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Código inválido' });
  }
  if (pendiente.usuarioId !== req.sesion!.id) return res.status(403).json({ error: 'Código no válido para esta sesión' });
  await prisma.$transaction([
    prisma.usuario.update({
      where: { id: req.sesion!.id },
      data: { clave: await bcrypt.hash(datos.data.nueva, VUELTAS_BCRYPT) },
    }),
    prisma.verificacionCorreo.update({ where: { id: pendiente.id }, data: { usadoEn: new Date() } }),
  ]);
  res.json({ ok: true, mensaje: 'Contraseña actualizada.' });
});
