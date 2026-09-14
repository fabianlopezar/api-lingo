const AppError = require('./AppError');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    throw new AppError('Email inválido', 400);
  }
  return email.trim().toLowerCase();
}

function validatePassword(password, minLength = 6) {
  if (!password || typeof password !== 'string' || password.length < minLength) {
    throw new AppError(`La contraseña debe tener al menos ${minLength} caracteres`, 400);
  }
  return password;
}

function validateRequiredString(value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} es requerido`, 400);
  }
  return value.trim();
}

function validateUuid(value, fieldName = 'ID') {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value || !uuidRegex.test(value)) {
    throw new AppError(`${fieldName} inválido`, 400);
  }
  return value;
}

const ALLOWED_SEX_VALUES = new Set([
  'femenino',
  'masculino',
  'otro',
  'prefiero_no_decirlo',
  'prefiero no decirlo',
  'no_especificado',
  'female',
  'male',
  'other',
]);

function validateBirthDate(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError('La fecha de nacimiento es requerida', 400);
    return null;
  }
  const str = String(value).trim();
  // Acepta YYYY-MM-DD (input type="date" del frontend).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new AppError('Fecha de nacimiento inválida (usa YYYY-MM-DD)', 400);
  }
  const date = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Fecha de nacimiento inválida', 400);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) {
    throw new AppError('La fecha de nacimiento no puede ser futura', 400);
  }
  return str;
}

function validateSex(value, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new AppError('El sexo es requerido', 400);
    return null;
  }
  const normalized = String(value).trim().toLowerCase().slice(0, 20);
  if (!ALLOWED_SEX_VALUES.has(normalized)) {
    throw new AppError(
      'Sexo inválido (usa femenino, masculino, otro o prefiero_no_decirlo)',
      400
    );
  }
  return normalized;
}

function validateNationality(value, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new AppError('La nacionalidad es requerida', 400);
    return null;
  }
  const normalized = String(value).trim().slice(0, 100);
  if (!normalized) {
    if (required) throw new AppError('La nacionalidad es requerida', 400);
    return null;
  }
  return normalized;
}

module.exports = {
  validateEmail,
  validatePassword,
  validateRequiredString,
  validateUuid,
  validateBirthDate,
  validateSex,
  validateNationality,
};
