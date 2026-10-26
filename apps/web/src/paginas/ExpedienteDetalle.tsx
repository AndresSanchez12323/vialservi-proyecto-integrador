import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { enviar, pedir, sesion, type DatosTarjeta, type Expediente } from '../comun/api';
import { Atras } from '../comun/Atras';
import { CapturaTarjeta } from '../comun/CapturaTarjeta';
import { Mapa } from '../comun/Mapa';
import { SubirEvidencia } from '../comun/SubirEvidencia';
import { VistaEvidencia } from '../comun/VistaEvidencia';
import { CATEGORIAS, ESTADOS, TIPOS, etiquetaTarjeta, fecha, haceCuanto } from '../comun/formato';
import { avisoError, avisoExito, confirmar } from '../comun/avisos';

const idLocal = () => `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Casillas del documento que diligencia el tecnico. Son las del vehiculo que
 * NO se le pidieron al cliente, mas los datos del propietario segun el
 * documento. La placa, la marca, el modelo y el color no estan: esos ya
 * identifican al vehiculo del servicio, y cambiarlos aqui seria cambiar de
 * vehiculo a mitad de un expediente.
 */
const CLAVES_DOCUMENTO = [
  'linea', 'clase', 'licenciaTransito', 'vin', 'chasis', 'motor',
  'propietarioNombre', 'propietarioDocumento',
] as const;

type DatosDocumento = Record<(typeof CLAVES_DOCUMENTO)[number], string>;

// Las etiquetas salen de la lista compartida: el lector de la tarjeta nombra
// los campos igual que este formulario.
const CAMPOS_DOCUMENTO = CLAVES_DOCUMENTO.map((clave) => ({
  clave,
  etiqueta: etiquetaTarjeta(clave),
}));

/** Compara lo leido en el documento con el vehiculo que figura en el servicio. */
const compararConVehiculo = (
  leido: DatosTarjeta,
  vehiculo: { placa: string; marca: string; modelo: string; color: string },
): string[] => {
  const igual = (a?: string, b?: string) =>
    !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();
  const avisos: string[] = [];
  // La placa es la que importa de verdad: si no es la misma, el documento es
  // de otro vehiculo y eso no lo arregla nadie corrigiendo una casilla.
  if (leido.placa && !igual(leido.placa, vehiculo.placa)) {
    avisos.push(`La placa del documento es ${leido.placa} y el servicio es de ${vehiculo.placa}.`);
  }
  if (leido.marca && !igual(leido.marca, vehiculo.marca)) {
    avisos.push(`La marca del documento es ${leido.marca} y la registrada es ${vehiculo.marca}.`);
  }
  if (leido.color && !igual(leido.color, vehiculo.color)) {
    avisos.push(`El color del documento es ${leido.color} y el registrado es ${vehiculo.color}.`);
  }
  return avisos;
};

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

  /** Lo que ya esta guardado en el vehiculo: el punto de partida del formulario
   *  y aquello a lo que se vuelve si se descarta una lectura. */
  const guardado: DatosDocumento = {
    linea: v.linea ?? '', clase: v.clase ?? '', licenciaTransito: v.licenciaTransito ?? '',
    vin: v.vin ?? '', chasis: v.chasis ?? '', motor: v.motor ?? '',
    propietarioNombre: v.propietarioNombre ?? '', propietarioDocumento: v.propietarioDocumento ?? '',
  };

  const [doc, setDoc] = useState<DatosDocumento>(guardado);
  const [discrepancias, setDiscrepancias] = useState<string[]>([]);

  /** El vehiculo llega sin ningun dato del documento. */
  const sinDocumento = !(v.licenciaTransito || v.vin || v.linea);

  /**
   * Que haya datos NO significa que esten comprobados: desde que el cliente
   * puede fotografiar la tarjeta al registrar el vehiculo, lo que hay ahi
   * puede venir de el y no haber pasado por nadie en el sitio. Lo que decide
   * si este bloque reclama atencion es la verificacion de ESTE expediente, que
   * es el acto del tecnico, no la presencia de datos.
   */
  const porConfirmar = !exp.verificadoEn;

  /**
   * Lo leido de la tarjeta MANDA sobre lo que haya en las casillas.
   *
   * Volver a tomar la foto es lo que hace el tecnico cuando el lector entendio
   * mal, de modo que si la lectura nueva no pisara el valor anterior, repetir
   * la foto no serviria para nada. Nada se guarda hasta pulsar «Guardar
   * verificacion», asi que siempre queda ver el resultado y corregirlo.
   */
  const completarDesdeTarjeta = (leido: DatosTarjeta) => {
    setDoc((anterior) => {
      const siguiente = { ...anterior };
      for (const { clave } of CAMPOS_DOCUMENTO) {
        const valor = leido[clave]?.trim();
        if (valor) siguiente[clave] = valor;
      }
      return siguiente;
    });
    setDiscrepancias(compararConVehiculo(leido, v));
  };

  /** Lectura descartada: las casillas vuelven a lo que hay guardado. */
  const olvidarTarjeta = () => {
    setDoc(guardado);
    setDiscrepancias([]);
  };

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
    onSuccess: () => {
      avisoExito('Quedo registrado quien entrega el vehiculo.', 'Verificacion guardada');
      alTerminar();
    },
    onError: (e) => avisoError(e, 'No se pudo guardar la verificacion'),
  });

  const faltanDatos = esPropietario === false && (nombre.trim().length < 3 || documento.trim().length < 5);
  const tieneFirma = (exp.control.porCategoria.FIRMA_CEDULA ?? 0) > 0;

  return (
    <section className="vidrio p-6">
      <h3 className="font-medium">Quién entrega el vehículo</h3>
      <p className="mt-1 text-xs text-tinta-tenue">
        Compare la persona y el documento con los datos del expediente antes de la maniobra.
        Si hay diferencias, suspenda e informe a la central con una novedad.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEsPropietario(true)}
          className={`rounded-lg px-4 py-2 text-sm transition ${
            esPropietario === true
              ? 'bg-exito-fondo/20 font-medium text-exito ring-1 ring-exito/40'
              : 'bg-velo/10 text-tinta-suave hover:bg-velo/20'
          }`}
        >
          Sí, es el propietario
        </button>
        <button
          type="button"
          onClick={() => setEsPropietario(false)}
          className={`rounded-lg px-4 py-2 text-sm transition ${
            esPropietario === false
              ? 'bg-marca-fondo/20 font-medium text-marca ring-1 ring-marca/40'
              : 'bg-velo/10 text-tinta-suave hover:bg-velo/20'
          }`}
        >
          No es el propietario
        </button>
      </div>

      {esPropietario === false && (
        <div className="mt-4 space-y-3 rounded-xl border border-marca/30 bg-marca-fondo/[0.07] p-4">
          <p className="text-sm font-medium text-marca">Datos de quien entrega</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                ? 'border-exito/30 bg-exito-fondo/10 text-exito'
                : 'border-riesgo/30 bg-riesgo-fondo/10 text-riesgo'
            }`}
          >
            {tieneFirma
              ? '✓ Ya está cargada la foto de la cédula con la firma de autorización.'
              : 'Obligatorio: suba abajo una foto de la cédula con la firma de autorización, en la categoría «Cédula con firma». Sin ella no se puede marcar el servicio como terminado.'}
          </div>

          <p className="text-[11px] text-marca/70">
            Este registro no certifica la propiedad del vehículo ni descarta un reporte de hurto:
            VialServi no hace esa comprobación. Solo queda constancia de quién autorizó.
          </p>
        </div>
      )}

      {/* Abierto mientras quede trabajo: o no hay datos del documento, o los
          hay pero nadie los ha comprobado en sitio todavia. Esconder el
          trabajo pendiente tras un desplegable es esconderlo. */}
      <details className="mt-4" open={sinDocumento || porConfirmar}>
        <summary className="cursor-pointer text-sm text-tinta-suave hover:text-tinta">
          Datos de la licencia de tránsito (tarjeta de propiedad)
          {sinDocumento ? (
            <span className="etiqueta ml-2 border border-marca/40 bg-marca-fondo/15 text-marca">
              sin registrar
            </span>
          ) : porConfirmar ? (
            <span className="etiqueta ml-2 border border-marca/40 bg-marca-fondo/15 text-marca">
              por confirmar
            </span>
          ) : null}
        </summary>
        <p className="mt-2 text-xs text-tinta-tenue">
          {sinDocumento
            ? 'El vehículo no tiene registrada la tarjeta de propiedad. Fotografíela usted, o tome los datos del documento que tiene en la mano. Si un dato no figura o no aplica, déjelo vacío: no lo complete con supuestos.'
            : porConfirmar
              ? 'Estos datos no los ha comprobado nadie en el sitio: pueden venir de la foto que subió el cliente. Compruébelos contra el documento que tiene en la mano y corrija lo que esté mal.'
              : 'Compruebe que coinciden con el documento que tiene en la mano y corrija lo que esté mal.'}
        </p>

        {/* El tecnico lee la tarjeta con la misma camara y el mismo recorrido
            de dos caras que el cliente. El reverso importa especialmente aqui:
            es el lado que trae al propietario. */}
        <CapturaTarjeta
          className="mt-3"
          alLeer={completarDesdeTarjeta}
          alReiniciar={olvidarTarjeta}
          nota="Dos fotos, frente y reverso. Lo leído llena las casillas de abajo y usted lo corrige antes de guardar."
        />

        {discrepancias.length > 0 && (
          <div className="mt-3 rounded-lg border border-riesgo/40 bg-riesgo-fondo/10 px-3 py-2 text-xs text-riesgo">
            <p className="font-medium">
              El documento no coincide con el vehículo registrado en el servicio:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {discrepancias.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="mt-1">
              No siga con la maniobra hasta aclararlo: registre una novedad e informe a la central.
            </p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAMPOS_DOCUMENTO.map(({ clave, etiqueta }) => (
            <label key={clave} className="block min-w-0">
              <span className="mb-1 block text-xs text-tinta-tenue">{etiqueta}</span>
              <input
                value={doc[clave]}
                onChange={(e) => setDoc({ ...doc, [clave]: e.target.value })}
                className="campo"
              />
            </label>
          ))}
        </div>
      </details>

      {faltanDatos && (
        <p className="mt-3 text-xs text-marca">
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
        <p className="mt-2 text-xs text-tinta-sutil">
          Última verificación: {fecha(exp.verificadoEn)} (versión {exp.verificacionVersion})
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/**
 * Inventario de lo que iba dentro del vehiculo. Lo diligencia el TECNICO en
 * sitio (o la central): es la constancia de lo que se recibio y por eso vive
 * junto al vehiculo. El cliente solo lo ve.
 */
function Inventario({
  vehiculoId,
  puedeEditar,
  alTerminar,
}: {
  vehiculoId: number;
  puedeEditar: boolean;
  alTerminar: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('1');

  const agregar = useMutation({
    mutationFn: () =>
      enviar(`/vehiculos/${vehiculoId}/inventario`, 'POST', {
        descripcion: descripcion.trim(),
        cantidad: Number(cantidad) || 1,
      }),
    onSuccess: () => {
      setDescripcion('');
      setCantidad('1');
      avisoExito('El objeto quedo en el inventario del vehiculo.', 'Objeto agregado');
      alTerminar();
    },
    onError: (e) => avisoError(e, 'No se pudo agregar el objeto'),
  });

  if (!puedeEditar) return null;

  return (
    <form
      className="mt-3 space-y-2 border-t border-velo/10 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        agregar.mutate();
      }}
    >
      <p className="text-xs uppercase tracking-wide text-tinta-tenue">Agregar objeto</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
        <input
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="campo"
          placeholder="Descripción (ej: llanta de repuesto)"
          maxLength={80}
        />
        <input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value.replace(/\D/g, '').slice(0, 3))}
          className="campo text-center font-mono"
          inputMode="numeric"
          placeholder="Cant."
          aria-label="Cantidad"
        />
      </div>
      <button
        className="boton-suave w-full sm:w-auto"
        disabled={descripcion.trim().length < 3 || agregar.isPending}
      >
        {agregar.isPending ? 'Agregando…' : 'Agregar al inventario'}
      </button>
    </form>
  );
}

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
    onSuccess: () => { avisoExito('Las observaciones quedaron guardadas.'); refrescar(); },
    onError: (e) => avisoError(e, 'No se pudieron guardar las observaciones'),
  });

  const agregarNovedad = useMutation({
    mutationFn: () =>
      enviar(`/expedientes/${id}/novedades`, 'POST', { idLocal: idLocal(), descripcion: novedad }),
    onSuccess: () => {
      setNovedad('');
      avisoExito('La novedad quedo en el expediente, con su fecha y responsable.', 'Novedad registrada');
      refrescar();
    },
    onError: (e) => avisoError(e, 'No se pudo registrar la novedad'),
  });

  const guardarRevision = useMutation({
    mutationFn: () => enviar(`/expedientes/${id}/revision`, 'PATCH', { revisionCentral: revision }),
    onSuccess: () => { avisoExito('La revision de la central quedo guardada.'); refrescar(); },
    onError: (e) => avisoError(e, 'No se pudo guardar la revision'),
  });

  const cerrar = useMutation({
    mutationFn: () => enviar(`/expedientes/${id}/cerrar`, 'POST'),
    onSuccess: () => {
      avisoExito('El expediente quedo cerrado y pasa a consulta.', 'Expediente cerrado');
      refrescar();
    },
    onError: (e) => avisoError(e, 'No se pudo cerrar el expediente'),
  });

  /** Cerrar no se deshace: a partir de aqui el expediente es historial. */
  const pedirCierre = async () => {
    const seguro = await confirmar({
      titulo: '¿Cerrar el expediente?',
      texto: 'Despues del cierre no se modifica lo ya registrado. Lo que se agregue luego queda marcado como posterior al cierre, con su fecha y responsable.',
      confirmar: 'Si, cerrar',
      cancelar: 'Revisar otra vez',
    });
    if (seguro) cerrar.mutate();
  };

  // Marcar terminado vive tambien aqui adentro, no solo en la lista de
  // servicios: el tecnico diligencia el expediente en esta pagina y no
  // deberia salir a buscar el boton a otra parte.
  const terminar = useMutation({
    mutationFn: () => enviar(`/servicios/${s?.id}/estado`, 'PATCH', { estado: 'TERMINADO' }),
    onSuccess: () => {
      avisoExito('La central recibio el aviso y revisara el expediente.', 'Servicio terminado');
      refrescar();
    },
    onError: (e) => avisoError(e, 'No se pudo marcar como terminado'),
  });

  const pedirTerminar = async () => {
    const seguro = await confirmar({
      titulo: '¿Marcar el servicio como terminado?',
      texto: 'La central recibira el aviso para revisar el expediente y cerrarlo. Compruebe que subio todas las evidencias del formato.',
      confirmar: 'Si, terminar',
      cancelar: 'Todavia no',
      peligro: false,
    });
    if (seguro) terminar.mutate();
  };

  if (isLoading) return <p className="text-sm text-tinta-tenue">Cargando expediente…</p>;
  if (error) return <p className="text-sm text-riesgo">{(error as Error).message}</p>;
  if (!data) return null;

  const s = data.servicio;
  const cerrado = data.cerradoEn !== null;
  const control = data.control;
  // Lo mismo que exige el servidor para terminar, sin contar la propia marca:
  // si faltan fotos, el boton se deshabilita aqui en lugar de rebotar.
  const faltanParaTerminar = (control.avisos ?? []).filter((a) => !/terminado/i.test(a));
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
            <p className="font-mono text-sm text-marca">{data.consecutivo}</p>
            <h2 className="mt-1 text-xl font-semibold">{s.descripcion}</h2>
            <p className="text-sm text-tinta-tenue">{s.direccion}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`etiqueta ${ESTADOS[s.estado]?.clase ?? ''}`}>{ESTADOS[s.estado]?.texto}</span>
            {s.tipo && <span className="etiqueta border border-velo/20 bg-velo/10">{TIPOS[s.tipo]}</span>}
            {data.formato && (
              <span
                className="etiqueta border border-velo/15 bg-velo/5 text-tinta-suave"
                title="Versión del formato con la que se diligenció este expediente"
              >
                formato v{data.formatoVersion}
              </span>
            )}
          </div>
        </div>

        {/* El expediente concentra y enlaza: no duplica los datos */}
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-velo/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-tinta-sutil">Vehículo</p>
            <p className="font-mono text-marca">{s.vehiculo.placa}</p>
            <p className="text-sm text-tinta-suave">{s.vehiculo.marca} {s.vehiculo.modelo} · {s.vehiculo.color}</p>
            {s.vehiculo.vin && (
              <p className="mt-1 break-all font-mono text-[11px] text-tinta-sutil">VIN {s.vehiculo.vin}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase text-tinta-sutil">Cliente</p>
            <p className="text-sm">{s.cliente.nombre}</p>
            <p className="text-sm text-tinta-tenue">{s.contactoTelefono ?? s.cliente.telefono}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-tinta-sutil">Técnico</p>
            <p className="text-sm">{s.tecnico?.nombre ?? 'sin asignar'}</p>
            {s.tecnico?.ubicacionEn && (
              <p className="text-xs text-tinta-sutil">ubicación {haceCuanto(s.tecnico.ubicacionEn)}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase text-tinta-sutil">Quién entregó</p>
            {data.esPropietario === null ? (
              <p className="text-sm text-marca">sin verificar</p>
            ) : data.esPropietario ? (
              <p className="text-sm text-exito">el propietario</p>
            ) : (
              <>
                <p className="text-sm text-marca">{data.solicitanteNombre}</p>
                <p className="font-mono text-xs text-tinta-tenue">CC {data.solicitanteDocumento}</p>
                {data.solicitanteRelacion && (
                  <p className="text-[11px] text-tinta-sutil">{data.solicitanteRelacion}</p>
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
          className={`vidrio p-6 ${control.listoParaCerrar ? '' : 'border-marca/30'}`}
        >
          <h3 className="font-medium">
            {control.listoParaCerrar ? '✓ Expediente completo' : 'Falta para poder cerrar'}
          </h3>
          {control.listoParaCerrar ? (
            <p className="mt-1 text-sm text-exito">
              Tiene todo lo que exige el formato{data.formato ? ` de ${data.formato.nombre.toLowerCase()}` : ''}.
              La central ya puede cerrarlo.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {control.avisos.map((a) => (
                <li key={a} className="flex items-start gap-2 text-sm text-marca">
                  <span className="mt-0.5 text-marca">○</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          {data.formato && (
            <div className="mt-4 border-t border-velo/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-tinta-sutil">
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
                          ? 'border-exito/30 bg-exito-fondo/15 text-exito'
                          : 'border-marca/30 bg-marca-fondo/10 text-marca'
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

      {/* Terminar la atencion sin salir del expediente. En la lista de
          servicios sigue estando el boton: quedan las dos vias. */}
      {esTecnico && !cerrado && s.estado === 'EN_EJECUCION' && (
        <section className="vidrio border-marca/30 p-6">
          <h3 className="font-medium">Terminar la atención</h3>
          {faltanParaTerminar.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-marca">Antes de terminar faltan evidencias:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-marca">
                {faltanParaTerminar.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-tinta-tenue">
                Súbalas en la sección de evidencias de esta misma página y vuelva aquí.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-tinta-suave">
              Está todo lo que exige el formato. Al marcar terminado se avisa a la
              central para que revise y cierre el expediente.
            </p>
          )}
          <button
            className="boton mt-4"
            disabled={faltanParaTerminar.length > 0 || terminar.isPending}
            onClick={pedirTerminar}
            title={
              faltanParaTerminar.length > 0
                ? 'Suba primero las evidencias que faltan'
                : 'Marca el servicio como terminado'
            }
          >
            {terminar.isPending ? 'Marcando…' : 'Marcar terminado'}
          </button>
        </section>
      )}
      {esTecnico && !cerrado && s.estado === 'TERMINADO' && (
        <section className="vidrio p-6">
          <p className="text-sm text-exito">
            ✓ Servicio marcado como terminado. Queda en manos de la central revisarlo y cerrar el expediente.
          </p>
        </section>
      )}

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="vidrio p-6">
          <h3 className="mb-1 font-medium">Observaciones del técnico</h3>
          <p className="mb-3 text-xs text-tinta-sutil">
            Versión {data.observacionesVersion} · campo del técnico: la central no lo escribe
          </p>
          {data.formato && esTecnico && (
            <p className="mb-2 text-xs text-tinta-tenue">
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
          <p className="mb-3 text-xs text-tinta-sutil">Lo que iba dentro cuando se recibió</p>
          <ul className="space-y-2">
            {s.vehiculo.inventario?.map((o) => (
              <li key={o.id} className="vidrio-suave flex justify-between px-3 py-2 text-sm">
                <span>{o.descripcion}</span>
                <span className="text-tinta-tenue">×{o.cantidad}</span>
              </li>
            ))}
            {!s.vehiculo.inventario?.length && (
              <li className="text-sm text-tinta-sutil">Sin objetos registrados.</li>
            )}
          </ul>
          <Inventario
            vehiculoId={s.vehiculo.id}
            puedeEditar={(esTecnico || esCentral) && !cerrado}
            alTerminar={refrescar}
          />
        </section>
      </div>

      <section className="vidrio p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Evidencias ({data.evidencias.length})</h3>
            <p className="text-xs text-tinta-sutil">
              Cada archivo queda con su autor y su hora de captura.
            </p>
          </div>
        </div>

        {(esTecnico || esCliente) && (
          <div className="vidrio-suave mb-4 space-y-3 p-4">
            <p className="text-xs uppercase tracking-wide text-tinta-tenue">¿Qué prueba esta evidencia?</p>
            <div className="flex flex-wrap gap-2">
              {categoriasDisponibles.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoria(c)}
                  className={`etiqueta border transition ${
                    categoria === c
                      ? CATEGORIAS[c].clase + ' ring-1 ring-velo/40'
                      : 'border-velo/15 bg-velo/5 text-tinta-suave hover:bg-velo/10'
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.evidencias.map((ev) => (
            <VistaEvidencia key={ev.id} evidencia={ev} expedienteId={data.id} />
          ))}
          {data.evidencias.length === 0 && (
            <p className="text-sm text-tinta-sutil">Todavía no hay evidencias.</p>
          )}
        </div>
      </section>

      <section className="vidrio p-6">
        <h3 className="mb-4 font-medium">Novedades ({data.novedades.length})</h3>
        <ul className="mb-4 space-y-2">
          {data.novedades.map((n) => (
            <li key={n.id} className="vidrio-suave px-4 py-3 text-sm">
              <p>{n.descripcion}</p>
              <p className="mt-1 text-xs text-tinta-sutil">{fecha(n.ocurridaEn)}</p>
            </li>
          ))}
          {data.novedades.length === 0 && <li className="text-sm text-tinta-sutil">Sin novedades.</li>}
        </ul>

        {(esTecnico || esCentral) && (
          /* flex-wrap y shrink-0: en un telefono el boton no tiene donde caber
             al lado del campo, y sin envoltura se le estrujaba el texto. */
          <div className="flex flex-wrap gap-2">
            <input
              value={novedad}
              onChange={(e) => setNovedad(e.target.value)}
              className="campo"
              placeholder="Registrar una novedad del servicio…"
            />
            <button
              className="boton shrink-0"
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
          <p className="mt-1 text-sm text-tinta-tenue">
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

          <div className="mt-4">
            <button
              className="boton"
              disabled={cerrado || cerrar.isPending || !control.listoParaCerrar}
              onClick={pedirCierre}
              title={control.listoParaCerrar ? 'Cerrar el expediente' : 'Faltan requisitos del formato'}
            >
              {cerrado ? `Cerrado el ${fecha(data.cerradoEn)}` : 'Cerrar expediente'}
            </button>
            {!cerrado && !control.listoParaCerrar && (
              <p className="mt-2 text-xs text-marca">
                No se puede cerrar todavía: {control.avisos.join('; ')}.
              </p>
            )}
          </div>
        </section>
      )}

      {cerrado && !esCentral && (
        <section className="vidrio p-6">
          <h3 className="font-medium">Expediente cerrado</h3>
          <p className="mt-1 text-sm text-tinta-suave">
            Cerrado el {fecha(data.cerradoEn)}. Las evidencias quedan conservadas y una que
            llegue después se acepta, pero queda marcada como posterior al cierre.
          </p>
          {data.revisionCentral && (
            <p className="mt-3 vidrio-suave px-4 py-3 text-sm text-tinta-suave">
              <span className="text-tinta-tenue">Revisión de la central: </span>
              {data.revisionCentral}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
