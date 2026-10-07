/**
 * Strings and direction.
 *
 * RTL is structural here, not a phase-2 task, so these tests guard what silently
 * breaks it. One of them used to be stated backwards: React Native DOES mirror
 * `textAlign` under RTL, so `align` names a physical edge and stays constant —
 * see the `align` block below for the evidence and what it cost.
 *
 * The dictionary-integrity tests exist because a typo'd key falls back to
 * English and looks fine, forever. Since P7 they also assert completeness: every
 * English key has an Arabic value, and every placeholder survives translation.
 */

import { I18nManager, StyleSheet } from 'react-native';

import {
  align,
  dictionaries,
  directionArrow,
  formatNumber,
  initLanguage,
  interpolate,
  localized,
  t,
} from '@/i18n';

describe('t', () => {
  beforeEach(() => initLanguage('en'));

  it('returns the English string', () => {
    expect(t('app.name')).toBe('Truckkoo');
  });

  it('never returns the key itself', () => {
    // A screen rendering "tab.home" is worse than one rendering nothing.
    expect(t('tab.home')).not.toContain('.');
  });

  it('falls back to English rather than rendering blank when Arabic is missing', () => {
    initLanguage('ar');
    // Every key has Arabic as of P7, so the gap is constructed rather than
    // found. The behaviour still matters: the next key someone adds will have no
    // Arabic for a while, and it must look unfinished rather than broken.
    const key = 'app.name' as const;
    const saved = dictionaries.ar[key];
    delete dictionaries.ar[key];
    expect(t(key)).toBe(dictionaries.en[key]);
    dictionaries.ar[key] = saved;
  });

  it('uses Arabic where Arabic exists', () => {
    initLanguage('ar');
    expect(t('app.name')).toBe('تركو');
  });
});

describe('dictionary integrity', () => {
  // Pulled through the public API so the test cannot drift from what ships.
  const KEYS = [
    'app.name',
    'driver.masthead',
    // The bottom tab bar. These replaced the `book.tab.*` keys when the
    // in-page tab strip was retired for a real tab bar.
    'tab.home',
    'tab.loads',
    'tab.offers',
    'tab.routes',
    'tab.account',
    // The shipper's one question, and the account screen behind the tab.
    'home.entry',
    'home.entry.hint',
    'home.live',
    'home.again',
    'loads.seg.live',
    'loads.seg.past',
    'account.title',
    'account.role.shipper',
    'account.role.driver',
    // The driver's declared-route screens.
    'driver.routes.title',
    'driver.routes.none.title',
    'driver.routes.none.explain',
    'driver.offer.sheet',
    'cust.record.title',
    'cust.finding.explain',
    'leg.stamp.empty',
    'leg.stamp.part',
    'label.replyBy',
    'auth.confirm.title',
    'auth.reset.title',
    'auth.forgot',
  ] as const;

  it('has a non-empty English string for every key the new screens use', () => {
    initLanguage('en');
    for (const key of KEYS) {
      const value = t(key);
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps stamp labels short enough to sit in a pill beside a route', () => {
    // Regression: "Empty — I can take a load" as a stamp squashed the route row.
    initLanguage('en');
    expect(t('leg.stamp.empty').length).toBeLessThanOrEqual(12);
    expect(t('leg.stamp.part').length).toBeLessThanOrEqual(12);
  });

  it('every English key has an Arabic value', () => {
    // P7's completeness claim, and the thing that stops the next phase quietly
    // shipping an English string inside an Arabic screen.
    const missing = Object.keys(dictionaries.en).filter(
      (k) => !dictionaries.ar[k as keyof typeof dictionaries.en],
    );
    expect(missing).toEqual([]);
  });

  it('every English key has a non-empty Urdu value with the same placeholders', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, english] of Object.entries(dictionaries.en)) {
      const urdu = dictionaries.ur[key as keyof typeof dictionaries.en];
      expect(urdu?.trim()).toBeTruthy();
      expect(placeholders(urdu ?? '')).toEqual(placeholders(english));
    }
    initLanguage('ur');
    expect(t('book.origin.q')).toBe('سامان ابھی کہاں ہے؟');
  });

  it('never renders a raw key for a missing Arabic value', () => {
    initLanguage('ar');
    for (const key of KEYS) {
      expect(t(key)).not.toBe(key);
    }
  });
});

describe('align — and why it is not a getter', () => {
  /**
   * These used to assert the opposite, and the app shipped with every label on
   * the wrong edge in Arabic because of it. React Native mirrors `textAlign`
   * itself, on both platforms — Android in TextAttributeProps.kt, iOS in
   * RCTTextAttributes.mm — so naming the physical edge is the correct and
   * complete instruction. Reading `isRTL` here double-flips it.
   */
  const original = I18nManager.isRTL;
  afterEach(() => {
    Object.defineProperty(I18nManager, 'isRTL', { value: original, configurable: true });
  });

  function setRTL(value: boolean) {
    Object.defineProperty(I18nManager, 'isRTL', { value, configurable: true });
  }

  it('names the physical edge and lets React Native mirror it', () => {
    expect(align.start).toBe('left');
    expect(align.end).toBe('right');
  });

  it('does not change with the layout direction', () => {
    // The regression this file exists to prevent: making these direction-aware
    // again would re-introduce the double flip.
    setRTL(true);
    expect(align.start).toBe('left');
    expect(align.end).toBe('right');
    setRTL(false);
    expect(align.start).toBe('left');
    expect(align.end).toBe('right');
  });

  it('survives being frozen into a StyleSheet at module scope', () => {
    // 26 files do `StyleSheet.create({ x: { textAlign: align.start } })` at
    // import time. A getter captured there goes stale; a constant cannot.
    const frozen = StyleSheet.create({ label: { textAlign: align.start } });
    setRTL(true);
    expect(StyleSheet.flatten(frozen.label).textAlign).toBe(align.start);
  });

  it('never returns start or end, which React Native would ignore', () => {
    expect(['left', 'right']).toContain(align.start);
    expect(['left', 'right']).toContain(align.end);
  });
});

describe('directionArrow', () => {
  const original = I18nManager.isRTL;
  afterEach(() => {
    Object.defineProperty(I18nManager, 'isRTL', { value: original, configurable: true });
  });

  it('points at the destination in each direction', () => {
    Object.defineProperty(I18nManager, 'isRTL', { value: false, configurable: true });
    expect(directionArrow()).toBe('→');
    Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
    expect(directionArrow()).toBe('←');
  });
});

describe('localized', () => {
  const city = { name_en: 'Muscat', name_ar: 'مسقط' };

  it('picks the field for the active language', () => {
    initLanguage('en');
    expect(localized(city)).toBe('Muscat');
    initLanguage('ar');
    expect(localized(city)).toBe('مسقط');
  });
});

describe('formatNumber', () => {
  it('uses Western digits in English', () => {
    initLanguage('en');
    expect(formatNumber(40)).toBe('40');
  });

  it('uses Eastern-Arabic digits in Arabic, matching the website', () => {
    initLanguage('ar');
    // The site renders ٤٠ طن; PRODUCT.md records this as the chosen convention.
    expect(formatNumber(40)).not.toBe('40');
    expect(formatNumber(40)).toMatch(/[٠-٩]/);
  });
});

describe('interpolation', () => {
  beforeEach(() => initLanguage('en'));

  it('leaves a string with no placeholders untouched', () => {
    expect(t('app.name')).toBe('Truckkoo');
  });

  it('substitutes every occurrence of a placeholder', () => {
    expect(interpolate('{a} and {a} and {b}', { a: '1', b: '2' })).toBe('1 and 1 and 2');
  });

  it('leaves an unknown placeholder in place rather than printing undefined', () => {
    // A visible `{oops}` is findable. The string "undefined" is not.
    expect(interpolate('x {oops} y', { a: '1' })).toBe('x {oops} y');
  });

  it('stringifies a number param', () => {
    expect(interpolate('{n} km', { n: 12 })).toBe('12 km');
  });
});

describe('dictionary export', () => {
  it('exposes both dictionaries for the integrity tests', () => {
    expect(Object.keys(dictionaries.en).length).toBeGreaterThan(300);
    expect(dictionaries.ar).toBeDefined();
  });
});

describe('placeholder parity', () => {
  const markers = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

  it('every Arabic string carries exactly the placeholders its English does', () => {
    // A translated string that drops {km} silently loses the number. Nothing
    // else in the suite would notice, because the sentence still reads.
    const wrong: string[] = [];
    for (const [key, arValue] of Object.entries(dictionaries.ar)) {
      if (!arValue) continue;
      const enValue = dictionaries.en[key as keyof typeof dictionaries.en];
      const a = markers(enValue);
      const b = markers(arValue);
      if (a.size !== b.size || [...a].some((m) => !b.has(m))) {
        wrong.push(`${key}: en{${[...a]}} ar{${[...b]}}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no dictionary value contains an unclosed marker', () => {
    // `{km` renders literally and reads as a typo nobody catches in Arabic.
    const bad = Object.entries({ ...dictionaries.en, ...dictionaries.ar })
      .filter(([, v]) => v && /\{[^}]*$/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('composed shared copy', () => {
  beforeEach(() => initLanguage('en'));

  it('carries both cities in one route label', () => {
    expect(t('route.aria', { origin: 'Muscat', destination: 'Barka' })).toBe('Muscat to Barka');
  });

  it('carries the distance and its unit in one string', () => {
    expect(t('book.aboutKm', { km: '73' })).toBe('about 73 km');
  });

  it('carries the weight and its unit in one string', () => {
    expect(t('book.weight.value', { weight: '8,000' })).toBe('8,000 kg');
  });

  it('carries the name in the greeting', () => {
    expect(t('home.greetingNamed', { name: 'Nasser' })).toBe('Hello, Nasser');
  });
});
