// Two-pass backfill: seed anonymous_usage from the anon_id counts that Phase
// 10 tracked via prisma.analysis.count(). Without this, every existing cookie
// would get a fresh 3 free stories. Idempotent (ON CONFLICT DO NOTHING).
//
//   bun scripts/backfill-anon-usage.ts              # dry run: print counts only
//   bun scripts/backfill-anon-usage.ts --apply      # run the insert, then verify
//
// Then delete this script.

import { prisma } from "@newshog/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = (await prisma.$queryRaw<
    { anon_id: string; count: bigint }[]
  >`
    SELECT anon_id, COUNT(*)::bigint AS count
    FROM analyses
    WHERE anon_id IS NOT NULL
    GROUP BY anon_id
    ORDER BY count DESC
  `) as { anon_id: string; count: number }[];

  const total = rows.reduce((acc, r) => acc + Number(r.count), 0);
  console.log(`\nDry run: ${rows.length} anon ids, ${total} total analyses to seed.`);
  for (const r of rows.slice(0, 25)) {
    console.log(`  ${r.anon_id} → ${r.count}`);
  }
  if (rows.length > 25) console.log(`  … and ${rows.length - 25} more`);

  const expectedRows = rows.length;
  const expectedTotal = total;

  if (!APPLY) {
    console.log("\nDry run only — no rows written. Re-run with --apply to seed.\n");
    await prisma.$disconnect();
    return;
  }

  if (expectedRows === 0) {
    console.log("No anonymous analyses found — nothing to seed.");
    await prisma.$disconnect();
    return;
  }

  const inserted = await prisma.$executeRaw`
    INSERT INTO anonymous_usage (id, anon_id, kind, count, first_seen, last_seen)
    SELECT gen_random_uuid(), anon_id, 'quick_search', COUNT(*), MIN(created_at), MAX(created_at)
    FROM analyses
    WHERE anon_id IS NOT NULL
    GROUP BY anon_id
    ON CONFLICT (anon_id, kind) DO NOTHING
  `;

  const check = (await prisma.$queryRaw<{ rows: bigint; total: bigint }[]>`
    SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(count), 0)::bigint AS total
    FROM anonymous_usage
    WHERE kind = 'quick_search'
  `)[0];

  console.log(`Inserted ${inserted} rows (skipped any already-seeded).`);
  console.log(`Verify — seeded rows: ${Number(check.rows)} (expected ${expectedRows}), total: ${Number(check.total)} (expected ${expectedTotal}).`);
  console.log(
    Number(check.rows) === expectedRows && Number(check.total) === expectedTotal
      ? "MATCH ✓"
      : "MISMATCH ✗ — inspect before proceeding",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});