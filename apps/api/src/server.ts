import { createServer } from 'node:http';
import { crearApp } from './app.js';
import { config } from './config.js';
import { prisma } from './prisma.js';

/**
 * Se escucha en 0.0.0.0 y no en localhost: dentro de un contenedor, un proceso
 * atado a localhost no es alcanzable desde fuera y el balanceador lo veria
 * caido aunque este perfectamente vivo.
 */
const servidor = createServer(crearApp());

servidor.listen(config.puerto, '0.0.0.0', () => {
  console.log(
    `API de VialServi escuchando en el puerto ${config.puerto} ` +
      `(entorno ${config.NODE_ENV}, almacenamiento ${config.ALMACENAMIENTO_MODO}, correo ${config.CORREO_MODO})`,
  );
});

/**
 * Apagado ordenado.
 *
 * Al desplegar, AWS manda SIGTERM y espera unos segundos antes de matar el
 * proceso. Sin esto, las peticiones en curso se cortan a mitad —el usuario ve
 * un error en una subida que iba bien— y las conexiones a RDS quedan abiertas
 * hasta que la base las expira, consumiendo cupo de conexiones.
 *
 * El orden es: dejar de aceptar conexiones nuevas, terminar las que estan en
 * curso y solo entonces cerrar la base.
 */
let apagando = false;

const apagar = async (senal: string) => {
  if (apagando) return; // SIGTERM puede llegar mas de una vez
  apagando = true;
  console.log(`[${senal}] cerrando el servidor...`);

  // Si algo se queda colgado, no se puede esperar indefinidamente: la
  // plataforma mata el proceso de todas formas y es mejor salir ordenado.
  const plazo = setTimeout(() => {
    console.error('[apagado] el cierre tardo demasiado, se fuerza la salida');
    process.exit(1);
  }, 10_000);
  plazo.unref();

  servidor.close(async () => {
    try {
      await prisma.$disconnect();
      console.log('[apagado] servidor y base de datos cerrados');
      process.exit(0);
    } catch (error) {
      console.error('[apagado] error al cerrar la base:', error);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));

/**
 * Una promesa rechazada sin capturar tumba el proceso en Node moderno. Se
 * registra para poder encontrarla en CloudWatch en lugar de ver un contenedor
 * que se reinicia sin explicacion.
 */
process.on('unhandledRejection', (razon) => {
  console.error('[promesa rechazada sin capturar]', razon);
});
process.on('uncaughtException', (error) => {
  console.error('[excepcion no capturada]', error);
  void apagar('uncaughtException');
});
