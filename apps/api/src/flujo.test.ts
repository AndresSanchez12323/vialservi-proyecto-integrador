/**
 * Pruebas del flujo nuevo: registro de cliente, recuperacion de clave,
 * estado derivado, verificacion de propietario, evidencias por formato,
 * notificaciones y tablero de asignacion.
 *
 * El hilo conductor es el recorrido real: el cliente se registra, registra su
 * vehiculo, pide el servicio, la central lo asigna, el tecnico verifica quien
 * entrega, sube evidencias y termina, y la central cierra.
 *
 * Requiere la base con los datos de demostracion: npm run db:seed
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { crearApp } from './app.js';
import { prisma } from './prisma.js';
import { calcularEstado } from './estado.js';
import { distanciaKm, estimarMinutos } from './geo.js';

const app = crearApp();

const entrar = async (documento: string, clave = 'VialServi2026') => {
  const r = await request(app).post('/api/auth/login').send({ documento, clave });
  expect(r.status).toBe(200);
  return r.body.token as string;
};

const como = (token: string) => (peticion: request.Test) =>
  peticion.set('Authorization', `Bearer ${token}`);

let contador = 0;
const unico = () => `${Date.now().toString().slice(-7)}${contador++}`;
const placaNueva = () => `T${unico()}`.slice(0, 8).toUpperCase();

let central = '';
let tecnico1 = '';
let tecnico2 = '';
let admin = '';

beforeAll(async () => {
  [central, tecnico1, tecnico2, admin] = await Promise.all([
    entrar('2001'), entrar('3001'), entrar('3002'), entrar('1001'),
  ]);
});

/** Registra un cliente nuevo por la ruta publica y devuelve su token. */
const registrarCliente = async () => {
  const documento = `9${unico()}`.slice(0, 12);
  const r = await request(app).post('/api/auth/registro').send({
    documento,
    nombre: 'Cliente Registrado',
    correo: `c${documento}@correo.com`,
    telefono: '3001112233',
    clave: 'ClaveSegura123',
  });
  expect(r.status).toBe(201);
  return { documento, token: r.body.token as string, usuario: r.body.usuario };
};

// ─────────────────────────────────────────────────────────────────────────
describe('R. Registro publico de cliente', () => {
  it('R1 · el registro crea la cuenta y su ficha de cliente, y entra de una vez', async () => {
    const { documento, token, usuario } = await registrarCliente();
    expect(usuario.rol).toBe('CLIENTE');

    const ficha = await prisma.cliente.findUnique({ where: { documento } });
    expect(ficha).not.toBeNull();
    expect(ficha!.usuarioId).not.toBeNull();

    // El token que devuelve el registro ya sirve: no hay que iniciar sesion.
    const mio = await como(token)(request(app).get('/api/clientes/yo'));
    expect(mio.status).toBe(200);
    expect(mio.body.documento).toBe(documento);
  });

  it('R2 · el registro publico NO permite elegir rol: siempre queda cliente', async () => {
    const documento = `9${unico()}`.slice(0, 12);
    const r = await request(app).post('/api/auth/registro').send({
      documento,
      nombre: 'Intento de central',
      correo: `x${documento}@correo.com`,
      telefono: '3001112233',
      clave: 'ClaveSegura123',
      rol: 'CENTRAL', // se manda a proposito y debe ignorarse
    });
    expect(r.status).toBe(201);
    expect(r.body.usuario.rol).toBe('CLIENTE');

    const creado = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    expect(creado.rol).toBe('CLIENTE');
  });

  it('R3 · no se registran dos cuentas con el mismo documento ni con el mismo correo', async () => {
    const { documento } = await registrarCliente();

    const mismoDocumento = await request(app).post('/api/auth/registro').send({
      documento, nombre: 'Otro', correo: `otro${unico()}@correo.com`,
      telefono: '3001112233', clave: 'ClaveSegura123',
    });
    expect(mismoDocumento.status).toBe(409);
    expect(mismoDocumento.body.error).toMatch(/documento/i);

    const correoRepetido = (await prisma.usuario.findUniqueOrThrow({ where: { documento } })).correo;
    const mismoCorreo = await request(app).post('/api/auth/registro').send({
      documento: `9${unico()}`.slice(0, 12), nombre: 'Otro', correo: correoRepetido,
      telefono: '3001112233', clave: 'ClaveSegura123',
    });
    expect(mismoCorreo.status).toBe(409);
    expect(mismoCorreo.body.error).toMatch(/correo/i);
  });

  it('R4 · una clave corta se rechaza', async () => {
    const r = await request(app).post('/api/auth/registro').send({
      documento: `9${unico()}`.slice(0, 12), nombre: 'Clave corta',
      correo: `k${unico()}@correo.com`, telefono: '3001112233', clave: '123',
    });
    expect(r.status).toBe(400);
  });

  it('R5 · si la central ya tenia ficha con ese documento, la cuenta se enlaza y no se duplica', async () => {
    const documento = `9${unico()}`.slice(0, 12);
    // La central lo habia registrado por telefono, sin cuenta.
    const previa = await prisma.cliente.create({
      data: { documento, nombre: 'Registrado por la central', telefono: '3004445566' },
    });
    const vehiculo = await prisma.vehiculo.create({
      data: { placa: placaNueva(), marca: 'Mazda', modelo: '3', color: 'Gris', clienteId: previa.id },
    });

    const r = await request(app).post('/api/auth/registro').send({
      documento, nombre: 'Registrado por la central',
      correo: `e${documento}@correo.com`, telefono: '3004445566', clave: 'ClaveSegura123',
    });
    expect(r.status).toBe(201);
    expect(r.body.enlazadoAFichaExistente).toBe(true);

    // No se creo un cliente nuevo con la misma cedula...
    expect(await prisma.cliente.count({ where: { documento } })).toBe(1);
    // ...y conserva el vehiculo que ya tenia.
    const mios = await como(r.body.token)(request(app).get('/api/vehiculos'));
    expect(mios.body.map((v: { id: number }) => v.id)).toContain(vehiculo.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('P. Recuperacion de clave', () => {
  /** Siembra un codigo conocido, como si el correo ya hubiera llegado. */
  const sembrarCodigo = async (usuarioId: number, codigo: string, minutos = 15) =>
    prisma.recuperacionClave.create({
      data: {
        usuarioId,
        codigo: await bcrypt.hash(codigo, 10),
        expiraEn: new Date(Date.now() + minutos * 60_000),
      },
    });

  it('P1 · pedir el codigo con un documento inexistente responde igual que con uno real', async () => {
    const real = await request(app).post('/api/auth/recuperar').send({ documento: '2001' });
    const falso = await request(app).post('/api/auth/recuperar').send({ documento: '000000000' });
    expect(real.status).toBe(200);
    expect(falso.status).toBe(200);
    // Si las respuestas difirieran, esta ruta serviria para averiguar que
    // cedulas tienen cuenta.
    expect(real.body.mensaje).toBe(falso.body.mensaje);
  });

  it('P2 · con el codigo correcto se cambia la clave y se puede entrar con la nueva', async () => {
    const { documento } = await registrarCliente();
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    await sembrarCodigo(usuario.id, '654321');

    const r = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '654321', nuevaClave: 'OtraClave456',
    });
    expect(r.status).toBe(200);

    // La nueva sirve y la anterior ya no.
    await entrar(documento, 'OtraClave456');
    const vieja = await request(app).post('/api/auth/login').send({ documento, clave: 'ClaveSegura123' });
    expect(vieja.status).toBe(401);
  });

  it('P3 · el codigo es de un solo uso', async () => {
    const { documento } = await registrarCliente();
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    await sembrarCodigo(usuario.id, '111222');

    const primera = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '111222', nuevaClave: 'ClaveNueva111',
    });
    expect(primera.status).toBe(200);

    const segunda = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '111222', nuevaClave: 'ClaveNueva222',
    });
    expect(segunda.status).toBe(400);
  });

  it('P4 · un codigo vencido no sirve', async () => {
    const { documento } = await registrarCliente();
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    await sembrarCodigo(usuario.id, '999888', -1); // vencio hace un minuto

    const r = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '999888', nuevaClave: 'ClaveNueva333',
    });
    expect(r.status).toBe(400);
  });

  it('P5 · pedir un codigo nuevo invalida el anterior', async () => {
    const { documento } = await registrarCliente();
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    await sembrarCodigo(usuario.id, '555666');

    // Al pedir otro, el de arriba debe quedar inutilizable.
    await request(app).post('/api/auth/recuperar').send({ documento });

    const r = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '555666', nuevaClave: 'ClaveNueva444',
    });
    expect(r.status).toBe(400);
  });

  it('P6 · tras varios intentos fallidos el codigo se bloquea', async () => {
    const { documento } = await registrarCliente();
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { documento } });
    await sembrarCodigo(usuario.id, '777777');

    for (let i = 0; i < 5; i++) {
      const fallo = await request(app).post('/api/auth/recuperar/confirmar').send({
        documento, codigo: '000000', nuevaClave: 'ClaveNueva555',
      });
      expect(fallo.status).toBe(400);
    }
    // Sexto intento: ya no se admite, ni con el codigo correcto.
    const bloqueado = await request(app).post('/api/auth/recuperar/confirmar').send({
      documento, codigo: '777777', nuevaClave: 'ClaveNueva555',
    });
    expect(bloqueado.status).toBe(429);
  });

  it('P7 · el cambio de clave con sesion abierta exige la clave actual', async () => {
    const { documento, token } = await registrarCliente();

    const sinSaberla = await como(token)(
      request(app).post('/api/auth/clave').send({ actual: 'equivocada', nueva: 'ClaveNueva666' }),
    );
    expect(sinSaberla.status).toBe(400);

    const bien = await como(token)(
      request(app).post('/api/auth/clave').send({ actual: 'ClaveSegura123', nueva: 'ClaveNueva666' }),
    );
    expect(bien.status).toBe(200);
    await entrar(documento, 'ClaveNueva666');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D. El estado se deriva de las marcas de cada rol', () => {
  it('D1 · calcularEstado respeta la precedencia sin tocar la base', () => {
    const base = {
      tecnicoId: null, asignadoEn: null, iniciadoEn: null, terminadoEn: null,
      canceladoEn: null, rechazadoEn: null, expediente: null,
    };
    const ahora = new Date();
    expect(calcularEstado(base)).toBe('SOLICITADO');
    expect(calcularEstado({ ...base, tecnicoId: 1, asignadoEn: ahora })).toBe('ASIGNADO');
    expect(calcularEstado({ ...base, tecnicoId: 1, asignadoEn: ahora, iniciadoEn: ahora })).toBe('EN_EJECUCION');
    expect(calcularEstado({ ...base, tecnicoId: 1, asignadoEn: ahora, iniciadoEn: ahora, terminadoEn: ahora })).toBe('TERMINADO');
    expect(calcularEstado({ ...base, terminadoEn: ahora, expediente: { cerradoEn: ahora } })).toBe('CERRADO');
    // Lo que la central decide gana sobre el avance del tecnico.
    expect(calcularEstado({ ...base, terminadoEn: ahora, canceladoEn: ahora })).toBe('CANCELADO');
    expect(calcularEstado({ ...base, terminadoEn: ahora, canceladoEn: ahora, rechazadoEn: ahora })).toBe('RECHAZADO');
  });

  it('D2 · una cancelacion de la central no la deshace un avance tardio del tecnico', async () => {
    // Este es el caso que justifica todo el diseno: sin campos separados, el
    // envio del tecnico que llega tarde reviviria un servicio cancelado.
    const { servicioId } = await servicioAsignado();

    await como(central)(
      request(app).patch(`/api/servicios/${servicioId}/cancelar`).send({ motivo: 'El cliente desistio' }),
    );

    // El tecnico, que venia sin senal, intenta avanzar despues.
    const tardio = await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'EN_EJECUCION' }),
    );
    expect(tardio.status).toBe(409);

    const final = await prisma.servicio.findUniqueOrThrow({ where: { id: servicioId } });
    expect(final.estado).toBe('CANCELADO');
    // Y la marca de la central sigue intacta.
    expect(final.canceladoEn).not.toBeNull();
  });

  it('D3 · no se inicia un servicio sin asignar ni se termina uno sin iniciar', async () => {
    const { servicioId } = await servicioSolicitado();
    const sinAsignar = await como(central)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'EN_EJECUCION' }),
    );
    expect(sinAsignar.status).toBe(409);

    const { servicioId: otro } = await servicioAsignado();
    const sinIniciar = await como(tecnico1)(
      request(app).patch(`/api/servicios/${otro}/estado`).send({ estado: 'TERMINADO' }),
    );
    expect(sinIniciar.status).toBe(409);
  });

  it('D4 · solo se rechaza una solicitud que aun no se asigno', async () => {
    const { servicioId } = await servicioSolicitado();
    const ok = await como(central)(
      request(app).patch(`/api/servicios/${servicioId}/rechazar`).send({ motivo: 'Fuera de cobertura' }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.estado).toBe('RECHAZADO');

    const { servicioId: asignado } = await servicioAsignado();
    const tarde = await como(central)(
      request(app).patch(`/api/servicios/${asignado}/rechazar`).send({ motivo: 'Ya no se puede' }),
    );
    expect(tarde.status).toBe(409);
  });

  it('D5 · el rechazo exige motivo', async () => {
    const { servicioId } = await servicioSolicitado();
    const r = await como(central)(
      request(app).patch(`/api/servicios/${servicioId}/rechazar`).send({ motivo: '' }),
    );
    expect(r.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('V. Verificacion de quien entrega el vehiculo', () => {
  it('V1 · no se puede terminar sin registrar si quien entrega es el propietario', async () => {
    const { servicioId } = await servicioEnEjecucion();
    const r = await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/propietario/i);
  });

  it('V2 · si NO es el propietario se exigen nombre y documento de quien entrega', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const incompleta = await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: false, version: 1,
      }),
    );
    expect(incompleta.status).toBe(400);
    expect(incompleta.body.error).toMatch(/documento/i);
  });

  it('V3 · si NO es el propietario no se termina sin la foto de la cedula con la firma', async () => {
    const { servicioId, expedienteId } = await servicioEnEjecucion();

    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: false, version: 1,
        solicitanteNombre: 'Laura Gomez', solicitanteDocumento: '1017554321',
        solicitanteRelacion: 'Hija del propietario',
      }),
    );

    // Hay evidencia, pero no la de la firma: no alcanza.
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    const sinFirma = await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );
    expect(sinFirma.status).toBe(409);
    expect(sinFirma.body.error).toMatch(/firma/i);

    // Con la firma si se puede.
    await subirEvidencia(tecnico1, expedienteId, 'FIRMA_CEDULA');
    const conFirma = await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );
    expect(conFirma.status).toBe(200);
    expect(conFirma.body.estado).toBe('TERMINADO');
  });

  it('V4 · el cliente NO puede aportar la foto de la firma: es soporte del tecnico', async () => {
    const { expedienteId, clienteToken } = await servicioEnEjecucion({ conCuentaCliente: true });
    const r = await como(clienteToken!)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias`).send({
        idLocal: `ev-${unico()}`, tipo: 'FOTO', categoria: 'FIRMA_CEDULA',
        archivo: 'evidencias/falsa.jpg',
      }),
    );
    expect(r.status).toBe(403);

    // Una foto normal si la puede subir.
    const normal = await como(clienteToken!)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias`).send({
        idLocal: `ev-${unico()}`, tipo: 'FOTO', categoria: 'GENERAL',
        archivo: 'evidencias/mia.jpg',
      }),
    );
    expect(normal.status).toBe(201);
    expect(normal.body.subidaPor.rol).toBe('CLIENTE');
  });

  it('V5 · marcar que SI es propietario borra los datos del tercero', async () => {
    const { expedienteId } = await servicioEnEjecucion();

    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: false, version: 1,
        solicitanteNombre: 'Laura Gomez', solicitanteDocumento: '1017554321',
      }),
    );
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: true, version: 2,
      }),
    );

    const exp = await prisma.expediente.findUniqueOrThrow({ where: { id: expedienteId } });
    expect(exp.esPropietario).toBe(true);
    // Si quedaran, el expediente diria que hubo una autorizacion que ya no aplica.
    expect(exp.solicitanteNombre).toBeNull();
    expect(exp.solicitanteDocumento).toBeNull();
  });

  it('V6 · la verificacion tambien descarta un envio viejo que llega tarde', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: true, version: 5,
      }),
    );
    const tardio = await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: false, version: 2,
        solicitanteNombre: 'Alguien', solicitanteDocumento: '123456789',
      }),
    );
    expect(tardio.body.descartado).toBe(true);
    const exp = await prisma.expediente.findUniqueOrThrow({ where: { id: expedienteId } });
    expect(exp.esPropietario).toBe(true);
  });

  it('V7 · el tecnico completa los datos de la licencia de transito del vehiculo', async () => {
    const { expedienteId, vehiculoId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: true, version: 1,
        vehiculo: { vin: '9GAJC5220RB099999', licenciaTransito: '55667788', clase: 'Automóvil' },
      }),
    );
    const v = await prisma.vehiculo.findUniqueOrThrow({ where: { id: vehiculoId } });
    expect(v.vin).toBe('9GAJC5220RB099999');
    expect(v.licenciaTransito).toBe('55667788');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F. El cierre se mide contra el formato del tipo de servicio', () => {
  it('F1 · falta la evidencia de entrega: no cierra y dice que falta', async () => {
    const { servicioId, expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({ esPropietario: true, version: 1 }),
    );
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );

    const r = await como(central)(request(app).post(`/api/expedientes/${expedienteId}/cerrar`));
    expect(r.status).toBe(409);
    expect(r.body.avisos.join(' ')).toMatch(/entregar/i);
  });

  it('F2 · con el juego completo del formato, cierra y el servicio queda CERRADO', async () => {
    const { servicioId, expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({ esPropietario: true, version: 1 }),
    );
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    await subirEvidencia(tecnico1, expedienteId, 'ENTREGA');
    await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );

    const r = await como(central)(request(app).post(`/api/expedientes/${expedienteId}/cerrar`));
    expect(r.status).toBe(200);

    const s = await prisma.servicio.findUniqueOrThrow({ where: { id: servicioId } });
    expect(s.estado).toBe('CERRADO'); // derivado del cierre del expediente
  });

  it('F3 · el expediente informa sus pendientes para que el tecnico los vea', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const r = await como(tecnico1)(request(app).get(`/api/expedientes/${expedienteId}`));
    expect(r.status).toBe(200);
    expect(r.body.control.listoParaCerrar).toBe(false);
    expect(r.body.control.avisos.length).toBeGreaterThan(0);
    // Y trae el formato con el que se diligencia, con su version sellada.
    expect(r.body.formato.tipo).toBe('CARRO_TALLER');
    expect(r.body.formatoVersion).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('N. Notificaciones', () => {
  it('N1 · la solicitud del cliente le llega a la central', async () => {
    const antes = await noLeidas(central);
    await servicioSolicitado();
    expect(await noLeidas(central)).toBeGreaterThan(antes);

    const bandeja = await como(central)(request(app).get('/api/notificaciones?noLeidas=true'));
    expect(bandeja.body.lista[0].tipo).toBe('SERVICIO_SOLICITADO');
  });

  it('N2 · al asignar, se avisa al tecnico y al cliente', async () => {
    const antesTecnico = await noLeidas(tecnico1);
    const { clienteToken } = await servicioAsignado({ conCuentaCliente: true });

    expect(await noLeidas(tecnico1)).toBeGreaterThan(antesTecnico);
    const delCliente = await como(clienteToken!)(request(app).get('/api/notificaciones'));
    expect(delCliente.body.lista.some((n: { tipo: string }) => n.tipo === 'SERVICIO_ASIGNADO')).toBe(true);
  });

  it('N3 · cuando el tecnico termina, la central recibe el aviso para cerrar', async () => {
    const antes = await noLeidas(central);
    const { servicioId, expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({ esPropietario: true, version: 1 }),
    );
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );

    expect(await noLeidas(central)).toBeGreaterThan(antes);
    const bandeja = await como(central)(request(app).get('/api/notificaciones?noLeidas=true'));
    expect(bandeja.body.lista.some((n: { tipo: string }) => n.tipo === 'SERVICIO_TERMINADO')).toBe(true);
  });

  it('N4 · si quien entrega no es el propietario, la central se entera', async () => {
    const antes = await noLeidas(central);
    const { expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({
        esPropietario: false, version: 1,
        solicitanteNombre: 'Tercero Autorizado', solicitanteDocumento: '1012223334',
      }),
    );
    expect(await noLeidas(central)).toBeGreaterThan(antes);
    const bandeja = await como(central)(request(app).get('/api/notificaciones?noLeidas=true'));
    expect(bandeja.body.lista[0].tipo).toBe('VERIFICACION_NO_PROPIETARIO');
  });

  it('N5 · cada quien ve solo su bandeja y solo marca la suya', async () => {
    const mias = await como(tecnico1)(request(app).get('/api/notificaciones'));
    const ajena = mias.body.lista[0];
    if (ajena) {
      // El tecnico2 intenta marcar una notificacion del tecnico1.
      const r = await como(tecnico2)(request(app).patch(`/api/notificaciones/${ajena.id}/leida`));
      expect(r.status).toBe(404); // no se revela que existe
    }

    const todas = await como(tecnico1)(request(app).patch('/api/notificaciones/leidas'));
    expect(todas.status).toBe(200);
    expect(await noLeidas(tecnico1)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('M. Mapa, cercania y tiempo estimado', () => {
  it('M1 · la distancia y el tiempo se calculan sin servicios externos', () => {
    // Centro de Medellin -> El Poblado: unos 4-5 km en linea recta.
    const centro = { lat: 6.2518, lng: -75.5636 };
    const poblado = { lat: 6.2095, lng: -75.5700 };
    const km = distanciaKm(centro, poblado);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(8);
    // Nadie llega en cero minutos.
    expect(estimarMinutos(centro, poblado)).toBeGreaterThanOrEqual(5);
  });

  it('M2 · el tablero ordena por cercania y marca quien tiene la especialidad', async () => {
    const { servicioId } = await servicioSolicitado({ tipoSolicitado: 'GRUA' });
    const r = await como(central)(request(app).get(`/api/tecnicos/tablero?servicioId=${servicioId}`));
    expect(r.status).toBe(200);
    expect(r.body.especialidadRequerida).toBe('GRUA');

    // El primero debe poder hacer el trabajo: de nada sirve el mas cercano si
    // no esta habilitado para operar una grua.
    expect(r.body.tecnicos[0].apto).toBe(true);
    const aptos = r.body.tecnicos.filter((t: { apto: boolean }) => t.apto);
    expect(aptos.length).toBeGreaterThan(0);
  });

  it('M3 · el tiempo que informa el tecnico manda sobre la estimacion', async () => {
    const { servicioId } = await servicioAsignado();
    const r = await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/eta`).send({ minutos: 7, lat: 6.25, lng: -75.56 }),
    );
    expect(r.status).toBe(200);
    expect(r.body.seguimiento.minutosEstimados).toBe(7);
    expect(r.body.seguimiento.origenDelTiempo).toBe('tecnico');
  });

  it('M4 · el tecnico reporta su ubicacion y queda con hora', async () => {
    const r = await como(tecnico1)(
      request(app).patch('/api/tecnicos/yo/ubicacion').send({ lat: 6.2431, lng: -75.5756 }),
    );
    expect(r.status).toBe(200);
    expect(r.body.lat).toBeCloseTo(6.2431, 3);
    expect(r.body.ubicacionEn).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('S. Permisos sobre el detalle, no solo sobre la lista', () => {
  it('S1 · un cliente no puede abrir el servicio de otro cambiando el id', async () => {
    const { token } = await registrarCliente();
    const ajeno = await prisma.servicio.findFirstOrThrow();
    const r = await como(token)(request(app).get(`/api/servicios/${ajeno.id}`));
    expect(r.status).toBe(403);
  });

  it('S2 · un cliente no puede abrir el expediente de otro', async () => {
    const { token } = await registrarCliente();
    const ajeno = await prisma.expediente.findFirstOrThrow();
    const r = await como(token)(request(app).get(`/api/expedientes/${ajeno.id}`));
    expect(r.status).toBe(403);
  });

  it('S3 · un tecnico no avanza un servicio que no es suyo', async () => {
    const { servicioId } = await servicioAsignado(); // asignado al tecnico 3001
    const r = await como(tecnico2)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'EN_EJECUCION' }),
    );
    expect(r.status).toBe(403);
  });

  it('S4 · el tablero de asignacion no lo ve el tecnico', async () => {
    const r = await como(tecnico1)(request(app).get('/api/tecnicos/tablero'));
    expect(r.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('X. Casos de borde del dia a dia', () => {
  it('X1 · el mismo vehiculo no puede tener dos servicios abiertos a la vez', async () => {
    const { token, documento } = await registrarCliente();
    const ficha = await prisma.cliente.findUniqueOrThrow({ where: { documento } });
    const v = await prisma.vehiculo.create({
      data: { placa: placaNueva(), marca: 'Kia', modelo: 'Picanto', color: 'Rojo', clienteId: ficha.id },
    });

    const cuerpo = {
      vehiculoId: v.id, direccion: 'Calle 50 con carrera 65',
      descripcion: 'No enciende el vehiculo',
    };
    const primero = await como(token)(request(app).post('/api/servicios').send(cuerpo));
    expect(primero.status).toBe(201);

    // Doble clic, o cliente impaciente: mandar dos gruas al mismo sitio es
    // peor que pedirle que espere.
    const segundo = await como(token)(request(app).post('/api/servicios').send(cuerpo));
    expect(segundo.status).toBe(409);
    expect(segundo.body.error).toMatch(/en curso/i);
  });

  it('X2 · no se asigna un tecnico sin la especialidad del tipo de servicio', async () => {
    const { servicioId } = await servicioSolicitado();
    // El tecnico 3001 es MECANICA,CERRAJERIA: no puede operar una grua.
    const t = await prisma.tecnico.findFirstOrThrow({ where: { documento: '3001' } });
    const r = await como(central)(
      request(app).patch(`/api/servicios/${servicioId}/clasificar`).send({ tipo: 'GRUA', tecnicoId: t.id }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/especialidad/i);
  });

  it('X3 · al clasificar se sella la version del formato en el expediente', async () => {
    const { expedienteId } = await servicioAsignado();
    const exp = await prisma.expediente.findUniqueOrThrow({ where: { id: expedienteId } });
    expect(exp.formatoTipo).toBe('CARRO_TALLER');
    expect(exp.formatoVersion).toBe(1);
  });

  it('X4 · si el cliente no da coordenadas, el servicio se crea igual', async () => {
    // Negar el permiso de ubicacion no puede dejar a nadie sin poder pedir
    // ayuda: se pierde el mapa, no el servicio.
    const { servicioId } = await servicioSolicitado({ sinCoordenadas: true });
    const s = await prisma.servicio.findUniqueOrThrow({ where: { id: servicioId } });
    expect(s.lat).toBeNull();
    expect(s.estado).toBe('SOLICITADO');
  });

  it('X5 · el telefono de contacto se toma de la ficha si no lo informan', async () => {
    const { servicioId } = await servicioSolicitado();
    const s = await prisma.servicio.findUniqueOrThrow({
      where: { id: servicioId },
      include: { cliente: true },
    });
    expect(s.contactoTelefono).toBe(s.cliente.telefono);
  });

  it('X6 · una evidencia que llega despues del cierre se guarda marcada', async () => {
    const { servicioId, expedienteId } = await servicioEnEjecucion();
    await como(tecnico1)(
      request(app).patch(`/api/expedientes/${expedienteId}/verificacion`).send({ esPropietario: true, version: 1 }),
    );
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    await subirEvidencia(tecnico1, expedienteId, 'ENTREGA');
    await como(tecnico1)(
      request(app).patch(`/api/servicios/${servicioId}/estado`).send({ estado: 'TERMINADO' }),
    );
    await como(central)(request(app).post(`/api/expedientes/${expedienteId}/cerrar`));

    const tardia = await subirEvidencia(tecnico1, expedienteId, 'GENERAL');
    expect(tardia.status).toBe(201);
    expect(tardia.body.posteriorAlCierre).toBe(true);
  });

  it('X7 · el administrador tambien puede operar como central', async () => {
    const { servicioId } = await servicioSolicitado();
    const t = await prisma.tecnico.findFirstOrThrow({ where: { documento: '3001' } });
    const r = await como(admin)(
      request(app).patch(`/api/servicios/${servicioId}/clasificar`).send({ tipo: 'CARRO_TALLER', tecnicoId: t.id }),
    );
    expect(r.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('A. Subida de evidencias a S3', () => {
  it('A1 · la clave se deriva del idLocal: reintentar sobreescribe, no duplica', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const cuerpo = {
      idLocal: `loc-${unico()}`, tipo: 'FOTO', categoria: 'RECEPCION',
      contentType: 'image/jpeg', tamano: 1024,
    };

    const primera = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send(cuerpo),
    );
    const segunda = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send(cuerpo),
    );
    expect(primera.status).toBe(200);
    // Misma clave: el reintento del buzon sin senal escribe sobre el mismo
    // objeto en vez de dejar copias huerfanas en el bucket.
    expect(segunda.body.clave).toBe(primera.body.clave);
    expect(primera.body.clave).toContain(cuerpo.idLocal);
  });

  it('A2 · la extension sale del tipo real del archivo', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const png = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send({
        idLocal: `loc-${unico()}`, tipo: 'FOTO', categoria: 'RECEPCION',
        contentType: 'image/png', tamano: 2048,
      }),
    );
    expect(png.body.clave).toMatch(/\.png$/);
  });

  it('A3 · una foto que pasa el limite de 5 MB se rechaza', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const r = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send({
        idLocal: `loc-${unico()}`, tipo: 'FOTO', categoria: 'RECEPCION',
        contentType: 'image/jpeg', tamano: 6 * 1024 * 1024,
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/5 MB/);
  });

  it('A4 · un video que pasa el limite de 15 MB se rechaza', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const r = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send({
        idLocal: `loc-${unico()}`, tipo: 'VIDEO', categoria: 'ENTREGA',
        contentType: 'video/mp4', tamano: 20 * 1024 * 1024,
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/15 MB/);
  });

  it('A5 · un formato que no es imagen ni video se rechaza', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    const r = await como(tecnico1)(
      request(app).post(`/api/expedientes/${expedienteId}/evidencias/url-subida`).send({
        idLocal: `loc-${unico()}`, tipo: 'FOTO', categoria: 'DOCUMENTO',
        contentType: 'application/pdf', tamano: 1024,
      }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Formato no admitido/i);
  });

  it('A6 · la URL de lectura exige permiso sobre ese expediente', async () => {
    const { expedienteId } = await servicioEnEjecucion();
    await subirEvidencia(tecnico1, expedienteId, 'RECEPCION');
    const ev = await prisma.evidencia.findFirstOrThrow({ where: { expedienteId } });

    const propio = await como(tecnico1)(
      request(app).get(`/api/expedientes/${expedienteId}/evidencias/${ev.id}/url`),
    );
    expect(propio.status).toBe(200);
    expect(propio.body.clave).toBe(ev.archivo);

    // El tecnico2 no atiende ese servicio.
    const ajeno = await como(tecnico2)(
      request(app).get(`/api/expedientes/${expedienteId}/evidencias/${ev.id}/url`),
    );
    expect(ajeno.status).toBe(403);
  });

  it('A7 · no se puede pedir la URL de una evidencia de otro expediente', async () => {
    const a = await servicioEnEjecucion();
    const b = await servicioEnEjecucion();
    await subirEvidencia(tecnico1, b.expedienteId, 'RECEPCION');
    const deB = await prisma.evidencia.findFirstOrThrow({ where: { expedienteId: b.expedienteId } });

    // Se pide con el id del expediente A una evidencia que es de B.
    const r = await como(tecnico1)(
      request(app).get(`/api/expedientes/${a.expedienteId}/evidencias/${deB.id}/url`),
    );
    expect(r.status).toBe(404);
  });
});

// ── Ayudantes del recorrido ──────────────────────────────────────────────
// Construyen el servicio por las RUTAS del API y no escribiendo en la base,
// de modo que cada prueba recorre el mismo camino que la aplicacion real.

const noLeidas = async (token: string) => {
  const r = await como(token)(request(app).get('/api/notificaciones?noLeidas=true'));
  return r.body.sinLeer as number;
};

const subirEvidencia = (token: string, expedienteId: number, categoria: string) =>
  como(token)(
    request(app).post(`/api/expedientes/${expedienteId}/evidencias`).send({
      idLocal: `ev-${unico()}`,
      tipo: 'FOTO',
      categoria,
      archivo: `evidencias/${categoria.toLowerCase()}-${unico()}.jpg`,
    }),
  );

type Opciones = {
  conCuentaCliente?: boolean;
  tipoSolicitado?: string;
  sinCoordenadas?: boolean;
};

/** Cliente con cuenta, vehiculo propio y servicio solicitado por el API. */
const servicioSolicitado = async (opciones: Opciones = {}) => {
  const { documento, token } = await registrarCliente();
  const ficha = await prisma.cliente.findUniqueOrThrow({ where: { documento } });
  const vehiculo = await prisma.vehiculo.create({
    data: { placa: placaNueva(), marca: 'Chevrolet', modelo: 'Onix', color: 'Blanco', clienteId: ficha.id },
  });

  const r = await como(token)(
    request(app).post('/api/servicios').send({
      vehiculoId: vehiculo.id,
      tipoSolicitado: opciones.tipoSolicitado ?? 'CARRO_TALLER',
      direccion: 'Carrera 70 con Colombia, Medellin',
      descripcion: 'El vehiculo no enciende y esta sobre la via',
      ...(opciones.sinCoordenadas ? {} : { lat: 6.2550, lng: -75.5900 }),
    }),
  );
  expect(r.status).toBe(201);

  return {
    servicioId: r.body.id as number,
    vehiculoId: vehiculo.id,
    clienteToken: opciones.conCuentaCliente ? token : undefined,
  };
};

/** Lo anterior, ya clasificado y asignado al tecnico 3001 por la central. */
const servicioAsignado = async (opciones: Opciones = {}) => {
  const base = await servicioSolicitado(opciones);
  const t = await prisma.tecnico.findFirstOrThrow({ where: { documento: '3001' } });

  const r = await como(central)(
    request(app).patch(`/api/servicios/${base.servicioId}/clasificar`).send({
      tipo: 'CARRO_TALLER', tecnicoId: t.id,
    }),
  );
  expect(r.status).toBe(200);
  return { ...base, expedienteId: r.body.expediente.id as number };
};

/** Lo anterior, con el tecnico ya en el sitio. */
const servicioEnEjecucion = async (opciones: Opciones = {}) => {
  const base = await servicioAsignado(opciones);
  const r = await como(tecnico1)(
    request(app).patch(`/api/servicios/${base.servicioId}/estado`).send({ estado: 'EN_EJECUCION' }),
  );
  expect(r.status).toBe(200);
  return base;
};
