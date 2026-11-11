/**
 * Tablero de tecnicos de la central.
 *
 * Esta en columnas por situacion —libres, ocupados y no disponibles— porque lo
 * que la central necesita contestar a las 2 a.m. no es "quien existe" sino "a
 * quien le puedo mandar esto ahora". Una cuadricula de tarjetas iguales obliga
 * a leerlas todas; en columnas, la respuesta esta en la primera.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { enviar, pedir, sesion, type Tecnico } from '../comun/api';
import { Mapa } from '../comun/Mapa';
import { ESTADOS, haceCuanto } from '../comun/formato';
import { useState } from 'react';

const ESPECIALIDADES = [
  ['MECANICA', 'Mecánica'],
  ['CERRAJERIA', 'Cerrajería'],
  ['GRUA', 'Grúa'],
  ['CONDUCTOR', 'Conductor elegido'],
] as const;

const Ficha = ({ t }: { t: Tecnico }) => (
  <article className="vidrio-suave p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="truncate font-medium">{t.nombre}</h4>
        <p className="font-mono text-xs text-tinta-tenue">{t.documento}</p>
      </div>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-lg text-dato">{t.activos ?? 0}</span>
        <span className="block text-[10px] uppercase text-tinta-sutil">en curso</span>
      </span>
    </div>

    <div className="mt-3 flex flex-wrap gap-1.5">
      {t.especialidades.split(',').map((e) => (
        <span key={e} className="etiqueta border border-dato/30 bg-dato-fondo/15 text-dato">
          {e.toLowerCase()}
        </span>
      ))}
    </div>

    <dl className="mt-3 space-y-1 text-sm text-tinta-suave">
      <div className="flex justify-between">
        <dt className="text-tinta-tenue">Teléfono</dt>
        <dd>{t.telefono}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-tinta-tenue">Licencia</dt>
        <dd>{t.licencia ?? '—'}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-tinta-tenue">Ubicación</dt>
        <dd className={t.ubicacionEn ? '' : 'text-tinta-sutil'}>
          {t.ubicacionEn ? haceCuanto(t.ubicacionEn) : 'sin reportar'}
        </dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-tinta-tenue">Atendidos</dt>
        <dd>{t._count?.servicios ?? 0}</dd>
      </div>
    </dl>

    {/* Lo que tiene encima ahora: sin esto, "2 en curso" no dice que son. */}
    {(t.enCurso?.length ?? 0) > 0 && (
      <ul className="mt-3 space-y-1 border-t border-velo/10 pt-2">
        {t.enCurso!.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono text-marca">{s.vehiculo.placa}</span>
            <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
              {ESTADOS[s.estado]?.texto ?? s.estado}
            </span>
          </li>
        ))}
      </ul>
    )}
  </article>
);

const Columna = ({
  titulo,
  descripcion,
  color,
  lista,
}: {
  titulo: string;
  descripcion: string;
  color: string;
  lista: Tecnico[];
}) => (
  <section className="vidrio p-4">
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <div>
        <h3 className={`font-medium ${color}`}>{titulo}</h3>
        <p className="text-xs text-tinta-sutil">{descripcion}</p>
      </div>
      <span className="font-mono text-2xl text-tinta-suave">{lista.length}</span>
    </div>
    <div className="space-y-3">
      {lista.map((t) => <Ficha key={t.id} t={t} />)}
      {lista.length === 0 && <p className="py-4 text-center text-sm text-tinta-sutil">Ninguno.</p>}
    </div>
  </section>
);

export function Tecnicos() {
  const cola = useQueryClient();
  const esAdministrador = sesion.rol() === 'ADMINISTRADOR';
  const [editando, setEditando] = useState<Tecnico | null>(null);
  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [formulario, setFormulario] = useState({
    documento: '', nombre: '', telefono: '', correo: '', especialidades: [] as string[], licencia: '',
  });
  const [verificacionId, setVerificacionId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [credenciales, setCredenciales] = useState<{ usuario: string; contraseñaInicial: string; correo: string } | null>(null);
  // Se refresca sola: si un técnico cambia su disponibilidad o reporta su
  // ubicación, la central lo ve en segundos sin recargar.
  const { data, isLoading, error } = useQuery({
    queryKey: ['tecnicos'],
    queryFn: () => pedir<Tecnico[]>('/tecnicos'),
    refetchInterval: 15000,
  });

  const guardar = useMutation({
    mutationFn: async () => {
      if (editando) {
        return enviar<Tecnico>(`/tecnicos/${editando.id}`, 'PUT', {
          ...formulario, especialidades: formulario.especialidades.join(','),
        });
      }
      if (!verificacionId) {
        const r = await enviar<{ verificacionId: string }>('/tecnicos/iniciar', 'POST', {
          ...formulario, especialidades: formulario.especialidades.join(','),
        });
        setVerificacionId(r.verificacionId);
        return null;
      }
      const r = await enviar<{ tecnico: Tecnico; credenciales: { usuario: string; contraseñaInicial: string; correo: string } }>(
        '/tecnicos/confirmar', 'POST', { verificacionId, codigo },
      );
      setCredenciales(r.credenciales);
      return r.tecnico;
    },
    onSuccess: (resultado) => {
      if (!resultado) return;
      setEditando(null);
      setFormularioAbierto(false);
      cola.invalidateQueries({ queryKey: ['tecnicos'] });
    },
  });
  const archivar = useMutation({
    mutationFn: (id: number) => enviar(`/tecnicos/${id}/archivar`, 'PATCH'),
    onSuccess: () => cola.invalidateQueries({ queryKey: ['tecnicos'] }),
  });

  const abrirFormulario = (tecnico?: Tecnico) => {
    setFormularioAbierto(true);
    setEditando(tecnico ?? null);
    setVerificacionId('');
    setCodigo('');
    setCredenciales(null);
    setFormulario(tecnico
      ? {
          documento: tecnico.documento, nombre: tecnico.nombre, telefono: tecnico.telefono, correo: '',
          especialidades: tecnico.especialidades.split(',').filter(Boolean), licencia: tecnico.licencia ?? '',
        }
      : { documento: '', nombre: '', telefono: '', correo: '', especialidades: [], licencia: '' });
  };

  const lista = data ?? [];
  const libres = lista.filter((t) => t.disponible && (t.activos ?? 0) === 0);
  const ocupados = lista.filter((t) => t.disponible && (t.activos ?? 0) > 0);
  const fuera = lista.filter((t) => !t.disponible);
  const ubicados = lista.filter((t) => t.lat != null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Tablero de técnicos</h2>
          <p className="text-sm text-tinta-tenue">
            Quién puede atender ahora. La disponibilidad y la ubicación las reporta cada técnico
            y se actualizan solas cada 15 segundos.
          </p>
        </div>
        <div className="flex gap-2">
          {esAdministrador && (
            <button className="boton" onClick={() => abrirFormulario()}>
              Crear técnico
            </button>
          )}
          <Link to="/servicios" className="boton-suave">Ir a asignar servicios →</Link>
        </div>
      </div>

      {esAdministrador && formularioAbierto && (
        <section className="vidrio space-y-3 p-5">
          <h3 className="font-medium">{editando ? 'Actualizar técnico' : 'Crear técnico'}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className="campo" placeholder="Documento" value={formulario.documento}
              onChange={(e) => setFormulario({ ...formulario, documento: e.target.value })} />
            <input className="campo" placeholder="Nombre completo" value={formulario.nombre}
              onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} />
            <input className="campo" placeholder="Teléfono" value={formulario.telefono}
              onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })} />
            {!editando && <input className="campo" type="email" placeholder="Correo del técnico" value={formulario.correo}
              onChange={(e) => setFormulario({ ...formulario, correo: e.target.value })} />}
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm text-slate-400">Especialidades</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ESPECIALIDADES.map(([valor, etiqueta]) => (
                  <label key={valor} className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={formulario.especialidades.includes(valor)}
                      onChange={(e) => setFormulario({
                        ...formulario,
                        especialidades: e.target.checked
                          ? [...formulario.especialidades, valor]
                          : formulario.especialidades.filter((especialidad) => especialidad !== valor),
                      })}
                    />
                    {etiqueta}
                  </label>
                ))}
              </div>
            </fieldset>
            <input className="campo" placeholder="Licencia (opcional)" value={formulario.licencia}
              onChange={(e) => setFormulario({ ...formulario, licencia: e.target.value })} />
          </div>
          {!editando && verificacionId && (
            <div className="space-y-2 rounded-lg border border-sky-300/30 bg-sky-400/10 p-3">
              <p className="text-sm text-sky-100">Ingrese el código enviado al correo del técnico.</p>
              <input className="campo text-center font-mono tracking-widest" inputMode="numeric" maxLength={6}
                value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            </div>
          )}
          {guardar.error && <p className="text-sm text-rose-300">{(guardar.error as Error).message}</p>}
          <div className="flex gap-2">
            <button className="boton" disabled={guardar.isPending ||
              formulario.documento.length < 5 || formulario.nombre.length < 3 ||
              formulario.telefono.length < 7 || formulario.especialidades.length === 0 ||
              (!editando && (!formulario.correo.includes('@') || (!!verificacionId && codigo.length !== 6)))}
              onClick={() => guardar.mutate()}>
              {guardar.isPending ? 'Procesando…' : editando ? 'Guardar cambios' : verificacionId ? 'Verificar y crear técnico' : 'Enviar código de verificación'}
            </button>
            <button className="boton-suave" onClick={() => { setEditando(null); setFormularioAbierto(false); setVerificacionId(''); setCodigo(''); setFormulario({ documento: '', nombre: '', telefono: '', correo: '', especialidades: [], licencia: '' }); }}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}
      {credenciales && (
        <section className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
          <p className="font-medium">Técnico creado. Entregue estas credenciales de forma segura:</p>
          <p>Usuario: <strong>{credenciales.usuario}</strong></p>
          <p>Contraseña temporal: <strong>{credenciales.contraseñaInicial}</strong></p>
          <p>Correo verificado: {credenciales.correo}</p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="vidrio p-5">
          <p className="text-xs uppercase tracking-wide text-tinta-tenue">Libres ahora</p>
          <p className="mt-1 text-3xl font-semibold text-exito">{libres.length}</p>
          <p className="mt-1 text-xs text-tinta-tenue">de {lista.length} técnicos</p>
        </div>
        <div className="vidrio p-5">
          <p className="text-xs uppercase tracking-wide text-tinta-tenue">En servicio</p>
          <p className="mt-1 text-3xl font-semibold text-marca">{ocupados.length}</p>
          <p className="mt-1 text-xs text-tinta-tenue">
            {ocupados.reduce((n, t) => n + (t.activos ?? 0), 0)} atenciones en curso
          </p>
        </div>
        <div className="vidrio p-5">
          <p className="text-xs uppercase tracking-wide text-tinta-tenue">Con ubicación</p>
          <p className="mt-1 text-3xl font-semibold text-dato">{ubicados.length}</p>
          <p className="mt-1 text-xs text-tinta-tenue">se les puede calcular cercanía</p>
        </div>
      </div>

      {/* Un solo mapa con todos los que reportaron posicion: de un vistazo se
          ve si hay alguien por la zona antes de abrir el servicio. */}
      {ubicados.length > 0 && (
        <section className="vidrio p-5">
          <h3 className="mb-1 font-medium">Dónde están</h3>
          <p className="mb-3 text-xs text-tinta-sutil">
            Para calcular la cercanía a un servicio concreto, ábralo en «Gestionar servicio» y
            use el tablero de asignación.
          </p>
          {/* Todos, no solo el primero: la seccion se llama «Donde estan». */}
          <Mapa
            tecnicos={ubicados.map((t) => ({ lat: t.lat!, lng: t.lng!, etiqueta: t.nombre }))}
            alto="20rem"
          />
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ubicados.map((t) => (
              <li key={t.id} className="vidrio-suave flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">{t.nombre}</span>
                <span className="font-mono text-[11px] text-tinta-tenue">
                  {t.lat!.toFixed(4)}, {t.lng!.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Columna
          titulo="Libres"
          descripcion="Disponibles y sin nada en curso"
          color="text-exito"
          lista={libres}
        />
        <Columna
          titulo="En servicio"
          descripcion="Disponibles pero con trabajo encima"
          color="text-marca"
          lista={ocupados}
        />
        <Columna
          titulo="No disponibles"
          descripcion="Se marcaron como ocupados o fuera de turno"
          color="text-tinta-suave"
          lista={fuera}
        />
      </div>

      {esAdministrador && lista.length > 0 && (
        <section className="vidrio p-5">
          <h3 className="mb-3 font-medium">Administrar fichas</h3>
          <div className="space-y-2">
            {lista.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2 text-sm">
                <span>{t.nombre} <span className="text-slate-500">· {t.especialidades}</span></span>
                <div className="flex gap-2">
                  <button className="boton-suave" onClick={() => abrirFormulario(t)}>Actualizar</button>
                  <button className="rounded-lg border border-rose-400/30 px-3 py-2 text-rose-200 disabled:opacity-50"
                    disabled={archivar.isPending}
                    onClick={() => archivar.mutate(t.id)}>
                    Archivar
                  </button>
                </div>
              </div>
            ))}
          </div>
          {archivar.error && <p className="mt-3 text-sm text-rose-300">{(archivar.error as Error).message}</p>}
        </section>
      )}
    </div>
  );
}
