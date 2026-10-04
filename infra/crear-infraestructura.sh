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
  PARAMS+=(ClaveBaseDatos= JwtSecret= SmtpClave=)
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

  echo
  paso "Correo de recuperacion de contrasena"
  cat <<'AYUDA'
  Hay tres opciones:

    1) SMTP (recomendado para empezar). Envia a CUALQUIER destinatario de
       inmediato y solo exige verificar el remitente. Con Gmail: active la
       verificacion en dos pasos y genere una "contrasena de aplicacion" en
       https://myaccount.google.com/apppasswords
       Servidor: smtp.gmail.com   Puerto: 587

    2) Amazon SES. Mas limpio estando en AWS, pero una cuenta nueva esta en
       "sandbox" y solo envia a direcciones verificadas hasta que AWS aprueba
       el acceso a produccion (unas 24 horas).

    3) Nada. El API queda en modo consola: el codigo se genera y se valida
       bien, pero solo se imprime en CloudWatch y al usuario no le llega.

AYUDA
  read -r -p "Direccion desde la que salen los correos (Enter para omitir): " REMITENTE || REMITENTE=''

  SMTP_HOST=''; SMTP_USUARIO=''; SMTP_CLAVE=''; SMTP_PUERTO=587
  if [ -n "$REMITENTE" ]; then
    read -r -p "Servidor SMTP (Enter para usar SES en su lugar): " SMTP_HOST || SMTP_HOST=''
    if [ -n "$SMTP_HOST" ]; then
      read -r -p "Puerto [587]: " PUERTO_IN || PUERTO_IN=''
      SMTP_PUERTO="${PUERTO_IN:-587}"
      read -r -p "Usuario SMTP [$REMITENTE]: " USUARIO_IN || USUARIO_IN=''
      SMTP_USUARIO="${USUARIO_IN:-$REMITENTE}"
      # -s para que la contrasena no quede en pantalla ni en el historial.
      read -r -s -p "Contrasena SMTP (no se muestra): " SMTP_CLAVE || SMTP_CLAVE=''
      echo
      [ -n "$SMTP_CLAVE" ] || fatal "Sin contrasena SMTP no se puede configurar el envio."
    fi
  fi

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
      "SmtpHost=${SMTP_HOST:-}" \
      "SmtpPuerto=${SMTP_PUERTO:-587}" \
      "SmtpUsuario=${SMTP_USUARIO:-}" \
      "SmtpClave=${SMTP_CLAVE:-}" \
    || fatal "La creacion fallo. Vea el motivo con:
    aws cloudformation describe-stack-events --stack-name $PILA --region $REGION \\
      --query 'StackEvents[?ResourceStatus==\`CREATE_FAILED\`].[LogicalResourceId,ResourceStatusReason]' --output table"
fi

paso "Resumen"
printf "  Aplicativo      %s\n" "$(salida_pila Url)"
printf "  Bucket del SPA  %s\n" "$(salida_pila BucketWebNombre)"
printf "  Evidencias      %s\n" "$(salida_pila BucketEvidenciasNombre)"
printf "  Base de datos   %s\n" "$(salida_pila EndpointBase)"
printf "  Correo          %s\n" "$(salida_pila ModoCorreo)"
printf "\n${VERDE}Falta publicar la interfaz:  ./infra/desplegar-web.sh${FIN}\n"
