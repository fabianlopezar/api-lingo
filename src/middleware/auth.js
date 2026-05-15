const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Middleware JWT: extrae el token del header Authorization Bearer.
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Token de autenticación requerido', 401);
    }

    const token = authHeader.split(' ')[1];

    if (!jwtSecret) {
      throw new AppError('JWT_SECRET no configurado en el servidor', 500);
    }

    const decoded = jwt.verify(token, jwtSecret);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      isDemo: decoded.isDemo || false,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Token inválido', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token expirado', 401));
    }
    next(error);
  }
}

module.exports = authMiddleware;
