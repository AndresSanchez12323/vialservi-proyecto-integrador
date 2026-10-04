import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { prisma } from './prisma.js';
import { rutasAuth, autenticar } from './auth.js';
import { rutasClientes } from './modulos/clientes.js';
import { rutasVehiculos } from './modulos/vehiculos.js';
import { rutasTecnicos } from './modulos/tecnicos.js';
import { rutasServicios } from './modulos/servicios.js';
import { rutasExpedientes } from './modulos/expedientes.js';
import { rutasReportes } from './modulos/reportes.js';
import { rutasNotificaciones } from './modulos/notificaciones.js';

/**
 * Express 4 NO captura el rechazo de una funcion async: la excepcion sale como
 * unhandledRejection y en Node moderno eso TUMBA el proceso. En local se nota
 * como un reinicio; en AWS seria el contenedor muriendo y volviendo a arrancar
 * en cada peticion que falle.
 *
 * Este envoltorio encadena el rechazo a next(), que es lo que el manejador de
 * errores del final sabe atender.
 */
const asincrono =
  (manejador: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(manejador(req, res, next)).catch(next);

export const crearApp = () => {
  const app = express();

  // Detras de CloudFront o de un balanceador, la IP y el protocolo reales
  // llegan en X-Forwarded-*. Sin esto, req.ip seria siempre la del proxy y
  // req.protocol diria "http" aunque el usuario este en HTTPS.
  if (config.esProduccion) app.set('trust proxy', true);

  // La cabecera delata la tecnologia sin dar nada a cambio.
  app.disable('x-powered-by');

  app.use(
    cors({
      // Lista blanca desde la configuracion. En produccion el SPA comparte
      // origen con el API (ambos detras de CloudFront), asi que esto solo hace
      // falta en desarrollo y para herramientas como Postman.
      origin: config.origenes.includes('*') ? true : config.origenes,
    }),
  );
  // 5 MB alcanza de sobra: los archivos NO pasan por aqui, suben directo a S3
  // con una URL prefirmada. Lo que llega es solo JSON con metadatos.
  app.use(express.json({ limit: '5mb' }));

  /**
   * Sonda de salud. Responde sin tocar la base para que el balanceador no
   * marque la instancia como caida por una consulta lenta.
   */
  app.get('/api/salud', (_req, res) => res.json({ estado: 'ok' }));

  /**
   * Sonda de disponibilidad: esta si comprueba la base. Se usa al desplegar
   * para saber si la instancia puede atender de verdad, y es la que delata una
   * contrasena de RDS mal configurada o un grupo de seguridad cerrado.
   */
  app.get(
    '/api/listo',
    asincrono(async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ estado: 'listo', baseDeDatos: 'ok' });
      } catch (error) {
        res.status(503).json({
          estado: 'no disponible',
          baseDeDatos: 'sin conexion',
          detalle: config.esProduccion ? undefined : String(error),
        });
      }
    }),
  );

  app.use('/api/auth', rutasAuth);
  app.use('/api/clientes', rutasClientes);
  app.use('/api/vehiculos', rutasVehiculos);
  app.use('/api/tecnicos', rutasTecnicos);
  app.use('/api/servicios', rutasServicios);
  app.use('/api/expedientes', rutasExpedientes);
  app.use('/api/reportes', rutasReportes);
  app.use('/api/notificaciones', rutasNotificaciones);

  // Modulo aun no construido: se declara para que la navegacion y el API
  // hablen de lo mismo.
  app.use('/api/usuarios', autenticar, (_req, res) =>
    res.status(501).json({ error: 'El modulo de usuarios aun no esta implementado' }),
  );

  // Una ruta del API que no existe debe decir 404 en JSON. Sin esto Express
  // devuelve una pagina HTML que el cliente intenta leer como JSON y falla con
  // un error que no explica nada.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  /**
   * Manejador de errores final. Va de ultimo y con cuatro parametros, que es
   * como Express lo reconoce.
   *
   * En produccion NO se devuelve el detalle: un stack trace puede llevar rutas
   * del servidor, nombres de tablas o fragmentos de consulta. Va al log de
   * CloudWatch, que es donde el equipo puede verlo.
   */
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error no atendido]', error);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Ocurrio un error inesperado en el servidor',
      detalle: config.esProduccion ? undefined : String(error),
    });
  });

  return app;
};
