# Imagen del API de VialServi.
#
# Solo contiene el API: el SPA se publica como archivos estaticos en S3 y se
# sirve por CloudFront, que es mucho mas barato y rapido que hacer que Node
# entregue archivos que nunca cambian entre peticiones.
#
# Dos etapas: la primera instala y compila; la segunda se queda solo con lo que
# hace falta para ejecutar. Asi la imagen final no lleva el codigo fuente ni la
# cache de npm.

# ── Etapa 1: compilar ────────────────────────────────────────────────────
FROM node:22-alpine AS compilacion
WORKDIR /app

# openssl lo necesita el motor de Prisma en Alpine; sin el, el cliente falla al
# arrancar con un error de biblioteca compartida que no dice nada util.
RUN apk add --no-cache openssl

# Primero solo los manifiestos: si no cambian, Docker reutiliza la capa de
# npm ci y la compilacion es cuestion de segundos.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root

COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace apps/api

# ── Etapa 2: ejecutar ────────────────────────────────────────────────────
FROM node:22-alpine AS ejecucion
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
# App Runner y ECS inyectan PORT; 4000 es solo el valor por omision.
ENV PORT=4000

# Se copia /app completo de la etapa anterior, en un solo COPY.
#
# Es a proposito, aunque traiga algun archivo que no se ejecuta: con npm
# workspaces, apps/api/node_modules puede NO existir —npm iza las dependencias
# a la raiz— y un COPY de una ruta inexistente aborta la construccion. Copiar
# el arbol completo funciona en los dos casos.
#
# Lo que viaja incluye el cliente de Prisma ya generado, la CLI de Prisma (que
# aplica las migraciones al arrancar), el codigo compilado, y el esquema con sus
# migraciones, que son parte del artefacto y no algo que se consiga en el
# servidor. El .env nunca entra: lo excluye .dockerignore.
COPY --from=compilacion /app ./

COPY infra/arranque.sh /app/arranque.sh
RUN chmod +x /app/arranque.sh

# No correr como root: si alguien logra ejecutar algo dentro del contenedor,
# que no sea con todos los permisos.
USER node

EXPOSE 4000

# La sonda la usa Docker en local; en AWS la configura App Runner o el
# balanceador apuntando a la misma ruta.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/arranque.sh"]
