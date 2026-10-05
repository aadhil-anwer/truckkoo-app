/**
 * Features that exist in the code but not yet in the product.
 *
 * A flag here HIDES a feature; it does not remove it. The screens, queries and
 * server functions behind it stay built and tested, so turning it back on is a
 * one-line change rather than a rebuild.
 *
 * Hidden is not disabled. Anything a flag hides is still reachable by a client
 * that calls the API directly, so a flag is never a security boundary — if a
 * feature must not be usable, the database has to refuse it.
 */

/**
 * Drivers declaring the trips they are already making ("Add a trip you are
 * making"), and matching loads onto those legs.
 *
 * OFF, unreleased (2026-09-26). The driver's third tab is Past trips instead of
 * Routes, and home no longer sells declaring legs. Matching is moving toward the
 * driver's location with an availability toggle, which will get its own spec.
 *
 * Still built while off: `src/app/(app)/leg/*`, the Routes tab, `post_leg`, and
 * the leg tiers of `private.candidates_for`. The server still accepts a leg from
 * a direct API call — harmless, since a leg only feeds matching.
 */
export const DECLARED_TRIPS: boolean = false;

/**
 * Driver-priced loads (0045, `docs/bidding-v1-design.md`).
 *
 * ON (2026-10-04). New bookings go through `post_bid_load`: no fixed price at
 * the review, an optional "most you will pay", and drivers name their price.
 * Off, the review books through `book_load` at the rate-card price as before.
 *
 * Switching it off by an update is the rollback. Loads already posted as bids
 * keep their bid screens either way — the screens follow `loads.pricing_mode`,
 * not this flag — so a bidding load is never stranded by flipping it.
 *
 * Needs 0045 applied and `bid_fee_pct` set before a build with this on reaches
 * shippers; until then posting fails with "bid fee is not configured".
 */
export const BIDDING: boolean = true;

/** Supabase phone auth through Meta's signed Send SMS hook. Keep disabled until
 * the approved template, server secrets, identity linking and device tests pass
 * the activation gates in docs/whatsapp-otp-activation.md. */
export const WHATSAPP_AUTH: boolean = false;
