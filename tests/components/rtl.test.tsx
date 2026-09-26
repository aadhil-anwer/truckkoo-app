/**
 * What RTL correctness can, and cannot, be asserted.
 *
 * CAN: that no Latin digit or Latin unit reaches an Arabic string, that
 * directional icons mirror and non-directional ones do not, that the progress
 * bar carries no physical offset.
 *
 * CANNOT: that the layout is right on a device. React Native applies RTL
 * natively — flipping `flexDirection`, `marginStart`, and the whole view tree —
 * and the test renderer does not reproduce any of that. This file narrows
 * `OPEN_ISSUES` 30; it does not close it, and reading a green run here as
 * "Arabic works" is the exact mistake it is written to prevent.
 */

import { I18nManager } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { Icon } from '@/components/icon';
import { ProgressBar } from '@/components/primitives';
import { dictionaries, initLanguage } from '@/i18n';

/** Placeholder NAMES are code, not copy — `{km}` is not a Latin unit on screen. */
const withoutPlaceholders = (s: string) => s.replace(/\{\w+\}/g, '');

/**
 * The one place Latin digits belong in Arabic copy.
 *
 * The live site writes the dialling code in Latin — `واتساب ‎+968 7517 2824‎` —
 * and a phone number is dialled, not read as prose. Converting it would make the
 * placeholder disagree with what the user must actually type.
 */
const LATIN_DIGITS_ALLOWED = new Set(['auth.phone.placeholder']);

describe('Arabic copy', () => {
  it('contains no Latin digit', () => {
    // A Latin digit in Arabic copy is the most visible way the app looks
    // half-translated, and it is invisible to anyone reading the English.
    const bad = Object.entries(dictionaries.ar)
      .filter(([k, v]) => v && !LATIN_DIGITS_ALLOWED.has(k) && /[0-9]/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('contains no Latin unit', () => {
    const bad = Object.entries(dictionaries.ar)
      .filter(([, v]) => v && /\b(km|kg|OMR)\b/.test(withoutPlaceholders(v)))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('leaves no key rendering its English while the language is Arabic', () => {
    const untranslated = Object.entries(dictionaries.en)
      .filter(([k, en]) => {
        const ar = dictionaries.ar[k as keyof typeof dictionaries.en];
        // Identical values are legitimate for addresses and proper nouns — and
        // for a string that is only placeholders and punctuation, whose `{date}`
        // is a variable name, never rendered.
        return ar === en && /[a-z]{4}/i.test(withoutPlaceholders(en)) && !en.includes('@');
      })
      .map(([k]) => k);
    expect(untranslated).toEqual([]);
  });
});

describe('under forced RTL', () => {
  const original = I18nManager.isRTL;

  function setRTL(value: boolean) {
    Object.defineProperty(I18nManager, 'isRTL', { value, configurable: true });
  }

  afterEach(() => {
    setRTL(original);
    initLanguage('en');
  });

  it('mirrors the back chevron', async () => {
    setRTL(false);
    await render(<Icon name="back" />);
    const ltr = JSON.stringify(screen.toJSON());

    setRTL(true);
    await render(<Icon name="back" />);
    const rtl = JSON.stringify(screen.toJSON());

    expect(rtl).not.toBe(ltr);
  });

  it('does not mirror a non-directional icon', async () => {
    // If everything flipped, nothing would be being decided — and the test above
    // would pass on a bug that mirrored the whole set.
    setRTL(false);
    await render(<Icon name="truck" />);
    const ltr = JSON.stringify(screen.toJSON());

    setRTL(true);
    await render(<Icon name="truck" />);
    const rtl = JSON.stringify(screen.toJSON());

    expect(rtl).toBe(ltr);
  });

  it('fills the progress bar with a width, never a physical offset', async () => {
    setRTL(true);
    await render(<ProgressBar step={3} total={6} />);
    const style = Object.assign(
      {},
      ...[screen.getByTestId('progress-fill').props.style].flat().filter(Boolean),
    );
    // A `left` here is a bug in Arabic even when the width is right: the fill
    // has to originate at the leading edge, which RTL moves.
    expect(style.left).toBeUndefined();
    expect(style.right).toBeUndefined();
    expect(style.width).toBe('50%');
  });
});
