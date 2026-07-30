import { render, screen } from '@testing-library/react-native';

import { Timeline } from '@/components/ui';
import { color } from '@/theme/tokens';
import { flat } from '../helpers/style';

const steps = [
  { label: 'Picked up', state: 'complete' as const },
  { label: 'On the way', state: 'active' as const },
  { label: 'Delivered', state: 'future' as const },
];

/**
 * A spinner collapses every wait into one appearance. The whole point of the
 * timeline is that `complete` / `active` / `future` must never look alike —
 * that is the same class of regression the route rail's origin/destination
 * test guards against (ring vs filled square there; check mark vs accent ring
 * vs dimmed nothing here).
 */
describe('Timeline', () => {
  it('renders one row per step', async () => {
    await render(<Timeline steps={steps} />);
    expect(screen.getByText('Picked up')).toBeTruthy();
    expect(screen.getByText('On the way')).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
  });

  it('shows a check mark only on the complete step', async () => {
    await render(<Timeline steps={steps} />);
    // Index 0 is complete, 1 and 2 are not — the check must appear on exactly
    // the complete row and nowhere else.
    expect(screen.getByTestId('timeline-check-0')).toBeTruthy();
    expect(screen.queryByTestId('timeline-check-1')).toBeNull();
    expect(screen.queryByTestId('timeline-check-2')).toBeNull();
  });

  it('gives the active step an accent ring and no fill, and no check', async () => {
    await render(<Timeline steps={steps} />);
    const style = flat(screen.getByTestId('timeline-mark-1').props.style);
    expect(style.borderColor).toBe(color.accent);
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.backgroundColor).toBeUndefined();
    expect(screen.queryByTestId('timeline-check-1')).toBeNull();
  });

  it('dims the future step, gives it a plain unaccented border, and no check', async () => {
    await render(<Timeline steps={steps} />);
    const style = flat(screen.getByTestId('timeline-mark-2').props.style);
    expect(style.borderColor).not.toBe(color.accent);
    expect(style.backgroundColor).toBeUndefined();
    expect(screen.queryByTestId('timeline-check-2')).toBeNull();

    const textStyle = flat(screen.getByText('Delivered').props.style);
    expect(textStyle.color).toBe('rgba(247,245,242,.47)');
    expect(textStyle.color).not.toBe(color.lightText);
  });

  it('draws a connector between steps but not after the last one', async () => {
    await render(<Timeline steps={steps} />);
    // 3 steps -> connectors after row 0 and row 1, none after row 2 (the last).
    expect(screen.getByTestId('timeline-connector-0')).toBeTruthy();
    expect(screen.getByTestId('timeline-connector-1')).toBeTruthy();
    expect(screen.queryByTestId('timeline-connector-2')).toBeNull();
  });
});
