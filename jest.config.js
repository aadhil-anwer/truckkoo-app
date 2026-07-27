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
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@supabase/.*|@tanstack/.*)',
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
};
