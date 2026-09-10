-- Deduplica `words` por `english_word` (insensible a mayúsculas):
-- solo se crea una palabra nueva si `word` no existe antes.
-- Reasigna `user_words` a la palabra canónica y evita futuros duplicados.
-- Ejecutar en: Supabase Dashboard → SQL Editor.

-- 1. Identifica duplicados: conserva la más antigua como canónica
CREATE TEMP TABLE _word_dupes AS
SELECT
  id,
  FIRST_VALUE(id) OVER w AS canonical_id,
  ROW_NUMBER() OVER w AS rn
FROM words
WINDOW w AS (
  PARTITION BY LOWER(english_word)
  ORDER BY created_at ASC, id ASC
);

-- 2. Elimina enlaces redundantes: si el usuario ya tiene la canónica,
-- suelta la fila duplicada (evita violar UNIQUE(user_id, word_id))
DELETE FROM user_words uw
USING _word_dupes d
WHERE uw.word_id = d.id
  AND d.rn > 1
  AND EXISTS (
    SELECT 1 FROM user_words x
    WHERE x.user_id = uw.user_id AND x.word_id = d.canonical_id
  );

-- 3. Reapunta los enlaces restantes a la palabra canónica
UPDATE user_words uw
SET word_id = d.canonical_id
FROM _word_dupes d
WHERE uw.word_id = d.id AND d.rn > 1;

-- 4. Borra las filas de palabras duplicadas (ya sin referencias)
DELETE FROM words w
USING _word_dupes d
WHERE w.id = d.id AND d.rn > 1;

DROP TABLE _word_dupes;

-- 5. Evita futuros duplicados a nivel de BD (el código también reutiliza)
CREATE UNIQUE INDEX IF NOT EXISTS uq_words_english_word_ci
  ON words (LOWER(english_word));
