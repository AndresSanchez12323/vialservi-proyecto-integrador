/** Cliente del API. Guarda la sesion y adjunta el token a cada peticion. */

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

export async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
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

// ── Tipos ────────────────────────────────────────────────────────────────
export type Cliente = {
  id: number; documento: string; nombre: string; telefono: string; correo?: string | null;
  _count?: { vehiculos: number; servicios: number };
};

export type Vehiculo = {
  id: number; placa: string; marca: string; modelo: string; color: string;
  cliente?: { id: number; nombre: string; documento: string };
  inventario?: { id: number; descripcion: string; cantidad: number }[];
};

export type Tecnico = {
  id: number; documento: string; nombre: string; telefono: string;
  especialidades: string; licencia?: string | null; disponible: boolean;
  _count?: { servicios: number };
};

export type Servicio = {
  id: number; tipo: string | null; estado: string; direccion: string; descripcion: string;
  solicitadoEn: string; motivoCancelacion?: string | null;
  cliente: { id: number; nombre: string; documento: string; telefono: string };
  vehiculo: { id: number; placa: string; marca: string; modelo: string; color: string };
  tecnico: { id: number; nombre: string; especialidades: string } | null;
  expediente: { id: number; consecutivo: string; cerradoEn: string | null } | null;
};

export type Evidencia = {
  id: number; tipo: string; archivo: string; tomadaEn: string;
  posteriorAlCierre: boolean; subidaPor: { nombre: string; rol: string };
};

export type Expediente = {
  id: number; consecutivo: string; abiertoEn: string;
  observaciones: string | null; observacionesVersion: number;
  cerradoEn: string | null;
  servicio: Servicio & { vehiculo: Vehiculo };
  evidencias: Evidencia[];
  novedades: { id: number; descripcion: string; ocurridaEn: string; posteriorAlCierre: boolean }[];
};

export type Indicadores = {
  porEstado: { estado: string; total: number }[];
  porTipo: { tipo: string; total: number }[];
  expedientes: number; cerrados: number; abiertos: number;
  evidencias: number; novedades: number;
};
