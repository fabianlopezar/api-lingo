const { Pool } = require('pg');
const {
  databaseUrl,
  parseDatabaseUrl,
  projectRef,
  getDbPassword,
  buildDatabaseUrlFromSupabase,
} = require('./env');

const sslConfig = { rejectUnauthorized: false };

let pool = null;

const POOLER_CANDIDATES = [
  'aws-1-us-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-1-eu-west-1.pooler.supabase.com',
  'aws-0-eu-west-1.pooler.supabase.com',
  'aws-1-eu-central-1.pooler.supabase.com',
];

function createPoolFromConfig(config) {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: sslConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 12000,
  });
}

async function tryConnect(config) {
  const testPool = createPoolFromConfig(config);
  try {
    await testPool.query('SELECT 1');
    return testPool;
  } catch (error) {
    await testPool.end().catch(() => {});
    throw error;
  }
}

async function discoverPoolerConnection() {
  const password = getDbPassword();
  if (!projectRef || !password) return null;

  const ports = [6543, 5432];

  for (const host of POOLER_CANDIDATES) {
    for (const port of ports) {
      const config = {
        host,
        port,
        user: `postgres.${projectRef}`,
        password,
        database: 'postgres',
      };

      try {
        const testPool = await tryConnect(config);
        console.log(`[DB] Pooler detectado: ${host}:${port}`);
        return testPool;
      } catch {
        // probar siguiente
      }
    }
  }

  return null;
}

async function createPool() {
  if (!databaseUrl) {
    throw new Error(
      'Configura NEXT_PUBLIC_SUPABASE_URL + DB_PASSWORD o DATABASE_URL en .env'
    );
  }

  const config = parseDatabaseUrl(databaseUrl);

  try {
    return await tryConnect(config);
  } catch (primaryError) {
    console.warn(`[DB] Falló conexión a ${config.host}: ${primaryError.message}`);
    console.warn('[DB] Buscando pooler de Supabase compatible...');

    const poolerPool = await discoverPoolerConnection();
    if (poolerPool) return poolerPool;

    throw new Error(
      `${primaryError.message}. ` +
        'Tu red no alcanza db.*.supabase.co (IPv6). En Supabase Dashboard → Database → ' +
        'copia la URL del "Session pooler" y ponla en DATABASE_URL del .env'
    );
  }
}

async function initPool() {
  if (pool) return pool;

  pool = await createPool();

  pool.on('error', (err) => {
    console.error('[DB] Error en pool:', err.message);
  });

  return pool;
}

async function getPool() {
  if (!pool) await initPool();
  return pool;
}

async function query(text, params) {
  const activePool = await getPool();
  const start = Date.now();

  try {
    const result = await activePool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB]', {
        text: text.substring(0, 80),
        duration: `${Date.now() - start}ms`,
        rows: result.rowCount,
      });
    }
    return result;
  } catch (error) {
    console.error('[DB] Error en consulta:', error.message);
    throw error;
  }
}

async function testConnection() {
  const result = await query('SELECT NOW() AS now');
  return result.rows[0];
}

module.exports = {
  initPool,
  getPool,
  query,
  testConnection,
};
