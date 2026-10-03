import { useQuery } from '@tanstack/react-query';
import { pedir, type Tecnico } from '../comun/api';

export function Tecnicos() {
  // Se refresca sola: si un técnico cambia su disponibilidad, la central
  // lo ve en segundos sin recargar.
  const { data, isLoading, error } = useQuery({
    queryKey: ['tecnicos'],
    queryFn: () => pedir<Tecnico[]>('/tecnicos'),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar técnico</h2>
        <p className="text-sm text-slate-400">
          El técnico es una entidad propia, no solo un rol: su hoja de vida determina qué
          servicios puede atender. La disponibilidad se actualiza sola cada 15 segundos.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((t) => (
          <article key={t.id} className="vidrio p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium">{t.nombre}</h3>
                <p className="font-mono text-xs text-slate-400">{t.documento}</p>
              </div>
              <span
                className={`etiqueta ${
                  t.disponible
                    ? 'border border-emerald-300/30 bg-emerald-400/20 text-emerald-200'
                    : 'border border-slate-300/20 bg-slate-400/10 text-slate-400'
                }`}
              >
                {t.disponible ? 'Disponible' : 'No disponible'}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {t.especialidades.split(',').map((e) => (
                <span key={e} className="etiqueta border border-sky-300/30 bg-sky-400/15 text-sky-200">
                  {e.toLowerCase()}
                </span>
              ))}
            </div>

            <dl className="mt-4 space-y-1 text-sm text-slate-300">
              <div className="flex justify-between"><dt className="text-slate-400">Teléfono</dt><dd>{t.telefono}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Licencia</dt><dd>{t.licencia ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">En curso ahora</dt><dd className="font-mono text-sky-300">{t.activos ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Servicios atendidos</dt><dd>{t._count?.servicios ?? 0}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
