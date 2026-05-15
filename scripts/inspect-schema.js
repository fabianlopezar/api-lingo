const { initPool, query } = require('../src/config/db');

async function main() {
  await initPool();
  for (const table of ['users', 'words', 'user_words', 'stats']) {
    const { rows } = await query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    console.log(`\n--- ${table} ---`);
    rows.forEach((c) => console.log(`  ${c.column_name} (${c.data_type})`));
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
