# Despliegue de VialServi en AWS

Guía para dejar el aplicativo funcionando en línea desde el AWS CLI.
Todo se hace con tres comandos; el resto del documento explica qué hace cada
uno, qué servicios se usan y cómo arreglar lo que suele fallar.

---

## 1. Qué se monta y por qué

```
                        ┌──────────────────────────────┐
   Navegador ─HTTPS──►  │        CloudFront            │
                        │  (certificado incluido)      │
                        └──────┬───────────────┬───────┘
                               │  /*           │  /api/*
                        ┌──────▼──────┐  ┌─────▼──────────────┐
                        │  S3 (SPA)   │  │ Balanceador (ALB)  │
                        │   privado   │  └─────┬──────────────┘
                        └─────────────┘        │
                                        ┌──────▼──────────────┐
                                        │  ECS Fargate        │
                                        │  contenedor del API │
                                        └──┬───────────┬──────┘
                                           │           │
                                 ┌─────────▼──┐  ┌─────▼───────────┐
                                 │ RDS         │  │ S3 evidencias   │
                                 │ PostgreSQL  │  │ (URL prefirmadas)│
                                 │ privada     │  └─────────────────┘
                                 └─────────────┘
```

| Servicio | Para qué | Por qué este y no otro |
|---|---|---|
| **CloudFront** | Entrada única por HTTPS | Da un certificado válido **sin comprar dominio**. Y al compartir origen el SPA y el API, no hay CORS ni contenido mixto. Es además **requisito para la PWA de la etapa 2**: un service worker no se registra sin HTTPS. |
| **S3** (SPA) | Archivos de la interfaz | Servir archivos que no cambian desde Node es desperdiciar el contenedor. Privado, solo CloudFront lo lee. |
| **ALB** | Dirección estable para el API | CloudFront necesita un nombre de origen que no cambie. Una tarea de Fargate cambia de IP en cada despliegue. |
| **ECS Fargate** | Corre el API | No hay servidor que parchar ni SSH. El redespliegue es un comando. |
| **RDS PostgreSQL** | Datos | Un archivo SQLite no sobrevive a un redespliegue ni se comparte entre instancias. |
| **S3** (evidencias) | Fotos y videos | El navegador sube **directo** con URL prefirmada: un clip de 15 MB nunca pasa por el API. Es la pieza que faltaba para el trabajo sin señal. |
| **SSM Parameter Store** | Secretos | Hace lo mismo que Secrets Manager para este caso y los parámetros estándar no se cobran. |
| **SES** | Correo de recuperación | Opcional. Sin configurarlo, el API queda en modo consola y los códigos salen en CloudWatch. |
| **CloudWatch Logs** | Registros | Es donde se ve por qué falló algo. |

### Decisiones que conviene saber

- **Las tareas van en subredes públicas con IP pública.** Es a propósito: así
  alcanzan ECR y SES por el gateway de internet y **no hace falta un NAT
  Gateway**, que costaría más que todo lo demás junto. No quedan expuestas
  porque el grupo de seguridad solo admite tráfico del balanceador.
- **La base es `db.t3.micro` con PostgreSQL `16.15`.** La clase se escribe
  completa y la versión también, con su *minor*. Son dos cosas que AWS cambia
  sin avisar y que solo se descubren al desplegar: `db.t4g.micro` **no se
  ofrece** para PostgreSQL en `us-east-1` —y el error que devuelve habla de
  falta de capacidad, no de que la combinación no exista—, y pedir la versión
  mayor a secas (`'16'`) está retirado. Las dos están cubiertas por la capa
  gratuita por igual. Antes de cambiarlas, comprobar qué hay:

  ```bash
  aws rds describe-orderable-db-instance-options --engine postgres     --engine-version 16.15 --region us-east-1     --query 'OrderableDBInstanceOptions[?contains(DBInstanceClass,`micro`)].[DBInstanceClass,StorageType]'
  ```

- **La base de datos es privada y no tiene acceso público.** Las migraciones las
  aplica el contenedor al arrancar, así que nunca hay que abrirla a internet.
- **Entre CloudFront y el balanceador el tráfico va sin cifrar** por la red de
  AWS. Para un proyecto académico es aceptable; cómo subirlo a HTTPS de punta a
  punta está en la sección 8.

### Costo aproximado

Con la capa gratuita de los primeros 12 meses, lo único que se cobra de verdad
es el balanceador. Órdenes de magnitud, **verifíquenlos** en la calculadora de
AWS porque los precios cambian y dependen de la región:

| Recurso | Aprox. al mes |
|---|---|
| ALB | ~16–20 USD (se cobra por hora aunque nadie lo use) |
| Fargate (1 tarea mínima) | ~8–12 USD |
| RDS db.t3.micro | 0 USD el primer año, luego ~12–15 USD |
| S3 + CloudFront + SSM + logs | centavos con este tráfico |
| **Total** | **~25–35 USD/mes** |

Con 200 USD de crédito alcanza para unos 6–8 meses. **Si no lo van a usar por
un tiempo, apáguenlo** (sección 7): bajar el servicio a 0 tareas y borrar el
balanceador deja el gasto casi en cero sin perder los datos.

---

## 2. Antes de empezar

Necesitan instalado y funcionando:

```bash
aws --version          # AWS CLI v2
docker --version       # para construir la imagen
node --version         # 20 o superior
aws sts get-caller-identity   # debe responder con su número de cuenta
```

Si el último comando falla, autentiquen el CLI con `aws configure` (o
`aws configure sso`). La región por defecto de esta guía es `us-east-1`; para
usar otra, exporten `REGION=...` antes de cada script.

> **CloudFront y la región.** Los scripts crean todo en una sola región.
> CloudFront es global, así que no hay nada especial que hacer.

---

## 3. Desplegar: los tres comandos

Desde la raíz del repositorio:

```bash
# 1) Construye la imagen del API y la sube a ECR.
#    La primera vez solo sube: imprime la URI de la imagen al final.
./infra/desplegar-api.sh

# 2) Crea toda la infraestructura. Pega la URI que imprimió el paso anterior.
#    Genera sola la contraseña de la base y la clave de sesión, y las guarda en
#    SSM: nadie tiene que copiarlas a mano.
#    Tarda 15–20 minutos (RDS y CloudFront son lentos).
./infra/crear-infraestructura.sh 123456789012.dkr.ecr.us-east-1.amazonaws.com/vialservi-api:20261004-1200

# 3) Compila la interfaz, la sube a S3 e invalida la caché.
./infra/desplegar-web.sh
```

Al terminar, el paso 3 imprime la dirección del aplicativo:
`https://dXXXXXXXXXXXX.cloudfront.net`

### Cargar los usuarios de demostración

Recién creada, la base está **vacía**: no hay con qué iniciar sesión. Para
cargar los datos de demostración una vez:

```bash
# Enciende la siembra, reinicia la tarea para que corra el seed, y la apaga.
aws ecs update-service --cluster vialservi-cluster --service vialservi-api \
  --force-new-deployment --region us-east-1 \
  --task-definition "$(aws ecs register-task-definition \
      --cli-input-json "$(aws ecs describe-task-definition \
        --task-definition vialservi-api --region us-east-1 \
        --query 'taskDefinition' --output json \
        | python3 -c 'import json,sys;d=json.load(sys.stdin);
[c["environment"].append({"name":"SEMBRAR_DATOS","value":"true"}) for c in d["containerDefinitions"]];
[d.pop(k,None) for k in ("taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy")];
print(json.dumps(d))')" \
      --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text)"
```

Si ese comando les parece enredado —lo es—, la alternativa legible es hacerlo
desde la consola: **ECS → vialservi-api → Task definition → Create new
revision**, agregar la variable `SEMBRAR_DATOS=true`, desplegar, esperar a que
la tarea arranque, y **volver a quitarla**.

> ⚠️ **El seed BORRA las tablas antes de insertar.** Déjenlo encendido solo
> para la primera carga. Si se queda en `true`, cada despliegue vaciaría la
> base.

Usuarios que quedan cargados (clave `VialServi2026`): `1001` administrador,
`2001` central, `3001`/`3002` técnicos, `71234567` cliente.

---

## 4. Redesplegar después de un cambio

```bash
# Cambios en el API (incluye migraciones nuevas: se aplican al arrancar)
./infra/desplegar-api.sh

# Cambios en la interfaz
./infra/desplegar-web.sh
```

No hay que tocar la infraestructura para esto.

### Migraciones de base de datos

Al cambiar `schema.prisma`, **en local**:

```bash
npm run base:arriba                      # PostgreSQL en Docker
npm run db:migrate -- --name lo_que_cambio
```

Eso crea el archivo en `apps/api/prisma/migrations/`. **Súbanlo al repositorio**:
el contenedor aplica las migraciones pendientes al arrancar
(`prisma migrate deploy`), así que el siguiente `desplegar-api.sh` las lleva a
producción solo.

`prisma migrate deploy` toma un bloqueo en PostgreSQL, así que es seguro
aunque arranquen dos tareas a la vez.

---

## 5. Correo de recuperación con SES

> ⚠️ **Si pidieron la recuperación y no llegó ningún código, lo normal es que
> sea esto.** Recién desplegado, el API queda en `CORREO_MODO=consola`: el
> código se genera, se guarda y se valida bien, pero **solo se imprime en
> CloudWatch**. Al usuario no le llega nada, y la pantalla no puede avisarlo
> —decir «esa cuenta no tiene correo» revelaría qué cédulas existen—. Desde el
> arranque el API grita este aviso en el log; búsquenlo con
> `aws logs tail /ecs/vialservi-api --region us-east-1`.

Para que los correos salgan de verdad hay que hacer **tres** cosas. Las tres,
no una:

**1. Verificar el remitente en SES.**

```bash
aws ses verify-email-identity --email-address tucorreo@gmail.com --region us-east-1
```

Llega un correo de confirmación; hay que abrir el enlace. Sirve cualquier
dirección real a la que tengan acceso: no hace falta dominio propio.

**2. Volver a desplegar la pila con esa dirección.**

```bash
./infra/crear-infraestructura.sh    # pregunta por el remitente
```

Eso cambia `CORREO_MODO` de `consola` a `ses` en la definición de tarea. Sin
este paso el paso 1 no sirve de nada.

**3. Probar con una dirección que exista de verdad.**

Aquí está la trampa que más tiempo cuesta: **los correos de los usuarios de
demostración son ficticios** (`santiago@correo.com`, `admin@vialservi.co`…).
Si piden la recuperación con la cédula `71234567`, el código se manda a
`santiago@correo.com`, que no existe, y no llega nada **aunque SES esté
perfecto**.

Para probarlo de verdad: **creen una cuenta nueva** desde «Crear cuenta de
cliente» con su correo real, y recuperen esa. Es además lo que conviene mostrar
en la sustentación, porque recorre el registro y la recuperación en el mismo
acto.

> **El "sandbox" de SES.** Una cuenta nueva de AWS solo puede enviar a
> direcciones **verificadas**, no solo desde ellas. O sea: hay que verificar
> también la dirección que RECIBE. Si usan la misma para las dos cosas, con el
> paso 1 ya quedó. Para enviar a cualquiera hay que pedir salir del sandbox en
> la consola de SES (Account dashboard → Request production access); tarda unas
> horas y para la sustentación no hace falta.

### Comprobar en qué modo quedó

```bash
aws ecs describe-task-definition --task-definition vialservi-api --region us-east-1 \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='CORREO_MODO']"
```

Si devuelve `consola`, los correos no salen. Si devuelve `ses`, salen y los
rechazos de SES quedan en CloudWatch con el motivo.

---

## 6. Diagnóstico

```bash
# Logs del API en vivo. Es lo primero que hay que mirar.
aws logs tail /ecs/vialservi-api --follow --region us-east-1

# ¿La tarea está corriendo?
aws ecs describe-services --cluster vialservi-cluster --services vialservi-api \
  --region us-east-1 --query 'services[0].{estado:status,deseadas:desiredCount,activas:runningCount}'

# ¿Por qué se murió la última tarea?
aws ecs describe-tasks --cluster vialservi-cluster --region us-east-1 \
  --tasks "$(aws ecs list-tasks --cluster vialservi-cluster --region us-east-1 \
    --query 'taskArns[0]' --output text)" \
  --query 'tasks[0].{estado:lastStatus,razon:stoppedReason,contenedores:containers[].reason}'

# ¿El API ve la base de datos?
curl https://dXXXXXXXXXXXX.cloudfront.net/api/listo
```

| Síntoma | Causa más probable |
|---|---|
| `exec format error` en los logs | La imagen se construyó para ARM (Mac con chip Apple). Los scripts ya fuerzan `--platform linux/amd64`; si construyeron a mano, agréguenlo. |
| La tarea arranca y muere en bucle | Falló `prisma migrate deploy`. Casi siempre es `DATABASE_URL` o el grupo de seguridad. Mírenlo en los logs. |
| `/api/listo` responde 503 | El API está vivo pero no llega a RDS. Revisen que `SgBaseDatos` admita a `SgApi`. |
| 502 o 504 desde CloudFront | El balanceador no tiene destinos sanos. Vean el *target group* en la consola de EC2. |
| El login responde 401 con la clave correcta | La base está vacía: falta cargar los datos de demostración (sección 3). |
| Pedí la recuperación y no llegó ningún correo | `CORREO_MODO=consola` (lo más común), o SES sin remitente verificado, o el usuario tiene un correo ficticio del seed. Las tres se resuelven en la sección 5. |
| Cambié el SPA y sigo viendo lo viejo | Falta la invalidación. `desplegar-web.sh` ya la hace; esperen 1–2 minutos. |
| Una recarga en `/expedientes/3` da error | Ya está resuelto con las respuestas de error 403/404 → `index.html`. Si lo ven, la distribución quedó mal creada. |
| `AlreadyExistsException` al crear | El nombre del bucket ya existe (son globales). Cambien `PROYECTO`. |
| El script dice «la pila ya existe: se actualiza» y falla pidiendo `JwtSecret` | La pila está en `REVIEW_IN_PROGRESS`: el cascarón que deja un *change set* que no llegó a ejecutarse. `describe-stacks` la reporta, pero no guarda parámetros que reusar. Bórrenla y reintenten. |
| `ROLLBACK_COMPLETE` y no hay forma de actualizar | Una pila que falló al crearse no se actualiza, solo se borra: `aws cloudformation delete-stack --stack-name vialservi --region us-east-1`. El script ya lo detecta y lo dice. |
| `ResourceExistenceCheck` falló en la validación previa | Un recurso con `DeletionPolicy: Retain` sobrevivió al borrado de la pila —el bucket de evidencias, normalmente— y choca con el que se quiere crear. Si está vacío, bórrenlo; si tiene evidencias, **no**: cambien `PROYECTO`. |
| `exec /app/arranque.sh: no such file or directory` | No falta el archivo: falta el intérprete. El `.sh` quedó con finales de línea CRLF y el shebang pide `/bin/sh
`. Pasa al clonar en Windows con `core.autocrlf=true`. El `.gitattributes` lo previene; si ya ocurrió, reconviertan a LF y reconstruyan. |
| Subí una imagen nueva con la misma etiqueta y ECS sigue con la vieja | ECS resuelve la etiqueta a un *digest* **una sola vez, al iniciar el despliegue**, y lo fija para todas sus tareas. Sobrescribir la etiqueta no afecta a un despliegue en curso: `aws ecs update-service --force-new-deployment` para que la vuelva a resolver. |

---

## 7. Apagar sin perder nada

El gasto fijo es el balanceador y la tarea de Fargate. Para dejarlo casi en
cero conservando los datos:

```bash
# Baja el API a cero tareas (deja de cobrar Fargate)
aws ecs update-service --cluster vialservi-cluster --service vialservi-api \
  --desired-count 0 --region us-east-1
```

Para volver, `--desired-count 1`. El balanceador sigue cobrando; para quitarlo
también hay que borrar la pila, y los datos se conservan porque RDS está con
`DeletionPolicy: Snapshot` y los buckets con `Retain`:

```bash
aws cloudformation delete-stack --stack-name vialservi --region us-east-1
```

> Al borrar la pila, RDS deja una **instantánea** y los buckets **quedan**. Para
> borrarlos de verdad hay que hacerlo a mano, a propósito: así un `delete-stack`
> por equivocación no se lleva los expedientes.

---

## 8. Mejoras que quedan preparadas

### Trabajo sin señal (etapa 2)

La infraestructura ya tiene lo que esta etapa necesita, y **no habrá que
cambiarla**:

| Lo que exige el offline | Ya está |
|---|---|
| HTTPS (sin él no se registra un service worker) | ✅ CloudFront |
| Mismo origen para SPA y API (el service worker cachea su origen) | ✅ CloudFront enruta `/api/*` |
| Subir archivos sin pasar por el API | ✅ URL prefirmadas de S3 |
| Reintento que no duplique | ✅ `idLocal` idempotente, y la clave de S3 se deriva de él: reintentar **sobrescribe** el mismo objeto |
| Que un envío tardío no pise otro dato | ✅ campos separados por rol y estado derivado |

El flujo de subida **ya está construido y funcionando** en
`apps/web/src/comun/subida.ts`: pedir URL → `PUT` a S3 → registrar. Lo que falta
es solo envolverlo en una cola: `Dexie.js` para el buzón en IndexedDB y
`vite-plugin-pwa` para el service worker. Como los tres pasos ya están
separados, el buzón solo tiene que reintentar el paso 2.

### HTTPS de punta a punta

Hoy CloudFront habla HTTP con el balanceador. Con un dominio propio:
certificado en **ACM**, escucha 443 en el ALB, y cambiar
`OriginProtocolPolicy` a `https-only`.

### Otras

- **Varias tareas**: subir `DesiredCount`. El código ya lo soporta — por eso el
  consecutivo usa una secuencia de PostgreSQL y no `COUNT(*)`.
- **Retención 2+3 años**: el bucket ya pasa a `STANDARD_IA` a los dos años. El
  borrado a los cinco lo hará el aplicativo, que es el único que sabe si hay una
  reclamación abierta.
- **Dominio propio**: Route 53 + alias a CloudFront, y el certificado de ACM
  debe crearse en `us-east-1`.

---

## 9. Desarrollo local después de estos cambios

El proyecto **ya no usa SQLite**: usa PostgreSQL también en local, para que las
diferencias entre motores no aparezcan al desplegar. (Ejemplo real de este
proyecto: `contains` ignora mayúsculas en SQLite pero las distingue en
PostgreSQL, así que la búsqueda por placa se habría roto sola en producción.)

```bash
npm run base:arriba    # PostgreSQL 16 en Docker
npm run setup          # .env, migraciones y datos de demostración
npm run dev            # API en :4000, interfaz en :5173
npm test               # 88 pruebas
```

Si no pueden usar Docker, sirve cualquier PostgreSQL 16: basta apuntar
`DATABASE_URL` a él en `apps/api/.env`.

En local, `ALMACENAMIENTO_MODO=local` y `CORREO_MODO=consola`, así que **no hace
falta cuenta de AWS para desarrollar ni para la demostración**.
