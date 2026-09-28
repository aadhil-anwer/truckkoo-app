/**
 * Test configuration.
 *
 * `jest-expo` is the preset because it is the only one that ships the module
 * mocks the Expo runtime needs (fonts, secure store, localization) and resolves
 * React Native's platform extensions — `.ios.tsx`, `.web.tsx` — the same way
 * Metro does. Vitest cannot do the second thing without reimplementing it.
 */

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],

  // Ship dependencies as ESM; they must be transformed rather than skipped.
  // `d3-geo` (and its `d3-array`/`internmap` deps) ship ESM only, so they must
  // be transformed rather than ignored — otherwise the map's projection cannot
  // be imported in a test at all. `uuid` is here because the override in
  // package.json lifts `xcode`'s copy to 11.x for a security fix, and jest-expo's
  // react-native export conditions resolve that to its ESM browser build — which
  // the config-plugin tests reach through `expo/config-plugins`.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@supabase/.*|@tanstack/.*|d3-geo|d3-array|internmap|uuid)',
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/i18n/**/*.ts',
    'src/components/**/*.tsx',
    'src/app/**/*.tsx',
    '!src/**/*.d.ts',
  ],

  // Floors, not targets. They exist so a future change that guts a suite fails
  // loudly instead of quietly reporting green over nothing.
  coverageThreshold: {
    global: { statements: 55, branches: 45, functions: 50, lines: 55 },
    // The money and text-safety modules are the ones where a silent regression
    // is a financial or security incident, so they are held near-total.
    './src/lib/money.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
    './src/lib/safe-text.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
  },

  clearMocks: true,
  restoreMocks: true,

  /**
   * Bounded on purpose.
   *
   * Jest defaults to one worker per core minus one, and each `jest-expo` worker
   * carries a whole React Native transform — a few hundred MB. That is a bet on
   * cores and RAM rising together, and they do not: a 16-core machine with 7GB
   * spawns 15 workers, exhausts memory, and `npm run verify` dies with exit 137
   * rather than a test failure. That happened throughout P7.
   *
   * Four is slower than the theoretical maximum on a large machine and it
   * finishes everywhere, which is the trade a test command should make. CI can
   * override with `--maxWorkers` if it knows better than this file does.
   */
  maxWorkers: 4,
};
