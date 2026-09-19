/**
 * Datos de demostracion. Alcanzan para ver los modulos funcionando y para
 * mostrar servicios en distintos estados, sin simular una empresa en
 * operacion desde hace anos.
 */
import bcrypt from 'bcryptjs';
import {
  PrismaClient, Rol, TipoServicio, EstadoServicio, TipoEvidencia,
} from '@prisma/client';

const prisma = new PrismaClient();

const hace = (horas: number) => new Date(Date.now() - horas * 3600_000);

async function main() {
  await prisma.evidencia.deleteMany();
  await prisma.novedad.deleteMany();
  await prisma.objetoInventario.deleteMany();
  await prisma.expediente.deleteMany();
  await prisma.servicio.deleteMany();
  await prisma.vehiculo.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.tecnico.deleteMany();
  await prisma.usuario.deleteMany();

  const clave = await bcrypt.hash('VialServi2026', 10);
  const u = (documento: string, nombre: string, correo: string, rol: Rol) =>
    prisma.usuario.create({ data: { documento, nombre, correo, clave, rol } });

  const admin = await u('1001', 'Edwin Sánchez', 'admin@vialservi.co', Rol.ADMINISTRADOR);
  const central = await u('2001', 'Central de Operaciones', 'central@vialservi.co', Rol.CENTRAL);
  const uTec1 = await u('3001', 'Brahian Rendón', 'brahian@vialservi.co', Rol.TECNICO);
  const uTec2 = await u('3002', 'Juan Pablo Vásquez', 'juanpa@vialservi.co', Rol.TECNICO);
  const uCli = await u('71234567', 'Santiago Gómez', 'santiago@correo.com', Rol.CLIENTE);

  const tec1 = await prisma.tecnico.create({
    data: {
      documento: '3001', nombre: 'Brahian Rendón', telefono: '3001234567',
      especialidades: 'MECANICA,CERRAJERIA', licencia: 'B1', usuarioId: uTec1.id,
    },
  });
  const tec2 = await prisma.tecnico.create({
    data: {
      documento: '3002', nombre: 'Juan Pablo Vásquez', telefono: '3019876543',
      especialidades: 'GRUA,CONDUCTOR', licencia: 'C2', usuarioId: uTec2.id,
    },
  });
  await prisma.tecnico.create({
    data: {
      documento: '3003', nombre: 'Andrés Restrepo', telefono: '3025554433',
      especialidades: 'MECANICA,GRUA', licencia: 'C1', disponible: false,
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

  const veh1 = await prisma.vehiculo.create({
    data: { placa: 'ABC123', marca: 'Chevrolet', modelo: 'Spark GT', color: 'Rojo', clienteId: cli1.id },
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

  // 1. Cerrado: el caso completo de principio a fin
  const s1 = await prisma.servicio.create({
    data: {
      tipo: TipoServicio.CARRO_TALLER, estado: EstadoServicio.CERRADO,
      direccion: 'Autopista Medellín-Bogotá km 24', descripcion: 'El vehículo no enciende.',
      solicitadoEn: hace(52), clienteId: cli1.id, vehiculoId: veh1.id, tecnicoId: tec1.id,
    },
  });
  const e1 = await prisma.expediente.create({
    data: {
      consecutivo: 'EXP-2026-0001', servicioId: s1.id, abiertoEn: hace(51),
      observaciones: 'Batería sulfatada. Se reemplaza en sitio y el vehículo enciende.',
      observacionesVersion: 2, cerradoEn: hace(47), cerradoPor: central.id,
    },
  });
  await prisma.evidencia.createMany({
    data: [
      { idLocal: 'ev-0001', tipo: TipoEvidencia.FOTO, archivo: 'evidencias/abc123-frontal.jpg', tomadaEn: hace(50), subidaPorId: uTec1.id, expedienteId: e1.id },
      { idLocal: 'ev-0002', tipo: TipoEvidencia.FOTO, archivo: 'evidencias/abc123-motor.jpg', tomadaEn: hace(50), subidaPorId: uTec1.id, expedienteId: e1.id },
      { idLocal: 'ev-0003', tipo: TipoEvidencia.FOTO, archivo: 'evidencias/abc123-cliente.jpg', tomadaEn: hace(52), subidaPorId: uCli.id, expedienteId: e1.id },
      { idLocal: 'ev-0004', tipo: TipoEvidencia.VIDEO, archivo: 'evidencias/abc123-arranque.mp4', tomadaEn: hace(48), subidaPorId: uTec1.id, expedienteId: e1.id },
    ],
  });
  await prisma.novedad.create({
    data: { idLocal: 'nv-0001', descripcion: 'El cliente reporta que el vehículo ya había fallado la semana pasada.', ocurridaEn: hace(50), expedienteId: e1.id },
  });

  // 2. En ejecucion: el tecnico esta en el sitio ahora mismo
  const s2 = await prisma.servicio.create({
    data: {
      tipo: TipoServicio.GRUA, estado: EstadoServicio.EN_EJECUCION,
      direccion: 'Glorieta de San Diego, Medellín', descripcion: 'Traslado del vehículo y dos pasajeros hasta el taller.',
      solicitadoEn: hace(3), clienteId: cli2.id, vehiculoId: veh2.id, tecnicoId: tec2.id,
    },
  });
  const e2 = await prisma.expediente.create({
    data: { consecutivo: 'EXP-2026-0002', servicioId: s2.id, abiertoEn: hace(3) },
  });
  await prisma.evidencia.create({
    data: { idLocal: 'ev-0005', tipo: TipoEvidencia.FOTO, archivo: 'evidencias/ght450-lateral.jpg', tomadaEn: hace(2), subidaPorId: uTec2.id, expedienteId: e2.id },
  });

  // 3. Terminado: espera el cierre de la central
  const s3 = await prisma.servicio.create({
    data: {
      tipo: TipoServicio.CONDUCTOR_ELEGIDO, estado: EstadoServicio.TERMINADO,
      direccion: 'Calle 10 # 40-20, El Poblado', descripcion: 'Conductor elegido hasta Envigado.',
      solicitadoEn: hace(14), clienteId: cli1.id, vehiculoId: veh3.id, tecnicoId: tec2.id,
    },
  });
  const e3 = await prisma.expediente.create({
    data: {
      consecutivo: 'EXP-2026-0003', servicioId: s3.id, abiertoEn: hace(14),
      observaciones: 'Trayecto sin novedad. Vehículo entregado al propietario.', observacionesVersion: 1,
    },
  });
  await prisma.evidencia.create({
    data: { idLocal: 'ev-0006', tipo: TipoEvidencia.FOTO, archivo: 'evidencias/wkl780-entrega.jpg', tomadaEn: hace(12), subidaPorId: uTec2.id, expedienteId: e3.id },
  });

  // 4. Solicitado: todavia sin clasificar, es lo que la central debe atender
  await prisma.servicio.create({
    data: {
      estado: EstadoServicio.SOLICITADO, direccion: 'Vía Las Palmas km 6',
      descripcion: 'Llanta averiada, el vehículo está sobre la berma.',
      solicitadoEn: hace(1), clienteId: cli3.id, vehiculoId: veh4.id,
    },
  });

  // 5. Cancelado
  await prisma.servicio.create({
    data: {
      tipo: TipoServicio.GRUA, estado: EstadoServicio.CANCELADO,
      direccion: 'Carrera 70 con Colombia', descripcion: 'Solicitud de grúa.',
      solicitadoEn: hace(30), clienteId: cli2.id, vehiculoId: veh2.id,
      canceladoEn: hace(29), canceladoPor: central.id,
      motivoCancelacion: 'El cliente logró encender el vehículo antes de la llegada del técnico.',
    },
  });

  console.log('Datos de demostración cargados.');
  console.log('Usuarios (clave VialServi2026):');
  console.log('  1001 administrador · 2001 central · 3001 y 3002 técnicos · 71234567 cliente');
  console.log(`  admin=${admin.id} central=${central.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
