-- ============================================================
-- Esquema de referencia para Colibri API + Supabase PostgreSQL
-- Ejecuta en: Supabase Dashboard → SQL Editor
-- Ajusta columnas si tu BD ya existe con nombres distintos
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  username VARCHAR(100),
  is_demo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WORDS (vocabulario global)
CREATE TABLE IF NOT EXISTS words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  english_word VARCHAR(255) NOT NULL,
  spanish_word VARCHAR(255) NOT NULL,
  pronunciation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER_WORDS (relación usuario ↔ palabra: learning | learned)
CREATE TABLE IF NOT EXISTS user_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'learning',
  learned_at TIMESTAMPTZ,
  times_seen INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,
  UNIQUE(user_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words(user_id);
CREATE INDEX IF NOT EXISTS idx_user_words_word_id ON user_words(word_id);

-- STATS
CREATE TABLE IF NOT EXISTS stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  words_learned INTEGER DEFAULT 0,
  words_reviewed INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Las palabras de ejemplo deben crearse con user_id vía la API (POST /api/words)
