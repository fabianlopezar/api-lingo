/** Mapea fila de BD al formato de la API */
const { query } = require('../config/db');

function formatWord(row) {
  if (!row) return null;

  const word = {
    id: row.id,
    word: row.english_word,
    translation: row.spanish_word,
    englishWord: row.english_word,
    spanishWord: row.spanish_word,
    pronunciation: row.pronunciation,
    createdAt: row.created_at,
    categoryId: row.category_id ?? null,
  };

  if (row.category_id && row.nombre_categoria) {
    word.category = {
      id: row.category_id,
      name: row.nombre_categoria,
      rating: row.calificacion_categoria ?? 0,
    };
  }

  // Progreso Leitner (solo presente cuando el SELECT incluye user_words).
  if (row.current_box !== undefined && row.current_box !== null) {
    word.currentBox = row.current_box;
  }
  if (row.last_reviewed_at !== undefined) {
    word.lastReviewedAt = row.last_reviewed_at;
  }
  if (row.next_review_at !== undefined) {
    word.nextReviewAt = row.next_review_at;
  }
  if (row.times_seen !== undefined) word.timesSeen = row.times_seen;
  if (row.times_correct !== undefined) word.timesCorrect = row.times_correct;

  return word;
}

function formatCategory(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.nombre_categoria,
    nombreCategoria: row.nombre_categoria,
    rating: row.calificacion_categoria ?? 0,
    calificacionCategoria: row.calificacion_categoria ?? 0,
    createdAt: row.created_at,
    wordCount: row.word_count ?? row.wordCount ?? 0,
  };
}

function formatUser(user) {
  return {
    id: user.id,
    email: user.email,
    isDemo: user.is_demo,
    createdAt: user.created_at,
  };
}

/**
 * Adjunta las ilustraciones de `url_illustration` a una palabra (o lista)
 * ya formateada con `formatWord`. Agrega `illustrations: [url, ...]`.
 * Si la palabra no tiene imagen, deja `illustrations: []`.
 * Nunca rompe la respuesta: si la tabla no existe o la consulta falla,
 * devuelve las palabras sin ilustraciones.
 */
async function attachIllustrations(words) {
  const list = Array.isArray(words) ? words : [words];
  const ids = [...new Set(list.map((w) => w && w.id).filter(Boolean))];
  if (ids.length === 0) return words;

  let rows = [];
  try {
    const result = await query(
      'SELECT word_id, url FROM url_illustration WHERE word_id = ANY($1::uuid[])',
      [ids]
    );
    rows = result.rows;
  } catch (error) {
    console.warn('[mappers] No se pudieron cargar ilustraciones:', error?.message);
    for (const w of list) {
      if (w && !Array.isArray(w.illustrations)) w.illustrations = [];
    }
    return words;
  }

  const byWordId = new Map();
  for (const row of rows) {
    if (!row.url) continue;
    if (!byWordId.has(row.word_id)) byWordId.set(row.word_id, []);
    byWordId.get(row.word_id).push(row.url);
  }

  for (const w of list) {
    if (w) w.illustrations = byWordId.get(w.id) ?? [];
  }

  return words;
}

/**
 * Adjunta los atributos lingüísticos de la tarjeta a cada palabra:
 * `grammar_family` (+ alias `grammarFamily`), `synonyms`, `antonyms`,
 * `collocations`, `examples` (+ alias `example`).
 *
 * Formas compatibles con el frontend (`lexi-flip/src/integrations/lingo/types.ts`):
 * - grammar_family: [{ nombre_familia, grammar_category: [{ nombre_categoria }] }]
 * - synonyms/antonyms/collocations: string[]
 * - examples: [{ example_text, translation }]
 *
 * Nunca rompe la respuesta: si una tabla no existe o la consulta falla,
 * deja las listas vacías.
 */
async function attachLinguisticDetails(words) {
  const list = Array.isArray(words) ? words : [words];
  const ids = [...new Set(list.map((w) => w && w.id).filter(Boolean))];
  if (ids.length === 0) return words;

  const wordById = new Map();
  for (const w of list) {
    if (w && w.id) wordById.set(w.id, w);
  }

  try {
    const [famRows, synRows, antRows, colRows, exRows] = await Promise.all([
      query(
        `SELECT gf.id, gf.word_id, gf.nombre_familia,
                gc.id AS category_id, gc.nombre_categoria
         FROM grammar_family gf
         LEFT JOIN grammar_category gc ON gc.grammar_family_id = gf.id
         WHERE gf.word_id = ANY($1::uuid[])
         ORDER BY gf.created_at ASC, gc.created_at ASC`,
        [ids]
      ).then((r) => r.rows).catch(() => null),
      query(
        `SELECT s.word_id, w.english_word AS word
         FROM synonyms s INNER JOIN words w ON w.id = s.synonym_word_id
         WHERE s.word_id = ANY($1::uuid[])`,
        [ids]
      ).then((r) => r.rows).catch(() => null),
      query(
        `SELECT a.word_id, w.english_word AS word
         FROM antonyms a INNER JOIN words w ON w.id = a.antonym_word_id
         WHERE a.word_id = ANY($1::uuid[])`,
        [ids]
      ).then((r) => r.rows).catch(() => null),
      query(`SELECT word_id, collocation FROM collocations WHERE word_id = ANY($1::uuid[])`, [
        ids,
      ]).then((r) => r.rows).catch(() => null),
      query(
        `SELECT e.word_id, e.example_text, t.translation
         FROM example e LEFT JOIN example_translation t ON t.example_id = e.id
         WHERE e.word_id = ANY($1::uuid[])
         ORDER BY e.created_at ASC`,
        [ids]
      ).then((r) => r.rows).catch(() => null),
    ]);

    // --- Gramática: agrupar categorías por familia ---
    const familiesByWord = new Map(ids.map((id) => [id, new Map()]));
    if (Array.isArray(famRows)) {
      for (const r of famRows) {
        if (!r || !r.word_id || !r.nombre_familia) continue;
        const famMap = familiesByWord.get(r.word_id);
        if (!famMap.has(r.id)) {
          famMap.set(r.id, {
            id: r.id,
            nombre_familia: r.nombre_familia,
            nombreFamilia: r.nombre_familia,
            name: r.nombre_familia,
            grammar_category: [],
          });
        }
        if (r.nombre_categoria) {
          const cat = {
            nombre_categoria: r.nombre_categoria,
            nombreCategoria: r.nombre_categoria,
            name: r.nombre_categoria,
          };
          if (typeof r.category_id === 'string') cat.id = r.category_id;
          familiesByWord.get(r.word_id).get(r.id).grammar_category.push(cat);
        }
      }
    }

    const synonymsByWord = new Map(ids.map((id) => [id, []]));
    if (Array.isArray(synRows)) {
      for (const r of synRows) {
        if (r?.word) synonymsByWord.get(r.word_id)?.push(r.word);
      }
    }

    const antonymsByWord = new Map(ids.map((id) => [id, []]));
    if (Array.isArray(antRows)) {
      for (const r of antRows) {
        if (r?.word) antonymsByWord.get(r.word_id)?.push(r.word);
      }
    }

    const collocationsByWord = new Map(ids.map((id) => [id, []]));
    if (Array.isArray(colRows)) {
      for (const r of colRows) {
        if (r?.collocation) collocationsByWord.get(r.word_id)?.push(r.collocation);
      }
    }

    const examplesByWord = new Map(ids.map((id) => [id, []]));
    if (Array.isArray(exRows)) {
      const seen = new Set();
      for (const r of exRows) {
        if (!r?.example_text) continue;
        const key = `${r.word_id}::${r.example_text}::${r.translation ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ex = {
          example_text: r.example_text,
          exampleText: r.example_text,
          text: r.example_text,
        };
        // `translation: null` rompería el schema zod del frontend
        // (espera string opcional), así que solo se envía si hay texto.
        if (typeof r.translation === 'string' && r.translation.trim()) {
          ex.translation = r.translation;
        }
        examplesByWord.get(r.word_id)?.push(ex);
      }
    }

    for (const id of ids) {
      const w = wordById.get(id);
      if (!w) continue;
      const families = [...(familiesByWord.get(id)?.values() ?? [])];
      w.grammar_family = families;
      w.grammarFamily = families;
      w.grammar_families = families;
      w.grammarFamilies = families;
      w.synonyms = [...new Set(synonymsByWord.get(id) ?? [])];
      w.antonyms = [...new Set(antonymsByWord.get(id) ?? [])];
      w.collocations = [...new Set(collocationsByWord.get(id) ?? [])];
      w.examples = examplesByWord.get(id) ?? [];
      w.example = w.examples;
    }
  } catch (error) {
    console.warn('[mappers] No se pudieron cargar detalles lingüísticos:', error?.message);
    for (const w of list) {
      if (!w) continue;
      w.grammar_family ??= [];
      w.grammarFamily ??= w.grammar_family;
      w.synonyms ??= [];
      w.antonyms ??= [];
      w.collocations ??= [];
      w.examples ??= [];
      w.example ??= w.examples;
    }
  }

  return words;
}

module.exports = { formatWord, formatUser, formatCategory, attachIllustrations, attachLinguisticDetails };
