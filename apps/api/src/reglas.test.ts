/**
 * Pruebas de las reglas del negocio.
 *
 * No comprueban que las pantallas se vean: comprueban que el servidor
 * IMPIDE lo que no debe permitirse, aunque alguien llame la ruta
 * directamente sin pasar por la interfaz.
 *
 * Requiere la base con los datos de demostracion: npm run db:seed
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from './app.js';
import { prisma } from './prisma.js';
import { MAX_VEHICULOS_CLIENTE } from './modulos/vehiculos.js';

const app = crearApp();

const entrar = async (documento: string) => {
  const r = await request(app).post('/api/auth/login').send({ documento, clave: 'VialServi2026' });
  expect(r.status).toBe(200);
  return r.body.token as string;
};

let central = '';
let tecnico = '';
let cliente = '';
let admin = '';

beforeAll(async () => {
  [central, tecnico, cliente, admin] = await Promise.all([
    entrar('2001'), entrar('3001'), entrar('71234567'), entrar('1001'),
  ]);
});

const como = (token: string) => (peticion: request.Test) =>
  peticion.set('Authorization', `Bearer ${token}`);

describe('A. Acceso', () => {
  it('A1 · sin token no se entra a ningun modulo', async () => {
    expect((await request(app).get('/api/servicios')).status).toBe(401);
  });

  it('A2 · una clave incorrecta no revela si el documento existe', async () => {
    const existe = await request(app).post('/api/auth/login').send({ documento: '2001', clave: 'mala' });
    const noExiste = await request(app).post('/api/auth/login').send({ documento: '0000', clave: 'mala' });
    expect(existe.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(existe.body.error).toBe(noExiste.body.error);
  });

  it('A3 · un token invalido se rechaza', async () => {
    const r = await request(app).get('/api/servicios').set('Authorization', 'Bearer inventado');
    expect(r.status).toBe(401);
  });
});

describe('D. Cada rol ve lo suyo', () => {
  it('D3 · el tecnico solo recibe sus servicios', async () => {
    const todos = await como(central)(request(app).get('/api/servicios'));
    const suyos = await como(tecnico)(request(app).get('/api/servicios'));
    expect(todos.body.length).toBeGreaterThan(suyos.body.length);
    const brahian = await prisma.tecnico.findUnique({ where: { documento: '3001' } });
    expect(suyos.body.every((s: { tecnico: { id: number } | null }) => s.tecnico?.id === brahian!.id)).toBe(true);
  });

  it('D3b · el cliente solo recibe los servicios de sus vehiculos', async () => {
    const suyos = await como(cliente)(request(app).get('/api/servicios'));
    const c = await prisma.cliente.findUnique({ where: { documento: '71234567' } });
    expect(suyos.body.length).toBeGreaterThan(0);
    expect(suyos.body.every((s: { cliente: { id: number } }) => s.cliente.id === c!.id)).toBe(true);
  });

  it('J1 · el tecnico no puede consultar los reportes', async () => {
    expect((await como(tecnico)(request(app).get('/api/reportes/indicadores'))).status).toBe(403);
  });

  it('J1b · el cliente tampoco', async () => {
    expect((await como(cliente)(request(app).get('/api/reportes/indicadores'))).status).toBe(403);
  });
});

describe('E. El cierre es exclusivo de la central', () => {
  it('J2 · el tecnico no puede cerrar, aunque llame la ruta directamente', async () => {
    const exp = await prisma.expediente.findFirst({ where: { cerradoEn: null } });
    const r = await como(tecnico)(request(app).post(`/api/expedientes/${exp!.id}/cerrar`));
    expect(r.status).toBe(403);
  });

  it('E3 · no se cierra un servicio que no este terminado', async () => {
    const exp = await prisma.expediente.findFirst({
      where: { cerradoEn: null, servicio: { estado: 'EN_EJECUCION' } },
    });
    const r = await como(central)(request(app).post(`/api/expedientes/${exp!.id}/cerrar`));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/terminado/i);
  });

  it('E5 · no se cierra un expediente sin evidencias', async () => {
    const servicio = await prisma.servicio.create({
      data: {
        estado: 'TERMINADO', direccion: 'Prueba sin evidencias', descripcion: 'Caso de prueba',
        clienteId: (await prisma.cliente.findFirstOrThrow()).id,
        vehiculoId: (await prisma.vehiculo.findFirstOrThrow()).id,
      },
    });
    const exp = await prisma.expediente.create({
      data: { consecutivo: `EXP-TEST-${Date.now()}`, servicioId: servicio.id },
    });
    const r = await como(central)(request(app).post(`/api/expedientes/${exp.id}/cerrar`));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/evidencias/i);
  });

  it('E4 · un expediente ya cerrado no se cierra dos veces', async () => {
    const exp = await prisma.expediente.findFirst({ where: { cerradoEn: { not: null } } });
    const r = await como(central)(request(app).post(`/api/expedientes/${exp!.id}/cerrar`));
    expect(r.status).toBe(409);
  });
});

describe('F. Evidencia posterior al cierre', () => {
  it('F2 · se acepta y queda marcada, no se rechaza', async () => {
    const exp = await prisma.expediente.findFirstOrThrow({ where: { cerradoEn: { not: null } } });
    const r = await como(tecnico)(
      request(app).post(`/api/expedientes/${exp.id}/evidencias`).send({
        idLocal: `test-tardia-${Date.now()}`, tipo: 'FOTO', archivo: 'evidencias/tardia.jpg',
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body.posteriorAlCierre).toBe(true);
  });

  it('G1 · la evidencia guarda quien la aporto', async () => {
    const exp = await prisma.expediente.findFirstOrThrow({ where: { cerradoEn: { not: null } } });
    const r = await como(cliente)(
      request(app).post(`/api/expedientes/${exp.id}/evidencias`).send({
        idLocal: `test-cliente-${Date.now()}`, tipo: 'FOTO', archivo: 'evidencias/cliente.jpg',
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body.subidaPor.rol).toBe('CLIENTE');
  });
});

describe('Trabajo sin senal: reintentos y orden', () => {
  it('el mismo idLocal no duplica la evidencia', async () => {
    const exp = await prisma.expediente.findFirstOrThrow();
    const idLocal = `test-reintento-${Date.now()}`;
    const cuerpo = { idLocal, tipo: 'FOTO', archivo: 'evidencias/reintento.jpg' };

    const primera = await como(tecnico)(request(app).post(`/api/expedientes/${exp.id}/evidencias`).send(cuerpo));
    const segunda = await como(tecnico)(request(app).post(`/api/expedientes/${exp.id}/evidencias`).send(cuerpo));
    const tercera = await como(tecnico)(request(app).post(`/api/expedientes/${exp.id}/evidencias`).send(cuerpo));

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200); // reconocida, no duplicada
    expect(tercera.status).toBe(200);
    expect(await prisma.evidencia.count({ where: { idLocal } })).toBe(1);
  });

  it('una actualizacion vieja que llega tarde no pisa el texto nuevo', async () => {
    const exp = await prisma.expediente.findFirstOrThrow({ where: { cerradoEn: null } });
    const base = exp.observacionesVersion;

    await como(tecnico)(request(app).patch(`/api/expedientes/${exp.id}/observaciones`)
      .send({ observaciones: 'version nueva', version: base + 2 }));
    // llega tarde un envio anterior
    await como(tecnico)(request(app).patch(`/api/expedientes/${exp.id}/observaciones`)
      .send({ observaciones: 'version vieja', version: base + 1 }));

    const final = await prisma.expediente.findUniqueOrThrow({ where: { id: exp.id } });
    expect(final.observaciones).toBe('version nueva');
  });
});

describe('H. Cancelacion', () => {
  it('H2 · cancelar sin motivo se rechaza', async () => {
    // se crea el servicio aqui para no depender del estado que dejen otras pruebas
    const s = await prisma.servicio.create({
      data: {
        estado: 'ASIGNADO', direccion: 'Prueba de cancelacion', descripcion: 'Caso de prueba',
        clienteId: (await prisma.cliente.findFirstOrThrow()).id,
        vehiculoId: (await prisma.vehiculo.findFirstOrThrow()).id,
      },
    });
    const sinMotivo = await como(central)(
      request(app).patch(`/api/servicios/${s.id}/cancelar`).send({ motivo: '' }),
    );
    expect(sinMotivo.status).toBe(400);

    // H3 · con motivo si se cancela y el motivo queda guardado
    const conMotivo = await como(central)(
      request(app).patch(`/api/servicios/${s.id}/cancelar`).send({ motivo: 'El cliente desistió' }),
    );
    expect(conMotivo.status).toBe(200);
    expect(conMotivo.body.estado).toBe('CANCELADO');
    expect(conMotivo.body.motivoCancelacion).toBe('El cliente desistió');
  });

  it('H4 · un servicio cerrado no se puede cancelar', async () => {
    const s = await prisma.servicio.findFirstOrThrow({ where: { estado: 'CERRADO' } });
    const r = await como(central)(
      request(app).patch(`/api/servicios/${s.id}/cancelar`).send({ motivo: 'intento indebido' }),
    );
    expect(r.status).toBe(409);
  });
});

describe('B. La solicitud del servicio', () => {
  it('B1 · el cliente solicita y el servicio queda a su nombre', async () => {
    const yo = await prisma.cliente.findUniqueOrThrow({ where: { documento: '71234567' } });
    const mio = await prisma.vehiculo.findFirstOrThrow({ where: { clienteId: yo.id } });
    const otro = await prisma.cliente.findFirstOrThrow({ where: { documento: { not: '71234567' } } });

    // se manda a proposito el id de OTRO cliente: el servidor debe ignorarlo
    const r = await como(cliente)(
      request(app).post('/api/servicios').send({
        clienteId: otro.id, vehiculoId: mio.id,
        direccion: 'Calle 50 con carrera 65', descripcion: 'El vehiculo no enciende',
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body.cliente.id).toBe(yo.id);
    expect(r.body.estado).toBe('SOLICITADO');
    expect(r.body.tipo).toBeNull();      // el tipo lo pone la central
    expect(r.body.tecnico).toBeNull();   // y el tecnico tambien
  });

  it('B2 · no se solicita con el vehiculo de otro cliente', async () => {
    const yo = await prisma.cliente.findUniqueOrThrow({ where: { documento: '71234567' } });
    const ajeno = await prisma.vehiculo.findFirstOrThrow({ where: { clienteId: { not: yo.id } } });
    const r = await como(cliente)(
      request(app).post('/api/servicios').send({
        vehiculoId: ajeno.id, direccion: 'Calle 50 con carrera 65', descripcion: 'Intento indebido',
      }),
    );
    expect(r.status).toBe(409);
  });

  it('B3 · el tecnico no solicita servicios: atiende los que le asignan', async () => {
    const v = await prisma.vehiculo.findFirstOrThrow();
    const r = await como(tecnico)(
      request(app).post('/api/servicios').send({
        clienteId: v.clienteId, vehiculoId: v.id,
        direccion: 'Calle 50 con carrera 65', descripcion: 'No deberia poder',
      }),
    );
    expect(r.status).toBe(403);
  });

  it('B4 · el cliente solo ve sus vehiculos, no los de los demas', async () => {
    const yo = await prisma.cliente.findUniqueOrThrow({ where: { documento: '71234567' } });
    const r = await como(cliente)(request(app).get('/api/vehiculos'));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.length).toBeLessThan(await prisma.vehiculo.count());
    expect(r.body.every((v: { cliente: { id: number } }) => v.cliente.id === yo.id)).toBe(true);
  });

  it('B6 · el cliente registra sus vehiculos hasta el tope, y el siguiente se rechaza', async () => {
    const yo = await prisma.cliente.findUniqueOrThrow({ where: { documento: '71234567' } });
    const otro = await prisma.cliente.findFirstOrThrow({ where: { documento: { not: '71234567' } } });
    const placaNueva = () => `TS${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const cuantos = () => prisma.vehiculo.count({ where: { clienteId: yo.id } });

    // la corrida anterior pudo dejar vehiculos: se registra solo lo que falte
    let registrado = await prisma.vehiculo.findFirstOrThrow({ where: { clienteId: yo.id } });
    while ((await cuantos()) < MAX_VEHICULOS_CLIENTE) {
      // otra vez se manda el id de OTRO dueño: el servidor debe ignorarlo
      const r = await como(cliente)(
        request(app).post('/api/vehiculos').send({
          placa: placaNueva(), marca: 'Renault', modelo: 'Sandero', color: 'Blanco', clienteId: otro.id,
        }),
      );
      expect(r.status).toBe(201);
      expect(r.body.clienteId).toBe(yo.id);
      registrado = r.body;
    }

    // con el tope alcanzado, el siguiente no entra
    const extra = await como(cliente)(
      request(app).post('/api/vehiculos').send({
        placa: placaNueva(), marca: 'Renault', modelo: 'Logan', color: 'Gris',
      }),
    );
    expect(extra.status).toBe(403);
    expect(await cuantos()).toBe(MAX_VEHICULOS_CLIENTE);

    // y los que ya tiene sirven para pedir un servicio
    const s = await como(cliente)(
      request(app).post('/api/servicios').send({
        vehiculoId: registrado.id, direccion: 'Avenida 33 con la 65',
        descripcion: 'Se varo el carro recien registrado',
      }),
    );
    expect(s.status).toBe(201);
    expect(s.body.vehiculo.id).toBe(registrado.id);
  });

  it('B7 · no se registran dos vehiculos con la misma placa', async () => {
    const existente = await prisma.vehiculo.findFirstOrThrow();
    const r = await como(central)(
      request(app).post('/api/vehiculos').send({
        placa: existente.placa, marca: 'Mazda', modelo: 'CX-5', color: 'Negro',
        clienteId: existente.clienteId,
      }),
    );
    expect(r.status).toBe(409);
  });

  it('B8 · el tecnico no registra vehiculos', async () => {
    const r = await como(tecnico)(
      request(app).post('/api/vehiculos').send({
        placa: 'ZZZ999', marca: 'Kia', modelo: 'Picanto', color: 'Rojo', clienteId: 1,
      }),
    );
    expect(r.status).toBe(403);
  });

  it('B5 · el directorio de clientes no lo ve el cliente ni el tecnico', async () => {
    expect((await como(cliente)(request(app).get('/api/clientes'))).status).toBe(403);
    expect((await como(tecnico)(request(app).get('/api/clientes'))).status).toBe(403);
  });
});

describe('C. Clasificacion y expediente', () => {
  it('C5 · al clasificar nace el expediente con consecutivo unico', async () => {
    const servicio = await prisma.servicio.create({
      data: {
        estado: 'SOLICITADO', direccion: 'Prueba de clasificacion', descripcion: 'Caso de prueba',
        clienteId: (await prisma.cliente.findFirstOrThrow()).id,
        vehiculoId: (await prisma.vehiculo.findFirstOrThrow()).id,
      },
    });
    const t = await prisma.tecnico.findFirstOrThrow({ where: { documento: '3001' } });

    const r = await como(central)(
      request(app).patch(`/api/servicios/${servicio.id}/clasificar`)
        .send({ tipo: 'CARRO_TALLER', tecnicoId: t.id }),
    );
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ASIGNADO');
    expect(r.body.expediente.consecutivo).toMatch(/^EXP-/);
  });

  it('el tecnico no puede clasificar ni asignar', async () => {
    const s = await prisma.servicio.findFirstOrThrow();
    const t = await prisma.tecnico.findFirstOrThrow();
    const r = await como(tecnico)(
      request(app).patch(`/api/servicios/${s.id}/clasificar`).send({ tipo: 'GRUA', tecnicoId: t.id }),
    );
    expect(r.status).toBe(403);
  });
});

describe('I. Modulos de consulta', () => {
  it('I4 · el historial por placa devuelve el expediente del vehiculo', async () => {
    const r = await como(central)(request(app).get('/api/reportes/historial?placa=ABC123'));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0].vehiculo.placa).toBe('ABC123');
  });

  it('I5 · el modulo de usuarios responde que aun no esta implementado', async () => {
    expect((await como(admin)(request(app).get('/api/usuarios'))).status).toBe(501);
  });

  it('el panel de indicadores cuadra con la base', async () => {
    const r = await como(central)(request(app).get('/api/reportes/indicadores'));
    expect(r.status).toBe(200);
    expect(r.body.expedientes).toBe(await prisma.expediente.count());
    expect(r.body.abiertos + r.body.cerrados).toBe(r.body.expedientes);
  });
});
