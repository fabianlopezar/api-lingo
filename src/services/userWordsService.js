const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatWord } = require('../utils/mappers');
const { validateUuid } = require('../utils/validators');

async function upsertTodayStats(userId) {
  const existing = await query(
    `SELECT id, words_learned FROM stats
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE stats SET words_learned = words_learned + 1 WHERE id = $1`,
      [existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO stats (user_id, date, words_learned, study_time)
       VALUES ($1, CURRENT_DATE, 1, 0)`,
      [userId]
    );
  }
}

async function markAsLearned(userId, wordId) {
  const validWordId = validateUuid(wordId, 'word_id');

  const existing = await query(
    `SELECT id, status FROM user_words WHERE user_id = $1 AND word_id = $2`,
    [userId, validWordId]
  );

  if (existing.rows.length === 0) {
    throw new AppError('La palabra no está en tu mazo', 404);
  }

  if (existing.rows[0].status === 'learned') {
    throw new AppError('Esta palabra ya está marcada como aprendida', 409);
  }

  const updated = await query(
    `UPDATE user_words
     SET status = 'learned', learned_at = NOW(), times_correct = times_correct + 1
     WHERE id = $1
     RETURNING id, user_id, word_id, status, learned_at, times_seen, times_correct`,
    [existing.rows[0].id]
  );

  await upsertTodayStats(userId);

  return updated.rows[0];
}

async function getLearnedWords(userId, { limit = 50, offset = 0 } = {}) {
  const result = await query(
    `SELECT
       uw.id,
       uw.status,
       uw.learned_at,
       uw.times_seen,
       uw.times_correct,
       w.id AS word_id,
       w.english_word,
       w.spanish_word,
       w.pronunciation
     FROM user_words uw
     INNER JOIN words w ON w.id = uw.word_id
     WHERE uw.user_id = $1 AND uw.status = 'learned'
     ORDER BY uw.learned_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM user_words
     WHERE user_id = $1 AND status = 'learned'`,
    [userId]
  );

  return {
    learnedWords: result.rows.map((row) => ({
      ...row,
      word: formatWord({
        id: row.word_id,
        english_word: row.english_word,
        spanish_word: row.spanish_word,
        pronunciation: row.pronunciation,
      }),
    })),
    total: countResult.rows[0].total,
    limit,
    offset,
  };
}

module.exports = {
  markAsLearned,
  getLearnedWords,
};
