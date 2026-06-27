-- Categorías por usuario y vínculo en palabras (ejecutar si la BD ya existe)

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_categoria VARCHAR(255) NOT NULL,
  calificacion_categoria INTEGER DEFAULT 0,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

ALTER TABLE words
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_words_category_id ON words(category_id);
