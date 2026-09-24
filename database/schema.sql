-- ============================================================
-- Esquema de referencia para Colibri API + Supabase PostgreSQL
-- Refleja las tablas reales del proyecto (ver Dashboard → Table Editor).
-- Ejecuta en: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_demo BOOLEAN DEFAULT false,
  birth_date DATE,
  sex VARCHAR(20),
  nationality VARCHAR(100),
  current_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CATEGORIES (por usuario)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_categoria VARCHAR(255) NOT NULL,
  calificacion_categoria INTEGER,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

-- WORDS (vocabulario global)
CREATE TABLE IF NOT EXISTS words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  english_word VARCHAR(255) NOT NULL,
  spanish_word VARCHAR(255) NOT NULL,
  pronunciation VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_words_category_id ON words(category_id);

-- Una palabra inglesa existe una sola vez (insensible a mayúsculas).
-- Ver database/migrations/003_dedupe-words.sql para limpiar duplicados previos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_words_english_word_ci
  ON words (LOWER(english_word));

-- USER_WORDS (relación usuario ↔ palabra: learning | learned)
-- Progreso Leitner: current_box 1-5 + last/next_review_at.
-- Intervalos: Caja 1 → 1d, Caja 2 → 3d, Caja 3 → 7d, Caja 4 → 14d, Caja 5 → 30d.
CREATE TABLE IF NOT EXISTS user_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'learning',
  learned_at TIMESTAMPTZ,
  times_seen INTEGER,
  times_correct INTEGER,
  current_box INTEGER NOT NULL DEFAULT 1 CHECK (current_box BETWEEN 1 AND 5),
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_user_words_user_id ON user_words(user_id);
CREATE INDEX IF NOT EXISTS idx_user_words_word_id ON user_words(word_id);
CREATE INDEX IF NOT EXISTS idx_user_words_due_review ON user_words(user_id, next_review_at);

-- STATS (una fila por usuario y día: aprendidas archivadas por día)
-- La racha de días consecutivos vive en users.current_streak.
CREATE TABLE IF NOT EXISTS stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  words_learned INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- GRAMMAR_FAMILY (familia gramatical por palabra)
CREATE TABLE IF NOT EXISTS grammar_family (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  nombre_familia VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grammar_family_word_id ON grammar_family(word_id);

-- GRAMMAR_CATEGORY (categoría dentro de una familia gramatical)
CREATE TABLE IF NOT EXISTS grammar_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grammar_family_id UUID NOT NULL REFERENCES grammar_family(id) ON DELETE CASCADE,
  nombre_categoria VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grammar_category_family_id ON grammar_category(grammar_family_id);

-- SYNONYMS (enlaces entre palabras existentes)
CREATE TABLE IF NOT EXISTS synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  synonym_word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(word_id, synonym_word_id)
);

-- ANTONYMS (enlaces entre palabras existentes)
CREATE TABLE IF NOT EXISTS antonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  antonym_word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(word_id, antonym_word_id)
);

-- COLLOCATIONS (colocaciones por palabra)
CREATE TABLE IF NOT EXISTS collocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  collocation VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collocations_word_id ON collocations(word_id);

-- EXAMPLE (oraciones de ejemplo por palabra)
CREATE TABLE IF NOT EXISTS example (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  example_text VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_example_word_id ON example(word_id);

-- EXAMPLE_TRANSLATION (traducción de cada ejemplo)
CREATE TABLE IF NOT EXISTS example_translation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  example_id UUID NOT NULL REFERENCES example(id) ON DELETE CASCADE,
  translation VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_example_translation_example_id ON example_translation(example_id);

-- URL_ILLUSTRATION (imagen ilustrativa por palabra)
CREATE TABLE IF NOT EXISTS url_illustration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  url VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_url_illustration_word_id ON url_illustration(word_id);
