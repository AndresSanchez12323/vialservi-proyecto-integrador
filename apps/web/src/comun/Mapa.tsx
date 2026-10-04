/**
 * Mapa con Leaflet sobre OpenStreetMap.
 *
 * Por que OSM y no Google o Mapbox: no necesita llave de API, no cobra por
 * consulta y no obliga a registrar una tarjeta para que el proyecto funcione.
 * Para lo que aqui se muestra —donde esta el vehiculo, donde va el tecnico y a
 * que distancia— alcanza de sobra.
 *
 * El marcador por defecto de Leaflet carga sus imagenes desde una ruta
 * relativa que con un empaquetador queda mal, asi que se usan marcadores de
 * HTML (divIcon) con los mismos estilos de la aplicacion. Ademas se ven mejor
 * sobre el fondo oscuro.
 */
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type Punto = { lat: number; lng: number };

/** Un punto que ademas se sabe de quien es, para rotularlo en el mapa. */
export type PuntoNombrado = Punto & { etiqueta?: string };

/** Marcador redondo con un emoji, sin imagenes externas. */
const icono = (emoji: string, color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:999px;
      background:${color};border:2px solid rgba(255,255,255,.85);
      box-shadow:0 4px 12px rgba(0,0,0,.45);font-size:17px;line-height:1;
    ">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });

const iconoVehiculo = icono('🚘', 'rgba(251,146,60,.95)');
const iconoTecnico = icono('🔧', 'rgba(56,189,248,.95)');

/**
 * Reencuadra el mapa sobre los puntos que hay que mostrar.
 *
 * Antes de encuadrar hay que llamar a invalidateSize(). Leaflet mide el
 * contenedor una sola vez, al montarlo, y en ese momento puede no tener aun su
 * tamano definitivo; si se encuadra con la medida equivocada, el zoom sale mal
 * (se ve medio departamento en vez de la ciudad) y los mosaicos quedan a
 * parches. Por eso ambas cosas van juntas, y se repiten cuando el contenedor
 * cambia de tamano.
 */
function Encuadrar({ puntos }: { puntos: Punto[] }) {
  const mapa = useMap();

  useEffect(() => {
    const ajustar = () => {
      mapa.invalidateSize();
      if (puntos.length === 0) return;
      if (puntos.length === 1) {
        mapa.setView([puntos[0].lat, puntos[0].lng], 15);
        return;
      }
      mapa.fitBounds(
        L.latLngBounds(puntos.map((p) => [p.lat, p.lng] as [number, number])),
        // Un margen para que los marcadores no queden pegados al borde, pero
        // corto: en un mapa bajo, 40 px arriba y abajo se comen un tercio del
        // alto y obligan a alejar el zoom mas de lo necesario.
        { padding: [24, 24], maxZoom: 15 },
      );
    };

    // Despues del primer pintado, cuando el contenedor ya tiene su tamano.
    const alPintar = requestAnimationFrame(ajustar);
    const observador = new ResizeObserver(ajustar);
    observador.observe(mapa.getContainer());

    return () => {
      cancelAnimationFrame(alPintar);
      observador.disconnect();
    };
    // La dependencia es el contenido, no el arreglo: si se usara `puntos` el
    // efecto correria en cada render porque es un arreglo nuevo cada vez.
  }, [mapa, JSON.stringify(puntos)]);

  return null;
}

type Props = {
  /** Donde esta el vehiculo. */
  destino?: Punto | null;
  /** Donde esta el tecnico. */
  tecnico?: Punto | null;
  /** Varios tecnicos a la vez, para el tablero de la central. */
  tecnicos?: PuntoNombrado[];
  etiquetaDestino?: string;
  etiquetaTecnico?: string;
  alto?: string;
  /** Si se pasa, al pulsar el mapa se elige ese punto. */
  alElegir?: (p: Punto) => void;
};

/** Recoge el clic para elegir un punto, cuando el mapa es un selector. */
function Seleccionar({ alElegir }: { alElegir: (p: Punto) => void }) {
  const mapa = useMap();
  useEffect(() => {
    const manejar = (e: L.LeafletMouseEvent) =>
      alElegir({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) });
    mapa.on('click', manejar);
    return () => {
      mapa.off('click', manejar);
    };
  }, [mapa, alElegir]);
  return null;
}

// Centro de Medellin: el encuadre inicial cuando todavia no hay ningun punto.
const MEDELLIN: Punto = { lat: 6.2442, lng: -75.5812 };

export function Mapa({
  destino,
  tecnico,
  tecnicos,
  etiquetaDestino = 'Vehículo',
  etiquetaTecnico = 'Técnico',
  alto = '18rem',
  alElegir,
}: Props) {
  // Todos los puntos cuentan para el encuadre: si solo contara el primero, un
  // tablero con varios tecnicos encuadraria sobre uno y dejaria fuera al resto.
  const puntos = useMemo(
    () => [destino, tecnico, ...(tecnicos ?? [])].filter((p): p is Punto => !!p),
    [destino, tecnico, tecnicos],
  );
  const centro = puntos[0] ?? MEDELLIN;

  return (
    <div className="overflow-hidden rounded-xl border border-white/15" style={{ height: alto }}>
      <MapContainer
        center={[centro.lat, centro.lng]}
        zoom={13}
        style={{ height: '100%', width: '100%', background: '#0b1220' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {destino && (
          <Marker position={[destino.lat, destino.lng]} icon={iconoVehiculo}>
            <Popup>{etiquetaDestino}</Popup>
          </Marker>
        )}
        {tecnico && (
          <Marker position={[tecnico.lat, tecnico.lng]} icon={iconoTecnico}>
            <Popup>{etiquetaTecnico}</Popup>
          </Marker>
        )}
        {tecnicos?.map((t, i) => (
          <Marker key={`${t.lat},${t.lng},${i}`} position={[t.lat, t.lng]} icon={iconoTecnico}>
            <Popup>{t.etiqueta ?? etiquetaTecnico}</Popup>
          </Marker>
        ))}

        {/* La linea recta entre los dos puntos. No es la ruta por calles: se
            dibuja punteada justamente para no dar a entender que lo es. */}
        {destino && tecnico && (
          <Polyline
            positions={[
              [tecnico.lat, tecnico.lng],
              [destino.lat, destino.lng],
            ]}
            pathOptions={{ color: '#38bdf8', weight: 3, opacity: 0.7, dashArray: '8 8' }}
          />
        )}

        <Encuadrar puntos={puntos} />
        {alElegir && <Seleccionar alElegir={alElegir} />}
      </MapContainer>
    </div>
  );
}

/** Resultado de pedir la ubicacion: o el punto, o el motivo de que no haya. */
export type ResultadoUbicacion =
  | { punto: Punto; error?: undefined }
  | { punto?: undefined; error: string };

/**
 * Cada causa dice que hacer, porque son remedios distintos. Antes las tres se
 * reportaban como "revise el permiso del navegador", que manda a mirar donde no
 * es cuando el permiso ya esta concedido.
 */
const MOTIVOS: Record<number, string> = {
  1: 'El navegador tiene bloqueada la ubicacion para este sitio. Permitala en el candado de la barra de direcciones.',
  2: 'El equipo no logro determinar donde esta. En Windows suele ser que «permitir que las aplicaciones de escritorio accedan a tu ubicacion» esta apagado, en Configuracion › Privacidad › Ubicacion. Puede marcarla a mano en el mapa.',
  3: 'La ubicacion tardo demasiado en responder. Intente de nuevo o marquela a mano en el mapa.',
};

const pedirPosicion = (opciones: PositionOptions) =>
  new Promise<GeolocationPosition>((ok, mal) =>
    navigator.geolocation.getCurrentPosition(ok, mal, opciones),
  );

const comoPunto = (p: GeolocationPosition): Punto => ({
  lat: Number(p.coords.latitude.toFixed(6)),
  lng: Number(p.coords.longitude.toFixed(6)),
});

/**
 * Pide la ubicacion del navegador.
 *
 * Dos intentos a proposito. El primero exige alta precision, que es lo que se
 * quiere en un telefono con GPS. En un equipo de escritorio no hay GPS y ese
 * intento suele agotar el tiempo o no encontrar nada, asi que el segundo la
 * pide sin exigir precision, con mas tiempo y aceptando una lectura reciente
 * en cache. Una ubicacion aproximada sirve: se usa para calcular a que
 * distancia esta el tecnico, no para dibujar su calle exacta.
 *
 * Si la persona NIEGA el permiso no se reintenta: no hay nada que reintentar.
 */
export const ubicacionActual = async (): Promise<ResultadoUbicacion> => {
  if (!navigator.geolocation) {
    return { error: 'Este navegador no ofrece geolocalizacion. Marque el punto en el mapa.' };
  }

  try {
    return { punto: comoPunto(await pedirPosicion({ enableHighAccuracy: true, timeout: 8000 })) };
  } catch (primero) {
    if ((primero as GeolocationPositionError).code === 1) return { error: MOTIVOS[1] };

    try {
      return {
        punto: comoPunto(
          await pedirPosicion({ enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }),
        ),
      };
    } catch (segundo) {
      const e = segundo as GeolocationPositionError;
      return { error: MOTIVOS[e.code] ?? 'No se pudo obtener la ubicacion. Marquela a mano en el mapa.' };
    }
  }
};
