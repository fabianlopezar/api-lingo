/** Mapea fila de BD al formato de la API */
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

module.exports = { formatWord, formatUser, formatCategory };
