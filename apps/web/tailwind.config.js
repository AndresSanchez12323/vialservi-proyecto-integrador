/**
 * Paleta por significado, no por color.
 *
 * La aplicacion tiene dos temas, y un `text-slate-400` sembrado en veinte
 * pantallas no se puede cambiar de tema: habria que duplicar cada clase con su
 * variante `dark:`. Por eso los colores se nombran por lo que SON —tinta
 * tenue, color de marca, color de riesgo— y su valor sale de una variable CSS
 * que `estilos.css` redefine segun el tema. Una clase, dos temas.
 *
 * El formato de las variables es el canal sin funcion («251 191 36») para que
 * Tailwind pueda inyectar la transparencia: `bg-marca-fondo/20` sigue
 * funcionando igual que `bg-amber-400/20`.
 */
const conVariable = (nombre) => `rgb(var(${nombre}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Para los pocos casos que no son color y no se pueden resolver con una
  // variable: el filtro de los mosaicos del mapa, por ejemplo.
  darkMode: ['selector', '[data-tema="oscuro"]'],
  theme: {
    extend: {
      colors: {
        /** Fondo de la pagina. */
        lienzo: conVariable('--lienzo'),
        /** Superficie OPACA: lo que flota sobre el contenido y las listas de un select. */
        superficie: conVariable('--superficie'),
        /**
         * Tinta neutra sobre el lienzo. En el tema oscuro es blanca y en el
         * claro es casi negra, asi que `bg-velo/10` es un velo que aclara en
         * uno y oscurece en el otro, que es justo lo que hace falta.
         */
        velo: conVariable('--velo'),
        /** Texto, de mas a menos presencia. */
        tinta: {
          DEFAULT: conVariable('--tinta'),
          suave: conVariable('--tinta-suave'),
          tenue: conVariable('--tinta-tenue'),
          sutil: conVariable('--tinta-sutil'),
        },
        /** Ambar de VialServi: acento, foco y accion principal. */
        marca: {
          DEFAULT: conVariable('--marca'),
          fondo: conVariable('--marca-fondo'),
          /**
           * Lo que se escribe ENCIMA de un relleno de color lleno: el ambar
           * del boton, el rojo de la pastilla de avisos sin leer. Es tinta
           * oscura en los dos temas, porque esos rellenos son claros en los
           * dos (en el tema oscuro los acentos se aclaran, no se oscurecen).
           */
          tinta: conVariable('--marca-tinta'),
        },
        /** Verde: terminado, correcto, disponible. */
        exito: {
          DEFAULT: conVariable('--exito'),
          fondo: conVariable('--exito-fondo'),
        },
        /** Rojo: fallo, cancelado, destructivo. */
        riesgo: {
          DEFAULT: conVariable('--riesgo'),
          fondo: conVariable('--riesgo-fondo'),
        },
        /** Azul: informacion, ubicacion, distancia. */
        dato: {
          DEFAULT: conVariable('--dato'),
          fondo: conVariable('--dato-fondo'),
        },
        /** Violeta: terminado a la espera de cierre. */
        cierre: {
          DEFAULT: conVariable('--cierre'),
          fondo: conVariable('--cierre-fondo'),
        },
        /** Gris con intencion: sin clasificar, sin dato, inactivo. */
        neutro: {
          DEFAULT: conVariable('--neutro'),
          fondo: conVariable('--neutro-fondo'),
        },
      },
    },
  },
  plugins: [],
};
