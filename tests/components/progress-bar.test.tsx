import { I18nManager } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ProgressBar, StepHeader } from '@/components/primitives';
import { initLanguage } from '@/i18n';
import { flat } from '../helpers/style';

/**
 * The progress fill must grow from the LEADING edge — left in English, right in
 * Arabic. Implemented with logical properties so direction handles it, which
 * means the assertion is that no physical edge is ever named.
 */
describe('ProgressBar', () => {
  afterEach(() => {
    I18nManager.isRTL = false;
  });

  it('fills proportionally to the step', async () => {
    await render(<ProgressBar step={3} total={6} />);
    expect(flat(screen.getByTestId('progress-fill').props.style).width).toBe('50%');
  });

  it('is full at the last step', async () => {
    await render(<ProgressBar step={6} total={6} />);
    expect(flat(screen.getByTestId('progress-fill').props.style).width).toBe('100%');
  });

  it('never names a physical edge, so direction flips it for free', async () => {
    await render(<ProgressBar step={2} total={6} />);
    const style = flat(screen.getByTestId('progress-track').props.style);
    expect(style.alignItems).toBeUndefined();
    expect(Object.keys(style)).not.toContain('left');
    expect(Object.keys(style)).not.toContain('right');
    expect(Object.keys(style)).not.toContain('flexDirection');
  });

  it('announces progress to assistive tech rather than drawing it only', async () => {
    await render(<ProgressBar step={3} total={6} />);
    const node = screen.getByRole('progressbar');
    expect(node.props.accessibilityValue).toEqual({ min: 0, max: 6, now: 3 });
  });
});

/**
 * The step counter is composed in JavaScript (`${step} / ${total}`), not
 * produced by `Intl` — so `localizeDigits` is the only possible source of
 * Arabic-Indic digits in its output. Unlike an `Intl`-backed formatter (where
 * Node's full ICU can emit Arabic-Indic even with the wrapper stripped out),
 * this assertion is load-bearing: it can only pass if `StepHeader` actually
 * calls `localizeDigits`.
 */
describe('StepHeader digit localisation', () => {
  afterEach(() => {
    initLanguage('en');
  });

  it('renders Eastern Arabic-Indic digits in the step counter when the language is Arabic', async () => {
    initLanguage('ar');
    await render(<StepHeader step={3} total={6} onBack={jest.fn()} />);
    expect(screen.getByText('٣ / ٦')).toBeTruthy();
  });
});
