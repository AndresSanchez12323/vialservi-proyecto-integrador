import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  enviar, pedir, sesion,
  type Cliente, type Servicio, type Tecnico, type Vehiculo,
} from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

/** Solicitud del servicio: la hace el cliente desde su sesion, o la central
 *  cuando el cliente llama por telefono. Aqui no se elige ni el tipo ni el
 *  tecnico: quien pide describe lo que le pasa, y clasificar es otro paso. */
function Solicitar({ alTerminar }: { alTerminar: () => void }) {
  const rol = sesion.rol();
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [clienteId, setClienteId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [direccion, setDireccion] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });
  // Para el cliente el servidor ya devuelve solo sus vehiculos; la central
  // recibe todos y aqui se acotan al cliente que eligio.
  const { data: vehiculos } = useQuery({
    queryKey: ['vehiculos'],
    queryFn: () => pedir<Vehiculo[]>('/vehiculos'),
  });
  const suyos = esCentral
    ? (vehiculos ?? []).filter((v) => String(v.cliente?.id) === clienteId)
    : (vehiculos ?? []);

  const mutar = useMutation({
    mutationFn: () =>
      enviar('/servicios', 'POST', {
        ...(esCentral ? { clienteId } : {}),
        vehiculoId,
        direccion,
        descripcion,
      }),
    onSuccess: alTerminar,
  });

  const completo = vehiculoId && direccion.length >= 5 && descripcion.length >= 5;

  return (
    <div className="vidrio space-y-3 p-5">
      <div>
        <p className="font-medium">Solicitar un servicio</p>
        <p className="text-xs text-slate-400">
          La central lo clasifica después y le asigna el técnico que corresponda.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {esCentral && (
          <select
            value={clienteId}
            onChange={(e) => { setClienteId(e.target.value); setVehiculoId(''); }}
            className="campo"
          >
            <option value="" className="bg-slate-800">Cliente…</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-800">
                {c.nombre} · {c.documento}
              </option>
            ))}
          </select>
        )}

        <select value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} className="campo">
          <option value="" className="bg-slate-800">Vehículo…</option>
          {suyos.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-800">
              {v.placa} · {v.marca} {v.modelo}
            </option>
          ))}
        </select>
      </div>

      {esCentral && !clienteId && (
        <p className="text-xs text-slate-400">Elija primero el cliente para ver sus vehículos.</p>
      )}
      {!esCentral && vehiculos?.length === 0 && (
        <p className="text-xs text-amber-200">
          Todavía no tiene vehículos registrados.{' '}
          <Link to="/vehiculos" className="underline hover:text-amber-100">
            Registre uno primero
          </Link>
          : sin vehículo no hay servicio.
        </p>
      )}

      <input
        value={direccion}
        onChange={(e) => setDireccion(e.target.value)}
        className="campo"
        placeholder="¿Dónde está el vehículo? Dirección o punto de referencia"
      />
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        className="campo min-h-[90px]"
        placeholder="¿Qué ocurrió? Por ejemplo: no enciende, se quedaron las llaves adentro, llanta averiada…"
      />

      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}

      <button className="boton" disabled={!completo || mutar.isPending} onClick={() => mutar.mutate()}>
        {mutar.isPending ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </div>
  );
}

/** Panel de clasificacion: es el paso donde la central decide el tipo de
 *  servicio y a quien se lo asigna. De ahi nace el expediente. */
function Clasificar({ servicio, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  const [tipo, setTipo] = useState('CARRO_TALLER');
  const [tecnicoId, setTecnicoId] = useState('');
  const { data: tecnicos } = useQuery({ queryKey: ['tecnicos'], queryFn: () => pedir<Tecnico[]>('/tecnicos') });

  const mutar = useMutation({
    mutationFn: () => enviar(`/servicios/${servicio.id}/clasificar`, 'PATCH', { tipo, tecnicoId }),
    onSuccess: alTerminar,
  });

  // Solo se ofrecen los tecnicos cuya hoja de vida cubre el tipo de servicio.
  const requerida = tipo === 'GRUA' ? 'GRUA' : tipo === 'CONDUCTOR_ELEGIDO' ? 'CONDUCTOR' : 'MECANICA';
  const aptos = (tecnicos ?? []).filter((t) => t.disponible && t.especialidades.includes(requerida));

  return (
    <div className="vidrio-suave mt-4 space-y-3 p-4">
      <p className="text-sm font-medium">Clasificar y asignar</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select value={tipo} onChange={(e) => { setTipo(e.target.value); setTecnicoId(''); }} className="campo">
          {Object.entries(TIPOS).map(([k, v]) => (
            <option key={k} value={k} className="bg-slate-800">{v}</option>
          ))}
        </select>
        <select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} className="campo">
          <option value="" className="bg-slate-800">Técnico…</option>
          {aptos.map((t) => (
            <option key={t.id} value={t.id} className="bg-slate-800">{t.nombre}</option>
          ))}
        </select>
      </div>
      {aptos.length === 0 && (
        <p className="text-xs text-amber-200">Ningún técnico disponible tiene esa especialidad.</p>
      )}
      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}
      <button className="boton" disabled={!tecnicoId || mutar.isPending} onClick={() => mutar.mutate()}>
        Abrir expediente
      </button>
    </div>
  );
}

function Cancelar({ servicio, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const mutar = useMutation({
    mutationFn: () => enviar(`/servicios/${servicio.id}/cancelar`, 'PATCH', { motivo }),
    onSuccess: alTerminar,
  });

  return (
    <div className="vidrio-suave mt-3 space-y-2 p-4">
      <p className="text-sm font-medium">Cancelar servicio</p>
      <p className="text-xs text-slate-400">La cancelación exige un motivo: así queda la trazabilidad.</p>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="campo" placeholder="Motivo de la cancelación" />
      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}
      <button className="boton-suave" disabled={motivo.length < 5 || mutar.isPending} onClick={() => mutar.mutate()}>
        Confirmar cancelación
      </button>
    </div>
  );
}

export function Servicios() {
  const cliente = useQueryClient();
  const rol = sesion.rol();
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [solicitando, setSolicitando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['servicios'],
    queryFn: () => pedir<Servicio[]>('/servicios'),
  });

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['servicios'] });
    cliente.invalidateQueries({ queryKey: ['indicadores'] });
    setAbierto(null);
    setCancelando(null);
    setSolicitando(false);
  };

  const avanzar = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: string }) =>
      enviar(`/servicios/${id}/estado`, 'PATCH', { estado }),
    onSuccess: refrescar,
  });

  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';
  const esTecnico = rol === 'TECNICO';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Gestionar servicio</h2>
          <p className="text-sm text-slate-400">
            {esTecnico
              ? 'Los servicios que tiene asignados.'
              : rol === 'CLIENTE'
                ? 'Los servicios que ha solicitado.'
                : 'El cliente solicita, la central clasifica y asigna, y con eso nace el expediente.'}
          </p>
        </div>

        {/* El tecnico no solicita: el atiende lo que le asignan. */}
        {!esTecnico && (
          <button className="boton" onClick={() => setSolicitando(!solicitando)}>
            {solicitando ? 'Cerrar' : 'Solicitar servicio'}
          </button>
        )}
      </div>

      {solicitando && <Solicitar alTerminar={refrescar} />}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="space-y-4">
        {data?.map((s) => (
          <article key={s.id} className="vidrio p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                    {ESTADOS[s.estado]?.texto ?? s.estado}
                  </span>
                  {s.tipo && (
                    <span className="etiqueta border border-white/20 bg-white/10 text-slate-200">
                      {TIPOS[s.tipo]}
                    </span>
                  )}
                  {s.expediente && (
                    <Link to={`/expedientes/${s.expediente.id}`} className="etiqueta border border-amber-300/40 bg-amber-400/15 font-mono text-amber-200 hover:bg-amber-400/25">
                      {s.expediente.consecutivo}
                    </Link>
                  )}
                </div>
                <h3 className="mt-2 font-medium">{s.descripcion}</h3>
                <p className="text-sm text-slate-400">{s.direccion}</p>
              </div>

              <div className="text-right text-sm">
                <p className="font-mono text-amber-300">{s.vehiculo.placa}</p>
                <p className="text-slate-300">{s.vehiculo.marca} {s.vehiculo.modelo}</p>
                <p className="text-xs text-slate-500">{fecha(s.solicitadoEn)}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-sm sm:grid-cols-3">
              <p><span className="text-slate-400">Cliente:</span> {s.cliente.nombre}</p>
              <p><span className="text-slate-400">Teléfono:</span> {s.cliente.telefono}</p>
              <p><span className="text-slate-400">Técnico:</span> {s.tecnico?.nombre ?? 'sin asignar'}</p>
            </div>

            {s.motivoCancelacion && (
              <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                Cancelado: {s.motivoCancelacion}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {esCentral && s.estado === 'SOLICITADO' && (
                <button className="boton" onClick={() => setAbierto(abierto === s.id ? null : s.id)}>
                  Clasificar y asignar
                </button>
              )}
              {esTecnico && s.estado === 'ASIGNADO' && (
                <button className="boton" onClick={() => avanzar.mutate({ id: s.id, estado: 'EN_EJECUCION' })}>
                  Iniciar atención
                </button>
              )}
              {esTecnico && s.estado === 'EN_EJECUCION' && (
                <button className="boton" onClick={() => avanzar.mutate({ id: s.id, estado: 'TERMINADO' })}>
                  Marcar terminado
                </button>
              )}
              {s.expediente && (
                <Link to={`/expedientes/${s.expediente.id}`} className="boton-suave">
                  Ver expediente
                </Link>
              )}
              {esCentral && !['CERRADO', 'CANCELADO'].includes(s.estado) && (
                <button className="boton-suave" onClick={() => setCancelando(cancelando === s.id ? null : s.id)}>
                  Cancelar
                </button>
              )}
            </div>

            {abierto === s.id && <Clasificar servicio={s} alTerminar={refrescar} />}
            {cancelando === s.id && <Cancelar servicio={s} alTerminar={refrescar} />}
          </article>
        ))}

        {data?.length === 0 && (
          <p className="vidrio p-6 text-sm text-slate-400">No hay servicios para mostrar.</p>
        )}
      </div>
    </div>
  );
}
