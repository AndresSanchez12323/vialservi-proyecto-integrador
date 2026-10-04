export const ESTADOS: Record<string, { texto: string; clase: string }> = {
  SOLICITADO:   { texto: 'Solicitado',   clase: 'bg-slate-400/20 text-slate-200 border border-slate-300/30' },
  ASIGNADO:     { texto: 'Asignado',     clase: 'bg-sky-400/20 text-sky-200 border border-sky-300/30' },
  EN_EJECUCION: { texto: 'En ejecución', clase: 'bg-amber-400/20 text-amber-200 border border-amber-300/30' },
  TERMINADO:    { texto: 'Terminado',    clase: 'bg-violet-400/20 text-violet-200 border border-violet-300/30' },
  CERRADO:      { texto: 'Cerrado',      clase: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/30' },
  CANCELADO:    { texto: 'Cancelado',    clase: 'bg-rose-400/20 text-rose-200 border border-rose-300/30' },
  RECHAZADO:    { texto: 'Rechazado',    clase: 'bg-rose-400/20 text-rose-200 border border-rose-300/30' },
};

/**
 * Lo mismo visto por el cliente. Para él «solicitado» no significa nada: lo
 * que necesita saber es que su solicitud está en manos de la central, y que
 * «terminado» no es lo último porque falta que la central cierre.
 */
export const ESTADOS_CLIENTE: Record<string, string> = {
  SOLICITADO: 'En verificación por la central',
  ASIGNADO: 'Técnico asignado, en camino',
  EN_EJECUCION: 'El técnico está atendiendo',
  TERMINADO: 'Atención terminada, en revisión',
  CERRADO: 'Servicio cerrado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'No aceptado',
};

/** El paso en el que va el servicio, para la barra de avance del cliente. */
export const PASOS = ['SOLICITADO', 'ASIGNADO', 'EN_EJECUCION', 'TERMINADO', 'CERRADO'] as const;

export const pasoDe = (estado: string) => PASOS.indexOf(estado as (typeof PASOS)[number]);

// Mismo tope que MAX_VEHICULOS_CLIENTE en apps/api/src/modulos/vehiculos.ts.
export const MAX_VEHICULOS_CLIENTE = 5;

export const TIPOS: Record<string, string> = {
  GRUA: 'Traslado en grúa',
  CARRO_TALLER: 'Carro taller',
  CONDUCTOR_ELEGIDO: 'Conductor elegido',
};

export const ROLES: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  CENTRAL: 'Central de Operaciones',
  TECNICO: 'Técnico',
  CLIENTE: 'Cliente',
};

/** Categorías de evidencia: qué prueba cada foto. */
export const CATEGORIAS: Record<string, { texto: string; clase: string }> = {
  GENERAL:      { texto: 'General',            clase: 'border-slate-300/30 bg-slate-400/15 text-slate-200' },
  RECEPCION:    { texto: 'Al recibir',         clase: 'border-sky-300/30 bg-sky-400/15 text-sky-200' },
  ENTREGA:      { texto: 'Al entregar',        clase: 'border-emerald-300/30 bg-emerald-400/15 text-emerald-200' },
  DANO:         { texto: 'Daño',               clase: 'border-rose-300/30 bg-rose-400/15 text-rose-200' },
  FIRMA_CEDULA: { texto: 'Cédula con firma',   clase: 'border-amber-300/40 bg-amber-400/20 text-amber-200' },
  DOCUMENTO:    { texto: 'Documento',          clase: 'border-violet-300/30 bg-violet-400/15 text-violet-200' },
};

export const NOTIFICACIONES: Record<string, string> = {
  SERVICIO_SOLICITADO: '🔔',
  SERVICIO_ASIGNADO: '🚗',
  SERVICIO_RECHAZADO: '⛔',
  SERVICIO_CANCELADO: '✖️',
  TECNICO_EN_CAMINO: '🛣️',
  SERVICIO_INICIADO: '🔧',
  SERVICIO_TERMINADO: '✅',
  EXPEDIENTE_CERRADO: '📁',
  EVIDENCIA_CLIENTE: '📷',
  VERIFICACION_NO_PROPIETARIO: '⚠️',
};

export const fecha = (v?: string | null) =>
  v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const hora = (v?: string | null) =>
  v ? new Date(v).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';

/** «hace 3 minutos»: una posición sin antigüedad no se puede interpretar. */
export const haceCuanto = (v?: string | null) => {
  if (!v) return 'sin dato';
  const minutos = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (minutos < 1) return 'hace unos segundos';
  if (minutos === 1) return 'hace 1 minuto';
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return 'hace 1 hora';
  if (horas < 24) return `hace ${horas} horas`;
  return fecha(v);
};
