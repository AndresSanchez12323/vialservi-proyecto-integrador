// Transferencia FUTURA. Lectura en origen; escritura solo en destino.
// Mantiene claves, versiones historicas y marcas de borrado en orden cronologico.
// Los VersionId cambian entre cuentas y se registran en el manifiesto privado.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { S3Client, ListObjectVersionsCommand, GetObjectCommand, PutObjectCommand,
  DeleteObjectCommand, GetObjectTaggingCommand } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(`--${key}`); return i < 0 ? undefined : args[i + 1]; };
const region = option('region');
if (region !== 'us-east-1') throw new Error('Indique --region us-east-1');
const options = {};
for (const side of ['source', 'target']) {
  const profile = option(`${side}-profile`), account = option(`${side}-account`), bucket = option(`${side}-bucket`);
  if (!profile || !/^\d{12}$/.test(account ?? '') || !bucket) throw new Error(`Falta perfil, cuenta o bucket ${side}`);
  if (side === 'target' && ['102098709715', '497502378363'].includes(account)) throw new Error('Destino original prohibido');
  if (account === '497502378363') throw new Error('La cuenta educativa no se usa para VialServi');
  const identity = JSON.parse(execFileSync('aws', ['sts', 'get-caller-identity', '--profile', profile, '--region', region, '--output', 'json'], { encoding: 'utf8' }));
  if (identity.Account !== account) throw new Error(`STS no coincide: ${side}`);
  options[side] = { account, bucket, client: new S3Client({ region, credentials: fromIni({ profile }) }) };
}
const { source, target } = options;
if (source.account === target.account || source.bucket === target.bucket) throw new Error('Origen y destino deben ser diferentes');
const checkBucket = (bucket, account) => ({ Bucket: bucket, ExpectedBucketOwner: account });
const targetBase = checkBucket(target.bucket, target.account), sourceBase = checkBucket(source.bucket, source.account);
const occupied = await target.client.send(new ListObjectVersionsCommand({ ...targetBase, MaxKeys: 1 }));
if (occupied.Versions?.length || occupied.DeleteMarkers?.length) throw new Error('La copia historica requiere un bucket destino vacio; no sobrescribir ni duplicar versiones');
const groups = new Map();
let KeyMarker, VersionIdMarker;
do {
  const page = await source.client.send(new ListObjectVersionsCommand({ ...sourceBase, KeyMarker, VersionIdMarker }));
  for (const [items, deleted] of [[page.Versions ?? [], false], [page.DeleteMarkers ?? [], true]]) {
    for (const entry of items) {
      if (entry.Key.startsWith('ocr-tarjetas/')) continue; // imagenes temporales, no evidencias
      const list = groups.get(entry.Key) ?? [];
      list.push({ ...entry, deleted }); groups.set(entry.Key, list);
    }
  }
  KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
  VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
} while (KeyMarker);
const count = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
console.log(`Cuenta origen ${source.account}, destino ${target.account}: ${groups.size} claves, ${count} versiones/marcas; OCR excluido`);
if (!args.includes('--apply')) { console.log('Solo inventario. --apply habilita la transferencia al bucket vacio de destino.'); process.exit(0); }
if (!option('manifest')) throw new Error('Indique --manifest ruta.json fuera de Git');
const manifest = [];
// Crear primero archivo exclusivo para evitar pisar evidencia de otra corrida.
await writeFile(option('manifest'), '[]', { flag: 'wx', mode: 0o600 });
for (const [Key, list] of groups) {
  list.sort((a, b) => a.LastModified - b.LastModified || Number(a.IsLatest) - Number(b.IsLatest));
  for (const entry of list) {
    if (entry.deleted) {
      const result = await target.client.send(new DeleteObjectCommand({ ...targetBase, Key }));
      manifest.push({ key: Key, sourceVersion: entry.VersionId, targetVersion: result.VersionId, deleted: true });
    } else {
      if (entry.Size > 512 * 1024 * 1024) throw new Error('Objeto supera 512 MiB; usar transferencia multipart supervisada para esa copia');
      const object = await source.client.send(new GetObjectCommand({ ...sourceBase, Key, VersionId: entry.VersionId }));
      const body = await object.Body.transformToByteArray();
      const checksum = createHash('sha256').update(body).digest('base64');
      const tags = await source.client.send(new GetObjectTaggingCommand({ ...sourceBase, Key, VersionId: entry.VersionId }));
      const result = await target.client.send(new PutObjectCommand({ ...targetBase, Key, Body: body,
        ChecksumSHA256: checksum, ServerSideEncryption: 'AES256', Metadata: object.Metadata,
        ContentType: object.ContentType, ContentDisposition: object.ContentDisposition,
        ContentEncoding: object.ContentEncoding, CacheControl: object.CacheControl,
        Tagging: tags.TagSet?.length ? new URLSearchParams(tags.TagSet.map(tag => [tag.Key, tag.Value])).toString() : undefined,
      }));
      const copy = await target.client.send(new GetObjectCommand({ ...targetBase, Key, VersionId: result.VersionId }));
      const hash = createHash('sha256');
      for await (const chunk of copy.Body) hash.update(chunk);
      if (hash.digest('base64') !== checksum) throw new Error('Huella de S3 diferente; detener el corte');
      manifest.push({ key: Key, sourceVersion: entry.VersionId, targetVersion: result.VersionId, sha256: checksum, bytes: body.length });
    }
    await writeFile(option('manifest'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }
}
console.log(`Transferencia verificada: ${manifest.length} versiones/marcas; origen intacto`);
