const userWordsService = require('../services/userWordsService');
const leitnerService = require('../services/leitnerService');
const asyncHandler = require('../utils/asyncHandler');

const markLearned = asyncHandler(async (req, res) => {
  const { word_id: wordId } = req.body;
  const record = await userWordsService.markAsLearned(req.user.id, wordId);

  res.status(201).json({
    success: true,
    message: 'Palabra marcada como aprendida',
    data: record,
  });
});

const getLearned = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const data = await userWordsService.getLearnedWords(req.user.id, { limit, offset });

  res.json({
    success: true,
    data,
  });
});

const evaluateReview = asyncHandler(async (req, res) => {
  // Acepta `isCorrect` o alias `correct` / `is_correct`.
  const { word_id: wordId, wordId: wordIdCamel, isCorrect, correct, is_correct } = req.body || {};
  const result = await leitnerService.evaluateReviewResponse(
    req.user.id,
    wordId ?? wordIdCamel,
    isCorrect ?? correct ?? is_correct
  );

  res.json({
    success: true,
    message: result.isCorrect
      ? `¡Correcto! Avanza a la Caja ${result.currentBox}`
      : 'Fallaste: la palabra regresa a la Caja 1',
    data: result,
  });
});

const getDueReviews = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const data = await leitnerService.getWordsDueForReview(req.user.id, { limit, offset });

  res.json({
    success: true,
    data,
  });
});

const getReviewStats = asyncHandler(async (req, res) => {
  const data = await leitnerService.getReviewStats(req.user.id);

  res.json({
    success: true,
    data,
  });
});

module.exports = {
  markLearned,
  getLearned,
  evaluateReview,
  getDueReviews,
  getReviewStats,
};
