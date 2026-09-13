/**
 * LeitnerService — repetición espaciada (Cajas de Leitner).
 *
 * Adaptación al stack del proyecto: el progreso NO vive en `words`
 * (tabla global compartida) sino en `user_words` (una fila por
 * usuario ↔ palabra). Requiere la migración
 * `database/migrations/004_leitner.sql` aplicada en Supabase.
 *
 * Cajas e intervalos:
 *   Caja 1 → 1 día | Caja 2 → 3 días | Caja 3 → 7 días
 *   Caja 4 → 14 días | Caja 5 → 30 días (dominada)
 *
 * Reglas:
 *   - Acierto (cajas 1-4): avanza una caja, recalcula next_review_at.
 *   - Acierto (caja 5): permanece en 5, recalcula a 30 días.
 *   - Fallo: regresa a Caja 1, next_review_at = ahora + 1 día.
 */
const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { leitnerReady } = require('../utils/leitnerSupport');
const { formatWord, attachIllustrations, attachLinguisticDetails } = require('../utils/mappers');
const { validateUuid } = require('../utils/validators');

/** Días de espera por caja. Índice 1-5. */
const BOX_INTERVALS_DAYS = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });

const MIN_BOX = 1;
const MAX_BOX = 5;

/** Lanza 500 con instrucciones si la migración 004 aún no fue aplicada. */
async function assertLeitnerReady() {
  if (await leitnerReady()) return;
  throw new AppError(
    'Repaso no disponible: falta aplicar database/migrations/004_leitner.sql ' +
      'en Supabase (Dashboard → SQL Editor → Run).',
    500
  );
}

function validateBox(box) {
  const n = Number(box);
  if (!Number.isInteger(n) || n < MIN_BOX || n > MAX_BOX) {
    throw new AppError('current_box debe ser un entero entre 1 y 5', 400);
  }
  return n;
}

/**
 * Lógica pura (testeable sin BD): calcula la caja destino.
 * @param {number} currentBox Caja actual (1-5).
 * @param {boolean} isCorrect ¿El usuario acertó?
 * @returns {number} Caja destino.
 */
function computeNextBox(currentBox, isCorrect) {
  const box = validateBox(currentBox);
  if (isCorrect === true) return Math.min(box + 1, MAX_BOX);
  if (isCorrect === false) return MIN_BOX;
  throw new AppError('isCorrect debe ser booleano', 400);
}

/**
 * Lógica pura: calcula next_review_at sumando los días de la caja destino.
 * @param {number} box Caja destino (1-5).
 * @param {Date} [fromDate=new Date()] Fecha base (por defecto ahora).
 * @returns {Date} Fecha del próximo repaso.
 */
function computeNextReviewDate(box, fromDate = new Date()) {
  const validBox = validateBox(box);
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(base.getTime())) throw new AppError('Fecha base inválida', 400);
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + BOX_INTERVALS_DAYS[validBox]);
  return next;
}

/**
 * Aplica el resultado de un repaso y persiste en `user_words`.
 *
 * Firma adaptada al proyecto: se recibe `userId` (de `req.user.id`)
 * para garantizar propiedad del mazo. `wordId` es `words.id`.
 *
 * @param {string} userId UUID del usuario autenticado.
 * @param {string} wordId UUID de la palabra (`words.id`).
 * @param {boolean} isCorrect ¿El usuario acertó?
 * @returns {Promise<object>} Registro actualizado en camelCase.
 */
async function evaluateReviewResponse(userId, wordId, isCorrect) {
  await assertLeitnerReady();
  const validUserId = validateUuid(userId, 'user id');
  const validWordId = validateUuid(wordId, 'word id');
  if (typeof isCorrect !== 'boolean') {
    throw new AppError('isCorrect es requerido y debe ser booleano', 400);
  }

  const existing = await query(
    `SELECT id, user_id, word_id, status, times_seen, times_correct,
            current_box, last_reviewed_at, next_review_at
     FROM user_words
     WHERE user_id = $1 AND word_id = $2`,
    [validUserId, validWordId]
  );

  if (existing.rows.length === 0) {
    throw new AppError('La palabra no está en tu mazo', 404);
  }

  const row = existing.rows[0];
  // Fila anterior a la migración: current_box puede venir null.
  const previousBox = row.current_box ?? MIN_BOX;
  const nextBox = computeNextBox(previousBox, isCorrect);
  const now = new Date();
  const nextReviewAt = computeNextReviewDate(nextBox, now);

  const updated = await query(
    `UPDATE user_words
     SET current_box = $1,
         last_reviewed_at = NOW(),
         next_review_at = $2,
         times_seen = COALESCE(times_seen, 0) + 1,
         times_correct = COALESCE(times_correct, 0) + $3
     WHERE id = $4
     RETURNING id, user_id, word_id, status, times_seen, times_correct,
               current_box, last_reviewed_at, next_review_at`,
    [nextBox, nextReviewAt.toISOString(), isCorrect ? 1 : 0, row.id]
  );

  const r = updated.rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    wordId: r.word_id,
    status: r.status,
    timesSeen: r.times_seen,
    timesCorrect: r.times_correct,
    previousBox,
    currentBox: r.current_box,
    lastReviewedAt: r.last_reviewed_at,
    nextReviewAt: r.next_review_at,
    isCorrect,
    intervalDays: BOX_INTERVALS_DAYS[r.current_box],
  };
}

/**
 * Devuelve las palabras vencidas del usuario:
 * `next_review_at <= NOW()` (solo estado `learning`).
 *
 * @param {string} userId UUID del usuario.
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 */
async function getWordsDueForReview(userId, { limit = 50, offset = 0 } = {}) {
  await assertLeitnerReady();
  const validUserId = validateUuid(userId, 'user id');
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const result = await query(
    `SELECT w.id, w.english_word, w.spanish_word, w.pronunciation,
            w.created_at, w.category_id,
            c.nombre_categoria, c.calificacion_categoria,
            uw.status, uw.current_box, uw.last_reviewed_at, uw.next_review_at,
            uw.times_seen, uw.times_correct
     FROM user_words uw
     INNER JOIN words w ON w.id = uw.word_id
     LEFT JOIN categories c ON c.id = w.category_id
     WHERE uw.user_id = $1
       AND uw.status = 'learning'
       AND uw.next_review_at <= NOW()
     ORDER BY uw.next_review_at ASC
     LIMIT $2 OFFSET $3`,
    [validUserId, safeLimit, safeOffset]
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM user_words
     WHERE user_id = $1 AND status = 'learning' AND next_review_at <= NOW()`,
    [validUserId]
  );

  const words = result.rows.map((row) => {
    const word = formatWord(row);
    word.currentBox = row.current_box ?? MIN_BOX;
    word.lastReviewedAt = row.last_reviewed_at;
    word.nextReviewAt = row.next_review_at;
    word.timesSeen = row.times_seen;
    word.timesCorrect = row.times_correct;
    return word;
  });
  await attachIllustrations(words);
  await attachLinguisticDetails(words);

  return {
    words,
    total: countResult.rows[0].total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Resumen del mazo para la UI de repaso: conteo por caja + vencidas.
 */
async function getReviewStats(userId) {
  await assertLeitnerReady();
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE next_review_at <= NOW() AND status = 'learning')::int AS due,
       COUNT(*) FILTER (WHERE current_box = 1)::int AS box1,
       COUNT(*) FILTER (WHERE current_box = 2)::int AS box2,
       COUNT(*) FILTER (WHERE current_box = 3)::int AS box3,
       COUNT(*) FILTER (WHERE current_box = 4)::int AS box4,
       COUNT(*) FILTER (WHERE current_box = 5)::int AS box5
     FROM user_words
     WHERE user_id = $1`,
    [validUserId]
  );

  return { intervals: { ...BOX_INTERVALS_DAYS }, ...result.rows[0] };
}

module.exports = {
  BOX_INTERVALS_DAYS,
  MIN_BOX,
  MAX_BOX,
  computeNextBox,
  computeNextReviewDate,
  evaluateReviewResponse,
  getWordsDueForReview,
  getReviewStats,
};
