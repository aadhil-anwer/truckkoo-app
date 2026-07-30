import { render, screen } from '@testing-library/react-native';

import { RouteRail } from '@/components/ui';
import { color, radius } from '@/theme/tokens';
import { flat } from '../helpers/style';

/**
 * The handoff calls this distinction load-bearing: origin is a RING, destination
 * is a FILLED SQUARE. It is how a user reads direction at a glance, and it is
 * precisely what a later cleanup would collapse into two identical dots.
 */
describe('RouteRail', () => {
  it('renders both endpoint names', async () => {
    await render(<RouteRail origin="Muscat" destination="Barka" />);
    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Barka')).toBeTruthy();
  });

  it('draws origin as a ring — a border, no fill', async () => {
    await render(<RouteRail origin="Muscat" destination="Barka" />);
    const style = flat(screen.getByTestId('rail-origin').props.style);
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.backgroundColor).toBeUndefined();
    // A circle: fully rounded.
    expect(style.borderRadius).toBeGreaterThanOrEqual((style.width as number) / 2);
  });

  it('draws destination as a filled accent square', async () => {
    await render(<RouteRail origin="Muscat" destination="Barka" />);
    const style = flat(screen.getByTestId('rail-destination').props.style);
    expect(style.backgroundColor).toBe(color.accent);
    // Nearly square, NOT a circle — this is the whole distinction.
    expect(style.borderRadius).toBe(radius.marker);
    expect(style.borderRadius).toBeLessThan((style.width as number) / 2);
  });

  it('exposes the route to assistive tech as one direction, not two labels', async () => {
    await render(<RouteRail origin="Muscat" destination="Barka" />);
    expect(screen.getByLabelText('Muscat to Barka')).toBeTruthy();
  });
});
