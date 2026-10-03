import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { enviar, pedir, sesion, type Cliente, type Servicio, type Tecnico, type Vehiculo } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

/** Panel de clasificacion: es el paso donde la central decide el tipo de
 *  servicio y a quien se lo asigna. De ahi nace el expediente. */
function Clasificar({ servicio, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  // Preselecciona lo que el cliente pidió: la central confirma o corrige.
  const [tipo, setTipo] = useState(servicio.tipoSolicitado ?? 'CARRO_TALLER');
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
  const esCliente = rol === 'CLIENTE';
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [form, setForm] = useState({ vehiculoId: '', tipoSolicitado: 'CARRO_TALLER', direccion: '', descripcion: '' });
  const [ok, setOk] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['servicios'],
    queryFn: () => pedir<Servicio[]>('/servicios'),
  });

  // Apartado del técnico: su hoja de vida, sus pestañas por estado y su
  // disponibilidad, que la central ve en tiempo real.
  const esTecnico = rol === 'TECNICO';
  const [pestana, setPestana] = useState<'pendientes' | 'progreso' | 'historial'>('pendientes');
  const { data: ficha } = useQuery({
    queryKey: ['tecnicoYo'],
    queryFn: () => pedir<Tecnico>('/tecnicos/yo'),
    enabled: esTecnico,
  });

  const cambiarDisponibilidad = useMutation({
    mutationFn: (disponible: boolean) =>
      enviar<Tecnico>('/tecnicos/yo/disponibilidad', 'PATCH', { disponible }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['tecnicoYo'] });
      cliente.invalidateQueries({ queryKey: ['tecnicos'] });
    },
  });

  const porPestana = (s: Servicio) =>
    pestana === 'pendientes' ? s.estado === 'ASIGNADO'
    : pestana === 'progreso' ? s.estado === 'EN_EJECUCION'
    : ['TERMINADO', 'CERRADO', 'CANCELADO'].includes(s.estado);
  const lista = esTecnico ? (data ?? []).filter(porPestana) : (data ?? []);

  // Vehículos propios para el formulario de solicitud del cliente.
  const { data: yo } = useQuery({
    queryKey: ['clienteYo'],
    queryFn: () => pedir<Cliente & { vehiculos: Vehiculo[] }>('/clientes/yo'),
    enabled: esCliente,
  });

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['servicios'] });
    cliente.invalidateQueries({ queryKey: ['indicadores'] });
    cliente.invalidateQueries({ queryKey: ['clienteYo'] });
    setAbierto(null);
    setCancelando(null);
  };

  const solicitar = useMutation({
    mutationFn: () =>
      enviar('/servicios', 'POST', {
        clienteId: yo?.id,
        vehiculoId: Number(form.vehiculoId),
        tipoSolicitado: form.tipoSolicitado,
        direccion: form.direccion,
        descripcion: form.descripcion,
      }),
    onSuccess: () => {
      setForm({ vehiculoId: '', tipoSolicitado: 'CARRO_TALLER', direccion: '', descripcion: '' });
      setPidiendo(false);
      setOk('Servicio solicitado. La central lo clasificará y asignará.');
      refrescar();
    },
  });

  const avanzar = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: string }) =>
      enviar(`/servicios/${id}/estado`, 'PATCH', { estado }),
    onSuccess: refrescar,
  });

  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar servicio</h2>
        <p className="text-sm text-slate-400">
          {esTecnico
            ? 'Sus asignados, su historial y su disponibilidad para la central.'
            : rol === 'CLIENTE'
              ? 'Los servicios que ha solicitado.'
              : 'El cliente solicita, la central clasifica y asigna, y con eso nace el expediente.'}
        </p>
      </div>

      {esTecnico && (
        <section className="vidrio flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Mi disponibilidad</p>
            <p className="mt-1 text-sm">
              {ficha ? (
                <span className={`etiqueta ${ficha.disponible ? 'border border-emerald-300/40 bg-emerald-400/15 text-emerald-200' : 'border border-amber-300/40 bg-amber-400/15 text-amber-200'}`}>
                  {ficha.disponible ? 'Disponible para asignar' : 'Ocupado en servicio'}
                </span>
              ) : (
                <span className="text-slate-500">Cargando…</span>
              )}
              <span className="ml-2 text-xs text-slate-400">La central lo ve en tiempo real.</span>
            </p>
          </div>
          <button
            className="boton-suave"
            disabled={!ficha || cambiarDisponibilidad.isPending}
            onClick={() => ficha && cambiarDisponibilidad.mutate(!ficha.disponible)}
            title={ficha?.disponible ? 'Avisar que está ocupado' : 'Avisar que está libre'}
          >
            {ficha?.disponible ? 'Marcarme ocupado' : 'Marcarme disponible'}
          </button>
        </section>
      )}

      {esTecnico && (
        <div className="vidrio flex gap-1 p-1.5" role="tablist">
          {([
            ['pendientes', 'Asignados'],
            ['progreso', 'En progreso'],
            ['historial', 'Historial'],
          ] as const).map(([clave, texto]) => {
            const n = (data ?? []).filter((s) =>
              clave === 'pendientes' ? s.estado === 'ASIGNADO'
              : clave === 'progreso' ? s.estado === 'EN_EJECUCION'
              : ['TERMINADO', 'CERRADO', 'CANCELADO'].includes(s.estado),
            ).length;
            return (
              <button
                key={clave}
                role="tab"
                onClick={() => setPestana(clave)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
                  pestana === clave
                    ? 'bg-amber-400/20 font-medium text-amber-200'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {texto} <span className="font-mono text-xs opacity-80">({n})</span>
              </button>
            );
          })}
        </div>
      )}

      {esCliente && (
        <div className="vidrio space-y-3 p-5">
          <button className="boton w-full sm:w-auto" onClick={() => { setPidiendo(!pidiendo); setOk(''); }}>
            {pidiendo ? 'Cerrar formulario' : '+ Solicitar nuevo servicio'}
          </button>

          {pidiendo && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <select value={form.vehiculoId} onChange={(e) => setForm({ ...form, vehiculoId: e.target.value })} className="campo" title="Vehículo para el servicio">
                <option value="" className="bg-slate-800">Vehículo…</option>
                {(yo?.vehiculos ?? []).map((v) => (
                  <option key={v.id} value={v.id} className="bg-slate-800">{v.placa} · {v.marca} {v.modelo}</option>
                ))}
              </select>
              <select value={form.tipoSolicitado} onChange={(e) => setForm({ ...form, tipoSolicitado: e.target.value })} className="campo" title="Tipo de servicio que necesita">
                {Object.entries(TIPOS).map(([k, v]) => (
                  <option key={k} value={k} className="bg-slate-800">{v}</option>
                ))}
              </select>
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} placeholder="Dirección donde está el vehículo" className="campo sm:col-span-2" />
              <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué necesita (ej: no enciende, llanta averiada…)" rows={3} className="campo resize-none sm:col-span-2" />
              {solicitar.error && <p className="text-sm text-rose-300 sm:col-span-2">{(solicitar.error as Error).message}</p>}
              <div className="sm:col-span-2">
                <button
                  className="boton"
                  disabled={solicitar.isPending || !form.vehiculoId || form.direccion.length < 5 || form.descripcion.length < 5}
                  onClick={() => solicitar.mutate()}
                >
                  {solicitar.isPending ? 'Solicitando…' : 'Enviar solicitud a la central'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {ok && <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</p>}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="space-y-4">
        {lista.map((s) => (
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
                  {!s.tipo && s.tipoSolicitado && (
                    <span className="etiqueta border border-dashed border-sky-300/40 bg-sky-400/10 text-sky-200" title="Lo que el cliente cree necesitar; la central confirma al clasificar">
                      Solicitado: {TIPOS[s.tipoSolicitado] ?? s.tipoSolicitado}
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

        {lista.length === 0 && (
          <p className="vidrio p-6 text-sm text-slate-400">
            {esTecnico
              ? pestana === 'historial'
                ? 'Aún no tiene servicios realizados.'
                : 'No tiene servicios en este estado.'
              : 'No hay servicios para mostrar.'}
          </p>
        )}
      </div>
    </div>
  );
}
