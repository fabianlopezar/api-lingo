const express = require('express');
const wordsController = require('../controllers/wordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Público: listar palabras
router.get('/',authMiddleware, wordsController.getWords);

// Requiere autenticación: crear palabra y obtener aleatoria (excluye aprendidas)
router.get('/random', authMiddleware, wordsController.getRandomWord);
router.post('/', authMiddleware, wordsController.createWord);
router.patch('/:id', authMiddleware, wordsController.updateWord);

module.exports = router;
