// Tarea temporal dentro de la VPC. No imprime URLs, contrasenas ni filas.
import pg from 'pg';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const { Client } = pg;
const ca = await readFile('/app/rds-ca.pem', 'utf8');
const origen = new URL(process.env.DATABASE_URL);
const destino = {
  host: process.env.DESTINO_HOST, port: 5432, database: 'vialservi',
  user: 'vialservi', password: process.env.DESTINO_CLAVE,
};
if (!destino.host?.startsWith('vialservi-aurora.') || !destino.password || origen.hostname === destino.host) {
  throw new Error('Destino no autorizado: se exige el cluster nuevo vialservi-aurora y no la base de origen.');
}
const src = new Client({
  host: origen.hostname, port: Number(origen.port || 5432),
  user: decodeURIComponent(origen.username), password: decodeURIComponent(origen.password),
  database: origen.pathname.slice(1), ssl: { ca, rejectUnauthorized: true },
});
const dst = new Client({ ...destino, ssl: { ca, rejectUnauthorized: true } });

const identificador = (s) => '"' + s.replaceAll('"', '""') + '"';
async function inventario(client) {
  await client.query("SET timezone = 'UTC'");
  const tablas = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const resultado = {};
  for (const { tablename } of tablas.rows) {
    const { rows } = await client.query(`SELECT count(*)::text AS filas,
      md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS huella
      FROM public.${identificador(tablename)} t`);
    resultado[tablename] = rows[0];
  }
  const secuencias = await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  for (const { sequencename } of secuencias.rows) {
    const { rows } = await client.query(`SELECT last_value::text, is_called FROM public.${identificador(sequencename)}`);
    resultado[`secuencia:${sequencename}`] = rows[0];
  }
  return resultado;
}
function ejecutar(binario, args, conexion) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(binario, args, {
      env: {
        ...process.env, PGHOST: conexion.host, PGPORT: String(conexion.port),
        PGUSER: conexion.user, PGPASSWORD: conexion.password, PGDATABASE: conexion.database,
        PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/app/rds-ca.pem',
      }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    // No volcar stderr: un diagnostico podria incluir datos de una fila.
    hijo.stderr.resume();
    hijo.on('error', reject);
    hijo.on('exit', (codigo) => codigo === 0 ? resolve() : reject(new Error(`${binario} fallo con codigo ${codigo}; revisar conectividad/permisos.`)));
  });
}
await src.connect();
await dst.connect();
try {
  const antes = await inventario(src);
  const existentes = await inventario(dst);
  if (Object.keys(existentes).length && process.env.MIGRACION_FINAL !== 'true') {
    throw new Error('La base de destino no esta vacia. Para la copia final se exige MIGRACION_FINAL=true y escrituras detenidas.');
  }
  await ejecutar('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file=/tmp/vialservi.dump'], {
    host: origen.hostname, port: Number(origen.port || 5432), user: decodeURIComponent(origen.username),
    password: decodeURIComponent(origen.password), database: origen.pathname.slice(1),
  });
  const archivo = await readFile('/tmp/vialservi.dump');
  await new S3Client({}).send(new PutObjectCommand({
    Bucket: process.env.BUCKET_COPIA, Key: `migracion-aurora/${process.env.ID_COPIA}.dump`,
    Body: archivo, ServerSideEncryption: 'AES256',
  }));
  await ejecutar('pg_restore', [
    '--dbname=vialservi', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction',
    ...(process.env.MIGRACION_FINAL === 'true' ? ['--clean', '--if-exists'] : []), '/tmp/vialservi.dump',
  ], destino);
  const despues = await inventario(src);
  const migrado = await inventario(dst);
  if (JSON.stringify(antes) !== JSON.stringify(despues)) throw new Error('El origen cambio durante la copia: repetir con escrituras detenidas antes de activar Lambda.');
  if (JSON.stringify(despues) !== JSON.stringify(migrado)) throw new Error('Las huellas/tablas/secuencias NO coinciden; no activar Lambda.');
  console.log(JSON.stringify({ resultado: 'COPIA_VERIFICADA', inventario: migrado }));
} finally {
  await src.end(); await dst.end();
}
