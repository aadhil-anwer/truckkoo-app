/**
 * The drawn map (src/map) is the product's map. ONE screen — the pin on the
 * gate — needs streets and panning, and it alone may import react-native-maps.
 * A second importer is a design decision, not a convenience: change this list
 * only with CLAUDE.md.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ALLOWED = ['src/components/booking/PinAdjustMap.tsx'];

it('lets exactly one file import react-native-maps', () => {
  const root = join(__dirname, '..', '..');
  const files = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => `src/${f.split('\\').join('/')}`);
  const importers = files.filter((f) => /from ['"]react-native-maps['"]/.test(readFileSync(join(root, f), 'utf8')));
  expect(importers).toEqual(ALLOWED);
});
