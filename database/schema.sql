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

-- WORDS
CREATE TABLE IF NOT EXISTS words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word VARCHAR(255) NOT NULL,
  translation VARCHAR(255) NOT NULL,
  definition TEXT,
  language VARCHAR(10) DEFAULT 'es',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER_WORDS (palabras aprendidas por usuario)
CREATE TABLE IF NOT EXISTS user_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  learned_at TIMESTAMPTZ DEFAULT NOW(),
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

-- Datos de ejemplo (opcional)
INSERT INTO words (word, translation, definition, language) VALUES
  ('hello', 'hola', 'Saludo en inglés', 'en'),
  ('world', 'mundo', 'El planeta o un ámbito', 'en'),
  ('learn', 'aprender', 'Adquirir conocimiento', 'en'),
  ('bird', 'pájaro', 'Animal volador', 'en'),
  ('fly', 'volar', 'Moverse por el aire', 'en')
ON CONFLICT DO NOTHING;
