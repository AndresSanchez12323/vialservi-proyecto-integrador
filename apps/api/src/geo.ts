/**
 * Distancia y tiempo estimado entre dos puntos.
 *
 * A proposito NO se usa un servicio de rutas externo: eso exigiria una llave
 * de API, conexion a internet y un costo por consulta. Para lo que el sistema
 * necesita —escoger al tecnico mas cercano y decirle al cliente un tiempo
 * aproximado— la distancia en linea recta corregida por un factor de calle
 * alcanza, y nunca deja la pantalla en blanco porque un tercero no responda.
 *
 * El tiempo que se muestra es SIEMPRE una estimacion. Si el tecnico informa
 * su propio tiempo, el del tecnico manda: el esta en la via y sabe si hay
 * trancon.
 */

export type Punto = { lat: number; lng: number };

const RADIO_TIERRA_KM = 6371;

/** Distancia en kilometros en linea recta (formula del haversine). */
export const distanciaKm = (a: Punto, b: Punto): number => {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
};

// La linea recta subestima el recorrido real: en una ciudad con calles en
// cuadricula y vias de una sola mano se recorre cerca de 1.4 veces mas.
const FACTOR_CALLE = 1.4;
// Velocidad promedio en ciudad contando semaforos, no velocidad de crucero.
const VELOCIDAD_KMH = 25;
// Alistar el equipo y salir nunca es instantaneo.
const MINUTOS_ALISTAMIENTO = 5;

/** Kilometros aproximados de recorrido por calle, no en linea recta. */
export const distanciaRecorridoKm = (a: Punto, b: Punto) =>
  distanciaKm(a, b) * FACTOR_CALLE;

/** Minutos estimados de llegada. Nunca menos de 5: nadie llega al instante. */
export const estimarMinutos = (a: Punto, b: Punto): number => {
  const minutos = (distanciaRecorridoKm(a, b) / VELOCIDAD_KMH) * 60;
  return Math.max(5, Math.round(minutos + MINUTOS_ALISTAMIENTO));
};

/** true si ambos puntos tienen coordenadas utilizables. */
export const esPunto = (
  lat?: number | null,
  lng?: number | null,
): lat is number =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  // 0,0 es el golfo de Guinea: en la practica significa "sin dato".
  !(lat === 0 && lng === 0);

/** Punto o null, para no repetir la comprobacion en cada modulo. */
export const puntoDe = (lat?: number | null, lng?: number | null): Punto | null =>
  esPunto(lat, lng) && typeof lng === 'number' ? { lat, lng } : null;
