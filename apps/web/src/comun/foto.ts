/**
 * Preparacion de la foto de un documento antes de mandarla al OCR.
 *
 * Por que no se sube el archivo tal como sale de la camara:
 *
 *  - La URL prefirmada se firma con Content-Type image/jpeg. Un iPhone entrega
 *    HEIC por omision, y ese PUT lo rechaza S3. Antes la pantalla se limitaba
 *    a decir "seleccione una foto JPG", que en un telefono no se puede cumplir
 *    sin entrar a los ajustes del sistema.
 *  - La camara de un telefono actual da entre 8 y 15 MB, por encima del tope
 *    de 5 MB; y al OCR no le sirve de nada ese tamano, porque el texto de una
 *    tarjeta de propiedad se lee de sobra a 2200 px de lado.
 *
 * Asi que se reencoda en el propio navegador. El redimensionado sube ademas la
 * tasa de acierto: una imagen enorme llega comprimida con mas artefactos.
 */

/** Lado maximo. Por encima de esto el OCR no gana nada y la subida tarda. */
const LADO_MAXIMO = 2200;
const CALIDAD = 0.9;
const TOPE_BYTES = 5 * 1024 * 1024;

const cargarImagen = (archivo: File): Promise<HTMLImageElement> =>
  new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onload = () => {
      URL.revokeObjectURL(url);
      resolver(imagen);
    };
    imagen.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error('No se pudo abrir la imagen.'));
    };
    imagen.src = url;
  });

const aJpeg = (lienzo: HTMLCanvasElement, calidad: number): Promise<Blob> =>
  new Promise((resolver, rechazar) =>
    lienzo.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo convertir la imagen.'))),
      'image/jpeg',
      calidad,
    ),
  );

/**
 * Devuelve la foto como JPEG, redimensionada si hacia falta.
 *
 * Si el navegador no sabe decodificar el formato (un HEIC fuera de Safari, por
 * ejemplo) no se puede hacer nada aqui, y se dice con un mensaje que explique
 * que hacer en lugar del error del canvas.
 */
export const prepararFotoDocumento = async (archivo: File): Promise<File> => {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('Eso no es una imagen. Tome una fotografía del documento.');
  }

  let imagen: HTMLImageElement;
  try {
    imagen = await cargarImagen(archivo);
  } catch {
    throw new Error(
      'Este navegador no pudo abrir esa imagen. Tome la foto con la cámara o elija un archivo JPG o PNG.',
    );
  }

  const ancho = imagen.naturalWidth;
  const alto = imagen.naturalHeight;
  if (!ancho || !alto) throw new Error('La imagen llegó vacía. Tome la foto de nuevo.');

  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);

  const pincel = lienzo.getContext('2d');
  if (!pincel) throw new Error('Este navegador no permite procesar la imagen.');
  // Fondo blanco: un PNG con transparencia quedaria negro al pasar a JPEG, y
  // sobre negro el OCR no lee nada.
  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, lienzo.width, lienzo.height);
  pincel.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);

  let blob = await aJpeg(lienzo, CALIDAD);
  // Una segunda pasada con menos calidad por si la primera sigue pasada de
  // peso. Es raro despues de redimensionar, pero una foto muy ruidosa puede.
  if (blob.size > TOPE_BYTES) blob = await aJpeg(lienzo, 0.72);
  if (blob.size > TOPE_BYTES) {
    throw new Error('La imagen es demasiado pesada. Tome la foto de nuevo, más cerca del documento.');
  }

  return new File([blob], 'tarjeta.jpg', { type: 'image/jpeg', lastModified: Date.now() });
};

/** URL temporal para previsualizar lo que se acaba de tomar. */
export const vistaPrevia = (archivo: File) => URL.createObjectURL(archivo);
export const soltarVistaPrevia = (url: string | null) => {
  if (url) URL.revokeObjectURL(url);
};
