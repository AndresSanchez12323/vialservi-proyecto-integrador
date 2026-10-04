# Manual técnico — VialServi

Documento de trabajo del equipo de desarrollo. Recoge las decisiones de diseño
que no son evidentes al leer el código.

---

## 1. Estructura

```
apps/
├── api/    Node.js + Express + Prisma        (puerto 4000)
└── web/    React + Vite + Tailwind           (puerto 5173)
```

Un solo lenguaje, TypeScript, en ambos lados. La base de datos es SQLite en
desarrollo y PostgreSQL sobre Supabase en despliegue; el esquema es el mismo y
se cambia por configuración.

## 2. Modelo de datos

El orden de las entidades sigue el flujo del servicio:

```
Vehículo ── pertenece a ──> Cliente ── solicita ──> Servicio ── genera ──> Expediente
                                                       ▲                      │
                                                    Técnico ──── aporta ──────┘
```

El expediente **enlaza** las demás entidades, no las duplica: guarda las claves
foráneas y consulta lo demás.

### Reparto de campos por rol

Es la decisión estructural del modelo, no una casualidad. **Ninguna columna la
escriben dos roles.**

| Campo | Quién lo escribe |
|---|---|
| **Servicio** · `tipoSolicitado`, `direccion`, `descripcion`, `lat`, `lng`, `contactoTelefono` | Cliente (al solicitar) |
| **Servicio** · `tipo`, `tecnicoId`, `asignadoEn`, `asignadoPor` | Central |
| **Servicio** · `canceladoEn`, `motivoCancelacion`, `rechazadoEn`, `motivoRechazo` | Central |
| **Servicio** · `iniciadoEn`, `terminadoEn`, `etaMinutos`, `etaActualizadoEn` | Técnico |
| **Servicio** · `estado` | **Nadie: es derivado** |
| **Técnico** · `disponible`, `lat`, `lng`, `ubicacionEn` | El propio técnico |
| **Expediente** · `observaciones`, `observacionesVersion` | Técnico |
| **Expediente** · `esPropietario`, `solicitante*`, `verificadoEn`, `verificacionVersion` | Técnico |
| **Expediente** · `revisionCentral`, `cerradoEn`, `cerradoPor` | Central |
| **Expediente** · `formatoTipo`, `formatoVersion` | Se sellan al abrirlo y no cambian |
| `evidencias[]` | Técnico y cliente (filas nuevas) |
| `novedades[]` | Técnico y central (filas nuevas) |

Cada evidencia guarda en `subidaPorId` **quién la aportó** y en `categoria` **qué
prueba**. Es lo que permite distinguir la versión del técnico de la del cliente
cuando hay una reclamación: ante un reclamo por un rayón, el expediente muestra
las dos, cada una con su autor y su hora.

Las categorías `FIRMA_CEDULA` y `DOCUMENTO` **solo las puede aportar el técnico**.
Si el cliente pudiera subir la firma de autorización, el control quedaría en manos
de la parte interesada.

### Estados del servicio: derivados, no escritos

```
SOLICITADO ─> ASIGNADO ─> EN_EJECUCION ─> TERMINADO ─> CERRADO
     │              └──────────────┴──────────> CANCELADO
     └──> RECHAZADO
```

El estado **no es un campo que alguien actualice**: se calcula a partir de las
marcas de tiempo de cada rol (`apps/api/src/estado.ts`), con esta precedencia:

```
rechazadoEn > canceladoEn > expediente.cerradoEn > terminadoEn > iniciadoEn > asignadoEn
```

**Por qué.** El estado lo mueven dos roles: el técnico lo pasa a *en ejecución* y
*terminado*; la central a *asignado*, *cerrado*, *cancelado* y *rechazado*. Si
ambos escribieran la misma columna, cuando llegue el trabajo sin señal un envío
viejo del técnico **pisaría una cancelación de la central** y el servicio
reviviría solo. Derivándolo, cada rol escribe únicamente lo suyo y el resultado
es el mismo sin importar en qué orden lleguen los envíos. `Servicio.estado` se
guarda igual, pero solo como copia para poder filtrar e indicar.

`RECHAZADO` es distinto de `CANCELADO`: rechazar es una solicitud que la central
no acepta (sin dirección verificable, fuera de cobertura) y solo cabe mientras no
se haya asignado; cancelar es un servicio que se iba a prestar y se suspende.
Las dos exigen motivo, y lo rechazado **se conserva**: el historial de lo que no
se atendió también es trazabilidad.

### Verificación de quién entrega el vehículo

La hace el **técnico en sitio**, porque es el único que ve a la persona y el
documento. `esPropietario` en `null` significa que todavía no la hizo, y sin ella
**no se puede marcar el servicio como terminado**: si se pudiera cerrar sin
verificar, el control no existiría en la práctica, porque nadie vuelve sobre un
servicio ya hecho.

Si `esPropietario = false` se exigen nombre y documento de quien entrega y **una
evidencia de categoría `FIRMA_CEDULA`**. Marcar después que sí era el propietario
**borra** los datos del tercero: dejarlos haría creer que hubo una autorización
que ya no aplica.

VialServi **no comprueba procedencia ni hurto y no certifica propiedad**. Esto
solo deja constancia de lo que el técnico vio y de quién autorizó la maniobra; la
interfaz lo dice de forma explícita para que nadie lo entienda de otra manera.

### Formatos versionados por tipo de servicio

`apps/api/src/formatos.ts` define, para cada uno de los tres tipos, los campos
propios y el **juego mínimo de evidencias**. Al abrir el expediente se sellan
`formatoTipo` y `formatoVersion`, y el cierre se mide contra **esa** versión y no
contra la vigente: si mañana se agrega un campo obligatorio, los expedientes ya
cerrados no pueden volverse incompletos de un día para otro.

El catálogo vive en código y no en tabla en esta etapa, para que quede versionado
en Git junto con las reglas que lo validan. Cuando la central necesite editarlo
sin un despliegue, se mueve a tabla conservando estas mismas versiones.

### Cercanía y tiempo estimado

`apps/api/src/geo.ts` calcula la distancia con la fórmula del haversine,
corregida por un factor de calle (1,4) y una velocidad promedio urbana (25 km/h)
más cinco minutos de alistamiento.

**No se usa un servicio de rutas externo** a propósito: exigiría una llave de API,
conexión y un costo por consulta, y para lo que hace falta —escoger al técnico más
cercano y dar un tiempo aproximado— la línea recta corregida alcanza y nunca deja
la pantalla en blanco porque un tercero no responda. Si el técnico informa su
propio tiempo, **el del técnico manda**: él está en la vía y sabe si hay trancón.
En el mapa la línea se dibuja punteada justamente para no dar a entender que es
la ruta por calles.

`CANCELADO` cubre que el cliente desista o que el vehículo ya no esté en el
sitio. Lo registra la central, **exige motivo** (`motivoCancelacion`) y queda
con `canceladoEn` y `canceladoPor`. Un servicio ya cerrado no se puede
cancelar.

El API del técnico acepta únicamente sus campos. Así, una actualización del
técnico **no puede sobrescribir** el cierre hecho por la central, aunque llegue
después. No hay conflicto porque no comparten campos.

---

## 3. Trabajo sin señal

> **Estado: diseñado, no construido.** El trabajo sin señal es de la **etapa 2**.
> Lo que ya está hecho es la parte del modelo de la que depende, y que no se puede
> añadir después sin rehacer el esquema: campos separados por rol, `estado`
> derivado, filas con `idLocal` idempotente y contadores de versión en los campos
> editables (`observacionesVersion`, `verificacionVersion`). Lo que falta es el
> buzón en el dispositivo (Dexie.js) y el service worker (vite-plugin-pwa).

El técnico atiende servicios en carretera, donde la cobertura falla. El
aplicativo debe permitirle registrar sin conexión y enviar después.

### 3.1 Principio de diseño: un solo camino

No existen un "modo conectado" y un "modo desconectado". El formulario
**siempre guarda primero en el dispositivo**, en un buzón de salida
(IndexedDB a través de Dexie.js), y enseguida intenta enviar.

```
Formulario ─> Buzón de salida (IndexedDB) ─> Envío al API ─> Confirmado
                     │                            │
                     └──── si falla, queda pendiente y se reintenta
```

Con cobertura el envío es inmediato y el técnico no nota diferencia. Sin
cobertura, el registro queda pendiente, la pantalla muestra cuántos hay y se
reintenta al recuperar la conexión o con el botón *Sincronizar*.

La sincronización es **en un solo sentido**, del dispositivo al servidor. No se
bajan cambios para fusionarlos, de modo que no hay que resolver versiones.

### 3.2 Reglas de la cola

1. **FIFO con un envío a la vez.** No se lanza el siguiente hasta confirmar el
   anterior. Sin envíos en paralelo no hay llegadas cruzadas.
2. **Cada registro lleva `idLocal`**, un identificador generado en el
   dispositivo. En el servidor es único: un reintento se reconoce y no duplica.
3. **Coalescencia por campo.** Si ya hay una actualización pendiente de
   `observaciones` del expediente 123 y el técnico vuelve a editarla, se
   **reemplaza** la pendiente en lugar de encolar otra. Nunca hay dos.
4. **Tras N intentos fallidos**, el registro se aparta como *requiere revisión*
   y la cola sigue. Evita que un registro inválido bloquee todo lo demás.

### 3.3 Orden de los registros

Hay que distinguir dos situaciones, porque se comportan distinto:

**Evidencias y novedades — el orden de subida no importa.** Cada una es una
fila nueva e independiente: ninguna pisa a otra. Para mostrarlas se ordenan por
`tomadaEn` / `ocurridaEn`, que es **la hora del dispositivo en que ocurrieron**,
no la hora en que llegaron al servidor. Si la tercera foto sube primero, en el
expediente sigue apareciendo tercera.

**Observaciones — el orden sí importa**, porque es el mismo campo escrito dos
veces. Tres defensas, y basta con que funcione una:

- la coalescencia de la regla 3 impide que haya dos pendientes;
- la cola FIFO impide llegadas cruzadas;
- `observacionesVersion` es un contador que incrementa el dispositivo en cada
  edición, y el servidor **descarta toda actualización cuyo contador sea menor o
  igual al guardado**. Un reintento viejo que llega tarde se ignora solo.

Se usa un contador y no la hora del dispositivo porque un reloj mal configurado
podría revertir una edición más reciente.

### 3.4 Casos analizados

| Caso | Comportamiento |
|---|---|
| Registro reintentado muchas veces | El `idLocal` hace que el servidor lo aplique una sola vez. Reintentar no es conflicto. |
| Expediente creado sin señal y evidencias de ese expediente | Las evidencias referencian al padre por su `idLocal`, no por un id del servidor que aún no existe. La cola FIFO garantiza que el padre suba primero. |
| Evidencia que llega después de que la central cerró el expediente | **Se acepta y se marca** con `posteriorAlCierre`. Perder evidencia es peor que tener un registro tardío. |
| Registro inválido que el servidor rechaza siempre | Tras N intentos se aparta como *requiere revisión*; la cola no se bloquea. |
| Se cierra el navegador o se agota la batería con pendientes | El buzón vive en IndexedDB, no en memoria: al reabrir sigue ahí y reintenta. |
| Dos pestañas sincronizando a la vez | El `idLocal` único descarta el duplicado en el servidor. |
| Reloj del dispositivo mal configurado | Para las observaciones manda el contador, no la hora. |
| Dos técnicos sobre el mismo servicio | Las evidencias son filas propias de cada uno. En observaciones gana la última escritura, que es aceptable porque cada servicio lo atiende un técnico. |

### 3.5 Qué cubre y qué no

Cubre el **registro en campo**: diligenciar el formato, tomar fotografías,
grabar clips de máximo diez segundos y anotar novedades sin cobertura.

No cubre la **consulta del histórico completo** sin conexión: para eso se
requiere red. Solo quedan disponibles los servicios asignados que ya se habían
cargado.

El límite de diez segundos en el video no es capricho: un clip de celular pesa
decenas de megabytes, y hay que guardarlo en el dispositivo mientras no hay
señal y subirlo después por una conexión mala.

---

## 4. Seguridad

- Contraseñas con `bcrypt`; nunca se guardan en claro.
- Sesión con JWT de 8 horas.
- **Los permisos se resuelven en el servidor**, no ocultando botones. Cada ruta
  declara qué roles la pueden usar, **y el detalle también comprueba la
  pertenencia**: un cliente no puede abrir el servicio ni el expediente de otro
  cambiando el número en la URL.
- Separación de funciones: el técnico no puede cerrar ni eliminar el expediente
  que él mismo atendió.

### Registro público y recuperación de clave

- El **registro público solo crea cuentas de cliente**. El rol no se acepta desde
  la petición: si se pudiera elegir, cualquiera se haría central y cerraría
  expedientes ajenos.
- Si la central ya tenía una ficha de cliente con ese documento, la cuenta nueva
  **se enlaza** a esa ficha en lugar de duplicar la cédula, para no perder los
  vehículos y servicios que ya estuvieran a su nombre.
- La recuperación responde **lo mismo exista o no la cuenta**: si contestara «ese
  documento no existe», la ruta serviría para averiguar qué cédulas tienen cuenta.
- El código de 6 dígitos se guarda **hasheado**, igual que una clave; es de un
  solo uso, vence a los 15 minutos, pedir uno nuevo invalida el anterior y tras 5
  intentos fallidos se bloquea (sin tope, seis dígitos se adivinan probando).
- El cambio de clave con sesión abierta **exige la clave actual**, para que una
  sesión olvidada en un equipo ajeno no sirva para dejar al dueño sin cuenta.
- `CORREO_REVELAR_CODIGO` solo funciona con el correo en modo consola, y la
  configuración lo fuerza a `false` si hay un proveedor real.

## 5. Cómo se probará el trabajo sin señal (etapa 2)

1. Iniciar sesión como técnico y abrir un servicio asignado.
2. En las herramientas del navegador, pestaña *Red*, activar **Sin conexión**.
3. Registrar una observación y una fotografía: deben quedar guardadas y la
   pantalla debe mostrar los registros pendientes.
4. Desactivar *Sin conexión*: los pendientes deben desaparecer solos.
5. Volver a cargar la página y comprobar que la información quedó en el
   servidor.
