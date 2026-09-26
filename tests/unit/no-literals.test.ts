/**
 * Rules that cannot be enforced by a type and are invisible until someone runs
 * the app in Arabic.
 *
 * A grep is a poor test in general and the right one here: these are lexical
 * rules about source text, and the failures they prevent — a Latin "km" sitting
 * in Arabic copy, a margin that does not flip, an arrow pointing at the wrong
 * city — cost a release to find any other way.
 *
 * Two exemptions, both named in CLAUDE.md, and they are the complete set:
 *
 *   src/map    SVG coordinates are the one place logical properties do NOT
 *              apply. A projected x is a position on the peninsula, not a
 *              reading direction — the Gulf does not move to the other side of
 *              the screen in Arabic.
 *   legacy.tsx transitional, shrinking, and nothing new may import it.
 *
 * Adding a third exemption to make a hit disappear is the failure mode this
 * file exists to prevent.
 */

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/app', 'src/components', 'src/map'];

function sources(): string[] {
  return ROOTS.flatMap((r) =>
    globSync('**/*.{ts,tsx}', { cwd: r }).map((f) => join(r, f)),
  ).filter((f) => !f.endsWith('legacy.tsx'));
}

/** Strip comments, so a rule written *about* the rule is not a hit. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('direction literals', () => {
  it('no physical left/right style property', () => {
    const hits = sources()
      .filter((f) => !f.startsWith('src/map'))
      .filter((f) => /(^|[\s{])(left|right):\s/m.test(code(f)));
    expect(hits).toEqual([]);
  });

  it("no textAlign: 'left' or 'right'", () => {
    // NOT because a literal is wrong — React Native mirrors textAlign under RTL,
    // so `textAlign: 'left'` is in fact what `align.start` now resolves to. The
    // ban is about intent: a call site should say which edge of the READING
    // order it means and let one place decide what that is, so the next person
    // who has to change it changes it once.
    const hits = sources().filter((f) => /textAlign:\s*'(left|right)'/.test(code(f)));
    expect(hits).toEqual([]);
  });

  it('no hardcoded direction arrow outside directionArrow()', () => {
    const hits = sources().filter((f) => /['"`][^'"`]*[→←][^'"`]*['"`]/.test(code(f)));
    expect(hits).toEqual([]);
  });
});

describe('units', () => {
  it('no unit appears as a template literal outside a dictionary string', () => {
    // `${n} km` renders a Latin "km" in Arabic copy. The unit belongs inside the
    // string, where the translator can move or replace it.
    const hits = sources().filter((f) => /\}\s*(km|kg|OMR)\b/.test(code(f)));
    expect(hits).toEqual([]);
  });
});
