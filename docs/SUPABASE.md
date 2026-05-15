# Configuración de Supabase PostgreSQL

Guía para conectar la API Colibri con tu base de datos existente en Supabase.

## 1. Obtener credenciales en Supabase

1. Entra a [https://supabase.com](https://supabase.com) y abre tu proyecto.
2. Ve a **Project Settings** (icono de engranaje) → **Database**.
3. En **Connection string**, elige la pestaña **URI**.
4. Copia la cadena que empieza con `postgresql://postgres:[PASSWORD]@db....supabase.co:5432/postgres`.
5. También puedes usar los datos individuales de la misma pantalla:
   - **Host**: `db.xxxxx.supabase.co`
   - **Port**: `5432`
   - **Database**: `postgres`
   - **User**: `postgres`
   - **Password**: la contraseña que definiste al crear el proyecto (o resetea en Database → Reset password).

## 2. Configurar el archivo `.env`

Pega tus valores en el `.env` de la raíz del proyecto:

```env
DATABASE_URL=postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres

DB_HOST=db.xxxxx.supabase.co
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=TU_PASSWORD
DB_NAME=postgres

JWT_SECRET=un_secreto_largo_y_aleatorio_minimo_32_caracteres
PORT=3000
```

> **Recomendación:** Usa `DATABASE_URL` como fuente principal. La API la prioriza sobre `DB_*`.

## 3. SSL con Supabase

Supabase exige conexiones SSL. En `src/config/db.js` está configurado:

```js
ssl: { rejectUnauthorized: false }
```

Esto es lo habitual para Node.js + Supabase en desarrollo y muchos despliegues (Railway, Render, etc.). En entornos corporativos con CA propia puedes ajustar `rejectUnauthorized` según tu política.

## 4. Uso de `DATABASE_URL`

El driver `pg` acepta `connectionString` directamente:

```js
new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
```

Ventajas:

- Un solo valor para copiar desde Supabase.
- Compatible con variables de entorno en Vercel, Railway, Render, etc.
- Evita errores al armar host/user/password por separado.

## 5. Verificar tablas

La API espera estas tablas (ver `database/schema.sql` si necesitas crearlas):

| Tabla        | Uso principal                          |
|-------------|-----------------------------------------|
| `users`     | Registro, login, demo                   |
| `words`     | Vocabulario                             |
| `user_words`| Palabras aprendidas por usuario         |
| `stats`     | Estadísticas agregadas del usuario      |

Si tus columnas tienen otros nombres, adapta las consultas en `src/services/`.

## 6. Connection pooling (opcional)

Supabase ofrece dos URLs:

- **Direct connection** (puerto 5432): ideal para esta API en desarrollo.
- **Transaction pooler** (puerto 6543): útil con muchas conexiones serverless.

Para esta API con `pg.Pool`, la conexión directa en el puerto **5432** suele ser la más simple.

## 7. Probar conexión

```bash
npm install
npm run dev
```

Si ves `[DB] Conexión exitosa a Supabase PostgreSQL`, la configuración es correcta.
