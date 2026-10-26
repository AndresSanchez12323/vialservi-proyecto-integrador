import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AnalyzeDocumentCommand, TextractClient } from '@aws-sdk/client-textract';
import { config } from './config.js';

/**
 * Datos que se pueden leer de una licencia de transito (tarjeta de propiedad).
 *
 * TODOS son opcionales porque una sola foto nunca trae el documento completo:
 * los datos del vehiculo van impresos en el frente y los del propietario en el
 * reverso. Cada lectura devuelve lo que vio, y quien la pide va juntando las
 * dos caras. Un campo ausente no es un error; inventarlo si lo seria.
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

/** Cara del documento. El frente y el reverso no llevan lo mismo impreso. */
export type CaraTarjeta = 'frente' | 'reverso';

const textract = new TextractClient({ region: config.AWS_REGION });
const s3 = new S3Client({ region: config.AWS_REGION });

const aliasCampo: Record<string, keyof DatosTarjeta> = {
  PLACA: 'placa',
  MARCA: 'marca',
  LINEA: 'linea',
  MODELO: 'modelo',
  COLOR: 'color',
  CLASE: 'clase',
  LICENCIA: 'licenciaTransito',
  VIN: 'vin',
  CHASIS: 'chasis',
  MOTOR: 'motor',
  PROPIETARIO: 'propietarioNombre',
  PROPIETARIO_DOC: 'propietarioDocumento',
};

/**
 * Preguntas por cara.
 *
 * Textract con FeatureTypes=QUERIES no busca rotulos, pregunta por el dato, y
 * eso aguanta que cada licencia reparta las etiquetas a su manera. Se pregunta
 * en ingles porque es el idioma en el que el modelo de consultas rinde mejor,
 * aunque el documento este en español.
 *
 * El frente pregunta tambien por el propietario y el reverso por la placa: hay
 * formatos que los imprimen al otro lado, y preguntar de mas no cuesta una
 * llamada extra —viajan todas en la misma— mientras que no preguntar deja el
 * campo vacio sin remedio.
 */
const PREGUNTAS: Record<CaraTarjeta, { Text: string; Alias: string }[]> = {
  frente: [
    { Text: 'What is the vehicle license plate?', Alias: 'PLACA' },
    { Text: 'What is the vehicle make or brand?', Alias: 'MARCA' },
    { Text: 'What is the vehicle line?', Alias: 'LINEA' },
    { Text: 'What is the vehicle model year?', Alias: 'MODELO' },
    { Text: 'What is the vehicle color?', Alias: 'COLOR' },
    { Text: 'What is the vehicle class or type?', Alias: 'CLASE' },
    { Text: 'What is the registration or license number?', Alias: 'LICENCIA' },
    { Text: 'What is the VIN number?', Alias: 'VIN' },
    { Text: 'What is the chassis number?', Alias: 'CHASIS' },
    { Text: 'What is the engine number?', Alias: 'MOTOR' },
    { Text: 'What is the name of the owner?', Alias: 'PROPIETARIO' },
    { Text: 'What is the identification number of the owner?', Alias: 'PROPIETARIO_DOC' },
  ],
  reverso: [
    { Text: 'What is the name of the owner?', Alias: 'PROPIETARIO' },
    { Text: 'What is the identification number of the owner?', Alias: 'PROPIETARIO_DOC' },
    { Text: 'What is the registration or license number?', Alias: 'LICENCIA' },
    { Text: 'What is the vehicle license plate?', Alias: 'PLACA' },
    { Text: 'What is the VIN number?', Alias: 'VIN' },
    { Text: 'What is the chassis number?', Alias: 'CHASIS' },
    { Text: 'What is the engine number?', Alias: 'MOTOR' },
  ],
};

const textoDe = (bloque: { Text?: string } | undefined) => bloque?.Text?.trim() ?? '';

const limpiarPlaca = (valor: string) =>
  valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Los identificadores del documento son alfanumericos y van en mayusculas. */
const limpiarSerie = (valor: string) =>
  valor.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);

const limpiarDocumento = (valor: string) => valor.replace(/[^0-9]/g, '').slice(0, 15);

/**
 * Textract contesta "not found" o deja la respuesta vacia cuando el dato no
 * figura. Esas respuestas se descartan: un campo con la palabra "none" dentro
 * es peor que un campo vacio, porque el usuario lo guardaria sin mirarlo.
 *
 * La comprobacion se hace sobre las LETRAS de la respuesta, no sobre el texto
 * literal, y ANTES de limpiarla. Las dos cosas importan: "Not Found." con
 * punto no coincide con una comparacion literal, y limpiar primero quitaba el
 * espacio de "NOT FOUND" y lo convertia en "NOTFOUND", que ya no coincidia con
 * nada y se guardaba como si fuera un VIN.
 */
const SIN_DATO = /^(na|none|notfound|noaplica|sindato|nodisponible|desconocido|null)$/i;

const sirve = (valor: string) => {
  const texto = valor.trim();
  if (!texto) return false;
  const letras = texto.replace(/[^a-z]/gi, '').toLowerCase();
  // Sin letras solo sirve si al menos trae un digito: asi pasa un modelo como
  // "2018" y se cae un guion o unos puntos suspensivos.
  return letras ? !SIN_DATO.test(letras) : /\d/.test(texto);
};

/** Deja el campo fuera del objeto si no vino o si no dice nada. */
const tomar = (
  campo: keyof DatosTarjeta,
  valor: string | undefined,
  limpiar: (v: string) => string = (v) => v.trim(),
): DatosTarjeta => {
  const crudo = (valor ?? '').trim();
  if (!sirve(crudo)) return {};
  const limpio = limpiar(crudo);
  return limpio ? { [campo]: limpio } : {};
};

/**
 * Arma los campos a partir de lo que contesto Textract, alias por alias.
 *
 * Esta separado del llamado a AWS a proposito: es donde se decide que se
 * guarda y que se tira, o sea, lo unico que de verdad hay que poder probar
 * sin una cuenta de AWS delante.
 */
export const camposDeTarjeta = (crudo: Partial<Record<keyof DatosTarjeta, string>>): DatosTarjeta => {
  // La placa pasa por el mismo filtro que los demas campos ANTES de limpiarse.
  // Sin eso, un "not found" quedaba en "NOTFOU" —seis caracteres, longitud
  // valida— y la lectura fallida se devolvia como un acierto con esa placa.
  const dePlaca = (crudo.placa ?? '').trim();
  const placa = sirve(dePlaca) ? limpiarPlaca(dePlaca) : '';

  return {
    // La placa solo se acepta completa: media placa mal leida es peor que
    // ninguna, porque es el identificador del vehiculo en todo el sistema.
    ...(placa.length >= 5 ? { placa } : {}),
    ...tomar('marca', crudo.marca),
    ...tomar('modelo', crudo.modelo),
    ...tomar('color', crudo.color),
    ...tomar('linea', crudo.linea),
    ...tomar('clase', crudo.clase),
    ...tomar('licenciaTransito', crudo.licenciaTransito, limpiarSerie),
    ...tomar('vin', crudo.vin, limpiarSerie),
    ...tomar('chasis', crudo.chasis, limpiarSerie),
    ...tomar('motor', crudo.motor, limpiarSerie),
    ...tomar('propietarioNombre', crudo.propietarioNombre),
    ...tomar('propietarioDocumento', crudo.propietarioDocumento, limpiarDocumento),
  };
};

/**
 * Cuando una lectura cuenta como aprovechable.
 *
 * El criterio no es "estan todos los campos": muchas licencias no imprimen
 * chasis ni linea, y exigirlos rechazaria fotos perfectamente buenas. Lo que
 * se comprueba es que la foto sea del documento esperado.
 */
const suficiente = (datos: DatosTarjeta, cara: CaraTarjeta): boolean => {
  if (cara === 'frente') {
    return (
      !!datos.placa &&
      [datos.marca, datos.linea, datos.modelo, datos.color, datos.vin, datos.clase].some(Boolean)
    );
  }
  return !!(datos.propietarioNombre || datos.propietarioDocumento || datos.licenciaTransito);
};

/**
 * Lee una cara de la tarjeta de propiedad y devuelve los campos que encontro.
 * La foto se elimina siempre al terminar: no es una evidencia del servicio.
 */
export const analizarTarjeta = async (
  clave: string,
  cara: CaraTarjeta = 'frente',
): Promise<DatosTarjeta> => {
  if (config.OCR_MODO !== 'aws' || !config.S3_BUCKET_EVIDENCIAS) {
    throw new Error('La lectura automática requiere OCR AWS configurado.');
  }
  if (!/^ocr-tarjetas\/[a-z0-9-]+\.jpg$/i.test(clave)) {
    throw new Error('Referencia de tarjeta invalida.');
  }

  try {
    const respuesta = await textract.send(new AnalyzeDocumentCommand({
      Document: { S3Object: { Bucket: config.S3_BUCKET_EVIDENCIAS, Name: clave } },
      FeatureTypes: ['QUERIES'],
      QueriesConfig: { Queries: PREGUNTAS[cara] },
    }));

    const bloques = new Map((respuesta.Blocks ?? []).map((bloque) => [bloque.Id, bloque]));
    const crudo: Partial<Record<keyof DatosTarjeta, string>> = {};
    for (const bloque of respuesta.Blocks ?? []) {
      if (bloque.BlockType !== 'QUERY' || !bloque.Query?.Alias) continue;
      const campo = aliasCampo[bloque.Query.Alias.toUpperCase()];
      const relacion = bloque.Relationships?.find((r) => r.Type === 'ANSWER');
      const resultado = relacion?.Ids?.map((id) => bloques.get(id)).find(Boolean);
      if (campo && resultado) crudo[campo] = textoDe(resultado);
    }

    const datos = camposDeTarjeta(crudo);

    // Una foto borrosa, recortada o de otra cosa no devuelve nada util. Se
    // avisa, en vez de devolver un formulario vacio que parezca un acierto.
    if (!suficiente(datos, cara)) {
      throw new Error(
        cara === 'frente'
          ? 'No se pudieron leer los datos del frente. Tome la foto de frente, con buena luz y que el documento llene el encuadre.'
          : 'No se pudieron leer los datos del reverso. Compruebe que fotografió el lado donde figura el propietario.',
      );
    }
    return datos;
  } finally {
    // La foto lleva datos personales y no es evidencia del servicio, asi que
    // se descarta siempre. Si el borrado falla se deja constancia en el log,
    // pero no se tapa lo que el analisis devolvio: un fallo al limpiar no
    // puede costarle al usuario el resultado, ni ocultar el error de verdad.
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: config.S3_BUCKET_EVIDENCIAS,
        Key: clave,
      }));
    } catch (fallo) {
      console.error(`No se pudo borrar la tarjeta ${clave} tras analizarla:`, fallo);
    }
  }
};
