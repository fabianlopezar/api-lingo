-- ============================================================
-- 007_streak.sql — racha de días consecutivos de estudio
-- Ejecutar manual en: Supabase Dashboard → SQL Editor → Run
-- (nada aplica migraciones automáticamente al arrancar)
-- ============================================================

-- study_time nunca se midió (siempre 0): se elimina.
ALTER TABLE stats DROP COLUMN IF EXISTS study_time;

-- Racha persistida por usuario. Cuenta cualquier día con actividad
-- de estudio: swipe de repaso (POST /api/user-words/review) o
-- marcar aprendida (POST /api/user-words/learned).
-- last_active_date se necesita para saber si el día es consecutivo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date DATE;
