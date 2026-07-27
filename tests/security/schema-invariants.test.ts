/**
 * Invariants read straight out of the migration SQL.
 *
 * The tenant-isolation suite (`supabase/tests/tenant_isolation.sql`) proves these
 * rules hold at runtime, but it needs Docker and a database. These are the same
 * rules asserted statically, so they run in CI on every commit and fail in
 * milliseconds when someone writes a migration that quietly opens something up.
 *
 * A static test cannot prove a policy is correct. It can prove that the specific
 * mistakes this project has already made once are not present again.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '../../supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SQL = FILES.map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');
const NORMALISED = SQL.toLowerCase();

describe('migrations exist and are ordered', () => {
  it('finds the migration set', () => {
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES[0]).toMatch(/^0001_/);
  });
});

describe('deny by default', () => {
  it('revokes everything from anon and authenticated before granting anything back', () => {
    expect(NORMALISED).toContain('revoke all on all tables in schema public from anon, authenticated');
  });

  it('revokes function execution from anon', () => {
    expect(NORMALISED).toContain('revoke all on all functions in schema public from anon');
  });

  it('closes the private helper schema to both client roles', () => {
    expect(NORMALISED).toContain('revoke all on schema private from anon, authenticated');
  });
});

describe('the nullable truck type', () => {
  /**
   * `loads.truck_type_code` NULL means "Not sure — advise me", which the website
   * offers as the default and which is the single most important affordance for a
   * low-tech audience. A NOT NULL constraint silently deletes it.
   */
  it('never constrains truck_type_code to NOT NULL', () => {
    const line = SQL.split('\n').find((l) => l.includes('truck_type_code') && l.includes('references'));
    expect(line).toBeDefined();
    expect(line!.toLowerCase()).not.toContain('not null');
  });
});

describe('money is integer baisa', () => {
  it('never stores a price as a float or numeric', () => {
    // OMR has three decimals; float and numeric both invite two-decimal handling.
    const priceLines = SQL.split('\n').filter((l) => /price|amount|baisa/i.test(l) && !l.trim().startsWith('--'));
    for (const line of priceLines) {
      expect(line.toLowerCase()).not.toMatch(/\b(float|real|double precision|money)\b/);
    }
  });

  it('names price columns in baisa so the unit cannot be mistaken', () => {
    if (/price/i.test(SQL)) {
      expect(NORMALISED).toContain('price_baisa');
    }
  });
});

describe('security definer functions', () => {
  const definers = SQL.split(/create (?:or replace )?function/i)
    .slice(1)
    .filter((body) => /security definer/i.test(body));

  it('finds the definer functions the design depends on', () => {
    expect(definers.length).toBeGreaterThan(0);
  });

  it('pins search_path on every one', () => {
    // An unpinned search path in a definer function is a privilege-escalation
    // primitive: the caller chooses which schema your identifiers resolve in.
    for (const body of definers) {
      const head = body.slice(0, body.indexOf('$'));
      expect(head.replace(/\s+/g, ' ')).toMatch(/set search_path = ''/i);
    }
  });
});

describe('match_load re-checks ownership internally', () => {
  /**
   * Regression test for a real IDOR. `match_load` is `security definer` and takes
   * a `load_id`, so without an internal ownership check any authenticated user
   * could pass any load id and read back driver identities.
   */
  it('constrains to the calling shipper inside the function body', () => {
    const start = SQL.toLowerCase().indexOf('function public.match_load');
    expect(start).toBeGreaterThan(-1);

    const body = SQL.slice(start, start + 4000).toLowerCase();
    expect(body).toMatch(/shipper_id\s*=\s*\(\s*select auth\.uid\(\)\s*\)/);
  });
});

describe('mass-assignment defences', () => {
  const GRANTS = SQL.split('\n').filter((l) => /^\s*grant\s/i.test(l)).join('\n').toLowerCase();

  it('never grants a client write on role', () => {
    // role is INSERT-grantable exactly once at signup; there is no UPDATE grant.
    expect(GRANTS).not.toMatch(/grant update\s*\([^)]*\brole\b/);
  });

  it('never grants a client write on a verification timestamp', () => {
    expect(GRANTS).not.toMatch(/grant (insert|update)\s*\([^)]*verified_at/);
  });

  it('never grants a client write on a price', () => {
    expect(GRANTS).not.toMatch(/grant (insert|update)\s*\([^)]*price_baisa/);
  });

  it('never grants a client write on a status column', () => {
    // Every state transition goes through an RPC. No client sets a status.
    expect(GRANTS).not.toMatch(/grant (insert|update)\s*\([^)]*\bstatus\b/);
  });

  it('grants columns explicitly rather than whole tables to authenticated', () => {
    const tableWideWrites = GRANTS.split('\n').filter(
      (l) => /grant (insert|update)\s+on\s/.test(l) && !/\(/.test(l),
    );
    expect(tableWideWrites).toEqual([]);
  });
});

describe('there is no load board', () => {
  /**
   * Regression test. An early policy let any authenticated user read every
   * `posted` load, which exposed every shipper's cargo details to anyone who
   * signed up as a driver. Drivers see `offers` addressed to them, nothing else.
   */
  it('never grants driver reads on loads by status alone', () => {
    const policies = SQL.toLowerCase();
    // A policy body matching only on status, with no offer or ownership join, is
    // the shape of the bug.
    const suspicious = /using\s*\(\s*status\s*=\s*'posted'\s*\)/;
    expect(policies).not.toMatch(suspicious);
  });
});

describe('storage', () => {
  it('creates the proof-of-delivery bucket private', () => {
    const bucket = SQL.slice(NORMALISED.indexOf("'pod'"));
    expect(bucket.toLowerCase()).not.toMatch(/'pod'\s*,\s*'pod'\s*,\s*true/);
  });

  it('has no update or delete policy on proof of delivery', () => {
    // Append-only: a trail that can be edited is not a trail.
    const podPolicies = SQL.split('\n').filter((l) => /pod/i.test(l) && /policy/i.test(l));
    for (const line of podPolicies) {
      expect(line.toLowerCase()).not.toMatch(/for (update|delete)/);
    }
  });
});

describe('pricing', () => {
  /**
   * The rate card is "crown jewel #1" (SECURITY.md §1). These assert the four
   * decisions in 0010 that would each be silently reversible by a plausible
   * later edit.
   */
  it('keeps the rate card in the private schema, which PostgREST does not expose', () => {
    expect(NORMALISED).toContain('create table private.rate_cards');
    expect(NORMALISED).not.toContain('create table public.rate_cards');
  });

  it('gives no client role any privilege on the rate card or its audit log', () => {
    expect(NORMALISED).toContain('revoke all on table private.rate_cards from anon, authenticated');
    expect(NORMALISED).toContain('revoke all on table private.rate_card_audit from anon, authenticated');

    const GRANTS = SQL.split('\n').filter((l) => /^\s*grant\s/i.test(l)).join('\n').toLowerCase();
    expect(GRANTS).not.toContain('rate_cards');
    expect(GRANTS).not.toContain('rate_card_audit');
  });

  it('never exposes the pricing formula to a client', () => {
    // A client that can call compute_price with its own rate values can
    // brute-force the card by finding which inputs reproduce a real quote.
    expect(NORMALISED).toMatch(
      /revoke all on function private\.compute_price\([^)]*\)\s*from public, anon, authenticated/,
    );
  });

  it('declares the pricing formula immutable', () => {
    // `immutable` is what makes SECURITY.md §5's "no network, no clock read, no
    // env reads" enforced by Postgres rather than only by policy.
    const start = NORMALISED.indexOf('function private.compute_price');
    expect(start).toBeGreaterThan(-1);
    const head = NORMALISED.slice(start, NORMALISED.indexOf('$$', start));
    expect(head).toContain('immutable');
  });

  it('withholds quote provenance from the client column grant', () => {
    // Which quotes shared a rate card maps the band structure of the card.
    const start = NORMALISED.indexOf('grant select (\n  id, shipper_id, load_id');
    expect(start).toBeGreaterThan(-1);
    const grant = NORMALISED.slice(start, NORMALISED.indexOf(';', start));
    expect(grant).toContain('price_baisa');
    expect(grant).not.toContain('rate_card_id');
  });

  it('gives quotes no client write grant of any kind', () => {
    const GRANTS = SQL.split('\n').filter((l) => /^\s*grant\s/i.test(l)).join('\n').toLowerCase();
    expect(GRANTS).not.toMatch(/grant (insert|update|delete)[^;]*on public\.quotes/);
  });

  it('backs quote immutability with a trigger, not only a missing grant', () => {
    // A definer function runs as owner and is not subject to grants at all, so
    // the grant alone would not stop a future RPC from amending a price.
    expect(NORMALISED).toContain('create trigger quotes_no_update');
    expect(NORMALISED).toMatch(/before update or delete on public\.quotes/);
  });

  it('ships no rates — no price is ever invented in a migration', () => {
    /**
     * The card is authored by hand from real Omani freight rates. A placeholder
     * inserted "just to see it work" becomes a number quoted to a customer the
     * first time someone forgets it was a placeholder.
     */
    // Comments stripped first: 0010 documents the by-hand insert template, and
    // the template is the whole point — it is executable SQL that must not be
    // executable *here*.
    const executable = SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .toLowerCase();
    expect(executable).not.toMatch(/insert into private\.rate_cards/);
  });

  it('exposes no anonymous quote path', () => {
    // SECURITY.md §11: per-IP rate limiting is not implemented, and "anonymous
    // endpoints must not ship before they are". The quote path is exactly what an
    // unthrottled anonymous endpoint would leak.
    const GRANTS = SQL.split('\n').filter((l) => /^\s*grant\s/i.test(l)).join('\n').toLowerCase();
    expect(GRANTS).not.toMatch(/quote_load[^;]*to (public|anon)/);
    expect(GRANTS).not.toMatch(/current_quote[^;]*to (public|anon)/);
    expect(NORMALISED).toContain("perform private.check_rate_limit('quote_load'");
  });

  it('re-checks ownership inside quote_load, which takes an id and is a definer', () => {
    // Same shape as the match_load IDOR above: without this, any authenticated
    // user could price any load and read back its route and weight.
    const start = NORMALISED.indexOf('function public.quote_load');
    expect(start).toBeGreaterThan(-1);
    const body = NORMALISED.slice(start, start + 6000);
    expect(body).toMatch(/shipper_id\s*=\s*v_actor/);
  });

  it('routes every unpriceable load to finding_truck rather than a dead end', () => {
    // PRODUCT.md's permanent promise. The empty rate card makes this the DEFAULT
    // path, not an edge case, so it is the one that must not regress.
    const start = NORMALISED.indexOf('function public.quote_load');
    const body = NORMALISED.slice(start, start + 6000);
    expect(body).toContain("set status = 'finding_truck'");
  });
});

describe('the pricing formula has no second implementation', () => {
  /**
   * SECURITY.md §5: "The server always recomputes the price." One implementation
   * cannot disagree with itself; two will, and the divergence surfaces as a
   * price. A TS formula would also ship the shape of the rate card in the app
   * bundle, which §9 says is public forever.
   */
  it('has no client-side pricing module', () => {
    const libDir = join(__dirname, '../../src/lib');
    const files = readdirSync(libDir);
    expect(files).not.toContain('pricing.ts');
    expect(files).not.toContain('rates.ts');
  });

  it('never hardcodes a rate or a fare in client source', () => {
    const libDir = join(__dirname, '../../src/lib');
    for (const f of readdirSync(libDir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(libDir, f), 'utf8').toLowerCase();
      expect(src).not.toMatch(/per_tonne|per_km|base_baisa|min_fare/);
    }
  });
});

describe('tiered candidates keep the load board shut (0012)', () => {
  /**
   * `private.candidates_for` is the matching query with the ownership check
   * removed — its callers do the checking. Granting it to a client role would
   * hand every driver an enumeration of every shipper's cargo, which is exactly
   * the load board this project refuses to build.
   */
  it('never grants candidates_for to a client role', () => {
    expect(NORMALISED).toMatch(
      /revoke all on function private\.candidates_for\([^)]*\)\s*from public, anon, authenticated/,
    );
    expect(NORMALISED).not.toMatch(/grant execute on function private\.candidates_for/);
  });

  it('keeps auto_dispatch and issue_quote out of client reach too', () => {
    for (const fn of ['private\\.auto_dispatch', 'private\\.issue_quote', 'private\\.setting_int']) {
      expect(NORMALISED).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\)\\s*from public, anon, authenticated`));
      expect(NORMALISED).not.toMatch(new RegExp(`grant execute on function ${fn}`));
    }
  });

  it('narrows the offers grant to a column list when adding source', () => {
    // `public.offers` carried a TABLE-level select grant, so a new column would
    // auto-expose itself (SECURITY.md §10). The revoke must come first and the
    // column grant must not be followed by a table-level one.
    const revokeAt = NORMALISED.indexOf('revoke select on public.offers from authenticated');
    expect(revokeAt).toBeGreaterThan(-1);

    const after = NORMALISED.slice(revokeAt);
    expect(after).toContain('grant select (');
    expect(after).not.toContain('grant select on public.offers to authenticated');
  });

  it('withholds source from the column grant', () => {
    const revokeAt = NORMALISED.indexOf('revoke select on public.offers from authenticated');
    const grant = NORMALISED.slice(revokeAt, NORMALISED.indexOf(') on public.offers', revokeAt));
    expect(grant).toContain('expires_at');
    expect(grant).not.toContain('source');
  });
});

describe('the dispatch log (0014)', () => {
  it('is denied to both client roles and forces RLS', () => {
    expect(NORMALISED).toContain('alter table private.dispatch_log enable row level security');
    expect(NORMALISED).toContain('alter table private.dispatch_log force row level security');
    expect(NORMALISED).toContain('revoke all on table private.dispatch_log from anon, authenticated');
  });

  it('logs SQLSTATE and never SQLERRM', () => {
    /**
     * `sqlerrm` can carry a goods description out of a check-constraint message
     * and into a table dispatch reads. The code is the diagnostic; the message is
     * a tenant's cargo.
     */
    // Comment lines are stripped first: the migration explains this rule in prose
    // and would otherwise fail its own test.
    const code = SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .toLowerCase();

    const inserts = code.split('\n').filter((l) => l.includes('dispatch_log') || l.includes("'error'"));
    expect(code).toContain('sqlstate');
    for (const line of inserts) {
      expect(line).not.toContain('sqlerrm');
    }
  });
});

describe('auto-dispatch stays bounded (0014)', () => {
  it('keeps a kill switch and both caps as settings, not constants', () => {
    for (const key of [
      'auto_dispatch_enabled',
      'auto_dispatch_max_offers',
      'auto_dispatch_max_pending_per_driver',
      'auto_dispatch_requires_price',
    ]) {
      expect(NORMALISED).toContain(key);
    }
  });

  it('only ever auto-dispatches tier 1 with no window grace', () => {
    // "Strong match" means an empty leg whose declared window actually covers the
    // pickup. Widening either argument here sends offers on a dispatcher's
    // judgement without the dispatcher.
    const start = NORMALISED.indexOf('function private.auto_dispatch');
    expect(start).toBeGreaterThan(-1);
    const body = NORMALISED.slice(start, start + 4000);
    expect(body).toMatch(/candidates_for\(p_load_id,\s*1::smallint,\s*0,/);
  });
});

describe('SENSITIVE_FIELDS.md is kept in step', () => {
  const register = readFileSync(join(__dirname, '../../SENSITIVE_FIELDS.md'), 'utf8').toLowerCase();

  it('records every field the grants deliberately withhold', () => {
    for (const field of ['role', 'verified_at', 'price_baisa', 'status', 'source']) {
      expect(register).toContain(field);
    }
  });
});
