const express = require('express');
const wordsController = require('../controllers/wordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Requiere autenticación: solo palabras del usuario autenticado
router.get('/', authMiddleware, wordsController.getWords);
router.get('/random', authMiddleware, wordsController.getRandomWord);
// '/search' va antes de '/:id' para que no la capture el parámetro.
router.get('/search', authMiddleware, wordsController.searchWords);
router.get('/:id', authMiddleware, wordsController.getWordById);
router.post('/lookup', authMiddleware, wordsController.lookupWord);
router.post('/:id/enrich', authMiddleware, wordsController.enrichWord);
router.post('/', authMiddleware, wordsController.createWord);
router.patch('/:id', authMiddleware, wordsController.updateWord);

module.exports = router;
