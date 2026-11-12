import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error('Indique manifiesto origen y destino');
const [source, target] = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
if (!isDeepStrictEqual(source, target)) {
  console.error('DIFERENCIA: conteos, huellas o secuencias no coinciden. Detener el corte.');
  process.exitCode = 1;
} else console.log('COPIA IDENTICA: todas las tablas, huellas y secuencias coinciden.');
