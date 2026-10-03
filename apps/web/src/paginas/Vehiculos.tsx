import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { enviar, pedir, sesion, type Cliente, type Vehiculo } from '../comun/api';

/** Registro del vehiculo. El cliente registra el suyo y la central registra
 *  el de cualquiera: es el paso previo a poder solicitar un servicio, porque
 *  todo el sistema se organiza alrededor de la placa. */
function Registrar({ alTerminar }: { alTerminar: () => void }) {
  const rol = sesion.rol();
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [placa, setPlaca] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [color, setColor] = useState('');
  const [clienteId, setClienteId] = useState('');

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });

  const mutar = useMutation({
    mutationFn: () =>
      enviar('/vehiculos', 'POST', {
        placa, marca, modelo, color,
        ...(esCentral ? { clienteId } : {}),
      }),
    onSuccess: alTerminar,
  });

  const completo =
    placa.trim().length >= 5 && marca.trim().length >= 2 &&
    modelo.trim().length >= 2 && color.trim().length >= 3 &&
    (!esCentral || clienteId);

  return (
    <div className="vidrio space-y-3 p-5">
      <div>
        <p className="font-medium">Registrar un vehículo</p>
        <p className="text-xs text-slate-400">
          Queda enlazado a su propietario y se puede elegir al solicitar un servicio.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {esCentral && (
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="campo sm:col-span-2">
            <option value="" className="bg-slate-800">Propietario…</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-800">
                {c.nombre} · {c.documento}
              </option>
            ))}
          </select>
        )}

        <input
          value={placa}
          onChange={(e) => setPlaca(e.target.value.toUpperCase())}
          className="campo font-mono"
          placeholder="Placa (ABC123)"
          maxLength={8}
        />
        <input value={marca} onChange={(e) => setMarca(e.target.value)} className="campo" placeholder="Marca" />
        <input value={modelo} onChange={(e) => setModelo(e.target.value)} className="campo" placeholder="Línea o modelo" />
        <input value={color} onChange={(e) => setColor(e.target.value)} className="campo" placeholder="Color" />
      </div>

      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}

      <button className="boton" disabled={!completo || mutar.isPending} onClick={() => mutar.mutate()}>
        {mutar.isPending ? 'Guardando…' : 'Registrar vehículo'}
      </button>
    </div>
  );
}

export function Vehiculos() {
  const cola = useQueryClient();
  const rol = sesion.rol();
  const esCliente = rol === 'CLIENTE';
  const [placa, setPlaca] = useState('');
  const [registrando, setRegistrando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehiculos', placa],
    queryFn: () => pedir<Vehiculo[]>(`/vehiculos?placa=${encodeURIComponent(placa)}`),
  });

  const refrescar = () => {
    // se invalida toda la familia 'vehiculos' para que el vehiculo nuevo
    // aparezca tambien en el desplegable de la solicitud del servicio
    cola.invalidateQueries({ queryKey: ['vehiculos'] });
    setRegistrando(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Gestionar vehículo e inventario</h2>
          <p className="text-sm text-slate-400">
            {esCliente
              ? 'Sus vehículos. Registre uno para poder solicitar un servicio.'
              : 'El vehículo es el punto de partida: sin vehículo no hay servicio.'}
          </p>
        </div>

        <button className="boton" onClick={() => setRegistrando(!registrando)}>
          {registrando ? 'Cerrar' : 'Registrar vehículo'}
        </button>
      </div>

      {registrando && <Registrar alTerminar={refrescar} />}

      {!esCliente && (
        <input
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
          placeholder="Buscar por placa"
          className="campo max-w-xs"
        />
      )}

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
        {data?.length === 0 && (
          <p className="text-sm text-slate-400">
            {esCliente ? 'Todavía no tiene vehículos registrados.' : 'Sin resultados.'}
          </p>
        )}
      </div>
    </div>
  );
}
