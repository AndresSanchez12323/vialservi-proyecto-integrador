#!/usr/bin/env bash
# Valores y utilidades que comparten los scripts de despliegue.
#
# Todo se puede sobreescribir por variable de entorno, para no tener que editar
# los scripts:  PROYECTO=vialservi-pruebas ./desplegar-api.sh
set -euo pipefail

PROYECTO="${PROYECTO:-vialservi}"
REGION="${REGION:-us-east-1}"
PILA="${PILA:-$PROYECTO}"
REPO_ECR="${REPO_ECR:-$PROYECTO-api}"
ETIQUETA="${ETIQUETA:-$(date +%Y%m%d-%H%M%S)}"

# Colores solo si la salida es una terminal: en un log de CI los codigos de
# escape se ven como basura.
if [ -t 1 ]; then AZUL='\033[0;34m'; VERDE='\033[0;32m'; ROJO='\033[0;31m'; FIN='\033[0m'
else AZUL=''; VERDE=''; ROJO=''; FIN=''; fi

paso()  { printf "${AZUL}==> %s${FIN}\n" "$*"; }
ok()    { printf "${VERDE}  ✓ %s${FIN}\n" "$*"; }
fatal() { printf "${ROJO}  ✗ %s${FIN}\n" "$*" >&2; exit 1; }

requiere() {
  command -v "$1" >/dev/null 2>&1 || fatal "Falta '$1'. Instalelo antes de continuar."
}

cuenta_aws() {
  aws sts get-caller-identity --query Account --output text --region "$REGION" 2>/dev/null \
    || fatal "El AWS CLI no esta autenticado. Corra 'aws configure' o exporte AWS_PROFILE."
}

# Lee una salida de la pila de CloudFormation.
salida_pila() {
  aws cloudformation describe-stacks \
    --stack-name "$PILA" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

pila_existe() {
  local estado
  estado="$(aws cloudformation describe-stacks --stack-name "$PILA"     --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null)"     || return 1

  # REVIEW_IN_PROGRESS es una pila que nunca se creo: la deja un change set
  # que no se ejecuto. describe-stacks la reporta, pero no tiene recursos ni
  # parametros guardados, asi que tratarla como existente lleva a la rama de
  # "actualizar" y falla pidiendo parametros que no hay de donde reusar.
  [ "$estado" = "REVIEW_IN_PROGRESS" ] && return 1

  # ROLLBACK_COMPLETE no se puede actualizar, solo borrar. Mejor decirlo que
  # dejar que aws cloudformation deploy falle con un mensaje opaco.
  if [ "$estado" = "ROLLBACK_COMPLETE" ]; then
    fatal "La pila '$PILA' quedo en ROLLBACK_COMPLETE de un intento fallido.
    Borrela antes de reintentar:
      aws cloudformation delete-stack --stack-name $PILA --region $REGION
      aws cloudformation wait stack-delete-complete --stack-name $PILA --region $REGION"
  fi
  return 0
}
