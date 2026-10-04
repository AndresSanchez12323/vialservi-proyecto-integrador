#!/bin/sh
# Arranque del contenedor del API.
#
# Las migraciones se aplican aqui y no en un paso aparte del despliegue porque
# `prisma migrate deploy` toma un bloqueo de asesoramiento en PostgreSQL: si
# arrancan dos instancias a la vez, una espera a la otra y ninguna aplica la
# misma migracion dos veces. Es seguro y evita tener que abrir la base de datos
# a internet para correr las migraciones desde un portatil.
set -e

echo "[arranque] aplicando migraciones pendientes..."
cd /app/apps/api
npx prisma migrate deploy

# SEMBRAR_DATOS=true carga los datos de demostracion. Se usa UNA vez, al montar
# el entorno por primera vez: el seed BORRA las tablas antes de insertar, asi
# que dejarlo encendido vaciaria la base en cada despliegue.
if [ "$SEMBRAR_DATOS" = "true" ]; then
  echo "[arranque] SEMBRAR_DATOS=true: cargando datos de demostracion (BORRA lo que haya)..."
  node dist/prisma/seed.js
fi

echo "[arranque] iniciando el API..."
cd /app
exec node apps/api/dist/src/server.js
