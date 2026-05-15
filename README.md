<<<<<<< HEAD
# Colibri API

API REST con **Node.js**, **Express** y **PostgreSQL (Supabase)** para gestión de vocabulario, usuarios y estadísticas.

## Estructura del proyecto

```
api/
├── database/
│   └── schema.sql          # Esquema SQL de referencia
├── docs/
│   └── SUPABASE.md         # Guía de credenciales y SSL
├── src/
│   ├── config/
│   │   └── db.js           # Pool pg + SSL Supabase
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   ├── app.js
│   └── index.js
├── .env
├── .env.example
└── package.json
```

## Requisitos

- Node.js 18+
- Proyecto Supabase con tablas `users`, `words`, `user_words`, `stats`
- Credenciales de PostgreSQL en `.env`

## Instalación

```bash
cd api
npm install
```

Copia y edita las variables en `.env` (ver [docs/SUPABASE.md](./docs/SUPABASE.md)).

Si aún no tienes las tablas, ejecuta `database/schema.sql` en el **SQL Editor** de Supabase.

## Ejecución

```bash
# Producción
npm start

# Desarrollo (recarga automática Node 18+)
npm run dev
```

La API queda en `http://localhost:3000` (o el `PORT` de tu `.env`).

## Endpoints

### Health

| Método | Ruta      | Auth |
|--------|-----------|------|
| GET    | `/health` | No   |

### Auth

| Método | Ruta                    | Auth | Body |
|--------|-------------------------|------|------|
| POST   | `/api/auth/register`    | No   | `{ "email", "password", "username?" }` |
| POST   | `/api/auth/login`       | No   | `{ "email", "password" }` |
| POST   | `/api/auth/demo-login`  | No   | — |

### Words

| Método | Ruta                 | Auth | Notas |
|--------|----------------------|------|-------|
| GET    | `/api/words`         | No   | Query: `limit`, `offset`, `language` |
| POST   | `/api/words`         | Sí   | `{ "word", "translation", "definition?", "language?" }` |
| GET    | `/api/words/random`  | Sí   | Excluye palabras ya aprendidas |

### User words

| Método | Ruta                          | Auth | Body |
|--------|-------------------------------|------|------|
| POST   | `/api/user-words/learned`     | Sí   | `{ "word_id": "uuid" }` |
| GET    | `/api/user-words/learned`     | Sí   | Query: `limit`, `offset` |

### Stats

| Método | Ruta           | Auth |
|--------|----------------|------|
| GET    | `/api/stats`   | Sí   |

**Autenticación:** Header `Authorization: Bearer <token_jwt>`

## Probar con Postman

1. **Demo login** (rápido para probar):
   - `POST http://localhost:3000/api/auth/demo-login`
   - Copia `data.token` de la respuesta.

2. **Registrar usuario**:
   - `POST http://localhost:3000/api/auth/register`
   - Body JSON:
     ```json
     {
       "email": "test@ejemplo.com",
       "password": "123456",
       "username": "Test"
     }
     ```

3. **Login**:
   - `POST http://localhost:3000/api/auth/login`
   - Body: `{ "email", "password" }`

4. En Postman → pestaña **Authorization** → Type **Bearer Token** → pega el JWT.

5. **Palabra aleatoria**:
   - `GET http://localhost:3000/api/words/random`

6. **Marcar aprendida**:
   - `POST http://localhost:3000/api/user-words/learned`
   - Body: `{ "word_id": "<uuid de la palabra>" }`

7. **Estadísticas**:
   - `GET http://localhost:3000/api/stats`

## Conectar frontend React / Vite

En tu proyecto Vite, crea `.env`:

```env
VITE_API_URL=http://localhost:3000
```

Ejemplo de cliente API:

```js
const API_URL = import.meta.env.VITE_API_URL;

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Error en la API');
  return data;
}

// Demo login
export const demoLogin = () =>
  apiFetch('/api/auth/demo-login', { method: 'POST' });

// Palabra aleatoria
export const getRandomWord = () =>
  apiFetch('/api/words/random');

// Marcar aprendida
export const markLearned = (wordId) =>
  apiFetch('/api/user-words/learned', {
    method: 'POST',
    body: JSON.stringify({ word_id: wordId }),
  });
```

CORS está habilitado para desarrollo. En producción define en el `.env` del backend:

```env
CORS_ORIGIN=https://tu-dominio-frontend.com
```

## Respuestas

Éxito:

```json
{
  "success": true,
  "data": { ... }
}
```

Error:

```json
{
  "success": false,
  "message": "Descripción del error"
}
```

## Documentación Supabase

Detalles de credenciales, SSL y `DATABASE_URL`: [docs/SUPABASE.md](./docs/SUPABASE.md)

## Licencia

MIT
=======
# api-lingo
>>>>>>> 3d0b4731364ce7c8d7c8d29f9edb789891197597
