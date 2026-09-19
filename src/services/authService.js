const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { jwtSecret, jwtExpiresIn, google } = require('../config/env');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatUser } = require('../utils/mappers');
const {
  validateEmail,
  validatePassword,
  validateBirthDate,
  validateSex,
  validateNationality,
} = require('../utils/validators');

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = jwtExpiresIn || '24h';
const DEMO_EMAIL = 'demo@colibri.local';

function signToken(user) {
  if (!jwtSecret) {
    throw new AppError('JWT_SECRET no configurado', 500);
  }

  return jwt.sign(
    { id: user.id, email: user.email, isDemo: user.is_demo || false },
    jwtSecret,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function register({ email, password, birthDate, birth_date, sex, nationality }) {
  const validEmail = validateEmail(email);
  const validPassword = validatePassword(password);
  // Acepta snake_case y camelCase desde el frontend. Opcionales en API
  // (NULLables en BD) para no romper clientes antiguos; el formulario
  // de registro los pide como obligatorios.
  const validBirthDate = validateBirthDate(birthDate ?? birth_date);
  const validSex = validateSex(sex);
  const validNationality = validateNationality(nationality);

  const existing = await query('SELECT id FROM users WHERE email = $1', [validEmail]);
  if (existing.rows.length > 0) {
    throw new AppError('El email ya está registrado', 409);
  }

  const passwordHash = await bcrypt.hash(validPassword, SALT_ROUNDS);

  const result = await query(
    `INSERT INTO users (email, password, is_demo, birth_date, sex, nationality)
     VALUES ($1, $2, false, $3, $4, $5)
     RETURNING id, email, is_demo, birth_date, sex, nationality, created_at`,
    [validEmail, passwordHash, validBirthDate, validSex, validNationality]
  );

  const user = result.rows[0];
  const token = signToken(user);

  return { user: formatUser(user), token };
}

async function login({ email, password }) {
  const validEmail = validateEmail(email);

  if (!password) {
    throw new AppError('La contraseña es requerida', 400);
  }

  const result = await query(
    `SELECT id, email, password, is_demo, birth_date, sex, nationality, created_at
     FROM users WHERE email = $1`,
    [validEmail]
  );

  if (result.rows.length === 0) {
    throw new AppError('Credenciales incorrectas', 401);
  }

  const user = result.rows[0];
  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    throw new AppError('Credenciales incorrectas', 401);
  }

  const token = signToken(user);

  return { user: formatUser(user), token };
}

const googleClient = new OAuth2Client();

const USER_SELECT = `id, email, is_demo, birth_date, sex, nationality, google_id, auth_provider, avatar_url, created_at`;

async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new AppError('Token de Google requerido', 400);
  }
  if (!google.clientIds.length) {
    throw new AppError('GOOGLE_CLIENT_ID no configurado en el servidor', 500);
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: google.clientIds,
    });
  } catch {
    throw new AppError('Token de Google inválido o expirado', 401);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new AppError('Token de Google inválido', 401);
  }
  if (payload.email_verified === false) {
    throw new AppError('El email de Google no está verificado', 401);
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    avatarUrl: payload.picture || null,
  };
}

/**
 * Login/registro con Google.
 * - Verifica el id_token contra Google.
 * - Si existe usuario por google_id → login.
 * - Si existe por email (cuenta email/password) → vincula google_id y hace login.
 * - Si no existe → crea la cuenta (sin contraseña local) y devuelve JWT propio.
 */
async function googleLogin({ idToken }) {
  const { googleId, email, avatarUrl } = await verifyGoogleIdToken(idToken);

  // 1) ¿Ya vinculado por google_id?
  // Se usa SELECT * para tolerar BD sin migrar (columnas nuevas ausentes).
  let result;
  try {
    result = await query(`SELECT * FROM users WHERE google_id = $1`, [googleId]);
  } catch (err) {
    if (err && err.code === '42703') {
      throw new AppError(
        'Falta migración 006_google_auth.sql en la base de datos (columnas google_id/auth_provider/avatar_url)',
        500
      );
    }
    throw err;
  }
  if (result.rows.length > 0) {
    const user = result.rows[0];
    if (avatarUrl && user.avatar_url !== avatarUrl) {
      try {
        const updated = await query(
          `UPDATE users SET avatar_url = $2 WHERE id = $1 RETURNING ${USER_SELECT}`,
          [user.id, avatarUrl]
        );
        const token = signToken(updated.rows[0]);
        return { user: formatUser(updated.rows[0]), token, isNewUser: false };
      } catch {
        // Si falla el update (columna ausente), sigue con login normal.
      }
    }
    const token = signToken(user);
    return { user: formatUser(user), token, isNewUser: false };
  }

  // 2) ¿Existe cuenta email/password con ese email? → vincular.
  result = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  if (result.rows.length > 0) {
    const existing = result.rows[0];
    const linked = await query(
      `UPDATE users
       SET google_id = $2,
           avatar_url = COALESCE($3, avatar_url),
           auth_provider = CASE WHEN auth_provider = 'email' THEN 'both' ELSE COALESCE(auth_provider, 'email') END
       WHERE id = $1
       RETURNING ${USER_SELECT}`,
      [existing.id, googleId, avatarUrl]
    );
    const user = linked.rows[0];
    const token = signToken(user);
    return { user: formatUser(user), token, isNewUser: false };
  }

  // 3) Cuenta nueva: sin contraseña local (password NULL, columna NULLable desde migración 006).
  // Se inserta hash aleatorio como fallback por si la BD aún tiene NOT NULL.
  const fallbackHash = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
  let created;
  try {
    created = await query(
      `INSERT INTO users (email, password, is_demo, google_id, auth_provider, avatar_url)
       VALUES ($1, NULL, false, $2, 'google', $3)
       RETURNING ${USER_SELECT}`,
      [email, googleId, avatarUrl]
    );
  } catch (err) {
    if (err && err.code === '23502') {
      // password aún NOT NULL en esta BD → usar hash aleatorio.
      created = await query(
        `INSERT INTO users (email, password, is_demo, google_id, auth_provider, avatar_url)
         VALUES ($1, $2, false, $3, 'google', $4)
         RETURNING ${USER_SELECT}`,
        [email, fallbackHash, googleId, avatarUrl]
      );
    } else if (err && err.code === '42703') {
      throw new AppError(
        'Falta migración 006_google_auth.sql en la base de datos (columnas google_id/auth_provider/avatar_url)',
        500
      );
    } else {
      throw err;
    }
  }

  const user = created.rows[0];
  const token = signToken(user);
  return { user: formatUser(user), token, isNewUser: true };
}

async function getById(userId) {
  const result = await query(`SELECT ${USER_SELECT} FROM users WHERE id = $1`, [userId]);
  if (result.rows.length === 0) {
    throw new AppError('Usuario no encontrado', 404);
  }
  return { user: formatUser(result.rows[0]) };
}

/**
 * Completa el perfil (fecha nacimiento, sexo, nacionalidad).
 * Pensado para cuentas Google, que se crean sin estos datos.
 * Los tres campos son obligatorios aquí.
 */
async function updateProfile(userId, { birthDate, birth_date, sex, nationality }) {
  const validBirthDate = validateBirthDate(birthDate ?? birth_date, { required: true });
  const validSex = validateSex(sex, { required: true });
  const validNationality = validateNationality(nationality, { required: true });

  const result = await query(
    `UPDATE users
     SET birth_date = $2, sex = $3, nationality = $4
     WHERE id = $1
     RETURNING ${USER_SELECT}`,
    [userId, validBirthDate, validSex, validNationality]
  );

  if (result.rows.length === 0) {
    throw new AppError('Usuario no encontrado', 404);
  }

  const user = result.rows[0];
  const token = signToken(user);

  return { user: formatUser(user), token };
}

async function demoLogin() {
  let result = await query(
    `SELECT id, email, is_demo, birth_date, sex, nationality, created_at FROM users WHERE email = $1`,
    [DEMO_EMAIL]
  );

  let user;

  if (result.rows.length === 0) {
    const randomPassword = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);

    result = await query(
      `INSERT INTO users (email, password, is_demo)
       VALUES ($1, $2, true)
       RETURNING id, email, is_demo, birth_date, sex, nationality, created_at`,
      [DEMO_EMAIL, passwordHash]
    );

    user = result.rows[0];
  } else {
    user = result.rows[0];
  }

  const token = signToken(user);

  return {
    user: formatUser(user),
    token,
    message: 'Sesión demo iniciada correctamente',
  };
}

module.exports = {
  register,
  login,
  demoLogin,
  googleLogin,
  getById,
  updateProfile,
};
