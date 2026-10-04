-- Consecutivo del expediente con una SECUENCIA de PostgreSQL.
--
-- Antes se calculaba con COUNT(*) + 1. Eso funciona con un solo proceso, pero
-- en AWS el API corre en mas de una instancia (o se reinicia mientras otra
-- atiende): dos expedientes simultaneos leen el mismo total, piden el mismo
-- numero y uno falla por el indice unico. Tambien reutilizaba numeros si se
-- borraba una fila.
--
-- Una secuencia nunca entrega el mismo valor dos veces, ni siquiera a
-- transacciones concurrentes, y no se devuelve al hacer ROLLBACK: puede dejar
-- huecos en la numeracion, lo cual es preferible a repetir un consecutivo.
CREATE SEQUENCE IF NOT EXISTS expediente_consecutivo_seq AS bigint START WITH 1 INCREMENT BY 1;

-- Si ya habia expedientes (base que viene de SQLite), se adelanta la secuencia
-- para no choca con los consecutivos que ya existen.
SELECT setval(
  'expediente_consecutivo_seq',
  GREATEST((SELECT COUNT(*) FROM "Expediente"), 1),
  (SELECT COUNT(*) > 0 FROM "Expediente")
);
