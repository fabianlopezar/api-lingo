/**
 * Detecta si la migración Leitner (`database/migrations/004_leitner.sql`)
 * ya fue aplicada en Supabase (columnas `current_box`,
 * `last_reviewed_at`, `next_review_at` en `user_words`).
 *
 * Permite que la API siga funcionando aunque la migración aún no se haya
 * ejecutado: los listados degradan a Caja 1 y solo los endpoints de repaso
 * exigen las columnas. El resultado se cachea 30s para no sumar consultas,
 * y se re-evalúa solo: tras aplicar la migración el servidor se recupera
 * sin necesidad de reinicio.
 */
const { query } = require('../config/db');

const CACHE_TTL_MS = 30_000;
let cachedValue = null;
let cachedAt = 0;

async function leitnerReady() {
  if (cachedValue !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }

  try {
    await query('SELECT current_box, last_reviewed_at, next_review_at FROM user_words LIMIT 0');
    cachedValue = true;
  } catch (error) {
    // 42703 = undefined_column → migración pendiente.
    if (error && error.code === '42703') {
      cachedValue = false;
    } else {
      throw error;
    }
  }

  cachedAt = Date.now();
  return cachedValue;
}

/** Solo para pruebas: limpia la caché del probe. */
function resetLeitnerCache() {
  cachedValue = null;
  cachedAt = 0;
}

module.exports = { leitnerReady, resetLeitnerCache };
