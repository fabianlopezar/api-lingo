const userWordsService = require('../services/userWordsService');
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

module.exports = {
  markLearned,
  getLearned,
};
