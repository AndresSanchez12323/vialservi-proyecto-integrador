/**
 * Almacenamiento de las evidencias (fotografias y clips).
 *
 * ── Por que URL prefirmadas y no subir por el API ────────────────────────
 * El navegador sube el archivo DIRECTO a S3 con una URL firmada por el
 * servidor. El API nunca recibe los bytes. Esto no es una optimizacion
 * cosmetica, es lo que hace viable el resto del proyecto:
 *
 *   - Un clip de 10 segundos pesa decenas de megabytes. Pasarlo por el API
 *     obligaria a dimensionar la instancia para mover archivos, y cada subida
 *     ocuparia un proceso que deberia estar atendiendo peticiones.
 *   - Para el TRABAJO SIN SENAL (etapa 2) es la pieza que faltaba. El buzon
 *     del dispositivo guarda el archivo; cuando vuelve la conexion pide una
 *     URL y hace el PUT. Si el PUT falla a la mitad, se repite sin tocar la
 *     base de datos, porque el registro y el archivo van por caminos
 *     separados. Y como la clave se deriva del idLocal, reintentar sobre-
 *     escribe el mismo objeto en vez de duplicarlo.
 *
 * ── Dos modos ────────────────────────────────────────────────────────────
 *   "local": no sube nada, solo devuelve la referencia. Es lo que habia hasta
 *            ahora y permite trabajar y hacer la demostracion sin cuenta de
 *            AWS. La pantalla muestra la referencia, no la imagen.
 *   "s3":    URL prefirmadas de verdad contra el bucket.
 *
 * El bucket es PRIVADO. Nunca se publica: para ver una evidencia se pide una
 * URL de lectura de pocos minutos. Las fotos de una cedula con firma no pueden
 * quedar accesibles con solo adivinar la direccion.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

export type Subida = {
  /** Clave del objeto dentro del bucket. Es lo que se guarda en Evidencia.archivo. */
  clave: string;
  /** URL para hacer PUT del archivo. null en modo local. */
  url: string | null;
  /** Segundos que vive la URL. */
  expiraEn: number;
  modo: 'local' | 's3';
  /** Encabezados que el navegador DEBE enviar en el PUT, o la firma no cuadra. */
  encabezados: Record<string, string>;
};

/**
 * El cliente se crea una sola vez. Las credenciales NO se configuran aqui a
 * proposito: el SDK las toma del rol de IAM de la instancia en AWS y del perfil
 * local en desarrollo. Poner llaves en el codigo o en el .env es justo lo que
 * hay que evitar.
 */
let s3: S3Client | null = null;
const cliente = () => (s3 ??= new S3Client({ region: config.AWS_REGION }));

const TIPOS: Record<string, { mime: string; extension: string }> = {
  FOTO: { mime: 'image/jpeg', extension: 'jpg' },
  VIDEO: { mime: 'video/mp4', extension: 'mp4' },
};

/** Quita de un texto todo lo que no sirva en una clave de S3. */
const limpio = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);

/**
 * Clave del objeto. Se arma con datos que ya identifican la evidencia, y
 * TERMINA en el idLocal: como ese identificador lo genera el dispositivo y es
 * unico, un reintento escribe sobre el mismo objeto en lugar de dejar copias
 * huerfanas en el bucket.
 *
 * El prefijo por expediente permite ademas aplicar reglas de ciclo de vida por
 * carpeta cuando se implemente la retencion de 2+3 anos.
 */
export const claveEvidencia = (datos: {
  expedienteId: number;
  placa: string;
  categoria: string;
  tipo: string;
  idLocal: string;
}): string => {
  const { extension } = TIPOS[datos.tipo] ?? TIPOS.FOTO;
  return [
    'evidencias',
    `exp-${datos.expedienteId}`,
    `${limpio(datos.placa)}-${limpio(datos.categoria)}-${limpio(datos.idLocal)}.${extension}`,
  ].join('/');
};

/** URL prefirmada para que el navegador suba el archivo. */
export const urlDeSubida = async (datos: {
  expedienteId: number;
  placa: string;
  categoria: string;
  tipo: string;
  idLocal: string;
}): Promise<Subida> => {
  const clave = claveEvidencia(datos);
  const { mime } = TIPOS[datos.tipo] ?? TIPOS.FOTO;
  const expiraEn = config.S3_URL_MINUTOS * 60;

  if (config.ALMACENAMIENTO_MODO === 'local') {
    // Sin AWS no hay a donde subir, pero el flujo sigue completo: el cliente
    // registra la evidencia con esta clave y la pantalla la muestra como
    // referencia. Es el comportamiento que tenia el proyecto antes.
    return { clave, url: null, expiraEn, modo: 'local', encabezados: {} };
  }

  const url = await getSignedUrl(
    cliente(),
    new PutObjectCommand({
      Bucket: config.S3_BUCKET_EVIDENCIAS!,
      Key: clave,
      ContentType: mime,
    }),
    { expiresIn: expiraEn },
  );

  // Si el navegador no manda exactamente este Content-Type, S3 rechaza la
  // firma. Se devuelve para que el cliente no tenga que adivinarlo.
  return { clave, url, expiraEn, modo: 's3', encabezados: { 'Content-Type': mime } };
};

/**
 * URL de lectura de pocos minutos. El bucket es privado, asi que esta es la
 * unica forma de ver una evidencia, y caduca.
 */
export const urlDeLectura = async (clave: string): Promise<string | null> => {
  if (config.ALMACENAMIENTO_MODO === 'local') return null;
  return getSignedUrl(
    cliente(),
    new GetObjectCommand({ Bucket: config.S3_BUCKET_EVIDENCIAS!, Key: clave }),
    { expiresIn: config.S3_URL_MINUTOS * 60 },
  );
};

export const almacenamientoActivo = () => config.ALMACENAMIENTO_MODO === 's3';
