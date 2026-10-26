/**
 * Avisos emergentes de la aplicacion, sobre SweetAlert2.
 *
 * Todo lo que interrumpe al usuario pasa por aqui, para que un error del
 * servidor, una confirmacion de borrado y un acuse de exito se vean y se
 * comporten igual en toda la web, y para que el dia que haya que cambiar el
 * aspecto se cambie en un solo sitio.
 *
 * Criterio de uso, que no es cosmetico:
 *  - RESULTADO DE UNA ACCION del usuario (guardar, borrar, asignar) -> emerge.
 *    El usuario acaba de pulsar algo y espera respuesta.
 *  - ESTADO DE LA VISTA (la consulta fallo, no hay datos) -> NO emerge, se
 *    pinta en la pagina. Un popup cada vez que falla una consulta tapa el
 *    contenido y el usuario no puede hacer nada util con el.
 *  - Lo DESTRUCTIVO se confirma siempre, y el boton peligroso nunca es el que
 *    queda enfocado por defecto.
 */
import Swal, { type SweetAlertOptions } from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

/** Saca un texto legible de lo que sea que haya fallado. */
export const textoDelError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Algo salio mal. Intentelo de nuevo.';
};

// El popup FLOTA sobre el contenido, asi que es opaco: translucido se leeria
// lo de abajo a traves del texto. Mismo criterio que .vidrio-flotante.
const base: SweetAlertOptions = {
  buttonsStyling: false,
  customClass: {
    popup: 'vs-popup',
    title: 'vs-titulo',
    htmlContainer: 'vs-texto',
    confirmButton: 'vs-boton',
    denyButton: 'vs-boton-suave',
    cancelButton: 'vs-boton-suave',
    actions: 'vs-acciones',
    timerProgressBar: 'vs-progreso',
  },
  showClass: { popup: 'vs-entra' },
  hideClass: { popup: 'vs-sale' },
};

/**
 * Los colores NO se pasan por aqui, y es a proposito.
 *
 * `background` y `color` los escribe SweetAlert como estilo en linea del
 * popup, y un estilo en linea es un valor fijo: el aviso se quedaria con el
 * color del tema que hubiera al abrirlo y no cambiaria nunca. Al dejarlos
 * fuera, el color lo pone .vs-popup en estilos.css con las variables del
 * tema, que es lo que se actualiza solo.
 */
const alerta = Swal.mixin(base);

/**
 * Acuse breve de que algo salio bien. No bloquea: aparece en una esquina y se
 * va solo, porque obligar a cerrar un "listo" solo estorba.
 */
export const avisoExito = (texto: string, titulo = '¡Listo!') =>
  alerta.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: titulo,
    text: texto,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
    customClass: { ...base.customClass, popup: 'vs-popup vs-toast' },
  });

/** Lo mismo, pero para algo que el usuario debe saber sin que sea un exito. */
export const avisoInfo = (texto: string, titulo = 'Atencion') =>
  alerta.fire({ icon: 'info', title: titulo, text: texto, confirmButtonText: 'Entendido' });

/**
 * Un fallo. Si bloquea es a proposito: la accion NO se hizo y el usuario tiene
 * que enterarse antes de seguir pulsando.
 */
export const avisoError = (error: unknown, titulo = 'No se pudo completar') =>
  alerta.fire({ icon: 'error', title: titulo, text: textoDelError(error), confirmButtonText: 'Entendido' });

/**
 * Confirmacion previa a algo que no se deshace. Devuelve true solo si el
 * usuario lo acepto expresamente; cerrar con Escape o pulsar fuera es "no".
 */
export const confirmar = async ({
  titulo,
  texto,
  confirmar: textoConfirmar = 'Si, continuar',
  cancelar = 'Cancelar',
  peligro = true,
}: {
  titulo: string;
  texto: string;
  confirmar?: string;
  cancelar?: string;
  peligro?: boolean;
}): Promise<boolean> => {
  const r = await alerta.fire({
    icon: peligro ? 'warning' : 'question',
    title: titulo,
    text: texto,
    showCancelButton: true,
    confirmButtonText: textoConfirmar,
    cancelButtonText: cancelar,
    // El foco arranca en Cancelar: que un Enter de mas no borre nada.
    focusCancel: peligro,
    reverseButtons: true,
    customClass: {
      ...base.customClass,
      confirmButton: peligro ? 'vs-boton-peligro' : 'vs-boton',
    },
  });
  return r.isConfirmed;
};

/**
 * Espera visible para lo que tarda de verdad. En AWS la base se pausa y la
 * primera peticion puede tardar unos 25 segundos: sin esto el usuario cree que
 * la aplicacion se colgo y vuelve a pulsar.
 */
export const avisoEsperando = (texto = 'Un momento…') =>
  alerta.fire({
    title: texto,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading(),
  });

export const cerrarAviso = () => Swal.close();
