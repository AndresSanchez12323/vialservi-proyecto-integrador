import { useQuery } from '@tanstack/react-query';
import { pedir, type Cliente } from '../comun/api';

export function Clientes() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar cliente</h2>
        <p className="text-sm text-slate-400">
          Dueño del vehículo y quien solicita el servicio. El expediente enlaza estos datos,
          no los duplica.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="vidrio overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3">Documento</th>
              <th className="px-5 py-3">Nombre</th>
              <th className="px-5 py-3">Teléfono</th>
              <th className="px-5 py-3">Vehículos</th>
              <th className="px-5 py-3">Servicios</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id} className="border-t border-white/10 transition hover:bg-white/5">
                <td className="px-5 py-3 font-mono text-slate-300">{c.documento}</td>
                <td className="px-5 py-3">{c.nombre}</td>
                <td className="px-5 py-3 text-slate-300">{c.telefono}</td>
                <td className="px-5 py-3 text-amber-300">{c._count?.vehiculos ?? 0}</td>
                <td className="px-5 py-3 text-amber-300">{c._count?.servicios ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
