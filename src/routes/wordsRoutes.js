const express = require('express');
const wordsController = require('../controllers/wordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Público: listar palabras
router.get('/', wordsController.getWords);

// Requiere autenticación: crear palabra y obtener aleatoria (excluye aprendidas)
router.post('/', authMiddleware, wordsController.createWord);
router.get('/random', authMiddleware, wordsController.getRandomWord);

module.exports = router;
