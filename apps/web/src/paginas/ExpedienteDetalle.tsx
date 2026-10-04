import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { enviar, pedir, sesion, type Expediente } from '../comun/api';
import { Atras } from '../comun/Atras';
import { Mapa } from '../comun/Mapa';
import { SubirEvidencia } from '../comun/SubirEvidencia';
import { VistaEvidencia } from '../comun/VistaEvidencia';
import { CATEGORIAS, ESTADOS, TIPOS, fecha, haceCuanto } from '../comun/formato';

const idLocal = () => `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Verificacion de quien entrega el vehiculo. La hace el TECNICO en sitio.
 *
 * Es el interruptor del formulario: si quien entrega NO es el propietario, se
 * piden sus datos y queda obligatoria la foto de la cedula con la firma.
 *
 * VialServi no comprueba procedencia ni hurto y no certifica propiedad: esto
 * solo deja constancia de lo que el tecnico vio y de quien autorizo. El texto
 * en pantalla lo dice para que nadie lo entienda de otra manera.
 */
function Verificacion({
  exp,
  alTerminar,
}: {
  exp: Expediente;
  alTerminar: () => void;
}) {
  const [esPropietario, setEsPropietario] = useState<boolean | null>(exp.esPropietario);
  const [nombre, setNombre] = useState(exp.solicitanteNombre ?? '');
  const [documento, setDocumento] = useState(exp.solicitanteDocumento ?? '');
  const [relacion, setRelacion] = useState(exp.solicitanteRelacion ?? '');
  const v = exp.servicio.vehiculo;
  const [doc, setDoc] = useState({
    linea: v.linea ?? '', clase: v.clase ?? '', licenciaTransito: v.licenciaTransito ?? '',
    vin: v.vin ?? '', chasis: v.chasis ?? '', motor: v.motor ?? '',
    propietarioNombre: v.propietarioNombre ?? '', propietarioDocumento: v.propietarioDocumento ?? '',
  });

  const guardar = useMutation({
    mutationFn: () =>
      enviar(`/expedientes/${exp.id}/verificacion`, 'PATCH', {
        esPropietario,
        version: exp.verificacionVersion + 1,
        ...(esPropietario === false
          ? { solicitanteNombre: nombre, solicitanteDocumento: documento, solicitanteRelacion: relacion }
          : {}),
        // Solo se mandan los campos con algo escrito: enviar cadenas vacias
        // borraria datos que ya estuvieran guardados.
        vehiculo: Object.fromEntries(Object.entries(doc).filter(([, val]) => val.trim() !== '')),
      }),
    onSuccess: alTerminar,
  });

  const faltanDatos = esPropietario === false && (nombre.trim().length < 3 || documento.trim().length < 5);
  const tieneFirma = (exp.control.porCategoria.FIRMA_CEDULA ?? 0) > 0;

  return (
    <section className="vidrio p-6">
      <h3 className="font-medium">Quién entrega el vehículo</h3>
      <p className="mt-1 text-xs text-slate-400">
        Compare la persona y el documento con los datos del expediente antes de la maniobra.
        Si hay diferencias, suspenda e informe a la central con una novedad.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEsPropietario(true)}
          className={`rounded-lg px-4 py-2 text-sm transition ${
            esPropietario === true
              ? 'bg-emerald-400/20 font-medium text-emerald-200 ring-1 ring-emerald-300/40'
              : 'bg-white/10 text-slate-200 hover:bg-white/20'
          }`}
        >
          Sí, es el propietario
        </button>
        <button
          type="button"
          onClick={() => setEsPropietario(false)}
          className={`rounded-lg px-4 py-2 text-sm transition ${
            esPropietario === false
              ? 'bg-amber-400/20 font-medium text-amber-200 ring-1 ring-amber-300/40'
              : 'bg-white/10 text-slate-200 hover:bg-white/20'
          }`}
        >
          No es el propietario
        </button>
      </div>

      {esPropietario === false && (
        <div className="mt-4 space-y-3 rounded-xl border border-amber-300/30 bg-amber-400/[0.07] p-4">
          <p className="text-sm font-medium text-amber-200">Datos de quien entrega</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="campo" placeholder="Nombre completo" />
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className="campo font-mono" placeholder="Número de cédula" />
          </div>
          <input
            value={relacion}
            onChange={(e) => setRelacion(e.target.value)}
            className="campo"
            placeholder="Relación con el propietario (familiar, empleado, taller, aseguradora…)"
          />

          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              tieneFirma
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-400/30 bg-rose-500/10 text-rose-200'
            }`}
          >
            {tieneFirma
              ? '✓ Ya está cargada la foto de la cédula con la firma de autorización.'
              : 'Obligatorio: suba abajo una foto de la cédula con la firma de autorización, en la categoría «Cédula con firma». Sin ella no se puede marcar el servicio como terminado.'}
          </div>

          <p className="text-[11px] text-amber-200/70">
            Este registro no certifica la propiedad del vehículo ni descarta un reporte de hurto:
            VialServi no hace esa comprobación. Solo queda constancia de quién autorizó.
          </p>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-slate-300 hover:text-slate-100">
          Datos de la licencia de tránsito (tarjeta de propiedad)
        </summary>
        <p className="mt-2 text-xs text-slate-400">
          Tómelos del documento que tiene en la mano. Si un dato no figura o no aplica, déjelo
          vacío: no lo complete con supuestos.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ['linea', 'Línea'],
            ['clase', 'Clase de vehículo'],
            ['licenciaTransito', 'N.º licencia de tránsito'],
            ['vin', 'VIN'],
            ['chasis', 'Chasis'],
            ['motor', 'Motor'],
            ['propietarioNombre', 'Propietario según el documento'],
            ['propietarioDocumento', 'Documento del propietario'],
          ] as const).map(([clave, etiqueta]) => (
            <label key={clave} className="block">
              <span className="mb-1 block text-xs text-slate-400">{etiqueta}</span>
              <input
                value={doc[clave]}
                onChange={(e) => setDoc({ ...doc, [clave]: e.target.value })}
                className="campo"
              />
            </label>
          ))}
        </div>
      </details>

      {guardar.error && <p className="mt-3 text-sm text-rose-300">{(guardar.error as Error).message}</p>}
      {faltanDatos && (
        <p className="mt-3 text-xs text-amber-200">
          Si no es el propietario, el nombre y el documento de quien entrega son obligatorios.
        </p>
      )}

      <button
        className="boton mt-4"
        disabled={esPropietario === null || faltanDatos || guardar.isPending}
        onClick={() => guardar.mutate()}
      >
        {guardar.isPending ? 'Guardando…' : 'Guardar verificación'}
      </button>
      {exp.verificadoEn && (
        <p className="mt-2 text-xs text-slate-500">
          Última verificación: {fecha(exp.verificadoEn)} (versión {exp.verificacionVersion})
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export function ExpedienteDetalle() {
  const { id } = useParams();
  const cola = useQueryClient();
  const rol = sesion.rol();
  const esTecnico = rol === 'TECNICO' || rol === 'ADMINISTRADOR';
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';
  const esCliente = rol === 'CLIENTE';

  const { data, isLoading, error } = useQuery({
    queryKey: ['expediente', id],
    queryFn: () => pedir<Expediente>(`/expedientes/${id}`),
    refetchInterval: 20000,
  });

  const [texto, setTexto] = useState('');
  const [novedad, setNovedad] = useState('');
  const [revision, setRevision] = useState('');
  const [categoria, setCategoria] = useState('RECEPCION');
  useEffect(() => setTexto(data?.observaciones ?? ''), [data?.observaciones]);
  useEffect(() => setRevision(data?.revisionCentral ?? ''), [data?.revisionCentral]);

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['expediente', id] });
    cola.invalidateQueries({ queryKey: ['servicios'] });
    cola.invalidateQueries({ queryKey: ['indicadores'] });
    cola.invalidateQueries({ queryKey: ['notificaciones'] });
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

  const agregarNovedad = useMutation({
    mutationFn: () =>
      enviar(`/expedientes/${id}/novedades`, 'POST', { idLocal: idLocal(), descripcion: novedad }),
    onSuccess: () => { setNovedad(''); refrescar(); },
  });

  const guardarRevision = useMutation({
    mutationFn: () => enviar(`/expedientes/${id}/revision`, 'PATCH', { revisionCentral: revision }),
    onSuccess: refrescar,
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
  const control = data.control;
  // El cliente solo puede aportar su propia version de los hechos: las
  // categorias de soporte del tecnico no se le ofrecen.
  const categoriasDisponibles = esCliente
    ? ['GENERAL', 'DANO']
    : ['RECEPCION', 'ENTREGA', 'DANO', 'FIRMA_CEDULA', 'DOCUMENTO', 'GENERAL'];

  const destino = s.lat != null ? { lat: s.lat, lng: s.lng! } : null;
  const puntoTecnico = s.tecnico?.lat != null ? { lat: s.tecnico.lat, lng: s.tecnico.lng! } : null;

  return (
    <div className="space-y-6">
      <div><Atras destino="/servicios" /></div>

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
            {data.formato && (
              <span
                className="etiqueta border border-white/15 bg-white/5 text-slate-300"
                title="Versión del formato con la que se diligenció este expediente"
              >
                formato v{data.formatoVersion}
              </span>
            )}
          </div>
        </div>

        {/* El expediente concentra y enlaza: no duplica los datos */}
        <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Vehículo</p>
            <p className="font-mono text-amber-300">{s.vehiculo.placa}</p>
            <p className="text-sm text-slate-300">{s.vehiculo.marca} {s.vehiculo.modelo} · {s.vehiculo.color}</p>
            {s.vehiculo.vin && <p className="mt-1 font-mono text-[11px] text-slate-500">VIN {s.vehiculo.vin}</p>}
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Cliente</p>
            <p className="text-sm">{s.cliente.nombre}</p>
            <p className="text-sm text-slate-400">{s.contactoTelefono ?? s.cliente.telefono}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Técnico</p>
            <p className="text-sm">{s.tecnico?.nombre ?? 'sin asignar'}</p>
            {s.tecnico?.ubicacionEn && (
              <p className="text-xs text-slate-500">ubicación {haceCuanto(s.tecnico.ubicacionEn)}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Quién entregó</p>
            {data.esPropietario === null ? (
              <p className="text-sm text-amber-200">sin verificar</p>
            ) : data.esPropietario ? (
              <p className="text-sm text-emerald-200">el propietario</p>
            ) : (
              <>
                <p className="text-sm text-amber-200">{data.solicitanteNombre}</p>
                <p className="font-mono text-xs text-slate-400">CC {data.solicitanteDocumento}</p>
                {data.solicitanteRelacion && (
                  <p className="text-[11px] text-slate-500">{data.solicitanteRelacion}</p>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Lista de pendientes: el tecnico ve lo que falta en lugar de descubrirlo
          cuando la central le rebote el cierre. */}
      {!cerrado && (
        <section
          className={`vidrio p-6 ${control.listoParaCerrar ? '' : 'border-amber-300/30'}`}
        >
          <h3 className="font-medium">
            {control.listoParaCerrar ? '✓ Expediente completo' : 'Falta para poder cerrar'}
          </h3>
          {control.listoParaCerrar ? (
            <p className="mt-1 text-sm text-emerald-200">
              Tiene todo lo que exige el formato{data.formato ? ` de ${data.formato.nombre.toLowerCase()}` : ''}.
              La central ya puede cerrarlo.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {control.avisos.map((a) => (
                <li key={a} className="flex items-start gap-2 text-sm text-amber-100">
                  <span className="mt-0.5 text-amber-300">○</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          {data.formato && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Evidencias que exige {data.formato.nombre.toLowerCase()}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {control.requeridas.map((r) => {
                  const hay = control.porCategoria[r.categoria] ?? 0;
                  const ok = hay >= r.minimo;
                  return (
                    <span
                      key={r.categoria + r.etiqueta}
                      className={`etiqueta border ${
                        ok
                          ? 'border-emerald-300/30 bg-emerald-400/15 text-emerald-200'
                          : 'border-amber-300/30 bg-amber-400/10 text-amber-200'
                      }`}
                    >
                      {ok ? '✓' : '○'} {r.etiqueta} ({hay}/{r.minimo})
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* La verificacion es del tecnico, y solo mientras el expediente este abierto. */}
      {esTecnico && !cerrado && <Verificacion exp={data} alTerminar={refrescar} />}

      {(destino || puntoTecnico) && (
        <section className="vidrio p-6">
          <h3 className="mb-3 font-medium">Ubicación del servicio</h3>
          <Mapa
            destino={destino}
            tecnico={puntoTecnico}
            etiquetaDestino={`${s.vehiculo.placa} · ${s.direccion}`}
            etiquetaTecnico={s.tecnico?.nombre ?? 'Técnico'}
            alto="16rem"
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Observaciones del técnico</h3>
          <p className="mb-3 text-xs text-slate-500">
            Versión {data.observacionesVersion} · campo del técnico: la central no lo escribe
          </p>
          {data.formato && esTecnico && (
            <p className="mb-2 text-xs text-slate-400">
              Para {data.formato.nombre.toLowerCase()} registre:{' '}
              {data.formato.campos.map((c) => c.etiqueta.toLowerCase()).join(', ')}.
            </p>
          )}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={5}
            className="campo resize-none"
            disabled={!esTecnico || cerrado}
            placeholder="Qué se encontró y qué se hizo…"
          />
          {esTecnico && !cerrado && (
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
          <div>
            <h3 className="font-medium">Evidencias ({data.evidencias.length})</h3>
            <p className="text-xs text-slate-500">
              Cada archivo queda con su autor y su hora de captura.
            </p>
          </div>
        </div>

        {(esTecnico || esCliente) && (
          <div className="vidrio-suave mb-4 space-y-3 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">¿Qué prueba esta evidencia?</p>
            <div className="flex flex-wrap gap-2">
              {categoriasDisponibles.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoria(c)}
                  className={`etiqueta border transition ${
                    categoria === c
                      ? CATEGORIAS[c].clase + ' ring-1 ring-white/40'
                      : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {CATEGORIAS[c].texto}
                </button>
              ))}
            </div>
            <SubirEvidencia
              expedienteId={data.id}
              categoria={categoria}
              alSubir={refrescar}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.evidencias.map((ev) => (
            <VistaEvidencia key={ev.id} evidencia={ev} expedienteId={data.id} />
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

        {(esTecnico || esCentral) && (
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
          <h3 className="font-medium">Revisión y cierre de la central</h3>
          <p className="mt-1 text-sm text-slate-400">
            Solo la central cierra. Se exige que el técnico haya marcado el servicio como
            terminado, que la verificación esté hecha y que estén las evidencias del formato:
            quien presta el servicio no declara cerrada la evidencia de que existió.
          </p>

          <textarea
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            rows={3}
            className="campo mt-4 resize-none"
            placeholder="Nota de revisión de la central (campo suyo: el técnico no lo escribe)…"
          />
          <button
            className="boton-suave mt-2"
            disabled={revision.trim().length < 3 || guardarRevision.isPending}
            onClick={() => guardarRevision.mutate()}
          >
            Guardar nota de revisión
          </button>

          {cerrar.error && (
            <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {(cerrar.error as Error).message}
            </p>
          )}

          <div className="mt-4">
            <button
              className="boton"
              disabled={cerrado || cerrar.isPending || !control.listoParaCerrar}
              onClick={() => cerrar.mutate()}
              title={control.listoParaCerrar ? 'Cerrar el expediente' : 'Faltan requisitos del formato'}
            >
              {cerrado ? `Cerrado el ${fecha(data.cerradoEn)}` : 'Cerrar expediente'}
            </button>
            {!cerrado && !control.listoParaCerrar && (
              <p className="mt-2 text-xs text-amber-200">
                No se puede cerrar todavía: {control.avisos.join('; ')}.
              </p>
            )}
          </div>
        </section>
      )}

      {cerrado && !esCentral && (
        <section className="vidrio p-6">
          <h3 className="font-medium">Expediente cerrado</h3>
          <p className="mt-1 text-sm text-slate-300">
            Cerrado el {fecha(data.cerradoEn)}. Las evidencias quedan conservadas y una que
            llegue después se acepta, pero queda marcada como posterior al cierre.
          </p>
          {data.revisionCentral && (
            <p className="mt-3 vidrio-suave px-4 py-3 text-sm text-slate-300">
              <span className="text-slate-400">Revisión de la central: </span>
              {data.revisionCentral}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
