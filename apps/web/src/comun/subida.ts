/**
 * Subida de evidencias en tres pasos.
 *
 *   1. pedir al API una URL prefirmada
 *   2. hacer PUT del archivo DIRECTO a S3 (los bytes no pasan por el API)
 *   3. registrar la evidencia con la clave que devolvio el paso 1
 *
 * Estan separados a proposito, y es lo que hara posible el trabajo sin senal:
 * el paso 2 se puede reintentar cuantas veces haga falta sin tocar la base de
 * datos, y como la clave se deriva del idLocal, reintentar SOBREESCRIBE el
 * mismo objeto en lugar de dejar copias huerfanas en el bucket.
 *
 * En modo local (sin cuenta de AWS) el paso 1 devuelve url en null: se salta el
 * 2 y se registra solo la referencia. El flujo de pantalla es idéntico, asi que
 * la demostracion funciona sin AWS.
 */
import { enviar, type Evidencia } from './api';

/** Mismos limites que el API, que es quien los impone de verdad. */
export const LIMITES = {
  FOTO: {
    bytes: 5 * 1024 * 1024,
    accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
    etiqueta: '5 MB',
  },
  VIDEO: {
    bytes: 15 * 1024 * 1024,
    accept: 'video/mp4,video/quicktime,video/webm',
    etiqueta: '15 MB',
  },
} as const;

/** El Alcance fija los clips en diez segundos. */
export const SEGUNDOS_MAX_VIDEO = 10;

export type Subida = {
  clave: string;
  url: string | null;
  expiraEn: number;
  modo: 'local' | 's3';
  encabezados: Record<string, string>;
};

const idLocal = () => `loc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Duracion de un video, leyendola en el navegador antes de subir.
 *
 * Se comprueba aqui porque es el unico lugar donde se puede: el servidor
 * tendria que descargar y analizar el archivo para saber cuanto dura, y para
 * entonces ya lo habria pagado. Un clip de 30 segundos pesa el triple y hay que
 * guardarlo en el dispositivo mientras no hay senal.
 */
const duracionSegundos = (archivo: File): Promise<number | null> =>
  new Promise((resolver) => {
    const url = URL.createObjectURL(archivo);
    const video = document.createElement('video');
    video.preload = 'metadata';

    // Si el navegador no puede leer los metadatos (formato que no reproduce),
    // se deja pasar en vez de bloquear: mejor aceptar la evidencia que
    // perderla por una comprobacion que no se pudo hacer.
    const terminar = (valor: number | null) => {
      URL.revokeObjectURL(url);
      resolver(valor);
    };
    video.onloadedmetadata = () =>
      terminar(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => terminar(null);
    video.src = url;
  });

/** Revisa el archivo antes de pedir la URL. Devuelve el problema, o null. */
export const revisarArchivo = async (
  archivo: File,
  tipo: 'FOTO' | 'VIDEO',
): Promise<string | null> => {
  const limite = LIMITES[tipo];

  if (archivo.size > limite.bytes) {
    const mb = (archivo.size / 1024 / 1024).toFixed(1);
    return `El archivo pesa ${mb} MB y el máximo es ${limite.etiqueta}.`;
  }
  if (archivo.type && !limite.accept.split(',').includes(archivo.type)) {
    return `Formato no admitido (${archivo.type}).`;
  }
  if (tipo === 'VIDEO') {
    const segundos = await duracionSegundos(archivo);
    if (segundos !== null && segundos > SEGUNDOS_MAX_VIDEO + 0.5) {
      return `El clip dura ${segundos.toFixed(1)} s y el máximo son ${SEGUNDOS_MAX_VIDEO} s.`;
    }
  }
  return null;
};

export type Progreso = 'firmando' | 'subiendo' | 'registrando';

/** Recorre los tres pasos. Lanza Error con un mensaje legible si algo falla. */
export const subirEvidencia = async (opciones: {
  expedienteId: number;
  tipo: 'FOTO' | 'VIDEO';
  categoria: string;
  archivo: File;
  alAvanzar?: (paso: Progreso) => void;
}): Promise<Evidencia> => {
  const { expedienteId, tipo, categoria, archivo, alAvanzar } = opciones;
  const id = idLocal();

  alAvanzar?.('firmando');
  const subida = await enviar<Subida>(`/expedientes/${expedienteId}/evidencias/url-subida`, 'POST', {
    idLocal: id,
    tipo,
    categoria,
    contentType: archivo.type || undefined,
    tamano: archivo.size,
  });

  if (subida.url) {
    alAvanzar?.('subiendo');
    // Sin Authorization: la URL ya va firmada, y mandar la cabecera haria que
    // S3 rechazara la peticion. Los encabezados que exige la firma vienen del
    // API para no tener que adivinarlos.
    const respuesta = await fetch(subida.url, {
      method: 'PUT',
      headers: subida.encabezados,
      body: archivo,
    });
    if (!respuesta.ok) {
      throw new Error(
        `No se pudo subir el archivo al almacenamiento (${respuesta.status}). Intente de nuevo.`,
      );
    }
  }

  alAvanzar?.('registrando');
  return enviar<Evidencia>(`/expedientes/${expedienteId}/evidencias`, 'POST', {
    idLocal: id,
    tipo,
    categoria,
    archivo: subida.clave,
    // La hora del DISPOSITIVO, no la del servidor: las evidencias se ordenan
    // por cuando se tomaron. lastModified de un archivo recien capturado con la
    // camara es justo ese momento.
    tomadaEn: new Date(archivo.lastModified || Date.now()).toISOString(),
  });
};
