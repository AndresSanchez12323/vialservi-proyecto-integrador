# VialServi — aplicativo web

Aplicativo web para la gestión de expedientes de servicios mecánicos, de cerrajería,
de grúa y de conductor elegido.

**Proyecto Integrador 2026-2** · Politécnico Colombiano Jaime Isaza Cadavid
Edwin Andrés Sánchez Orozco · Brahian Estiven Rendón Murillo · Juan Pablo Vásquez Marín

---

## Estado del avance

El flujo completo está operativo de principio a fin: el cliente **crea su cuenta**,
registra su vehículo y solicita; la central recibe la **notificación**, clasifica y
asigna desde un **tablero con distancias**; el cliente sigue al técnico en un
**mapa** con tiempo estimado; el técnico **verifica quién entrega el vehículo**,
diligencia el expediente y lo termina; y la central revisa y cierra.

| Módulo del mapa de navegación | Estado |
|---|---|
| Seguridad y control de acceso | Construido (registro de cliente, recuperación de clave, cambio de clave, permisos en el servidor) |
| Gestionar vehículo e inventario | Construido (datos de la licencia de tránsito los toma el técnico en sitio) |
| Gestionar cliente | Construido |
| Gestionar técnico | Construido (consulta, disponibilidad y ubicación; alta y edición desde la interfaz pendientes) |
| Gestionar servicio | Construido (solicitar, clasificar, asignar, avanzar, informar llegada, cancelar, rechazar) |
| Gestionar expediente | Construido (verificación de propietario, observaciones, evidencias por categoría, novedades, revisión y cierre) |
| Gestionar históricos | Construido (consulta por placa y por tipo) |
| Gestionar reportes | Construido (panel de indicadores) |
| Notificaciones | Construido (bandeja por usuario, en la campanita) |
| Gestionar usuarios y roles | Pendiente (el registro público solo crea clientes) |
| Trabajo sin señal | Pendiente — **etapa 2**. El modelo de datos ya está preparado (ver más abajo) |

## El recorrido completo

1. **El cliente crea su cuenta** desde la pantalla de inicio. El registro público
   solo crea cuentas de **cliente**: los permisos de central, técnico y
   administrador los asigna personal autorizado.
2. **Registra su vehículo** (hasta 5 por cuenta). No se le piden el VIN ni el
   número de la tarjeta de propiedad: esos datos los toma el técnico en el sitio.
3. **Solicita el servicio**: vehículo, qué cree necesitar, dirección, qué ocurrió,
   teléfono de contacto y, si lo permite, su ubicación en el mapa. El cliente
   **no crea el expediente**.
4. **La central recibe la notificación.** Para el cliente, el servicio queda
   *«en verificación por la central»*.
5. **La central clasifica y asigna** desde el tablero, que muestra qué técnicos
   tienen la especialidad, quién está libre y **a cuántos kilómetros y minutos
   está cada uno**. Al asignar **nace el expediente**, con la versión del formato
   sellada.
6. **Al técnico y al cliente les llega la notificación.** El cliente ve el nombre
   del técnico, su posición en el mapa y el tiempo estimado de llegada.
7. **El técnico informa su tiempo de llegada** («llego en 15 minutos»), que manda
   sobre la estimación por distancia porque él está en la vía.
8. **El técnico llega y verifica quién entrega el vehículo.** Si es el propietario,
   sigue normal. Si **no** lo es, el formulario cambia: pide nombre, documento y
   relación de quien entrega, y **exige una foto de la cédula con la firma de
   autorización**. Sin esa foto el servicio no se puede marcar como terminado.
9. **Diligencia el expediente**: observaciones, evidencias con su categoría
   (al recibir, al entregar, daño, cédula con firma, documento) y novedades. El
   cliente también puede aportar fotos y videos, que quedan marcados como suyos.
10. **El técnico marca terminado**, pero **no puede cerrar**. La central recibe la
    notificación de que hay un expediente por revisar.
11. **La central revisa y cierra.** El cierre se valida contra el formato: si falta
    una evidencia obligatoria, no cierra y dice exactamente qué falta.

## Qué ve cada rol

| Rol | Entra a | Puede |
|---|---|---|
| **Administrador** | Panel | Todo, más la gestión de técnicos |
| **Central de Operaciones** | Panel | Clasificar, asignar, rechazar, cancelar y **cerrar**; ver indicadores, históricos y el tablero de técnicos |
| **Técnico** | Sus servicios | Reportar disponibilidad y ubicación, informar tiempo de llegada, iniciar y terminar, verificar quién entrega, escribir observaciones y subir evidencias |
| **Cliente** | Sus servicios | Crear cuenta, registrar vehículos, solicitar, seguir al técnico en el mapa y aportar evidencias propias |

El filtro es del servidor, no de la interfaz: el técnico solo recibe los servicios
que tiene asignados, y el cliente solo los suyos — **también en el detalle**, no solo
en la lista.

## Reglas del negocio implementadas

- **El estado del servicio es derivado, no un campo que alguien escriba.** Cada rol
  escribe su propia marca de tiempo (el técnico `iniciadoEn` y `terminadoEn`; la
  central `asignadoEn`, `canceladoEn`, `rechazadoEn`; el cierre va en el expediente)
  y el estado se calcula con ellas. Es lo que impide que un envío tardío del técnico
  reviva un servicio que la central canceló.
- **Ninguna columna se comparte entre roles.** Lo que aportan varios (evidencias,
  novedades) son filas propias: `INSERT` y nunca `UPDATE`, así dos personas no se
  pisan. Es el requisito para que el trabajo sin señal de la etapa 2 no genere
  conflictos.
- **Solo la central cierra**, y únicamente si el técnico marcó terminado, hizo la
  verificación y está el juego de evidencias que exige el formato del tipo de
  servicio.
- **Quien no es propietario autoriza con cédula y firma**, y esa foto solo la puede
  aportar el técnico: si el cliente pudiera subirla, el control se lo estaríamos
  dando a la parte interesada.
- **VialServi no verifica procedencia ni hurto** y no certifica propiedad. Solo deja
  constancia de lo que el técnico vio y de quién autorizó. La interfaz lo dice.
- **Cancelar y rechazar exigen motivo.** Rechazar es para una solicitud que no se
  acepta; cancelar, para un servicio que se iba a prestar y se suspende.
- **Un vehículo no puede tener dos servicios abiertos a la vez**: evita mandar dos
  grúas al mismo sitio por un doble clic.
- **No se asigna un técnico sin la especialidad** que exige el tipo de servicio.
- **Cada evidencia guarda quién la aportó, su categoría y la hora de captura.**
- **Una evidencia que llega después del cierre se acepta y se marca**, en lugar de
  rechazarse: perder evidencia es peor que tener un registro tardío.
- **El formato de cada tipo de servicio está versionado**: cada expediente conserva
  la versión con la que se diligenció, así un cambio posterior del catálogo no deja
  incompletos los expedientes ya cerrados.
- **La recuperación de clave no revela si un documento existe**, el código es de un
  solo uso, vence y se bloquea tras varios intentos.

## Mapas y tiempo estimado

Los mapas usan **Leaflet sobre OpenStreetMap**: **no requieren llave de API** ni
cobran por consulta. La distancia y el tiempo se calculan en el servidor con la
fórmula del haversine, corregida por un factor de calle y una velocidad promedio
urbana (`apps/api/src/geo.ts`), así que **no se depende de un servicio externo** y la
pantalla nunca queda en blanco porque un tercero no responda.

La línea entre los dos puntos se dibuja **punteada a propósito**: es la distancia
directa, no la ruta por calles. Si más adelante se quiere ruta real, ahí sí haría
falta una llave de Mapbox o Google.

## Correo de la recuperación de clave

El envío está detrás de un adaptador (`apps/api/src/correo.ts`):

- `CORREO_MODO=consola` (el de hoy): el mensaje se imprime en el log del API. La
  recuperación funciona de punta a punta **sin credenciales y sin internet**.
- `CORREO_MODO=ses` o `resend`: queda el punto de extensión para enchufar el
  proveedor cuando existan las credenciales. Nada más del sistema cambia.

En desarrollo, `CORREO_REVELAR_CODIGO=true` devuelve el código en la respuesta para
no tener que mirar el log. **En producción debe quedar en `false`**.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript |
| API | Node.js + Express |
| Validación | Zod |
| Persistencia | Prisma ORM sobre **PostgreSQL** (local con Docker, en AWS con RDS) |
| Seguridad | JWT + bcrypt, control por roles en el servidor |
| Interfaz | React 18 + Vite + Tailwind CSS + TanStack Query |
| Mapas | Leaflet + OpenStreetMap (sin llave de API) |
| Archivos | **Amazon S3** con URL prefirmadas (modo local para desarrollar sin AWS) |
| Correo | **Amazon SES** (modo consola para desarrollar sin AWS) |
| Despliegue | Docker · ECS Fargate · CloudFront · CloudFormation |
| Pruebas | Vitest + Supertest |

El diseño de la interfaz usa *glassmorphism*: superficies translúcidas con
desenfoque sobre un fondo con degradado.

## Puesta en marcha

Requiere Node.js 20 o superior y PostgreSQL 16 (lo más fácil es con Docker).

```bash
npm run base:arriba   # PostgreSQL 16 en Docker
npm run setup         # instala, crea el .env, aplica migraciones y carga datos
npm run dev           # API en :4000, interfaz en :5173
```

> **El proyecto usa PostgreSQL, no SQLite.** También en local, a propósito: las
> diferencias entre motores no se descubren en producción. Ejemplo real de este
> proyecto: `contains` ignora mayúsculas en SQLite pero las distingue en
> PostgreSQL, así que la búsqueda por placa se habría roto sola al desplegar.
>
> Si no pueden usar Docker, sirve cualquier PostgreSQL 16: basta apuntar
> `DATABASE_URL` a él en `apps/api/.env`.

**No hace falta cuenta de AWS para desarrollar ni para la demostración:** por
omisión las evidencias quedan en modo `local` (registran la referencia) y el
correo en modo `consola` (el código sale en el log del API).

> Las pruebas y la aplicación **necesitan los datos de demostración**: sin
> `npm run db:seed` no hay usuarios con los que entrar.

### Usuarios de demostración

| Documento | Rol | Clave |
|---|---|---|
| 1001 | Administrador | VialServi2026 |
| 2001 | Central de Operaciones | VialServi2026 |
| 3001 / 3002 | Técnicos | VialServi2026 |
| 71234567 | Cliente | VialServi2026 |

La pantalla de inicio tiene botones para llenar el documento de cada usuario, y
desde ahí se puede **crear una cuenta de cliente nueva** para ver el registro.

### Pruebas

```bash
npm test
```

**81 pruebas** sobre el API real (HTTP y base de datos, no simulaciones):
reglas de acceso, estado derivado, verificación de propietario, evidencias por
formato, notificaciones, recuperación de clave, cercanía y casos de borde.

## Documentación técnica

- [`docs/manual-tecnico.md`](docs/manual-tecnico.md) — decisiones de diseño que
  no se ven en el código, en particular cómo se resuelve el trabajo sin señal y
  por qué no genera conflictos.
- [`docs/despliegue-aws.md`](docs/despliegue-aws.md) — **cómo subirlo a AWS**:
  arquitectura, los tres comandos del despliegue, costos, diagnóstico y cómo
  apagarlo sin perder datos.

## Despliegue en AWS

```bash
./infra/desplegar-api.sh              # imagen del API a ECR
./infra/crear-infraestructura.sh ...  # CloudFormation: red, RDS, Fargate, CDN
./infra/desplegar-web.sh              # interfaz a S3 + CloudFront
```

CloudFront da HTTPS sin dominio propio y enruta `/api/*` al API, así que el SPA
y el API comparten origen: sin CORS y **listo para el service worker de la PWA**
de la etapa 2. El detalle está en
[`docs/despliegue-aws.md`](docs/despliegue-aws.md).

## Estructura

```
apps/
├── api/                      Node.js + Express + Prisma
│   ├── prisma/schema.prisma  Entidades, con el rol que escribe cada campo
│   ├── prisma/seed.ts        Datos de demostración
│   └── src/
│       ├── auth.ts           Login, registro, recuperación de clave y roles
│       ├── estado.ts         Estado derivado de las marcas de cada rol
│       ├── formatos.ts       Catálogo versionado por tipo de servicio
│       ├── geo.ts            Distancia y tiempo estimado, sin servicios externos
│       ├── correo.ts         Adaptador de correo (consola / Amazon SES)
│       ├── almacenamiento.ts Evidencias en S3 con URL prefirmadas
│       ├── consecutivo.ts    Consecutivo con secuencia de PostgreSQL
│       └── modulos/          Un archivo por módulo del mapa
└── web/                      React + Vite + Tailwind
    └── src/
        ├── comun/            API, mapa, notificaciones, estilos y disposición
        └── paginas/          Una página por módulo
```

## Lo que sigue

1. Gestionar usuarios y roles desde la interfaz; alta y edición de técnicos.
2. Conectar el formulario de evidencias a la subida real: el API ya entrega las
   URL prefirmadas de S3; falta que la pantalla haga el `PUT` del archivo.
3. **Trabajo sin señal (etapa 2)**: **Dexie.js** sobre IndexedDB para el buzón de
   salida y **vite-plugin-pwa** para que abra sin conexión. Es lo único que
   falta, y es solo código de cliente: la infraestructura ya tiene HTTPS, mismo
   origen y subida directa a S3, y el modelo tiene campos separados por rol,
   `idLocal` idempotente y contadores de versión.
4. Retención 2+3 años e histórico con acceso restringido (el bucket ya pasa a
   `STANDARD_IA` a los dos años).
5. HTTPS de punta a punta con dominio propio y certificado de ACM.
