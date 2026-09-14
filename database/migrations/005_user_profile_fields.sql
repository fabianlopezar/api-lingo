-- ============================================================
-- Migración 005: Campos de perfil en `users`
-- Ejecuta en: Supabase Dashboard → SQL Editor
-- ============================================================
-- Añade fecha de nacimiento, sexo y nacionalidad para
-- capturarlos en el registro de nuevas cuentas.
-- Columnas NULLables para no romper usuarios existentes
-- ni el login demo.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS sex VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);
