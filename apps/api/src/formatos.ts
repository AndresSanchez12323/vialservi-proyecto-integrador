/**
 * Catalogo de formatos por tipo de servicio, VERSIONADO.
 *
 * VialServi presta tres servicios y cada uno se diligencia distinto: a una
 * grua hay que preguntarle origen y destino; a un carro taller, que labor se
 * hizo; a un conductor elegido, a donde iba. Pedir los mismos campos a los
 * tres deja el expediente a medias en unos casos y con campos vacios en otros.
 *
 * Por que versionado: si manana se agrega un campo obligatorio, los
 * expedientes ya cerrados no pueden volverse "incompletos" de un dia para
 * otro. Cada expediente guarda la VERSION con la que se lleno (formatoTipo y
 * formatoVersion) y se valida contra esa, no contra la ultima.
 *
 * El catalogo vive en codigo y no en la base a proposito en esta etapa: asi
 * queda versionado en Git junto con las reglas que lo validan. Cuando la
 * central necesite editarlo sin un despliegue, se mueve a tabla conservando
 * estas mismas versiones.
 */
import { CategoriaEvidencia, TipoServicio } from '@prisma/client';

export type CampoFormato = {
  clave: string;
  etiqueta: string;
  obligatorio: boolean;
};

export type EvidenciaRequerida = {
  categoria: CategoriaEvidencia;
  minimo: number;
  etiqueta: string;
};

export type Formato = {
  tipo: TipoServicio;
  version: number;
  nombre: string;
  /** Campos propios del tipo, que el tecnico escribe en observaciones. */
  campos: CampoFormato[];
  /** Juego minimo de evidencias para poder cerrar el expediente. */
  evidencias: EvidenciaRequerida[];
};

/**
 * Minimo comun a los tres tipos: una foto de como se recibio el vehiculo y
 * una de como se entrego. Es el par que responde a "ese rayon no estaba".
 */
const RECEPCION_Y_ENTREGA: EvidenciaRequerida[] = [
  { categoria: CategoriaEvidencia.RECEPCION, minimo: 1, etiqueta: 'Estado al recibir' },
  { categoria: CategoriaEvidencia.ENTREGA, minimo: 1, etiqueta: 'Estado al entregar' },
];

export const FORMATOS: Record<TipoServicio, Formato> = {
  [TipoServicio.GRUA]: {
    tipo: TipoServicio.GRUA,
    version: 1,
    nombre: 'Traslado en grua',
    campos: [
      { clave: 'origen', etiqueta: 'Direccion de origen', obligatorio: true },
      { clave: 'destino', etiqueta: 'Direccion de destino', obligatorio: true },
      { clave: 'condiciones', etiqueta: 'Condiciones del traslado', obligatorio: true },
      { clave: 'pasajeros', etiqueta: 'Pasajeros trasladados', obligatorio: false },
    ],
    evidencias: [
      ...RECEPCION_Y_ENTREGA,
      // En una grua el vehiculo se sube a una plataforma y se mueve de sitio:
      // si no queda constancia de como quedo cargado, cualquier dano posterior
      // es imposible de ubicar en el tiempo.
      { categoria: CategoriaEvidencia.GENERAL, minimo: 1, etiqueta: 'Vehiculo cargado en la plataforma' },
    ],
  },

  [TipoServicio.CARRO_TALLER]: {
    tipo: TipoServicio.CARRO_TALLER,
    version: 1,
    nombre: 'Carro taller (mecanica y cerrajeria)',
    campos: [
      { clave: 'laborSolicitada', etiqueta: 'Labor solicitada', obligatorio: true },
      { clave: 'laborRealizada', etiqueta: 'Labor realizada', obligatorio: true },
      { clave: 'repuestos', etiqueta: 'Repuestos utilizados', obligatorio: false },
    ],
    evidencias: RECEPCION_Y_ENTREGA,
  },

  [TipoServicio.CONDUCTOR_ELEGIDO]: {
    tipo: TipoServicio.CONDUCTOR_ELEGIDO,
    version: 1,
    nombre: 'Conductor elegido',
    campos: [
      { clave: 'origen', etiqueta: 'Direccion de origen', obligatorio: true },
      { clave: 'destino', etiqueta: 'Direccion de destino', obligatorio: true },
      { clave: 'kilometraje', etiqueta: 'Kilometraje al recibir y entregar', obligatorio: false },
    ],
    evidencias: RECEPCION_Y_ENTREGA,
  },
};

export const formatoDe = (tipo: TipoServicio): Formato => FORMATOS[tipo];

/** Version vigente de un tipo, que es la que se sella al abrir el expediente. */
export const versionVigente = (tipo: TipoServicio): number => FORMATOS[tipo].version;

/**
 * Evidencias que exige un expediente, segun la version con la que se lleno.
 *
 * Si el expediente guardo una version distinta de la vigente, hoy se responde
 * con la vigente porque solo existe la version 1 de cada formato. Cuando
 * aparezca una version 2, aqui se consulta un historico por (tipo, version)
 * para que un expediente viejo siga midiendose con su propia regla.
 */
export const evidenciasRequeridas = (
  tipo: TipoServicio | null,
  _version?: number | null,
): EvidenciaRequerida[] => (tipo ? FORMATOS[tipo].evidencias : RECEPCION_Y_ENTREGA);

/**
 * Compara lo que exige el formato con lo que hay cargado y devuelve lo que
 * falta. Es lo que impide cerrar un expediente a medias y, de paso, lo que la
 * pantalla usa para mostrarle al tecnico su lista de pendientes.
 */
export const faltantes = (
  requeridas: EvidenciaRequerida[],
  porCategoria: Record<string, number>,
): EvidenciaRequerida[] =>
  requeridas.filter((r) => (porCategoria[r.categoria] ?? 0) < r.minimo);
