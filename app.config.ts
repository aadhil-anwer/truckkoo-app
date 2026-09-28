/**
 * app.json is the configuration; this only adds what must not be committed.
 * GOOGLE_MAPS_ANDROID_KEY is an EAS environment variable, restricted in Google
 * Cloud to this package's signing certificate and to Maps SDK for Android.
 * Without it (a local `expo start`) the pin screen shows a blank map and the
 * city list still works.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
    },
  },
});
