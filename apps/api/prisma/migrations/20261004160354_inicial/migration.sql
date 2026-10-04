-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMINISTRADOR', 'CENTRAL', 'TECNICO', 'CLIENTE');

-- CreateEnum
CREATE TYPE "TipoServicio" AS ENUM ('GRUA', 'CARRO_TALLER', 'CONDUCTOR_ELEGIDO');

-- CreateEnum
CREATE TYPE "EstadoServicio" AS ENUM ('SOLICITADO', 'ASIGNADO', 'EN_EJECUCION', 'TERMINADO', 'CERRADO', 'CANCELADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoEvidencia" AS ENUM ('FOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "CategoriaEvidencia" AS ENUM ('GENERAL', 'RECEPCION', 'ENTREGA', 'DANO', 'FIRMA_CEDULA', 'DOCUMENTO');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('SERVICIO_SOLICITADO', 'SERVICIO_ASIGNADO', 'SERVICIO_RECHAZADO', 'SERVICIO_CANCELADO', 'TECNICO_EN_CAMINO', 'SERVICIO_INICIADO', 'SERVICIO_TERMINADO', 'EXPEDIENTE_CERRADO', 'EVIDENCIA_CLIENTE', 'VERIFICACION_NO_PROPIETARIO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecuperacionClave" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "RecuperacionClave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehiculo" (
    "id" SERIAL NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linea" TEXT,
    "clase" TEXT,
    "licenciaTransito" TEXT,
    "vin" TEXT,
    "chasis" TEXT,
    "motor" TEXT,
    "propietarioNombre" TEXT,
    "propietarioDocumento" TEXT,
    "clienteId" INTEGER NOT NULL,

    CONSTRAINT "Vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjetoInventario" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehiculoId" INTEGER NOT NULL,

    CONSTRAINT "ObjetoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tecnico" (
    "id" SERIAL NOT NULL,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "especialidades" TEXT NOT NULL,
    "licencia" TEXT,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "ubicacionEn" TIMESTAMP(3),
    "usuarioId" INTEGER,

    CONSTRAINT "Tecnico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servicio" (
    "id" SERIAL NOT NULL,
    "estado" "EstadoServicio" NOT NULL DEFAULT 'SOLICITADO',
    "tipoSolicitado" "TipoServicio",
    "direccion" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "contactoTelefono" TEXT,
    "solicitadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "TipoServicio",
    "asignadoEn" TIMESTAMP(3),
    "asignadoPor" INTEGER,
    "iniciadoEn" TIMESTAMP(3),
    "terminadoEn" TIMESTAMP(3),
    "etaMinutos" INTEGER,
    "etaActualizadoEn" TIMESTAMP(3),
    "canceladoEn" TIMESTAMP(3),
    "canceladoPor" INTEGER,
    "motivoCancelacion" TEXT,
    "rechazadoEn" TIMESTAMP(3),
    "rechazadoPor" INTEGER,
    "motivoRechazo" TEXT,
    "clienteId" INTEGER NOT NULL,
    "vehiculoId" INTEGER NOT NULL,
    "tecnicoId" INTEGER,

    CONSTRAINT "Servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expediente" (
    "id" SERIAL NOT NULL,
    "idLocal" TEXT,
    "consecutivo" TEXT NOT NULL,
    "abiertoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formatoTipo" TEXT,
    "formatoVersion" INTEGER,
    "observaciones" TEXT,
    "observacionesVersion" INTEGER NOT NULL DEFAULT 0,
    "esPropietario" BOOLEAN,
    "solicitanteNombre" TEXT,
    "solicitanteDocumento" TEXT,
    "solicitanteRelacion" TEXT,
    "verificadoEn" TIMESTAMP(3),
    "verificadoPor" INTEGER,
    "verificacionVersion" INTEGER NOT NULL DEFAULT 0,
    "revisionCentral" TEXT,
    "cerradoEn" TIMESTAMP(3),
    "cerradoPor" INTEGER,
    "servicioId" INTEGER NOT NULL,

    CONSTRAINT "Expediente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidencia" (
    "id" SERIAL NOT NULL,
    "idLocal" TEXT NOT NULL,
    "tipo" "TipoEvidencia" NOT NULL,
    "categoria" "CategoriaEvidencia" NOT NULL DEFAULT 'GENERAL',
    "archivo" TEXT NOT NULL,
    "tomadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posteriorAlCierre" BOOLEAN NOT NULL DEFAULT false,
    "subidaPorId" INTEGER NOT NULL,
    "expedienteId" INTEGER NOT NULL,

    CONSTRAINT "Evidencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Novedad" (
    "id" SERIAL NOT NULL,
    "idLocal" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "ocurridaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posteriorAlCierre" BOOLEAN NOT NULL DEFAULT false,
    "expedienteId" INTEGER NOT NULL,

    CONSTRAINT "Novedad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "leidaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "servicioId" INTEGER,
    "expedienteId" INTEGER,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_documento_key" ON "Usuario"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_correo_key" ON "Usuario"("correo");

-- CreateIndex
CREATE INDEX "RecuperacionClave_usuarioId_idx" ON "RecuperacionClave"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehiculo_placa_key" ON "Vehiculo"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_documento_key" ON "Cliente"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_usuarioId_key" ON "Cliente"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Tecnico_documento_key" ON "Tecnico"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "Tecnico_usuarioId_key" ON "Tecnico"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Expediente_idLocal_key" ON "Expediente"("idLocal");

-- CreateIndex
CREATE UNIQUE INDEX "Expediente_consecutivo_key" ON "Expediente"("consecutivo");

-- CreateIndex
CREATE UNIQUE INDEX "Expediente_servicioId_key" ON "Expediente"("servicioId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidencia_idLocal_key" ON "Evidencia"("idLocal");

-- CreateIndex
CREATE INDEX "Evidencia_expedienteId_idx" ON "Evidencia"("expedienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Novedad_idLocal_key" ON "Novedad"("idLocal");

-- CreateIndex
CREATE INDEX "Novedad_expedienteId_idx" ON "Novedad"("expedienteId");

-- CreateIndex
CREATE INDEX "Notificacion_usuarioId_leidaEn_idx" ON "Notificacion"("usuarioId", "leidaEn");

-- AddForeignKey
ALTER TABLE "RecuperacionClave" ADD CONSTRAINT "RecuperacionClave_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehiculo" ADD CONSTRAINT "Vehiculo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjetoInventario" ADD CONSTRAINT "ObjetoInventario_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "Tecnico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expediente" ADD CONSTRAINT "Expediente_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidencia" ADD CONSTRAINT "Evidencia_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidencia" ADD CONSTRAINT "Evidencia_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
