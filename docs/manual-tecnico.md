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

Es una decisión deliberada, no una casualidad del modelo:

| Campo del expediente | Quién lo escribe |
|---|---|
| `observaciones`, `observacionesVersion` | Técnico |
| `cerradoEn`, `cerradoPor` | Central de Operaciones |
| `evidencias[]` | Técnico y cliente (filas nuevas) |
| `novedades[]` | Técnico (filas nuevas) |

Cada evidencia guarda en `subidaPorId` **quién la aportó**. Es lo que permite
distinguir la versión del técnico de la del cliente cuando hay una reclamación:
ante un reclamo por un rayón, el expediente muestra las dos, cada una con su
autor y su hora.

### Estados del servicio

```
SOLICITADO ─> ASIGNADO ─> EN_EJECUCION ─> TERMINADO ─> CERRADO
     └──────────────┴──────────────┴──────────> CANCELADO
```

El técnico avanza *asignado → en ejecución → terminado*, porque son hechos que
solo él conoce en el sitio. **Solo la central pasa a cerrado**, que es la
separación de funciones: quien presta el servicio no declara cerrada la
evidencia de que existió.

`CANCELADO` cubre que el cliente desista o que el vehículo ya no esté en el
sitio. Lo registra la central, **exige motivo** (`motivoCancelacion`) y queda
con `canceladoEn` y `canceladoPor`. Un servicio ya cerrado no se puede
cancelar.

El API del técnico acepta únicamente sus campos. Así, una actualización del
técnico **no puede sobrescribir** el cierre hecho por la central, aunque llegue
después. No hay conflicto porque no comparten campos.

---

## 3. Trabajo sin señal

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
  declara qué roles la pueden usar.
- Separación de funciones: el técnico no puede cerrar ni eliminar el expediente
  que él mismo atendió.

## 5. Cómo probar el trabajo sin señal

1. Iniciar sesión como técnico y abrir un servicio asignado.
2. En las herramientas del navegador, pestaña *Red*, activar **Sin conexión**.
3. Registrar una observación y una fotografía: deben quedar guardadas y la
   pantalla debe mostrar los registros pendientes.
4. Desactivar *Sin conexión*: los pendientes deben desaparecer solos.
5. Volver a cargar la página y comprobar que la información quedó en el
   servidor.
