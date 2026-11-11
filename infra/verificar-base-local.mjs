/**
 * Guarda de seguridad previa a las pruebas del despliegue.
 *
 * Las pruebas ESCRIBEN y borran datos. Si DATABASE_URL apuntara a Aurora,
 * una corrida arrasaria la operacion real. Aqui se corta antes de llegar.
 *
 * Vive en un archivo y no incrustado en el .ps1 a proposito: PowerShell
 * descarta las comillas dobles al pasar un programa inline a node, y el
 * guardian fallaba por sintaxis en vez de comprobar lo que debia.
 */
import dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.env', quiet: true });

const LOCALES = ['localhost', '127.0.0.1', '[::1]', '::1'];
const cadena = process.env.DATABASE_URL;

if (!cadena) {
  console.error('Pruebas bloqueadas: no hay DATABASE_URL en apps/api/.env');
  process.exit(1);
}

let host;
try {
  host = new URL(cadena).hostname;
} catch {
  console.error('Pruebas bloqueadas: DATABASE_URL no es una URL valida');
  process.exit(1);
}

if (!LOCALES.includes(host)) {
  console.error(`Pruebas bloqueadas: DATABASE_URL apunta a ${host}, que no es local`);
  process.exit(1);
}

console.log(`Base local confirmada (${host}); las pruebas pueden escribir.`);
