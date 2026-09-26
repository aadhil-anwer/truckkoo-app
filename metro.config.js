// Sentry's wrapper around Expo's default config: adds debug IDs to bundles so
// uploaded source maps turn a minified release stack trace back into file:line.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
