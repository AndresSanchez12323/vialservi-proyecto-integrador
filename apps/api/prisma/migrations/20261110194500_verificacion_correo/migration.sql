CREATE TYPE "TipoVerificacionCorreo" AS ENUM ('REGISTRO_CLIENTE', 'REGISTRO_TECNICO', 'CAMBIO_CLAVE');

CREATE TABLE "VerificacionCorreo" (
    "id" TEXT NOT NULL,
    "tipo" "TipoVerificacionCorreo" NOT NULL,
    "correo" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "datos" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,

    CONSTRAINT "VerificacionCorreo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificacionCorreo_correo_tipo_idx" ON "VerificacionCorreo"("correo", "tipo");

ALTER TABLE "VerificacionCorreo"
ADD CONSTRAINT "VerificacionCorreo_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
