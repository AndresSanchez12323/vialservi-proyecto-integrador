/**
 * El estado del servicio es DERIVADO, no un campo que alguien escriba.
 *
 * Por que: el estado lo mueven dos roles distintos. El tecnico lo pasa a
 * "en ejecucion" y a "terminado"; la central lo pasa a "asignado", "cerrado",
 * "cancelado" y "rechazado". Si ambos escribieran la misma columna, cuando
 * llegue el trabajo sin senal (etapa 2) un envio viejo del tecnico pisaria
 * una cancelacion de la central, y el servicio volveria a la vida solo.
 *
 * Solucion: cada rol escribe UNICAMENTE su propia marca de tiempo
 * (iniciadoEn y terminadoEn son del tecnico; asignadoEn, canceladoEn,
 * rechazadoEn son de la central; cerradoEn es del expediente) y el estado se
 * calcula con esas marcas. Dos roles nunca se pisan porque nunca tocan el
 * mismo campo, y el estado resultante es el mismo sin importar en que orden
 * lleguen los envios.
 *
 * `Servicio.estado` se guarda igual, pero solo como copia para poder filtrar
 * e indicar sin recalcular. La fuente de verdad son las marcas de tiempo.
 */
import { EstadoServicio } from '@prisma/client';
import { prisma } from './prisma.js';

/** Lo minimo que hace falta para decidir el estado. */
export type MarcasServicio = {
  tecnicoId: number | null;
  asignadoEn: Date | null;
  iniciadoEn: Date | null;
  terminadoEn: Date | null;
  canceladoEn: Date | null;
  rechazadoEn: Date | null;
  expediente?: { cerradoEn: Date | null } | null;
};

/**
 * El orden importa: lo que termina el recorrido manda sobre lo que lo avanza.
 * Un rechazo o una cancelacion ganan a cualquier avance del tecnico, porque
 * son decisiones de la central sobre si el servicio existe; y el cierre gana
 * a "terminado" porque es el paso siguiente.
 */
export const calcularEstado = (s: MarcasServicio): EstadoServicio => {
  if (s.rechazadoEn) return EstadoServicio.RECHAZADO;
  if (s.canceladoEn) return EstadoServicio.CANCELADO;
  if (s.expediente?.cerradoEn) return EstadoServicio.CERRADO;
  if (s.terminadoEn) return EstadoServicio.TERMINADO;
  if (s.iniciadoEn) return EstadoServicio.EN_EJECUCION;
  if (s.tecnicoId && s.asignadoEn) return EstadoServicio.ASIGNADO;
  return EstadoServicio.SOLICITADO;
};

/**
 * Recalcula y guarda el estado de un servicio. Se llama despues de CUALQUIER
 * escritura que mueva una marca de tiempo, en la misma transaccion si la hay.
 * Devuelve el estado que quedo.
 */
export const recalcularEstado = async (
  servicioId: number,
  tx: { servicio: typeof prisma.servicio } = prisma,
): Promise<EstadoServicio> => {
  const s = await tx.servicio.findUnique({
    where: { id: servicioId },
    select: {
      tecnicoId: true,
      asignadoEn: true,
      iniciadoEn: true,
      terminadoEn: true,
      canceladoEn: true,
      rechazadoEn: true,
      expediente: { select: { cerradoEn: true } },
    },
  });
  if (!s) throw new Error(`Servicio ${servicioId} no existe`);

  const estado = calcularEstado(s);
  await tx.servicio.update({ where: { id: servicioId }, data: { estado } });
  return estado;
};

/** Un servicio en estos estados ya no admite trabajo en campo. */
export const CERRADOS: EstadoServicio[] = [
  EstadoServicio.CERRADO,
  EstadoServicio.CANCELADO,
  EstadoServicio.RECHAZADO,
];

export const estaCerrado = (estado: EstadoServicio) => CERRADOS.includes(estado);
