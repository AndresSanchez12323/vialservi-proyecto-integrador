import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { enviar, pedir, sesion, type Servicio, type Tecnico } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['servicios'],
    queryFn: () => pedir<Servicio[]>('/servicios'),
  });

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['servicios'] });
    cliente.invalidateQueries({ queryKey: ['indicadores'] });
    setAbierto(null);
    setCancelando(null);
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
