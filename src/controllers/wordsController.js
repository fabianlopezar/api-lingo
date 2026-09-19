const wordsService = require('../services/wordsService');
const asyncHandler = require('../utils/asyncHandler');

const getWords = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  const data = await wordsService.getAllWords({
    userId: req.user.id,
    limit,
    offset,
  });

  res.json({
    success: true,
    data,
  });
});

const createWord = asyncHandler(async (req, res) => {
  const {
    word,
    translation,
    definition,
    language,
    pronunciation,
    english_word,
    spanish_word,
    category_id,
    categoryId,
  } = req.body;
  const newWord = await wordsService.createWord(req.user.id, {
    word,
    translation,
    definition,
    language,
    pronunciation,
    english_word,
    spanish_word,
    category_id,
    categoryId,
  });

  res.status(201).json({
    success: true,
    message: 'Palabra creada correctamente',
    data: newWord,
  });
});

const updateWord = asyncHandler(async (req, res) => {
  const {
    word,
    translation,
    definition,
    pronunciation,
    english_word,
    spanish_word,
    category_id,
    categoryId,
  } = req.body;
  const updated = await wordsService.updateWord(req.user.id, req.params.id, {
    word,
    translation,
    definition,
    pronunciation,
    english_word,
    spanish_word,
    category_id,
    categoryId,
  });

  res.json({
    success: true,
    message: 'Palabra actualizada correctamente',
    data: updated,
  });
});

const getRandomWord = asyncHandler(async (req, res) => {
  // `exclude`: ids (coma-separados) vistos recientemente en la sesión.
  const { exclude } = req.query || {};
  const word = await wordsService.getRandomWord(req.user.id, { excludeIds: exclude });

  res.json({
    success: true,
    data: word,
  });
});

const getWordById = asyncHandler(async (req, res) => {
  const word = await wordsService.getWordById(req.user.id, req.params.id);

  res.json({
    success: true,
    data: word,
  });
});

const lookupWord = asyncHandler(async (req, res) => {
  const { word, term, query: queryTerm, english_word, spanish_word } = req.body || {};
  const result = await wordsService.lookupAndSaveWord(
    req.user.id,
    word ?? term ?? queryTerm ?? english_word ?? spanish_word
  );

  if (!result.found) {
    return res.status(404).json({
      success: false,
      message: `La palabra "${result.term}" no existe en la base de datos. Se delega a Task 2 para su creación.`,
      data: result,
    });
  }

  if (result.created) {
    return res.status(201).json({
      success: true,
      message: 'Palabra no encontrada: creada con Task 2 (Gemini) y añadida a tu lista de aprendizaje',
      data: result,
    });
  }

  res.status(result.added ? 201 : 200).json({
    success: true,
    message: result.added
      ? 'Palabra encontrada y añadida a tu lista de aprendizaje'
      : 'La palabra ya estaba en tu lista de aprendizaje',
    data: result,
  });
});

const searchWords = asyncHandler(async (req, res) => {
  const { q, limit } = req.query || {};
  const data = await wordsService.searchWords(req.user.id, q ?? '', { limit });

  res.json({
    success: true,
    data,
  });
});

const enrichWord = asyncHandler(async (req, res) => {
  const { skipIllustration } = req.query || {};
  await wordsService.assertUserOwnsWord(req.user.id, req.params.id);
  const { ensureWordDetails } = require('../services/unknownWordService');
  const result = await ensureWordDetails(req.params.id, {
    skipIllustration: skipIllustration === 'true' || skipIllustration === '1',
  });
  const word = await wordsService.getWordById(req.user.id, req.params.id);

  res.json({
    success: true,
    message: result.enriched
      ? 'Palabra enriquecida con sinónimos, antónimos y ejemplos'
      : 'La palabra ya tenía características guardadas',
    data: { enriched: result.enriched, word, details: result.details },
  });
});

module.exports = {
  getWords,
  createWord,
  updateWord,
  getRandomWord,
  getWordById,
  lookupWord,
  searchWords,
  enrichWord,
};
