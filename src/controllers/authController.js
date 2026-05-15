const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

const register = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const data = await authService.register({ email, password });

  res.status(201).json({
    success: true,
    message: 'Usuario registrado correctamente',
    data,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const data = await authService.login({ email, password });

  res.json({
    success: true,
    message: 'Inicio de sesión exitoso',
    data,
  });
});

const demoLogin = asyncHandler(async (req, res) => {
  const data = await authService.demoLogin();

  res.json({
    success: true,
    message: data.message,
    data: {
      user: data.user,
      token: data.token,
    },
  });
});

module.exports = {
  register,
  login,
  demoLogin,
};
