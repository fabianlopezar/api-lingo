const express = require('express');
const wordsController = require('../controllers/wordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Requiere autenticación: solo palabras del usuario autenticado
router.get('/', authMiddleware, wordsController.getWords);
router.get('/random', authMiddleware, wordsController.getRandomWord);
router.post('/', authMiddleware, wordsController.createWord);
router.patch('/:id', authMiddleware, wordsController.updateWord);

module.exports = router;
