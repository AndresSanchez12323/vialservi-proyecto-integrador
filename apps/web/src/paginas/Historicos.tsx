import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { pedir, type Servicio } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';
import { useTema, type Tema } from '../comun/tema';

type Fila = Servicio & {
  expediente: (Servicio['expediente'] & { _count: { evidencias: number; novedades: number } }) | null;
};

const CATEGORIAS = Object.keys(TIPOS);
const NADA = 'SIN_CLASIFICAR';

/**
 * Colores del anillo, uno por tema.
 *
 * El tema claro NO es el oscuro con otro fondo: son los mismos tres tonos
 * (cian, ambar, purpura) escalonados para cada superficie. Un ambar que
 * resalta sobre el fondo oscuro tiene 1,5:1 de contraste sobre blanco, o sea,
 * un segmento que practicamente no se ve.
 *
 * Los dos juegos estan comprobados con el validador de paletas: separacion
 * bajo daltonismo (protanopia y deuteranopia) y bajo vision normal entre todas
 * las parejas, y contraste minimo 3:1 contra la superficie de la tarjeta. Si
 * se cambia un tono hay que volver a pasarlo, no mirarlo a ojo.
 *
 * «Sin clasificar» es gris a proposito: no es una categoria mas, es la
 * ausencia de categoria, y por eso no lleva color propio. Se le da la
 * luminosidad contraria a la del fondo —oscuro en tema claro, claro en tema
 * oscuro— porque un gris medio junto al cian es la unica pareja que el
 * validador no deja pasar: a simple vista se confunden.
 */
const COLORES: Record<Tema, Record<string, string>> = {
  claro: {
    GRUA: '#0891b2',
    CARRO_TALLER: '#b45309',
    CONDUCTOR_ELEGIDO: '#7e22ce',
    SIN_CLASIFICAR: '#334155',
  },
  oscuro: {
    GRUA: '#0891b2',
    CARRO_TALLER: '#d97706',
    CONDUCTOR_ELEGIDO: '#a855f7',
    SIN_CLASIFICAR: '#cbd5e1',
  },
};

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

  // El anillo se pinta con atributos SVG, no con clases, asi que necesita el
  // tema como dato: useTema lo vuelve a pintar cuando la persona lo cambia.
  const { tema } = useTema();
  const paleta = COLORES[tema];
  const hueco = segmentos.length > 1 ? 0.7 : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar históricos</h2>
        <p className="text-sm text-tinta-tenue">
          Distribución de servicios por categoría. Pulse un segmento para ver su historial.
        </p>
      </div>

      <section className="vidrio flex flex-col items-center gap-6 p-6 sm:flex-row sm:justify-center">
        <div className="relative h-48 w-48 shrink-0">
          <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
            {total === 0 && (
              // El anillo vacio se pinta con el velo del tema, no con un gris
              // fijo: sobre fondo claro un gris oscuro parece un dato.
              <circle
                cx="21" cy="21" r="15.9155"
                fill="none"
                strokeWidth="7"
                className="stroke-velo/15"
              />
            )}
            {segmentos.map((s) => (
              <circle
                key={s.categoria}
                cx="21" cy="21" r="15.9155"
                fill="none"
                stroke={paleta[s.categoria]}
                strokeWidth={categoria && categoria !== s.categoria ? '5' : '7'}
                // Una rendija entre segmentos: pegados, dos colores contiguos
                // se leen como una sola mancha. No se abre cuando hay uno
                // solo, porque entonces seria una muesca sin motivo.
                strokeDasharray={`${Math.max(s.pct - hueco, 0.3)} ${100 - s.pct + hueco}`}
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
            <p className="text-xs text-tinta-tenue">servicios</p>
          </div>
        </div>

        <ul className="w-full max-w-xs space-y-1">
          {segmentos.map((s) => (
            <li key={s.categoria}>
              <button
                onClick={() => elegir(s.categoria)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  categoria === s.categoria ? 'bg-velo/15 font-medium' : 'hover:bg-velo/10'
                }`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: paleta[s.categoria] }} />
                <span className="flex-1 text-left">{nombreDe(s.categoria)}</span>
                <span className="font-mono text-tinta-suave">{s.total}</span>
                <span className="w-14 text-right font-mono text-marca">{s.pct.toFixed(1)} %</span>
              </button>
            </li>
          ))}
          {total === 0 && !isLoading && (
            <li className="text-sm text-tinta-sutil">Aún no hay servicios registrados.</li>
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

      {isLoading && <p className="text-sm text-tinta-tenue">Buscando…</p>}

      <h3 className="font-medium">
        Historial · {categoria ? nombreDe(categoria) : 'Todas las categorías'}
        <span className="ml-2 font-mono text-sm text-marca">({visibles.length})</span>
      </h3>

      <div className="space-y-3">
        {visibles.map((s) => (
          <article key={s.id} className="vidrio space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                {ESTADOS[s.estado]?.texto ?? s.estado}
              </span>
              <span className="etiqueta border border-velo/20 bg-velo/10 text-tinta-suave">
                {nombreDe(categoriaDe(s))}
              </span>
              {s.expediente && (
                <Link to={`/expedientes/${s.expediente.id}`} className="etiqueta border border-marca/40 bg-marca-fondo/15 font-mono text-marca hover:bg-marca-fondo/25">
                  {s.expediente.consecutivo}
                </Link>
              )}
            </div>

            <p className="text-sm">{s.descripcion}</p>

            <div className="grid grid-cols-1 gap-3 border-t border-velo/10 pt-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase text-tinta-sutil">Cliente</p>
                <p>{s.cliente.nombre}</p>
                <p className="font-mono text-xs text-tinta-tenue">{s.cliente.documento} · {s.cliente.telefono}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-tinta-sutil">Vehículo</p>
                <p className="font-mono text-marca">{s.vehiculo.placa}</p>
                <p className="text-tinta-suave">{s.vehiculo.marca} {s.vehiculo.modelo} · {s.vehiculo.color}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-tinta-sutil">Técnico</p>
                <p>{s.tecnico?.nombre ?? 'sin asignar'}</p>
                {s.tecnico && <p className="text-xs text-tinta-tenue">{s.tecnico.especialidades}</p>}
              </div>
            </div>

            <p className="text-xs text-tinta-sutil">
              {fecha(s.solicitadoEn)} · {s.direccion}
              {s.expediente && (
                <> · {s.expediente._count.evidencias} evidencias · {s.expediente._count.novedades} novedades</>
              )}
            </p>
          </article>
        ))}
        {visibles.length === 0 && !isLoading && (
          <p className="vidrio p-6 text-sm text-tinta-tenue">No hay servicios para ese filtro.</p>
        )}
      </div>
    </div>
  );
}
