import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { enviar, pedir, sesion, type Expediente } from '../comun/api';
import { Atras } from '../comun/Atras';
import { ESTADOS, ROLES, TIPOS, fecha } from '../comun/formato';

const idLocal = () => `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function ExpedienteDetalle() {
  const { id } = useParams();
  const cliente = useQueryClient();
  const rol = sesion.rol();
  const esTecnico = rol === 'TECNICO' || rol === 'ADMINISTRADOR';
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const { data, isLoading, error } = useQuery({
    queryKey: ['expediente', id],
    queryFn: () => pedir<Expediente>(`/expedientes/${id}`),
  });

  const [texto, setTexto] = useState('');
  const [novedad, setNovedad] = useState('');
  useEffect(() => setTexto(data?.observaciones ?? ''), [data?.observaciones]);

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['expediente', id] });
    cliente.invalidateQueries({ queryKey: ['servicios'] });
    cliente.invalidateQueries({ queryKey: ['indicadores'] });
  };

  // El contador de version viaja con la edicion: si un envio viejo llegara
  // tarde, el servidor lo descarta en vez de pisar el texto nuevo.
  const guardar = useMutation({
    mutationFn: () =>
      enviar(`/expedientes/${id}/observaciones`, 'PATCH', {
        observaciones: texto,
        version: (data?.observacionesVersion ?? 0) + 1,
      }),
    onSuccess: refrescar,
  });

  const subir = useMutation({
    mutationFn: (tipo: 'FOTO' | 'VIDEO') =>
      enviar(`/expedientes/${id}/evidencias`, 'POST', {
        idLocal: idLocal(),
        tipo,
        archivo: `evidencias/${data?.servicio.vehiculo.placa}-${Date.now()}.${tipo === 'FOTO' ? 'jpg' : 'mp4'}`,
        tomadaEn: new Date().toISOString(),
      }),
    onSuccess: refrescar,
  });

  const agregarNovedad = useMutation({
    mutationFn: () =>
      enviar(`/expedientes/${id}/novedades`, 'POST', { idLocal: idLocal(), descripcion: novedad }),
    onSuccess: () => { setNovedad(''); refrescar(); },
  });

  const cerrar = useMutation({
    mutationFn: () => enviar(`/expedientes/${id}/cerrar`, 'POST'),
    onSuccess: refrescar,
  });

  if (isLoading) return <p className="text-sm text-slate-400">Cargando expediente…</p>;
  if (error) return <p className="text-sm text-rose-300">{(error as Error).message}</p>;
  if (!data) return null;

  const s = data.servicio;
  const cerrado = data.cerradoEn !== null;

  return (
    <div className="space-y-6">
      <div>
        <Atras destino="/servicios" />
      </div>
      <header className="vidrio p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm text-amber-300">{data.consecutivo}</p>
            <h2 className="mt-1 text-xl font-semibold">{s.descripcion}</h2>
            <p className="text-sm text-slate-400">{s.direccion}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>{ESTADOS[s.estado]?.texto}</span>
            {s.tipo && <span className="etiqueta border border-white/20 bg-white/10">{TIPOS[s.tipo]}</span>}
          </div>
        </div>

        {/* El expediente concentra y enlaza: no duplica los datos */}
        <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Vehículo</p>
            <p className="font-mono text-amber-300">{s.vehiculo.placa}</p>
            <p className="text-sm text-slate-300">{s.vehiculo.marca} {s.vehiculo.modelo} · {s.vehiculo.color}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Cliente</p>
            <p className="text-sm">{s.cliente.nombre}</p>
            <p className="text-sm text-slate-400">{s.cliente.telefono}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Técnico</p>
            <p className="text-sm">{s.tecnico?.nombre ?? 'sin asignar'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Cierre</p>
            <p className="text-sm">{cerrado ? fecha(data.cerradoEn) : 'abierto'}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Observaciones del técnico</h3>
          <p className="mb-3 text-xs text-slate-500">Versión {data.observacionesVersion}</p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            className="campo resize-none"
            disabled={!esTecnico}
            placeholder="Qué se encontró y qué se hizo…"
          />
          {esTecnico && (
            <button className="boton mt-3" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
              Guardar observaciones
            </button>
          )}
        </section>

        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Inventario del vehículo</h3>
          <p className="mb-3 text-xs text-slate-500">Lo que iba dentro cuando se recibió</p>
          <ul className="space-y-2">
            {s.vehiculo.inventario?.map((o) => (
              <li key={o.id} className="vidrio-suave flex justify-between px-3 py-2 text-sm">
                <span>{o.descripcion}</span>
                <span className="text-slate-400">×{o.cantidad}</span>
              </li>
            ))}
            {!s.vehiculo.inventario?.length && (
              <li className="text-sm text-slate-500">Sin objetos registrados.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="vidrio p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">Evidencias ({data.evidencias.length})</h3>
          <div className="flex gap-2">
            <button className="boton-suave" onClick={() => subir.mutate('FOTO')}>+ Fotografía</button>
            <button className="boton-suave" onClick={() => subir.mutate('VIDEO')}>+ Video (10 s)</button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.evidencias.map((ev) => (
            <div key={ev.id} className="vidrio-suave p-4">
              <div className="flex items-center justify-between">
                <span className="etiqueta border border-sky-300/30 bg-sky-400/15 text-sky-200">{ev.tipo}</span>
                {ev.posteriorAlCierre && (
                  <span className="etiqueta border border-amber-300/40 bg-amber-400/20 text-amber-200">
                    posterior al cierre
                  </span>
                )}
              </div>
              <p className="mt-2 truncate font-mono text-xs text-slate-400">{ev.archivo}</p>
              <p className="mt-2 text-sm">{ev.subidaPor.nombre}</p>
              <p className="text-xs text-amber-300">{ROLES[ev.subidaPor.rol] ?? ev.subidaPor.rol}</p>
              <p className="mt-1 text-xs text-slate-500">{fecha(ev.tomadaEn)}</p>
            </div>
          ))}
          {data.evidencias.length === 0 && (
            <p className="text-sm text-slate-500">Todavía no hay evidencias.</p>
          )}
        </div>
      </section>

      <section className="vidrio p-6">
        <h3 className="mb-4 font-medium">Novedades ({data.novedades.length})</h3>
        <ul className="mb-4 space-y-2">
          {data.novedades.map((n) => (
            <li key={n.id} className="vidrio-suave px-4 py-3 text-sm">
              <p>{n.descripcion}</p>
              <p className="mt-1 text-xs text-slate-500">{fecha(n.ocurridaEn)}</p>
            </li>
          ))}
          {data.novedades.length === 0 && <li className="text-sm text-slate-500">Sin novedades.</li>}
        </ul>

        {esTecnico && (
          <div className="flex gap-2">
            <input
              value={novedad}
              onChange={(e) => setNovedad(e.target.value)}
              className="campo"
              placeholder="Registrar una novedad del servicio…"
            />
            <button
              className="boton"
              disabled={novedad.length < 3 || agregarNovedad.isPending}
              onClick={() => agregarNovedad.mutate()}
            >
              Agregar
            </button>
          </div>
        )}
      </section>

      {esCentral && (
        <section className="vidrio p-6">
          <h3 className="font-medium">Cierre del expediente</h3>
          <p className="mt-1 text-sm text-slate-400">
            Solo la central cierra. Se exige que el técnico haya marcado el servicio como
            terminado y que exista al menos una evidencia: quien presta el servicio no
            declara cerrada la evidencia de que existió.
          </p>
          {cerrar.error && <p className="mt-3 text-sm text-rose-300">{(cerrar.error as Error).message}</p>}
          <button
            className="boton mt-4"
            disabled={cerrado || cerrar.isPending}
            onClick={() => cerrar.mutate()}
          >
            {cerrado ? `Cerrado el ${fecha(data.cerradoEn)}` : 'Cerrar expediente'}
          </button>
        </section>
      )}
    </div>
  );
}
