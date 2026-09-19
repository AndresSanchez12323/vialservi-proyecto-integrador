# VialServi — aplicativo web

Aplicativo web para la gestión de expedientes de servicios mecánicos, de cerrajería,
de grúa y de conductor elegido.

**Proyecto Integrador 2026-2** · Politécnico Colombiano Jaime Isaza Cadavid
Edwin Andrés Sánchez Orozco · Brahian Estiven Rendón Murillo · Juan Pablo Vásquez Marín

---

## Estado del avance

El flujo completo del servicio está operativo de principio a fin: el cliente
solicita, la central clasifica y asigna, nace el expediente, el técnico lo
diligencia y la central lo cierra. No es el sistema terminado, pero la idea
completa ya se puede ver funcionando.

| Módulo del mapa de navegación | Estado |
|---|---|
| Seguridad y control de acceso | Construido |
| Gestionar vehículo e inventario | Construido |
| Gestionar cliente | Construido |
| Gestionar técnico | Construido (consulta; alta y edición pendientes) |
| Gestionar servicio | Construido (solicitar, clasificar, asignar, avanzar estado, cancelar) |
| Gestionar expediente | Construido (observaciones, evidencias, novedades, cierre) |
| Gestionar históricos | Construido (consulta por placa) |
| Gestionar reportes | Construido (panel de indicadores) |
| Gestionar usuarios y roles | Pendiente |
| Trabajo sin señal | Pendiente (diseño definido en el manual técnico) |

## Qué ve cada rol

| Rol | Entra a | Puede |
|---|---|---|
| **Administrador** | Panel | Todo, más la gestión de técnicos |
| **Central de Operaciones** | Panel | Clasificar, asignar, cancelar y **cerrar** expedientes; ver indicadores e históricos |
| **Técnico** | Sus servicios | Iniciar y terminar la atención, escribir observaciones, subir evidencias y novedades |
| **Cliente** | Sus servicios | Ver el estado y aportar evidencias propias |

El filtro es del servidor, no de la interfaz: el técnico solo recibe del API los
servicios que tiene asignados, y el cliente solo los suyos.

## Reglas del negocio implementadas

- **Solo la central cierra** un expediente, y únicamente si el técnico marcó el
  servicio como terminado y existe al menos una evidencia. Quien presta el
  servicio no declara cerrada la evidencia de que existió.
- **Cancelar exige motivo**, y un servicio cerrado no se puede cancelar.
- **Al clasificar solo se ofrecen los técnicos** cuya hoja de vida cubre ese tipo
  de servicio y estén disponibles.
- **Cada evidencia guarda quién la aportó**: es lo que permite distinguir la
  versión del técnico de la del cliente ante una reclamación.
- **Una evidencia que llega después del cierre se acepta y se marca**, en lugar
  de rechazarse.
- Las evidencias se muestran ordenadas por la **hora en que se tomaron**, no por
  la hora en que llegaron al servidor.

## Tecnologías

Son las declaradas en la tabla de transversalidad del documento del proyecto:

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript |
| API | Node.js + Express |
| Validación | Zod |
| Persistencia | Prisma ORM sobre SQLite (portable a PostgreSQL / Supabase) |
| Seguridad | JWT + bcrypt, control por roles en el servidor |
| Interfaz | React 18 + Vite + Tailwind CSS + TanStack Query |
| Pruebas | Vitest + Supertest |

El diseño de la interfaz usa *glassmorphism*: superficies translúcidas con
desenfoque sobre un fondo con degradado.

## Puesta en marcha

Requiere Node.js 20 o superior.

```bash
npm run setup
```

```bash
npm run dev
```

API en `http://localhost:4000`, interfaz en `http://localhost:5173`.

### Usuarios de demostración

| Documento | Rol | Clave |
|---|---|---|
| 1001 | Administrador | VialServi2026 |
| 2001 | Central de Operaciones | VialServi2026 |
| 3001 / 3002 | Técnicos | VialServi2026 |
| 71234567 | Cliente | VialServi2026 |

La pantalla de inicio de sesión tiene botones para llenar el documento de cada
usuario, de modo que en clase se pueda cambiar de rol rápido.

### Pruebas

```bash
npm test
```

## Documentación técnica

Las decisiones de diseño que no se ven en el código —en particular cómo se
resuelve el trabajo sin señal y por qué no genera conflictos— están en
[`docs/manual-tecnico.md`](docs/manual-tecnico.md).

## Estructura

```
apps/
├── api/                      Node.js + Express + Prisma
│   ├── prisma/schema.prisma  Entidades del dominio
│   ├── prisma/seed.ts        Datos de demostración
│   └── src/
│       ├── auth.ts           Login, JWT y control de roles
│       ├── app.ts            Montaje de los módulos
│       └── modulos/          Un archivo por módulo del mapa
└── web/                      React + Vite + Tailwind
    └── src/
        ├── comun/            Cliente del API, estilos y disposición
        └── paginas/          Una página por módulo
```

## Lo que sigue

1. Gestionar usuarios y roles desde la interfaz.
2. Alta y edición de técnicos.
3. Carga real de archivos (hoy la evidencia registra la ruta, no sube el
   archivo): **Supabase Storage** para las fotografías y los clips de video.
4. Trabajo sin señal: **Dexie.js** sobre IndexedDB para el buzón de salida y
   **vite-plugin-pwa** para que el aplicativo abra sin conexión.
5. Salida a **PostgreSQL sobre Supabase**.
