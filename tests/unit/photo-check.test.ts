import { looksBlank } from '../../src/lib/photo-check';

const twelveMp = { width: 4000, height: 3000 };

describe('looksBlank', () => {
  it('flags a black 12 MP JPEG (~60 KB)', () => {
    expect(looksBlank({ mime: 'image/jpeg', bytes: 60_000, ...twelveMp })).toBe(true);
  });

  it('passes a real 12 MP photo at quality 0.6 (~1.8 MB)', () => {
    expect(looksBlank({ mime: 'image/jpeg', bytes: 1_800_000, ...twelveMp })).toBe(false);
  });

  it('passes a dim but real photo (~400 KB)', () => {
    expect(looksBlank({ mime: 'image/jpeg', bytes: 400_000, ...twelveMp })).toBe(false);
  });

  it('never judges a PNG — a screenshot of a document is legitimately small', () => {
    expect(looksBlank({ mime: 'image/png', bytes: 20_000, ...twelveMp })).toBe(false);
  });

  it('does not reject when the picker gave no dimensions', () => {
    expect(looksBlank({ mime: 'image/jpeg', bytes: 1_000, width: 0, height: 0 })).toBe(false);
  });
});
