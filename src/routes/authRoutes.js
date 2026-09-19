const express = require('express');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.post('/demo-login', authController.demoLogin);
router.get('/me', authMiddleware, authController.me);
router.patch('/profile', authMiddleware, authController.updateProfile);

module.exports = router;
