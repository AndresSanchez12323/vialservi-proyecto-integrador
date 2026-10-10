# VialServi: reglas de despliegue y cuentas

- AndresX / Andres X / cuenta personal = **102098709715**. En este PC los
  perfiles `personal` y `AndresX` se verificaron apuntando a esa misma cuenta.
- Cuenta educativa / universidad / clase = **497502378363**, perfil `default`.
  NO usarla para VialServi. Si el usuario pide migrar alli, detenerse y aclarar
  que es una cuenta distinta antes de cualquier escritura.
- Toda llamada AWS debe indicar perfil y region explicitamente. Para este
  proyecto: `--profile personal --region us-east-1`. Antes de escribir,
  comprobar STS y detenerse si Account no es 102098709715.
- No leer ni imprimir archivos de credenciales, contrasenas, tokens o valores
  de SSM/Secrets Manager. No tocar recursos de Minecraft ni proyectos ajenos.

## Arquitectura aprobada

CloudFront/S3 → HTTP API → Lambda → Aurora PostgreSQL Serverless v2 con
Data API. Minimo 0 ACU, maximo 2, pausa 300 segundos, sin NAT, RDS Proxy ni
capacidad Lambda provisionada. Las evidencias conservan su S3 privado.
No prometer factura cero: almacenamiento, copias y secretos siguen cobrando.

Leer `docs/migracion-serverless.md` antes de actuar. Para redespliegues usar
`infra/desplegar-serverless.ps1`; los scripts Bash originales son de ECS/RDS,
no deben recrear el montaje anterior por accidente. Comprobar estado real de
CloudFormation antes de afirmar que termino un despliegue.

Conservar VPC/subredes, buckets y parametros JWT/SMTP de `vialservi`: los usa
el montaje nuevo. No borrar toda esa pila. Nunca correr seed ni pruebas
destructivas contra produccion. Mantener datos, huellas de tablas y secuencias
al migrar; el rollback entre bases requiere sincronizacion si ya hubo escrituras.

Preservar cambios locales ajenos al trabajo. Para cambios de codigo usar rama
`codex/`, pruebas y PR; no incluir material universitario generado ni cambios
del usuario en README sin revisarlos y sin que pertenezcan a la tarea.
