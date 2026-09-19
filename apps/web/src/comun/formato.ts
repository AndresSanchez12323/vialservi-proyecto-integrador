export const ESTADOS: Record<string, { texto: string; clase: string }> = {
  SOLICITADO:   { texto: 'Solicitado',   clase: 'bg-slate-400/20 text-slate-200 border border-slate-300/30' },
  ASIGNADO:     { texto: 'Asignado',     clase: 'bg-sky-400/20 text-sky-200 border border-sky-300/30' },
  EN_EJECUCION: { texto: 'En ejecución', clase: 'bg-amber-400/20 text-amber-200 border border-amber-300/30' },
  TERMINADO:    { texto: 'Terminado',    clase: 'bg-violet-400/20 text-violet-200 border border-violet-300/30' },
  CERRADO:      { texto: 'Cerrado',      clase: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/30' },
  CANCELADO:    { texto: 'Cancelado',    clase: 'bg-rose-400/20 text-rose-200 border border-rose-300/30' },
};

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

export const fecha = (v?: string | null) =>
  v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
