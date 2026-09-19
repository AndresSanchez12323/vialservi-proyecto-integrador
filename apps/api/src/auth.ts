import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './prisma.js';
import { config } from './config.js';

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
