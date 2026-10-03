import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { pedir, type Cliente, type ServicioResumen } from '../comun/api';
import { ESTADOS, TIPOS, fecha } from '../comun/formato';

/** Lo que la central necesita de un vistazo: pendiente por asignar
 *  (solicitado sin clasificar), abierto (en curso) o cerrado. */
const grupoDe = (estado: string) =>
  estado === 'SOLICITADO' ? 'pendiente'
  : estado === 'CERRADO' ? 'cerrado'
  : estado === 'CANCELADO' ? 'cancelado'
  : 'abierto';

const contar = (servicios: ServicioResumen[] | undefined, grupo: string) =>
  (servicios ?? []).filter((s) => grupoDe(s.estado) === grupo).length;

export function Clientes() {
  const [expandido, setExpandido] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Gestionar cliente</h2>
        <p className="text-sm text-slate-400">
          Dueño del vehículo y quien solicita el servicio. Pulse una fila para ver
          la situación en tiempo real de sus servicios.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="vidrio overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3">Documento</th>
              <th className="px-5 py-3">Nombre</th>
              <th className="px-5 py-3">Teléfono</th>
              <th className="px-5 py-3">Vehículos</th>
              <th className="px-5 py-3" title="Solicitados sin clasificar ni asignar">Pendientes</th>
              <th className="px-5 py-3" title="Asignados, en ejecución o terminados sin cerrar">Abiertos</th>
              <th className="px-5 py-3">Cerrados</th>
              <th className="px-5 py-3"><span className="sr-only">Detalle</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c) => {
              const abierto = expandido === c.id;
              return (
                <Fragment key={c.id}>
                  <tr
                    onClick={() => setExpandido(abierto ? null : c.id)}
                    className="cursor-pointer border-t border-white/10 transition hover:bg-white/5"
                    title="Ver servicios del cliente"
                  >
                    <td className="px-5 py-3 font-mono text-slate-300">{c.documento}</td>
                    <td className="px-5 py-3">{c.nombre}</td>
                    <td className="px-5 py-3 text-slate-300">{c.telefono}</td>
                    <td className="px-5 py-3 text-amber-300">{c._count?.vehiculos ?? 0}</td>
                    <td className="px-5 py-3">
                      <span className={`etiqueta ${contar(c.servicios, 'pendiente') ? 'border border-amber-300/40 bg-amber-400/20 text-amber-200' : 'bg-white/5 text-slate-500'}`}>
                        {contar(c.servicios, 'pendiente')}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`etiqueta ${contar(c.servicios, 'abierto') ? 'border border-sky-300/40 bg-sky-400/15 text-sky-200' : 'bg-white/5 text-slate-500'}`}>
                        {contar(c.servicios, 'abierto')}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`etiqueta ${contar(c.servicios, 'cerrado') ? 'border border-emerald-300/40 bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-slate-500'}`}>
                        {contar(c.servicios, 'cerrado')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{abierto ? '▲' : '▼'}</td>
                  </tr>

                  {abierto && (
                    <tr key={`${c.id}-detalle`} className="border-t border-white/5 bg-black/20">
                      <td colSpan={8} className="px-5 py-4">
                        {(c.servicios?.length ?? 0) === 0 && (
                          <p className="text-sm text-slate-500">Este cliente aún no tiene servicios.</p>
                        )}
                        <ul className="space-y-2">
                          {c.servicios?.map((s) => (
                            <li key={s.id} className="vidrio-suave flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                              <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                                {ESTADOS[s.estado]?.texto ?? s.estado}
                              </span>
                              <span className="font-mono text-amber-300">{s.vehiculo.placa}</span>
                              {(s.tipo || s.tipoSolicitado) && (
                                <span className="text-slate-300">
                                  {s.tipo ? TIPOS[s.tipo] : `Solicitado: ${TIPOS[s.tipoSolicitado!] ?? s.tipoSolicitado}`}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 basis-48 truncate text-slate-400">{s.direccion}</span>
                              <span className="text-xs text-slate-500">{fecha(s.solicitadoEn)}</span>
                              {s.expediente && (
                                <Link
                                  to={`/expedientes/${s.expediente.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-mono text-xs text-amber-200 hover:underline"
                                >
                                  {s.expediente.consecutivo}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
