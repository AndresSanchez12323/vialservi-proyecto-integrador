#!/usr/bin/env bash
# Compila el SPA, lo sube al bucket y limpia la cache de CloudFront.
#
# Uso:  ./infra/desplegar-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/comun.sh

requiere aws
pila_existe || fatal "No existe la pila '$PILA'. Cree la infraestructura primero."

BUCKET="$(salida_pila BucketWebNombre)"
DIST="$(salida_pila IdDistribucion)"
URL="$(salida_pila Url)"
[ -n "$BUCKET" ] || fatal "No se pudo leer el bucket del SPA de la pila."

paso "Compilando el SPA"
# VITE_API_URL queda vacia a proposito: CloudFront sirve el SPA y enruta /api/*
# al mismo dominio, asi que las peticiones relativas funcionan y no hay CORS.
VITE_API_URL='' npm run build:web
ok "compilado en apps/web/dist"

# Dos pasadas a proposito. Los archivos de assets/ llevan un hash en el nombre:
# si cambian, cambia el nombre, asi que se pueden cachear un ano. index.html NO
# lleva hash: si se cachea, el navegador seguiria pidiendo la version vieja del
# JavaScript y la aplicacion quedaria rota tras cada despliegue.
paso "Subiendo a s3://$BUCKET"
aws s3 sync apps/web/dist "s3://$BUCKET" \
  --delete --exclude index.html \
  --cache-control 'public,max-age=31536000,immutable' \
  --region "$REGION" --only-show-errors
aws s3 cp apps/web/dist/index.html "s3://$BUCKET/index.html" \
  --cache-control 'no-cache,no-store,must-revalidate' \
  --region "$REGION" --only-show-errors
ok "archivos sincronizados"

paso "Invalidando la cache de CloudFront"
ID_INV="$(aws cloudfront create-invalidation \
  --distribution-id "$DIST" --paths '/*' \
  --query 'Invalidation.Id' --output text)"
ok "invalidacion $ID_INV creada"

printf "\n${VERDE}Listo: %s${FIN}\n" "$URL"
