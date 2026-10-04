import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  enviar, pedir, sesion,
  type Cliente, type Servicio, type Tablero, type Tecnico, type Vehiculo,
} from '../comun/api';
import { Mapa, ubicacionActual, type Punto } from '../comun/Mapa';
import {
  ESTADOS, ESTADOS_CLIENTE, PASOS, PASOS_CORTOS, TIPOS, fecha, haceCuanto, pasoDe,
} from '../comun/formato';

/** Especialidad que exige cada tipo de servicio. */
const especialidadDe = (tipo: string) =>
  tipo === 'GRUA' ? 'GRUA' : tipo === 'CONDUCTOR_ELEGIDO' ? 'CONDUCTOR' : 'MECANICA';

// ─────────────────────────────────────────────────────────────────────────
/**
 * Selector de ubicacion. Ofrece tomarla del navegador y, si el usuario la
 * niega o esta mal, pulsar el mapa para corregirla. Es opcional a proposito:
 * sin coordenadas se pierde el mapa y el tiempo estimado, nunca el servicio.
 */
function SelectorUbicacion({
  punto,
  alCambiar,
}: {
  punto: Punto | null;
  alCambiar: (p: Punto | null) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [negada, setNegada] = useState(false);

  const tomar = async () => {
    setBuscando(true);
    setNegada(false);
    const p = await ubicacionActual();
    if (p) alCambiar(p);
    else setNegada(true);
    setBuscando(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton-suave" onClick={tomar} disabled={buscando}>
          {buscando ? 'Ubicando…' : '📍 Usar mi ubicación'}
        </button>
        {punto && (
          <>
            <span className="font-mono text-xs text-emerald-300">
              {punto.lat.toFixed(5)}, {punto.lng.toFixed(5)}
            </span>
            <button type="button" className="text-xs text-slate-400 underline" onClick={() => alCambiar(null)}>
              quitar
            </button>
          </>
        )}
      </div>

      {negada && (
        <p className="text-xs text-amber-200">
          No se pudo obtener la ubicación. Puede pulsar el mapa para marcar dónde está, o
          enviar la solicitud solo con la dirección.
        </p>
      )}

      <Mapa destino={punto} alElegir={alCambiar} alto="12rem" etiquetaDestino="Aquí está el vehículo" />
      <p className="text-[11px] text-slate-500">
        Pulse el mapa para marcar el punto exacto. Sirve para enviarle el técnico más cercano.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/**
 * Tablero de asignacion de la central.
 *
 * Es el paso donde nace el expediente. En lugar de una lista desplegable de
 * nombres, muestra quien puede hacer ese trabajo, quien esta libre y a que
 * distancia esta: asignar deja de ser adivinar.
 */
function Clasificar({ servicio, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  const [tipo, setTipo] = useState(servicio.tipoSolicitado ?? 'CARRO_TALLER');
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tablero', servicio.id],
    queryFn: () => pedir<Tablero>(`/tecnicos/tablero?servicioId=${servicio.id}`),
    refetchInterval: 15000,
  });

  const mutar = useMutation({
    mutationFn: () => enviar(`/servicios/${servicio.id}/clasificar`, 'PATCH', { tipo, tecnicoId }),
    onSuccess: alTerminar,
  });

  const requerida = especialidadDe(tipo);
  // El tablero viene ordenado por el servidor, pero la especialidad depende
  // del tipo que la central escoja aqui, asi que se recalcula en pantalla.
  const tecnicos = (data?.tecnicos ?? []).map((t) => ({
    ...t,
    apto: t.especialidades.includes(requerida),
  }));
  const aptos = tecnicos.filter((t) => t.apto);
  const elegido = tecnicos.find((t) => t.id === tecnicoId);

  return (
    <div className="vidrio-suave mt-4 space-y-4 p-4">
      <div>
        <p className="text-sm font-medium">Clasificar y asignar</p>
        <p className="text-xs text-slate-400">
          Confirme el tipo de servicio y elija el técnico. Al asignar nace el expediente.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(TIPOS).map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTipo(k); setTecnicoId(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              tipo === k
                ? 'bg-amber-400/20 font-medium text-amber-200 ring-1 ring-amber-300/40'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {servicio.lat != null && (
        <Mapa
          destino={{ lat: servicio.lat, lng: servicio.lng! }}
          tecnico={elegido?.lat != null ? { lat: elegido.lat, lng: elegido.lng! } : null}
          etiquetaDestino={`${servicio.vehiculo.placa} · ${servicio.direccion}`}
          etiquetaTecnico={elegido?.nombre}
          alto="14rem"
        />
      )}

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          Técnicos con especialidad {requerida.toLowerCase()}
          {isLoading && <span className="ml-2 text-slate-500">cargando…</span>}
        </p>

        {aptos.length === 0 && !isLoading && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Ningún técnico tiene la especialidad {requerida.toLowerCase()}. Revise el tipo de
            servicio o la hoja de vida de los técnicos.
          </p>
        )}

        <ul className="space-y-2">
          {tecnicos.map((t) => {
            const libre = t.disponible && (t.activos ?? 0) === 0;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!t.apto}
                  onClick={() => setTecnicoId(t.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    tecnicoId === t.id
                      ? 'border-amber-300/60 bg-amber-400/15'
                      : t.apto
                        ? 'border-white/10 bg-white/[0.06] hover:bg-white/12'
                        : 'border-white/5 bg-white/[0.02] opacity-50'
                  } ${t.apto ? '' : 'cursor-not-allowed'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {t.nombre}
                        {!t.apto && <span className="ml-2 text-xs text-slate-400">sin la especialidad</span>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {t.especialidades.toLowerCase().split(',').join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {t.distanciaKm !== null ? (
                        <span className="etiqueta border border-sky-300/30 bg-sky-400/15 text-sky-200">
                          {t.distanciaKm} km · {t.minutosEstimados} min
                        </span>
                      ) : (
                        <span className="text-slate-500" title="El técnico no ha reportado su ubicación">
                          sin ubicación
                        </span>
                      )}
                      <span
                        className={`etiqueta ${
                          libre
                            ? 'border border-emerald-300/30 bg-emerald-400/20 text-emerald-200'
                            : t.disponible
                              ? 'border border-amber-300/30 bg-amber-400/15 text-amber-200'
                              : 'border border-slate-300/20 bg-slate-400/10 text-slate-400'
                        }`}
                      >
                        {libre ? 'Libre' : t.disponible ? `${t.activos} en curso` : 'No disponible'}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}

      <button className="boton" disabled={!tecnicoId || mutar.isPending} onClick={() => mutar.mutate()}>
        {mutar.isPending ? 'Asignando…' : 'Asignar y abrir expediente'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Cancelar o rechazar: las dos exigen motivo, y por eso comparten el panel. */
function ConMotivo({
  servicio,
  accion,
  alTerminar,
}: {
  servicio: Servicio;
  accion: 'cancelar' | 'rechazar';
  alTerminar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const mutar = useMutation({
    mutationFn: () => enviar(`/servicios/${servicio.id}/${accion}`, 'PATCH', { motivo }),
    onSuccess: alTerminar,
  });

  const esRechazo = accion === 'rechazar';

  return (
    <div className="vidrio-suave mt-3 space-y-2 p-4">
      <p className="text-sm font-medium">{esRechazo ? 'No aceptar la solicitud' : 'Cancelar servicio'}</p>
      <p className="text-xs text-slate-400">
        {esRechazo
          ? 'La solicitud queda registrada como no aceptada, con su motivo: el historial de lo que no se atendió también es trazabilidad.'
          : 'La cancelación exige un motivo: así queda la trazabilidad.'}
      </p>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="campo"
        placeholder={esRechazo ? 'Motivo del rechazo' : 'Motivo de la cancelación'}
      />
      {mutar.error && <p className="text-xs text-rose-300">{(mutar.error as Error).message}</p>}
      <button className="boton-suave" disabled={motivo.length < 5 || mutar.isPending} onClick={() => mutar.mutate()}>
        {esRechazo ? 'Confirmar rechazo' : 'Confirmar cancelación'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Barra de avance del servicio, para que el cliente sepa en que va. */
function Avance({ estado }: { estado: string }) {
  const actual = pasoDe(estado);
  if (actual < 0) return null; // cancelado o rechazado: no hay avance que mostrar

  return (
    // Cada tramo lleva su rotulo debajo: una barra sin texto obliga a pasar el
    // raton por encima para saber en que va, y en un telefono no hay raton.
    <ol className="flex items-start gap-1">
      {PASOS.map((p, i) => (
        <li key={p} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div
            className={`h-1.5 w-full rounded-full ${
              i <= actual ? 'bg-gradient-to-r from-amber-400 to-amber-200' : 'bg-white/10'
            }`}
            title={ESTADOS_CLIENTE[p]}
          />
          <span
            className={`truncate text-[11px] leading-tight ${
              i === actual
                ? 'font-medium text-amber-200'
                : i < actual
                  ? 'text-slate-400'
                  : 'text-slate-600'
            }`}
          >
            {PASOS_CORTOS[p]}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Lo que el cliente ve mientras espera: quien va, donde esta, cuanto falta.
 * Es la pantalla que evita la llamada de "¿ya viene?".
 */
function SeguimientoCliente({ servicio }: { servicio: Servicio }) {
  const t = servicio.tecnico;
  const destino = servicio.lat != null ? { lat: servicio.lat, lng: servicio.lng! } : null;
  const puntoTecnico = t?.lat != null ? { lat: t.lat, lng: t.lng! } : null;
  const s = servicio.seguimiento;

  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Su técnico</p>
          <p className="text-sm font-medium">{t?.nombre ?? 'Por asignar'}</p>
          {t?.telefono && <p className="text-xs text-slate-400">{t.telefono}</p>}
        </div>

        {s.minutosEstimados !== null && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Llega en</p>
            <p className="text-2xl font-semibold text-amber-300">~{s.minutosEstimados} min</p>
            <p className="text-[11px] text-slate-400">
              {s.origenDelTiempo === 'tecnico'
                ? `informado por el técnico ${haceCuanto(s.informadoEn)}`
                : 'estimado por la distancia'}
              {s.distanciaKm !== null && ` · ${s.distanciaKm} km`}
            </p>
          </div>
        )}
      </div>

      {(destino || puntoTecnico) && (
        <>
          <Mapa
            destino={destino}
            tecnico={puntoTecnico}
            etiquetaDestino={`Su vehículo · ${servicio.vehiculo.placa}`}
            etiquetaTecnico={t?.nombre ?? 'Técnico'}
            alto="15rem"
          />
          {puntoTecnico && (
            <p className="text-[11px] text-slate-500">
              Posición del técnico actualizada {haceCuanto(t?.ubicacionEn)}. La línea punteada es
              la distancia directa, no la ruta por calles.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Acciones del tecnico en campo: ubicacion, tiempo de llegada y avance. */
function AccionesTecnico({ servicio, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  const [minutos, setMinutos] = useState(String(servicio.etaMinutos ?? ''));
  const [aviso, setAviso] = useState('');

  const informar = useMutation({
    mutationFn: async () => {
      // Se manda la ubicacion junto con el tiempo si el equipo la da: es el
      // momento en que el tecnico esta mirando la pantalla, asi que es la
      // mejor oportunidad para refrescar su posicion en el mapa del cliente.
      const p = await ubicacionActual();
      return enviar(`/servicios/${servicio.id}/eta`, 'PATCH', {
        minutos: Number(minutos),
        ...(p ?? {}),
      });
    },
    onSuccess: () => { setAviso('Tiempo informado al cliente.'); alTerminar(); },
  });

  const avanzar = useMutation({
    mutationFn: (estado: string) => enviar(`/servicios/${servicio.id}/estado`, 'PATCH', { estado }),
    onSuccess: alTerminar,
  });

  const puedeInformar = servicio.estado === 'ASIGNADO';

  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
      {puedeInformar && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">¿En cuántos minutos llega?</label>
            <input
              value={minutos}
              onChange={(e) => setMinutos(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="campo w-28 text-center font-mono"
              inputMode="numeric"
              placeholder="15"
            />
          </div>
          <button
            className="boton-suave"
            disabled={!minutos || informar.isPending}
            onClick={() => informar.mutate()}
            title="Le avisa al cliente y actualiza su posición en el mapa"
          >
            {informar.isPending ? 'Enviando…' : 'Informar al cliente'}
          </button>
        </div>
      )}

      {aviso && <p className="text-xs text-emerald-300">{aviso}</p>}
      {informar.error && <p className="text-xs text-rose-300">{(informar.error as Error).message}</p>}
      {avanzar.error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {(avanzar.error as Error).message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {servicio.estado === 'ASIGNADO' && (
          <button className="boton" onClick={() => avanzar.mutate('EN_EJECUCION')}>
            Llegué: iniciar atención
          </button>
        )}
        {servicio.estado === 'EN_EJECUCION' && (
          <>
            {servicio.expediente && (
              <Link to={`/expedientes/${servicio.expediente.id}`} className="boton">
                Diligenciar expediente
              </Link>
            )}
            <button className="boton-suave" onClick={() => avanzar.mutate('TERMINADO')}>
              Marcar terminado
            </button>
          </>
        )}
      </div>

      {servicio.estado === 'EN_EJECUCION' && (
        <p className="text-[11px] text-slate-500">
          Para terminar hace falta registrar si quien entrega es el propietario y subir las
          evidencias del formato. El cierre lo hace la central.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Solicitud del servicio: la hace el cliente, o la central por telefono. */
function Solicitar({ alTerminar }: { alTerminar: () => void }) {
  const rol = sesion.rol();
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [clienteId, setClienteId] = useState('');
  const [form, setForm] = useState({
    vehiculoId: '', tipoSolicitado: 'CARRO_TALLER', direccion: '', descripcion: '', contactoTelefono: '',
  });
  const [punto, setPunto] = useState<Punto | null>(null);

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });
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
        vehiculoId: Number(form.vehiculoId),
        tipoSolicitado: form.tipoSolicitado,
        direccion: form.direccion,
        descripcion: form.descripcion,
        ...(form.contactoTelefono ? { contactoTelefono: form.contactoTelefono } : {}),
        ...(punto ?? {}),
      }),
    onSuccess: alTerminar,
  });

  const completo =
    form.vehiculoId && form.direccion.length >= 5 && form.descripcion.length >= 5 &&
    (!esCentral || clienteId);

  return (
    <div className="vidrio space-y-3 p-5">
      <div>
        <p className="font-medium">Solicitar un servicio</p>
        <p className="text-xs text-slate-400">
          Solo se pide lo que usted sabe ahora. Los datos de la tarjeta de propiedad los toma
          el técnico en el sitio: no hace falta buscarlos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {esCentral && (
          <select
            value={clienteId}
            onChange={(e) => { setClienteId(e.target.value); setForm({ ...form, vehiculoId: '' }); }}
            className="campo sm:col-span-2"
          >
            <option value="" className="bg-slate-800">Cliente…</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-800">
                {c.nombre} · {c.documento}
              </option>
            ))}
          </select>
        )}

        <select
          value={form.vehiculoId}
          onChange={(e) => setForm({ ...form, vehiculoId: e.target.value })}
          className="campo"
        >
          <option value="" className="bg-slate-800">Vehículo…</option>
          {suyos.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-800">
              {v.placa} · {v.marca} {v.modelo}
            </option>
          ))}
        </select>

        <select
          value={form.tipoSolicitado}
          onChange={(e) => setForm({ ...form, tipoSolicitado: e.target.value })}
          className="campo"
          title="Qué cree que necesita; la central lo confirma"
        >
          {Object.entries(TIPOS).map(([k, v]) => (
            <option key={k} value={k} className="bg-slate-800">{v}</option>
          ))}
        </select>
      </div>

      {esCentral && !clienteId && (
        <p className="text-xs text-slate-400">Elija primero el cliente para ver sus vehículos.</p>
      )}
      {!esCentral && vehiculos?.length === 0 && (
        <p className="text-xs text-amber-200">
          Todavía no tiene vehículos registrados.{' '}
          <Link to="/vehiculos" className="underline hover:text-amber-100">Registre uno primero</Link>:
          sin vehículo no hay servicio.
        </p>
      )}

      <input
        value={form.direccion}
        onChange={(e) => setForm({ ...form, direccion: e.target.value })}
        className="campo"
        placeholder="¿Dónde está el vehículo? Dirección o punto de referencia"
      />
      <textarea
        value={form.descripcion}
        onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
        className="campo min-h-[80px] resize-none"
        placeholder="¿Qué ocurrió? Por ejemplo: no enciende, se quedaron las llaves adentro, llanta averiada…"
      />
      <input
        value={form.contactoTelefono}
        onChange={(e) => setForm({ ...form, contactoTelefono: e.target.value })}
        className="campo"
        placeholder="Teléfono de contacto (opcional: si no, usamos el de su ficha)"
      />

      <SelectorUbicacion punto={punto} alCambiar={setPunto} />

      {mutar.error && <p className="text-sm text-rose-300">{(mutar.error as Error).message}</p>}

      <button className="boton" disabled={!completo || mutar.isPending} onClick={() => mutar.mutate()}>
        {mutar.isPending ? 'Enviando…' : 'Enviar solicitud a la central'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export function Servicios() {
  const cola = useQueryClient();
  const rol = sesion.rol();
  const esCliente = rol === 'CLIENTE';
  const esTecnico = rol === 'TECNICO';
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [abierto, setAbierto] = useState<number | null>(null);
  const [conMotivo, setConMotivo] = useState<{ id: number; accion: 'cancelar' | 'rechazar' } | null>(null);
  const [solicitando, setSolicitando] = useState(false);
  const [ok, setOk] = useState('');
  const [pestana, setPestana] = useState<'pendientes' | 'progreso' | 'historial'>('pendientes');

  const { data, isLoading, error } = useQuery({
    queryKey: ['servicios'],
    queryFn: () => pedir<Servicio[]>('/servicios'),
    // El cliente y el tecnico ven cambios que provoca el otro, asi que la
    // lista se refresca sola: nadie tiene que recargar para ver el avance.
    refetchInterval: 15000,
  });

  const { data: ficha } = useQuery({
    queryKey: ['tecnicoYo'],
    queryFn: () => pedir<Tecnico>('/tecnicos/yo'),
    enabled: esTecnico,
  });

  const cambiarDisponibilidad = useMutation({
    mutationFn: (disponible: boolean) =>
      enviar<Tecnico>('/tecnicos/yo/disponibilidad', 'PATCH', { disponible }),
    onSuccess: () => {
      cola.invalidateQueries({ queryKey: ['tecnicoYo'] });
      cola.invalidateQueries({ queryKey: ['tecnicos'] });
    },
  });

  const reportarUbicacion = useMutation({
    mutationFn: async () => {
      const p = await ubicacionActual();
      if (!p) throw new Error('No se pudo obtener la ubicación. Revise el permiso del navegador.');
      return enviar('/tecnicos/yo/ubicacion', 'PATCH', p);
    },
    onSuccess: () => {
      setOk('Ubicación actualizada. La central y el cliente ya la ven.');
      cola.invalidateQueries({ queryKey: ['tecnicoYo'] });
      cola.invalidateQueries({ queryKey: ['servicios'] });
    },
  });

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['servicios'] });
    cola.invalidateQueries({ queryKey: ['indicadores'] });
    cola.invalidateQueries({ queryKey: ['notificaciones'] });
    cola.invalidateQueries({ queryKey: ['tablero'] });
    setAbierto(null);
    setConMotivo(null);
  };

  const porPestana = (s: Servicio) =>
    pestana === 'pendientes' ? s.estado === 'ASIGNADO'
    : pestana === 'progreso' ? s.estado === 'EN_EJECUCION'
    : ['TERMINADO', 'CERRADO', 'CANCELADO', 'RECHAZADO'].includes(s.estado);
  const lista = esTecnico ? (data ?? []).filter(porPestana) : (data ?? []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {esCliente ? 'Mis servicios' : 'Gestionar servicio'}
        </h2>
        <p className="text-sm text-slate-400">
          {esTecnico
            ? 'Sus asignados, su historial y su disponibilidad para la central.'
            : esCliente
              ? 'Siga el estado de sus solicitudes y vea por dónde va el técnico.'
              : 'El cliente solicita, la central clasifica y asigna, y con eso nace el expediente.'}
        </p>
      </div>

      {esTecnico && (
        <section className="vidrio flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Mi disponibilidad</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {ficha ? (
                <span className={`etiqueta ${ficha.disponible ? 'border border-emerald-300/40 bg-emerald-400/15 text-emerald-200' : 'border border-amber-300/40 bg-amber-400/15 text-amber-200'}`}>
                  {ficha.disponible ? 'Disponible para asignar' : 'Ocupado en servicio'}
                </span>
              ) : (
                <span className="text-slate-500">Cargando…</span>
              )}
              <span className="text-xs text-slate-400">
                Ubicación: {ficha?.ubicacionEn ? haceCuanto(ficha.ubicacionEn) : 'sin reportar'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="boton-suave"
              disabled={reportarUbicacion.isPending}
              onClick={() => { setOk(''); reportarUbicacion.mutate(); }}
              title="La central la usa para enviarle el servicio más cercano"
            >
              {reportarUbicacion.isPending ? 'Ubicando…' : '📍 Reportar mi ubicación'}
            </button>
            <button
              className="boton-suave"
              disabled={!ficha || cambiarDisponibilidad.isPending}
              onClick={() => ficha && cambiarDisponibilidad.mutate(!ficha.disponible)}
            >
              {ficha?.disponible ? 'Marcarme ocupado' : 'Marcarme disponible'}
            </button>
          </div>
        </section>
      )}

      {reportarUbicacion.error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {(reportarUbicacion.error as Error).message}
        </p>
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
              : ['TERMINADO', 'CERRADO', 'CANCELADO', 'RECHAZADO'].includes(s.estado),
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

      {(esCliente || esCentral) && (
        <div className="space-y-3">
          <button className="boton" onClick={() => { setSolicitando(!solicitando); setOk(''); }}>
            {solicitando
              ? 'Cerrar formulario'
              : esCentral ? 'Solicitar servicio (llamada del cliente)' : '+ Solicitar nuevo servicio'}
          </button>
          {solicitando && (
            <Solicitar
              alTerminar={() => {
                setSolicitando(false);
                setOk('Solicitud enviada. La central la está verificando y le asignará un técnico.');
                refrescar();
              }}
            />
          )}
        </div>
      )}

      {ok && (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {ok}
        </p>
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-rose-300">{(error as Error).message}</p>}

      <div className="space-y-4">
        {lista.map((s) => (
          <article key={s.id} className="vidrio p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>
                    {esCliente ? ESTADOS_CLIENTE[s.estado] ?? s.estado : ESTADOS[s.estado]?.texto ?? s.estado}
                  </span>
                  {s.tipo && (
                    <span className="etiqueta border border-white/20 bg-white/10 text-slate-200">
                      {TIPOS[s.tipo]}
                    </span>
                  )}
                  {!s.tipo && s.tipoSolicitado && (
                    <span
                      className="etiqueta border border-dashed border-sky-300/40 bg-sky-400/10 text-sky-200"
                      title="Lo que el cliente cree necesitar; la central confirma al clasificar"
                    >
                      Solicitado: {TIPOS[s.tipoSolicitado] ?? s.tipoSolicitado}
                    </span>
                  )}
                  {s.expediente?.esPropietario === false && (
                    <span
                      className="etiqueta border border-amber-300/40 bg-amber-400/20 text-amber-200"
                      title="Quien entregó el vehículo no es el propietario"
                    >
                      ⚠️ No propietario
                    </span>
                  )}
                  {s.expediente && (
                    <Link
                      to={`/expedientes/${s.expediente.id}`}
                      className="etiqueta border border-amber-300/40 bg-amber-400/15 font-mono text-amber-200 hover:bg-amber-400/25"
                    >
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

            {esCliente && <div className="mt-4"><Avance estado={s.estado} /></div>}

            {!esCliente && (
              <div className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-sm sm:grid-cols-3">
                <p><span className="text-slate-400">Cliente:</span> {s.cliente.nombre}</p>
                <p><span className="text-slate-400">Contacto:</span> {s.contactoTelefono ?? s.cliente.telefono}</p>
                <p><span className="text-slate-400">Técnico:</span> {s.tecnico?.nombre ?? 'sin asignar'}</p>
              </div>
            )}

            {s.motivoCancelacion && (
              <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                Cancelado: {s.motivoCancelacion}
              </p>
            )}
            {s.motivoRechazo && (
              <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                No aceptado: {s.motivoRechazo}
              </p>
            )}

            {/* El cliente ve el seguimiento mientras el servicio esta vivo. */}
            {esCliente && ['ASIGNADO', 'EN_EJECUCION'].includes(s.estado) && (
              <SeguimientoCliente servicio={s} />
            )}

            {esTecnico && ['ASIGNADO', 'EN_EJECUCION'].includes(s.estado) && (
              <AccionesTecnico servicio={s} alTerminar={refrescar} />
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {esCentral && s.estado === 'SOLICITADO' && (
                <>
                  <button className="boton" onClick={() => setAbierto(abierto === s.id ? null : s.id)}>
                    {abierto === s.id ? 'Cerrar tablero' : 'Clasificar y asignar'}
                  </button>
                  <button
                    className="boton-suave"
                    onClick={() => setConMotivo(conMotivo?.id === s.id ? null : { id: s.id, accion: 'rechazar' })}
                  >
                    No aceptar
                  </button>
                </>
              )}
              {s.expediente && (esCentral || esCliente) && (
                <Link to={`/expedientes/${s.expediente.id}`} className="boton-suave">
                  Ver expediente
                </Link>
              )}
              {esCentral && !['CERRADO', 'CANCELADO', 'RECHAZADO'].includes(s.estado) && (
                <button
                  className="boton-suave"
                  onClick={() => setConMotivo(conMotivo?.id === s.id ? null : { id: s.id, accion: 'cancelar' })}
                >
                  Cancelar
                </button>
              )}
            </div>

            {abierto === s.id && <Clasificar servicio={s} alTerminar={refrescar} />}
            {conMotivo?.id === s.id && (
              <ConMotivo servicio={s} accion={conMotivo.accion} alTerminar={refrescar} />
            )}
          </article>
        ))}

        {lista.length === 0 && !isLoading && (
          <p className="vidrio p-6 text-sm text-slate-400">
            {esTecnico
              ? pestana === 'historial'
                ? 'Aún no tiene servicios realizados.'
                : 'No tiene servicios en este estado.'
              : esCliente
                ? 'Todavía no ha solicitado ningún servicio.'
                : 'No hay servicios para mostrar.'}
          </p>
        )}
      </div>
    </div>
  );
}
