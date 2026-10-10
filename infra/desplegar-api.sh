#!/usr/bin/env bash
# Construye la imagen del API, la sube a ECR y actualiza el servicio.
#
# Uso:  ./infra/desplegar-api.sh
#
# La primera vez solo construye y sube (todavia no hay pila que actualizar); la
# imagen que deja es la que se le pasa a crear-infraestructura.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/comun.sh

requiere aws
requiere docker

CUENTA="$(cuenta_aws)"
if pila_existe; then
  MODO_API="$(aws cloudformation describe-stacks --stack-name "$PILA" \
    --query "Stacks[0].Parameters[?ParameterKey=='OrigenApi'].ParameterValue" --output text)"
  [ "$MODO_API" != 'lambda' ] || fatal "Esta pila usa Lambda. Use infra/desplegar-serverless.ps1; este script es de ECS."
fi
REGISTRO="$CUENTA.dkr.ecr.$REGION.amazonaws.com"
IMAGEN="$REGISTRO/$REPO_ECR:$ETIQUETA"

paso "Cuenta $CUENTA · region $REGION"

paso "Asegurando el repositorio de ECR '$REPO_ECR'"
if ! aws ecr describe-repositories --repository-names "$REPO_ECR" --region "$REGION" >/dev/null 2>&1; then
  aws ecr create-repository \
    --repository-name "$REPO_ECR" \
    --image-scanning-configuration scanOnPush=true \
    --region "$REGION" >/dev/null
  ok "repositorio creado"
else
  ok "ya existia"
fi

paso "Entrando a ECR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRO" >/dev/null
ok "autenticado"

# --platform linux/amd64 es obligatorio desde un Mac con chip Apple: sin esto se
# construye una imagen arm64 que Fargate no puede ejecutar y la tarea muere con
# "exec format error", que no dice nada sobre la causa real.
paso "Construyendo la imagen (linux/amd64)"
docker build --platform linux/amd64 -t "$IMAGEN" -t "$REGISTRO/$REPO_ECR:latest" .
ok "construida"

paso "Subiendo a ECR"
docker push "$IMAGEN" >/dev/null
docker push "$REGISTRO/$REPO_ECR:latest" >/dev/null
ok "subida: $IMAGEN"

if pila_existe; then
  paso "Actualizando la definicion de tarea con la imagen nueva"
  aws cloudformation deploy \
    --stack-name "$PILA" \
    --template-file infra/cloudformation/vialservi.yml \
    --parameter-overrides "ImagenApi=$IMAGEN" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --region "$REGION"

  paso "Esperando que el servicio quede estable (puede tardar unos minutos)"
  aws ecs wait services-stable \
    --cluster "$(salida_pila Cluster)" \
    --services "$(salida_pila Servicio)" \
    --region "$REGION"
  ok "servicio desplegado"

  URL="$(salida_pila Url)"
  paso "Comprobando que responda"
  if curl -fsS "$URL/api/listo" >/dev/null 2>&1; then
    ok "$URL/api/listo responde"
  else
    printf "  ! %s/api/listo todavia no responde; revise los logs:\n" "$URL"
    printf "    aws logs tail /ecs/%s-api --follow --region %s\n" "$PROYECTO" "$REGION"
  fi
else
  ok "No hay pila todavia. Siga con:"
  printf "\n    ./infra/crear-infraestructura.sh %s\n\n" "$IMAGEN"
fi
