const { port, supabase, databaseUrl, jwtSecret, corsOrigins } = require('./config/env');
const app = require('./app');
const { initPool, testConnection } = require('./config/db');

function validateBootConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error(
      '[API] JWT_SECRET faltante o muy corto (mínimo 32 chars). ' +
        'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    if (isProd) process.exit(1);
    else console.warn('[WARN] Continuando en dev sin JWT robusto: auth fallará con 500.');
  }
  if (isProd && corsOrigins.length === 0) {
    console.error('[API] CORS_ORIGIN es obligatorio en producción. Ej: CORS_ORIGIN=https://tu-frontend.com');
    process.exit(1);
  }
}

async function startServer() {
  try {
    validateBootConfig();
    if (supabase.url) {
      console.log(`[Supabase] Proyecto: ${supabase.projectRef || supabase.url}`);
    }

    await initPool();
    const dbTime = await testConnection();
    const hostHint = databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':****@') : '';
    console.log(`[DB] Conexión exitosa — ${dbTime.now}`);
    if (process.env.NODE_ENV === 'development' && hostHint) {
      console.log(`[DB] ${hostHint.substring(0, 60)}...`);
    }

    app.listen(port, () => {
      console.log(`[API] Servidor escuchando en http://localhost:${port}`);
      console.log(`[API] Health: http://localhost:${port}/health`);
    });
  } catch (error) {
    console.error('[API] No se pudo iniciar el servidor:', error.message);
    console.error('');
    console.error('Solución rápida:');
    console.error('  1. Supabase → Settings → Database → copia la contraseña');
    console.error('  2. En .env: DB_PASSWORD="tu_password" (con comillas si tiene #)');
    console.error('  3. Usa el pooler (no la conexión directa db.*):');
    console.error('     SUPABASE_POOLER_HOST=aws-1-us-east-1.pooler.supabase.com');
    console.error('     DB_PORT=6543');
    console.error('     DB_USER=postgres.TU_PROJECT_REF');
    process.exit(1);
  }
}

startServer();
