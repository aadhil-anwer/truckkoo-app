/**
 * app.json is the configuration; this only adds what must not be committed.
 * GOOGLE_MAPS_ANDROID_KEY is an EAS environment variable, restricted in Google
 * Cloud to this package's signing certificate and to Maps SDK for Android.
 * Without it (a local `expo start`) the pin screen shows a blank map and the
 * city list still works.
 *
 * GOOGLE_SERVICES_JSON is an EAS *file* environment variable holding Firebase's
 * google-services.json for com.truckkoo.app — Android needs it for push (0046).
 * EAS hands the build a path to the file. Without it Android builds still work
 * and simply get no push token.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
    },
  },
});
