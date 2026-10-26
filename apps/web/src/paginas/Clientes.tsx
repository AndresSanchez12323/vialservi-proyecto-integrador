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

/** Los tres recuentos, con el color que cada uno pide cuando no es cero. */
const RECUENTOS = [
  { grupo: 'pendiente', titulo: 'Pendientes', clase: 'border border-marca/40 bg-marca-fondo/20 text-marca' },
  { grupo: 'abierto', titulo: 'Abiertos', clase: 'border border-dato/40 bg-dato-fondo/15 text-dato' },
  { grupo: 'cerrado', titulo: 'Cerrados', clase: 'border border-exito/40 bg-exito-fondo/15 text-exito' },
] as const;

const Recuento = ({
  servicios,
  grupo,
  clase,
}: {
  servicios: ServicioResumen[] | undefined;
  grupo: string;
  clase: string;
}) => {
  const n = contar(servicios, grupo);
  return <span className={`etiqueta ${n ? clase : 'bg-velo/5 text-tinta-sutil'}`}>{n}</span>;
};

/** Los servicios del cliente, que es lo que se despliega al pulsar su fila. */
const Servicios = ({ servicios }: { servicios: ServicioResumen[] | undefined }) => {
  if ((servicios?.length ?? 0) === 0) {
    return <p className="text-sm text-tinta-sutil">Este cliente aún no tiene servicios.</p>;
  }
  return (
    <ul className="space-y-2">
      {servicios!.map((s) => (
        <li
          key={s.id}
          className="vidrio-suave flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
        >
          <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
            {ESTADOS[s.estado]?.texto ?? s.estado}
          </span>
          <span className="font-mono text-marca">{s.vehiculo.placa}</span>
          {(s.tipo || s.tipoSolicitado) && (
            <span className="text-tinta-suave">
              {s.tipo ? TIPOS[s.tipo] : `Solicitado: ${TIPOS[s.tipoSolicitado!] ?? s.tipoSolicitado}`}
            </span>
          )}
          <span className="min-w-0 flex-1 basis-48 truncate text-tinta-tenue">{s.direccion}</span>
          <span className="text-xs text-tinta-sutil">{fecha(s.solicitadoEn)}</span>
          {s.expediente && (
            <Link
              to={`/expedientes/${s.expediente.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs text-marca hover:underline"
            >
              {s.expediente.consecutivo}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
};

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
        <p className="text-sm text-tinta-tenue">
          Dueño del vehículo y quien solicita el servicio. Pulse una fila para ver
          la situación en tiempo real de sus servicios.
        </p>
      </div>

      {isLoading && <p className="text-sm text-tinta-tenue">Cargando…</p>}
      {error && <p className="text-sm text-riesgo">{(error as Error).message}</p>}

      {/* ── Tarjetas: pantallas estrechas ───────────────────────────────────
          Ocho columnas no entran en un telefono ni ajustando anchos, y
          dejarlas desplazar en horizontal esconde la mitad de los datos tras
          un gesto que nadie adivina. Los mismos datos, uno encima de otro. */}
      <div className="space-y-3 lg:hidden">
        {data?.map((c) => {
          const abierto = expandido === c.id;
          return (
            <article key={c.id} className="vidrio min-w-0 p-4">
              <button
                type="button"
                onClick={() => setExpandido(abierto ? null : c.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={abierto}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.nombre}</p>
                  <p className="truncate font-mono text-xs text-tinta-tenue">
                    CC {c.documento} · {c.telefono}
                  </p>
                </div>
                <span className="shrink-0 text-tinta-sutil">{abierto ? '▲' : '▼'}</span>
              </button>

              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-velo/10 pt-3 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs text-tinta-tenue">Vehículos</dt>
                  <dd className="font-mono text-marca">{c._count?.vehiculos ?? 0}</dd>
                </div>
                {RECUENTOS.map(({ grupo, titulo, clase }) => (
                  <div key={grupo} className="min-w-0">
                    <dt className="text-xs text-tinta-tenue">{titulo}</dt>
                    <dd className="mt-0.5">
                      <Recuento servicios={c.servicios} grupo={grupo} clase={clase} />
                    </dd>
                  </div>
                ))}
              </dl>

              {abierto && (
                <div className="mt-3 border-t border-velo/10 pt-3">
                  <Servicios servicios={c.servicios} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* ── Tabla: a partir de lg, donde las ocho columnas caben de verdad ── */}
      <div className="vidrio hidden overflow-hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-velo/5 text-xs uppercase tracking-wide text-tinta-tenue">
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
                    className="cursor-pointer border-t border-velo/10 transition hover:bg-velo/5"
                    title="Ver servicios del cliente"
                  >
                    <td className="px-5 py-3 font-mono text-tinta-suave">{c.documento}</td>
                    <td className="px-5 py-3">{c.nombre}</td>
                    <td className="px-5 py-3 text-tinta-suave">{c.telefono}</td>
                    <td className="px-5 py-3 text-marca">{c._count?.vehiculos ?? 0}</td>
                    {RECUENTOS.map(({ grupo, clase }) => (
                      <td key={grupo} className="px-5 py-3">
                        <Recuento servicios={c.servicios} grupo={grupo} clase={clase} />
                      </td>
                    ))}
                    <td className="px-5 py-3 text-tinta-sutil">{abierto ? '▲' : '▼'}</td>
                  </tr>

                  {abierto && (
                    <tr className="border-t border-velo/5 bg-velo/[0.06]">
                      <td colSpan={8} className="px-5 py-4">
                        <Servicios servicios={c.servicios} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {data?.length === 0 && !isLoading && (
        <p className="vidrio p-6 text-sm text-tinta-tenue">Todavía no hay clientes registrados.</p>
      )}
    </div>
  );
}
