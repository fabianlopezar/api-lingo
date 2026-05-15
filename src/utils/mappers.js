/** Mapea fila de BD al formato de la API */
function formatWord(row) {
  if (!row) return null;

  return {
    id: row.id,
    word: row.english_word,
    translation: row.spanish_word,
    englishWord: row.english_word,
    spanishWord: row.spanish_word,
    pronunciation: row.pronunciation,
    createdAt: row.created_at,
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

module.exports = { formatWord, formatUser };
