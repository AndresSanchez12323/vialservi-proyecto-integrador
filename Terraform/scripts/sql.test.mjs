import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { splitSql } from './sql.mjs';

test('no separa puntos y coma en cadenas, identificadores, comentarios o funciones', () => {
  const sql = `-- ;\nSELECT 'a;''b'; /* ; /* ; */ */ SELECT "a;b"; DO $body$ BEGIN PERFORM 1; END $body$;`;
  assert.equal(splitSql(sql).length, 3);
  assert.throws(() => splitSql("SELECT 'incompleto"));
});
test('todas las migraciones del repositorio se pueden separar sin SQL incompleto', async () => {
  const base = new URL('../../apps/api/prisma/migrations/', import.meta.url);
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    assert.ok(splitSql(await readFile(new URL(`${entry.name}/migration.sql`, base), 'utf8')).length);
  }
});
