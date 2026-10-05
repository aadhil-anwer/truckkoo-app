# Load24 follow-ups: implementation review

Review the mobile repository's commit for this document and the matching
`truckkoo-ops` commit titled **Add driver document review and shipment case queue**.
These are local review commits; no production migration, function deployment,
EAS build or update was performed.

## Requested scope and resulting behavior

- **Driver signup and verification:** require an Omani phone, truck class, declared
  capacity and plate. Profile/truck creation uses an atomic, retry-safe RPC.
  Drivers photograph ID front/back, mulkiya and truck photo in a separate question
  flow after creating their profile. They can reopen it from account/home, see
  pending/rejected status and rejection reasons, and retry failed uploads.
  Upload stages are bounded, and actual bytes are limited to 8 MB.
- **Private document review:** evidence goes into the private `driver-verification`
  Supabase Storage bucket. Driver-owned upload/read and explicitly approved ops
  review policies apply; no update/delete/public policy was added. Ops opens
  60-second signed URLs, approves/rejects individual documents and then verifies
  the truck and driver. Verification requires all four approved documents and a
  reviewed truck with plate/capacity. Verified truck details cannot be changed
  without removing verification. Existing verified drivers remain grandfathered;
  migration 0050 enables the verified-driver dispatch gate.
- **Push freshness (item 4):** foreground notifications, notification taps and
  returning to the app invalidate work queries so screens refetch server state.
- **Bidding controls (item 5):** shippers can change/remove their private limit,
  extend bidding and close it. The founder explicitly kept bidding visibility out
  of ops. Migration 0053 blocks existing fixed-price ops price/offer actions on
  bid loads and prevents bypassing an unawarded auction's state. Cancellation and
  allowed post-award handling still delegate to the existing audited ops functions.
- **Urdu and access (item 6):** a complete draft Urdu dictionary, typed placeholders,
  language persistence, profile storage, font handling, account selection and
  Android first-launch RTL. City/truck proper names retain English where the
  website has no approved Urdu source. Native configuration changes bump the
  application runtime version to 1.2.1.
- **WhatsApp OTP:** phone/code screens and bounded Supabase transport are built
  behind `WHATSAPP_AUTH = false`. A signed Send SMS Auth hook forwards codes via
  Meta Cloud API. Email/OAuth stays active. No SMS fallback or client-side Meta
  credential was added. Activation gates are in `whatsapp-otp-activation.md`.
- **Shipment problems/cancellation (item 7):** participants can report delay,
  breakdown, damage or another problem. An unassigned shipment cancels immediately;
  an assigned/in-transit cancellation becomes an ops case and leaves cargo active.
  The approved guarded ops queue supports resolution with an audited explanation.

## Security and database review points

Migrations 0050–0053 are new, append-only files. New owned tables revoke client
access and force RLS; actor RPCs scope ownership internally. Definers pin an empty
search path; ops reads/writes call `require_ops`, and privileged writes audit.
Document metadata cannot be mass-assigned by clients. Storage authorization is the
explicitly approved exception needed to mint signed review URLs.

0053 moves the existing ops implementation into private functions and wraps the
same public signatures. Inspect compatibility with any deployment-specific staff
hardening; delegation deliberately preserves its guards and audit behavior.
Document approval/resubmission is protected against overwriting approved evidence
through a conflicting upsert. Verification/review uses profile row locks.

## Validation and limits

- Mobile: typecheck and lint pass; lint retains two existing duplicate React import
  warnings in `leg/route.tsx`. 814 assertions pass across 60 Jest suites. The test
  process retains an unidentified handle, even with `--detectOpenHandles`; final
  validation uses `--forceExit`, so this is not a clean `npm run verify` exit.
- Ops: typecheck/lint and 73 tests pass. Tests use
  `npm test -- --configLoader runner --cache=false` to avoid writing Vite's temporary
  cache outside the mobile workspace sandbox.
- Arabic/Urdu proof generation passes; local migration numbering reports 53 files.
- The final rollback-only `verification_cases.sql` suite passes signup, document
  review/storage isolation, cancellation/reports and bidding guards.
- Full `npm run test:db` stops in the existing tenant fixture: `match_load` expects
  one leg and gets three. The shared DB has demo rows and newer staff-security
  changes from another checkout. It was not reset. New schema was applied manually
  for focused checks; migration history remains at 0049. Run all SQL suites on a
  clean isolated instance before deployment, and reconcile state honestly.

## Remaining activation/release gates

1. Review and deploy migrations/functions and the ops build against the intended
   environment only after a clean full database run.
2. Obtain Meta's number/token/approved authentication template; confirm its exact
   body/button/language shape, configure signed Auth hooks and test real delivery.
   Account linking must be designed/tested before enabling phone signup.
3. Have native readers proof Urdu and new Arabic copy. Test fresh-install Urdu RTL,
   fonts, camera/gallery permissions, poor-signal upload retry and complete ops
   review on physical devices. A native 1.2.1 build is required.
4. Prove actual push delivery/refresh, auction controls and assigned cancellation
   workflows end to end. Local tests are not device or production evidence.
5. Decide document retention/deletion procedures before real IDs are collected;
   old resubmission files currently remain private and append-only. Automated image
   quality checks and a review-time service promise were not invented.
