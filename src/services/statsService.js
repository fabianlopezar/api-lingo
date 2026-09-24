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

/** Días consecutivos con registro, contando desde hoy (o ayer si hoy aún no hay). */
function computeStreak(dateStringsDesc) {
  if (!Array.isArray(dateStringsDesc) || dateStringsDesc.length === 0) return 0;
  const days = new Set(dateStringsDesc.map((d) => String(d).slice(0, 10)));
  const cursor = new Date();
  const todayStr = cursor.toISOString().slice(0, 10);
  if (!days.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 3650) break;
  }
  return streak;
}

/** Racha persistida; sin migración 007 se degrada al cómputo desde stats. */
async function getStreakDays(userId) {
  try {
    const res = await query('SELECT current_streak FROM users WHERE id = $1', [userId]);
    if (res.rows[0] && res.rows[0].current_streak !== undefined) {
      return res.rows[0].current_streak ?? 0;
    }
  } catch {
    // columna inexistente: degradar al cómputo desde stats
  }
  const hist = await query(
    'SELECT date FROM stats WHERE user_id = $1 ORDER BY date DESC LIMIT 60',
    [userId]
  );
  return computeStreak(hist.rows.map((r) => toDateStr(r.date)));
}

async function getUserStats(userId) {
  const learnedResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM user_words
     WHERE user_id = $1 AND status = 'learned'`,
    [userId]
  );

  const statsResult = await query(
    `SELECT
       COALESCE(SUM(words_learned), 0)::int AS total_words_learned,
       COUNT(*)::int AS study_days,
       MAX(date) AS last_study_date
     FROM stats
     WHERE user_id = $1`,
    [userId]
  );

  const todayResult = await query(
    `SELECT words_learned
     FROM stats
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );

  const agg = statsResult.rows[0];
  const today = todayResult.rows[0];
  const streak = await getStreakDays(userId);

  return {
    userId,
    totalLearned: learnedResult.rows[0].total,
    totalWordsLearnedInStats: agg.total_words_learned,
    studyDays: agg.study_days,
    lastStudyDate: toDateStr(agg.last_study_date),
    streakDays: streak,
    today: {
      wordsLearned: today?.words_learned || 0,
    },
  };
}

module.exports = {
  getUserStats,
  registerStudyActivity,
};
