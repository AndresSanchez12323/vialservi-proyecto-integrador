// Carga la copia local de datos (pg_dump --data-only --column-inserts) en la
// base DESTINO, con las migraciones ya aplicadas. Todo o nada: una sola
// transaccion que solo se confirma si filas y secuencias coinciden con las
// huellas del origen. No imprime filas ni valores.
import { splitSql } from './sql.mjs';

// Lineas de psql (no son SQL) que pg_dump 16.10+ escribe para protegerse.
const PSQL_META = /^\\(?:restrict|unrestrict) [A-Za-z0-9]+\r?$/gm;
// Unicas sentencias admitidas: el archivo es de datos, nunca de esquema.
const PERMITIDAS = [
  /^SET [a-z_]+ = [^;]+;$/,
  /^SELECT pg_catalog\.set_config\('search_path', '', false\);$/,
  /^INSERT INTO public\."[A-Za-z_]+" \(/,
  /^SELECT pg_catalog\.setval\('public\."?[A-Za-z_]+"?', \d+, (?:true|false)\);$/,
];
// Solo los comentarios del INICIO: dentro de un texto una linea puede empezar por "--".
const sinComentarios = (s) => s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/, '').trim();

export function parseBackupSql(texto) {
  const statements = splitSql(texto.replace(PSQL_META, '')).map(sinComentarios).filter(Boolean);
  const tablas = new Set();
  for (const s of statements) {
    if (!PERMITIDAS.some((p) => p.test(s))) {
      throw new Error(`Sentencia no admitida en la copia de datos: ${s.slice(0, 40)}...`);
    }
    const m = s.match(/^INSERT INTO public\."([A-Za-z_]+)"/);
    if (m) tablas.add(m[1]);
  }
  // pg_dump cambia la SESION (search_path vacio, timeouts). Con Data API la
  // conexion vuelve a un pool: se limitan a la transaccion para no dejar rastro.
  const locales = statements.map((s) => s
    .replace(/^SET ([a-z_]+ = )/, 'SET LOCAL $1')
    .replace("set_config('search_path', '', false)", "set_config('search_path', '', true)"));
  if (tablas.has('_prisma_migrations')) throw new Error('La copia no debe traer _prisma_migrations');
  if (!tablas.size) throw new Error('La copia no trae ningun INSERT');
  return { statements: locales, tablas: [...tablas].sort() };
}

const id = (v) => '"' + v.replaceAll('"', '""') + '"';

// db: { query(sql) -> filas[], begin(), commit(), rollback() }
// huellas: base/huellas-origen.json de la copia. migraciones: nombres del repo.
export async function restoreBackup(db, { texto, huellas, migraciones, log = () => {} }) {
  const { statements } = parseBackupSql(texto);
  const esperadas = Object.fromEntries(Object.entries(huellas.tablas)
    .filter(([t]) => t !== '_prisma_migrations').map(([t, h]) => [t, Number(h.filas)]));

  await db.begin();
  try {
    await db.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vialservi-terraform-schema'))");
    const aplicadas = new Set((await db.query(`SELECT migration_name FROM public."_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name));
    const faltan = migraciones.filter((m) => !aplicadas.has(m));
    if (faltan.length) throw new Error(`Faltan migraciones; correr antes "migrate": ${faltan.join(', ')}`);

    const tablas = (await db.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'
      AND tablename <> '_prisma_migrations' ORDER BY tablename`)).map((r) => r.tablename);
    for (const t of Object.keys(esperadas)) {
      if (!tablas.includes(t)) throw new Error(`La tabla ${t} de la copia no existe en destino`);
    }
    for (const t of tablas) {
      const [{ n }] = await db.query(`SELECT pg_catalog.count(*)::int AS n FROM public.${id(t)}`);
      if (Number(n) !== 0) throw new Error(`Destino no esta vacio (${t}: ${n} filas); no se mezclan datos`);
    }

    for (const s of statements) await db.query(s);

    const diferencias = [];
    for (const t of tablas) {
      const [{ n }] = await db.query(`SELECT pg_catalog.count(*)::int AS n FROM public.${id(t)}`);
      const esperado = esperadas[t] ?? 0;
      if (Number(n) !== esperado) diferencias.push(`${t}: ${n} de ${esperado}`);
      else log(`${t}: ${n} filas`);
    }
    for (const [seq, valor] of Object.entries(huellas.secuencias ?? {})) {
      const [fila] = await db.query(`SELECT last_value::text AS v FROM pg_catalog.pg_sequences
        WHERE schemaname='public' AND sequencename='${seq.replaceAll("'", "''")}'`);
      if (!fila || String(fila.v) !== String(valor)) diferencias.push(`secuencia ${seq}: ${fila?.v} de ${valor}`);
    }
    if (diferencias.length) throw new Error(`La carga no coincide con la copia: ${diferencias.join('; ')}`);
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}
