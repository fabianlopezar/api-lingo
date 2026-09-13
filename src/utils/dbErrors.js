const AppError = require('./AppError');

/** Códigos pg / red que significan "BD inalcanzable" (→ 503, no 500). */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'ECONNRESET',
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '53300', // too_many_connections
]);

function isConnectionError(error) {
  return (
    CONNECTION_ERROR_CODES.has(error?.code) ||
    /timeout|expir|connect/i.test(error?.message || '')
  );
}

/**
 * Log contextual + mapeo de errores de BD: AppError se propaga intacto,
 * fallos de conexión → 503, el resto se relanza para el errorHandler global.
 */
function handleDbError(error, context) {
  console.error('[DB] Operación fallida:', { ...context, code: error?.code, message: error?.message });
  if (error instanceof AppError) throw error;
  if (isConnectionError(error)) {
    throw new AppError('Base de datos no disponible. Inténtalo de nuevo más tarde.', 503);
  }
  throw error;
}

module.exports = {
  isConnectionError,
  handleDbError,
};
