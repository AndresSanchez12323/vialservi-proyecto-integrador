import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { pedir, type Servicio } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

type Fila = Servicio & {
  expediente: (Servicio['expediente'] & { _count: { evidencias: number; novedades: number } }) | null;
};

export function Historicos() {
  const [placa, setPlaca] = useState('ABC123');
  const { data, isLoading } = useQuery({
    queryKey: ['historial', placa],
    queryFn: () => pedir<Fila[]>(`/reportes/historial?placa=${encodeURIComponent(placa)}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar históricos</h2>
        <p className="text-sm text-slate-400">
          Consulta por placa. Es lo que permite responder una reclamación meses después del
          servicio.
        </p>
      </div>

      <input
        value={placa}
        onChange={(e) => setPlaca(e.target.value)}
        placeholder="Placa del vehículo"
        className="campo max-w-xs font-mono"
      />

      {isLoading && <p className="text-sm text-slate-400">Buscando…</p>}

      <div className="space-y-3">
        {data?.map((s) => (
          <article key={s.id} className="vidrio flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                  {ESTADOS[s.estado]?.texto ?? s.estado}
                </span>
                {s.tipo && <span className="text-xs text-slate-400">{TIPOS[s.tipo]}</span>}
              </div>
              <p className="mt-1.5 text-sm">{s.descripcion}</p>
              <p className="text-xs text-slate-500">{fecha(s.solicitadoEn)} · {s.tecnico?.nombre ?? 'sin técnico'}</p>
            </div>

            <div className="flex items-center gap-4 text-sm">
              {s.expediente && (
                <div className="text-right">
                  <p className="text-xs text-slate-400">
                    {s.expediente._count.evidencias} evidencias · {s.expediente._count.novedades} novedades
                  </p>
                  <Link to={`/expedientes/${s.expediente.id}`} className="font-mono text-amber-300 hover:underline">
                    {s.expediente.consecutivo}
                  </Link>
                </div>
              )}
            </div>
          </article>
        ))}
        {data?.length === 0 && (
          <p className="vidrio p-6 text-sm text-slate-400">No hay servicios para esa placa.</p>
        )}
      </div>
    </div>
  );
}
