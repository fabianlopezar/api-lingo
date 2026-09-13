const express = require('express');
const userWordsController = require('../controllers/userWordsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.post('/learned', userWordsController.markLearned);
router.get('/learned', userWordsController.getLearned);

// Sistema Leitner (repetición espaciada). Antes de `/:id` para no colisionar.
router.get('/review/due', userWordsController.getDueReviews);
router.get('/review/stats', userWordsController.getReviewStats);
router.post('/review', userWordsController.evaluateReview);

module.exports = router;
