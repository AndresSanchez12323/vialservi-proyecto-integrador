/**
 * Datos de demostracion. Alcanzan para ver los modulos funcionando y para
 * mostrar servicios en distintos estados, sin simular una empresa en
 * operacion desde hace anos.
 *
 * Las coordenadas son reales de Medellin y el Valle de Aburra: con ellas el
 * mapa y el calculo de cercania se pueden ver funcionando de verdad, no con
 * puntos inventados en medio del mar.
 *
 * El `estado` de cada servicio NO se escribe a mano: se calcula con
 * calcularEstado a partir de las marcas de tiempo, igual que en produccion.
 * Asi los datos de demostracion nunca quedan en un estado imposible.
 */
import bcrypt from 'bcryptjs';
import {
  PrismaClient, Rol, TipoServicio, TipoEvidencia, CategoriaEvidencia,
} from '@prisma/client';
import { calcularEstado } from '../src/estado.js';
import { sincronizarSecuencia } from '../src/consecutivo.js';

const prisma = new PrismaClient();

const hace = (horas: number) => new Date(Date.now() - horas * 3600_000);
const haceMin = (minutos: number) => new Date(Date.now() - minutos * 60_000);

async function main() {
  // El orden importa: primero lo que apunta a otros.
  await prisma.notificacion.deleteMany();
  await prisma.evidencia.deleteMany();
  await prisma.novedad.deleteMany();
  await prisma.objetoInventario.deleteMany();
  await prisma.expediente.deleteMany();
  await prisma.servicio.deleteMany();
  await prisma.vehiculo.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.tecnico.deleteMany();
  await prisma.recuperacionClave.deleteMany();
  await prisma.usuario.deleteMany();

  const clave = await bcrypt.hash('VialServi2026', 10);
  const u = (documento: string, nombre: string, correo: string, rol: Rol) =>
    prisma.usuario.create({ data: { documento, nombre, correo, clave, rol } });

  const admin = await u('1001', 'Edwin Sánchez', 'admin@vialservi.co', Rol.ADMINISTRADOR);
  const central = await u('2001', 'Central de Operaciones', 'central@vialservi.co', Rol.CENTRAL);
  const uTec1 = await u('3001', 'Brahian Rendón', 'brahian@vialservi.co', Rol.TECNICO);
  const uTec2 = await u('3002', 'Juan Pablo Vásquez', 'juanpa@vialservi.co', Rol.TECNICO);
  const uCli = await u('71234567', 'Santiago Gómez', 'santiago@correo.com', Rol.CLIENTE);

  // Ubicaciones de los tecnicos repartidas por el area metropolitana, para que
  // la cercania al servicio de la demostracion de resultados distintos.
  const tec1 = await prisma.tecnico.create({
    data: {
      documento: '3001', nombre: 'Brahian Rendón', telefono: '3001234567',
      especialidades: 'MECANICA,CERRAJERIA', licencia: 'B1', usuarioId: uTec1.id,
      lat: 6.2518, lng: -75.5636, ubicacionEn: haceMin(4), // Centro
    },
  });
  const tec2 = await prisma.tecnico.create({
    data: {
      documento: '3002', nombre: 'Juan Pablo Vásquez', telefono: '3019876543',
      especialidades: 'GRUA,CONDUCTOR', licencia: 'C2', usuarioId: uTec2.id,
      lat: 6.2095, lng: -75.5700, ubicacionEn: haceMin(2), // El Poblado
    },
  });
  await prisma.tecnico.create({
    data: {
      documento: '3003', nombre: 'Andrés Restrepo', telefono: '3025554433',
      especialidades: 'MECANICA,GRUA', licencia: 'C1', disponible: false,
      lat: 6.3380, lng: -75.5420, ubicacionEn: haceMin(25), // Bello
    },
  });

  const cli1 = await prisma.cliente.create({
    data: {
      documento: '71234567', nombre: 'Santiago Gómez', telefono: '3009876543',
      correo: 'santiago@correo.com', usuarioId: uCli.id,
    },
  });
  const cli2 = await prisma.cliente.create({
    data: { documento: '43567890', nombre: 'Marcela Ruiz', telefono: '3145550011', correo: 'marcela@correo.com' },
  });
  const cli3 = await prisma.cliente.create({
    data: { documento: '98765432', nombre: 'Transportes del Oriente S.A.S.', telefono: '6045551122' },
  });

  // El primer vehiculo ya tiene los datos del documento porque paso por un
  // servicio en el que el tecnico los tomo; los demas los tienen en blanco,
  // que es como quedan cuando apenas los registra el cliente.
  const veh1 = await prisma.vehiculo.create({
    data: {
      placa: 'ABC123', marca: 'Chevrolet', modelo: 'Spark GT', color: 'Rojo', clienteId: cli1.id,
      linea: 'Spark GT 1.2', clase: 'Automóvil', licenciaTransito: '11223344',
      vin: '9GAJC5220RB012345', chasis: 'JC5220RB012345', motor: 'B12D1-0456789',
      propietarioNombre: 'Santiago Gómez', propietarioDocumento: '71234567',
    },
  });
  const veh2 = await prisma.vehiculo.create({
    data: { placa: 'GHT450', marca: 'Renault', modelo: 'Logan', color: 'Gris', clienteId: cli2.id },
  });
  const veh3 = await prisma.vehiculo.create({
    data: { placa: 'WKL780', marca: 'Mazda', modelo: 'CX-30', color: 'Blanco', clienteId: cli1.id },
  });
  const veh4 = await prisma.vehiculo.create({
    data: { placa: 'TNA915', marca: 'Kenworth', modelo: 'T800', color: 'Azul', clienteId: cli3.id },
  });

  await prisma.objetoInventario.createMany({
    data: [
      { descripcion: 'Gato hidráulico', cantidad: 1, vehiculoId: veh1.id },
      { descripcion: 'Llanta de repuesto', cantidad: 1, vehiculoId: veh1.id },
      { descripcion: 'Equipo de carretera', cantidad: 1, vehiculoId: veh2.id },
      { descripcion: 'Herramienta menor', cantidad: 3, vehiculoId: veh4.id },
    ],
  });

  /** Crea el servicio y deja el estado calculado a partir de sus marcas. */
  const crearServicio = async (data: Parameters<typeof prisma.servicio.create>[0]['data']) => {
    const s = await prisma.servicio.create({ data });
    const estado = calcularEstado({ ...s, expediente: null });
    return prisma.servicio.update({ where: { id: s.id }, data: { estado } });
  };

  /** Recalcula el estado despues de crear o cerrar el expediente. */
  const sincronizar = async (servicioId: number) => {
    const s = await prisma.servicio.findUniqueOrThrow({
      where: { id: servicioId },
      include: { expediente: { select: { cerradoEn: true } } },
    });
    await prisma.servicio.update({
      where: { id: servicioId },
      data: { estado: calcularEstado(s) },
    });
  };

  // ── 1. Cerrado: el caso completo de principio a fin ──────────────────────
  const s1 = await crearServicio({
    tipo: TipoServicio.CARRO_TALLER, tipoSolicitado: TipoServicio.CARRO_TALLER,
    direccion: 'Autopista Medellín-Bogotá km 24', descripcion: 'El vehículo no enciende.',
    lat: 6.3350, lng: -75.4200, contactoTelefono: '3009876543',
    solicitadoEn: hace(52), asignadoEn: hace(51), asignadoPor: central.id,
    iniciadoEn: hace(50), terminadoEn: hace(48),
    clienteId: cli1.id, vehiculoId: veh1.id, tecnicoId: tec1.id,
  });
  const e1 = await prisma.expediente.create({
    data: {
      consecutivo: 'EXP-2026-0001', servicioId: s1.id, abiertoEn: hace(51),
      formatoTipo: 'CARRO_TALLER', formatoVersion: 1,
      observaciones: 'Batería sulfatada. Se reemplaza en sitio y el vehículo enciende.',
      observacionesVersion: 2,
      esPropietario: true, verificadoEn: hace(50), verificadoPor: uTec1.id, verificacionVersion: 1,
      revisionCentral: 'Documentación completa. Soportes suficientes para facturar.',
      cerradoEn: hace(47), cerradoPor: central.id,
    },
  });
  await prisma.evidencia.createMany({
    data: [
      { idLocal: 'ev-0001', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.RECEPCION, archivo: 'evidencias/abc123-frontal.jpg', tomadaEn: hace(50), subidaPorId: uTec1.id, expedienteId: e1.id },
      { idLocal: 'ev-0002', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.GENERAL, archivo: 'evidencias/abc123-motor.jpg', tomadaEn: hace(50), subidaPorId: uTec1.id, expedienteId: e1.id },
      { idLocal: 'ev-0003', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.GENERAL, archivo: 'evidencias/abc123-cliente.jpg', tomadaEn: hace(52), subidaPorId: uCli.id, expedienteId: e1.id },
      { idLocal: 'ev-0004', tipo: TipoEvidencia.VIDEO, categoria: CategoriaEvidencia.ENTREGA, archivo: 'evidencias/abc123-arranque.mp4', tomadaEn: hace(48), subidaPorId: uTec1.id, expedienteId: e1.id },
    ],
  });
  await prisma.novedad.create({
    data: { idLocal: 'nv-0001', descripcion: 'El cliente reporta que el vehículo ya había fallado la semana pasada.', ocurridaEn: hace(50), expedienteId: e1.id },
  });
  await sincronizar(s1.id);

  // ── 2. En ejecucion: el tecnico esta en el sitio ahora mismo ─────────────
  const s2 = await crearServicio({
    tipo: TipoServicio.GRUA, tipoSolicitado: TipoServicio.GRUA,
    direccion: 'Glorieta de San Diego, Medellín',
    descripcion: 'Traslado del vehículo y dos pasajeros hasta el taller.',
    lat: 6.2320, lng: -75.5680, contactoTelefono: '3145550011',
    solicitadoEn: hace(3), asignadoEn: hace(2), asignadoPor: central.id,
    iniciadoEn: haceMin(40),
    etaMinutos: 12, etaActualizadoEn: haceMin(55),
    clienteId: cli2.id, vehiculoId: veh2.id, tecnicoId: tec2.id,
  });
  const e2 = await prisma.expediente.create({
    data: {
      consecutivo: 'EXP-2026-0002', servicioId: s2.id, abiertoEn: hace(3),
      formatoTipo: 'GRUA', formatoVersion: 1,
      esPropietario: true, verificadoEn: haceMin(38), verificadoPor: uTec2.id, verificacionVersion: 1,
    },
  });
  await prisma.evidencia.create({
    data: { idLocal: 'ev-0005', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.RECEPCION, archivo: 'evidencias/ght450-lateral.jpg', tomadaEn: haceMin(35), subidaPorId: uTec2.id, expedienteId: e2.id },
  });
  await sincronizar(s2.id);

  // ── 3. Terminado y esperando el cierre, con quien entrega NO propietario ─
  // Es el caso que muestra el formulario especial: la foto de la cedula con la
  // firma es lo que permitio prestar el servicio.
  const s3 = await crearServicio({
    tipo: TipoServicio.CONDUCTOR_ELEGIDO, tipoSolicitado: TipoServicio.CONDUCTOR_ELEGIDO,
    direccion: 'Calle 10 # 40-20, El Poblado', descripcion: 'Conductor elegido hasta Envigado.',
    lat: 6.2100, lng: -75.5700, contactoTelefono: '3009876543',
    solicitadoEn: hace(14), asignadoEn: hace(13), asignadoPor: central.id,
    iniciadoEn: hace(13), terminadoEn: hace(11),
    clienteId: cli1.id, vehiculoId: veh3.id, tecnicoId: tec2.id,
  });
  const e3 = await prisma.expediente.create({
    data: {
      consecutivo: 'EXP-2026-0003', servicioId: s3.id, abiertoEn: hace(14),
      formatoTipo: 'CONDUCTOR_ELEGIDO', formatoVersion: 1,
      observaciones: 'Trayecto sin novedad. Vehículo entregado en el destino acordado.',
      observacionesVersion: 1,
      esPropietario: false,
      solicitanteNombre: 'Laura Gómez Arenas',
      solicitanteDocumento: '1017554321',
      solicitanteRelacion: 'Hija del propietario, autorizada por escrito',
      verificadoEn: hace(13), verificadoPor: uTec2.id, verificacionVersion: 1,
    },
  });
  await prisma.evidencia.createMany({
    data: [
      { idLocal: 'ev-0006', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.RECEPCION, archivo: 'evidencias/wkl780-recepcion.jpg', tomadaEn: hace(13), subidaPorId: uTec2.id, expedienteId: e3.id },
      { idLocal: 'ev-0007', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.FIRMA_CEDULA, archivo: 'evidencias/wkl780-cedula-firma.jpg', tomadaEn: hace(13), subidaPorId: uTec2.id, expedienteId: e3.id },
      { idLocal: 'ev-0008', tipo: TipoEvidencia.FOTO, categoria: CategoriaEvidencia.ENTREGA, archivo: 'evidencias/wkl780-entrega.jpg', tomadaEn: hace(11), subidaPorId: uTec2.id, expedienteId: e3.id },
    ],
  });
  await sincronizar(s3.id);

  // ── 4. Solicitado: el punto de partida de la demostracion ───────────────
  // Es lo que la central ve llegar y debe clasificar y asignar.
  const s4 = await crearServicio({
    tipoSolicitado: TipoServicio.GRUA, direccion: 'Vía Las Palmas km 6',
    descripcion: 'Llanta averiada, el vehículo está sobre la berma.',
    lat: 6.2000, lng: -75.5300, contactoTelefono: '6045551122',
    solicitadoEn: haceMin(18),
    clienteId: cli3.id, vehiculoId: veh4.id,
  });

  // ── 5. Cancelado ────────────────────────────────────────────────────────
  await crearServicio({
    tipo: TipoServicio.GRUA, tipoSolicitado: TipoServicio.GRUA,
    direccion: 'Carrera 70 con Colombia', descripcion: 'Solicitud de grúa.',
    lat: 6.2550, lng: -75.5900,
    solicitadoEn: hace(30), asignadoEn: hace(30), asignadoPor: central.id,
    canceladoEn: hace(29), canceladoPor: central.id,
    motivoCancelacion: 'El cliente logró encender el vehículo antes de la llegada del técnico.',
    clienteId: cli2.id, vehiculoId: veh2.id,
  });

  // ── 6. Rechazado: la solicitud que la central no acepta ─────────────────
  await crearServicio({
    tipoSolicitado: TipoServicio.CARRO_TALLER,
    direccion: 'Vereda sin nomenclatura, zona rural de Santa Elena',
    descripcion: 'Solicitud sin punto de referencia verificable.',
    solicitadoEn: hace(26),
    rechazadoEn: hace(25), rechazadoPor: central.id,
    motivoRechazo: 'Fuera del área de cobertura y sin dirección verificable para despachar.',
    clienteId: cli3.id, vehiculoId: veh4.id,
  });

  // ── Notificaciones ──────────────────────────────────────────────────────
  // La central arranca la demostracion con el aviso de la solicitud pendiente
  // sin leer: es el gancho del recorrido.
  await prisma.notificacion.createMany({
    data: [
      {
        tipo: 'SERVICIO_SOLICITADO', usuarioId: central.id, servicioId: s4.id,
        titulo: 'Nueva solicitud de servicio',
        mensaje: 'Transportes del Oriente S.A.S. solicita una grúa para el vehículo TNA915 en Vía Las Palmas km 6.',
        creadaEn: haceMin(18),
      },
      {
        tipo: 'SERVICIO_SOLICITADO', usuarioId: admin.id, servicioId: s4.id,
        titulo: 'Nueva solicitud de servicio',
        mensaje: 'Transportes del Oriente S.A.S. solicita una grúa para el vehículo TNA915 en Vía Las Palmas km 6.',
        creadaEn: haceMin(18),
      },
      {
        tipo: 'SERVICIO_TERMINADO', usuarioId: central.id, servicioId: s3.id, expedienteId: e3.id,
        titulo: 'Servicio terminado: pendiente de revisar y cerrar',
        mensaje: 'Juan Pablo Vásquez terminó el servicio de WKL780. Quien entregó el vehículo no era el propietario.',
        creadaEn: hace(11),
      },
      {
        tipo: 'EXPEDIENTE_CERRADO', usuarioId: uCli.id, servicioId: s1.id, expedienteId: e1.id,
        titulo: 'Su servicio quedó cerrado',
        mensaje: 'Expediente EXP-2026-0001 de ABC123 cerrado. Puede consultarlo cuando lo necesite.',
        creadaEn: hace(47), leidaEn: hace(46),
      },
      {
        tipo: 'SERVICIO_INICIADO', usuarioId: uTec2.id, servicioId: s2.id, expedienteId: e2.id,
        titulo: 'Servicio en ejecución',
        mensaje: 'GHT450 · Glorieta de San Diego. Recuerde registrar el estado al recibir y al entregar.',
        creadaEn: haceMin(40),
      },
    ],
  });

  // Los consecutivos de arriba son fijos para que la demostracion sea legible.
  // Hay que adelantar la secuencia o el primer expediente que cree el
  // aplicativo repetiria el numero EXP-2026-0001.
  await sincronizarSecuencia();

  const porEstado = await prisma.servicio.groupBy({ by: ['estado'], _count: true });

  console.log('Datos de demostración cargados.');
  console.log('Usuarios (clave VialServi2026):');
  console.log('  1001 administrador · 2001 central · 3001 y 3002 técnicos · 71234567 cliente');
  console.log('Servicios por estado:');
  for (const e of porEstado) console.log(`  ${e.estado}: ${e._count}`);
  console.log(`Expedientes: ${await prisma.expediente.count()} · Notificaciones: ${await prisma.notificacion.count()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
