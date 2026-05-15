const wordsService = require('../services/wordsService');
const asyncHandler = require('../utils/asyncHandler');

const getWords = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const { language } = req.query;

  const data = await wordsService.getAllWords({ limit, offset, language });

  res.json({
    success: true,
    data,
  });
});

const createWord = asyncHandler(async (req, res) => {
  const { word, translation, definition, language } = req.body;
  const newWord = await wordsService.createWord({ word, translation, definition, language });

  res.status(201).json({
    success: true,
    message: 'Palabra creada correctamente',
    data: newWord,
  });
});

const getRandomWord = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const word = await wordsService.getRandomWord(userId);

  res.json({
    success: true,
    data: word,
  });
});

module.exports = {
  getWords,
  createWord,
  getRandomWord,
};
