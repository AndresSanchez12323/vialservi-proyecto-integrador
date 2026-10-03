import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { enviar, pedir, sesion, type Cliente, type Vehiculo } from '../comun/api';
import { MAX_VEHICULOS_CLIENTE, TIPOS } from '../comun/formato';

type ClienteYo = Cliente & { vehiculos: Vehiculo[] };

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
  const cliente = useQueryClient();
  const rol = sesion.rol();
  const esCliente = rol === 'CLIENTE';
  const [placa, setPlaca] = useState('');
  const [registrando, setRegistrando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehiculos', placa],
    queryFn: () => pedir<Vehiculo[]>(`/vehiculos?placa=${encodeURIComponent(placa)}`),
  });

  // Ficha propia del cliente: de aquí sale el clienteId para crear
  // vehículos y solicitar servicios, sin que lo digite.
  const { data: yo } = useQuery({
    queryKey: ['clienteYo'],
    queryFn: () => pedir<ClienteYo>('/clientes/yo'),
    enabled: esCliente,
  });

  const [formV, setFormV] = useState({ placa: '', marca: '', modelo: '', color: '' });
  const [formS, setFormS] = useState({ vehiculoId: '', tipoSolicitado: 'CARRO_TALLER', direccion: '', descripcion: '' });
  const [ok, setOk] = useState('');

  // Desde la tarjeta del vehículo se salta al formulario con ese
  // vehículo ya elegido: ver → seleccionar → solicitar.
  const elegirParaServicio = (id: number) => {
    setFormS((f) => ({ ...f, vehiculoId: String(id) }));
    setOk('');
    document.getElementById('solicitar-servicio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['vehiculos'] });
    cliente.invalidateQueries({ queryKey: ['clienteYo'] });
    cliente.invalidateQueries({ queryKey: ['servicios'] });
  };

  const crearVehiculo = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', { ...formV, clienteId: yo?.id }),
    onSuccess: (v) => {
      setFormV({ placa: '', marca: '', modelo: '', color: '' });
      setFormS((f) => ({ ...f, vehiculoId: String(v.id) }));
      setOk(`Vehículo ${v.placa} agregado. Ya puede solicitar un servicio para este.`);
      refrescar();
    },
  });

  const solicitar = useMutation({
    mutationFn: () =>
      enviar('/servicios', 'POST', {
        clienteId: yo?.id,
        vehiculoId: Number(formS.vehiculoId),
        tipoSolicitado: formS.tipoSolicitado,
        direccion: formS.direccion,
        descripcion: formS.descripcion,
      }),
    onSuccess: () => {
      setFormS({ vehiculoId: '', tipoSolicitado: 'CARRO_TALLER', direccion: '', descripcion: '' });
      setOk('Servicio solicitado. La central lo clasificará y asignará.');
      refrescar();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {esCliente ? 'Mis vehículos' : 'Gestionar vehículo e inventario'}
        </h2>
        <p className="text-sm text-slate-400">
          {esCliente
            ? 'Agregue un vehículo y luego solicite un servicio para este.'
            : 'El vehículo es el punto de partida: sin vehículo no hay servicio.'}
        </p>
      </div>

      {esCliente && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="vidrio space-y-3 p-5">
            <h3 className="font-medium">Agregar un nuevo vehículo <span className="text-xs text-slate-400">({yo?.vehiculos.length ?? 0} de {MAX_VEHICULOS_CLIENTE})</span></h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={formV.placa} onChange={(e) => setFormV({ ...formV, placa: e.target.value })} placeholder="Placa (ej: ABC123)" className="campo" />
              <input value={formV.marca} onChange={(e) => setFormV({ ...formV, marca: e.target.value })} placeholder="Marca" className="campo" />
              <input value={formV.modelo} onChange={(e) => setFormV({ ...formV, modelo: e.target.value })} placeholder="Modelo" className="campo" />
              <input value={formV.color} onChange={(e) => setFormV({ ...formV, color: e.target.value })} placeholder="Color" className="campo" />
            </div>
            {crearVehiculo.error && <p className="text-sm text-rose-300">{(crearVehiculo.error as Error).message}</p>}
            <button
              className="boton"
              disabled={crearVehiculo.isPending || formV.placa.length < 5 || formV.marca.length < 2 || formV.modelo.length < 2 || formV.color.length < 3}
              onClick={() => { setOk(''); crearVehiculo.mutate(); }}
            >
              {crearVehiculo.isPending ? 'Agregando…' : 'Agregar vehículo'}
            </button>
          </section>

          <section id="solicitar-servicio" className="vidrio scroll-mt-4 space-y-3 p-5">
            <h3 className="font-medium">Solicitar un nuevo servicio</h3>
            <select value={formS.vehiculoId} onChange={(e) => setFormS({ ...formS, vehiculoId: e.target.value })} className="campo">
              <option value="" className="bg-slate-800">Vehículo…</option>
              {(yo?.vehiculos ?? data ?? []).map((v) => (
                <option key={v.id} value={v.id} className="bg-slate-800">{v.placa} · {v.marca} {v.modelo}</option>
              ))}
            </select>
            <select value={formS.tipoSolicitado} onChange={(e) => setFormS({ ...formS, tipoSolicitado: e.target.value })} className="campo" title="Tipo de servicio que necesita">
              {Object.entries(TIPOS).map(([k, v]) => (
                <option key={k} value={k} className="bg-slate-800">{v}</option>
              ))}
            </select>
            <input value={formS.direccion} onChange={(e) => setFormS({ ...formS, direccion: e.target.value })} placeholder="Dirección donde está el vehículo" className="campo" />
            <textarea value={formS.descripcion} onChange={(e) => setFormS({ ...formS, descripcion: e.target.value })} placeholder="Qué necesita (ej: no enciende, llanta averiada…)" rows={3} className="campo resize-none" />
            {solicitar.error && <p className="text-sm text-rose-300">{(solicitar.error as Error).message}</p>}
            <button
              className="boton"
              disabled={solicitar.isPending || !formS.vehiculoId || formS.direccion.length < 5 || formS.descripcion.length < 5}
              onClick={() => { setOk(''); solicitar.mutate(); }}
            >
              {solicitar.isPending ? 'Solicitando…' : 'Solicitar servicio'}
            </button>
          </section>
        </div>
      )}

      {ok && <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</p>}

      {!esCliente && (
        <button className="boton" onClick={() => setRegistrando(!registrando)}>
          {registrando ? 'Cerrar' : 'Registrar vehículo'}
        </button>
      )}

      {!esCliente && registrando && (
        <Registrar
          alTerminar={() => {
            setRegistrando(false);
            cliente.invalidateQueries({ queryKey: ['vehiculos'] });
          }}
        />
      )}

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
            {esCliente ? (
              <button
                className={`boton-suave mt-3 w-full ${String(formS.vehiculoId) === String(v.id) ? 'border-amber-300/60 bg-amber-400/20 text-amber-200' : ''}`}
                onClick={() => elegirParaServicio(v.id)}
              >
                {String(formS.vehiculoId) === String(v.id) ? '✓ Seleccionado' : 'Solicitar servicio'}
              </button>
            ) : (
              <p className="mt-3 border-t border-white/10 pt-3 text-sm">
                <span className="text-slate-400">Propietario: </span>{v.cliente?.nombre ?? '—'}
              </p>
            )}
          </article>
        ))}
        {data?.length === 0 && <p className="text-sm text-slate-400">Sin resultados.</p>}
      </div>
    </div>
  );
}
