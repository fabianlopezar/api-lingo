const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatWord } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');

async function getAllWords({ limit = 50, offset = 0 } = {}) {
  const result = await query(
    `SELECT id, english_word, spanish_word, pronunciation, created_at
     FROM words
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const countResult = await query('SELECT COUNT(*)::int AS total FROM words');

  return {
    words: result.rows.map(formatWord),
    total: countResult.rows[0].total,
    limit,
    offset,
  };
}

async function createWord({ word, translation, english_word, spanish_word, pronunciation, definition }) {
  const englishWord = validateRequiredString(english_word || word, 'word / english_word');
  const spanishWord = validateRequiredString(spanish_word || translation, 'translation / spanish_word');
  const pron =
    pronunciation !== undefined
      ? pronunciation?.trim() || null
      : definition?.trim() || null;

  const result = await query(
    `INSERT INTO words (english_word, spanish_word, pronunciation)
     VALUES ($1, $2, $3)
     RETURNING id, english_word, spanish_word, pronunciation, created_at`,
    [englishWord, spanishWord, pron]
  );

  return formatWord(result.rows[0]);
}

async function updateWord(id, { word, translation, english_word, spanish_word, pronunciation, definition }) {
  const wordId = validateUuid(id, 'word id');

  const existing = await query('SELECT id FROM words WHERE id = $1', [wordId]);
  if (existing.rows.length === 0) {
    throw new AppError('La palabra no existe', 404);
  }

  const englishWord = validateRequiredString(english_word || word, 'english_word / word');
  const spanishWord = validateRequiredString(spanish_word || translation, 'spanish_word / translation');
  const pron =
    pronunciation !== undefined
      ? pronunciation?.trim() || null
      : definition !== undefined
        ? definition?.trim() || null
        : undefined;

  let result;
  if (pron !== undefined) {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2, pronunciation = $3
       WHERE id = $4
       RETURNING id, english_word, spanish_word, pronunciation, created_at`,
      [englishWord, spanishWord, pron, wordId]
    );
  } else {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2
       WHERE id = $3
       RETURNING id, english_word, spanish_word, pronunciation, created_at`,
      [englishWord, spanishWord, wordId]
    );
  }

  return formatWord(result.rows[0]);
}

async function getRandomWord(userId = null) {
  const params = [];
  let sql = `
    SELECT w.id, w.english_word, w.spanish_word, w.pronunciation, w.created_at
    FROM words w
  `;

  if (userId) {
    params.push(userId);
    sql += `
      WHERE w.id NOT IN (
        SELECT word_id FROM user_words
        WHERE user_id = $1 AND status = 'learned'
      )
    `;
  }

  sql += ' ORDER BY RANDOM() LIMIT 1';

  const result = await query(sql, params);

  if (result.rows.length === 0) {
    throw new AppError(
      userId
        ? 'No hay palabras nuevas disponibles. ¡Has aprendido todas!'
        : 'No hay palabras en la base de datos',
      404
    );
  }

  return formatWord(result.rows[0]);
}

module.exports = {
  getAllWords,
  createWord,
  updateWord,
  getRandomWord,
};
