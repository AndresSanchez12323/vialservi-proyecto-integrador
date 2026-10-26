/**
 * Lectura de la licencia de transito en dos tomas: frente y reverso.
 *
 * ── Por que dos pasos guiados y no un solo boton de «subir foto» ──────────
 * El documento lleva los datos del vehiculo por un lado y los del propietario
 * por el otro, asi que con una sola foto la mitad del formulario se queda
 * vacia. Y pedir «suba las dos caras» sin mas termina en dos fotos del mismo
 * lado. Por eso el componente lleva de la mano: toma el frente, dice que
 * leyo, y solo entonces pide el reverso; es el mismo recorrido de cualquier
 * verificacion de documento, porque es el que la gente ya conoce.
 *
 * ── Quien lo usa ──────────────────────────────────────────────────────────
 * El CLIENTE al registrar su vehiculo, y el TECNICO en el sitio cuando el
 * cliente registro el vehiculo sin los datos del documento, que es lo normal
 * porque no se los pedimos. Es el mismo componente en los dos casos: el
 * recorrido no tiene por que ser distinto segun quien tenga el telefono.
 *
 * Nada se guarda aqui. Lo leido llena el formulario, editable, y lo guarda
 * quien lo contiene: el OCR se equivoca y la persona que tiene el documento
 * en la mano es la que decide.
 */
import { useEffect, useRef, useState } from 'react';
import { camposLeidos, juntarTarjeta, leerTarjeta, type CaraTarjeta, type DatosTarjeta } from './api';
import { prepararFotoDocumento, soltarVistaPrevia, vistaPrevia } from './foto';
import { etiquetaTarjeta } from './formato';
import { avisoError } from './avisos';

type Paso = CaraTarjeta | 'listo';

const GUIA: Record<CaraTarjeta, { titulo: string; ayuda: string; numero: string }> = {
  frente: {
    numero: '1',
    titulo: 'Frente del documento',
    ayuda: 'El lado donde están la placa, la marca y la línea del vehículo.',
  },
  reverso: {
    numero: '2',
    titulo: 'Reverso del documento',
    ayuda: 'Déle la vuelta: es el lado donde figura el propietario.',
  },
};

/** Marco punteado con la proporcion de una tarjeta, para encuadrar la foto. */
function Marco({
  cara,
  foto,
  estado,
}: {
  cara: CaraTarjeta;
  foto: string | null;
  estado: 'espera' | 'leyendo' | 'leido' | 'fallo';
}) {
  return (
    <div
      className={`relative flex aspect-[1.6/1] w-full max-w-sm items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
        estado === 'leido'
          ? 'border-exito/50 bg-exito-fondo/10'
          : estado === 'fallo'
            ? 'border-riesgo/50 bg-riesgo-fondo/10'
            : 'border-velo/25 bg-velo/5'
      }`}
    >
      {foto ? (
        <>
          <img src={foto} alt={`Foto del ${cara} de la tarjeta`} className="h-full w-full object-cover" />
          {/* Un velo con el acuse encima de la foto: sin el, en una foto clara
              el texto blanco desaparece. */}
          <span
            className={`absolute bottom-0 left-0 right-0 px-3 py-1.5 text-center text-xs font-medium ${
              estado === 'fallo' ? 'bg-riesgo-fondo/90 text-marca-tinta' : 'bg-exito-fondo/90 text-marca-tinta'
            }`}
          >
            {estado === 'fallo' ? 'No se pudo leer' : estado === 'leyendo' ? 'Leyendo…' : '✓ Leído'}
          </span>
        </>
      ) : (
        <div className="px-6 text-center">
          {/* Dibujo del documento: dos lineas de texto y un recuadro de foto.
              No es decoracion, dice como hay que encuadrarlo. */}
          <svg viewBox="0 0 64 40" className="mx-auto h-12 w-20 text-tinta-tenue" aria-hidden="true">
            <rect x="1" y="1" width="62" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <rect x="6" y="8" width="16" height="20" rx="2" fill="currentColor" opacity="0.25" />
            <path
              d="M27 10h30M27 16h30M27 22h22M27 28h26"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.55"
            />
          </svg>
          <p className="mt-2 text-xs text-tinta-tenue">
            {estado === 'leyendo' ? 'Leyendo la foto…' : `Encuadre el ${cara} completo`}
          </p>
        </div>
      )}
    </div>
  );
}

export function CapturaTarjeta({
  alLeer,
  conReverso = true,
  nota,
  className = '',
}: {
  /** Se llama tras cada cara leida, con TODO lo acumulado hasta ese momento. */
  alLeer: (datos: DatosTarjeta) => void;
  /** El reverso solo trae al propietario: quien no lo necesita puede apagarlo. */
  conReverso?: boolean;
  nota?: string;
  className?: string;
}) {
  const [paso, setPaso] = useState<Paso>('frente');
  const [leyendo, setLeyendo] = useState(false);
  const [datos, setDatos] = useState<DatosTarjeta>({});
  const [fotos, setFotos] = useState<Partial<Record<CaraTarjeta, string>>>({});
  const [fallo, setFallo] = useState<CaraTarjeta | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  // Las URL de las vistas previas son objetos vivos del navegador: si no se
  // sueltan, cada foto que se toma deja su copia en memoria hasta recargar.
  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  useEffect(() => () => Object.values(fotosRef.current).forEach(soltarVistaPrevia), []);

  const caraActual: CaraTarjeta = paso === 'listo' ? 'reverso' : paso;

  const procesar = async (archivo: File | undefined, cara: CaraTarjeta) => {
    if (!archivo) return;
    setLeyendo(true);
    setFallo(null);

    let previa: string | null = null;
    try {
      const jpeg = await prepararFotoDocumento(archivo);
      previa = vistaPrevia(jpeg);
      // La vista previa se pone ya: el analisis tarda unos segundos y mientras
      // tanto la persona tiene que ver que su foto SI se tomo.
      setFotos((anteriores) => {
        soltarVistaPrevia(anteriores[cara] ?? null);
        return { ...anteriores, [cara]: previa! };
      });

      const leido = await leerTarjeta(jpeg, cara);
      const juntos = juntarTarjeta(datos, leido);
      setDatos(juntos);
      alLeer(juntos);
      setPaso(cara === 'frente' && conReverso ? 'reverso' : 'listo');
    } catch (e) {
      setFallo(cara);
      avisoError(e, cara === 'frente' ? 'No se pudo leer el frente' : 'No se pudo leer el reverso');
    } finally {
      setLeyendo(false);
    }
  };

  const pedirFoto = () => entrada.current?.click();

  const reiniciar = () => {
    Object.values(fotos).forEach(soltarVistaPrevia);
    setFotos({});
    setDatos({});
    setFallo(null);
    setPaso('frente');
  };

  const leidos = camposLeidos(datos);
  const guia = GUIA[caraActual];
  const estadoMarco = fallo === caraActual
    ? 'fallo'
    : leyendo
      ? 'leyendo'
      : fotos[caraActual]
        ? 'leido'
        : 'espera';

  return (
    <div className={`vidrio-suave space-y-3 p-4 ${className}`}>
      <input
        ref={entrada}
        type="file"
        // Cualquier imagen: el iPhone entrega HEIC y el navegador la convierte
        // a JPG antes de subirla (comun/foto.ts). Exigir JPG aqui dejaba al
        // usuario de iPhone sin poder cumplir el requisito.
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          // Se limpia para que volver a elegir la MISMA foto vuelva a disparar
          // el cambio: si no, un reintento no haria nada.
          e.target.value = '';
          void procesar(archivo, caraActual);
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Leer la tarjeta de propiedad</p>
          <p className="text-xs text-tinta-tenue">
            {nota ?? 'Se toma una foto de cada cara y los datos quedan editables antes de guardar.'}
          </p>
        </div>
        {conReverso && (
          <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
            {(['frente', 'reverso'] as const).map((c) => (
              <span
                key={c}
                className={`h-2 w-6 rounded-full transition-colors ${
                  fotos[c] && fallo !== c
                    ? 'bg-exito-fondo'
                    : caraActual === c && paso !== 'listo'
                      ? 'bg-marca-fondo'
                      : 'bg-velo/20'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {paso === 'listo' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {(['frente', 'reverso'] as const).map((c) =>
              fotos[c] ? (
                <img
                  key={c}
                  src={fotos[c]}
                  alt={`Foto del ${c}`}
                  className="h-16 w-24 shrink-0 rounded-lg border border-velo/15 object-cover"
                />
              ) : null,
            )}
          </div>
          <p className="text-sm text-exito">
            ✓ Listo. {leidos.length === 1 ? 'Se pasó 1 dato' : `Se pasaron ${leidos.length} datos`} al
            formulario. Compárelos con el documento y corrija lo que haga falta.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-marca">
              {conReverso ? `Paso ${guia.numero} de 2 · ` : ''}
              {guia.titulo}
            </p>
            <p className="text-xs text-tinta-tenue">{guia.ayuda}</p>
          </div>

          <Marco cara={caraActual} foto={fotos[caraActual] ?? null} estado={estadoMarco} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="boton" disabled={leyendo} onClick={pedirFoto}>
              {leyendo
                ? 'Leyendo…'
                : fotos[caraActual]
                  ? '📷 Repetir la foto'
                  : `📷 Tomar foto del ${caraActual}`}
            </button>
            {paso === 'reverso' && (
              <button
                type="button"
                className="text-xs text-tinta-tenue underline hover:text-tinta"
                disabled={leyendo}
                onClick={() => setPaso('listo')}
              >
                Omitir el reverso
              </button>
            )}
          </div>

          <p className="text-[11px] text-tinta-sutil">
            Con buena luz, sin reflejos y con el documento llenando el marco. La foto se procesa
            con Amazon Textract y se borra en cuanto termina: no queda guardada.
          </p>
        </div>
      )}

      {leidos.length > 0 && (
        <div className="border-t border-velo/10 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-tinta-tenue">
            Datos leídos ({leidos.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {leidos.map(([clave, valor]) => (
              <li key={clave} className="etiqueta border border-exito/30 bg-exito-fondo/10 text-exito">
                <span className="text-tinta-tenue">{etiquetaTarjeta(clave)}:</span>
                <span className="ml-1 font-medium">{valor}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 text-xs text-tinta-tenue underline hover:text-tinta"
            onClick={reiniciar}
            disabled={leyendo}
          >
            Volver a empezar la lectura
          </button>
        </div>
      )}
    </div>
  );
}
