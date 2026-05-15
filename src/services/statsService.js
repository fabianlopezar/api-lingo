const { query } = require('../config/db');

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
       COALESCE(SUM(study_time), 0)::int AS total_study_time,
       COUNT(*)::int AS study_days,
       MAX(date) AS last_study_date
     FROM stats
     WHERE user_id = $1`,
    [userId]
  );

  const todayResult = await query(
    `SELECT words_learned, study_time
     FROM stats
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );

  const agg = statsResult.rows[0];
  const today = todayResult.rows[0];

  return {
    userId,
    totalLearned: learnedResult.rows[0].total,
    totalWordsLearnedInStats: agg.total_words_learned,
    totalStudyTimeMinutes: agg.total_study_time,
    studyDays: agg.study_days,
    lastStudyDate: agg.last_study_date,
    today: {
      wordsLearned: today?.words_learned || 0,
      studyTimeMinutes: today?.study_time || 0,
    },
  };
}

module.exports = {
  getUserStats,
};
