import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { crearApp } from './app.js';

vi.mock('./config.js', async (original) => {
  const modulo = await original<typeof import('./config.js')>();
  return { config: { ...modulo.config, esProduccion: true, CORREO_MODO: 'consola' } };
});
vi.mock('./prisma.js', () => ({
  prisma: {
    usuario: { findUnique: vi.fn(async () => ({ id: 1, correo: 'prueba@example.com', nombre: 'Prueba' })) },
  },
}));

describe('Producción sin proveedor de correo', () => {
  it('mantiene disponible la salud del API', async () => {
    expect((await request(crearApp()).get('/api/salud')).status).toBe(200);
  });

  it('responde 503 al iniciar verificación sin intentar guardar ni enviar códigos', async () => {
    const token = jwt.sign({ id: 1, rol: 'CLIENTE', nombre: 'Prueba' }, config.JWT_SECRET);
    const respuesta = await request(crearApp()).post('/api/auth/clave/iniciar')
      .set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(503);
    expect(respuesta.body.error).toMatch(/no está disponible/);
    expect(respuesta.body.codigo).toBeUndefined();
  });
});
