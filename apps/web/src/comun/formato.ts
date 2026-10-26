import type { DatosTarjeta } from './api';

export const ESTADOS: Record<string, { texto: string; clase: string }> = {
  SOLICITADO:   { texto: 'Solicitado',   clase: 'bg-neutro-fondo/20 text-tinta-suave border border-neutro/30' },
  ASIGNADO:     { texto: 'Asignado',     clase: 'bg-dato-fondo/20 text-dato border border-dato/30' },
  EN_EJECUCION: { texto: 'En ejecución', clase: 'bg-marca-fondo/20 text-marca border border-marca/30' },
  TERMINADO:    { texto: 'Terminado',    clase: 'bg-cierre-fondo/20 text-cierre border border-cierre/30' },
  CERRADO:      { texto: 'Cerrado',      clase: 'bg-exito-fondo/20 text-exito border border-exito/30' },
  CANCELADO:    { texto: 'Cancelado',    clase: 'bg-riesgo-fondo/20 text-riesgo border border-riesgo/30' },
  RECHAZADO:    { texto: 'Rechazado',    clase: 'bg-riesgo-fondo/20 text-riesgo border border-riesgo/30' },
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

/** Rotulo corto de cada paso: el texto largo de ESTADOS_CLIENTE no cabe en
 *  cinco columnas, y una barra sin rotulos no dice en que va el servicio. */
export const PASOS_CORTOS: Record<string, string> = {
  SOLICITADO: 'Solicitado',
  ASIGNADO: 'Asignado',
  EN_EJECUCION: 'En atención',
  TERMINADO: 'Terminado',
  CERRADO: 'Cerrado',
};

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
  GENERAL:      { texto: 'General',            clase: 'border-neutro/30 bg-neutro-fondo/15 text-tinta-suave' },
  RECEPCION:    { texto: 'Al recibir',         clase: 'border-dato/30 bg-dato-fondo/15 text-dato' },
  ENTREGA:      { texto: 'Al entregar',        clase: 'border-exito/30 bg-exito-fondo/15 text-exito' },
  DANO:         { texto: 'Daño',               clase: 'border-riesgo/30 bg-riesgo-fondo/15 text-riesgo' },
  FIRMA_CEDULA: { texto: 'Cédula con firma',   clase: 'border-marca/40 bg-marca-fondo/20 text-marca' },
  DOCUMENTO:    { texto: 'Documento',          clase: 'border-cierre/30 bg-cierre-fondo/15 text-cierre' },
};

/**
 * Campos de la licencia de transito, con el nombre con el que se le habla al
 * usuario y la cara del documento donde suelen venir impresos.
 *
 * Esta lista es la unica: la usan el formulario del tecnico para dibujar sus
 * casillas y el lector de la tarjeta para decir que datos saco de la foto. Si
 * estuvieran duplicadas, un dia una diria «Línea» y la otra «Linea/modelo» y
 * pareceria que son dos datos distintos.
 */
export const CAMPOS_TARJETA: {
  clave: keyof DatosTarjeta;
  etiqueta: string;
  cara: 'frente' | 'reverso';
}[] = [
  { clave: 'placa', etiqueta: 'Placa', cara: 'frente' },
  { clave: 'marca', etiqueta: 'Marca', cara: 'frente' },
  { clave: 'linea', etiqueta: 'Línea', cara: 'frente' },
  { clave: 'modelo', etiqueta: 'Modelo', cara: 'frente' },
  { clave: 'color', etiqueta: 'Color', cara: 'frente' },
  { clave: 'clase', etiqueta: 'Clase de vehículo', cara: 'frente' },
  { clave: 'licenciaTransito', etiqueta: 'N.º licencia de tránsito', cara: 'frente' },
  { clave: 'vin', etiqueta: 'VIN', cara: 'frente' },
  { clave: 'chasis', etiqueta: 'Chasis', cara: 'frente' },
  { clave: 'motor', etiqueta: 'Motor', cara: 'frente' },
  { clave: 'propietarioNombre', etiqueta: 'Propietario según el documento', cara: 'reverso' },
  { clave: 'propietarioDocumento', etiqueta: 'Documento del propietario', cara: 'reverso' },
];

export const etiquetaTarjeta = (clave: keyof DatosTarjeta): string =>
  CAMPOS_TARJETA.find((c) => c.clave === clave)?.etiqueta ?? clave;

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
