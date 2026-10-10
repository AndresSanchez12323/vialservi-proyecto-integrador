/** Cliente del API. Guarda la sesion y adjunta el token a cada peticion. */
import { crearReactivador } from './reactivarApi';

const LLAVE = 'vialservi.sesion';

export type Sesion = { id: number; rol: string; nombre: string };

let memoria: { token: string; usuario: Sesion } | null = (() => {
  try {
    const crudo = localStorage.getItem(LLAVE);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
})();

export const sesion = {
  actual: () => memoria,
  usuario: () => memoria?.usuario ?? null,
  rol: () => memoria?.usuario.rol ?? null,
  guardar: (token: string, usuario: Sesion) => {
    memoria = { token, usuario };
    localStorage.setItem(LLAVE, JSON.stringify(memoria));
  },
  cerrar: () => {
    memoria = null;
    localStorage.removeItem(LLAVE);
  },
};

/**
 * Base del API.
 *
 * Vacia por omision, y eso es lo deseable: las peticiones salen como /api/...
 * relativas. En desarrollo las atiende el proxy de Vite y en produccion
 * CloudFront, que sirve el SPA y enruta /api/* al API. Al compartir origen no
 * hay CORS, no hay contenido mixto y el service worker de la PWA (etapa 2)
 * podra cachear del mismo origen.
 *
 * Solo se define VITE_API_URL si el API queda en otro dominio.
 */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Arma la direccion final de una ruta del API. */
export const url = (ruta: string) => `${BASE}/api${ruta}`;
const reactivarBase = crearReactivador(url('/listo'));

export async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  if (import.meta.env.PROD && !['GET', 'HEAD', 'OPTIONS'].includes((opciones.method ?? 'GET').toUpperCase())) {
    await reactivarBase();
  }
  const respuesta = await fetch(url(ruta), {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(memoria ? { Authorization: `Bearer ${memoria.token}` } : {}),
      ...opciones.headers,
    },
  });

  if (respuesta.status === 401) {
    sesion.cerrar();
    window.location.href = '/login';
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error ?? `Error ${respuesta.status}`);
  }
  return respuesta.json() as Promise<T>;
}

export const enviar = <T>(ruta: string, metodo: string, cuerpo?: unknown) =>
  pedir<T>(ruta, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined });

/** Peticion sin sesion, para registro y recuperacion de clave. */
export const publico = async <T>(ruta: string, cuerpo: unknown): Promise<T> => {
  if (import.meta.env.PROD) await reactivarBase();
  const respuesta = await fetch(url(ruta), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) {
    const error = await respuesta.json().catch(() => ({}));
    throw new Error(error.error ?? `Error ${respuesta.status}`);
  }
  return respuesta.json() as Promise<T>;
};

// ── Tipos ────────────────────────────────────────────────────────────────
export type Cliente = {
  id: number; documento: string; nombre: string; telefono: string; correo?: string | null;
  _count?: { vehiculos: number; servicios: number };
  servicios?: ServicioResumen[];
};

// Resumen para el control de la central: situación de cada servicio del cliente.
export type ServicioResumen = {
  id: number; estado: string; tipo: string | null; tipoSolicitado?: string | null;
  direccion: string; solicitadoEn: string;
  vehiculo: { placa: string };
  expediente: { id: number; consecutivo: string; cerradoEn: string | null } | null;
};

export type Vehiculo = {
  id: number; placa: string; marca: string; modelo: string; color: string;
  linea?: string | null; clase?: string | null; licenciaTransito?: string | null;
  vin?: string | null; chasis?: string | null; motor?: string | null;
  propietarioNombre?: string | null; propietarioDocumento?: string | null;
  cliente?: { id: number; nombre: string; documento: string };
  inventario?: { id: number; descripcion: string; cantidad: number }[];
};

export type Tecnico = {
  id: number; documento: string; nombre: string; telefono: string;
  especialidades: string; licencia?: string | null; disponible: boolean;
  lat?: number | null; lng?: number | null; ubicacionEn?: string | null;
  _count?: { servicios: number };
  activos?: number;
  enCurso?: { id: number; estado: string; vehiculo: { placa: string } }[];
};

/** Fila del tablero de asignación de la central. */
export type TecnicoTablero = Tecnico & {
  distanciaKm: number | null;
  minutosEstimados: number | null;
  apto: boolean;
};

export type Tablero = {
  servicio: { id: number; lat: number | null; lng: number | null; direccion: string } | null;
  especialidadRequerida: string | null;
  tecnicos: TecnicoTablero[];
};

/** Lo que se calcula y no se guarda: cuánto falta para que llegue el técnico. */
export type Seguimiento = {
  distanciaKm: number | null;
  minutosEstimados: number | null;
  origenDelTiempo: 'tecnico' | 'estimado' | null;
  informadoEn: string | null;
};

export type Servicio = {
  id: number; tipo: string | null; tipoSolicitado?: string | null; estado: string;
  direccion: string; descripcion: string; solicitadoEn: string;
  lat?: number | null; lng?: number | null; contactoTelefono?: string | null;
  asignadoEn?: string | null; iniciadoEn?: string | null; terminadoEn?: string | null;
  etaMinutos?: number | null; etaActualizadoEn?: string | null;
  motivoCancelacion?: string | null; motivoRechazo?: string | null;
  cliente: { id: number; nombre: string; documento: string; telefono: string };
  vehiculo: { id: number; placa: string; marca: string; modelo: string; color: string };
  tecnico: {
    id: number; nombre: string; telefono?: string; especialidades: string;
    lat?: number | null; lng?: number | null; ubicacionEn?: string | null;
  } | null;
  expediente: {
    id: number; consecutivo: string; cerradoEn: string | null;
    esPropietario?: boolean | null; verificadoEn?: string | null;
  } | null;
  seguimiento: Seguimiento;
};

export type Evidencia = {
  id: number; tipo: string; categoria: string; archivo: string; tomadaEn: string;
  posteriorAlCierre: boolean; subidaPor: { nombre: string; rol: string };
};

export type EvidenciaRequerida = { categoria: string; minimo: number; etiqueta: string };

export type Formato = {
  tipo: string; version: number; nombre: string;
  campos: { clave: string; etiqueta: string; obligatorio: boolean }[];
  evidencias: EvidenciaRequerida[];
};

/** Lo que le falta al expediente para poder cerrarse. */
export type ControlExpediente = {
  porCategoria: Record<string, number>;
  requeridas: EvidenciaRequerida[];
  faltantes: EvidenciaRequerida[];
  avisos: string[];
  listoParaCerrar: boolean;
};

export type Expediente = {
  id: number; consecutivo: string; abiertoEn: string;
  formatoTipo: string | null; formatoVersion: number | null;
  observaciones: string | null; observacionesVersion: number;
  esPropietario: boolean | null;
  solicitanteNombre: string | null;
  solicitanteDocumento: string | null;
  solicitanteRelacion: string | null;
  verificadoEn: string | null;
  verificacionVersion: number;
  revisionCentral: string | null;
  cerradoEn: string | null;
  servicio: Servicio & { vehiculo: Vehiculo };
  evidencias: Evidencia[];
  novedades: { id: number; descripcion: string; ocurridaEn: string; posteriorAlCierre: boolean }[];
  formato: Formato | null;
  control: ControlExpediente;
};

export type Notificacion = {
  id: number; tipo: string; titulo: string; mensaje: string;
  leidaEn: string | null; creadaEn: string;
  servicioId: number | null; expedienteId: number | null;
  servicio: {
    id: number; estado: string;
    vehiculo: { placa: string };
    expediente: { id: number; consecutivo: string } | null;
  } | null;
};

export type Bandeja = { sinLeer: number; lista: Notificacion[] };

export type Indicadores = {
  porEstado: { estado: string; total: number }[];
  porTipo: { tipo: string; total: number }[];
  expedientes: number; cerrados: number; abiertos: number;
  evidencias: number; novedades: number;
};
