import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AnalyzeDocumentCommand, TextractClient } from '@aws-sdk/client-textract';
import { config } from './config.js';

export type DatosTarjeta = {
  placa: string;
  marca: string;
  modelo: string;
  color: string;
};

const textract = new TextractClient({ region: config.AWS_REGION });
const s3 = new S3Client({ region: config.AWS_REGION });

const aliasCampo: Record<string, keyof DatosTarjeta> = {
  PLACA: 'placa',
  MARCA: 'marca',
  LINEA: 'modelo',
  MODELO: 'modelo',
  COLOR: 'color',
};

const textoDe = (bloque: { Text?: string } | undefined) => bloque?.Text?.trim() ?? '';

const limpiarPlaca = (valor: string) =>
  valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/**
 * Extrae los campos que necesitamos de una tarjeta de propiedad.
 * La foto se elimina siempre al terminar: no es una evidencia del servicio.
 */
export const analizarTarjeta = async (clave: string): Promise<DatosTarjeta> => {
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
      QueriesConfig: {
        Queries: [
          { Text: 'What is the vehicle license plate?', Alias: 'PLACA' },
          { Text: 'What is the vehicle make or brand?', Alias: 'MARCA' },
          { Text: 'What is the vehicle line or model?', Alias: 'MODELO' },
          { Text: 'What is the vehicle color?', Alias: 'COLOR' },
        ],
      },
    }));

    const bloques = new Map((respuesta.Blocks ?? []).map((bloque) => [bloque.Id, bloque]));
    const datos: Partial<DatosTarjeta> = {};
    for (const bloque of respuesta.Blocks ?? []) {
      if (bloque.BlockType !== 'QUERY' || !bloque.Query?.Alias) continue;
      const alias = aliasCampo[bloque.Query.Alias.toUpperCase()];
      const relacion = bloque.Relationships?.find((r) => r.Type === 'ANSWER');
      const resultado = relacion?.Ids?.map((id) => bloques.get(id)).find(Boolean);
      if (alias && resultado) datos[alias] = textoDe(resultado);
    }

    const placa = limpiarPlaca(datos.placa ?? '');
    const marca = datos.marca?.trim() ?? '';
    const modelo = datos.modelo?.trim() ?? '';
    const color = datos.color?.trim() ?? '';
    if (!placa || placa.length < 5 || !marca || !modelo || !color) {
      throw new Error('No se pudieron leer todos los datos. Tome una foto clara y completa.');
    }
    return { placa, marca, modelo, color };
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
