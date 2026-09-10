const { query, getPool } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatWord } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');
const { resolveCategoryId } = require('./categoriesService');
const { handleUnknownWord } = require('./unknownWordService');

const USER_WORDS_JOIN = `
  FROM user_words uw
  INNER JOIN words w ON w.id = uw.word_id
  LEFT JOIN categories c ON c.id = w.category_id
`;

const WORD_SELECT = `
  w.id, w.english_word, w.spanish_word, w.pronunciation, w.created_at,
  w.category_id, c.nombre_categoria, c.calificacion_categoria, uw.status
`;

async function getAllWords({ userId, limit = 50, offset = 0 } = {}) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT ${WORD_SELECT}
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

async function createWord(
  userId,
  { word, translation, english_word, spanish_word, pronunciation, definition, category_id, categoryId }
) {
  const validUserId = validateUuid(userId, 'user id');
  const englishWord = validateRequiredString(english_word || word, 'word / english_word');
  const spanishWord = validateRequiredString(spanish_word || translation, 'translation / spanish_word');
  const pron =
    pronunciation !== undefined
      ? pronunciation?.trim() || null
      : definition?.trim() || null;
  const resolvedCategoryId = await resolveCategoryId(validUserId, category_id ?? categoryId ?? null);

  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Restricción: solo crea la palabra si `word` (english_word) no existe.
    // Si ya existe, reutiliza esa fila global (se ignora la traducción
    // entrante) y solo crea el enlace en `user_words`.
    const existing = await client.query(
      `SELECT id, english_word, spanish_word, pronunciation, category_id, created_at
       FROM words
       WHERE LOWER(english_word) = LOWER($1)
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [englishWord]
    );

    let newWord;
    if (existing.rows.length > 0) {
      newWord = existing.rows[0];
    } else {
      const wordResult = await client.query(
        `INSERT INTO words (english_word, spanish_word, pronunciation, category_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, english_word, spanish_word, pronunciation, category_id, created_at`,
        [englishWord, spanishWord, pron, resolvedCategoryId]
      );
      newWord = wordResult.rows[0];
    }

    await client.query(
      `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
       VALUES ($1, $2, 'learning', 0, 0)`,
      [validUserId, newWord.id]
    );

    await client.query('COMMIT');

    // La categoría mostrada es la almacenada en la fila (al reutilizar una
    // palabra global no se toca su category_id: es compartida con otros mazos).
    if (newWord.category_id) {
      const cat = await query(
        'SELECT nombre_categoria, calificacion_categoria FROM categories WHERE id = $1',
        [newWord.category_id]
      );
      if (cat.rows[0]) {
        newWord.nombre_categoria = cat.rows[0].nombre_categoria;
        newWord.calificacion_categoria = cat.rows[0].calificacion_categoria;
      }
    }

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

async function updateWord(
  userId,
  id,
  { word, translation, english_word, spanish_word, pronunciation, definition, category_id, categoryId }
) {
  const wordId = await assertUserOwnsWord(userId, id);

  const englishWord = validateRequiredString(english_word || word, 'english_word / word');
  const spanishWord = validateRequiredString(spanish_word || translation, 'spanish_word / translation');
  const pron =
    pronunciation !== undefined
      ? pronunciation?.trim() || null
      : definition !== undefined
        ? definition?.trim() || null
        : undefined;

  const hasCategoryUpdate = category_id !== undefined || categoryId !== undefined;
  const resolvedCategoryId = hasCategoryUpdate
    ? await resolveCategoryId(userId, category_id ?? categoryId ?? null)
    : undefined;

  let result;
  if (pron !== undefined && hasCategoryUpdate) {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2, pronunciation = $3, category_id = $4
       WHERE id = $5
       RETURNING id, english_word, spanish_word, pronunciation, category_id, created_at`,
      [englishWord, spanishWord, pron, resolvedCategoryId, wordId]
    );
  } else if (pron !== undefined) {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2, pronunciation = $3
       WHERE id = $4
       RETURNING id, english_word, spanish_word, pronunciation, category_id, created_at`,
      [englishWord, spanishWord, pron, wordId]
    );
  } else if (hasCategoryUpdate) {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2, category_id = $3
       WHERE id = $4
       RETURNING id, english_word, spanish_word, pronunciation, category_id, created_at`,
      [englishWord, spanishWord, resolvedCategoryId, wordId]
    );
  } else {
    result = await query(
      `UPDATE words
       SET english_word = $1, spanish_word = $2
       WHERE id = $3
       RETURNING id, english_word, spanish_word, pronunciation, category_id, created_at`,
      [englishWord, spanishWord, wordId]
    );
  }

  const row = result.rows[0];
  if (row.category_id) {
    const cat = await query(
      'SELECT nombre_categoria, calificacion_categoria FROM categories WHERE id = $1',
      [row.category_id]
    );
    if (cat.rows[0]) {
      row.nombre_categoria = cat.rows[0].nombre_categoria;
      row.calificacion_categoria = cat.rows[0].calificacion_categoria;
    }
  }

  return formatWord(row);
}

async function getRandomWord(userId) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT ${WORD_SELECT}
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

/** pg / network codes that mean "DB unreachable" (→ 503, not 500). */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'ECONNRESET',
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '53300', // too_many_connections
]);

function isConnectionError(error) {
  return (
    CONNECTION_ERROR_CODES.has(error?.code) ||
    /timeout|expir|connect/i.test(error?.message || '')
  );
}

/**
 * Task 1 — Word lookup microservice function.
 *
 * 1. Exact-matches `term` against `words.english_word` OR `words.spanish_word`
 *    (parameterized — no string interpolation, SQL-injection safe).
 * 2. On HIT: inserts the `word_id` into the requester's `user_words`
 *    learning list (idempotent via ON CONFLICT DO NOTHING) and returns
 *    `{ found: true, added, wordId, word }`.
 * 3. On MISS: saves nothing, delegates to Task 2 (`options.onNotFound`,
 *    defaults to `handleUnknownWord`) and returns a
 *    `{ found: false, term, delegatedTo: 'Task2' }` signal. Word
 *    creation/insertion is Task 2's job — never done here.
 *
 * @param {string} userId  Authenticated user id (from `req.user.id`).
 * @param {string} rawTerm Lookup term from the request body.
 * @param {object} [options]
 * @param {Function} [options.onNotFound=handleUnknownWord] Task 2 hook:
 *   `async (userId, term) => handoff`. May throw AppError(404) instead —
 *   the throw propagates as the not-found signal.
 */
async function lookupAndSaveWord(userId, rawTerm, options = {}) {
  const validUserId = validateUuid(userId, 'user id');
  const term = validateRequiredString(rawTerm, 'word');
  const { onNotFound = handleUnknownWord } = options;

  let match;
  try {
    match = await query(
      `SELECT
         w.id, w.english_word, w.spanish_word, w.pronunciation,
         w.category_id, w.created_at,
         c.nombre_categoria, c.calificacion_categoria
       FROM words w
       LEFT JOIN categories c ON c.id = w.category_id
       WHERE w.english_word = $1 OR w.spanish_word = $1
       LIMIT 1`,
      [term]
    );
  } catch (error) {
    console.error('[lookupWord] Query failed:', {
      userId: validUserId,
      term,
      code: error?.code,
      message: error?.message,
    });
    if (error instanceof AppError) throw error;
    if (isConnectionError(error)) {
      throw new AppError('Base de datos no disponible. Inténtalo de nuevo más tarde.', 503);
    }
    throw error;
  }

  if (match.rows.length === 0) {
    console.log('[lookupWord] Miss — delegating to Task 2:', {
      userId: validUserId,
      term,
    });

    let task2 = { delegated: true, delegatedTo: 'Task2' };
    if (typeof onNotFound === 'function') {
      const handoff = await onNotFound(validUserId, term);
      if (handoff !== undefined) task2 = handoff;
    }

    return { found: false, term, delegatedTo: 'Task2', task2 };
  }

  const row = match.rows[0];

  try {
    const insert = await query(
      `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
       VALUES ($1, $2, 'learning', 0, 0)
       ON CONFLICT (user_id, word_id) DO NOTHING
       RETURNING id`,
      [validUserId, row.id]
    );
    const added = insert.rows.length > 0;

    console.log('[lookupWord] Hit:', {
      userId: validUserId,
      term,
      wordId: row.id,
      added,
    });

    return {
      found: true,
      added,
      alreadyInList: !added,
      wordId: row.id,
      word: formatWord({ ...row, status: 'learning' }),
    };
  } catch (error) {
    console.error('[lookupWord] Save to learning list failed:', {
      userId: validUserId,
      term,
      wordId: row.id,
      code: error?.code,
      message: error?.message,
    });
    if (error instanceof AppError) throw error;
    if (isConnectionError(error)) {
      throw new AppError('Base de datos no disponible. Inténtalo de nuevo más tarde.', 503);
    }
    throw error;
  }
}

module.exports = {
  getAllWords,
  createWord,
  updateWord,
  getRandomWord,
  lookupAndSaveWord,
  assertUserOwnsWord,
};
