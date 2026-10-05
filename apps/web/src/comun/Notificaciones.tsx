/**
 * Campanita de notificaciones.
 *
 * Se refresca cada 10 segundos por consulta al API (polling) en lugar de abrir
 * un websocket: para esta operacion la diferencia es imperceptible y evita
 * sostener conexiones y cambiar la infraestructura del despliegue.
 *
 * Al pulsar una notificacion se marca como leida y se navega a lo que la
 * origino, que es lo unico que se quiere hacer con un aviso.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { enviar, pedir, type Bandeja, type Notificacion } from './api';
import { NOTIFICACIONES, haceCuanto } from './formato';

export function Notificaciones() {
  const navegar = useNavigate();
  const cola = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['notificaciones'],
    queryFn: () => pedir<Bandeja>('/notificaciones'),
    refetchInterval: 10000,
  });

  // Cerrar al pulsar por fuera: sin esto el panel se queda abierto tapando la
  // pantalla cuando el usuario ya siguio con otra cosa.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['notificaciones'] });
    cola.invalidateQueries({ queryKey: ['servicios'] });
  };

  const marcar = useMutation({
    mutationFn: (id: number) => enviar(`/notificaciones/${id}/leida`, 'PATCH'),
    onSuccess: refrescar,
  });

  const marcarTodas = useMutation({
    mutationFn: () => enviar('/notificaciones/leidas', 'PATCH'),
    onSuccess: refrescar,
  });

  const sinLeer = data?.sinLeer ?? 0;

  /** Marca la notificacion y lleva a donde ocurrio el hecho. */
  const abrir = (n: Notificacion) => {
    if (!n.leidaEn) marcar.mutate(n.id);
    setAbierto(false);
    const expediente = n.expedienteId ?? n.servicio?.expediente?.id;
    navegar(expediente ? `/expedientes/${expediente}` : '/servicios');
  };

  return (
    <div className="relative" ref={caja}>
      <button
        onClick={() => setAbierto(!abierto)}
        className="boton-suave relative"
        title={sinLeer ? `${sinLeer} notificaciones sin leer` : 'Notificaciones'}
        aria-label={`Notificaciones${sinLeer ? `, ${sinLeer} sin leer` : ''}`}
      >
        🔔
        {sinLeer > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white">
            {sinLeer > 9 ? '9+' : sinLeer}
          </span>
        )}
      </button>

      {abierto && (
        // En movil el boton queda a media fila (la cabecera se envuelve) y la
        // bandeja anclada a su derecha se salia por el borde izquierdo. Ahi se
        // presenta fija al viewport y centrada: siempre visible y completa.
        <div className="vidrio-flotante absolute right-0 z-50 mt-2 max-h-[28rem] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-2 shadow-2xl max-sm:fixed max-sm:left-4 max-sm:mt-0 max-sm:top-1/2 max-sm:max-h-[80vh] max-sm:-translate-y-1/2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Notificaciones</p>
            {sinLeer > 0 && (
              <button
                className="text-xs text-amber-300 hover:text-amber-200"
                onClick={() => marcarTodas.mutate()}
              >
                Marcar todas
              </button>
            )}
          </div>

          {(data?.lista.length ?? 0) === 0 && (
            <p className="px-2 py-6 text-center text-sm text-slate-400">Sin notificaciones.</p>
          )}

          <ul className="space-y-1">
            {data?.lista.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => abrir(n)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/10 ${
                    n.leidaEn ? 'opacity-60' : 'bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">{NOTIFICACIONES[n.tipo] ?? '🔔'}</span>
                    <div className="min-w-0 flex-1">
                      {/* Sin truncar a una linea: el titulo lleva la parte accionable
                          («pendiente de revisar y cerrar») justo al final. */}
                      <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                      <p className="mt-0.5 text-xs text-slate-300">{n.mensaje}</p>
                      <p className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span>{haceCuanto(n.creadaEn)}</span>
                        {n.servicio && (
                          <span className="font-mono text-amber-300/80">
                            {n.servicio.vehiculo.placa}
                          </span>
                        )}
                      </p>
                    </div>
                    {!n.leidaEn && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
