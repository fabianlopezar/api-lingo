const AppError = require('../utils/AppError');

/**
 * Manejo global de errores para respuestas JSON consistentes.
 */
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Error interno del servidor';

  // Errores de PostgreSQL
  if (err.code === '23505') {
    statusCode = 409;
    message = 'El registro ya existe (conflicto de unicidad)';
  }

  if (err.code === '23503') {
    statusCode = 400;
    message = 'Referencia inválida: el recurso relacionado no existe';
  }

  if (err.code === '22P02') {
    statusCode = 400;
    message = 'Formato de dato inválido';
  }

  if (!(err instanceof AppError) && statusCode === 500) {
    console.error('[Error]', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Rutas no encontradas.
 */
function notFoundHandler(req, res, next) {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
