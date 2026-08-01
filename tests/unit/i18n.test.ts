/**
 * Strings and direction.
 *
 * RTL is structural here, not a phase-2 task, so these tests guard the two
 * things that silently break it: a `textAlign: 'left'` that React Native will
 * not flip, and a hardcoded arrow that points at the wrong city in Arabic.
 *
 * The dictionary-integrity tests exist because the Arabic dictionary is
 * deliberately partial — which means a typo'd key falls back to English and
 * looks fine, forever.
 */

import { I18nManager } from 'react-native';

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
    // A screen rendering "cust.masthead" is worse than one rendering nothing.
    expect(t('cust.masthead')).not.toContain('.');
  });

  it('falls back to English for a key Arabic has not translated yet', () => {
    initLanguage('ar');
    // Visibly English rather than blank: gaps must be findable.
    expect(t('common.back')).toBe('Back');
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
    'cust.masthead',
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
    // The stepped posting flows.
    'common.next',
    'step.route',
    'step.details',
    'step.of',
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
    'date.today',
    'date.tomorrow',
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

  it('never renders a raw key for a missing Arabic value', () => {
    initLanguage('ar');
    for (const key of KEYS) {
      expect(t(key)).not.toBe(key);
    }
  });
});

describe('align — the RTL trap', () => {
  const original = I18nManager.isRTL;
  afterEach(() => {
    Object.defineProperty(I18nManager, 'isRTL', { value: original, configurable: true });
  });

  function setRTL(value: boolean) {
    Object.defineProperty(I18nManager, 'isRTL', { value, configurable: true });
  }

  it('resolves to left/right in LTR', () => {
    setRTL(false);
    expect(align.start).toBe('left');
    expect(align.end).toBe('right');
  });

  it('flips in RTL', () => {
    // React Native does NOT flip `textAlign: 'left'` the way it flips
    // flexDirection. This getter is the entire reason Arabic text lands correctly.
    setRTL(true);
    expect(align.start).toBe('right');
    expect(align.end).toBe('left');
  });

  it('is read at access time, not frozen at import', () => {
    setRTL(false);
    expect(align.start).toBe('left');
    setRTL(true);
    expect(align.start).toBe('right');
  });

  it('never returns start or end, which React Native would ignore', () => {
    for (const rtl of [true, false]) {
      setRTL(rtl);
      expect(['left', 'right']).toContain(align.start);
      expect(['left', 'right']).toContain(align.end);
    }
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
