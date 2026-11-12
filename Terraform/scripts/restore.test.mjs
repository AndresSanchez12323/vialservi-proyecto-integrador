import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackupSql, restoreBackup } from './restore.mjs';

const copia = `--
-- PostgreSQL database dump
--

\\restrict AbC123

SET statement_timeout = 0;
SELECT pg_catalog.set_config('search_path', '', false);

--
-- Data for Name: Cliente; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public."Cliente" (id, nombre) VALUES (1, 'Ana; con punto y coma');
INSERT INTO public."Cliente" (id, nombre) VALUES (2, 'linea
-- que parece comentario');
SELECT pg_catalog.setval('public."Cliente_id_seq"', 2, true);

\\unrestrict AbC123
`;

test('lee la copia: quita lineas de psql y respeta textos con ; o --', () => {
  const { statements, tablas } = parseBackupSql(copia);
  assert.deepEqual(tablas, ['Cliente']);
  assert.equal(statements.filter((s) => s.startsWith('INSERT')).length, 2);
  assert.ok(statements.some((s) => s.includes("'linea\n-- que parece comentario'")));
  assert.ok(statements.every((s) => !s.includes('\\restrict')));
  // Nada de pg_dump queda en la sesion (Data API reusa conexiones): solo en la transaccion.
  assert.ok(statements.includes('SET LOCAL statement_timeout = 0;'));
  assert.ok(statements.includes("SELECT pg_catalog.set_config('search_path', '', true);"));
  assert.ok(!statements.some((s) => /^SET (?!LOCAL )/.test(s) || s.includes("'', false)")));
});

test('rechaza cualquier sentencia que no sea de datos', () => {
  assert.throws(() => parseBackupSql(copia + 'DROP TABLE public."Cliente";'), /no admitida/);
  assert.throws(() => parseBackupSql(copia + 'DELETE FROM public."Cliente";'), /no admitida/);
  assert.throws(() => parseBackupSql('INSERT INTO public."_prisma_migrations" (id) VALUES (1);'), /_prisma_migrations/);
  assert.throws(() => parseBackupSql('SET x = 1;'), /ningun INSERT/);
});

// Base falsa: responde a las consultas de comprobacion y cuenta los INSERT.
function baseFalsa({ filasIniciales = 0, migraciones = ['m1'], seq = '2' } = {}) {
  const estado = { insertadas: 0, confirmada: false, revertida: false };
  return {
    estado,
    begin: async () => {},
    commit: async () => { estado.confirmada = true; },
    rollback: async () => { estado.revertida = true; },
    query: async (sql) => {
      if (sql.includes('.pg_tables')) return [{ tablename: 'Cliente' }];
      if (sql.includes('_prisma_migrations')) return migraciones.map((m) => ({ migration_name: m }));
      if (sql.includes('count(*)')) return [{ n: filasIniciales + estado.insertadas }];
      if (sql.includes('.pg_sequences')) return [{ v: seq }];
      if (sql.startsWith('INSERT')) estado.insertadas++;
      return [];
    },
  };
}
const huellas = { tablas: { Cliente: { filas: 2 }, _prisma_migrations: { filas: 2 } }, secuencias: { Cliente_id_seq: 2 } };

test('confirma solo si filas y secuencias coinciden', async () => {
  const db = baseFalsa();
  await restoreBackup(db, { texto: copia, huellas, migraciones: ['m1'] });
  assert.equal(db.estado.insertadas, 2);
  assert.ok(db.estado.confirmada && !db.estado.revertida);
});

test('no mezcla: destino con datos, migraciones faltantes o secuencia distinta revierten', async () => {
  for (const [opciones, error] of [
    [{ filasIniciales: 1 }, /no esta vacio/],
    [{ migraciones: [] }, /Faltan migraciones/],
    [{ seq: '1' }, /no coincide/],
  ]) {
    const db = baseFalsa(opciones);
    await assert.rejects(restoreBackup(db, { texto: copia, huellas, migraciones: ['m1'] }), error);
    assert.ok(db.estado.revertida && !db.estado.confirmada);
  }
});
