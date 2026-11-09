import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DetectDocumentTextCommand, TextractClient, type Block } from '@aws-sdk/client-textract';
import { config } from './config.js';

/**
 * Datos que se leen del FRENTE de la licencia de transito.
 *
 * Todos son opcionales: un campo que no se ve en la foto se deja vacio. Un
 * campo ausente no es un error; inventarlo si lo seria, porque el usuario lo
 * guardaria sin mirarlo.
 */
export type DatosTarjeta = {
  placa?: string;
  marca?: string;
  modelo?: string;
  color?: string;
  linea?: string;
  clase?: string;
  licenciaTransito?: string;
  vin?: string;
  chasis?: string;
  motor?: string;
  propietarioNombre?: string;
  propietarioDocumento?: string;
};

const textract = new TextractClient({ region: config.AWS_REGION });
const s3 = new S3Client({ region: config.AWS_REGION });

// ── Lectura por posicion ──────────────────────────────────────────────────
//
// La licencia colombiana imprime cada dato DEBAJO de su rotulo, en la misma
// columna (PLACA / GXY81H, MARCA / HONDA...). Antes se le hacian preguntas en
// ingles a Textract (QUERIES) y el modelo mezclaba columnas: contestaba
// "MOTOCICLETA" a la placa y el año del modelo al numero de motor. Ahora se
// lee todo el texto con su posicion y cada dato se toma solo de la columna de
// su rotulo, de modo que placa, marca y color no se cruzan aunque Textract
// los junte en una misma linea.

/** Caja ya enderezada, en coordenadas normalizadas de la foto (0 a 1). */
export type Caja = { texto: string; x0: number; x1: number; y0: number; y1: number };

/** Palabras de una linea, en orden de lectura. */
export type Renglon = Caja[];

type Rotulo = Caja & { tipo: TipoRotulo };

type TipoRotulo = keyof DatosTarjeta | 'otro';

/**
 * Rotulos impresos en el frente. Los que no alimentan un campo ('otro') igual
 * se reconocen: marcan donde termina la columna vecina y evitan que su texto
 * se tome como valor.
 */
const ROTULOS: { tipo: TipoRotulo; patron: RegExp }[] = [
  { tipo: 'licenciaTransito', patron: /^LICENCIA DE TRANSITO( NO\.?| N[O°º]\.?)?$/ },
  { tipo: 'placa', patron: /^PLACA$/ },
  { tipo: 'marca', patron: /^MARCA$/ },
  { tipo: 'linea', patron: /^LINEA$/ },
  { tipo: 'modelo', patron: /^MODELO$/ },
  { tipo: 'otro', patron: /^CILINDRADA( CC)?$/ },
  { tipo: 'color', patron: /^COLOR$/ },
  { tipo: 'otro', patron: /^SERVICIO$/ },
  { tipo: 'clase', patron: /^CLASE( DE)? VEHICULO$/ },
  { tipo: 'otro', patron: /^TIPO( DE)? CARROCERIA$/ },
  { tipo: 'otro', patron: /^COMBUS ?TIBLE$/ },
  { tipo: 'otro', patron: /^CAPACIDAD( KG\/?PSJ| KG \/ PSJ)?$/ },
  { tipo: 'motor', patron: /^(NUMERO|NO\.?|N[°º])( DE)? MOTOR$/ },
  { tipo: 'otro', patron: /^REG\.?$/ },
  { tipo: 'vin', patron: /^VIN$/ },
  { tipo: 'otro', patron: /^(NUMERO|NO\.?|N[°º])( DE)? SERIE$/ },
  { tipo: 'chasis', patron: /^(NUMERO|NO\.?|N[°º])( DE)? CHASIS$/ },
  { tipo: 'propietarioNombre', patron: /^PROPIETARIO:?( APELLIDO\(?S\)? Y NOMBRE\(?S\)?)?$/ },
  { tipo: 'propietarioDocumento', patron: /^IDENTIFICACION$/ },
];
const MAX_PALABRAS_ROTULO = 6;

export const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const unir = (cajas: Caja[]): Caja => ({
  texto: cajas.map((c) => c.texto).join(' '),
  x0: Math.min(...cajas.map((c) => c.x0)),
  x1: Math.max(...cajas.map((c) => c.x1)),
  y0: Math.min(...cajas.map((c) => c.y0)),
  y1: Math.max(...cajas.map((c) => c.y1)),
});

const alto = (c: Caja) => c.y1 - c.y0;
const centroY = (c: Caja) => (c.y0 + c.y1) / 2;

/** Separa cada renglon en rotulos (con su tipo) y palabras de valor. */
const clasificar = (renglones: Renglon[]) => {
  const rotulos: Rotulo[] = [];
  const valores: Caja[] = [];
  for (const palabras of renglones) {
    let i = 0;
    while (i < palabras.length) {
      let hallado: { tipo: TipoRotulo; n: number } | undefined;
      for (let n = Math.min(MAX_PALABRAS_ROTULO, palabras.length - i); n >= 1 && !hallado; n--) {
        const frase = normalizar(palabras.slice(i, i + n).map((p) => p.texto).join(' '));
        const r = ROTULOS.find((x) => x.patron.test(frase));
        if (r) hallado = { tipo: r.tipo, n };
      }
      if (hallado) {
        rotulos.push({ ...unir(palabras.slice(i, i + hallado.n)), tipo: hallado.tipo });
        i += hallado.n;
      } else {
        valores.push(palabras[i]);
        i += 1;
      }
    }
  }
  return { rotulos, valores };
};

/** Junta palabras en orden de lectura: renglon por renglon, de izquierda a derecha. */
const leerEnOrden = (palabras: Caja[]) => {
  const ordenadas = [...palabras].sort((a, b) => centroY(a) - centroY(b));
  const renglones: Caja[][] = [];
  for (const p of ordenadas) {
    const ultimo = renglones[renglones.length - 1];
    if (ultimo && Math.abs(centroY(ultimo[0]) - centroY(p)) < alto(ultimo[0]) * 0.6) ultimo.push(p);
    else renglones.push([p]);
  }
  return renglones.map((r) => r.sort((a, b) => a.x0 - b.x0).map((p) => p.texto).join(' ')).join(' ').trim();
};

/**
 * Texto que corresponde a un rotulo: lo que esta debajo de el, desde su borde
 * izquierdo hasta donde empieza el siguiente rotulo de su misma fila, y antes
 * de la siguiente fila de rotulos.
 */
const valorBajo = (rotulo: Rotulo, rotulos: Rotulo[], valores: Caja[]) => {
  const h = alto(rotulo);
  const margen = h * 0.8;
  const mismaFila = rotulos.filter((r) => r !== rotulo && Math.abs(centroY(r) - centroY(rotulo)) < h);
  const derecha = Math.min(1, ...mismaFila.filter((r) => r.x0 > rotulo.x0 + h).map((r) => r.x0));
  const izquierda = rotulo.x0 - margen;
  const debajo = rotulos.filter(
    (r) => r.y0 > rotulo.y1 && r.x0 < derecha && r.x1 > izquierda && r.y0 - rotulo.y1 < h * 8,
  );
  const fondo = Math.min(rotulo.y1 + h * 4, ...debajo.map((r) => r.y0));
  // El valor de la columna vecina puede empezar un poco antes que su rotulo
  // (foto torcida, impresion corrida): por eso el corte se adelanta un margen.
  return leerEnOrden(valores.filter((p) =>
    p.x0 >= izquierda && p.x0 < derecha - margen
    && centroY(p) > rotulo.y1 - h * 0.3 && centroY(p) < fondo,
  ));
};

/** El numero de la licencia va a la DERECHA de su rotulo, en la misma fila. */
const valorALaDerecha = (rotulo: Rotulo, valores: Caja[]) => {
  const h = alto(rotulo);
  return leerEnOrden(valores.filter((p) =>
    p.x0 > rotulo.x1 - h && Math.abs(centroY(p) - centroY(rotulo)) < h * 1.2,
  ));
};

/** Arma los datos crudos (sin limpiar) a partir de los renglones de la foto. */
export const leerPorPosicion = (renglones: Renglon[]): Partial<Record<keyof DatosTarjeta, string>> => {
  const { rotulos, valores } = clasificar(renglones);
  const crudo: Partial<Record<keyof DatosTarjeta, string>> = {};
  for (const rotulo of rotulos) {
    if (rotulo.tipo === 'otro' || crudo[rotulo.tipo]) continue;
    const valor = rotulo.tipo === 'licenciaTransito'
      ? valorALaDerecha(rotulo, valores)
      : valorBajo(rotulo, rotulos, valores);
    if (valor) crudo[rotulo.tipo] = valor;
  }
  return crudo;
};

// ── Limpieza y validacion de cada campo ───────────────────────────────────

/** Confusiones tipicas del OCR, segun la posicion pida letra o numero. */
const A_LETRA: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B' };
const A_NUMERO: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' };

/**
 * Placa colombiana: carro ABC123, moto ABC12D o ABC12. Se corrigen las
 * confusiones del OCR segun la posicion (las tres primeras son letras, las
 * dos siguientes numeros) y se rechaza lo que no tenga forma de placa: media
 * placa mal leida es peor que ninguna, porque identifica al vehiculo en todo
 * el sistema.
 */
export const limpiarPlaca = (valor: string): string | undefined => {
  const candidatos = normalizar(valor).split(' ').map((t) => t.replace(/[^A-Z0-9]/g, ''));
  candidatos.push(normalizar(valor).replace(/[^A-Z0-9]/g, '').slice(0, 6));
  for (const t of candidatos) {
    if (t.length < 5 || t.length > 6) continue;
    const c = t.split('');
    for (let i = 0; i < 3; i++) c[i] = A_LETRA[c[i]] ?? c[i];
    for (let i = 3; i < 5; i++) c[i] = A_NUMERO[c[i]] ?? c[i];
    const placa = c.join('');
    if (/^[A-Z]{3}\d{2}[A-Z0-9]?$/.test(placa)) return placa;
  }
  return undefined;
};

const limpiarAnio = (valor: string) => {
  const anio = valor.match(/\b(19[5-9]\d|20\d{2})\b/)?.[1];
  return anio && Number(anio) <= new Date().getFullYear() + 1 ? anio : undefined;
};

/** Series del documento (VIN, chasis, motor): alfanumericas, con algun digito. */
const limpiarSerie = (valor: string) => {
  const serie = normalizar(valor).replace(/[^A-Z0-9-]/g, '').slice(0, 30);
  return serie.length >= 5 && /\d/.test(serie) ? serie : undefined;
};

const limpiarDocumento = (valor: string) => {
  const numero = valor.replace(/[^0-9]/g, '');
  return numero.length >= 5 && numero.length <= 15 ? numero : undefined;
};

/** Texto libre (marca, linea, color, clase, propietario). */
const limpiarTexto = (valor: string) => {
  const texto = valor.replace(/\s+/g, ' ').trim();
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(texto) ? texto.slice(0, 80) : undefined;
};

/**
 * Textract o el documento a veces traen "N/A", "NO APLICA", asteriscos o
 * "NOT FOUND" donde no hay dato. Esas respuestas se descartan ANTES de limpiar:
 * limpiar primero convertia "NOT FOUND" en "NOTFOUND" y ya no se reconocia.
 */
const SIN_DATO = /^(na|none|notfound|noaplica|sindato|nodisponible|desconocido|null)$/i;

const sirve = (valor: string | undefined) => {
  const texto = (valor ?? '').trim();
  if (!texto) return false;
  const letras = texto.replace(/[^a-z]/gi, '').toLowerCase();
  return letras ? !SIN_DATO.test(letras) : /\d/.test(texto);
};

/**
 * El tipo de documento (C.C., NIT...) va impreso a la izquierda del rotulo
 * IDENTIFICACION, debajo de la columna del nombre: no es parte del nombre.
 */
const TIPO_DOCUMENTO = /^(C\.?C\.?|C\.?E\.?|NIT\.?|T\.?I\.?|P\.?P\.?|PAS(APORTE)?\.?)$/;
const limpiarNombre = (valor: string) =>
  limpiarTexto(valor.split(/\s+/).filter((t) => !TIPO_DOCUMENTO.test(normalizar(t))).join(' '));

const LIMPIEZA: Record<keyof DatosTarjeta, (v: string) => string | undefined> = {
  placa: limpiarPlaca,
  marca: limpiarTexto,
  linea: limpiarTexto,
  modelo: limpiarAnio,
  color: limpiarTexto,
  clase: limpiarTexto,
  licenciaTransito: (v) => {
    const n = normalizar(v).replace(/[^A-Z0-9]/g, '');
    return n.length >= 6 && /\d/.test(n) ? n.slice(0, 30) : undefined;
  },
  vin: limpiarSerie,
  chasis: limpiarSerie,
  motor: limpiarSerie,
  propietarioNombre: limpiarNombre,
  propietarioDocumento: limpiarDocumento,
};

/**
 * Deja solo los campos que se leyeron y tienen forma valida. Esta separado de
 * la llamada a AWS para poder probarlo sin una cuenta delante.
 */
export const camposDeTarjeta = (crudo: Partial<Record<keyof DatosTarjeta, string>>): DatosTarjeta => {
  const datos: DatosTarjeta = {};
  for (const campo of Object.keys(LIMPIEZA) as (keyof DatosTarjeta)[]) {
    const valor = crudo[campo];
    if (!sirve(valor)) continue;
    const limpio = LIMPIEZA[campo](valor!.trim());
    if (limpio) datos[campo] = limpio;
  }
  return datos;
};

// ── De la respuesta de Textract a renglones enderezados ──────────────────

type Punto = { X: number; Y: number };

/**
 * Convierte los bloques de Textract en renglones de palabras, enderezando la
 * foto: se mide la inclinacion de las lineas y se rota todo al reves, para
 * que "debajo" y "a la derecha" signifiquen lo mismo aunque la tarjeta salga
 * torcida en la foto.
 */
export const renglonesDeTextract = (bloques: Block[]): Renglon[] => {
  const porId = new Map(bloques.map((b) => [b.Id, b]));
  const lineas = bloques.filter((b) => b.BlockType === 'LINE' && (b.Geometry?.Polygon?.length ?? 0) >= 4);
  const angulos = lineas
    .filter((l) => (l.Text ?? '').length >= 4)
    .map((l) => {
      const [a, b] = l.Geometry!.Polygon! as Punto[];
      return Math.atan2(b.Y - a.Y, b.X - a.X);
    })
    .sort((a, b) => a - b);
  const giro = angulos.length ? -angulos[Math.floor(angulos.length / 2)] : 0;
  const cos = Math.cos(giro);
  const sen = Math.sin(giro);
  const rotar = ({ X, Y }: Punto) => ({
    x: 0.5 + (X - 0.5) * cos - (Y - 0.5) * sen,
    y: 0.5 + (X - 0.5) * sen + (Y - 0.5) * cos,
  });
  const caja = (b: Block): Caja => {
    const pts = (b.Geometry!.Polygon as Punto[]).map(rotar);
    return {
      texto: b.Text ?? '',
      x0: Math.min(...pts.map((p) => p.x)),
      x1: Math.max(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      y1: Math.max(...pts.map((p) => p.y)),
    };
  };
  return lineas.map((linea) => {
    const ids = linea.Relationships?.find((r) => r.Type === 'CHILD')?.Ids ?? [];
    const palabras = ids
      .map((id) => porId.get(id))
      .filter((p): p is Block => !!p && p.BlockType === 'WORD' && (p.Geometry?.Polygon?.length ?? 0) >= 4)
      .map(caja);
    return palabras.sort((a, b) => a.x0 - b.x0);
  }).filter((r) => r.length > 0);
};

/**
 * Cuando una lectura cuenta como aprovechable: tiene la placa y al menos otro
 * dato del vehiculo. Asi se distingue la foto de la licencia de cualquier
 * otra foto, sin exigir campos que algunas licencias no imprimen.
 */
const suficiente = (datos: DatosTarjeta) =>
  !!datos.placa && [datos.marca, datos.linea, datos.modelo, datos.color, datos.clase, datos.vin].some(Boolean);

/**
 * Lee el frente de la licencia de transito y devuelve los campos que encontro.
 * La foto se elimina siempre al terminar, version incluida: no es una
 * evidencia del servicio y lleva datos personales.
 */
export const analizarTarjeta = async (clave: string): Promise<DatosTarjeta> => {
  if (config.OCR_MODO !== 'aws' || !config.S3_BUCKET_EVIDENCIAS) {
    throw new Error('La lectura automática requiere OCR AWS configurado.');
  }
  if (!/^ocr-tarjetas\/[a-z0-9-]+\.jpg$/i.test(clave)) {
    throw new Error('Referencia de tarjeta invalida.');
  }

  // El bucket guarda versiones: borrar solo la clave deja la foto como
  // version anterior. Se anota la version exacta para borrarla de verdad.
  let version: string | undefined;
  try {
    version = (await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET_EVIDENCIAS, Key: clave }))).VersionId;
  } catch {
    version = undefined;
  }

  try {
    const respuesta = await textract.send(new DetectDocumentTextCommand({
      Document: { S3Object: { Bucket: config.S3_BUCKET_EVIDENCIAS, Name: clave, Version: version } },
    }));
    const datos = camposDeTarjeta(leerPorPosicion(renglonesDeTextract(respuesta.Blocks ?? [])));

    // Una foto borrosa, recortada o de otra cosa no devuelve nada util. Se
    // avisa, en vez de devolver un formulario vacio que parezca un acierto.
    if (!suficiente(datos)) {
      throw new Error(
        'No se pudieron leer los datos de la licencia. Tome la foto del frente, con buena luz y que el documento llene el encuadre.',
      );
    }
    return datos;
  } finally {
    // Si el borrado falla se deja constancia en el log, pero no se tapa lo que
    // el analisis devolvio. La regla de ciclo de vida del bucket elimina en un
    // dia cualquier resto bajo ocr-tarjetas/.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_EVIDENCIAS, Key: clave, VersionId: version }));
    } catch (fallo) {
      console.error(`No se pudo borrar la tarjeta ${clave} tras analizarla:`, fallo);
    }
  }
};
