# AGENTS.md — api-lingo (Colibri API)

Express (CommonJS) + `pg` Pool REST API backed by Supabase Postgres. Node >= 18, no tests/lint/typecheck, no build step.

## Commands

- `npm install` → `npm run dev` (`node --watch src/index.js`) or `npm start`. Port from `PORT`, default 3000. Health: `GET /health`.
- No test script. Only verification available: boot the server (requires live DB) or `node scripts/inspect-schema.js` (prints columns of `users`, `words`, `user_words`, `stats`; needs working `.env`).
- Schema changes are manual: run `database/schema.sql` (full reference) or files in `database/migrations/` in Supabase Dashboard → SQL Editor. Nothing auto-applies migrations at boot.

## Env (.env) — trust `src/config/env.js`, not the docs

- `DATABASE_URL` wins if set; otherwise URL is built from `NEXT_PUBLIC_SUPABASE_URL` + `DB_PASSWORD`. `docs/SUPABASE.md` says direct `db.*:5432` is simplest — stale; code defaults to the Session pooler (`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.<PROJECT_REF>`) and auto-probes pooler hosts/ports on failure.
- `DB_PASSWORD` containing `#` must be quoted in `.env` (`DB_PASSWORD="..."`); `env.js` reads the file raw to work around dotenv truncation, and passwords are `encodeURIComponent`-normalized automatically.
- Required: `DATABASE_URL` (or Supabase URL + `DB_PASSWORD`) and `JWT_SECRET`. Missing `JWT_SECRET` only falls back to a dev secret outside production — production boot without it breaks auth with a 500.
- SSL is fixed to `{ rejectUnauthorized: false }` in `src/config/db.js` (Supabase requirement).

## Architecture

- Entry: `src/index.js` (connects pool, `SELECT NOW()` probe, then `listen`) → `src/app.js` (CORS, JSON `limit: 10mb`, route mounts, `notFoundHandler` + `errorHandler` last).
- Layering per resource: `src/routes/*` → `src/controllers/*` (always wrap with `utils/asyncHandler`) → `src/services/*` (raw SQL via `config/db.js` `query()`). Shared: `utils/AppError` (throw with status code), `utils/validators` (`validateEmail/Password/RequiredString/Uuid`), `utils/mappers` (snake_case rows → camelCase API shapes).
- All `/api/words`, `/api/user-words`, `/api/stats`, `/api/categories` routes require `Authorization: Bearer <JWT>` (`middleware/auth.js` → `req.user = { id, email, isDemo }`). README's "No auth" column for `GET /api/words` is wrong — verify against `src/routes/*`.

## Data / conventions that will bite

- Words are per-user through `user_words`: list/random go through `user_words JOIN words`; `createWord` inserts into both tables in a transaction (`BEGIN/COMMIT/ROLLBACK`); updates/deletes must call `assertUserOwnsWord` / `assertUserOwnsCategory` first (404 if not yours).
- Request bodies accept dual field names — keep both when adding fields: `word`/`english_word`, `translation`/`spanish_word`, `definition`/`pronunciation`, `category_id`/`categoryId`, (`nombre_categoria`/`name`, `calificacion_categoria`/`rating`). Column names stay Spanish/snake_case (`english_word`, `nombre_categoria`); API output is camelCase via mappers.
- `category_id` on words is nullable/`SET NULL` on delete; `resolveCategoryId(userId, …)` validates ownership — passing another user's category is a 404, not a 403.
- Responses always `{ success, data?, message? }`. `errorHandler` maps pg codes: `23505`→409, `23503`→400, `22P02`→400. `NODE_ENV=development` adds `stack` to errors and per-query `[DB]` timing logs.

## Gotchas

- `README.md` and `.gitignore` contain unresolved merge-conflict markers (`<<<<<<< HEAD`); README endpoint table and `docs/SUPABASE.md` port advice are stale — route files and `src/config/env.js` are source of truth.
- CORS is fully open in dev (`origin: CORS_ORIGIN || true`, `credentials: true`); set `CORS_ORIGIN` for production.
- `demo-login` (`POST /api/auth/demo-login`, no body) is the fastest way to get a token for manual testing.
