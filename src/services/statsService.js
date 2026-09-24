const { query } = require('../config/db');

function toDateStr(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value) return String(value).slice(0, 10);
  return null;
}

/**
 * Registra un día de actividad de estudio y actualiza la racha
 * (`users.current_streak`): hoy ya contó → no cambia; ayer → +1;
 * otro día → reinicia en 1. Best-effort: si la migración 007 aún no
 * fue aplicada, se omite sin romper el repaso.
 */
async function registerStudyActivity(userId) {
  let row;
  try {
    const res = await query(
      'SELECT current_streak, last_active_date FROM users WHERE id = $1',
      [userId]
    );
    row = res.rows[0];
    if (!row) return;
  } catch (error) {
    console.warn('[streak] Migración 007 pendiente, actividad no registrada:', error?.message);
    return;
  }

  const todayStr = toDateStr(new Date());
  const last = toDateStr(row.last_active_date);
  if (last === todayStr) return;

  const yesterdayStr = toDateStr(new Date(Date.now() - 86400000));
  const next = last === yesterdayStr ? (row.current_streak ?? 0) + 1 : 1;

  await query(
    'UPDATE users SET current_streak = $1, last_active_date = $2 WHERE id = $3',
    [next, todayStr, userId]
  );
}

/** Racha persistida; si la migración 007 falta, usa el cómputo anterior. */
async function getStreakDays(userId, fallbackDatesDesc) {
  try {
    const res = await query('SELECT current_streak FROM users WHERE id = $1', [userId]);
    if (res.rows[0] && res.rows[0].current_streak !== undefined) {
      return res.rows[0].current_streak ?? 0;
    }
  } catch {
    // columna inexistente: degradar al cómputo desde stats
  }
  return computeStreak(fallbackDatesDesc);
}

async function getUserStats(userId) {
  const [learnedResult, statsResult, todayResult, historyResult, deckResult, accuracyResult, dueResult] =
    await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total
         FROM user_words
         WHERE user_id = $1 AND status = 'learned'`,
        [userId]
      ),
      query(
        `SELECT
           COALESCE(SUM(words_learned), 0)::int AS total_words_learned,
           COUNT(*)::int AS study_days,
           MAX(date) AS last_study_date,
           COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '6 days' THEN words_learned ELSE 0 END), 0)::int AS last_7_days
         FROM stats
         WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT words_learned
         FROM stats
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      ),
      query(
        `SELECT date, words_learned
         FROM stats
         WHERE user_id = $1
         ORDER BY date DESC
         LIMIT 14`,
        [userId]
      ),
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'learning')::int AS learning,
           COUNT(*) FILTER (WHERE status = 'learned')::int AS learned
         FROM user_words
         WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT
           COALESCE(SUM(times_seen), 0)::int AS seen,
           COALESCE(SUM(times_correct), 0)::int AS correct
         FROM user_words
         WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM user_words
         WHERE user_id = $1 AND status = 'learning' AND next_review_at <= NOW()`,
        [userId]
      ),
    ]);

  const agg = statsResult.rows[0];
  const today = todayResult.rows[0];
  const deck = deckResult.rows[0];
  const acc = accuracyResult.rows[0];

  // Historial ascendente (más antiguo → hoy) para graficar.
  const history = historyResult.rows
    .map((r) => ({
      // `date` llega como Date o string según el driver; normalizamos a YYYY-MM-DD.
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      wordsLearned: r.words_learned ?? 0,
    }))
    .reverse();

  // Racha persistida (cualquier estudio cuenta); sin migración 007
  // se degrada al cómputo anterior desde stats.
  const streak = await getStreakDays(
    userId,
    historyResult.rows.map((r) => toDateStr(r.date))
  );

  const seen = acc.seen ?? 0;
  const correct = acc.correct ?? 0;

  return {
    userId,
    // --- Compatibilidad con el frontend actual (no romper) ---
    totalLearned: learnedResult.rows[0].total,
    totalWordsLearnedInStats: agg.total_words_learned,
    studyDays: agg.study_days,
    lastStudyDate: agg.last_study_date,
    today: {
      wordsLearned: today?.words_learned || 0,
    },
    // --- Nuevos campos útiles para la UI ---
    streakDays: streak,
    last7DaysWords: agg.last_7_days ?? 0,
    history,
    deck: {
      total: deck.total ?? 0,
      learning: deck.learning ?? 0,
      learned: deck.learned ?? 0,
    },
    accuracy: {
      seen,
      correct,
      rate: seen > 0 ? Math.round((correct / seen) * 1000) / 10 : null,
    },
    dueReviews: dueResult.rows[0].total ?? 0,
  };
}

/** Días consecutivos con registro, contando desde hoy (o ayer si hoy aún no hay). */
function computeStreak(dateStringsDesc) {
  if (!Array.isArray(dateStringsDesc) || dateStringsDesc.length === 0) return 0;
  const days = new Set(dateStringsDesc.map((d) => String(d).slice(0, 10)));
  const cursor = new Date();
  const todayStr = cursor.toISOString().slice(0, 10);
  // Si hoy no hay actividad, la racha puede seguir viva desde ayer.
  if (!days.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 3650) break; // seguridad
  }
  return streak;
}

module.exports = {
  getUserStats,
  registerStudyActivity,
};
