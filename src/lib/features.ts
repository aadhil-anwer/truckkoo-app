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
