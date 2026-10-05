/**
 * The native half of launch-1 direction.
 *
 * React Native's Android RTL detection reads `Locale.getAvailableLocales()[0]`,
 * not the phone's language, so an Arabic phone's first launch was always
 * left-to-right. `plugins/with-first-launch-direction.js` seeds `forceRTL` in
 * `MainApplication.onCreate` before React loads. These guard the transform; only
 * a device run proves the result, and OPEN_ISSUES.md says whether one has.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../plugins/with-first-launch-direction');
const { addFirstLaunchDirection, MARKER } = plugin as {
  addFirstLaunchDirection: (src: string) => string;
  MARKER: string;
};

/** The shape of Expo's MainApplication.kt template, trimmed to what matters. */
const TEMPLATE = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = ReleaseLevel.STABLE
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}`;

describe('with-first-launch-direction', () => {
  const out = addFirstLaunchDirection(TEMPLATE);

  it('seeds the direction before React loads, not after', () => {
    // After loadReactNative, I18nManager's constants may already be read, and
    // launch 1 is wrong again.
    expect(out.indexOf('forceRTL(this, true)')).toBeGreaterThan(out.indexOf('super.onCreate()'));
    expect(out.indexOf('forceRTL(this, true)')).toBeLessThan(out.indexOf('loadReactNative(this)'));
  });

  it('keys on Arabic and Urdu, matching initLanguage', () => {
    expect(out).toContain('.language in listOf("ar", "ur")');
    expect(out).not.toMatch(/LAYOUT_DIRECTION_RTL|getLayoutDirectionFromLocale/);
  });

  it('only ever acts once, so it cannot override a language chosen in the app', () => {
    expect(out).toContain('getBoolean("seeded", false)');
    expect(out).toContain('putBoolean("seeded", true)');
    // Never writes forceRTL(false): an in-app Arabic choice must survive.
    expect(out).not.toContain('forceRTL(this, false)');
  });

  it('is idempotent across repeated prebuilds', () => {
    expect(addFirstLaunchDirection(out)).toBe(out);
    expect(out.split(MARKER).length - 1).toBe(1);
  });

  it('fails the build, rather than skipping, when the template changes shape', () => {
    expect(() => addFirstLaunchDirection('class MainApplication {}')).toThrow(/before React loads/);
    const reordered = 'loadReactNative(this)\nsuper.onCreate()';
    expect(() => addFirstLaunchDirection(reordered)).toThrow();
  });

  it('is registered in app.json, since an unregistered plugin is a comment', () => {
    const { expo } = require('../../app.json');
    expect(expo.plugins).toContain('./plugins/with-first-launch-direction');
  });
});
