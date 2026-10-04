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
  contentType?: string;
}): string => {
  const extension =
    (datos.contentType && EXTENSIONES[datos.contentType]) ??
    (TIPOS[datos.tipo] ?? TIPOS.FOTO).extension;
  return [
    'evidencias',
    `exp-${datos.expedienteId}`,
    `${limpio(datos.placa)}-${limpio(datos.categoria)}-${limpio(datos.idLocal)}.${extension}`,
  ].join('/');
};

/**
 * URL prefirmada para que el navegador suba el archivo.
 *
 * Se firma con el tipo y el tamano que declara el cliente. Eso no es un
 * detalle: la firma ATA el PUT a esos valores, asi que un archivo mas grande
 * que el limite no se puede subir aunque alguien llame al API sin pasar por la
 * pantalla.
 */
export const urlDeSubida = async (datos: {
  expedienteId: number;
  placa: string;
  categoria: string;
  tipo: string;
  idLocal: string;
  contentType?: string;
  tamano?: number;
}): Promise<Subida> => {
  const clave = claveEvidencia(datos);
  const mime = datos.contentType ?? (TIPOS[datos.tipo] ?? TIPOS.FOTO).mime;
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
      // Firmar el tamano es lo que convierte el limite en una regla y no en
      // una sugerencia de la interfaz.
      ...(datos.tamano ? { ContentLength: datos.tamano } : {}),
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

// ── Limites de los archivos ──────────────────────────────────────────────
// Son los del Alcance del proyecto: 5 MB por fotografia y 15 MB por clip.
// Se imponen FIRMANDO la URL con el tamano declarado (ContentLength): si el
// navegador sube mas o menos bytes de los que dijo, S3 rechaza el PUT. Validar
// solo en la pantalla no serviria, porque cualquiera puede llamar al API
// directamente y subir un archivo de gigabytes.
export const LIMITES: Record<string, { bytes: number; mimes: string[] }> = {
  FOTO: {
    bytes: 5 * 1024 * 1024,
    // heic porque es el formato por omision de los iPhone.
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  },
  VIDEO: {
    bytes: 15 * 1024 * 1024,
    // quicktime es lo que graba un iPhone; webm, varios Android.
    mimes: ['video/mp4', 'video/quicktime', 'video/webm'],
  },
};

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};
