/**
 * Seed the layout direction natively, once, before React starts.
 *
 * WHY THIS EXISTS. On Android, React Native decides whether the phone reads
 * right-to-left in `I18nUtil.isDevicePreferredLanguageRTL`, which inspects
 * `Locale.getAvailableLocales()[0]` — the first locale the phone *supports*, not
 * the one its owner chose. It is effectively always LTR. So the only way this app
 * is ever RTL is the persisted `forceRTL` flag, and JS can only write that after
 * React has already read it. Launch 1 on an Arabic phone was therefore Arabic
 * text in a left-to-right layout, every time. Measured on the emulator,
 * 2026-08-02; see OPEN_ISSUES.md.
 *
 * WHAT IT DOES. In `MainApplication.onCreate`, before `loadReactNative`, and only
 * on the first launch after install: if the phone's language is Arabic or
 * Urdu, set `forceRTL(true)`. These are the two RTL locales `initLanguage()`
 * chooses from a device language, so native and JS agree on launch one.
 *
 * After that first launch JS owns the flag again (`src/lib/language.ts` stays
 * the only JS caller of forceRTL). The marker is what stops this overriding an
 * in-app language choice on every launch.
 *
 * NOT DONE ON iOS, deliberately. iOS detects the app's language natively, but
 * only once `ar` is in CFBundleLocalizations — and then choosing English on an
 * Arabic iPhone cannot un-flip the layout without `allowRTL(false)`, which the
 * app does not do. That is a change that needs an iPhone to verify. The JS
 * notice in the root layout covers iOS launch 1 meanwhile.
 */

const { withMainApplication } = require('expo/config-plugins');

const MARKER = 'truckkoo: first-launch direction';

/** The line the seed goes after. `loadReactNative` must come later. */
const ANCHOR = 'super.onCreate()';

const SEED = `
    // ${MARKER} — plugins/with-first-launch-direction.js explains why.
    getSharedPreferences("truckkoo.direction", MODE_PRIVATE).let { prefs ->
      if (!prefs.getBoolean("seeded", false)) {
        if (java.util.Locale.getDefault().language in listOf("ar", "ur")) {
          com.facebook.react.modules.i18nmanager.I18nUtil.instance.forceRTL(this, true)
        }
        prefs.edit().putBoolean("seeded", true).commit()
      }
    }`;

/**
 * Pure, so it can be tested without a prebuild. Throws rather than skipping when
 * the template changes shape: a build that silently loses this is launch 1 in the
 * wrong direction again, and nobody would notice until a phone showed them.
 */
function addFirstLaunchDirection(src) {
  if (src.includes(MARKER)) return src;
  const at = src.indexOf(ANCHOR);
  const load = src.indexOf('loadReactNative(this)');
  if (at === -1 || load === -1 || load < at) {
    throw new Error(
      `with-first-launch-direction: MainApplication.kt no longer has "${ANCHOR}" before ` +
        '"loadReactNative(this)". The direction must be seeded before React loads — ' +
        'update the plugin for the new template rather than removing it.',
    );
  }
  const end = at + ANCHOR.length;
  return src.slice(0, end) + SEED + src.slice(end);
}

function withFirstLaunchDirection(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('with-first-launch-direction: expected a Kotlin MainApplication.');
    }
    cfg.modResults.contents = addFirstLaunchDirection(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withFirstLaunchDirection;
module.exports.addFirstLaunchDirection = addFirstLaunchDirection;
module.exports.MARKER = MARKER;
