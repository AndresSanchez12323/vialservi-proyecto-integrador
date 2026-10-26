/**
 * Tema claro y oscuro.
 *
 * Tres estados, no dos: claro, oscuro y «el del sistema». El tercero no es un
 * adorno —es el que trae la aplicacion de fabrica— y hace que quien tenga el
 * telefono en modo noche vea la aplicacion oscura sin tocar nada, y que al
 * amanecer cambie con el. En cuanto la persona elige un tema a mano, su
 * eleccion manda y deja de seguir al sistema.
 *
 * El valor efectivo se escribe como `data-tema` en <html>, que es de donde lo
 * leen las variables de estilos.css. Ademas lo aplica un guion en linea en
 * index.html antes del primer pintado: si se aplicara aqui, al arrancar React,
 * la pagina asomaria un instante con el tema que no es.
 */
import { useEffect, useState } from 'react';

export type Preferencia = 'claro' | 'oscuro' | 'sistema';
export type Tema = 'claro' | 'oscuro';

const LLAVE = 'vialservi.tema';

/** El color de la barra del navegador en movil, para que no corte el diseño. */
const BARRA: Record<Tema, string> = { oscuro: '#0b1220', claro: '#f6f7fb' };

const consultaOscuro = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export const temaDelSistema = (): Tema => (consultaOscuro()?.matches ? 'oscuro' : 'claro');

export const preferenciaGuardada = (): Preferencia => {
  try {
    const valor = localStorage.getItem(LLAVE);
    return valor === 'claro' || valor === 'oscuro' ? valor : 'sistema';
  } catch {
    // Navegacion privada o almacenamiento bloqueado: se sigue al sistema.
    return 'sistema';
  }
};

export const temaEfectivo = (preferencia: Preferencia): Tema =>
  preferencia === 'sistema' ? temaDelSistema() : preferencia;

/** Deja el tema puesto en el documento. Es el unico sitio que toca el DOM. */
export const aplicarTema = (tema: Tema) => {
  document.documentElement.dataset.tema = tema;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', BARRA[tema]);
};

// Un solo origen de la verdad para toda la aplicacion: la cabecera y la
// landing tienen cada una su interruptor, y los dos deben moverse juntos.
const oyentes = new Set<(p: Preferencia) => void>();
let preferenciaActual: Preferencia = preferenciaGuardada();

export const cambiarTema = (preferencia: Preferencia) => {
  preferenciaActual = preferencia;
  try {
    if (preferencia === 'sistema') localStorage.removeItem(LLAVE);
    else localStorage.setItem(LLAVE, preferencia);
  } catch {
    // Sin almacenamiento el tema vale para esta sesion y nada mas.
  }
  aplicarTema(temaEfectivo(preferencia));
  for (const avisar of oyentes) avisar(preferencia);
};

/**
 * Estado del tema para un componente. Devuelve la preferencia, el tema que se
 * esta viendo de verdad y como cambiarlo.
 */
export const useTema = () => {
  const [preferencia, setPreferencia] = useState<Preferencia>(preferenciaActual);
  const [tema, setTema] = useState<Tema>(() => temaEfectivo(preferenciaActual));

  useEffect(() => {
    const alCambiar = (p: Preferencia) => {
      setPreferencia(p);
      setTema(temaEfectivo(p));
    };
    oyentes.add(alCambiar);

    // Si se sigue al sistema y la persona cambia el modo del telefono, la
    // aplicacion cambia con el sin recargar.
    const consulta = consultaOscuro();
    const alCambiarSistema = () => {
      if (preferenciaActual === 'sistema') {
        aplicarTema(temaDelSistema());
        setTema(temaDelSistema());
      }
    };
    consulta?.addEventListener('change', alCambiarSistema);

    // Al montar se reafirma: si el guion en linea no corrio —una vista previa,
    // una prueba— aqui queda puesto de todas formas.
    aplicarTema(temaEfectivo(preferenciaActual));

    return () => {
      oyentes.delete(alCambiar);
      consulta?.removeEventListener('change', alCambiarSistema);
    };
  }, []);

  return { preferencia, tema, cambiarTema };
};
