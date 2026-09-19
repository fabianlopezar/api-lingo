/**
 * Backfill de características lingüísticas.
 *
 * Recorre `words` y enriquece con Gemini las que no tienen
 * familia gramatical, sinónimos, colocaciones ni ejemplo
 * (típico de stubs de sinónimos/antónimos o de POST / manual).
 *
 * Uso:
 *   node scripts/backfill-word-details.js [--limit=50] [--skip-illustration] [--dry-run]
 *
 * - --limit=N: máx. palabras a procesar (default 50, máx. 500).
 * - --skip-illustration: omite Tarea 3 (más rápido, sin Cloudinary).
 * - --dry-run: solo lista las candidatas sin llamar a Gemini.
 */
const { initPool, query } = require('../src/config/db');
const { ensureWordDetails, loadDetails, hasLinguisticDetails } = require('../src/services/unknownWordService');

function parseArgs(argv) {
  const args = { limit: 50, skipIllustration: false, dryRun: false };
  for (const raw of argv) {
    if (raw.startsWith('--limit=')) {
      const n = parseInt(raw.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) args.limit = Math.min(n, 500);
    } else if (raw === '--skip-illustration') {
      args.skipIllustration = true;
    } else if (raw === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { limit, skipIllustration, dryRun } = parseArgs(process.argv.slice(2));
  await initPool();

  const { rows } = await query(
    `SELECT id, english_word, spanish_word, created_at
     FROM words
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit * 4]
  );

  const candidates = [];
  for (const row of rows) {
    const details = await loadDetails(query, row.id).catch(() => null);
    if (!hasLinguisticDetails(details)) {
      candidates.push(row);
    }
    if (candidates.length >= limit) break;
  }

  console.log(`[backfill] Palabras revisadas: ${rows.length}, sin detalles: ${candidates.length}`);
  if (dryRun) {
    for (const c of candidates) console.log(`  - ${c.english_word} (${c.id})`);
    return;
  }

  let enriched = 0;
  let failed = 0;
  for (const [i, row] of candidates.entries()) {
    try {
      console.log(`[backfill] (${i + 1}/${candidates.length}) Enriqueciendo "${row.english_word}"...`);
      const result = await ensureWordDetails(row.id, { skipIllustration });
      if (result.enriched) enriched += 1;
      else console.log(`[backfill] "${row.english_word}" ya tenía detalles (carrera), se omite.`);
    } catch (error) {
      failed += 1;
      console.error(`[backfill] Falló "${row.english_word}": ${error?.message}`);
    }
    // Pausa para no saturar a Gemini (429/503).
    if (i < candidates.length - 1) await sleep(1500);
  }

  console.log(`[backfill] Listo. Enriquecidas: ${enriched}, fallidas: ${failed}, ya completas: ${candidates.length - enriched - failed}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[backfill] Error fatal:', e?.message || e);
  process.exit(1);
});
