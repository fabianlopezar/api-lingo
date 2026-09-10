const { validateRequiredString, validateUuid } = require('../utils/validators');

/**
 * Task 2 — Secondary function: handles words NOT found in the `words` table.
 *
 * Task 1 (lookupAndSaveWord) calls this hook on a miss and never inserts
 * new words itself. The full word creation/insertion pipeline (e.g. external
 * dictionary fetch + INSERT INTO words + INSERT INTO user_words) belongs
 * here.
 *
 * Contract: must NOT throw for a plain miss — return a handoff descriptor
 * so the caller can respond 404 with a structured
 * `{ found: false, delegatedTo: 'Task2' }` signal. (Throwing AppError(404)
 * is also tolerated: the lookup service lets it propagate.)
 *
 * Replace the body with the real creation pipeline when Task 2 is
 * implemented — the lookup service invokes this via dependency injection
 * (`options.onNotFound`) and needs no changes.
 */
async function handleUnknownWord(userId, term) {
  const validUserId = validateUuid(userId, 'user id');
  const cleanTerm = validateRequiredString(term, 'word');

  console.log('[Task2] Word not found, delegating creation pipeline:', {
    userId: validUserId,
    term: cleanTerm,
  });

  return {
    delegated: true,
    delegatedTo: 'Task2',
    userId: validUserId,
    term: cleanTerm,
    message: `La palabra "${cleanTerm}" no existe en la base de datos. Se delega a Task 2 para su creación.`,
  };
}

module.exports = {
  handleUnknownWord,
};
