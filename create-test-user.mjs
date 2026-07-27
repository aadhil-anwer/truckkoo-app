/**
 * One-off: create a confirmed email/password user in the REMOTE Supabase project
 * for manual testing. Uses the Auth Admin API with `email_confirm: true`, so the
 * account skips the confirmation email and is immediately sign-in-able.
 *
 * The service_role key bypasses all RLS — it is passed via env, never hardcoded,
 * never committed. Run, then delete this file.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SERVICE_ROLE_KEY=<service_role key> \
 *   TEST_EMAIL=tester@truckkoo.app \
 *   TEST_PASSWORD='Test1234!' \
 *   WITH_PROFILE=shipper \            # optional: shipper | driver — creates a profile row too
 *   node create-test-user.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SERVICE_ROLE_KEY;
const email = process.env.TEST_EMAIL ?? 'tester@truckkoo.app';
const password = process.env.TEST_PASSWORD ?? 'Test1234!';
const withProfile = process.env.WITH_PROFILE ?? ''; // '', 'shipper', or 'driver'

if (!url || !key) {
  console.error('Set SUPABASE_URL and SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // <- email verification already done
});

if (error) {
  // Most likely cause on a re-run: the user already exists.
  console.error('createUser failed:', error.message);
  process.exit(1);
}

const userId = data.user.id;
console.log(`✓ confirmed user created`);
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  id:       ${userId}`);

if (withProfile === 'shipper' || withProfile === 'driver') {
  // service_role bypasses RLS/column grants, which is why this only runs
  // server-side here and never from the app.
  const { error: pErr } = await admin.from('profiles').insert({
    id: userId,
    role: withProfile,
    full_name: 'Test User',
    phone: null,
  });
  if (pErr) {
    console.error(`profile insert failed: ${pErr.message}`);
    process.exit(1);
  }
  console.log(`✓ ${withProfile} profile row created — sign-in lands straight in the app`);
} else {
  console.log('  (no profile row — sign-in will walk through role/details steps)');
}
