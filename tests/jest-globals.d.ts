/**
 * Pulls Jest's ambient globals — `describe`, `it`, `expect`, `beforeEach`, `jest`
 * — into the TypeScript program.
 *
 * `@types/jest` is installed and declares these as ambient `declare var`s, but
 * TypeScript's automatic `@types` inclusion does not surface them here under
 * Expo's base config (`moduleResolution: "bundler"` with `customConditions`), so
 * `tsc --noEmit` reported ~600 "Cannot find name 'expect'" errors across the test
 * files while Jest itself ran all 189 tests happily.
 *
 * This is deliberately a reference rather than `compilerOptions.types: ["jest"]`.
 * Setting that array switches OFF automatic inclusion of every other `@types`
 * package — `react`, `node`, `react-test-renderer`, `hammerjs` — and trades one
 * missing global for a different set.
 */

/// <reference types="jest" />

/**
 * And Node's globals, for the same reason.
 *
 * The security suites legitimately need them: `schema-invariants` reads the
 * migration SQL off disk with `fs` and `__dirname`, `env-guard` builds JWTs with
 * `Buffer`, and `setup.ts` closes the network by replacing `global.fetch`. None of
 * that is app code — it never ships — but it is typechecked alongside it.
 */

/// <reference types="node" />
