import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { pedir, type Vehiculo } from '../comun/api';

export function Vehiculos() {
  const [placa, setPlaca] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['vehiculos', placa],
    queryFn: () => pedir<Vehiculo[]>(`/vehiculos?placa=${encodeURIComponent(placa)}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar vehículo e inventario</h2>
        <p className="text-sm text-slate-400">
          El vehículo es el punto de partida: sin vehículo no hay servicio.
        </p>
      </div>

      <input
        value={placa}
        onChange={(e) => setPlaca(e.target.value)}
        placeholder="Buscar por placa"
        className="campo max-w-xs"
      />

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((v) => (
          <article key={v.id} className="vidrio p-5">
            <p className="font-mono text-lg text-amber-300">{v.placa}</p>
            <p className="mt-1 text-sm">{v.marca} {v.modelo}</p>
            <p className="text-sm text-slate-400">Color {v.color.toLowerCase()}</p>
            <p className="mt-3 border-t border-white/10 pt-3 text-sm">
              <span className="text-slate-400">Propietario: </span>{v.cliente?.nombre ?? '—'}
            </p>
          </article>
        ))}
        {data?.length === 0 && <p className="text-sm text-slate-400">Sin resultados.</p>}
      </div>
    </div>
  );
}
