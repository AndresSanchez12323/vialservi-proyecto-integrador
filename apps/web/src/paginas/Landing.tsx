import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sesion } from '../comun/api';
import { inicioPorRol } from '../comun/Atras';
import { Logo } from '../comun/Logo';
// Foto de la tarjeta del héroe: grúa de plataforma cargando un vehículo.
// Dominio público (PD-self, Jelson25, 2006) vía Wikimedia Commons:
// https://commons.wikimedia.org/wiki/File:Flat_Bed_Tow_Truck.jpg
// Se guarda local para no depender de terceros en tiempo de carga.
import gruaHero from '../recursos/grua-hero.jpg';

/**
 * Página de presentación pública (/).
 *
 * Es lo primero que ve quien llega sin sesión: cuenta qué es VialServi y lleva
 * a iniciar sesión o a crear cuenta. No consume el API —no hay datos que
 * cargar— para que abra al instante y funcione aunque el servidor esté
 * arrancando.
 *
 * Reutiliza el lenguaje visual de la aplicación (vidrio esmerilado, ámbar sobre
 * fondo oscuro) para que el salto de la landing a la app no se sienta como
 * cambiar de producto.
 */

// Íconos en SVG inline: no se agregan dependencias ni se cargan imágenes que
// puedan quedar como recuadro roto si no llegan.
const Icono = ({ d, className = '' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
       strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICONOS = {
  grua: 'M3 17h2m0 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m0 0h6m4 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0M3 17V7l5 1 3 4h6l3 3v2M3 7h4',
  taller: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-.6-.6-2.1 2.3-2.3Z',
  conductor: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11m-14 0h14m-14 0v6m0 0v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2m-3 0h3m11-6v6m0 0v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2m3 0h-3M7 14h.01M17 14h.01',
  escudo: 'M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z',
  mapa: 'M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3Zm0 0v15m6-12v15',
  camara: 'M4 8a2 2 0 0 1 2-2h1l1.2-1.6A1 1 0 0 1 9 4h6a1 1 0 0 1 .8.4L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  rayo: 'M13 2L4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z',
};

// ── Carrusel ──────────────────────────────────────────────────────────────
type Lamina = { etiqueta: string; titulo: string; texto: string; icono: string };

const LAMINAS: Lamina[] = [
  {
    etiqueta: 'Carro taller',
    titulo: 'Mecánica y cerrajería en el sitio',
    texto:
      'Si el vehículo no enciende o las llaves quedaron adentro, un técnico llega a donde está y lo atiende. Cada paso queda registrado con fotos y observaciones.',
    icono: ICONOS.taller,
  },
  {
    etiqueta: 'Traslado en grúa',
    titulo: 'Grúa con trazabilidad de principio a fin',
    texto:
      'El vehículo y sus pasajeros llegan al taller, y queda constancia del estado en que se recibió y se entregó. Ante un reclamo, la central responde con evidencias, no con memoria.',
    icono: ICONOS.grua,
  },
  {
    etiqueta: 'Conductor elegido',
    titulo: 'Un conductor para llevarlo a casa',
    texto:
      'Cuando no está en condiciones de manejar, un conductor lleva su vehículo hasta el destino. El servicio queda documentado igual que los demás.',
    icono: ICONOS.conductor,
  },
];

function Carrusel() {
  const [activo, setActivo] = useState(0);
  const [pausado, setPausado] = useState(false);
  const total = LAMINAS.length;

  const ir = useCallback((n: number) => setActivo((n + total) % total), [total]);

  // Avance automático. Se detiene si el usuario pasa el cursor por encima y,
  // sobre todo, si pidió reducir el movimiento: una animación que no se puede
  // parar es una barrera de accesibilidad.
  useEffect(() => {
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducir || pausado) return;
    const id = setInterval(() => setActivo((a) => (a + 1) % total), 5500);
    return () => clearInterval(id);
  }, [pausado, total]);

  return (
    <div
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      aria-roledescription="carrusel"
    >
      <div className="vidrio overflow-hidden p-0">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${activo * 100}%)` }}
        >
          {LAMINAS.map((l) => (
            <article
              key={l.titulo}
              className="min-w-full p-8 sm:p-10"
              aria-hidden={LAMINAS[activo].titulo !== l.titulo}
            >
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-200">
                  <Icono d={l.icono} className="h-7 w-7" />
                </span>
                <span className="etiqueta border border-amber-300/40 bg-amber-400/15 text-amber-200">
                  {l.etiqueta}
                </span>
              </div>
              <h3 className="mt-5 text-2xl font-semibold sm:text-3xl">{l.titulo}</h3>
              <p className="mt-3 max-w-2xl text-slate-300">{l.texto}</p>
            </article>
          ))}
        </div>
      </div>

      {/* Controles en una fila bajo la tarjeta: las flechas absolutas a los
          lados se montaban sobre el titulo en pantallas angostas. */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={() => ir(activo - 1)}
          className="boton-suave !px-2.5 !py-2"
          aria-label="Servicio anterior"
        >
          <Icono d="M15 18l-6-6 6-6" className="h-5 w-5" />
        </button>
        <div className="flex justify-center gap-2">
          {LAMINAS.map((l, i) => (
            <button
              key={l.titulo}
              onClick={() => ir(i)}
              aria-label={`Ir al servicio ${i + 1}`}
              aria-current={i === activo}
              className={`h-2.5 rounded-full transition-all ${
                i === activo ? 'w-8 bg-amber-400' : 'w-2.5 bg-white/25 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => ir(activo + 1)}
          className="boton-suave !px-2.5 !py-2"
          aria-label="Servicio siguiente"
        >
          <Icono d="M9 6l6 6-6 6" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// ── Secciones ───────────────────────────────────────────────────────────────
const Pilar = ({ icono, titulo, texto }: { icono: string; titulo: string; texto: string }) => (
  <article className="vidrio p-6">
    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-400/15 text-sky-200">
      <Icono d={icono} className="h-6 w-6" />
    </span>
    <h3 className="mt-4 text-lg font-semibold">{titulo}</h3>
    <p className="mt-2 text-sm text-slate-300">{texto}</p>
  </article>
);

const Paso = ({ n, titulo, texto }: { n: number; titulo: string; texto: string }) => (
  <li className="vidrio-suave relative p-5 pl-16">
    <span className="absolute left-5 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-900">
      {n}
    </span>
    <h4 className="font-medium">{titulo}</h4>
    <p className="mt-1 text-sm text-slate-400">{texto}</p>
  </li>
);

export function Landing() {
  const haySesion = !!sesion.actual();
  const [compacto, setCompacto] = useState(false);

  // La barra se vuelve opaca al bajar, para que los enlaces no se pierdan sobre
  // una sección clara.
  useEffect(() => {
    const alScroll = () => setCompacto(window.scrollY > 24);
    alScroll();
    window.addEventListener('scroll', alScroll, { passive: true });
    return () => window.removeEventListener('scroll', alScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip">
      {/* ── Barra superior ── */}
      <header
        className={`sticky top-0 z-30 transition-colors ${
          compacto ? 'border-b border-white/10 bg-[#0b1220]/80 backdrop-blur-md' : ''
        }`}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <a href="#inicio" className="flex shrink-0 items-center" aria-label="VialServi: inicio">
            <Logo />
          </a>

          <div className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#servicios" className="hover:text-white">Servicios</a>
            <a href="#como" className="hover:text-white">Cómo funciona</a>
            <a href="#nosotros" className="hover:text-white">Nosotros</a>
          </div>

          <div className="flex items-center gap-2">
            {haySesion ? (
              <Link to={inicioPorRol()} className="boton">Entrar a la app</Link>
            ) : (
              <>
                <Link to="/login" className="boton-suave hidden sm:inline-flex">Iniciar sesión</Link>
                <Link to="/registro" className="boton shrink-0 px-3 py-1.5 text-sm sm:px-4 sm:py-2 sm:text-base">Crear cuenta</Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ── Héroe ── */}
      <section id="inicio" className="mx-auto max-w-6xl px-4 pt-14 pb-20 lg:px-6 lg:pt-20">
        {/* grid-cols-1 explicito: con una sola columna implicita, la pista se
            dimensiona al max-content mas ancho (la cuadrilla de cifras) y
            estira toda la pagina en movil. */}
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          {/* min-w-0: sin esto, en movil la cuadrilla de cifras (3 columnas)
              impone su ancho minimo a toda la columna y el texto de arriba se
              corta por el borde derecho. */}
          <div className="min-w-0">
            <span className="etiqueta border border-sky-300/30 bg-sky-400/10 text-sky-200">
              Asistencia vial · mecánica · grúa · conductor elegido
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Cada atención, en un{' '}
              <span className="text-amber-300">expediente único</span> y recuperable
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              VialServi reúne el formato del servicio, el vehículo, las personas y las
              evidencias en un solo lugar. Cuando un cliente reclama, la respuesta está en
              fotos, videos y registros con fecha y responsable, no en el celular de alguien.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {haySesion ? (
                <Link to={inicioPorRol()} className="boton px-6 py-3 text-base">
                  Entrar a la aplicación
                </Link>
              ) : (
                <>
                  <Link to="/registro" className="boton px-6 py-3 text-base">
                    Crear cuenta de cliente
                  </Link>
                  <Link to="/login" className="boton-suave px-6 py-3 text-base">
                    Ya tengo cuenta
                  </Link>
                </>
              )}
            </div>

            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4">
              {[
                ['3', 'tipos de servicio'],
                ['5', 'años de conservación'],
                ['1', 'expediente por atención'],
              ].map(([v, t]) => (
                <div key={t} className="vidrio-suave min-w-0 px-3 py-3 text-center">
                  <dt className="text-2xl font-semibold text-amber-300">{v}</dt>
                  <dd className="mt-0.5 text-[11px] text-slate-400">{t}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Tarjeta ilustrativa: una vista estilizada del seguimiento, sin datos
              reales, solo para dar una idea de la aplicación. */}
          <div className="relative">
            <div className="vidrio p-6">
              <div className="flex items-center justify-between">
                <span className="etiqueta border border-amber-300/40 bg-amber-400/15 font-mono text-amber-200">
                  EXP-2026-0042
                </span>
                <span className="etiqueta border border-emerald-300/30 bg-emerald-400/20 text-emerald-200">
                  En camino
                </span>
              </div>
              <img
                src={gruaHero}
                alt="Grúa de plataforma cargando un vehículo para su traslado al taller"
                className="mt-4 h-36 w-full rounded-xl border border-white/10 object-cover"
              />
              <div className="mt-4 flex items-center justify-between text-sm">
                <div>
                  <p className="text-slate-400">Técnico asignado</p>
                  <p className="font-medium">Unidad 04 · a 2,9 km</p>
                </div>
                <p className="text-2xl font-semibold text-amber-300">~12 min</p>
              </div>
            </div>
            <div className="vidrio absolute -bottom-5 -left-3 hidden items-center gap-2 px-4 py-2 text-sm sm:flex">
              <Icono d={ICONOS.camara} className="h-5 w-5 text-sky-300" />
              Evidencias con autor y hora
            </div>
          </div>
        </div>
      </section>

      {/* ── Carrusel de servicios ── */}
      <section id="servicios" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 lg:px-6">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-semibold">Qué hacemos</h2>
          <p className="mt-2 text-slate-400">Tres líneas de servicio, un mismo estándar de registro.</p>
        </div>
        <Carrusel />
      </section>

      {/* ── Pilares ── */}
      <section className="mx-auto max-w-6xl px-4 py-14 lg:px-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Pilar
            icono={ICONOS.escudo}
            titulo="Evidencias que respaldan"
            texto="Fotos y videos con quién los aportó y a qué hora se tomaron. Las del técnico y las del cliente quedan separadas y marcadas."
          />
          <Pilar
            icono={ICONOS.mapa}
            titulo="Seguimiento en vivo"
            texto="El cliente ve en el mapa por dónde va el técnico y cuánto falta. La central asigna al más cercano que tenga la especialidad."
          />
          <Pilar
            icono={ICONOS.escudo}
            titulo="Control de acceso por roles"
            texto="Cliente, técnico y central ven solo lo que les corresponde, y el permiso se resuelve en el servidor, no ocultando botones."
          />
          <Pilar
            icono={ICONOS.camara}
            titulo="Verificación de quien entrega"
            texto="El técnico registra en sitio si quien entrega el vehículo es el propietario, y si no, deja constancia de la autorización."
          />
          <Pilar
            icono={ICONOS.rayo}
            titulo="Pensado para el campo"
            texto="La vista del técnico funciona desde el celular, y el registro sin señal está diseñado para no perder datos cuando falla la cobertura."
          />
          <Pilar
            icono={ICONOS.escudo}
            titulo="Conservación ordenada"
            texto="Cada expediente se conserva por cinco años, con consulta operativa y archivo histórico, para responder reclamaciones meses después."
          />
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section id="como" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 lg:px-6">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold">Cómo funciona</h2>
          <p className="mt-2 text-slate-400">Del pedido al cierre, sin huecos de información.</p>
        </div>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Paso n={1} titulo="El cliente solicita" texto="Registra su vehículo y pide el servicio con su ubicación. No crea el expediente: solo describe lo que pasó." />
          <Paso n={2} titulo="La central asigna" texto="Clasifica el servicio y elige al técnico más cercano y disponible. Ahí nace el expediente." />
          <Paso n={3} titulo="El técnico atiende" texto="Llega al sitio, verifica el vehículo, registra evidencias y novedades, y marca el servicio como terminado." />
          <Paso n={4} titulo="La central cierra" texto="Revisa que esté completo y cierra el expediente. Queda recuperable para cualquier consulta futura." />
        </ol>
      </section>

      {/* ── Nosotros ── */}
      <section id="nosotros" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 lg:px-6">
        <div className="vidrio grid grid-cols-1 gap-8 p-8 lg:grid-cols-2 lg:p-10">
          <div>
            <h2 className="text-3xl font-semibold">Quiénes somos</h2>
            <p className="mt-4 text-slate-300">
              VialServi S.A.S es una empresa de asistencia vial. Atendemos varadas
              y emergencias en la vía con tres servicios: carro taller para
              mecánica y cerrajería en el sitio, traslado en grúa y conductor
              elegido.
            </p>
            <p className="mt-3 text-slate-300">
              Nuestro compromiso es doble: llegar rápido y dejar constancia. Cada
              atención queda en un expediente único con el vehículo, las personas,
              las evidencias y los responsables, para responder por el servicio
              con registros, no con memoria.
            </p>
          </div>
          <div className="grid grid-cols-1 content-start gap-4">
            <div className="vidrio-suave p-5">
              <h3 className="font-medium text-amber-200">Atención en Medellín</h3>
              <p className="mt-2 text-sm text-slate-300">
                La central recibe la solicitud, ubica el servicio y asigna al
                técnico disponible más cercano según el tipo de atención.
              </p>
            </div>
            <div className="vidrio-suave p-5">
              <h3 className="font-medium text-sky-200">Seguimiento en vivo</h3>
              <p className="mt-2 text-sm text-slate-300">
                Desde que se asigna el técnico, el cliente ve en el mapa por
                dónde va y cuánto falta, hasta que el servicio termina.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Llamado final ── */}
      <section className="mx-auto max-w-6xl px-4 pb-20 lg:px-6">
        <div className="vidrio flex flex-col items-center gap-5 p-10 text-center">
          <h2 className="text-2xl font-semibold sm:text-3xl">¿Listo para empezar?</h2>
          <p className="max-w-xl text-slate-300">
            Cree su cuenta de cliente, registre su vehículo y solicite su primer servicio.
            El personal de la central y los técnicos ingresan con las credenciales que les
            asigna la empresa.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {haySesion ? (
              <Link to={inicioPorRol()} className="boton px-6 py-3 text-base">Entrar a la aplicación</Link>
            ) : (
              <>
                <Link to="/registro" className="boton px-6 py-3 text-base">Crear cuenta</Link>
                <Link to="/login" className="boton-suave px-6 py-3 text-base">Iniciar sesión</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Pie ── */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-slate-400 sm:flex-row lg:px-6">
          <div className="flex items-center gap-2">
            <Logo className="h-7" />
            <span className="text-slate-400">· {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-5">
            <a href="#servicios" className="hover:text-white">Servicios</a>
            <a href="#como" className="hover:text-white">Cómo funciona</a>
            <Link to="/login" className="hover:text-white">Iniciar sesión</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
