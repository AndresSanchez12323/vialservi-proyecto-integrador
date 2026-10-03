import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { pedir, type Indicadores } from '../comun/api';
import { ESTADOS, TIPOS } from '../comun/formato';

const Tarjeta = ({ titulo, valor, detalle }: { titulo: string; valor: number | string; detalle?: string }) => (
  <div className="vidrio p-5">
    <p className="text-xs uppercase tracking-wide text-slate-400">{titulo}</p>
    <p className="mt-1 text-3xl font-semibold text-amber-300">{valor}</p>
    {detalle && <p className="mt-1 text-xs text-slate-400">{detalle}</p>}
  </div>
);

/** Accesos del tablero: cada módulo con su descripción y, cuando aplica,
 *  la cifra que exige atención inmediata. */
const Acceso = ({ ruta, nombre, descripcion, aviso }: { ruta: string; nombre: string; descripcion: string; aviso?: string }) => (
  <Link
    to={ruta}
    className="vidrio group flex items-center justify-between gap-3 p-5 transition hover:border-amber-300/40 hover:bg-white/15"
  >
    <div className="min-w-0">
      <p className="font-medium">{nombre}</p>
      <p className="truncate text-xs text-slate-400">{descripcion}</p>
      {aviso && <p className="mt-1 inline-block rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">{aviso}</p>}
    </div>
    <span className="shrink-0 text-xl text-slate-500 transition group-hover:translate-x-1 group-hover:text-amber-300">→</span>
  </Link>
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
  const pendientes = data.porEstado.find((e) => e.estado === 'SOLICITADO')?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Panel de indicadores</h2>
        <p className="text-sm text-slate-400">
          Tablero de la central: accesos a cada módulo y situación en tiempo real.
        </p>
      </div>

      <nav className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Acceso
          ruta="/servicios"
          nombre="Gestionar servicio"
          descripcion="Clasificar, asignar y avanzar servicios"
          aviso={pendientes ? `${pendientes} por asignar` : undefined}
        />
        <Acceso ruta="/vehiculos" nombre="Vehículos e inventario" descripcion="Consultar por placa" />
        <Acceso ruta="/clientes" nombre="Clientes" descripcion="Situación de cada cliente" />
        <Acceso ruta="/tecnicos" nombre="Técnicos" descripcion="Hoja de vida y disponibilidad" />
        <Acceso ruta="/historicos" nombre="Históricos" descripcion="Distribución por categoría" />
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta titulo="Servicios" valor={totalServicios} detalle="registrados en el sistema" />
        <Tarjeta titulo="Expedientes abiertos" valor={data.abiertos} detalle="pendientes de cierre" />
        <Tarjeta titulo="Expedientes cerrados" valor={data.cerrados} detalle="con evidencia completa" />
        <Tarjeta titulo="Evidencias" valor={data.evidencias} detalle={`${data.novedades} novedades registradas`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Servicios por estado</h3>
          <p className="mb-4 text-xs text-slate-500">Pulse un estado para gestionarlo.</p>
          <div className="space-y-3">
            {data.porEstado.map((e) => (
              <Link key={e.estado} to="/servicios" className="block transition hover:opacity-80">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className={`etiqueta ${ESTADOS[e.estado]?.clase ?? ''}`}>
                    {ESTADOS[e.estado]?.texto ?? e.estado}
                  </span>
                  <span className="text-slate-300">{e.total} →</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-200"
                    style={{ width: `${(e.total / maximo) * 100}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Servicios por tipo</h3>
          <p className="mb-4 text-xs text-slate-500">Pulse un tipo para ver su historial.</p>
          {data.porTipo.length === 0 && <p className="text-sm text-slate-400">Sin servicios clasificados.</p>}
          <div className="space-y-3">
            {data.porTipo.map((t) => (
              <Link
                key={t.tipo}
                to={`/historicos?categoria=${t.tipo}`}
                className="vidrio-suave flex items-center justify-between px-4 py-3 transition hover:border-amber-300/40 hover:bg-white/15"
              >
                <span className="text-sm">{TIPOS[t.tipo] ?? t.tipo}</span>
                <span className="text-lg font-semibold text-amber-300">{t.total} →</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
