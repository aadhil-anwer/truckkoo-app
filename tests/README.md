# Tests

```bash
npm test              # everything below except the database suite
npm run test:coverage # with coverage floors enforced
npm run test:db       # tenant isolation, needs the local Supabase stack
npm run verify        # typecheck + lint + test
```

## Layers

| Path | What it protects |
|---|---|
| `unit/money.test.ts` | The OMR three-decimal trap. A bug here is a billing incident. |
| `unit/safe-text.test.ts` | Bidi spoofing and WhatsApp deep-link injection. |
| `unit/format.test.ts` | The UTC-midnight date off-by-one. Runs under `TZ=America/New_York` on purpose — in UTC these pass against a broken implementation. |
| `unit/i18n.test.ts` | RTL correctness and dictionary integrity. |
| `components/primitives.test.tsx` | 44pt tap targets, disabled/loading/error states, screen-reader names. |
| `components/tab-bar.test.tsx` | Role-aware tab visibility. A custom `tabBar` cannot read expo-router's `href: null`, and the version that tried showed a shipper the driver's tabs. |
| `integration/harness.tsx` | Not a suite — the shared mocks and fixtures for the two below. Import it **first**; its `jest.mock` calls run at require time. |
| `integration/shipper-screens.test.tsx` | Home, the loads ledger, and the load detail against mocked data — including the no-dead-end promise and the price's three no-number outcomes. |
| `integration/driver-screens.test.tsx` | The trip, the offers (accept race, silent-decline regression, the pay that must never render blank) and the declared routes. |
| `security/env-guard.test.ts` | The service-role-key-in-the-client guard. |
| `security/schema-invariants.test.ts` | Static assertions over the migration SQL, including that the pricing formula has no client-side twin. |

The two SQL suites need the local stack (`npx supabase start`) and run together
under `npm run test:db`:

| Path | What it protects |
|---|---|
| `supabase/tests/tenant_isolation.sql` | Actor A cannot touch actor B's row, for every owned table. |
| `supabase/tests/pricing.sql` | The §5 pricing edge cases, the authorization matrix for the quote RPCs, and that the rate card is unreachable from any client. |

`pricing.sql` holds what would normally be unit tests. The pricing formula lives
only in the database — deliberately, so there is one implementation and so the
rate card's shape never enters the app bundle — so `private.compute_price` can
only be tested where it lives.

## Rules

**No test reaches the network.** `src/lib/supabase.ts` is mocked in
`tests/setup.ts`, and `global.fetch` throws. A test that silently hit a real
Supabase project would be slow, flaky, and — since it authenticates — a way to
write to production from CI.

**Invisible characters are written as `\u` escapes.** A literal U+202E in a test
file is unreviewable in a diff, which is unacceptable in a suite whose whole job
is bidi spoofing.

**Coverage floors are floors, not targets.** `money.ts` and `safe-text.ts` sit at
95% because a silent regression in either is a financial or security incident.
The global floor is deliberately low; raise it as coverage grows, never lower it
to make a build pass.

## What these do not cover

- **The background location task itself.** Jest mocks `expo-location` and
  `expo-task-manager`, so OS delivery of fixes, the foreground-service
  notification, reboot, OEM battery killers and the Android 11+ Settings hop are
  covered only by the device check in `OPEN_ISSUES.md` (Driver background GPS).
- **Anything on a real device.** No screen has been seen rendered. See
  `OPEN_ISSUES.md` items 9 and 10.
- **RTL layout.** `align` and `directionArrow` are tested; whether the horizontal
  pager lays out correctly in Arabic is not, and cannot be without a device.
- **Storage policies.** The `pod` bucket's append-only behaviour is asserted
  statically against the SQL, not exercised against real Storage.
- **Real rates.** `pricing.sql` loads one throwaway band inside a transaction it
  rolls back. Every assertion about a *computed* price is therefore against a rate
  this suite invented — which proves the arithmetic, and proves nothing about
  whether Truckkoo's real rates are right. See `OPEN_ISSUES.md` 13.

  The suite clears `private.rate_cards` in its fixtures so it is hermetic whether
  or not `npm run seed:rates` has been run. That delete is inside the rolled-back
  transaction, so a seeded dev card survives a test run intact.
- **The auth round trips.** Confirmation and reset links have never been tapped.
  `completeEmailConfirmation` and `completePasswordReset` are untested; they need
  either an integration test against the local stack or a manual pass with
  Mailpit at `http://127.0.0.1:54324`.
