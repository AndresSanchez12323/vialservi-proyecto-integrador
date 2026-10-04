#!/usr/bin/env bash
# Crea o actualiza toda la infraestructura con CloudFormation.
#
# Uso:  ./infra/crear-infraestructura.sh <URI-de-la-imagen-en-ECR>
#
# La contrasena de la base y la clave de sesion se piden una sola vez, al crear.
# En las actualizaciones se reutilizan las que ya tiene la pila.
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/comun.sh

requiere aws
IMAGEN="${1:-}"
CUENTA="$(cuenta_aws)"

if pila_existe; then
  paso "La pila '$PILA' ya existe: se actualiza"
  PARAMS=(--parameter-overrides)
  [ -n "$IMAGEN" ] && PARAMS+=("ImagenApi=$IMAGEN")
  PARAMS+=(ClaveBaseDatos= JwtSecret=)
  # Con el valor vacio CloudFormation conserva el que ya estaba guardado.
  aws cloudformation deploy \
    --stack-name "$PILA" \
    --template-file infra/cloudformation/vialservi.yml \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --region "$REGION" \
    "${PARAMS[@]}" || fatal "La actualizacion fallo. Revise los eventos de la pila."
else
  [ -n "$IMAGEN" ] || fatal "Falta la URI de la imagen. Corra antes ./infra/desplegar-api.sh"

  paso "Generando secretos"
  # Se generan aqui y NO se imprimen: quedan en SSM Parameter Store, que es de
  # donde los lee el contenedor. Nadie tiene que copiarlos a mano.
  CLAVE_BASE="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  ok "contrasena de la base y clave de sesion generadas"

  read -r -p "Correo verificado en SES para la recuperacion (Enter para omitir): " REMITENTE || REMITENTE=''

  paso "Creando la infraestructura (RDS y CloudFront tardan: 15-20 minutos)"
  aws cloudformation deploy \
    --stack-name "$PILA" \
    --template-file infra/cloudformation/vialservi.yml \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --region "$REGION" \
    --parameter-overrides \
      "Proyecto=$PROYECTO" \
      "ImagenApi=$IMAGEN" \
      "ClaveBaseDatos=$CLAVE_BASE" \
      "JwtSecret=$JWT" \
      "CorreoRemitente=${REMITENTE:-}" \
    || fatal "La creacion fallo. Vea el motivo con:
    aws cloudformation describe-stack-events --stack-name $PILA --region $REGION \\
      --query 'StackEvents[?ResourceStatus==\`CREATE_FAILED\`].[LogicalResourceId,ResourceStatusReason]' --output table"
fi

paso "Resumen"
printf "  Aplicativo      %s\n" "$(salida_pila Url)"
printf "  Bucket del SPA  %s\n" "$(salida_pila BucketWebNombre)"
printf "  Evidencias      %s\n" "$(salida_pila BucketEvidenciasNombre)"
printf "  Base de datos   %s\n" "$(salida_pila EndpointBase)"
printf "\n${VERDE}Falta publicar la interfaz:  ./infra/desplegar-web.sh${FIN}\n"
