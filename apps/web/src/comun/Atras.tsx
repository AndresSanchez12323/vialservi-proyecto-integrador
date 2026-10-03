import { useLocation, useNavigate } from 'react-router-dom';
import { sesion } from './api';

/** Inicio de cada rol: es lo más atrás posible dentro de la aplicación. */
export const inicioPorRol = () => {
  const rol = sesion.rol();
  return rol === 'TECNICO' || rol === 'CLIENTE' ? '/servicios' : '/panel';
};

/** Vuelve a la página anterior sin salir nunca de la zona autenticada:
 *  en el inicio del rol ya no hay más atrás y el botón se deshabilita.
 *  La sesión solo se cierra con Salir. */
export function Atras({ destino }: { destino?: string }) {
  const navegar = useNavigate();
  const donde = useLocation().pathname;
  const inicio = inicioPorRol();
  const alTope = !destino && (donde === inicio || donde === '/login');

  const volver = () => {
    if (destino) {
      navegar(destino);
      return;
    }
    if (!alTope && window.history.length > 1) {
      navegar(-1);
      return;
    }
    navegar(inicio);
  };

  return (
    <button
      onClick={volver}
      disabled={alTope}
      className="boton-suave"
      title={alTope ? 'Ya está en el inicio' : 'Volver atrás'}
    >
      ← Atrás
    </button>
  );
}
