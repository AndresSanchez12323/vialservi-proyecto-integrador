# Instrucciones para la siguiente IA

Leer README.md y MIGRATION.md completos. La existencia de estos archivos NO
autoriza ejecutar apply, trasladar datos, leer secretos ni retirar origen.
Esperar la instrucción de ejecución en la sesión futura.

- Código base: bc72221eb6edc7e980ea90cc340a3eb5c5661a16, PR #15 integrado.
- Usar Terraform/scripts/Deploy.ps1. Los scripts originales de infra apuntan
  a la cuenta personal: no utilizarlos para desplegar en la nueva cuenta.
- Perfil, cuenta y región explícitos; STS antes de escribir. Destino distinto
  de 102098709715 y 497502378363. La cuenta educativa está excluida.
- Esta preparación no inspeccionó AWS en vivo. Inventariar metadatos antes de
  ejecutar, sin recuperar secretos ni imprimir claves, datos de usuarios o fotos.
- Infraestructura no equivale a migración de datos. Copiar snapshot a destino
  antes del primer apply raíz; verificar huellas y secuencias antes de migrar
  esquema. Copiar evidencias históricas y marcas de borrado, conservando claves.
- Correo y cuenta destino requieren información real del operador; no inventarla.
- No ejecutar npm test, db:seed o db:push contra la copia restaurada.
- No usar latest ni -target para resolver dependencias. Conservar los lockfiles.
- No guardar secretos en tfvars, planes, salidas o conversación. Usar entrada
  oculta y las variables efímeras provistas. No rotar JWT de forma implícita.
- Proteger state, snapshots y manifiestos. Respaldar el estado local de bootstrap.
- No borrar origen ni recursos ajenos, especialmente Minecraft. La retirada
  requiere instrucción separada, aceptación del destino y respaldo independiente.
- Informar cuenta/región, acciones realizadas, pruebas reales y limitaciones.
  Un plan con mocks no equivale a un despliegue exitoso.
