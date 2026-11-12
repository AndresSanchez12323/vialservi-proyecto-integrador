# VialServi: despliegue futuro en otra cuenta AWS

Preparado el **11 de noviembre de 2026**. Este Terraform todavía no se ha
desplegado. Código fijado al merge del PR #15:
`bc72221eb6edc7e980ea90cc340a3eb5c5661a16`.

El mismo 11 de noviembre se **retiró por completo** la web de la cuenta
anterior (102098709715): ya no hay origen del que copiar. Los datos se
restauran desde la copia local verificada; ver el aviso al inicio de
[MIGRATION.md](MIGRATION.md).

La configuración reproduce la arquitectura documentada en el repositorio.
No es un inventario en vivo de la cuenta actual: antes del traslado real,
contrastar los metadatos y configuración desplegados mediante lecturas
autorizadas, sin recuperar ni mostrar valores secretos.

## Recursos incluidos

| Servicio | Configuración |
|---|---|
| Red | VPC, dos subredes aisladas en AZ distintas, sin entrada PostgreSQL |
| Aurora | PostgreSQL 16.15, Data API, escritor db.serverless privado |
| Capacidad | 0–2 ACU, pausa 300 s, backup 7 días, KMS, protección de borrado |
| Lambda | Imagen Node 22 x86_64, 512 MB, 28 s, fuera de la VPC |
| HTTP API | Integración Lambda, límite 5 solicitudes/s y ráfaga 10 |
| CloudFront | HTTPS, S3 privado con OAC, rutas SPA, API sin caché |
| Evidencias | S3 privado, versiones, cifrado, CORS del dominio nuevo |
| OCR | Permiso Textract; eliminación de imágenes temporales al día |
| Histórico | Evidencias a STANDARD_IA después de 730 días |
| Secretos | JWT/SMTP en SSM SecureString; contraseña RDS administrada |
| Correo | SMTP, SES con identidad opcional, o consola para preparación |
| Operación | ECR inmutable, logs Lambda 14 días, estado S3 con bloqueo |

No recrea ECS, ALB, RDS convencional, NAT, RDS Proxy ni capacidad Lambda
provisionada. Textract se consume como API y no requiere un servidor dedicado.
La nueva distribución tendrá **otra URL CloudFront**; el dominio asignado por
AWS de la distribución actual no se transfiere.

## Archivos

- `bootstrap/`: ECR, bucket privado/versionado de estado y KMS para snapshots.
  El estado inicial del bootstrap es local: respaldarlo cifrado.
- `*.tf`: infraestructura de la aplicación.
- `scripts/Deploy.ps1`: Bootstrap, Build, Infrastructure y Publish.
- `scripts/Set-Secrets.ps1`: secretos efímeros mediante entrada oculta.
- `scripts/database.mjs`: inventarios y migraciones Data API, sin seed.
- `scripts/copy-evidence.mjs`: transferencia histórica S3 con SHA-256.
- `MIGRATION.md`: traslado de datos, corte, verificaciones y límites.
- `AGENTS.md`: instrucciones para la IA que ejecute el trabajo futuro.
- `tests/`: planes con proveedor simulado, sin AWS.

**Terraform no copia los datos automáticamente.** Los usuarios, expedientes,
contraseñas hasheadas, secuencias y evidencias se conservan mediante el recorrido
de MIGRATION.md. `snapshot_identifier = null` crea una base vacía. No ejecutar
el seed de demostración contra el destino restaurado.

## Requisitos

Terraform >=1.11 y <2; AWS provider 6.x fijado en `.terraform.lock.hcl`; AWS CLI
v2; Node >=20; Docker con imágenes Linux/amd64; PowerShell en Windows 5.1 o 7.
Los scripts usan `npm.cmd`: para Linux, adaptar ese nombre y la autenticación ECR.

La nueva cuenta debe disponer de permisos IAM/KMS/S3/ECR/VPC/RDS/Lambda/API
Gateway/CloudFront/SSM/CloudWatch y SES si aplica. Revisar cuotas y disponibilidad
de Aurora 16.15 con Data API/pausa a cero antes de aplicar. Si se retira esa
versión, seleccionar una compatible deliberadamente; no cambiar a capacidad
permanente para evitar el diagnóstico.

Un perfil exclusivo, por ejemplo `vialservi-destino`, debe apuntar a la cuenta
nueva. Se bloquean como destino las cuentas **102098709715** y **497502378363**,
y los perfiles `personal`, `AndresX` y `default` en el script principal.

Para correo funcional hace falta SMTP válido o SES verificado. La aceptación
del correo de verificación y la salida del sandbox SES requieren intervención
externa y no pueden garantizarse con Terraform.

## Configurar y ejecutar MÁS ADELANTE

Desde la raíz del repositorio, copiar el ejemplo y editarlo:

```powershell
Copy-Item Terraform/terraform.example.tfvars.json Terraform/terraform.tfvars.json
```

| Campo | Qué indicar |
|---|---|
| `aws_profile` | Perfil exclusivo de destino |
| `target_account_id` | ID real de 12 dígitos de la nueva cuenta |
| `project` | `vialservi`, salvo colisión con una instalación previa |
| `source_commit` | SHA fijado arriba, o nueva revisión validada deliberadamente |
| `snapshot_identifier` | Snapshot copiado a destino antes del primer apply raíz |
| `mail_mode` | `smtp` o `ses`; consola solo permite preparar el montaje |
| `mail_sender` | Remitente autorizado por el proveedor |
| `smtp_host/port/user` | Configuración pública SMTP; la clave va fuera del archivo |
| `ses_email_identity` | Correo que se verificará por SES, o null |
| `secret_version` | 1 inicialmente; aumentar solo al rotar JWT/SMTP |

No copiar ARNs de secretos o imágenes ECR de la cuenta personal al destino.
El archivo de variables real, estados, planes y artefactos están ignorados por Git.

### 1. Bootstrap e imagen

Todos estos comandos son instrucciones para la ejecución futura:

```powershell
# Cuenta DESTINO: los scripts añaden perfil y región a cada llamada AWS.
./Terraform/scripts/Deploy.ps1 -Phase Bootstrap
# Revisar el plan; esta variante sí crea recursos en destino:
./Terraform/scripts/Deploy.ps1 -Phase Bootstrap -Apply
./Terraform/scripts/Deploy.ps1 -Phase Build -Apply
```

Build comprueba que aplicación, lockfile y Dockerfile coincidan con el commit
fijado, instala dependencias, compila y publica la imagen por digest. Genera
`Terraform/image.auto.tfvars.json`. No utiliza una imagen ficticia, `latest`
ni `terraform -target`. Bootstrap debe terminar antes de crear Lambda.

### 2. Trasladar datos y preparar secretos

Desde el 11 de noviembre de 2026 no hay producción que conservar: dejar
`snapshot_identifier = null` y cargar los datos en el paso 4 con `restore`.
(Si algún día se trasladara desde una base viva, seguir MIGRATION.md y fijar
el snapshot copiado en `snapshot_identifier` **antes del primer apply raíz**.) Cambiar ese
campo después reemplazaría Aurora y será bloqueado por `prevent_destroy`.

En la misma sesión PowerShell, cargar JWT/SMTP sin mostrarlos:

```powershell
# Sin SMTP: generar un JWT nuevo para la primera creación.
./Terraform/scripts/Set-Secrets.ps1 -GenerateJwt
# Si usa SMTP, usar EN SU LUGAR entrada oculta de ambos secretos:
# ./Terraform/scripts/Set-Secrets.ps1 -Smtp
```

JWT nuevo invalida sesiones anteriores, pero no cambia contraseñas guardadas
de los usuarios. Para preservar JWT, un operador debe trasladarlo mediante un
canal seguro autorizado, fuera del chat y sin mostrarlo a la IA. No se incluye
ninguna herramienta que lea secretos de origen.

Los secretos usan variables efímeras y `value_wo`: no quedan en plan/state.
Mantener la sesión para aplicar el plan. Para otra sesión, introducir los
mismos valores desde su gestor seguro con `Set-Secrets.ps1`. No generar JWT
nuevo por rutina ni aumentar `secret_version` salvo rotación deliberada.

### 3. Infraestructura

```powershell
./Terraform/scripts/Deploy.ps1 -Phase Infrastructure
# Revisar el plan completo antes de habilitar la escritura:
./Terraform/scripts/Deploy.ps1 -Phase Infrastructure -Apply
```

El script verifica STS, configura backend S3 de destino con perfil/cuenta
explícitos, cifrado y bloqueo `use_lockfile`, y espera a los recursos. No crea
tablas DynamoDB de bloqueo. Conservar aparte el estado local del bootstrap.

### 4. Esquema y publicación

Tras comprobar la copia de base y evidencias según MIGRATION.md:

```powershell
# Cuenta DESTINO: reemplazar cuenta y perfil. Nunca usar default.
node Terraform/scripts/database.mjs migrate --profile vialservi-destino --account 000000000000 --region us-east-1 --approve-destination-schema
# Datos de la copia local (base vacía; todo o nada; ver aviso de MIGRATION.md):
$Copia = 'C:\ruta\a\Respaldo_web_VialServi_AndresX_20261111'   # carpeta de la copia local
node Terraform/scripts/database.mjs restore --profile vialservi-destino --account 000000000000 --region us-east-1 --backup $Copia --approve-destination-restore
# Subir evidencias de la copia: comando en el aviso de MIGRATION.md.
./Terraform/scripts/Deploy.ps1 -Phase Publish -Apply
```

El migrador aplica únicamente migraciones pendientes con checksum, transacción
y bloqueo. No ejecuta seed. Publish verifica disponibilidad, sube assets antes
de index, conserva assets anteriores e invalida CloudFront. No reintenta
escrituras ambiguas. No publicar el corte definitivo mientras origen admita
escrituras. `/api/listo` no demuestra que la copia esté completa: comparar
también los inventarios.

## Validación y límites

Con correo en consola se conserva login y operación existente; iniciar las
nuevas verificaciones devuelve 503. Para habilitar registro, alta de técnicos
y cambio de clave completo, configurar SMTP/SES y comprobar entrega real.

Probar la URL CloudFront: salud, disponibilidad, login por rol, rutas SPA,
servicios, histórico, permisos 401/403, 404 JSON del API, evidencia firmada,
OCR de imagen ficticia y eliminación por versión. Las pruebas de escritura
requieren registros autorizados. Nunca `npm test`, `db:seed` o `db:push`
contra datos restaurados. Para pausa a cero, cerrar clientes y comprobar
CloudWatch; no configurar sondeos periódicos que despierten Aurora.

Las cuotas, correo real, restauración de snapshots y comportamiento en AWS
deben verificarse al ejecutar. Los planes simulados no sustituyen esas pruebas.
Storage, KMS, copias, secretos, Textract, logs y tráfico pueden generar cobros
incluso con Aurora pausada; no se promete factura cero.

Clusters, buckets, KMS, ECR y parámetros tienen protección contra destrucción.
No hay script de borrado de la instalación personal. Su retirada será una
tarea posterior, explícita y separada de este despliegue.

## Validar localmente sin AWS

```powershell
terraform -chdir=Terraform init -backend=false
terraform -chdir=Terraform fmt -check -recursive
terraform -chdir=Terraform validate
terraform -chdir=Terraform test
terraform -chdir=Terraform/bootstrap init -backend=false
terraform -chdir=Terraform/bootstrap validate
node --test Terraform/scripts/sql.test.mjs Terraform/scripts/restore.test.mjs
```

`init -backend=false` descarga proveedores sin abrir la cuenta ni el backend.
Los tests usan `mock_provider`. Antes de desplegar, Deploy.ps1 reinicializa
el backend real y verifica la cuenta.

Fuentes: [Aurora Terraform](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/rds_cluster),
[SSM write-only](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ssm_parameter),
[snapshots cifrados](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/share-encrypted-snapshot.html),
[copia de snapshots](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-copy-snapshot.html).
