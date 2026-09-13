-- ============================================================
-- Migración 004: Sistema Leitner (repetición espaciada)
-- Ejecuta en: Supabase Dashboard → SQL Editor
-- ============================================================
-- El progreso Leitner vive en `user_words` (una fila por usuario ↔
-- palabra), no en `words` (tabla global compartida entre mazos).
--
-- Cajas e intervalos:
--   Caja 1 → 1 día | Caja 2 → 3 días | Caja 3 → 7 días
--   Caja 4 → 14 días | Caja 5 → 30 días (dominada)
-- ============================================================

ALTER TABLE user_words
  ADD COLUMN IF NOT EXISTS current_box INTEGER NOT NULL DEFAULT 1
    CONSTRAINT chk_user_words_current_box CHECK (current_box BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: palabras existentes empiezan en Caja 1 y quedan
-- vencidas de inmediato para que aparezcan en el próximo repaso.
UPDATE user_words
SET last_reviewed_at = COALESCE(last_reviewed_at, created_at, NOW()),
    next_review_at = CASE
      WHEN next_review_at IS NULL THEN NOW()
      ELSE next_review_at
    END,
    current_box = CASE
      WHEN current_box BETWEEN 1 AND 5 THEN current_box
      ELSE 1
    END
WHERE last_reviewed_at IS NULL OR current_box IS NULL;

-- Consulta caliente de repaso: getWordsDueForReview filtra por
-- (user_id, next_review_at <= NOW()).
CREATE INDEX IF NOT EXISTS idx_user_words_due_review
  ON user_words (user_id, next_review_at);
