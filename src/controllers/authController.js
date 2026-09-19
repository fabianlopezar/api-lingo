const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

const register = asyncHandler(async (req, res) => {
  const { email, password, birthDate, birth_date, sex, nationality } = req.body;
  const data = await authService.register({
    email,
    password,
    birthDate: birthDate ?? birth_date,
    sex,
    nationality,
  });

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

const googleLogin = asyncHandler(async (req, res) => {
  const { idToken, id_token, credential } = req.body;
  const data = await authService.googleLogin({
    idToken: idToken ?? id_token ?? credential,
  });

  res.status(data.isNewUser ? 201 : 200).json({
    success: true,
    message: data.isNewUser ? 'Cuenta creada con Google' : 'Inicio de sesión con Google exitoso',
    data: {
      user: data.user,
      token: data.token,
    },
  });
});

const me = asyncHandler(async (req, res) => {
  const data = await authService.getById(req.user.id);

  res.json({
    success: true,
    data,
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { birthDate, birth_date, sex, nationality } = req.body;
  const data = await authService.updateProfile(req.user.id, {
    birthDate: birthDate ?? birth_date,
    sex,
    nationality,
  });

  res.json({
    success: true,
    message: 'Perfil completado correctamente',
    data: {
      user: data.user,
      token: data.token,
    },
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
  googleLogin,
  me,
  updateProfile,
};
