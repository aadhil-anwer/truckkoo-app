/**
 * The icon vocabulary — every name resolves.
 *
 * The whole point of the semantic map in `icon.tsx` is that a name always
 * resolves. A missing shape renders as nothing at all, which is invisible in
 * review and obvious to a user.
 */

import { render } from '@testing-library/react-native';
import { Icon } from '@/components/icon';

const NAMES = [
  'home', 'loads', 'offers', 'routes', 'account',
  'chevron', 'back', 'forward',
  'pickup', 'dropoff', 'truck', 'pay', 'goods',
  'plus', 'check', 'checkCircle', 'close', 'search', 'phone', 'message',
  'whatsapp', 'edit', 'swap', 'backspace', 'camera', 'signOut', 'language',
  'calendar', 'clock', 'info', 'question', 'alert',
  'star', 'starOutline', 'google',
] as const;

/**
 * `toJSON()` is truthy even when a shape is missing — the `<Svg>`/`<Frame>`
 * wrapper renders regardless, with an empty `RNSVGGroup`. So `toBeTruthy()`
 * alone would pass for every name whether or not it drew anything. This walks
 * the render tree for an actual drawable primitive (path/circle/rect/...),
 * which is the only thing that proves a shape was there.
 */
function hasDrawable(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const { type, children } = node as { type?: string; children?: unknown[] };
  if (typeof type === 'string' && /^RNSVG(Path|Circle|Rect|Ellipse|Line|Polygon|Polyline)$/.test(type)) {
    return true;
  }
  return Array.isArray(children) && children.some(hasDrawable);
}

describe('the icon vocabulary', () => {
  // `render` returns a Promise in @testing-library/react-native v14 and must be
  // awaited — forgetting it does not fail loudly, it just never renders.
  it.each(NAMES)('%s resolves to a shape', async (name) => {
    const { toJSON } = await render(<Icon name={name} />);
    const tree = toJSON();
    expect(tree).toBeTruthy();
    expect(hasDrawable(tree)).toBe(true);
  });
});
