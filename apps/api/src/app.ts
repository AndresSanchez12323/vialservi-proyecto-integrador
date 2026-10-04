import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { rutasAuth, autenticar } from './auth.js';
import { rutasClientes } from './modulos/clientes.js';
import { rutasVehiculos } from './modulos/vehiculos.js';
import { rutasTecnicos } from './modulos/tecnicos.js';
import { rutasServicios } from './modulos/servicios.js';
import { rutasExpedientes } from './modulos/expedientes.js';
import { rutasReportes } from './modulos/reportes.js';
import { rutasNotificaciones } from './modulos/notificaciones.js';

export const crearApp = () => {
  const app = express();
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/salud', (_req, res) => res.json({ estado: 'ok' }));

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

  return app;
};
