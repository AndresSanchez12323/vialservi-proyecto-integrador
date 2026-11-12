# Trasladar datos y hacer el corte: ejecución FUTURA

> **Aviso (11 nov. 2026): el origen ya no existe.** Ese día se retiró por
> completo la web de la cuenta 102098709715 (Aurora, Lambda, API, CloudFront,
> buckets, ECR, SES y snapshots). Los pasos 2 y 4 de abajo (snapshot
> compartido y copia de evidencias desde origen) **ya no se pueden hacer**.
> Los datos quedaron en una copia local verificada que el dueño del proyecto
> entrega en privado (no está en Git porque trae datos personales):
>
> 1. Desplegar con `snapshot_identifier = null` (base vacía) y aplicar las
>    migraciones con `database.mjs migrate` (paso 3).
> 2. Ejecutar `base/vialservi-20261111-datos-inserts.sql` de la copia por
>    Data API, una sentencia por llamada en una transacción (`splitSql` de
>    `scripts/sql.mjs` las separa). Probado sobre el esquema de las 5
>    migraciones de `main`; deja también las secuencias.
> 3. Subir `s3/vialservi-evidencias-102098709715/actual/evidencias/` de la
>    copia al bucket de evidencias nuevo, con las mismas claves.
> 4. Verificar contra `base/huellas-origen.json` (filas por tabla) y seguir
>    con el paso 5. El `LEEME.md` de la copia tiene el detalle.
>
> El resto del documento queda como referencia de cómo se planeó el traslado.

Estos pasos no se han ejecutado. Requieren autorización futura tanto para las
operaciones de origen como las de destino. No retirar nada de origen durante
el ensayo. Conservar una copia independiente y cifrada de base y evidencias.

## 1. Identidades y ensayo

Cuenta ORIGEN autorizada: 102098709715, perfil personal, región us-east-1.
Cuenta DESTINO: nueva cuenta por definir; perfil vialservi-destino,
us-east-1. Nunca usar la cuenta educativa. Todos los ejemplos de AWS indican
perfil y región; reemplazar los marcadores antes de ejecutarlos.

```powershell
# Cuenta ORIGEN: solo comprobar identidad; detenerse si no es 102098709715.
aws sts get-caller-identity --profile personal --region us-east-1
# Cuenta DESTINO: comprobar que corresponde al ID nuevo, distinto de las dos actuales.
aws sts get-caller-identity --profile vialservi-destino --region us-east-1
```

En el futuro, inventariar metadatos de CloudFormation, Lambda, Aurora y S3:
nombres, ARN, configuración, versión de imagen, CORS y correo. No leer valores
SSM/Secrets Manager. Usar ARN de secreto RDS como referencia, no su contenido.
La aplicación ya tiene configuración para leer sus secretos por IAM.

Primero hacer un ensayo sobre una copia. El ensayo no es el corte: si el origen
recibe escrituras después, se necesita otra copia final. Para el corte usar un
montaje nuevo o un proyecto separado; no reemplazar a ciegas el cluster protegido
del ensayo. No desactivar prevent_destroy para forzar el reemplazo.

Antes de la copia final, congelar escrituras de la aplicación origen con un
mecanismo de mantenimiento aprobado y comprobar que no queden invocaciones
escribiendo. Si se usa concurrencia Lambda 0, afecta también lecturas y login;
registrar el límite anterior y cómo restaurarlo. No crear concurrencia
provisionada. Las URL S3 ya firmadas pueden seguir aceptando subidas hasta
15 minutos: esperar su vencimiento y verificar que no haya escrituras nuevas
antes de la copia final de base y evidencias. No basta con cerrar un navegador.

## 2. Snapshot cifrado e independiente de origen

Completar primero Bootstrap en destino (ver README). Para Aurora cifrada con
la clave administrada `aws/rds`, el snapshot no se puede compartir directamente.
Hace falta una copia en origen con una CMK propia, permiso sobre esa CMK y
compartir el snapshot. Después, **copiarlo de verdad a destino con KMS de
destino**; compartirlo sin copiarlo deja dependencia de la cuenta personal.

Para preparar esa CMK temporal, copiar `migration-kms-policy.example.json` a
`Terraform/artifacts/migration-kms-policy.json` y reemplazar 000000000000 por
el ID destino. La política solo sirve para la clave nueva de transferencia.
No aplicarla sobre una clave existente de otro proyecto. El operador destino
también necesita permiso IAM para usar la CMK de origen y la de destino.

Ejemplos para la sesión futura (comprobar existencia por nombre/alias antes
de crear; reutilizar si ya existe y verificar sus permisos sin sustituirlos):

```powershell
# Cuenta ORIGEN. Solo si NO existe alias/vialservi-transferencia-origen:
aws kms create-key --description vialservi-transferencia-origen --policy file://Terraform/artifacts/migration-kms-policy.json --query KeyMetadata.Arn --output text --profile personal --region us-east-1
# Guardar el ARN mostrado en $SourceKmsArn (no es un secreto).
aws kms create-alias --alias-name alias/vialservi-transferencia-origen --target-key-id $SourceKmsArn --profile personal --region us-east-1

# Cuenta ORIGEN. Usar nombres nuevos y estables para esta copia final:
aws rds create-db-cluster-snapshot --db-cluster-identifier vialservi-aurora --db-cluster-snapshot-identifier vialservi-transfer-final --profile personal --region us-east-1
aws rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier vialservi-transfer-final --profile personal --region us-east-1
aws rds copy-db-cluster-snapshot --source-db-cluster-snapshot-identifier arn:aws:rds:us-east-1:102098709715:cluster-snapshot:vialservi-transfer-final --target-db-cluster-snapshot-identifier vialservi-transfer-compartible --kms-key-id $SourceKmsArn --profile personal --region us-east-1
aws rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier vialservi-transfer-compartible --profile personal --region us-east-1
aws rds modify-db-cluster-snapshot-attribute --db-cluster-snapshot-identifier vialservi-transfer-compartible --attribute-name restore --values-to-add $TargetAccountId --profile personal --region us-east-1

# Cuenta DESTINO. Obtener la CMK creada por bootstrap:
$DestinationKmsArn = terraform -chdir=Terraform/bootstrap output -raw snapshot_copy_kms_arn
aws rds copy-db-cluster-snapshot --source-db-cluster-snapshot-identifier arn:aws:rds:us-east-1:102098709715:cluster-snapshot:vialservi-transfer-compartible --target-db-cluster-snapshot-identifier vialservi-recibido-final --kms-key-id $DestinationKmsArn --profile vialservi-destino --region us-east-1
aws rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier vialservi-recibido-final --profile vialservi-destino --region us-east-1
```

No reutilizar nombres de una copia anterior para otra fecha de corte: si ya
existen, inspeccionar su fecha/ARN y decidir si corresponden al ensayo o final.
El `wait` debe terminar y el snapshot destino debe indicar available y una
KmsKeyId de la cuenta nueva. No limpiar ni revocar nada de origen todavía.

Configurar `snapshot_identifier = "vialservi-recibido-final"` en el JSON raíz
y ejecutar Infrastructure. Aurora quedará cifrada con KMS de destino y una
contraseña administrada nueva en Secrets Manager destino. El snapshot conserva
datos y contraseñas de usuarios de la app; la contraseña administrativa RDS
puede cambiar sin afectar sus logins. Esperar cluster **y escritor** disponibles.

## 3. Comparar base ANTES de aplicar migraciones nuevas

Instalar dependencias del repositorio con `npm.cmd ci`, sin ejecutar setup
(setup ejecuta seed). El inventario usa Data API sin recuperar el secreto.
Crear archivos nuevos bajo `Terraform/artifacts/`; no enviarlos al chat.

```powershell
# Cuenta ORIGEN; sustituir ambos ARN por los de Aurora, solo referencias.
node Terraform/scripts/database.mjs inventory --profile personal --account 102098709715 --region us-east-1 --source-read-only --cluster $SourceClusterArn --secret $SourceSecretArn --manifest Terraform/artifacts/source-final.json
# Cuenta DESTINO; lee los ARN del estado Terraform destino.
node Terraform/scripts/database.mjs inventory --profile vialservi-destino --account $TargetAccountId --region us-east-1 --manifest Terraform/artifacts/target-before-schema.json
```

Comparar todos los conteos, huellas por tabla y valor/estado de **cada secuencia**:

```powershell
node Terraform/scripts/compare-manifests.mjs Terraform/artifacts/source-final.json Terraform/artifacts/target-before-schema.json
```

Si difieren, detener el corte y diagnosticar. No repetir la restauración sobre
un destino con escrituras. No mostrar filas ni contraseñas para comparar.
La huella agregada está pensada para el volumen universitario; si una tabla
produce un resultado SQL demasiado grande, particionar la comparación mediante
una migración supervisada, no omitir esa tabla.

Una vez idénticas, aplicar el esquema actual en destino:

```powershell
# Cuenta DESTINO exclusivamente. No seed, db:push ni suite destructiva.
node Terraform/scripts/database.mjs migrate --profile vialservi-destino --account $TargetAccountId --region us-east-1 --approve-destination-schema
```

El origen puede estar detrás del código Git; el último PR añadió tres
migraciones. El script revisa la tabla `_prisma_migrations`, valida checksum y
solo aplica las pendientes, una transacción por migración, con bloqueo.
Rechaza migraciones divergentes o incompletas. No reparar checksums manualmente
para evitar el diagnóstico. Después del cambio de esquema es normal que la
huella de tablas con columnas nuevas cambie: comparar copia exacta **antes**.

## 4. Copiar evidencias con sus versiones

El bucket destino debe estar vacío y los escritores origen detenidos para el
corte. El script lee con el perfil origen y escribe con el de destino, sin
abrir políticas públicas o crear accesos cruzados permanentes. Necesita
ListBucketVersions/GetObjectVersion/GetObjectTagging en origen y permisos
S3 de lectura/escritura/versiones en destino. No utilizar el rol de la app:
su Deny sobre `migracion-aurora/*` impide trasladar respaldos.

```powershell
# Origen personal; destino cuenta nueva. Ambos en us-east-1.
# Primera ejecución: solo inventario, sin copiar.
node Terraform/scripts/copy-evidence.mjs --source-profile personal --source-account 102098709715 --source-bucket $SourceEvidenceBucket --target-profile vialservi-destino --target-account $TargetAccountId --target-bucket $TargetEvidenceBucket --region us-east-1
# Después de revisar el inventario, habilitar la copia a DESTINO:
node Terraform/scripts/copy-evidence.mjs --source-profile personal --source-account 102098709715 --source-bucket $SourceEvidenceBucket --target-profile vialservi-destino --target-account $TargetAccountId --target-bucket $TargetEvidenceBucket --region us-east-1 --apply --manifest Terraform/artifacts/evidence-transfer.json
```

Mantiene claves, metadatos, etiquetas, versiones y marcas de borrado en orden
temporal. Descarga y verifica SHA-256 de cada versión copiada. Los VersionId
y LastModified de AWS cambian entre cuentas: el manifiesto conserva la
correspondencia. La app referencia evidencias por clave; no reescribir rutas
de la base. No traslada `ocr-tarjetas/`, que son imágenes temporales personales.

No cambia archivos de origen. No almacena objetos en disco ni hace el bucket
público. Mantiene una versión en memoria por vez (máximo 512 MiB); objetos
mayores requieren un traslado multipart supervisado. La copia histórica no es
reanudable sobre un bucket con datos: si falla, conservar el manifiesto y
resolver las versiones pendientes con supervisión. No vaciar el bucket ni
ejecutar de nuevo a ciegas; puede duplicar versiones y ocultar evidencias.

## 5. Publicación y aceptación

Configurar SMTP o SES y verificar envío real. SES puede requerir aprobación
del sandbox y correo de confirmación del propietario. Confirmar que las
variables de entorno y CORS usan el bucket/URL de destino, no los de origen.
No basta con tener una identidad SES creada si aún no está verificada.

Ejecutar Publish, después probar por CloudFront el flujo de cada rol,
evidencias y OCR con datos ficticios autorizados. Validar todos los puntos de
README. Conservar los manifiestos y sus resultados sin datos personales en Git.
Crear otro snapshot destino tras migrar el esquema y guardar su identificación.

Antes de admitir usuarios, confirmar independencia: imagen ECR destino,
ARN de cluster y secreto destino, claves KMS destino, SSM destino, bucket de
evidencias destino y proveedor de correo autorizado. No mantener conexiones
al origen como solución temporal inadvertida.

El corte cambia la URL CloudFront y, si se genera JWT nuevo, exige volver a
iniciar sesión. Avisar a los usuarios y actualizar marcadores/enlaces. La URL
CloudFront anterior no se puede reutilizar en la nueva distribución.

## 6. Rollback y retirada posterior

Si destino no recibió escrituras, se puede restablecer el servicio de origen
con su configuración anterior. Si ya recibió escrituras, **no volver a origen
sin sincronizar antes**: habría dos bases divergentes y pérdida de operaciones.
No dejar las dos instalaciones operativas con usuarios simultáneamente.

No se incluye ni se autoriza borrar origen en esta preparación. Una tarea
posterior debe identificar exclusivamente VialServi, preservar respaldos
independientes, comprobar aceptación y costos de retención, y obtener una
instrucción explícita para retirada. Nunca `terraform destroy` con un state
equivocado, borrar toda una cuenta o tocar Minecraft/proyectos ajenos.

Fuentes AWS: [compartir snapshots cifrados](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/share-encrypted-snapshot.html),
[copiar snapshots](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-copy-snapshot.html),
[cifrado Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Overview.Encryption.html).
