const express = require('express');
const userWordsController = require('../controllers/userWordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.post('/learned', userWordsController.markLearned);
router.get('/learned', userWordsController.getLearned);

module.exports = router;
