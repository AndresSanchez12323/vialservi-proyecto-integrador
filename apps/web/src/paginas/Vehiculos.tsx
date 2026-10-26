import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { enviar, juntarTarjeta, pedir, sesion, type Cliente, type DatosTarjeta, type Vehiculo } from '../comun/api';
import { CAMPOS_TARJETA, MAX_VEHICULOS_CLIENTE } from '../comun/formato';
import { CapturaTarjeta } from '../comun/CapturaTarjeta';
import { avisoError, avisoExito, confirmar } from '../comun/avisos';

type ClienteYo = Cliente & { vehiculos: Vehiculo[] };

/** Los cuatro datos que cualquiera sabe de su vehiculo sin mirar el documento. */
type Basicos = { placa: string; marca: string; modelo: string; color: string };

const BASICOS_VACIOS: Basicos = { placa: '', marca: '', modelo: '', color: '' };

/** Lo que trae el documento y no se le pide a nadie de memoria. */
const DEL_DOCUMENTO = CAMPOS_TARJETA.filter(
  (c) => !['placa', 'marca', 'modelo', 'color'].includes(c.clave),
);

const basicosCompletos = (b: Basicos) =>
  b.placa.trim().length >= 5 && b.marca.trim().length >= 2 &&
  b.modelo.trim().length >= 2 && b.color.trim().length >= 3;

/**
 * Reparte lo leido de la tarjeta entre los campos del formulario.
 *
 * El campo «Línea o modelo» de la pantalla y los campos `linea` y `modelo` del
 * documento no son lo mismo: para el documento la linea es «Corolla» y el
 * modelo es el año. En la casilla que el usuario ve se pone lo que una persona
 * escribiria ahi —la linea— y el año queda aparte, con el resto del documento.
 *
 * Solo rellena las casillas VACIAS. La lectura del reverso vuelve a llamar con
 * todo lo acumulado, y si pisara lo que hay escrito desharia la correccion que
 * la persona acabara de hacer a mano entre una foto y la otra.
 */
const repartir = (datos: DatosTarjeta, basicos: Basicos): Basicos => ({
  placa: basicos.placa || datos.placa || '',
  marca: basicos.marca || datos.marca || '',
  modelo: basicos.modelo || datos.linea || datos.modelo || '',
  color: basicos.color || datos.color || '',
});

/** Quita los campos vacios: mandar cadenas vacias borraria datos guardados. */
const soloConValor = (datos: DatosTarjeta) =>
  Object.fromEntries(
    Object.entries(datos).filter(([, valor]) => typeof valor === 'string' && valor.trim() !== ''),
  );

/**
 * Casillas de los datos del documento. Solo aparecen cuando la lectura de la
 * tarjeta trajo alguno: a quien registra su carro de memoria no se le pone
 * delante un VIN que no va a saber, que es la razon de que nunca se le hayan
 * pedido.
 */
function CamposDocumento({
  datos,
  alCambiar,
}: {
  datos: DatosTarjeta;
  alCambiar: (clave: keyof DatosTarjeta, valor: string) => void;
}) {
  const visibles = DEL_DOCUMENTO.filter(({ clave }) => datos[clave] !== undefined);
  if (visibles.length === 0) return null;

  return (
    <div className="vidrio-suave space-y-3 p-4">
      <div>
        <p className="text-sm font-medium">Datos leídos del documento</p>
        <p className="text-xs text-tinta-tenue">
          Se guardan con el vehículo. Corrija lo que el lector haya entendido mal; el técnico los
          confirma en el sitio con el documento en la mano.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visibles.map(({ clave, etiqueta }) => (
          <label key={clave} className="block min-w-0">
            <span className="mb-1 block text-xs text-tinta-tenue">{etiqueta}</span>
            <input
              value={datos[clave] ?? ''}
              onChange={(e) => alCambiar(clave, e.target.value)}
              className="campo"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Registro del vehiculo. El cliente registra el suyo y la central registra
 *  el de cualquiera: es el paso previo a poder solicitar un servicio, porque
 *  todo el sistema se organiza alrededor de la placa. */
function Registrar({ alTerminar }: { alTerminar: () => void }) {
  const rol = sesion.rol();
  const esCentral = rol === 'CENTRAL' || rol === 'ADMINISTRADOR';

  const [basicos, setBasicos] = useState<Basicos>(BASICOS_VACIOS);
  const [documento, setDocumento] = useState<DatosTarjeta>({});
  const [clienteId, setClienteId] = useState('');

  const completar = (leido: DatosTarjeta) => {
    setBasicos((anterior) => repartir(leido, anterior));
    setDocumento((anterior) => juntarTarjeta(anterior, leido));
  };

  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => pedir<Cliente[]>('/clientes'),
    enabled: esCentral,
  });

  const mutar = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', {
        ...basicos,
        ...soloConValor(documento),
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

      <CamposDocumento
        datos={documento}
        alCambiar={(clave, valor) => setDocumento((anterior) => ({ ...anterior, [clave]: valor }))}
      />

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
  const [documento, setDocumento] = useState<DatosTarjeta>({});

  const completar = (leido: DatosTarjeta) => {
    setBasicos((anterior) => repartir(leido, anterior));
    setDocumento((anterior) => juntarTarjeta(anterior, leido));
  };

  const refrescar = () => {
    cola.invalidateQueries({ queryKey: ['vehiculos'] });
    cola.invalidateQueries({ queryKey: ['clienteYo'] });
  };

  const crearVehiculo = useMutation({
    mutationFn: () =>
      enviar<Vehiculo>('/vehiculos', 'POST', {
        ...basicos,
        ...soloConValor(documento),
        clienteId: yo?.id,
      }),
    onSuccess: async (v) => {
      setBasicos(BASICOS_VACIOS);
      setDocumento({});
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
                nota="Si tiene a mano la tarjeta de propiedad, fotografíela y los datos se llenan solos."
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={basicos.placa} onChange={(e) => setBasicos({ ...basicos, placa: e.target.value.toUpperCase() })} placeholder="Placa (ej: ABC123)" className="campo font-mono" maxLength={6} />
                <input value={basicos.marca} onChange={(e) => setBasicos({ ...basicos, marca: e.target.value })} placeholder="Marca" className="campo" />
                <input value={basicos.modelo} onChange={(e) => setBasicos({ ...basicos, modelo: e.target.value })} placeholder="Línea o modelo" className="campo" />
                <input value={basicos.color} onChange={(e) => setBasicos({ ...basicos, color: e.target.value })} placeholder="Color" className="campo" />
              </div>

              <CamposDocumento
                datos={documento}
                alCambiar={(clave, valor) => setDocumento((anterior) => ({ ...anterior, [clave]: valor }))}
              />

              <p className="text-xs text-tinta-tenue">
                Solo le pedimos los cuatro datos de arriba. El VIN y el número de la tarjeta de
                propiedad no hace falta buscarlos: salen de la foto, o los toma el técnico en el
                sitio con el documento en la mano.
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
