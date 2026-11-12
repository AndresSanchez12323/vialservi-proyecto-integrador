// Ejecutar solo durante el despliegue FUTURO. Data API usa el ARN del secreto;
// este programa nunca pide GetSecretValue, ni imprime filas, SQL o credenciales.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { RDSDataClient, ExecuteStatementCommand, BeginTransactionCommand,
  CommitTransactionCommand, RollbackTransactionCommand } from '@aws-sdk/client-rds-data';
import { splitSql } from './sql.mjs';
import { restoreBackup } from './restore.mjs';

const [mode, ...args] = process.argv.slice(2);
const option = (key) => { const i = args.indexOf(`--${key}`); return i < 0 ? undefined : args[i + 1]; };
if (!['migrate', 'inventory', 'restore'].includes(mode)) throw new Error('Use migrate, restore o inventory; lea Terraform/README.md');
const profile = option('profile'), account = option('account'), region = option('region');
if (!profile || !/^\d{12}$/.test(account ?? '') || region !== 'us-east-1') throw new Error('Perfil, cuenta y region explicitos obligatorios');
const source = args.includes('--source-read-only');
if (source && mode !== 'inventory') throw new Error('Origen solo admite inventario de lectura');
if (!source && ['102098709715', '497502378363'].includes(account)) throw new Error('Escritura sobre las cuentas originales prohibida');
if (account === '497502378363') throw new Error('Cuenta educativa excluida de VialServi');
const identity = JSON.parse(execFileSync('aws', ['sts', 'get-caller-identity', '--profile', profile, '--region', region, '--output', 'json'], { encoding: 'utf8' }));
if (identity.Account !== account) throw new Error('STS no coincide con la cuenta esperada');
process.env.AWS_PROFILE = profile;
process.env.AWS_REGION = region;
const root = fileURLToPath(new URL('../', import.meta.url));
let cluster = option('cluster'), secret = option('secret');
if (!cluster || !secret) {
  if (source) throw new Error('Origen requiere ARN de cluster y secreto explicitos');
  const outputs = JSON.parse(execFileSync('terraform', [`-chdir=${root}`, 'output', '-json'], { encoding: 'utf8' }));
  cluster = outputs.cluster_arn.value; secret = outputs.database_secret_arn.value;
}
for (const arn of [cluster, secret]) if (arn.split(':')[4] !== account || arn.split(':')[3] !== region) throw new Error('ARN fuera de cuenta o region autorizadas');
const client = new RDSDataClient({ region });
const connection = { resourceArn: cluster, secretArn: secret, database: 'vialservi' };
async function execute(sql, transactionId, parameters = []) {
  for (let attempt = 0; ; attempt++) {
    try { return await client.send(new ExecuteStatementCommand({ ...connection, sql, transactionId, parameters, formatRecordsAs: 'JSON' })); }
    catch (error) {
      // Solo DatabaseResumingException: AWS aun NO ha ejecutado la sentencia.
      if (error.name !== 'DatabaseResumingException' || attempt >= 5) throw new Error(`Data API fallo (${error.name}); no se reintento una escritura ambigua`);
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}
const rows = (result) => JSON.parse(result.formattedRecords ?? '[]');
const param = (name, value) => ({ name, value: { stringValue: value } });
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';

if (mode === 'inventory') {
  const manifest = { tables: {}, sequences: {} };
  await execute('SELECT 1'); // Aurora puede estar pausada antes del inventario.
  const { transactionId } = await client.send(new BeginTransactionCommand(connection));
  try {
    await execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY', transactionId);
    await execute("SET timezone = 'UTC'", transactionId);
    const tables = rows(await execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", transactionId));
    for (const { tablename } of tables) {
      const result = rows(await execute(`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM public.${identifier(tablename)} t`, transactionId));
      manifest.tables[tablename] = result[0];
    }
    const sequences = rows(await execute("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename", transactionId));
    for (const { sequencename } of sequences) {
      manifest.sequences[sequencename] = rows(await execute(`SELECT last_value::text AS last_value, is_called FROM public.${identifier(sequencename)}`, transactionId))[0];
    }
    await client.send(new CommitTransactionCommand({ ...connection, transactionId }));
  } catch (error) {
    await client.send(new RollbackTransactionCommand({ ...connection, transactionId })).catch(() => {});
    throw error;
  }
  if (!option('manifest')) throw new Error('Indique --manifest ruta.json para guardar solo conteos y huellas');
  await writeFile(option('manifest'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log('Inventario guardado: conteos, huellas y secuencias; no se exportaron filas');
} else if (mode === 'migrate') {
  if (!args.includes('--approve-destination-schema')) throw new Error('Se requiere --approve-destination-schema; inventariar la copia antes de modificar el esquema');
  await execute('SELECT 1'); // reactiva antes de comenzar transacciones
  await execute(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
  const directory = new URL('../../apps/api/prisma/migrations/', import.meta.url);
  const migrations = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  for (const name of migrations) {
    const contents = await readFile(new URL(`${name}/migration.sql`, directory));
    // Prisma acepta LF y CRLF: Git en Windows puede convertir los archivos.
    const lf = contents.toString('utf8').replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(lf).digest('hex');
    const acceptedChecksums = new Set([checksum,
      createHash('sha256').update(contents).digest('hex'),
      createHash('sha256').update(lf.replace(/\n/g, '\r\n')).digest('hex')]);
    const { transactionId } = await client.send(new BeginTransactionCommand(connection));
    try {
      await execute("SELECT pg_advisory_xact_lock(hashtext('vialservi-terraform-schema'))", transactionId);
      const existing = rows(await execute('SELECT checksum, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name=:name', transactionId, [param('name', name)]));
      if (existing.length) {
        if (existing.length !== 1 || !acceptedChecksums.has(existing[0].checksum) || !existing[0].finished_at || existing[0].rolled_back_at) throw new Error(`Migracion divergente o incompleta: ${name}`);
      } else {
        for (const statement of splitSql(contents.toString('utf8'))) await execute(statement, transactionId);
        await execute('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (:id,:checksum,:name,now(),1)', transactionId,
          [param('id', randomUUID()), param('checksum', checksum), param('name', name)]);
      }
      await client.send(new CommitTransactionCommand({ ...connection, transactionId }));
      console.log(`Migracion comprobada: ${name}`);
    } catch (error) {
      await client.send(new RollbackTransactionCommand({ ...connection, transactionId })).catch(() => {});
      throw error;
    }
  }
} else {
  // restore: carga la copia local de datos en el destino, con las migraciones ya aplicadas.
  if (!args.includes('--approve-destination-restore')) throw new Error('Se requiere --approve-destination-restore');
  const backup = option('backup');
  if (!backup) throw new Error('Indique --backup <carpeta de la copia> (la que tiene base/huellas-origen.json)');
  const base = new URL('base/', pathToFileURL(resolve(backup) + sep));
  const sqlFiles = (await readdir(base)).filter((f) => f.endsWith('-datos-inserts.sql'));
  if (sqlFiles.length !== 1) throw new Error('La carpeta base/ debe tener exactamente un archivo *-datos-inserts.sql');
  const texto = await readFile(new URL(sqlFiles[0], base), 'utf8');
  const huellas = JSON.parse(await readFile(new URL('huellas-origen.json', base), 'utf8'));
  const directory = new URL('../../apps/api/prisma/migrations/', import.meta.url);
  const migraciones = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  await execute('SELECT 1'); // reactiva Aurora antes de abrir la transaccion
  let transactionId;
  await restoreBackup({
    begin: async () => { ({ transactionId } = await client.send(new BeginTransactionCommand(connection))); },
    query: async (sql) => rows(await execute(sql, transactionId)),
    commit: () => client.send(new CommitTransactionCommand({ ...connection, transactionId })),
    rollback: () => client.send(new RollbackTransactionCommand({ ...connection, transactionId })),
  }, { texto, huellas, migraciones, log: (linea) => console.log(linea) });
  console.log('Copia cargada y comprobada: filas y secuencias iguales a las del origen');
}
