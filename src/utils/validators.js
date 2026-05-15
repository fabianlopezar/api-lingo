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

module.exports = {
  validateEmail,
  validatePassword,
  validateRequiredString,
  validateUuid,
};
