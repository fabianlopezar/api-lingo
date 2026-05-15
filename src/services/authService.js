const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatUser } = require('../utils/mappers');
const { validateEmail, validatePassword } = require('../utils/validators');

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = '7d';
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

async function register({ email, password }) {
  const validEmail = validateEmail(email);
  const validPassword = validatePassword(password);

  const existing = await query('SELECT id FROM users WHERE email = $1', [validEmail]);
  if (existing.rows.length > 0) {
    throw new AppError('El email ya está registrado', 409);
  }

  const passwordHash = await bcrypt.hash(validPassword, SALT_ROUNDS);

  const result = await query(
    `INSERT INTO users (email, password, is_demo)
     VALUES ($1, $2, false)
     RETURNING id, email, is_demo, created_at`,
    [validEmail, passwordHash]
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
    `SELECT id, email, password, is_demo, created_at
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

async function demoLogin() {
  let result = await query(
    `SELECT id, email, is_demo, created_at FROM users WHERE email = $1`,
    [DEMO_EMAIL]
  );

  let user;

  if (result.rows.length === 0) {
    const randomPassword = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);

    result = await query(
      `INSERT INTO users (email, password, is_demo)
       VALUES ($1, $2, true)
       RETURNING id, email, is_demo, created_at`,
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
};
