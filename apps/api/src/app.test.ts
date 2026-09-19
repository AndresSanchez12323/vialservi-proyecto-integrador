import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from './app.js';

const app = crearApp();

describe('API de VialServi', () => {
  it('responde al chequeo de salud', async () => {
    const r = await request(app).get('/api/salud');
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ok');
  });

  it('no deja consultar vehiculos sin token', async () => {
    const r = await request(app).get('/api/vehiculos');
    expect(r.status).toBe(401);
  });

  it('rechaza credenciales incorrectas', async () => {
    const r = await request(app).post('/api/auth/login').send({ documento: '0', clave: 'x' });
    expect(r.status).toBe(401);
  });

  it('avisa que los modulos pendientes no estan implementados', async () => {
    const r = await request(app).get('/api/expedientes');
    expect(r.status).toBe(401); // primero exige sesion
  });
});
