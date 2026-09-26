#!/usr/bin/env node
/**
 * The dead man's switch. Asks production `private.system_health()` from
 * OUTSIDE the database, because every other alarm lives inside it: if the
 * project is paused, cron has stopped, or pg_net cannot reach the webhook, the
 * in-database alarms are silent by construction. This one is not — it runs on
 * GitHub and posts to the webhook itself.
 *
 *   SUPABASE_DB_URL=… [ALERT_WEBHOOK_URL=…] node scripts/check-health.mjs
 *
 * Exit 1 on any problem, so the workflow run goes red too.
 */

import { execFileSync } from 'node:child_process';

const url = process.env.SUPABASE_DB_URL;
const webhook = process.env.ALERT_WEBHOOK_URL;

if (!url) {
  console.error('✗ SUPABASE_DB_URL is not set');
  process.exit(1);
}

let problems;
try {
  const out = execFileSync('psql', [url, '-XAtc', 'select private.system_health()'], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const health = JSON.parse(out.trim());
  problems = health.ok ? [] : health.problems;
} catch (err) {
  // Unreachable is the most important verdict this script can return: a paused
  // or down project is exactly what nothing inside the database can report.
  const detail = String(err.stderr || err.message).split('\n')[0].slice(0, 200);
  problems = [`database unreachable or health check failed: ${detail}`];
}

if (problems.length === 0) {
  console.log('✓ healthy');
  process.exit(0);
}

const text = `Truckkoo health check FAILED\n${problems.map((p) => `• ${p}`).join('\n')}`;
console.error(text);

if (webhook) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error(`✗ webhook answered ${res.status}`);
  } catch (err) {
    console.error(`✗ webhook unreachable: ${err.message}`);
  }
}

process.exit(1);
