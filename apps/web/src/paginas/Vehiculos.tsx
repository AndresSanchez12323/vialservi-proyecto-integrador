import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { enviar, leerTarjeta, pedir, sesion, type Cliente, type DatosTarjeta, type Vehiculo } from '../comun/api';
import { MAX_VEHICULOS_CLIENTE } from '../comun/formato';
import { avisoError, avisoExito, confirmar } from '../comun/avisos';

type ClienteYo = Cliente & { vehiculos: Vehiculo[] };

function LeerTarjeta({ alLeer }: { alLeer: (datos: DatosTarjeta) => void }) {
  const [cargando, setCargando] = useState(false);

  return (
    <div className="space-y-2 sm:col-span-2">
      <input
        id="foto-tarjeta"
        type="file"
        accept="image/jpeg"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const archivo = e.target.files?.[0];
          e.target.value = '';
          if (!archivo) return;
          setCargando(true);
          try {
            alLeer(await leerTarjeta(archivo));
            avisoExito('Revise los datos y corrija lo que haga falta antes de guardar.', 'Tarjeta leida');
          } catch (e) {
            avisoError(e, 'No se pudo leer la tarjeta');
          } finally {
            setCargando(false);
          }
        }}
      />
      <label htmlFor="foto-tarjeta" className="boton-suave inline-flex cursor-pointer">
        {cargando ? 'Leyendo tarjeta…' : '📷 Tomar foto de la tarjeta de propiedad'}
      </label>
      <p className="text-xs text-slate-400">
        La foto se procesa con Amazon Textract y los datos quedan editables antes de guardar.
      </p>
    </div>
  );
}

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
  const completar = (datos: DatosTarjeta) => {
    setPlaca(datos.placa);
    setMarca(datos.marca);
    setModelo(datos.modelo);
    setColor(datos.color);
  };

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });

  const mutar = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', {
        placa, marca, modelo, color,
        ...(esCentral ? { clienteId } : {}),
      }),
    onSuccess: (v) => {
      avisoExito(`${v.placa} quedo registrado y ya se puede usar en un servicio.`, 'Vehiculo registrado');
      alTerminar();
    },
    onError: (e) => avisoError(e, 'No se pudo registrar el vehiculo'),
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LeerTarjeta alLeer={completar} />
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
          maxLength={6}
        />
        <input value={marca} onChange={(e) => setMarca(e.target.value)} className="campo" placeholder="Marca" />
        <input value={modelo} onChange={(e) => setModelo(e.target.value)} className="campo" placeholder="Línea o modelo" />
        <input value={color} onChange={(e) => setColor(e.target.value)} className="campo" placeholder="Color" />
      </div>

      <button className="boton" disabled={!completo || mutar.isPending} onClick={() => mutar.mutate()}>
        {mutar.isPending ? 'Guardando…' : 'Registrar vehículo'}
      </button>
    </div>
  );
}

export function Vehiculos() {
  const cola = useQueryClient();
  const navegar = useNavigate();
  const rol = sesion.rol();
  const esCliente = rol === 'CLIENTE';
  const [placa, setPlaca] = useState('');
  const [registrando, setRegistrando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehiculos', placa],
    queryFn: () => pedir<Vehiculo[]>(`/vehiculos?placa=${encodeURIComponent(placa)}`),
  });

  // Ficha propia del cliente: de aquí sale el clienteId para crear
  // vehículos, sin que lo digite.
  const { data: yo } = useQuery({
    queryKey: ['clienteYo'],
    queryFn: () => pedir<ClienteYo>('/clientes/yo'),
    enabled: esCliente,
  });

  const [formV, setFormV] = useState({ placa: '', marca: '', modelo: '', color: '' });
  const completar = (datos: DatosTarjeta) => setFormV((anterior) => ({ ...anterior, ...datos }));

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['vehiculos'] });
    cola.invalidateQueries({ queryKey: ['clienteYo'] });
  };

  const crearVehiculo = useMutation({
    mutationFn: () => enviar<Vehiculo>('/vehiculos', 'POST', { ...formV, clienteId: yo?.id }),
    onSuccess: async (v) => {
      setFormV({ placa: '', marca: '', modelo: '', color: '' });
      refrescar();
      // Registrar un vehiculo casi siempre es el paso previo a pedir algo,
      // asi que se ofrece el atajo en vez de dejarlo buscar el formulario.
      const ir = await confirmar({
        titulo: `${v.placa} quedo registrado`,
        texto: '¿Quiere solicitar un servicio para este vehiculo ahora?',
        confirmar: 'Solicitar servicio',
        cancelar: 'Mas tarde',
        peligro: false,
      });
      if (ir) navegar(`/servicios?vehiculoId=${v.id}`);
    },
    onError: (e) => avisoError(e, 'No se pudo agregar el vehiculo'),
  });

  /** Borrar no se deshace: se pregunta antes y el foco arranca en Cancelar. */
  const eliminarVehiculo = useMutation({
    mutationFn: (id: number) => enviar(`/vehiculos/${id}`, 'DELETE'),
    onSuccess: () => {
      avisoExito('El vehiculo se quito de su cuenta.', 'Vehiculo eliminado');
      refrescar();
    },
    onError: (e) => avisoError(e, 'No se pudo eliminar'),
  });

  const pedirEliminar = async (v: Vehiculo) => {
    const seguro = await confirmar({
      titulo: `¿Eliminar ${v.placa}?`,
      texto: `${v.marca} ${v.modelo}. Esta accion no se puede deshacer, y solo es posible si el vehiculo no tiene expedientes ni servicios abiertos.`,
      confirmar: 'Si, eliminar',
    });
    if (seguro) eliminarVehiculo.mutate(v.id);
  };

  const cuantos = yo?.vehiculos.length ?? 0;
  const enElTope = cuantos >= MAX_VEHICULOS_CLIENTE;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {esCliente ? 'Mis vehículos' : 'Gestionar vehículo e inventario'}
        </h2>
        <p className="text-sm text-slate-400">
          {esCliente
            ? 'Registre sus vehículos y después solicite el servicio que necesite.'
            : 'El vehículo es el punto de partida: sin vehículo no hay servicio.'}
        </p>
      </div>

      {esCliente && (
        <section className="vidrio space-y-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Agregar un nuevo vehículo</h3>
            <span className="text-xs text-slate-400">
              {cuantos} de {MAX_VEHICULOS_CLIENTE} registrados
            </span>
          </div>

          {enElTope ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Ya tiene {MAX_VEHICULOS_CLIENTE} vehículos registrados, que es el máximo por cuenta.
              Si necesita otro, comuníquese con la central.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <LeerTarjeta alLeer={completar} />
                <input value={formV.placa} onChange={(e) => setFormV({ ...formV, placa: e.target.value.toUpperCase() })} placeholder="Placa (ej: ABC123)" className="campo font-mono" maxLength={6} />
                <input value={formV.marca} onChange={(e) => setFormV({ ...formV, marca: e.target.value })} placeholder="Marca" className="campo" />
                <input value={formV.modelo} onChange={(e) => setFormV({ ...formV, modelo: e.target.value })} placeholder="Línea o modelo" className="campo" />
                <input value={formV.color} onChange={(e) => setFormV({ ...formV, color: e.target.value })} placeholder="Color" className="campo" />
              </div>
              <p className="text-xs text-slate-400">
                No le pedimos el VIN ni el número de la tarjeta de propiedad: esos datos los
                toma el técnico en el sitio, con el documento en la mano.
              </p>
              <button
                className="boton"
                disabled={
                  crearVehiculo.isPending || formV.placa.length < 5 || formV.marca.length < 2 ||
                  formV.modelo.length < 2 || formV.color.length < 3
                }
                onClick={() => crearVehiculo.mutate()}
              >
                {crearVehiculo.isPending ? 'Agregando…' : 'Agregar vehículo'}
              </button>
            </>
          )}
        </section>
      )}

      {!esCliente && (
        <button className="boton" onClick={() => setRegistrando(!registrando)}>
          {registrando ? 'Cerrar' : 'Registrar vehículo'}
        </button>
      )}

      {!esCliente && registrando && (
        <Registrar alTerminar={() => { setRegistrando(false); refrescar(); }} />
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((v) => (
          <article key={v.id} className="vidrio p-5">
            <p className="font-mono text-lg text-amber-300">{v.placa}</p>
            <p className="mt-1 text-sm">{v.marca} {v.modelo}</p>
            <p className="text-sm text-slate-400">Color {v.color.toLowerCase()}</p>

            {/* Lo que el tecnico completo con la tarjeta de propiedad. Si esta
                vacio, es que ese vehiculo aun no ha pasado por un servicio. */}
            {(v.vin || v.licenciaTransito) && (
              <dl className="mt-3 space-y-0.5 border-t border-white/10 pt-2 text-xs text-slate-400">
                {v.licenciaTransito && (
                  <div className="flex justify-between"><dt>Lic. tránsito</dt><dd className="font-mono">{v.licenciaTransito}</dd></div>
                )}
                {v.vin && <div className="flex justify-between"><dt>VIN</dt><dd className="font-mono">{v.vin}</dd></div>}
              </dl>
            )}

            {esCliente ? (
              <div className="mt-3 space-y-2">
                <button
                  className="boton-suave w-full"
                  onClick={() => navegar(`/servicios?vehiculoId=${v.id}`)}
                  title="Ir al formulario de solicitud"
                >
                  Solicitar servicio →
                </button>
                <button
                  className="w-full rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
                  disabled={eliminarVehiculo.isPending}
                  onClick={() => pedirEliminar(v)}
                >
                  {eliminarVehiculo.isPending ? 'Eliminando…' : 'Eliminar vehículo'}
                </button>
              </div>
            ) : (
              <p className="mt-3 border-t border-white/10 pt-3 text-sm">
                <span className="text-slate-400">Propietario: </span>
                {v.cliente?.nombre ?? '—'}
              </p>
            )}
          </article>
        ))}
        {data?.length === 0 && <p className="text-sm text-slate-400">Sin resultados.</p>}
      </div>

    </div>
  );
}
