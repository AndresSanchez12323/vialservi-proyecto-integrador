import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { enviar, pedir, sesion, type Cliente, type LecturaTarjeta, type Vehiculo } from '../comun/api';
import { MAX_VEHICULOS_CLIENTE } from '../comun/formato';
import { CapturaTarjeta } from '../comun/CapturaTarjeta';
import { avisoError, avisoExito, confirmar } from '../comun/avisos';

type ClienteYo = Cliente & { vehiculos: Vehiculo[] };

/** Los cuatro datos que cualquiera sabe de su vehiculo sin mirar el documento. */
type Basicos = { placa: string; marca: string; modelo: string; color: string };

const BASICOS_VACIOS: Basicos = { placa: '', marca: '', modelo: '', color: '' };

const basicosCompletos = (b: Basicos) =>
  b.placa.trim().length >= 5 && b.marca.trim().length >= 2 &&
  b.modelo.trim().length >= 2 && b.color.trim().length >= 3;

/**
 * Pasa lo leido de la tarjeta a las cuatro casillas del formulario. La lectura
 * solo trae placa, marca, linea y color; la linea va a «Línea o modelo», que
 * es lo que una persona escribiria ahi.
 *
 * Lo que trae la foto MANDA sobre lo que hay escrito, y es a proposito: volver
 * a tomar una foto —o empezar la lectura de cero— es justo lo que hace alguien
 * cuando el lector entendio mal, y si lo leido no pisara el valor anterior ese
 * reintento no serviria de nada. Nada se guarda hasta pulsar el boton, asi que
 * siempre queda ver el resultado y corregirlo a mano despues.
 */
const repartir = (datos: LecturaTarjeta, basicos: Basicos): Basicos => ({
  placa: datos.placa ?? basicos.placa,
  marca: datos.marca ?? basicos.marca,
  modelo: datos.linea ?? basicos.modelo,
  color: datos.color ?? basicos.color,
});

/** Registro del vehiculo. El cliente registra el suyo y la central registra
 *  el de cualquiera: es el paso previo a poder solicitar un servicio, porque
 *  todo el sistema se organiza alrededor de la placa. */
function Registrar({ alTerminar }: { alTerminar: () => void }) {
  const rol = sesion.rol();
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [basicos, setBasicos] = useState<Basicos>(BASICOS_VACIOS);
  const [clienteId, setClienteId] = useState('');

  const completar = (leido: LecturaTarjeta) => setBasicos((anterior) => repartir(leido, anterior));

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });

  const mutar = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', {
        ...basicos,
        ...(esCentral ? { clienteId } : {}),
      }),
    onSuccess: (v) => {
      avisoExito(`${v.placa} quedo registrado y ya se puede usar en un servicio.`, 'Vehiculo registrado');
      alTerminar();
    },
    onError: (e) => avisoError(e, 'No se pudo registrar el vehiculo'),
  });

  const completo = basicosCompletos(basicos) && (!esCentral || !!clienteId);

  return (
    <div className="vidrio space-y-3 p-5">
      <div>
        <p className="font-medium">Registrar un vehículo</p>
        <p className="text-xs text-tinta-tenue">
          Queda enlazado a su propietario y se puede elegir al solicitar un servicio.
        </p>
      </div>

      <CapturaTarjeta alLeer={completar} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {esCentral && (
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="campo sm:col-span-2">
            <option value="">Propietario…</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {c.documento}
              </option>
            ))}
          </select>
        )}

        <input
          value={basicos.placa}
          onChange={(e) => setBasicos({ ...basicos, placa: e.target.value.toUpperCase() })}
          className="campo font-mono"
          placeholder="Placa (ABC123)"
          maxLength={6}
        />
        <input
          value={basicos.marca}
          onChange={(e) => setBasicos({ ...basicos, marca: e.target.value })}
          className="campo"
          placeholder="Marca"
        />
        <input
          value={basicos.modelo}
          onChange={(e) => setBasicos({ ...basicos, modelo: e.target.value })}
          className="campo"
          placeholder="Línea o modelo"
        />
        <input
          value={basicos.color}
          onChange={(e) => setBasicos({ ...basicos, color: e.target.value })}
          className="campo"
          placeholder="Color"
        />
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

  const [basicos, setBasicos] = useState<Basicos>(BASICOS_VACIOS);

  const completar = (leido: LecturaTarjeta) => setBasicos((anterior) => repartir(leido, anterior));

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['vehiculos'] });
    cola.invalidateQueries({ queryKey: ['clienteYo'] });
  };

  const crearVehiculo = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', {
        ...basicos,
        clienteId: yo?.id,
      }),
    onSuccess: async (v) => {
      setBasicos(BASICOS_VACIOS);
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
        <p className="text-sm text-tinta-tenue">
          {esCliente
            ? 'Registre sus vehículos y después solicite el servicio que necesite.'
            : 'El vehículo es el punto de partida: sin vehículo no hay servicio.'}
        </p>
      </div>

      {esCliente && (
        <section className="vidrio space-y-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Agregar un nuevo vehículo</h3>
            <span className="text-xs text-tinta-tenue">
              {cuantos} de {MAX_VEHICULOS_CLIENTE} registrados
            </span>
          </div>

          {enElTope ? (
            <p className="rounded-lg border border-marca/30 bg-marca-fondo/10 px-3 py-2 text-sm text-marca">
              Ya tiene {MAX_VEHICULOS_CLIENTE} vehículos registrados, que es el máximo por cuenta.
              Si necesita otro, comuníquese con la central.
            </p>
          ) : (
            <>
              <CapturaTarjeta
                alLeer={completar}
                nota="Si tiene a mano la licencia de tránsito, fotografíe el frente y la placa, la marca, la línea y el color se llenan solos."
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={basicos.placa} onChange={(e) => setBasicos({ ...basicos, placa: e.target.value.toUpperCase() })} placeholder="Placa (ej: ABC123)" className="campo font-mono" maxLength={6} />
                <input value={basicos.marca} onChange={(e) => setBasicos({ ...basicos, marca: e.target.value })} placeholder="Marca" className="campo" />
                <input value={basicos.modelo} onChange={(e) => setBasicos({ ...basicos, modelo: e.target.value })} placeholder="Línea o modelo" className="campo" />
                <input value={basicos.color} onChange={(e) => setBasicos({ ...basicos, color: e.target.value })} placeholder="Color" className="campo" />
              </div>

              <p className="text-xs text-tinta-tenue">
                Solo le pedimos los cuatro datos de arriba. El VIN y el número de la licencia de
                tránsito no hace falta buscarlos: los toma el técnico en el sitio con el documento
                en la mano.
              </p>
              <button
                className="boton"
                disabled={crearVehiculo.isPending || !basicosCompletos(basicos)}
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

      {isLoading && <p className="text-sm text-tinta-tenue">Cargando…</p>}
      {error && <p className="text-sm text-riesgo">{(error as Error).message}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((v) => (
          <article key={v.id} className="vidrio min-w-0 p-5">
            <p className="font-mono text-lg text-marca">{v.placa}</p>
            <p className="mt-1 text-sm">{v.marca} {v.modelo}</p>
            <p className="text-sm text-tinta-tenue">Color {v.color.toLowerCase()}</p>

            {/* Lo que vino de la tarjeta de propiedad, sea de la foto del
                cliente o de lo que el tecnico tomo en sitio. Si esta vacio, al
                vehiculo le falta el documento. */}
            {(v.vin || v.licenciaTransito) && (
              <dl className="mt-3 space-y-0.5 border-t border-velo/10 pt-2 text-xs text-tinta-tenue">
                {v.licenciaTransito && (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">Lic. tránsito</dt>
                    <dd className="min-w-0 break-all text-right font-mono">{v.licenciaTransito}</dd>
                  </div>
                )}
                {v.vin && (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">VIN</dt>
                    <dd className="min-w-0 break-all text-right font-mono">{v.vin}</dd>
                  </div>
                )}
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
                  className="w-full rounded-lg border border-riesgo/30 px-3 py-2 text-sm text-riesgo transition hover:bg-riesgo-fondo/10 disabled:opacity-50"
                  disabled={eliminarVehiculo.isPending}
                  onClick={() => pedirEliminar(v)}
                >
                  {eliminarVehiculo.isPending ? 'Eliminando…' : 'Eliminar vehículo'}
                </button>
              </div>
            ) : (
              <p className="mt-3 border-t border-velo/10 pt-3 text-sm">
                <span className="text-tinta-tenue">Propietario: </span>
                {v.cliente?.nombre ?? '—'}
              </p>
            )}
          </article>
        ))}
        {data?.length === 0 && <p className="text-sm text-tinta-tenue">Sin resultados.</p>}
      </div>

    </div>
  );
}
