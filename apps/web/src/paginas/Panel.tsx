import { useQuery } from '@tanstack/react-query';
import { pedir, type Indicadores } from '../comun/api';
import { ESTADOS, TIPOS } from '../comun/formato';

const Tarjeta = ({ titulo, valor, detalle }: { titulo: string; valor: number | string; detalle?: string }) => (
  <div className="vidrio p-5">
    <p className="text-xs uppercase tracking-wide text-slate-400">{titulo}</p>
    <p className="mt-1 text-3xl font-semibold text-amber-300">{valor}</p>
    {detalle && <p className="mt-1 text-xs text-slate-400">{detalle}</p>}
  </div>
);

export function Panel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['indicadores'],
    queryFn: () => pedir<Indicadores>('/reportes/indicadores'),
  });

  if (isLoading) return <p className="text-sm text-slate-400">Cargando indicadores…</p>;
  if (error) return <p className="text-sm text-rose-300">{(error as Error).message}</p>;
  if (!data) return null;

  const totalServicios = data.porEstado.reduce((s, e) => s + e.total, 0);
  const maximo = Math.max(...data.porEstado.map((e) => e.total), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Panel de indicadores</h2>
        <p className="text-sm text-slate-400">
          Se alimenta de los expedientes: antes esta información no existía en ninguna parte.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta titulo="Servicios" valor={totalServicios} detalle="registrados en el sistema" />
        <Tarjeta titulo="Expedientes abiertos" valor={data.abiertos} detalle="pendientes de cierre" />
        <Tarjeta titulo="Expedientes cerrados" valor={data.cerrados} detalle="con evidencia completa" />
        <Tarjeta titulo="Evidencias" valor={data.evidencias} detalle={`${data.novedades} novedades registradas`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vidrio p-6">
          <h3 className="mb-4 font-medium">Servicios por estado</h3>
          <div className="space-y-3">
            {data.porEstado.map((e) => (
              <div key={e.estado}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className={`etiqueta ${ESTADOS[e.estado]?.clase ?? ''}`}>
                    {ESTADOS[e.estado]?.texto ?? e.estado}
                  </span>
                  <span className="text-slate-300">{e.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-200"
                    style={{ width: `${(e.total / maximo) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="vidrio p-6">
          <h3 className="mb-4 font-medium">Servicios por tipo</h3>
          {data.porTipo.length === 0 && <p className="text-sm text-slate-400">Sin servicios clasificados.</p>}
          <div className="space-y-3">
            {data.porTipo.map((t) => (
              <div key={t.tipo} className="vidrio-suave flex items-center justify-between px-4 py-3">
                <span className="text-sm">{TIPOS[t.tipo] ?? t.tipo}</span>
                <span className="text-lg font-semibold text-amber-300">{t.total}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
