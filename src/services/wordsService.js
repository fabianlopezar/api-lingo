const { query, getPool } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatWord } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');

const USER_WORDS_JOIN = `
  FROM user_words uw
  INNER JOIN words w ON w.id = uw.word_id
`;

async function getAllWords({ userId, limit = 50, offset = 0 } = {}) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT w.id, w.english_word, w.spanish_word, w.pronunciation, w.created_at, uw.status
     ${USER_WORDS_JOIN}
     WHERE uw.user_id = $1
     ORDER BY w.created_at DESC
     LIMIT $2 OFFSET $3`,
    [validUserId, limit, offset]
  );

  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM user_words WHERE user_id = $1',
    [validUserId]
  );

  return {
    words: result.rows.map(formatWord),
    total: countResult.rows[0].total,
    limit,
    offset,
  };
}

async function assertUserOwnsWord(userId, wordId) {
  const validUserId = validateUuid(userId, 'user id');
  const validWordId = validateUuid(wordId, 'word id');

  const link = await query(
    'SELECT id FROM user_words WHERE user_id = $1 AND word_id = $2',
    [validUserId, validWordId]
  );

  if (link.rows.length === 0) {
    throw new AppError('La palabra no existe en tu mazo', 404);
  }

  return validWordId;
}

async function createWord(userId, { word, translation, english_word, spanish_word, pronunciation, definition }) {
  const validUserId = validateUuid(userId, 'user id');
  const englishWord = validateRequiredString(english_word || word, 'word / english_word');
  const spanishWord = validateRequiredString(spanish_word || translation, 'translation / spanish_word');
  const pron =
    pronunciation !== undefined
      ? pronunciation?.trim() || null
      : definition?.trim() || null;

  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const wordResult = await client.query(
      `INSERT INTO words (english_word, spanish_word, pronunciation)
       VALUES ($1, $2, $3)
       RETURNING id, english_word, spanish_word, pronunciation, created_at`,
      [englishWord, spanishWord, pron]
    );

    const newWord = wordResult.rows[0];

    await client.query(
      `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
       VALUES ($1, $2, 'learning', 0, 0)`,
      [validUserId, newWord.id]
    );

    await client.query('COMMIT');
    return formatWord(newWord);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError('Ya tienes esta palabra en tu mazo', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateWord(userId, id, { word, translation, english_word, spanish_word, pronunciation, definition }) {
  const wordId = await assertUserOwnsWord(userId, id);

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

async function getRandomWord(userId) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT w.id, w.english_word, w.spanish_word, w.pronunciation, w.created_at
     ${USER_WORDS_JOIN}
     WHERE uw.user_id = $1
       AND uw.status = 'learning'
     ORDER BY RANDOM()
     LIMIT 1`,
    [validUserId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No hay palabras nuevas disponibles. ¡Has aprendido todas!', 404);
  }

  return formatWord(result.rows[0]);
}

module.exports = {
  getAllWords,
  createWord,
  updateWord,
  getRandomWord,
  assertUserOwnsWord,
};
