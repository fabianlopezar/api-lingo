const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function getProjectRefFromSupabaseUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  const match = supabaseUrl.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

/**
 * Lee DB_PASSWORD del archivo .env evitando que dotenv corte valores con #
 */
function readPasswordFromEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;

  const raw = fs.readFileSync(envPath, 'utf8');
  const line = raw.split('\n').find((l) => /^\s*DB_PASSWORD\s*=/.test(l));
  if (!line) return null;

  const match = line.match(/^\s*DB_PASSWORD\s*=\s*(.+?)\s*$/);
  if (!match) return null;

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value || null;
}

function getDbPassword() {
  const fromFile = readPasswordFromEnvFile();
  const fromEnv = process.env.DB_PASSWORD;

  if (fromFile && fromEnv && fromFile.length > fromEnv.length) {
    return fromFile;
  }

  return fromEnv || fromFile || process.env.SUPABASE_DB_PASSWORD || null;
}

function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  const match = trimmed.match(/^(postgres(?:ql)?:\/\/)([^/]+@)(.+)$/i);
  if (!match) return trimmed;

  const prefix = match[1];
  const userPassHost = match[2];
  const pathAndQuery = match[3];

  const atIndex = userPassHost.lastIndexOf('@');
  if (atIndex === -1) return trimmed;

  const credentials = userPassHost.slice(0, atIndex);
  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) return trimmed;

  const user = credentials.slice(0, colonIndex);
  let password = credentials.slice(colonIndex + 1);

  try {
    const decoded = decodeURIComponent(password);
    if (decoded !== password) password = decoded;
  } catch {
    // mantener original
  }

  return `${prefix}${user}:${encodeURIComponent(password)}@${pathAndQuery}`;
}

function buildDatabaseUrlFromSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const password = getDbPassword();
  const projectRef = getProjectRefFromSupabaseUrl(supabaseUrl);

  if (!projectRef || !password) return null;

  const user =
    process.env.DB_USER ||
    (process.env.DB_USE_POOLER !== 'false' ? `postgres.${projectRef}` : 'postgres');

  const database = process.env.DB_NAME || 'postgres';
  const port = process.env.DB_PORT || (process.env.DB_USE_POOLER !== 'false' ? '6543' : '5432');

  const host =
    process.env.DB_HOST ||
    (process.env.DB_USE_POOLER !== 'false'
      ? process.env.SUPABASE_POOLER_HOST || 'aws-1-us-east-1.pooler.supabase.com'
      : `db.${projectRef}.supabase.co`);

  const encodedPassword = encodeURIComponent(password);

  return `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}`;
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return normalizeDatabaseUrl(process.env.DATABASE_URL);
  }

  return buildDatabaseUrlFromSupabase();
}

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[WARN] JWT_SECRET no definido. Usando secreto de desarrollo.');
    return 'colibri-dev-jwt-secret-cambiar-en-produccion';
  }

  return null;
}

function parseDatabaseUrl(connectionString) {
  if (!connectionString) return null;

  const normalized = normalizeDatabaseUrl(connectionString);
  const url = new URL(normalized.replace(/^postgresql:\/\//i, 'http://'));

  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.replace(/^\//, '') || 'postgres',
  };
}

const databaseUrl = resolveDatabaseUrl();
const jwtSecret = resolveJwtSecret();
const port = parseInt(process.env.PORT, 10) || 3000;
const projectRef = getProjectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

const supabase = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || null,
  projectRef,
};

module.exports = {
  databaseUrl,
  jwtSecret,
  port,
  supabase,
  projectRef,
  getDbPassword,
  parseDatabaseUrl,
  getProjectRefFromSupabaseUrl,
  normalizeDatabaseUrl,
  buildDatabaseUrlFromSupabase,
};
