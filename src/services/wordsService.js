const { query, getPool } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatWord, attachIllustrations, attachLinguisticDetails } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');
const { resolveCategoryId } = require('./categoriesService');
const { leitnerReady } = require('../utils/leitnerSupport');
const { handleUnknownWord, ensureWordDetails } = require('./unknownWordService');
const { isConnectionError } = require('../utils/dbErrors');

const USER_WORDS_JOIN = `
  FROM user_words uw
  INNER JOIN words w ON w.id = uw.word_id
  LEFT JOIN categories c ON c.id = w.category_id
`;

const WORD_SELECT_BASE = `
  w.id, w.english_word, w.spanish_word, w.pronunciation, w.created_at,
  w.category_id, c.nombre_categoria, c.calificacion_categoria, uw.status
`;

// Columnas Leitner (migración 004). Solo se incluyen si la migración ya
// fue aplicada en Supabase; si no, el SELECT degrada sin romper.
const WORD_SELECT_LEITNER = `
  , uw.current_box, uw.last_reviewed_at, uw.next_review_at,
  uw.times_seen, uw.times_correct
`;

async function wordSelect() {
  if (await leitnerReady()) return WORD_SELECT_BASE + WORD_SELECT_LEITNER;
  return WORD_SELECT_BASE;
}

async function getAllWords({ userId, limit = 50, offset = 0 } = {}) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT ${await wordSelect()}
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

  const words = result.rows.map(formatWord);
  await attachIllustrations(words);
  await attachLinguisticDetails(words);

  return {
    words,
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

    // Palabra nueva → Caja 1. Si la migración 004 aún no fue aplicada,
    // se inserta sin columnas Leitner (degrada sin romper).
    if (await leitnerReady()) {
      await client.query(
        `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct,
                                current_box, last_reviewed_at, next_review_at)
         VALUES ($1, $2, 'learning', 0, 0, 1, NOW(), NOW() + INTERVAL '1 day')`,
        [validUserId, newWord.id]
      );
    } else {
      await client.query(
        `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
         VALUES ($1, $2, 'learning', 0, 0)`,
        [validUserId, newWord.id]
      );
    }

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

    const formatted = formatWord(newWord);
    await attachIllustrations(formatted);
    await attachLinguisticDetails(formatted);
    return formatted;
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

  const formatted = formatWord(row);
  await attachIllustrations(formatted);
  await attachLinguisticDetails(formatted);
  return formatted;
}

async function getRandomWord(userId, { excludeIds = [] } = {}) {
  const validUserId = validateUuid(userId, 'user id');
  // Solo UUIDs válidos: evita inyección y ruido en el historial del cliente.
  const excluded = [...new Set(
    (Array.isArray(excludeIds) ? excludeIds : String(excludeIds || '').split(','))
      .map((id) => String(id || '').trim())
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
  )].slice(0, 50);

  // Leitner: las vencidas (next_review_at <= NOW()) salen primero,
  // ordenadas por urgencia: caja más baja primero (caja 1 = más urgente),
  // luego la más vencida. RANDOM() solo como desempate final.
  // Sin la migración 004 se degrada al azar puro.
  const ready = await leitnerReady();
  const orderBy = ready
    ? 'ORDER BY (uw.next_review_at <= NOW()) DESC, COALESCE(uw.current_box, 1) ASC, uw.next_review_at ASC, RANDOM()'
    : 'ORDER BY RANDOM()';

  const baseWhere = 'WHERE uw.user_id = $1 AND uw.status = $2';
  const notRecent = excluded.length > 0 ? 'AND NOT (w.id = ANY($3::uuid[]))' : '';

  const run = async (withExclusions) =>
    query(
      `SELECT ${await wordSelect()}
       ${USER_WORDS_JOIN}
       ${baseWhere}
       ${withExclusions ? notRecent : ''}
       ${orderBy}
       LIMIT 1`,
      withExclusions && excluded.length > 0
        ? [validUserId, 'learning', excluded]
        : [validUserId, 'learning']
    );

  let result = await run(true);
  // Mazo pequeño: si todo está en el historial reciente, se reintenta
  // sin exclusiones antes de declarar el mazo agotado.
  if (result.rows.length === 0 && excluded.length > 0) {
    result = await run(false);
  }

  if (result.rows.length === 0) {
    throw new AppError('No hay palabras nuevas disponibles. ¡Has aprendido todas!', 404);
  }

  const word = formatWord(result.rows[0]);
  await attachIllustrations(word);
  await attachLinguisticDetails(word);
  return word;
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
 *   `async (userId, term) => result`. Si Task 2 crea la palabra, su
 *   resultado (`{ created: true, ... }`) se propaga tal cual; si devuelve
 *   un handoff informativo se envuelve en la señal `{ found: false, ... }`.
 *   También puede lanzar AppError(404) — el throw propaga la señal.
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
      // Task 2 resolvió el miss (creó o encontró la palabra): propagar.
      if (handoff && (handoff.created || handoff.found)) return handoff;
      if (handoff !== undefined) task2 = handoff;
    }

    return { found: false, term, delegatedTo: 'Task2', task2 };
  }

  const row = match.rows[0];

  try {
    const leitner = await leitnerReady();
    const insert = await query(
      leitner
        ? `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct,
                                  current_box, last_reviewed_at, next_review_at)
           VALUES ($1, $2, 'learning', 0, 0, 1, NOW(), NOW() + INTERVAL '1 day')
           ON CONFLICT (user_id, word_id) DO NOTHING
           RETURNING id`
        : `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
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

    const word = formatWord({ ...row, status: 'learning' });
    await attachIllustrations(word);
    await attachLinguisticDetails(word);

    // Bajo demanda: palabra global sin características (stub de un
    // sinónimo/antónimo o creada por POST / manual). Se enriquece con
    // Gemini best-effort sin romper el lookup si la IA falla.
    const needsEnrichment =
      (word.synonyms?.length ?? 0) === 0 &&
      (word.antonyms?.length ?? 0) === 0 &&
      (word.grammar_family?.length ?? 0) === 0 &&
      (word.examples?.length ?? 0) === 0;
    let enriched = false;
    if (needsEnrichment) {
      try {
        const result = await ensureWordDetails(row.id);
        enriched = result.enriched;
        if (enriched) {
          await attachIllustrations(word);
          await attachLinguisticDetails(word);
          console.log('[lookupWord] Stub enriquecido bajo demanda:', {
            userId: validUserId,
            wordId: row.id,
          });
        }
      } catch (error) {
        console.warn('[lookupWord] Enriquecimiento bajo demanda omitido:', {
          userId: validUserId,
          wordId: row.id,
          message: error?.message,
        });
      }
    }

    return {
      found: true,
      added,
      alreadyInList: !added,
      enriched,
      wordId: row.id,
      word,
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

/**
 * Detalle de una palabra del mazo con sus relaciones para la tarjeta:
 * grammar_family (+ grammar_category), synonyms, antonyms,
 * collocations, example + traducción e ilustraciones.
 * 404 si la palabra no está en el mazo del usuario.
 */
async function getWordById(userId, wordId) {
  const validWordId = await assertUserOwnsWord(userId, wordId);

  const result = await query(
    `SELECT ${await wordSelect()}
     ${USER_WORDS_JOIN}
     WHERE uw.user_id = $1 AND w.id = $2
     LIMIT 1`,
    [userId, validWordId]
  );

  if (result.rows.length === 0) {
    throw new AppError('La palabra no existe en tu mazo', 404);
  }

  const word = formatWord(result.rows[0]);
  await attachIllustrations(word);
  await attachLinguisticDetails(word);
  return word;
}

/**
 * Autocompletado para el formulario de Agregar: busca en `words` por
 * prefijo en inglés (insensible a mayúsculas) y marca cuáles ya están
 * en el mazo del usuario (`inDeck`). Solo lectura, limitado (def. 8).
 *
 * @param {string} userId UUID del usuario autenticado.
 * @param {string} rawTerm Prefijo tecleado (mín. 1 carácter no vacío).
 * @param {object} [options]
 * @param {number} [options.limit=8] Máx. 20.
 */
async function searchWords(userId, rawTerm, { limit = 8 } = {}) {
  const validUserId = validateUuid(userId, 'user id');
  if (!rawTerm || typeof rawTerm !== 'string' || !rawTerm.trim()) {
    return { suggestions: [] };
  }
  const term = rawTerm.trim().slice(0, 100);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);

  const result = await query(
    `SELECT w.id,
            w.english_word AS english,
            w.spanish_word AS spanish,
            (uw.word_id IS NOT NULL) AS "inDeck"
     FROM words w
     LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = $2
     WHERE w.english_word ILIKE $1 || '%'
     ORDER BY w.english_word ASC
     LIMIT $3`,
    [term, validUserId, safeLimit]
  );

  return { suggestions: result.rows };
}

module.exports = {
  getAllWords,
  createWord,
  updateWord,
  getRandomWord,
  getWordById,
  lookupAndSaveWord,
  searchWords,
  assertUserOwnsWord,
};
