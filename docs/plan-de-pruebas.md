# Plan de pruebas — VialServi

Recorrido completo del aplicativo. Cada caso dice qué hacer y qué debe pasar.
Los casos marcados **(regla)** son los importantes: no comprueban que algo
funcione, sino que el sistema **impide** lo que no debe permitir.

**Antes de empezar:** `npm run dev`, y abrir `http://localhost:5173`.
Clave de todos los usuarios: `VialServi2026`.

> **La mayoría de estos casos ya están automatizados** en
> `apps/api/src/reglas.test.ts`. Se ejecutan con `npm test` y comprueban las
> reglas contra el API, que es donde viven. Esta lista sirve para el recorrido
> manual y para la sustentación; las pruebas automáticas sirven para saber, en
> cualquier momento, que nada se rompió.

---

## A. Acceso y sesión

| # | Qué hacer | Resultado esperado |
|---|---|---|
| A1 | Abrir `http://localhost:5173/panel` sin haber entrado | Redirige a la pantalla de inicio de sesión |
| A2 | Entrar con documento `2001` y clave `incorrecta` | Mensaje "Credenciales incorrectas". **(regla)** No debe decir si el documento existe o no |
| A3 | Entrar con `2001` / `VialServi2026` | Entra al **Panel** |
| A4 | Mirar arriba a la derecha | Muestra el nombre y el rol "Central de Operaciones" |
| A5 | Pulsar *Salir* y luego el botón Atrás del navegador | No debe volver a entrar: exige iniciar sesión otra vez |

## B. Panel de indicadores (Central)

| # | Qué hacer | Resultado esperado |
|---|---|---|
| B1 | Entrar como `2001` y ver el Panel | 5 servicios, 2 expedientes abiertos, 1 cerrado, 6 evidencias |
| B2 | Mirar "Servicios por estado" | Barras con: solicitado, asignado/en ejecución, terminado, cerrado y cancelado |
| B3 | Mirar "Servicios por tipo" | Traslado en grúa, carro taller y conductor elegido |

## C. El flujo completo del servicio

| # | Qué hacer | Resultado esperado |
|---|---|---|
| C00a | Entrar como `71234567` (cliente) y mirar el menú | Aparece *Gestionar vehículo e inventario*, con **solo sus dos vehículos** (ABC123 y WKL780) y sin el buscador por placa |
| C00b | Pulsar *Registrar vehículo* | El formulario **no pregunta por el propietario**: es él. Escribir la placa en minúscula la pasa a mayúscula |
| C00c | Registrar `hjk456`, Toyota, Corolla Cross, Plateado | Aparece de una vez en la lista, con *Propietario: Santiago Gómez* |
| C00d | Intentar registrar otra vez la misma placa | **(regla)** "Ya existe un vehículo con esa placa" |
| C00e | Salir, entrar como `2001` y buscar `HJK` | La central **sí** ve el vehículo que registró el cliente, con su propietario |
| C00f | Como `2001`, pulsar *Registrar vehículo* | Aquí **sí** sale el selector de propietario, porque la central registra a nombre de otro |
| C0a | Como `71234567`, pulsar *Solicitar servicio* | Se abre el formulario. **(regla)** No pregunta por el cliente: lo toma de la sesión. En *Vehículo* salen solo los suyos, **incluido el que acaba de registrar** |
| C0b | Elegir el vehículo, escribir dirección y descripción, y enviar | Aparece de primero en su lista, en **Solicitado**, sin tipo y sin técnico: clasificar es otro paso |
| C0c | Salir, entrar como `2001` y pulsar *Solicitar servicio* | Aquí **sí** sale el selector de cliente, porque la central pide a nombre de otro. Al elegir uno, la lista de vehículos se acota a los de él |
| C0d | Como `2001`, mirar la lista | Está la solicitud que acaba de hacer el cliente, con el botón *Clasificar y asignar* |
| C0e | Entrar como `3001` (técnico) y mirar la cabecera | **(regla)** El técnico no tiene el botón *Solicitar servicio*: él atiende lo que le asignan |
| C1 | Como `2001`, ir a *Gestionar servicio* | Se ven los 5 servicios, cada uno con su estado |
| C2 | Buscar el servicio **Solicitado** (placa TNA915) y pulsar *Clasificar y asignar* | Se abre el panel con tipo y técnico |
| C3 | Elegir tipo **Carro taller** y desplegar la lista de técnicos | **(regla)** Solo aparece Brahian Rendón (mecánica/cerrajería). No aparece Juan Pablo (grúa/conductor) ni Andrés (no disponible) |
| C4 | Cambiar el tipo a **Traslado en grúa** y volver a desplegar | Ahora aparece Juan Pablo y no Brahian |
| C5 | Dejar *Carro taller*, elegir a Brahian y pulsar *Abrir expediente* | El servicio pasa a **Asignado** y aparece un consecutivo nuevo (EXP-2026-00xx) |
| C6 | Volver al Panel | Los indicadores cambiaron: un expediente abierto más |

## D. El rol del técnico

| # | Qué hacer | Resultado esperado |
|---|---|---|
| D1 | Salir y entrar como `3001` (Brahian) | Entra directo a *Gestionar servicio*, no al Panel |
| D2 | Mirar el menú de la izquierda | **(regla)** No aparecen Panel, Clientes, Técnicos ni Históricos. Solo lo suyo |
| D3 | Contar los servicios | Solo los suyos (2), no los 5. **(regla)** El filtro es del servidor |
| D4 | Mirar los botones del servicio asignado | *Iniciar atención*, no *Clasificar y asignar* ni *Cancelar* |
| D5 | Pulsar *Iniciar atención* | Pasa a **En ejecución** y el botón cambia a *Marcar terminado* |
| D6 | Entrar al expediente de ese servicio | Se ve el vehículo, el cliente, el inventario y las secciones de evidencias y novedades |
| D7 | Escribir una observación y pulsar *Guardar observaciones* | El texto queda, y **la versión sube en uno** |
| D8 | Pulsar *+ Fotografía* dos veces y *+ Video (10 s)* una vez | Aparecen tres evidencias nuevas, cada una con el nombre de Brahian y la etiqueta "Técnico" |
| D9 | Escribir una novedad y pulsar *Agregar* | Aparece en la lista con su hora |
| D10 | Bajar al final de la pantalla | **(regla)** El técnico **no ve** el bloque "Cierre del expediente" |
| D11 | Volver a servicios y pulsar *Marcar terminado* | Pasa a **Terminado** |

## E. El cierre (solo la Central)

| # | Qué hacer | Resultado esperado |
|---|---|---|
| E1 | Salir y entrar como `2001`, abrir el expediente del servicio que quedó en *Terminado* | Ahora **sí** aparece el bloque "Cierre del expediente" |
| E2 | Pulsar *Cerrar expediente* | Queda cerrado, con fecha, y el servicio pasa a **Cerrado** |
| E3 | Abrir el expediente **EXP-2026-0002** (el que está *En ejecución*) e intentar cerrarlo | **(regla)** Error: "Solo se cierra un servicio que el técnico haya marcado como terminado" |
| E4 | Volver a pulsar *Cerrar* en uno ya cerrado | El botón está deshabilitado y muestra la fecha del cierre |

## F. Evidencia después del cierre

| # | Qué hacer | Resultado esperado |
|---|---|---|
| F1 | Como `2001`, abrir **EXP-2026-0001** (ya cerrado) | Se ven 4 evidencias |
| F2 | Pulsar *+ Fotografía* | **(regla)** No la rechaza: la guarda con la etiqueta naranja **"posterior al cierre"** |

## G. La evidencia del cliente

| # | Qué hacer | Resultado esperado |
|---|---|---|
| G1 | En **EXP-2026-0001**, mirar la lista de evidencias | Una dice **Santiago Gómez · Cliente** y las otras **Brahian Rendón · Técnico** |
| G2 | Mirar el orden | Están por **hora de captura**, no por orden de subida: la del cliente (5:31 p. m.) va antes que las del técnico (7:31 p. m.) |
| G3 | Salir y entrar como `71234567` (cliente) | Entra a *Gestionar servicio* y ve solo sus servicios |
| G4 | Abrir uno de sus expedientes y pulsar *+ Fotografía* | La sube, y queda registrada a su nombre con la etiqueta "Cliente" |
| G5 | Mirar si puede escribir observaciones | **(regla)** El campo está deshabilitado: las observaciones son del técnico |

## H. Cancelación

| # | Qué hacer | Resultado esperado |
|---|---|---|
| H1 | Como `2001`, en un servicio no cerrado pulsar *Cancelar* | Pide un motivo |
| H2 | Dejar el motivo vacío o escribir menos de 5 letras | **(regla)** El botón de confirmar sigue deshabilitado |
| H3 | Escribir un motivo y confirmar | Pasa a **Cancelado** y el motivo queda visible en la tarjeta |
| H4 | Intentar cancelar un servicio ya **Cerrado** | **(regla)** El botón *Cancelar* ni siquiera aparece |

## I. Los demás módulos

| # | Qué hacer | Resultado esperado |
|---|---|---|
| I1 | Como `2001`, ir a *Gestionar vehículo e inventario* y escribir `ABC` en el buscador | Filtra y muestra el Chevrolet Spark GT con su propietario |
| I2 | Ir a *Gestionar cliente* | Tabla con 3 clientes y cuántos vehículos y servicios tiene cada uno |
| I3 | Ir a *Gestionar técnico* | 3 tarjetas con especialidades; Andrés aparece como "No disponible" |
| I4 | Ir a *Gestionar históricos* y buscar la placa `ABC123` | Sale el historial del vehículo con el consecutivo del expediente y cuántas evidencias tiene |
| I5 | Mirar el menú | *Gestionar usuarios y roles* y *Ayuda* aparecen en gris, marcados **pendiente** |

## J. Seguridad del servidor (opcional, con la consola del navegador)

Estas comprueban que las reglas viven en el servidor y no solo en la pantalla.
Se ejecutan en la consola (F12 → Consola) **estando dentro como técnico (3001)**.

| # | Qué hacer | Resultado esperado |
|---|---|---|
| J1 | `fetch('/api/reportes/indicadores',{headers:{Authorization:'Bearer '+JSON.parse(localStorage['vialservi.sesion']).token}}).then(r=>r.status)` | **403**: el técnico no puede ver los reportes aunque conozca la ruta |
| J2 | Lo mismo contra `/api/expedientes/1/cerrar` con `method:'POST'` | **403**: el técnico no puede cerrar, aunque el botón no exista en su pantalla |
| J3 | `fetch('/api/vehiculos').then(r=>r.status)` sin token | **401** |

Estas dos van **estando dentro como cliente (71234567)**:

| # | Qué hacer | Resultado esperado |
|---|---|---|
| J4 | Solicitar un servicio mandando a propósito el `clienteId` de otra persona | **201**, pero el servicio queda a nombre del que inició sesión: el servidor ignora ese campo |
| J5 | `fetch('/api/clientes', …).then(r=>r.status)` | **403**: el directorio con documentos y teléfonos de terceros no es para el cliente |

---

## Resumen de lo que estas pruebas demuestran

1. Cada rol ve y puede cosas distintas, y el filtro es del servidor.
2. El cliente registra su vehículo y solicita su propio servicio, y ambas
   cosas quedan a su nombre aunque manipule la petición.
3. El expediente nace cuando la central clasifica, y concentra la información
   de vehículo, cliente, técnico y servicio sin duplicarla.
4. Quien presta el servicio no puede cerrarlo: separación de funciones.
5. No se cierra un expediente sin evidencia ni sin que el técnico haya
   terminado.
6. No se cancela sin motivo, ni se cancela lo ya cerrado.
7. La evidencia tardía se conserva y se marca, en vez de perderse.
8. Se distingue la evidencia del cliente de la del técnico, que es lo que
   permite responder una reclamación.
