/**
 * The map scrim.
 *
 * react-native-svg discards the alpha channel of an `rgba()` passed as
 * `stopColor`: the gradient it hands to native code had every stop at
 * 0xFF0B0C0F. So every scrim was an opaque rectangle the colour of the sea, the
 * map rendered underneath it pins and all, and every map screen showed a black
 * band. Transparency has to travel in `stopOpacity`.
 *
 * Asserted on the array native code receives — `[offset, argb, offset, argb…]` —
 * because that is the only place the bug was visible.
 */
import { render, screen } from '@testing-library/react-native';

import { Scrim } from '@/map';
import { scrim } from '@/theme/tokens';

type Node = { type: string; props: Record<string, unknown>; children: Node[] | null };

function nativeGradient(): number[] {
  const find = (n: Node | null): Node | null => {
    if (!n || typeof n !== 'object') return null;
    if (n.type === 'RNSVGLinearGradient') return n;
    for (const c of n.children ?? []) {
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  const g = find(screen.toJSON() as unknown as Node);
  return g?.props.gradient as number[];
}

/** Alpha byte of each stop, 0–255. */
function alphas(gradient: number[]): number[] {
  return gradient.filter((_, i) => i % 2 === 1).map((argb) => (argb >>> 24) & 0xff);
}

describe('Scrim', () => {
  it('lets the map show through the transparent middle of topHeavy', async () => {
    await render(<Scrim variant="topHeavy" width={390} height={470} />);
    // .55, 0, 0, 1 in the tokens.
    expect(alphas(nativeGradient())).toEqual([140, 0, 0, 255]);
  });

  it.each(Object.keys(scrim) as (keyof typeof scrim)[])(
    '%s: every token alpha reaches native code',
    async (variant) => {
      await render(<Scrim variant={variant} width={390} height={470} />);
      const expected = scrim[variant].colors.map((c) => {
        const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c);
        return Math.round((m ? Number(m[1]) : 1) * 255);
      });
      expect(alphas(nativeGradient())).toEqual(expected);
    },
  );
});
