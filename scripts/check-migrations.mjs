#!/usr/bin/env node
/**
 * Migrations are append-only (CLAUDE.md, "Practical"). This makes that a check
 * instead of a sentence.
 *
 *   node scripts/check-migrations.mjs local            # naming + numbering
 *   node scripts/check-migrations.mjs diff <base-ref>  # + nothing applied was edited
 *   node scripts/check-migrations.mjs drift            # + what production has applied
 *
 * WHY EACH ONE:
 * - An edited migration never re-runs on a database that already applied it, so
 *   production silently keeps the old definition while every fresh local stack
 *   and CI run gets the new one. Tests pass against a schema nobody is running.
 * - Two files sharing a number apply in filename order locally but are a single
 *   version to the Supabase CLI, which then refuses to push one of them.
 * - `drift` answers "Migration 0033 is not in production yet" (OPEN_ISSUES)
 *   with a failing check instead of a line in a document. It reads
 *   `supabase_migrations.schema_migrations` over `SUPABASE_DB_URL` — read-only,
 *   and it never applies anything.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

function checkLocal() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Map();
  files.forEach((f, i) => {
    const m = NAME.exec(f);
    if (!m) return fail(`${f}: must be NNNN_lower_snake.sql`);
    const n = Number(m[1]);
    if (seen.has(n)) fail(`${f}: number ${m[1]} already used by ${seen.get(n)}`);
    seen.set(n, f);
    if (n !== i + 1) fail(`${f}: expected number ${String(i + 1).padStart(4, '0')} — gaps and reordering break the apply order`);
  });
  return files;
}

function checkDiff(base) {
  if (!base) return fail('diff needs a base ref, e.g. origin/main');
  const out = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', DIR], {
    encoding: 'utf8',
  });
  for (const line of out.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    if (status !== 'A') {
      fail(`${paths.join(' → ')}: ${status} on an existing migration. Applied migrations are never edited, renamed or deleted — write a new one.`);
    }
  }
}

function checkDrift(files) {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return fail('drift needs SUPABASE_DB_URL');
  const out = execFileSync(
    'psql',
    [url, '-XAt', '-c', 'select version from supabase_migrations.schema_migrations order by version'],
    { encoding: 'utf8' },
  );
  const applied = new Set(out.split('\n').filter(Boolean));
  const local = new Set(files.map((f) => f.slice(0, 4)));

  const pending = [...local].filter((v) => !applied.has(v));
  const unknown = [...applied].filter((v) => !local.has(v));
  if (pending.length) fail(`in the repo but not applied to production: ${pending.join(', ')}`);
  if (unknown.length) fail(`applied to production but not in the repo: ${unknown.join(', ')} — someone changed production by hand`);

  checkProductionShape(url, files);
}

/**
 * The ledger only sees migrations. A dashboard click leaves it clean — that is
 * how an anon-callable SECURITY DEFINER function reached production (0037). So
 * also ask the live catalog the three questions whose wrong answer is a leak.
 * Catalog reads only; any role can run them.
 */
function checkProductionShape(url, files) {
  const q = (sql) =>
    execFileSync('psql', [url, '-XAt', '-c', sql], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

  const anonDefiners = q(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')`);
  if (anonDefiners.length) {
    fail(`SECURITY DEFINER functions callable WITHOUT signing in: ${anonDefiners.join(', ')} — revoke from anon in a migration`);
  }

  const openTables = q(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not (c.relrowsecurity and c.relforcerowsecurity)`);
  if (openTables.length) {
    fail(`public tables without RLS enabled AND forced: ${openTables.join(', ')}`);
  }

  // Any mention counts — create, grant, revoke — so a migration can adopt a
  // hand-made function by naming it, as 0037 does.
  const known = new Set();
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    for (const m of sql.matchAll(/function\s+public\.([a-z0-9_]+)/gi)) known.add(m[1].toLowerCase());
  }
  const handMade = q(`
    select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)
    .filter((name) => !known.has(name));
  if (handMade.length) {
    fail(`public functions no migration mentions: ${handMade.join(', ')} — created by hand; review, then adopt or drop in a migration`);
  }
}

const [mode, arg] = process.argv.slice(2);
const files = checkLocal();
if (mode === 'diff') checkDiff(arg);
else if (mode === 'drift') checkDrift(files);
else if (mode !== 'local') fail(`unknown mode "${mode}" — local | diff <base> | drift`);

if (!process.exitCode) console.log(`✓ ${files.length} migrations (${mode})`);
