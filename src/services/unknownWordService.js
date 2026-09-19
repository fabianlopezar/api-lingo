const { query, getPool } = require('../config/db');
const { formatWord } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');
const { handleDbError } = require('../utils/dbErrors');
const geminiService = require('./geminiService');
const illustrationService = require('./illustrationService');
const cloudinaryService = require('./cloudinaryService');

const WORD_COLUMNS =
  'id, english_word, spanish_word, pronunciation, category_id, created_at';

/**
 * Busca una palabra por su `english_word` (insensible a mayúsculas).
 * `queryFn` es `query` del pool o `client.query` dentro de una transacción.
 */
async function selectWordByEnglish(queryFn, englishWord) {
  const result = await queryFn(
    `SELECT ${WORD_COLUMNS}
     FROM words
     WHERE LOWER(english_word) = LOWER($1)
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [englishWord]
  );
  return result.rows[0] || null;
}

/**
 * Regla global: una palabra inglesa existe una sola vez. Devuelve la fila
 * existente o la crea con la traducción dada. Ante una carrera (otro
 * request la creó), re-lee en vez de fallar. Si la fila existente es un
 * stub con traducción vacía y ahora conocemos la traducción, la rellena.
 */
async function resolveOrCreateWord(queryFn, englishWord, spanishWord, pronunciation = null) {
  const existing = await selectWordByEnglish(queryFn, englishWord);
  if (existing) {
    if (!existing.spanish_word?.trim() && spanishWord?.trim()) {
      const updated = await queryFn(
        `UPDATE words SET spanish_word = $1 WHERE id = $2
         RETURNING ${WORD_COLUMNS}`,
        [spanishWord.trim(), existing.id]
      );
      return { row: updated.rows[0], created: false, backfilled: true };
    }
    return { row: existing, created: false };
  }

  try {
    const inserted = await queryFn(
      `INSERT INTO words (english_word, spanish_word, pronunciation)
       VALUES ($1, $2, $3)
       RETURNING ${WORD_COLUMNS}`,
      [englishWord, spanishWord, pronunciation]
    );
    return { row: inserted.rows[0], created: true };
  } catch (error) {
    if (error?.code === '23505') {
      const raced = await selectWordByEnglish(queryFn, englishWord);
      if (raced) return { row: raced, created: false };
    }
    throw error;
  }
}

/** Normaliza una lista de Gemini: trim, sin vacíos, sin repetidos ni auto-referencia. */
function normalizeTerms(list, selfEnglish) {
  const self = selfEnglish.trim().toLowerCase();
  const seen = new Set();
  const terms = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const term = item.trim();
    const key = term.toLowerCase();
    if (!term || key === self || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/** Carga los datos lingüísticos ya guardados (reintentos / palabra reutilizada). */
async function loadDetails(queryFn, wordId) {
  const familyRes = await queryFn(
    `SELECT gf.id, gf.nombre_familia, gc.id AS category_id, gc.nombre_categoria
     FROM grammar_family gf
     LEFT JOIN grammar_category gc ON gc.grammar_family_id = gf.id
     WHERE gf.word_id = $1
     ORDER BY gf.created_at ASC
     LIMIT 1`,
    [wordId]
  );
  const synRes = await queryFn(
    `SELECT w.id, w.english_word AS word
     FROM synonyms s INNER JOIN words w ON w.id = s.synonym_word_id
     WHERE s.word_id = $1`,
    [wordId]
  );
  const antRes = await queryFn(
    `SELECT w.id, w.english_word AS word
     FROM antonyms a INNER JOIN words w ON w.id = a.antonym_word_id
     WHERE a.word_id = $1`,
    [wordId]
  );
  const colRes = await queryFn('SELECT collocation FROM collocations WHERE word_id = $1', [wordId]);
  const exRes = await queryFn(
    `SELECT e.id, e.example_text, t.translation
     FROM example e LEFT JOIN example_translation t ON t.example_id = e.id
     WHERE e.word_id = $1
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [wordId]
  );
  const urlRes = await queryFn(
    `SELECT url FROM url_illustration
     WHERE word_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [wordId]
  );

  return {
    grammar_family: familyRes.rows[0]?.nombre_familia || null,
    grammar_category: familyRes.rows[0]?.nombre_categoria || null,
    synonyms: synRes.rows,
    antonyms: antRes.rows,
    collocations: colRes.rows.map((r) => r.collocation),
    example: exRes.rows[0]?.example_text || null,
    example_translation: exRes.rows[0]?.translation || null,
    illustrationUrl: urlRes.rows[0]?.url || null,
  };
}

/** Tiene la palabra ya características lingüísticas guardadas. */
function hasLinguisticDetails(details) {
  if (!details) return false;
  return Boolean(
    details.grammar_family ||
      (Array.isArray(details.synonyms) && details.synonyms.length > 0) ||
      (Array.isArray(details.collocations) && details.collocations.length > 0) ||
      details.example
  );
}

/**
 * Persiste los detalles de Gemini para una palabra ya existente.
 * `q` es `client.query` bindeado dentro de una transacción.
 * Reutiliza stubs de sinónimos/antónimos (solo con traducción) y
 * devuelve el objeto `details` listo para la respuesta.
 */
async function persistWordDetails(q, wordId, data, stubTranslations, illustrationUrl) {
  const familyRes = await q(
    `INSERT INTO grammar_family (word_id, nombre_familia)
     VALUES ($1, $2)
     RETURNING id, nombre_familia`,
    [wordId, data.grammar_family]
  );
  const categoryRes = await q(
    `INSERT INTO grammar_category (grammar_family_id, nombre_categoria)
     VALUES ($1, $2)
     RETURNING id, nombre_categoria`,
    [familyRes.rows[0].id, data.grammar_category]
  );

  const synonyms = normalizeTerms(data.synonyms, data.word);
  const antonyms = normalizeTerms(data.antonyms, data.word);

  const linkedSynonyms = [];
  for (const syn of synonyms) {
    const translation = stubTranslations[syn];
    if (!translation) {
      console.log('[Task2] Sinónimo sin traducción, se omite:', { wordId, syn });
      continue;
    }
    const stub = await resolveOrCreateWord(q, syn, translation);
    if (stub.row.id === wordId) continue;
    await q(
      `INSERT INTO synonyms (word_id, synonym_word_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [wordId, stub.row.id]
    );
    linkedSynonyms.push({ id: stub.row.id, word: stub.row.english_word });
  }

  const linkedAntonyms = [];
  for (const ant of antonyms) {
    const translation = stubTranslations[ant];
    if (!translation) {
      console.log('[Task2] Antónimo sin traducción, se omite:', { wordId, ant });
      continue;
    }
    const stub = await resolveOrCreateWord(q, ant, translation);
    if (stub.row.id === wordId) continue;
    await q(
      `INSERT INTO antonyms (word_id, antonym_word_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [wordId, stub.row.id]
    );
    linkedAntonyms.push({ id: stub.row.id, word: stub.row.english_word });
  }

  const collocations = normalizeTerms(data.collocations, data.word);
  for (const col of collocations) {
    await q('INSERT INTO collocations (word_id, collocation) VALUES ($1, $2)', [wordId, col]);
  }

  const exampleRes = await q(
    'INSERT INTO example (word_id, example_text) VALUES ($1, $2) RETURNING id, example_text',
    [wordId, data.example]
  );
  const exampleTransRes = await q(
    'INSERT INTO example_translation (example_id, translation) VALUES ($1, $2) RETURNING translation',
    [exampleRes.rows[0].id, data.example_translation]
  );

  let savedIllustrationUrl = null;
  if (illustrationUrl) {
    const urlRes = await q(
      'INSERT INTO url_illustration (word_id, url) VALUES ($1, $2) RETURNING url',
      [wordId, illustrationUrl]
    );
    savedIllustrationUrl = urlRes.rows[0].url;
  }

  return {
    grammar_family: familyRes.rows[0].nombre_familia,
    grammar_category: categoryRes.rows[0].nombre_categoria,
    synonyms: linkedSynonyms,
    antonyms: linkedAntonyms,
    collocations,
    example: exampleRes.rows[0].example_text,
    example_translation: exampleTransRes.rows[0].translation,
    illustrationUrl: savedIllustrationUrl,
  };
}

/**
 * Backfill / bajo demanda: si la palabra (`words.id`) no tiene
 * características (familia, sinónimos, colocaciones o ejemplo),
 * las genera con Gemini y las persiste. Idempotente: si ya tiene
 * detalles, no llama a Gemini y devuelve `enriched: false`.
 *
 * Pensado para:
 * - stubs de sinónimos/antónimos creados pelados por `resolveOrCreateWord`,
 * - palabras creadas por `POST /api/words` (sin Task 2),
 * - script `scripts/backfill-word-details.js`.
 *
 * @param {string} wordId UUID de `words`.
 * @param {object} [options]
 * @param {boolean} [options.skipIllustration=false] Omite Tarea 3 (útil en backfill masivo).
 * @returns {Promise<{ enriched: boolean, word: object, details: object }>}
 */
async function ensureWordDetails(wordId, { skipIllustration = false } = {}) {
  const validWordId = validateUuid(wordId, 'word id');

  const current = await query(`SELECT ${WORD_COLUMNS} FROM words WHERE id = $1 LIMIT 1`, [
    validWordId,
  ]);
  if (current.rows.length === 0) {
    const AppErrorLocal = require('../utils/AppError');
    throw new AppErrorLocal('La palabra no existe', 404);
  }
  const wordRow = current.rows[0];

  const existing = await loadDetails(query, validWordId);
  if (hasLinguisticDetails(existing)) {
    return { enriched: false, word: wordRow, details: existing };
  }

  const data = await geminiService.getWordData(wordRow.english_word);

  const synonyms = normalizeTerms(data.synonyms, data.word);
  const antonyms = normalizeTerms(data.antonyms, data.word);
  const stubTerms = [...new Set([...synonyms, ...antonyms])];
  const stubTranslations =
    stubTerms.length > 0 ? await geminiService.translateWords(stubTerms) : {};

  let illustrationUrl = null;
  if (!skipIllustration) {
    if (cloudinaryService.isCloudinaryConfigured()) {
      try {
        const { buffer, provider } = await illustrationService.generateIllustration(
          data.example,
          { word: data.word, translation: data.translation }
        );
        illustrationUrl = await cloudinaryService.uploadIllustration(
          buffer,
          buildIllustrationPublicId(data.word)
        );
        console.log('[ensureWordDetails] Ilustración lista:', {
          wordId: validWordId,
          provider,
        });
      } catch (error) {
        console.warn('[ensureWordDetails] Ilustración omitida (best-effort):', {
          wordId: validWordId,
          message: error?.message,
        });
      }
    }
  }

  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = client.query.bind(client);

    // Re-chequeo dentro de la transacción (carrera con otro backfill).
    const details = await loadDetails(q, validWordId);
    if (hasLinguisticDetails(details)) {
      await client.query('COMMIT');
      return { enriched: false, word: wordRow, details };
    }

    const fresh = await persistWordDetails(q, validWordId, data, stubTranslations, illustrationUrl);
    await client.query('COMMIT');
    console.log('[ensureWordDetails] Palabra enriquecida:', {
      wordId: validWordId,
      english: wordRow.english_word,
    });
    return { enriched: true, word: wordRow, details: fresh };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** public_id único y seguro para Cloudinary a partir de la palabra. */
function buildIllustrationPublicId(englishWord) {
  const slug = englishWord
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'word'}-${Date.now()}`;
}

/**
 * Task 2 — Pipeline completo para palabras NO encontradas en `words`:
 *
 * 1. Re-chequea `words` (carrera: otro request pudo crearla mientras tanto).
 * 2. Pide los 10 campos a Gemini (`geminiService.getWordData`).
 * 3. Tarea 3 (best-effort, fuera de la transacción): genera una imagen
 *    ilustrativa del ejemplo con Gemini (`generateIllustration`), la sube a
 *    Cloudinary y guarda la URL en `url_illustration`. Si falla o
 *    Cloudinary no está configurado, se omite SIN romper el pipeline.
 * 4. En UNA transacción: resuelve/crea la palabra, inserta familia y
 *    categoría gramatical, resuelve/crea stubs de sinónimos y antónimos
 *    (siempre con traducción; sin traducción se omiten) y los enlaza,
 *    inserta colocaciones, ejemplo + traducción, URL de ilustración y
 *    enlaza la palabra al mazo (`user_words`, idempotente) del usuario.
 * 5. Devuelve `{ found: true, created, added, wordId, word, details }`
 *    (`details.illustrationUrl` con la URL o `null`) para que el
 *    controller responda 201.
 *
 * Si Gemini falla (502/503), el error propaga y NO se guarda nada.
 */
async function handleUnknownWord(userId, term) {
  const validUserId = validateUuid(userId, 'user id');
  const cleanTerm = validateRequiredString(term, 'word');

  let raced;
  try {
    raced = await selectWordByEnglish(query, cleanTerm);
  } catch (error) {
    handleDbError(error, { op: 'task2.recheck', userId: validUserId, term: cleanTerm });
  }

  if (raced) {
    console.log('[Task2] Race: la palabra ya existe, solo se enlaza:', {
      userId: validUserId,
      term: cleanTerm,
      wordId: raced.id,
    });
    let link;
    try {
      link = await query(
        `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
         VALUES ($1, $2, 'learning', 0, 0)
         ON CONFLICT (user_id, word_id) DO NOTHING
         RETURNING id`,
        [validUserId, raced.id]
      );
    } catch (error) {
      handleDbError(error, { op: 'task2.link', userId: validUserId, wordId: raced.id });
    }
    const added = link.rows.length > 0;

    // Bajo demanda: si la palabra existente es un stub (sin familia,
    // sinónimos, colocaciones ni ejemplo), se enriquece con Gemini.
    // Best-effort: si Gemini falla, se devuelve la palabra enlazada
    // sin romper el flujo.
    try {
      const { enriched, details } = await ensureWordDetails(raced.id);
      if (enriched) {
        console.log('[Task2] Stub enriquecido bajo demanda:', {
          userId: validUserId,
          wordId: raced.id,
        });
      }
      return {
        found: true,
        created: false,
        added,
        alreadyInList: !added,
        enriched,
        wordId: raced.id,
        word: formatWord(raced),
        details,
      };
    } catch (error) {
      console.warn('[Task2] Enriquecimiento bajo demanda omitido:', {
        userId: validUserId,
        wordId: raced.id,
        message: error?.message,
      });
      return {
        found: true,
        created: false,
        added,
        alreadyInList: !added,
        wordId: raced.id,
        word: formatWord(raced),
      };
    }
  }

  console.log('[Task2] Miss confirmado, consultando Gemini:', {
    userId: validUserId,
    term: cleanTerm,
  });
  const data = await geminiService.getWordData(cleanTerm);

  const synonyms = normalizeTerms(data.synonyms, data.word);
  const antonyms = normalizeTerms(data.antonyms, data.word);
  const collocations = normalizeTerms(data.collocations, data.word);

  // Los stubs nunca quedan con traducción vacía: una sola petición en lote
  // traduce todos los sinónimos+antónimos. Sin traducción → se omite.
  const stubTerms = [...new Set([...synonyms, ...antonyms])];
  const stubTranslations =
    stubTerms.length > 0 ? await geminiService.translateWords(stubTerms) : {};

  // Tarea 3 — Ilustración best-effort ANTES de la transacción (no se retiene
  // conexión del pool durante las llamadas externas). Un fallo aquí solo
  // deja `illustrationUrl` en null, nunca rompe la creación de la palabra.
  let illustrationUrl = null;
  if (!cloudinaryService.isCloudinaryConfigured()) {
    console.log('[Task2] Cloudinary sin configurar, se omite la ilustración:', {
      userId: validUserId,
      term: cleanTerm,
    });
  } else {
    try {
      const { buffer, provider } = await illustrationService.generateIllustration(data.example, {
        word: data.word,
        translation: data.translation,
      });
      illustrationUrl = await cloudinaryService.uploadIllustration(
        buffer,
        buildIllustrationPublicId(data.word)
      );
      console.log('[Task2] Ilustración lista:', { term: cleanTerm, provider });
    } catch (error) {
      console.warn('[Task2] Ilustración omitida (best-effort):', {
        userId: validUserId,
        term: cleanTerm,
        message: error?.message,
      });
    }
  }

  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const q = client.query.bind(client);

    const { row: wordRow, created } = await resolveOrCreateWord(
      q,
      data.word,
      data.translation,
      data.pronunciation
    );

    let details = await loadDetails(q, wordRow.id);

    if (!hasLinguisticDetails(details)) {
      details = await persistWordDetails(q, wordRow.id, data, stubTranslations, illustrationUrl);
    }

    const link = await q(
      `INSERT INTO user_words (user_id, word_id, status, times_seen, times_correct)
       VALUES ($1, $2, 'learning', 0, 0)
       ON CONFLICT (user_id, word_id) DO NOTHING
       RETURNING id`,
      [validUserId, wordRow.id]
    );

    await client.query('COMMIT');

    const added = link.rows.length > 0;
    console.log('[Task2] Palabra creada y enlazada:', {
      userId: validUserId,
      term: cleanTerm,
      wordId: wordRow.id,
      created,
      added,
    });

    return {
      found: true,
      created,
      added,
      alreadyInList: !added,
      wordId: wordRow.id,
      word: formatWord(wordRow),
      details: { translation: wordRow.spanish_word, pronunciation: wordRow.pronunciation, ...details },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    handleDbError(error, { op: 'task2.persist', userId: validUserId, term: cleanTerm });
  } finally {
    client.release();
  }
}

module.exports = {
  handleUnknownWord,
  ensureWordDetails,
  loadDetails,
  hasLinguisticDetails,
};
