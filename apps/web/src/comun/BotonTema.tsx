/**
 * Interruptor de tema: claro, oscuro o el del sistema.
 *
 * Es un desplegable y no un simple alternador de sol y luna porque hay TRES
 * estados, y el tercero —seguir al sistema— es el que trae la aplicacion de
 * fabrica. Con un alternador de dos no habria forma de volver a el despues de
 * elegir uno a mano, y un menu contextual no existe en una pantalla tactil,
 * que es donde mas se va a usar.
 *
 * El icono del boton muestra el tema que se esta VIENDO, no la preferencia:
 * con «el del sistema» a las nueve de la noche, lo honesto es una luna.
 */
import { useEffect, useRef, useState } from 'react';
import { useTema, type Preferencia } from './tema';

const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Sol = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" {...trazo} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
  </svg>
);

const Luna = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" {...trazo} className={className} aria-hidden="true">
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
  </svg>
);

const Equipo = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" {...trazo} className={className} aria-hidden="true">
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M8.5 20h7M12 16.5V20" />
  </svg>
);

const OPCIONES: {
  valor: Preferencia;
  texto: string;
  detalle: string;
  Icono: (p: { className?: string }) => JSX.Element;
}[] = [
  { valor: 'claro', texto: 'Claro', detalle: 'Fondo blanco siempre', Icono: Sol },
  { valor: 'oscuro', texto: 'Oscuro', detalle: 'Fondo oscuro siempre', Icono: Luna },
  { valor: 'sistema', texto: 'El del sistema', detalle: 'Cambia con su equipo', Icono: Equipo },
];

export function BotonTema({ className = '' }: { className?: string }) {
  const { preferencia, tema, cambiarTema } = useTema();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Cerrar al pulsar por fuera o con Escape: un menu que se queda abierto tapa
  // la cabecera justo donde estan las notificaciones y el boton de salir.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`boton-suave !px-2.5 !py-2 ${className}`}
        title="Tema de la pantalla"
        aria-label={`Tema de la pantalla: ${
          preferencia === 'sistema' ? `el del sistema (${tema})` : preferencia
        }`}
        aria-haspopup="menu"
        aria-expanded={abierto}
      >
        {tema === 'oscuro' ? <Luna /> : <Sol />}
      </button>

      {abierto && (
        <div className="vidrio-flotante absolute right-0 z-50 mt-2 w-56 p-1.5" role="menu">
          {OPCIONES.map(({ valor, texto, detalle, Icono }) => (
            <button
              key={valor}
              type="button"
              role="menuitemradio"
              aria-checked={preferencia === valor}
              onClick={() => {
                cambiarTema(valor);
                setAbierto(false);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                preferencia === valor
                  ? 'bg-marca-fondo/20 text-marca'
                  : 'text-tinta-suave hover:bg-velo/10'
              }`}
            >
              <Icono className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{texto}</span>
                <span className="block text-xs text-tinta-tenue">{detalle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
