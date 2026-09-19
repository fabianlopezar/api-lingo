-- ============================================================
-- Migración 006: Login con Google en `users`
-- Ejecuta en: Supabase Dashboard → SQL Editor
-- ============================================================
-- Permite crear/iniciar sesión con cuenta Google:
-- - google_id: `sub` de Google (único, NULLable para usuarios email/password)
-- - auth_provider: 'email' | 'google' | 'both'
-- - avatar_url: foto de perfil de Google
-- - password pasa a NULLable (usuarios Google no tienen contraseña local)
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Usuarios Google no tienen contraseña local: hacerla NULLable.
-- Si tu tabla la creó con NOT NULL, esta línea la relaja.
ALTER TABLE public.users ALTER COLUMN password DROP NOT NULL;

-- Backfill: los existentes quedan como 'email'.
UPDATE public.users SET auth_provider = 'email' WHERE auth_provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users(google_id);
