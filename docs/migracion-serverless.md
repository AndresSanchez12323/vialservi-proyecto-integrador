# Migracion de VialServi a serverless

Cuenta autorizada: **102098709715 (AndresX)**. En este equipo se usa
`--profile personal --region us-east-1`; nunca el perfil default educativo.

## Arquitectura objetivo

Navegador → CloudFront → S3 para la interfaz.
Para `/api/*`: CloudFront → API Gateway HTTP API → Lambda → Aurora
PostgreSQL Serverless v2 mediante Data API. Las evidencias siguen en el S3
privado existente, con enlaces firmados. El correo conserva SMTP y la clave
de sesiones conserva el parametro existente; no se invalidan sesiones por
rotar una clave durante la migracion.

Lambda no se conecta a una VPC: Data API es HTTPS con IAM. Asi puede acceder
a SMTP, S3 y SSM sin pagar NAT Gateway ni endpoints de red por hora. Aurora
permanece privada en las subredes existentes. No se usa RDS Proxy ni
Provisioned Concurrency, ni una tarea ECS que siga corriendo despues del corte.

Aurora usa PostgreSQL **16.15**, minimo **0 ACU**, maximo **2 ACU**, pausa tras
**300 segundos** sin actividad. Se comprobo que esta version admite minimo 0
en us-east-1. Hay un escritor, sin lector adicional: es una eleccion de costo,
no una configuracion de alta disponibilidad con replica caliente.

## Lo que NO significa serverless

- Mientras Aurora esta pausada no se cobra capacidad de la instancia, pero
  almacenamiento, copias, secretos y trafico pueden seguir teniendo costo.
- Una pagina abierta que consulta datos sigue siendo uso. No se debe programar
  una sonda repetida a `/api/listo`: despierta la base. `/api/salud` no la consulta.
- La primera consulta despues de la pausa puede tardar unos 15 segundos o mas.
  API Gateway admite unos 30 segundos; el handler usa 28 segundos. Si no alcanza,
  la peticion puede fallar y debe informarse al usuario. No repetir
  automaticamente escrituras: un timeout no demuestra que no se hayan guardado.
- La interfaz reactiva la base con GET `/api/listo` antes de enviar cambios,
  comparte esa peticion entre acciones concurrentes y recuerda el resultado dos
  minutos. Solo esa lectura puede reintentarse. No hay sondas periodicas; la
  reactivacion ocurre cuando el usuario intenta una accion.
- Aurora encendida durante muchas horas puede costar mas que una RDS micro.
  Esta configuracion busca ahorrar con **uso intermitente**, no garantiza ahorro
  bajo actividad permanente. El limite de 2 ACU limita escala, no la factura.

## Archivos

- `Dockerfile.lambda`: imagen Lambda Node 22; sin seed/migraciones al iniciar.
- `apps/api/src/lambda.ts`: adapta Express y obtiene JWT/SMTP de SSM.
- `apps/api/src/prisma.ts`: Prisma 6 usa Data API en Lambda y PostgreSQL directo
  en local. Se verifican bigint, commit y rollback con pruebas de contrato.
- `infra/cloudformation/aurora.yml`: cluster independiente con snapshots y
  proteccion contra borrado.
- `infra/cloudformation/lambda.yml`: funcion, rol minimo, HTTP API y logs de 14 dias.
- `infra/cloudformation/migracion.yml` y `Dockerfile.migracion`: tarea temporal
  para copia privada con pg_dump/pg_restore PostgreSQL 16 y TLS verificado.
- `infra/cloudformation/vialservi.yml`: conserva S3/CloudFront/red/SSM; parametros
  `OrigenApi`, `EndpointLambda`, `MantenerEcs` y `MantenerRds` permiten un corte
  gradual sin borrar toda la pila.
- `infra/desplegar-serverless.ps1`: redespliegues posteriores, solo si el corte
  ya esta activo. Verifica cuenta, exige pruebas contra base local, sube imagen
  inmutable y publica la interfaz sin borrar assets de pestanas abiertas.
- `infra/verificar-data-api.mjs`: comprobacion del adaptador sobre la copia
  previa al corte, incluyendo errores de unicidad y transacciones revertidas.
- El rol del aplicativo tiene un **Deny explicito** sobre `migracion-aurora/*`:
  las copias no se pueden descargar ni sobreescribir mediante las URL firmadas
  de evidencias. `infra/politicas/proteger-copias.json` permite aplicar ese bloqueo
  temporalmente mientras CloudFormation publica la politica definitiva.

## Procedimiento seguro

1. Verificar identidad y main, conservar cambios locales y crear rama de trabajo.
2. Correr pruebas locales, compilar API e imagen. Construir con
   `--platform linux/amd64 --provenance=false`: Lambda necesita una imagen
   de una arquitectura, no una lista de manifiestos de BuildKit.
3. Crear `vialservi-aurora` reutilizando VPC y grupo de subredes de `vialservi`.
   Habilitar `PermitirMigracion=true` solo durante la copia; volver a false al
   terminar para cerrar el ingreso PostgreSQL desde la tarea temporal.
   Esperar **tambien a que el escritor este available**: que el cluster reporte
   available no basta para recibir conexiones PostgreSQL.
4. Crear `vialservi-lambda` y la tarea temporal `vialservi-migracion`.
5. Copiar a la base vacia. Guardar dump cifrado en el prefijo privado
   `migracion-aurora/` del bucket de evidencias. Comparar numero de filas,
   huellas por tabla y valor/estado de cada secuencia. No mostrar filas ni claves.
6. Probar Lambda sobre esa copia: disponibilidad, login, autorizacion, consultas
   con relaciones, fechas, transacciones y evidencias. No correr el seed ni la
   suite destructiva de pruebas contra datos de produccion.
7. Para el corte final, crear snapshot de RDS, pausar escrituras y esperar que
   ECS quede sin tareas. Repetir copia con `CopiaFinal=true` solo sobre el cluster
   nuevo autorizado; verificar de nuevo. Si falla, restaurar ECS y no cambiar origen.
8. Actualizar `vialservi` con `OrigenApi=lambda` y `EndpointLambda` del HTTP API,
   manteniendo inicialmente ECS/RDS para recuperacion. Esperar CloudFront y
   probar por la URL publica, no solamente la entrada directa.
9. Una vez comprobado, retirar tarea temporal y actualizar `vialservi` con
   `MantenerEcs=false` y `MantenerRds=false`. CloudFormation crea snapshot al
   retirar RDS. Mantener VPC/subredes: Aurora depende de ellas. No borrar buckets.
10. Publicar la interfaz y verificar pausa real en CloudWatch
    (`ServerlessDatabaseCapacity=0`) tras cerrar sesiones y esperar inactividad.
    Documentar los snapshots/dumps retenidos: tambien tienen costo.

Si se vuelve a ECS despues de admitir escrituras en Aurora, primero hay que
sincronizar los datos de vuelta. Cambiar solo el origen hacia RDS perderia las
operaciones nuevas. Nunca hacer rollback ciego entre dos bases divergentes.

## Diagnostico

| Sintoma | Accion |
|---|---|
| Lambda rechaza ReservedConcurrentExecutions | Una cuenta nueva puede no tener cuota libre suficiente. No reservar concurrencia; mantener throttling del HTTP API y revisar cuota. No crear capacidad provisionada. |
| ECONNREFUSED al copiar | Comprobar estado del escritor, no solo del cluster, antes de volver a correr la tarea. |
| DatabaseResumingException | La base esta despertando. Solo se reintenta este error antes de que AWS ejecute la consulta. |
| 503/timeout tras inactividad | Consultar logs Lambda y latencia de reanudacion. No resolver manteniendo la base despierta con sondas. |
| Aurora no pausa | Revisar conexiones TCP abiertas, consultas periodicas, Proxy y funciones incompatibles con pausa. |
| REVIEW_IN_PROGRESS | Un change set no ejecutado no equivale a infraestructura lista. |
| ROLLBACK_COMPLETE | No permite actualizar: revisar eventos y retirar solamente la pila fallida, nunca la pila productiva con datos. |

Fuentes: [Pausa automatica de Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html),
[Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html).

## Estado

Migracion completada el **10 de octubre de 2026** en la cuenta **102098709715**.

- `vialservi`, `vialservi-lambda` y `vialservi-aurora` terminaron correctamente.
  La pila temporal `vialservi-migracion` se retiro despues de verificar la copia.
- URL conservada: https://d30qod6v3z8d4e.cloudfront.net.
- Copia final verificada: 12 tablas, incluida la tabla de migraciones, y todas
  las secuencias. Habia 9 usuarios, 10 servicios, 8 expedientes y 23 evidencias.
  No se ejecuto seed contra produccion ni se cambiaron claves de usuarios.
- Se probaron disponibilidad, login central/tecnico, servicios, tecnicos,
  notificaciones y reportes por CloudFront. La restriccion de rol devuelve 403
  JSON y una ruta del API inexistente devuelve 404, sin sustituirlos por HTML.
- Se verificaron fechas, relaciones, agrupaciones, conteos, commit, rollback y
  errores P2002 usando Prisma 6 con Data API sobre la copia previa al corte.
- **101 pruebas locales aprobadas**, API/interfaz compiladas e imagen Lambda
  desplegada por digest inmutable.
- CloudWatch registro `ServerlessDatabaseCapacity=0` entre 15:22 y 15:26,
  hora Colombia. Una peticion posterior reactivo la base y respondio
  correctamente en **28,9 segundos**. No es una garantia de latencia: la
  interfaz ahora realiza la lectura previa para evitar reintentar cambios.
- ECS, ALB y la instancia `vialservi-postgres` fueron retirados. VPC, subredes,
  CloudFront, S3 y parametros JWT/SMTP se conservaron. Aurora quedo sin ingreso
  TCP de migracion; usa Data API.
- El Deny de IAM sobre las copias se comprobo con `simulate-principal-policy`:
  resultado `explicitDeny`. Se elimino la politica temporal despues de que
  CloudFormation incorporo la proteccion definitiva.

Respaldos conservados (generan costo de almacenamiento):

- RDS `vialservi-antes-serverless-20261010`.
- RDS `vialservi-snapshot-basedatos-5kqu15klf4s5`, creado al retirar la instancia.
- Dumps privados `migracion-aurora/20261010-ensayo.dump` y
  `migracion-aurora/20261010-final.dump` en el bucket de evidencias, excluidos
  del acceso del rol del aplicativo.

La auditoria de dependencias sigue reportando avisos heredados (incluido
Nodemailer y herramientas de desarrollo). No se aplico `npm audit fix --force`
ni se afirma que esta migracion resuelva toda la seguridad del proyecto.
