import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { pedir, type Servicio } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

type Fila = Servicio & {
  expediente: (Servicio['expediente'] & { _count: { evidencias: number; novedades: number } }) | null;
};

const CATEGORIAS = Object.keys(TIPOS);
const COLORES: Record<string, string> = {
  GRUA: '#38bdf8',
  CARRO_TALLER: '#fbbf24',
  CONDUCTOR_ELEGIDO: '#a78bfa',
  SIN_CLASIFICAR: '#64748b',
};
const NADA = 'SIN_CLASIFICAR';

const categoriaDe = (s: Fila) => s.tipo ?? NADA;
const nombreDe = (c: string) => (c === NADA ? 'Sin clasificar' : (TIPOS[c] ?? c));

export function Historicos() {
  // El panel enlaza con ?categoria=GRUA: se entra con ese filtro aplicado.
  const [params] = useSearchParams();
  const inicial = params.get('categoria');
  const [placa, setPlaca] = useState('');
  const [categoria, setCategoria] = useState<string | null>(
    inicial && (Object.keys(TIPOS).includes(inicial) || inicial === 'SIN_CLASIFICAR') ? inicial : null,
  );
  const { data, isLoading } = useQuery({
    queryKey: ['historial'],
    queryFn: () => pedir<Fila[]>('/reportes/historial'),
  });

  const servicios = useMemo(() => data ?? [], [data]);
  const total = servicios.length;

  // Distribución por categoría para el gráfico.
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const s of servicios) mapa.set(categoriaDe(s), (mapa.get(categoriaDe(s)) ?? 0) + 1);
    return [...CATEGORIAS.map((c) => ({ categoria: c, total: mapa.get(c) ?? 0 })), { categoria: NADA, total: mapa.get(NADA) ?? 0 }]
      .filter((e) => e.total > 0);
  }, [servicios]);

  // Historial desplegado: lo de la categoría elegida (y la placa, si se busca).
  const visibles = useMemo(() => {
    const p = placa.trim().toUpperCase();
    return servicios.filter(
      (s) =>
        (!categoria || categoriaDe(s) === categoria) &&
        (!p || s.vehiculo.placa.toUpperCase().includes(p)),
    );
  }, [servicios, categoria, placa]);

  // Anillo del gráfico: técnica del círculo de circunferencia 100.
  let acumulado = 0;
  const segmentos = porCategoria.map((e) => {
    const pct = total ? (e.total / total) * 100 : 0;
    const desde = acumulado;
    acumulado += pct;
    return { ...e, pct, desde };
  });

  const elegir = (c: string) => setCategoria((actual) => (actual === c ? null : c));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar históricos</h2>
        <p className="text-sm text-slate-400">
          Distribución de servicios por categoría. Pulse un segmento para ver su historial.
        </p>
      </div>

      <section className="vidrio flex flex-col items-center gap-6 p-6 sm:flex-row sm:justify-center">
        <div className="relative h-48 w-48 shrink-0">
          <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
            {total === 0 && (
              <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#334155" strokeWidth="7" />
            )}
            {segmentos.map((s) => (
              <circle
                key={s.categoria}
                cx="21" cy="21" r="15.9155"
                fill="none"
                stroke={COLORES[s.categoria]}
                strokeWidth={categoria && categoria !== s.categoria ? '5' : '7'}
                strokeDasharray={`${s.pct} ${100 - s.pct}`}
                strokeDashoffset={25 - s.desde}
                opacity={!categoria || categoria === s.categoria ? 1 : 0.35}
                onClick={() => elegir(s.categoria)}
                className="cursor-pointer transition-all hover:stroke-[8]"
              >
                <title>{`${nombreDe(s.categoria)}: ${s.total} (${s.pct.toFixed(1)} %)`}</title>
              </circle>
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-2xl font-semibold">{total}</p>
            <p className="text-xs text-slate-400">servicios</p>
          </div>
        </div>

        <ul className="w-full max-w-xs space-y-1">
          {segmentos.map((s) => (
            <li key={s.categoria}>
              <button
                onClick={() => elegir(s.categoria)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  categoria === s.categoria ? 'bg-white/15 font-medium' : 'hover:bg-white/10'
                }`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORES[s.categoria] }} />
                <span className="flex-1 text-left">{nombreDe(s.categoria)}</span>
                <span className="font-mono text-slate-300">{s.total}</span>
                <span className="w-14 text-right font-mono text-amber-300">{s.pct.toFixed(1)} %</span>
              </button>
            </li>
          ))}
          {total === 0 && !isLoading && (
            <li className="text-sm text-slate-500">Aún no hay servicios registrados.</li>
          )}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
          placeholder="Filtrar por placa"
          className="campo max-w-xs font-mono"
        />
        {categoria && (
          <button onClick={() => setCategoria(null)} className="boton-suave">
            ✕ {nombreDe(categoria)}
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Buscando…</p>}

      <h3 className="font-medium">
        Historial · {categoria ? nombreDe(categoria) : 'Todas las categorías'}
        <span className="ml-2 font-mono text-sm text-amber-300">({visibles.length})</span>
      </h3>

      <div className="space-y-3">
        {visibles.map((s) => (
          <article key={s.id} className="vidrio space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                {ESTADOS[s.estado]?.texto ?? s.estado}
              </span>
              <span className="etiqueta border border-white/20 bg-white/10 text-slate-200">
                {nombreDe(categoriaDe(s))}
              </span>
              {s.expediente && (
                <Link to={`/expedientes/${s.expediente.id}`} className="etiqueta border border-amber-300/40 bg-amber-400/15 font-mono text-amber-200 hover:bg-amber-400/25">
                  {s.expediente.consecutivo}
                </Link>
              )}
            </div>

            <p className="text-sm">{s.descripcion}</p>

            <div className="grid gap-3 border-t border-white/10 pt-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase text-slate-500">Cliente</p>
                <p>{s.cliente.nombre}</p>
                <p className="font-mono text-xs text-slate-400">{s.cliente.documento} · {s.cliente.telefono}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Vehículo</p>
                <p className="font-mono text-amber-300">{s.vehiculo.placa}</p>
                <p className="text-slate-300">{s.vehiculo.marca} {s.vehiculo.modelo} · {s.vehiculo.color}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Técnico</p>
                <p>{s.tecnico?.nombre ?? 'sin asignar'}</p>
                {s.tecnico && <p className="text-xs text-slate-400">{s.tecnico.especialidades}</p>}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              {fecha(s.solicitadoEn)} · {s.direccion}
              {s.expediente && (
                <> · {s.expediente._count.evidencias} evidencias · {s.expediente._count.novedades} novedades</>
              )}
            </p>
          </article>
        ))}
        {visibles.length === 0 && !isLoading && (
          <p className="vidrio p-6 text-sm text-slate-400">No hay servicios para ese filtro.</p>
        )}
      </div>
    </div>
  );
}
