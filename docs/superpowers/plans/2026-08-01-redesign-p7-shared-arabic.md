# P7 · Shared + Arabic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two shared screens the redesign left on the old vocabulary (X1 loads list, X2 account), give `t()` typed interpolation so Arabic owns its own word order, make language choosable, complete the Arabic dictionary, and leave behind a regression net plus a proof-sheet an Arabic reader can review.

**Architecture:** Four movements, in order. (1) `t()` gains typed placeholders and every composed sentence collapses into one key per language. (2) Language becomes persisted and switchable, with `forceRTL` applied at boot and a reload on change. (3) X1 and X2 are built on the new design system, retiring `load-card.tsx`. (4) The dictionary is completed and the audit tooling is built on top of the finished vocabulary. Each movement depends on the one before it: the screens are written against the final `t()`, and the audit asserts against the finished dictionary.

**Tech Stack:** React Native / Expo (managed), TypeScript, expo-router, jest + jest-expo + @testing-library/react-native, expo-secure-store, expo-updates (new), react-native-svg.

**Spec:** `docs/superpowers/specs/2026-08-01-redesign-p7-shared-arabic-design.md`

## Global Constraints

These come from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **No backend.** No migration, no RPC, no policy change. `supabase/migrations/` is untouched. `npm run test:db` is run once at the end only to confirm it is unaffected.
- **Logical properties only.** `marginStart`, `paddingEnd`, `start`/`end`. **Never `left`/`right`.** React Native does not flip `textAlign: 'left'` under RTL — use `align.start` from `@/components/text-direction`.
- **Every user-facing string goes through `t()`.** No literal in a screen, and no unit (`km`, `kg`, `OMR`) as a template literal outside a string.
- **Every type token names a `fontFamily`; none sets `fontWeight`.** Use `font.*` from `@/theme/tokens` through `arabicIfNeeded`.
- **One accent (`#F1551F`) per screen** — the pinned primary action *or* the live state, never both. `#F1551F` is never text.
- **`color.delivered` (`#79E0AF`) appears exactly once in the product**, on T5. Neither X1 nor X2 may use it.
- **Instrument Serif is reserved** for questions and hero numbers, reached only through `QuestionHeading`. X1 and X2 are ink working screens and carry **no** serif.
- **Never fabricate proof.** X2 shows only what `profiles` holds: `full_name`, `phone`, `role`. No tier, rating, loads-completed, or member-since. The handoff's `+968 9123 4567` and `10-ton` are gallery placeholders.
- **Never machine-translate Arabic.** Arabic is lifted verbatim from `~/truckkoo` or the handoff's X3/X4 copy, or assembled from fragments already in the dictionary. Anything else is drafted and **marked unproofed in-file**.
- **Every numeral goes through `formatNumber`** (or `localizeDigits` at an output boundary), so Arabic renders Eastern Arabic-Indic digits.
- **Every tap target ≥44pt** (`MIN_TARGET` in tokens).
- Package manager is **npm**. Never eject from the managed workflow.
- Verify with `npm run verify` (typecheck + lint + tests). It is green at 447 tests before this plan starts.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/language.ts` | Reading, writing and applying the language preference. Owns SecureStore access, the `forceRTL` decision, and the reload. Nothing else touches `I18nManager.forceRTL`. |
| `tests/unit/language.test.ts` | The preference round-trip, the reload decision, and the no-reload-loop guard. |
| `tests/components/loads-screen.test.tsx` | X1. |
| `tests/components/account-screen.test.tsx` | X2. |
| `tests/components/rtl.test.tsx` | The forced-RTL regression net across every screen. |
| `tests/unit/no-literals.test.ts` | Static grep: `left:`/`right:`/`textAlign: 'left'`, bare arrows, bare units. |
| `scripts/rtl-proof.tsx` | The proof-sheet generator, run through jest. Not a `.test.tsx` — it is invoked explicitly. |

**Modified:**

| File | Change |
|---|---|
| `src/i18n/index.ts` | `t()` gains typed interpolation; `dictionaries` exported for the integrity tests and the proof-sheet; ~207 Arabic values added; composed keys restructured. |
| `src/components/ui.tsx` | Gains `Segmented`, `DetailGroup`, `DetailRow`. |
| `src/app/_layout.tsx` | Boots the language preference before first render. |
| `src/app/(app)/(tabs)/loads.tsx` | Rebuilt as X1. |
| `src/app/(app)/(tabs)/account.tsx` | Rebuilt as X2. |
| `src/components/driver/OfferCard.tsx`, `driver/Money.tsx`, `src/app/(app)/offer/[id].tsx`, `(tabs)/driver.tsx`, `(tabs)/routes.tsx` | Composition sites → interpolated keys. |
| `src/app/(app)/(tabs)/customer.tsx`, `load/[id].tsx`, `trip/[id].tsx`, `book/destination.tsx`, `book/origin.tsx`, `book/review.tsx`, `src/components/ui.tsx` | Composition sites → interpolated keys. |
| `tests/unit/i18n.test.ts` | The English-fallback test changes meaning once the dictionary is complete. |
| `package.json` | `expo-updates` dependency; `preview:rtl` script. |
| `OPEN_ISSUES.md`, `NEXT.md` | Close-out. |

**Deleted:** `src/components/load-card.tsx` (Task 8), `NEXT.md` (Task 13).

---

### Task 1: Typed interpolation in `t()`

The mechanism every later task depends on. No call site changes yet — this task adds the capability and proves it, leaving the app compiling exactly as before.

**Files:**
- Modify: `src/i18n/index.ts` (the `t` function at :751, plus a new type block above it and an export of `dictionaries`)
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `t<K extends StringKey>(key: K, ...args: ParamsFor<K>): string` — params required iff the English value contains `{name}` placeholders.
  - `export const dictionaries: { en: typeof en; ar: Partial<Record<StringKey, string>> }` — exported so the integrity tests and the proof-sheet can enumerate keys without duplicating them.
  - `export type StringKey` (unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/i18n.test.ts`:

```ts
describe('interpolation', () => {
  beforeEach(() => initLanguage('en'));

  it('substitutes a named placeholder', () => {
    // `drv.offer.detour` becomes an interpolated key in Task 2. Until then this
    // asserts the mechanism on a key that already exists.
    expect(t('route.ariaTo')).toBe('to');
  });

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
```

Add `dictionaries` and `interpolate` to the existing import at the top of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/i18n.test.ts -t interpolation`
Expected: FAIL — `interpolate` and `dictionaries` are not exported.

- [ ] **Step 3: Implement the types and the substitution**

In `src/i18n/index.ts`, replace the existing `t` (at :751) and its doc comment with:

```ts
/**
 * Placeholder names inside a dictionary value, at the type level.
 *
 * `en` is `as const`, so each value is a literal type and its `{name}` markers
 * are readable by the compiler. That makes a missing or misspelt param a
 * typecheck failure rather than a `{km}` rendered on a driver's screen.
 */
type Placeholders<S extends string> = S extends `${string}{${infer K}}${infer Rest}`
  ? K | Placeholders<Rest>
  : never;

/**
 * The params argument for a key: absent when the string has no placeholders,
 * required and exhaustive when it has any.
 *
 * `[X] extends [never]` rather than `X extends never` — the bare form is a
 * distributive conditional and collapses to `never` for every key.
 */
type ParamsFor<K extends StringKey> = [Placeholders<(typeof en)[K]>] extends [never]
  ? []
  : [params: Record<Placeholders<(typeof en)[K]>, string | number>];

/**
 * Substitute `{name}` markers.
 *
 * An unknown marker is left visible rather than replaced with "undefined": a
 * literal `{oops}` on screen is a bug someone reports, and "undefined" is a bug
 * someone assumes is data.
 */
export function interpolate(raw: string, params: Record<string, string | number>): string {
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Look up a string. Falls back to English rather than rendering a key or a
 * blank — a missing translation should look unfinished, not broken.
 *
 * Values are NOT formatted here. A number is stringified by the caller through
 * `formatNumber`, so `t()` stays a lookup and a substitution with no opinion
 * about numerals — which is what keeps it swappable for i18next later.
 */
export function t<K extends StringKey>(key: K, ...args: ParamsFor<K>): string {
  const raw: string = dictionaries[current][key] ?? en[key];
  const params = args[0] as Record<string, string | number> | undefined;
  return params ? interpolate(raw, params) : raw;
}
```

Then export the dictionary object. Find the existing `const dictionaries = { en, ar };` declaration and change it to:

```ts
/**
 * Exported for `tests/unit/i18n.test.ts` and `scripts/rtl-proof.tsx`, both of
 * which must enumerate every key. Exporting beats duplicating the key list in a
 * test, which is how a test drifts from what ships.
 */
export const dictionaries = { en, ar };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/i18n.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Confirm nothing else broke**

Run: `npm run verify`
Expected: typecheck, lint and all 447+ tests green. No call site changed, so nothing should move.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/index.ts tests/unit/i18n.test.ts
git commit -m "Let a string own its own word order"
```

---

### Task 2: Placeholder parity, asserted

Before any key is restructured, the guard that makes restructuring safe: a translated string that drops `{km}` silently loses the number, and nothing today would notice.

**Files:**
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `dictionaries`, `interpolate` from Task 1.
- Produces: nothing consumed by later tasks; it is a standing assertion that Tasks 3, 4 and 10 must keep green.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/i18n.test.ts`:

```ts
describe('placeholder parity', () => {
  const markers = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

  it('every Arabic string carries exactly the placeholders its English does', () => {
    const wrong: string[] = [];
    for (const [key, arValue] of Object.entries(dictionaries.ar)) {
      if (!arValue) continue;
      const enValue = dictionaries.en[key as keyof typeof dictionaries.en];
      const a = markers(enValue);
      const b = markers(arValue);
      if (a.size !== b.size || [...a].some((m) => !b.has(m))) {
        wrong.push(`${key}: en{${[...a]}} ar{${[...b]}}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no dictionary value contains an unclosed marker', () => {
    // `{km` renders literally and reads as a typo nobody catches in Arabic.
    const bad = Object.entries({ ...dictionaries.en, ...dictionaries.ar })
      .filter(([, v]) => v && /\{[^}]*$/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/unit/i18n.test.ts -t "placeholder parity"`
Expected: PASS immediately — no key has placeholders yet, so both loops find nothing. That is correct: this test is a trap set for Tasks 3, 4 and 10, not a description of a bug that exists now.

- [ ] **Step 3: Prove the trap works**

Temporarily add to the `ar` dictionary: `'app.name': 'تركو {x}',`
Run: `npx jest tests/unit/i18n.test.ts -t "placeholder parity"`
Expected: FAIL, listing `app.name: en{} ar{x}`.
Then **revert that line** and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/i18n.test.ts
git commit -m "Catch a translation that drops the number"
```

---

### Task 3: The driver surface stops composing sentences

Five files. `OfferCard`'s detour line is the worked example named in `OPEN_ISSUES` 30: four fragments and a bare Latin `km`, which is correct English and merely plausible Arabic.

**Files:**
- Modify: `src/i18n/index.ts`, `src/components/driver/OfferCard.tsx:57,65,84,97`, `src/components/driver/Money.tsx:57,66`, `src/app/(app)/offer/[id].tsx:189,206,213`, `src/app/(app)/(tabs)/driver.tsx:149`, `src/app/(app)/(tabs)/routes.tsx:128`
- Test: `tests/components/driver-money.test.tsx`, `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `t(key, params)` from Task 1.
- Produces: these keys, used by no later task but asserted by Task 11's suite:
  - `drv.offer.detour` → `'about {km} km extra on your route'`
  - `drv.offer.expires` → `'Expires {when}'`
  - `drv.offer.take` → `'Take it — {amount}'` and `drv.offer.take.bare` → `'Take it'`
  - `drv.offer.freeAfter` → `'{weight} free after this load'`
  - `drv.money.keepAria` → `'You keep {amount}'`
  - `drv.money.split` → `'Collect from the shipper {collect} · To Truckkoo {owed}'`
  - `drv.home.week` → `'{amount} this week'`
- **Removed:** `drv.offer.about` (absorbed into `drv.offer.detour`), and the standalone `drv.money.collect` / `drv.money.owe` keys keep existing for the labels in `Money.tsx`'s hero layout but stop being concatenated.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/driver-money.test.tsx`:

```tsx
import { initLanguage, t } from '@/i18n';

describe('composed driver copy', () => {
  afterEach(() => initLanguage('en'));

  it('puts the detour distance and its unit inside one string', () => {
    initLanguage('en');
    expect(t('drv.offer.detour', { km: '12' })).toBe('about 12 km extra on your route');
  });

  it('lets Arabic place the unit itself', () => {
    initLanguage('ar');
    const s = t('drv.offer.detour', { km: '١٢' });
    expect(s).toContain('١٢');
    // The Latin unit must not survive into Arabic copy.
    expect(s).not.toContain('km');
    expect(s).toContain('كم');
  });

  it('carries the amount inside the take label', () => {
    initLanguage('en');
    expect(t('drv.offer.take', { amount: 'OMR 42.500' })).toBe('Take it — OMR 42.500');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/components/driver-money.test.tsx -t "composed driver copy"`
Expected: FAIL — `t('drv.offer.detour', {...})` is a typecheck error and returns the un-substituted fragment.

- [ ] **Step 3: Restructure the keys**

In `src/i18n/index.ts`, in the `en` block, **delete** `'drv.offer.about': 'about',` and change:

```ts
  'drv.offer.detour': 'about {km} km extra on your route',
  'drv.offer.expires': 'Expires {when}',
  'drv.offer.take': 'Take it — {amount}',
  'drv.offer.take.bare': 'Take it',
  'drv.offer.freeAfter': '{weight} free after this load',
  'drv.money.keepAria': 'You keep {amount}',
  'drv.money.split': 'Collect from the shipper {collect} · To Truckkoo {owed}',
  'drv.home.week': '{amount} this week',
```

In the `ar` block, **delete** `'drv.offer.about': 'حوالي',` and change:

```ts
  // Assembled from the fragments already in this file, in Arabic order, with
  // the unit translated. No new words: `حوالي` and `إضافية على مسارك` are the
  // website's own. FLAG FOR PROOFING — assembling is still a translation act.
  'drv.offer.detour': 'حوالي {km} كم إضافية على مسارك',
  'drv.offer.freeAfter': '{weight} متبقية بعد هذه الشحنة',
```

Leave the remaining new keys' Arabic to Task 10, which completes the dictionary in one pass.

- [ ] **Step 4: Update the five call sites**

`src/components/driver/OfferCard.tsx` — replace line 57:

```tsx
  const takeLabel = amount
    ? t('drv.offer.take', { amount })
    : t('drv.offer.take.bare');
```

Replace the expiry `Text` at line 65:

```tsx
        <Text style={styles.expiry}>
          {t('drv.offer.expires', { when: formatDeadline(offer.expires_at) })}
        </Text>
```

Replace the detour `Text` at line 84:

```tsx
            <Text style={styles.detourText}>
              {t('drv.offer.detour', { km: formatNumber(Math.round(offer.detour_km)) })}
            </Text>
```

Replace the free-after `Chip` at line 97:

```tsx
          <Chip label={t('drv.offer.freeAfter', { weight: formatWeight(offer.free_after_kg, '') })} />
```

`src/components/driver/Money.tsx` — replace line 57 and line 66:

```tsx
          accessibilityLabel={t('drv.money.keepAria', { amount: `${keep} ${currency}` })}
```

```tsx
          {t('drv.money.split', { collect: `${take} ${currency}`, owed: `${remit} ${currency}` })}
```

`src/app/(app)/offer/[id].tsx` — line 189, 206, 213:

```tsx
                value={t('drv.offer.detour', { km: formatNumber(Math.round(data.detour_km)) })}
```

```tsx
              {t('drv.offer.freeAfter', { weight: formatWeight(data.free_after_kg, '') })}
```

```tsx
            label={amount ? t('drv.offer.take', { amount }) : t('drv.offer.take.bare')}
```

`src/app/(app)/(tabs)/driver.tsx` — line 149:

```tsx
            {t('drv.home.week', { amount: formatMoney(week.week_baisa, 'OMR') })}
```

`src/app/(app)/(tabs)/routes.tsx` — line 128:

```tsx
                {t('drv.offer.freeAfter', { weight: formatWeight(leg.free_kg, '') })}
```

Note the detour value at `offer/[id].tsx:189` previously showed only `about {km} km` without the trailing clause. It now reads the full sentence — the same string the card uses. That is the point: one sentence, one key.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/components/driver-money.test.tsx tests/components/detour-spur.test.tsx tests/unit/i18n.test.ts`
Expected: PASS. Placeholder parity from Task 2 still green.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

```bash
git add src/i18n/index.ts src/components/driver src/app/\(app\)/offer src/app/\(app\)/\(tabs\)/driver.tsx src/app/\(app\)/\(tabs\)/routes.tsx tests/components/driver-money.test.tsx
git commit -m "Let the driver's sentences be sentences, not four fragments"
```

---

### Task 4: The shipper and shared surfaces stop composing sentences

The same change across the remaining ~20 sites, including the accessibility labels — a screen reader hears the same broken word order a sighted user reads.

**Files:**
- Modify: `src/i18n/index.ts`, `src/components/ui.tsx:227`, `src/app/(app)/(tabs)/customer.tsx:144,164,178,217,267`, `src/app/(app)/(tabs)/offers.tsx:105`, `src/app/(app)/(tabs)/routes.tsx:89`, `src/app/(app)/load/[id].tsx:144,427,459,505,564,617,720`, `src/app/(app)/trip/[id].tsx:312`, `src/app/(app)/book/destination.tsx:113`, `src/app/(app)/book/origin.tsx:69`, `src/app/(app)/book/review.tsx:116,148`
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `t(key, params)` from Task 1.
- Produces:
  - `route.aria` → `'{origin} to {destination}'`
  - `home.greetingNamed` → `'Good morning, {name}'`
  - `common.error.aria` → `'Something went wrong. Try again'`
  - `book.aboutKm` → `'about {km} km'`
  - `book.origin.ctaNamed` → `'Pick up here — {city}'`
  - `book.weight.value` → `'{weight} kg'`
  - `price.heldUntil` → `'Held until {when}'`
  - `track.price.acceptNamed` → `'Accept {amount}'`
  - `track.assigned.takingNamed` → `'{name} is taking it'`
  - `track.tripsCount` → `'{count} trips'`
  - `pos.seenAgo` → `'Seen {age}'`
  - `pos.lastSentAgo` → `'Last sent {age}'`
  - `track.rate.starAria` → `'{n} stars'`
  - `label.referenceNamed` → `'Reference {ref}'`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/i18n.test.ts`:

```ts
describe('composed shared copy', () => {
  beforeEach(() => initLanguage('en'));

  it('carries both cities in one route label', () => {
    expect(t('route.aria', { origin: 'Muscat', destination: 'Barka' })).toBe('Muscat to Barka');
  });

  it('carries the distance and its unit in one string', () => {
    expect(t('book.aboutKm', { km: '73' })).toBe('about 73 km');
  });

  it('carries the weight and its unit in one string', () => {
    expect(t('book.weight.value', { weight: '8,000' })).toBe('8,000 kg');
  });

  it('carries the name in the greeting', () => {
    expect(t('home.greetingNamed', { name: 'Nasser' })).toBe('Good morning, Nasser');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/i18n.test.ts -t "composed shared copy"`
Expected: FAIL — none of these keys exist.

- [ ] **Step 3: Add the keys**

In the `en` block of `src/i18n/index.ts`, add:

```ts
  'route.aria': '{origin} to {destination}',
  'home.greetingNamed': 'Good morning, {name}',
  'common.error.aria': 'Something went wrong. Try again',
  'book.aboutKm': 'about {km} km',
  'book.origin.ctaNamed': 'Pick up here — {city}',
  'book.weight.value': '{weight} kg',
  'track.price.acceptNamed': 'Accept {amount}',
  'track.assigned.takingNamed': '{name} is taking it',
  'track.tripsCount': '{count} trips',
  'pos.seenAgo': 'Seen {age}',
  'pos.lastSentAgo': 'Last sent {age}',
  'track.rate.starAria': '{n} stars',
  'label.referenceNamed': 'Reference {ref}',
```

and change the existing `'price.heldUntil'` value to `'Held until {when}'`.

Do **not** delete `route.ariaTo`, `book.about`, `track.trips`, `pos.seen`, `pos.lastSent`, `label.reference` or `home.greeting` yet — Task 5 removes whichever are left unused, once every call site has moved.

In the `ar` block, add only what assembles from fragments already present, and mark it:

```ts
  // Assembled from fragments already in this file. FLAG FOR PROOFING.
  'route.aria': '{origin} إلى {destination}',
  'book.aboutKm': 'حوالي {km} كم',
  'pos.seenAgo': 'شوهدت {age}',
  'pos.lastSentAgo': 'آخر إرسال {age}',
  'track.tripsCount': '{count} رحلة',
```

- [ ] **Step 4: Update the call sites**

`src/components/ui.tsx:227` — inside `RouteRail`:

```tsx
      accessibilityLabel={labelled ? t('route.aria', { origin, destination }) : undefined}
```

`src/app/(app)/(tabs)/customer.tsx` — line 144, then the three `accessibilityLabel` concatenations at 178, 217, 267 and the search label at 164:

```tsx
            ? t('home.greetingNamed', { name: profile.full_name.split(' ')[0] })
```

```tsx
            accessibilityLabel={`${t('home.search.title')} ${t('home.search.hint')}`}
```
becomes a single key — add `'home.search.aria': 'Where to? Pick two cities and we handle the rest'` to `en` and use:
```tsx
            accessibilityLabel={t('home.search.aria')}
```

```tsx
            accessibilityLabel={t('common.error.aria')}
```

```tsx
                  accessibilityLabel={`${t('route.aria', { origin: localized(o), destination: localized(d) })}. ${t(
```
(keep the trailing status fragment as it is — a sentence boundary, not a word-order problem)

```tsx
            accessibilityLabel={`${t('home.again.title')}. ${t('route.aria', { origin: localized(repeatFrom), destination: localized(repeatTo) })}`}
```
Read the surrounding lines at 267 before editing; the second city variable's name is defined a few lines above and must be used as-is.

`src/app/(app)/(tabs)/offers.tsx:105` and `routes.tsx:89`:

```tsx
            accessibilityLabel={t('common.error.aria')}
```

`src/app/(app)/load/[id].tsx`:

```tsx
      whatsappLink(`${t('label.referenceNamed', { ref: reference(load.id) })}${suffix ? ` — ${suffix}` : ''}`),   // :144
```
```tsx
          {t('price.heldUntil', { when: formatDeadline(held.expires_at) })}                                       // :427
```
```tsx
        label={money ? t('track.price.acceptNamed', { amount: money }) : t('track.price.accept')}                 // :459
```
Read line 459 first — `money` there is a pre-built string that already includes a leading separator. Strip that separator when moving it into the placeholder.
```tsx
          {t('track.assigned.takingNamed', { name })}                                                             // :505
```
```tsx
          {`${rated ? '· ' : ''}${t('track.tripsCount', { count: formatNumber(summary.trips) })}`}                 // :564
```
```tsx
        {fix && age ? t('pos.seenAgo', { age }) : t('pos.estimate')}                                              // :617
```
```tsx
          accessibilityLabel={t('track.rate.starAria', { n: formatNumber(n) })}                                    // :720
```

`src/app/(app)/trip/[id].tsx:312`:

```tsx
                  {t('pos.lastSentAgo', { age: formatAge(lastSentAt) })}
```

`src/app/(app)/book/destination.tsx:113` and `book/review.tsx:148`:

```tsx
            {t('book.aboutKm', { km: formatNumber(km) })}
```
```tsx
          {t('book.aboutKm', { km: formatNumber(roadKm(origin, dest)) })}
```

`src/app/(app)/book/origin.tsx:69`:

```tsx
          label={chosen ? t('book.origin.ctaNamed', { city: localized(chosen) }) : t('action.continue')}
```
Note this also fixes a live bug: the current line reads `chosen.name_en`, which renders an English city name inside Arabic copy.

`src/app/(app)/book/review.tsx:116`:

```tsx
                  : t('book.weight.value', { weight: formatNumber(draft.weightKg) })
```

- [ ] **Step 5: Run the tests**

Run: `npx jest`
Expected: PASS. Some existing tests assert on the old concatenated labels — update those assertions to the new single strings. Do not weaken an assertion to make it pass; if a label changed, the test should say the new label.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "One sentence, one key — including the ones read aloud"
```

---

### Task 5: No unit, arrow or alignment literal survives

The static net. Cheap, and it guards the rule most likely to be broken by a future screen written in a hurry.

**Files:**
- Create: `tests/unit/no-literals.test.ts`
- Modify: `src/i18n/index.ts` (delete now-unused fragment keys)

**Interfaces:**
- Consumes: the call sites finished in Tasks 3 and 4.
- Produces: a standing assertion. Later tasks that add a screen must keep it green.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/no-literals.test.ts`:

```ts
/**
 * Rules that cannot be enforced by a type and are invisible until someone runs
 * the app in Arabic. A grep is a poor test in general and the right one here:
 * these are lexical rules about source text, and the failure they prevent —
 * a Latin "km" or an unflipped left margin in Arabic — costs a release to find
 * any other way.
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/app', 'src/components', 'src/map'];

function sources(): string[] {
  return ROOTS.flatMap((r) =>
    globSync('**/*.{ts,tsx}', { cwd: r }).map((f) => join(r, f)),
  ).filter((f) => !f.endsWith('legacy.tsx'));
}

/** Strip block and line comments so a rule written *about* the rule is not a hit. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('direction literals', () => {
  it('no physical left/right style property', () => {
    // SVG coordinates are exempt by design (CLAUDE.md): a projected x is a
    // position on the peninsula, not a reading direction.
    const hits = sources()
      .filter((f) => !f.startsWith('src/map'))
      .filter((f) => /(^|\s)(left|right):\s/m.test(code(f)));
    expect(hits).toEqual([]);
  });

  it("no textAlign: 'left' or 'right'", () => {
    const hits = sources().filter((f) => /textAlign:\s*'(left|right)'/.test(code(f)));
    expect(hits).toEqual([]);
  });

  it('no hardcoded direction arrow outside directionArrow()', () => {
    const hits = sources()
      .filter((f) => !f.endsWith('i18n/index.ts'))
      .filter((f) => /['"`][^'"`]*[→←][^'"`]*['"`]/.test(code(f)));
    expect(hits).toEqual([]);
  });
});

describe('units', () => {
  it('no unit appears as a template literal outside a dictionary string', () => {
    // `${n} km` renders Latin "km" in Arabic copy. The unit belongs inside the
    // string, where the translator can move or replace it.
    const hits = sources().filter((f) => /\}\s*(km|kg|OMR)\b/.test(code(f)));
    expect(hits).toEqual([]);
  });
});
```

`globSync` moved to `node:fs` in Node 22; if the installed Node is older, import it from `glob` — check `node -v` first and use `import { globSync } from 'glob'` (already a transitive dev dependency) if below 22.

- [ ] **Step 2: Run it**

Run: `npx jest tests/unit/no-literals.test.ts`
Expected: FAIL, listing whatever Tasks 3 and 4 missed. This is the point of the task — the list is the work.

- [ ] **Step 3: Fix each hit**

Every hit is one of: a unit to move inside a string (add the key, same shape as Tasks 3–4), an arrow to replace with `directionArrow()`, or a physical property to make logical (`left:` → `start:`, `right:` → `end:`).

**Do not add an exemption to make a hit disappear.** The two exemptions already in the test — `src/map` for SVG coordinates and `legacy.tsx` as transitional — are the complete set, and both are named in `CLAUDE.md`.

- [ ] **Step 4: Delete the fragment keys nothing uses now**

```bash
for k in drv.offer.about book.about track.trips pos.seen pos.lastSent route.ariaTo; do
  echo "== $k =="; grep -rn "'$k'" src/ | grep -v "i18n/index.ts"
done
```

Delete from **both** dictionaries any key the grep shows no call site for. Leave the rest.

- [ ] **Step 5: Run everything**

Run: `npm run verify`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Grep for the three things Arabic cannot survive"
```

---

### Task 6: Language is a choice, and it persists

Nothing calls `forceRTL` today and no preference is stored, so Arabic is reachable only by changing the phone's OS language. This is the piece with the highest chance of misbehaving on hardware — see the spec's §6.3 and its risk row.

**Files:**
- Create: `src/lib/language.ts`
- Create: `tests/unit/language.test.ts`
- Modify: `src/app/_layout.tsx:26-28`, `package.json`, `tests/setup.ts`

**Interfaces:**
- Consumes: `initLanguage`, `getLanguage`, `type Language` from `@/i18n`.
- Produces:
  - `loadLanguage(): Promise<Language>` — reads the stored preference, falls back to device locale, calls `initLanguage`, and returns the active language. Does **not** reload.
  - `setLanguage(next: Language): Promise<void>` — persists, applies `forceRTL`, and reloads. Resolves without reloading when `next` is already active.
  - `needsReload(lang: Language, isRTL: boolean): boolean` — pure, exported for the test.
  - `LANGUAGE_KEY = 'truckkoo.language'`

- [ ] **Step 1: Add the dependency and stub it in tests**

```bash
npx expo install expo-updates
```

In `tests/setup.ts`, beside the other native stubs:

```ts
jest.mock('expo-updates', () => ({
  reloadAsync: jest.fn(async () => {}),
  isEmbeddedLaunch: true,
}));
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/language.test.ts`:

```ts
/**
 * The language preference.
 *
 * `I18nManager.forceRTL` only takes effect on the NEXT launch, so the correctness
 * question here is entirely about the reload: get it wrong in one direction and
 * the user sees Arabic text in a left-to-right layout; get it wrong in the other
 * and the app relaunches forever.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

import { LANGUAGE_KEY, loadLanguage, needsReload, setLanguage } from '@/lib/language';
import { getLanguage } from '@/i18n';

describe('needsReload', () => {
  it('is true when Arabic is chosen in a left-to-right layout', () => {
    expect(needsReload('ar', false)).toBe(true);
  });

  it('is true when English is chosen in a right-to-left layout', () => {
    expect(needsReload('en', true)).toBe(true);
  });

  it('is false when the layout already matches — this is what stops a reload loop', () => {
    expect(needsReload('ar', true)).toBe(false);
    expect(needsReload('en', false)).toBe(false);
  });
});

describe('loadLanguage', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
  });

  it('falls back to the device locale when nothing is stored', async () => {
    // tests/setup.ts stubs expo-localization to en-OM.
    await expect(loadLanguage()).resolves.toBe('en');
  });

  it('prefers the stored choice over the device locale', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await expect(loadLanguage()).resolves.toBe('ar');
    expect(getLanguage()).toBe('ar');
  });

  it('ignores a stored value that is not a language', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'klingon');
    await expect(loadLanguage()).resolves.toBe('en');
  });

  it('never reloads on boot when the layout already matches', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });
});

describe('setLanguage', () => {
  it('persists the choice and reloads', async () => {
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
    await setLanguage('ar');
    await expect(SecureStore.getItemAsync(LANGUAGE_KEY)).resolves.toBe('ar');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('does nothing when the language is already active', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    await setLanguage('en');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest tests/unit/language.test.ts`
Expected: FAIL — `@/lib/language` does not exist.

- [ ] **Step 4: Implement**

Create `src/lib/language.ts`:

```ts
/**
 * The language preference: reading it, writing it, and making the layout match.
 *
 * This is the only file that calls `I18nManager.forceRTL`. That matters because
 * forceRTL does not take effect until the next launch — so every call has to be
 * paired with a relaunch, and a call without one leaves Arabic text sitting in a
 * left-to-right layout. Keeping the pair in one place is what makes that
 * checkable.
 *
 * The reload is conditional on `needsReload`, never unconditional. An
 * unconditional reload after applying a stored preference relaunches the app
 * forever, because the stored preference is still there on the way back in.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

import { getLanguage, initLanguage, type Language } from '@/i18n';

export const LANGUAGE_KEY = 'truckkoo.language';

function isLanguage(v: string | null): v is Language {
  return v === 'en' || v === 'ar';
}

/** Whether the native layout direction disagrees with the chosen language. */
export function needsReload(lang: Language, isRTL: boolean): boolean {
  return (lang === 'ar') !== isRTL;
}

/**
 * Boot. Reads the stored choice, falls back to the device locale, and applies
 * the direction.
 *
 * Called before first render, not in an effect: a screen that renders LTR and
 * then flips is worse than one that waits, and the root layout already gates on
 * fonts, so the wait is free.
 */
export async function loadLanguage(): Promise<Language> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
  } catch {
    // A locked or unavailable keystore is not a reason to fail to start. Fall
    // through to the device locale.
  }

  const lang = initLanguage(isLanguage(stored) ? stored : undefined);

  if (needsReload(lang, I18nManager.isRTL)) {
    I18nManager.forceRTL(lang === 'ar');
    await reload();
  }
  return lang;
}

/** Change the language. Persists, applies the direction, and relaunches. */
export async function setLanguage(next: Language): Promise<void> {
  if (next === getLanguage() && !needsReload(next, I18nManager.isRTL)) return;
  await SecureStore.setItemAsync(LANGUAGE_KEY, next);
  I18nManager.forceRTL(next === 'ar');
  await reload();
}

/**
 * Relaunch.
 *
 * `reloadAsync` is a no-op in Expo Go and can reject in a dev client. Swallowing
 * that is deliberate: the preference is already stored, so the next manual start
 * comes up correct, and a thrown error here would look like the language change
 * failed when it did not. X2 tells the user to reopen the app if it is still
 * running afterwards.
 */
async function reload(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // See above.
  }
}
```

- [ ] **Step 5: Boot it from the root layout**

In `src/app/_layout.tsx`, delete the bare `initLanguage();` at line 28 and its import, keep `I18nManager.allowRTL(true);`, and add to `RootLayout`:

```tsx
import { loadLanguage } from '@/lib/language';

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_ASSETS);
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    loadLanguage().then(
      () => setLanguageReady(true),
      () => setLanguageReady(true),
    );
  }, []);

  useEffect(() => {
    if (fontsLoaded && languageReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, languageReady]);

  if (!fontsLoaded || !languageReady) return null;
  // ...unchanged from here
```

Add `useState` to the existing `react` import.

- [ ] **Step 6: Run the tests**

Run: `npx jest tests/unit/language.test.ts && npm run verify`
Expected: PASS, green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Let someone choose Arabic without changing their phone"
```

---

### Task 7: `Segmented`, on the new system

X1's control. The handoff specifies it precisely and the count goes in the label, which makes it an accessibility question as much as a visual one.

**Files:**
- Modify: `src/components/ui.tsx`
- Test: `tests/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `color`, `radius`, `space`, `font`, `MIN_TARGET` from `@/theme/tokens`; `arabicIfNeeded`, `align` from `./text-direction`; `formatNumber` from `@/i18n`.
- Produces: `Segmented({ options, value, onChange })` where `options: { value: string; label: string; count: number }[]`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/primitives.test.tsx`:

```tsx
import { Segmented } from '@/components/ui';
import { initLanguage } from '@/i18n';

describe('Segmented', () => {
  const options = [
    { value: 'live', label: 'Moving', count: 2 },
    { value: 'past', label: 'Finished', count: 1 },
  ];

  afterEach(() => initLanguage('en'));

  it('puts the count in the visible label', () => {
    const { getByText } = render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(getByText('Moving (2)')).toBeTruthy();
  });

  it('announces the count with its referent, never as a loose number', () => {
    const { getByLabelText } = render(
      <Segmented options={options} value="live" onChange={() => {}} />,
    );
    expect(getByLabelText('Moving, 2')).toBeTruthy();
  });

  it('marks the active segment selected', () => {
    const { getByLabelText } = render(
      <Segmented options={options} value="live" onChange={() => {}} />,
    );
    expect(getByLabelText('Moving, 2').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Finished, 1').props.accessibilityState.selected).toBe(false);
  });

  it('renders the count in Arabic-Indic digits in Arabic', () => {
    initLanguage('ar');
    const { getByText } = render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(getByText('Moving (٢)')).toBeTruthy();
  });

  it('reports a tap', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <Segmented options={options} value="live" onChange={onChange} />,
    );
    fireEvent.press(getByLabelText('Finished, 1'));
    expect(onChange).toHaveBeenCalledWith('past');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/components/primitives.test.tsx -t Segmented`
Expected: FAIL — `Segmented` is not exported from `@/components/ui`.

- [ ] **Step 3: Implement**

Add to `src/components/ui.tsx`:

```tsx
/**
 * Two views of one list — not two tabs, and not a question.
 *
 * The count lives inside the label because that is what makes the control worth
 * having: "Moving (2)" answers the question before the tap. It goes through
 * `formatNumber`, like every other numeral, and into the accessible name with
 * its referent — a bare "2" is announced with nothing to attach it to.
 */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${o.label}, ${formatNumber(o.count)}`}
            style={StyleSheet.flatten([
              styles.segment,
              on && { backgroundColor: color.lightText },
            ])}
          >
            <Text
              style={StyleSheet.flatten([
                arabicIfNeeded(font.rowTitle),
                { color: on ? color.inkText : alpha.onInk.secondary, textAlign: 'center' },
              ])}
            >
              {`${o.label} (${formatNumber(o.count)})`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

`textAlign: 'center'` is correct and not a direction literal — centre is centre in both directions. Add to the `styles` block at the bottom of the file:

```ts
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.raised,
    borderRadius: radius.tile,
    padding: 5,
    gap: 5,
  },
  segment: {
    flex: 1,
    height: 42,
    minHeight: MIN_TARGET - 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.tileXs,
  },
```

The 42px segment sits inside a control whose total height with padding is 52px, clearing `MIN_TARGET`. Add `Pressable` and `formatNumber` to the imports at the top of `ui.tsx` if not already present.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/components/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui.tsx tests/components/primitives.test.tsx
git commit -m "A segmented control that says how many"
```

---

### Task 8: X1 · Loads list

Rebuilds the tab on the new system and **deletes** `src/components/load-card.tsx`, which `OPEN_ISSUES` records as transitional and assigns here.

**Files:**
- Modify: `src/app/(app)/(tabs)/loads.tsx` (full rewrite)
- Delete: `src/components/load-card.tsx`
- Create: `tests/components/loads-screen.test.tsx`

**Interfaces:**
- Consumes: `Segmented` (Task 7), `Card`, `RouteRail`, `StatusPill`, `Screen`, `SectionLabel`, `Skeleton` from `@/components/ui`; `useMyLoads`, `useMyTrips`, `useTripPosition`, `useCities`, `cityIndex`, `type Load`, `type LoadStatus` from `@/lib/queries`; `formatWindow`, `formatDeadline` from `@/lib/format`; `formatMoney` from `@/lib/money`.
- Produces: `LIVE: LoadStatus[]` and `PILL_TONE: Record<LoadStatus, 'accent' | 'neutral'>`, both moved into `loads.tsx` from the deleted `load-card.tsx` — check with `grep -rn "load-card" src/` that nothing else imported them before deleting.

- [ ] **Step 1: Check what else depends on the file being deleted**

```bash
grep -rn "load-card\|LIVE\b\|TONE\b" src/ tests/
```

If any other screen imports `LIVE` or `TONE`, move them to `src/lib/queries.ts` instead of into `loads.tsx`, and adjust the imports below. Do this before writing the test.

- [ ] **Step 2: Write the failing test**

Create `tests/components/loads-screen.test.tsx`:

```tsx
/**
 * X1. Two views of one list, and the rule that a card never shows an ETA it did
 * not receive — the same rule T4 follows for its truck marker.
 */

import { render } from '@testing-library/react-native';

import LoadsTab from '@/app/(app)/(tabs)/loads';
import { initLanguage } from '@/i18n';

const load = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'l1',
  origin_city: 1,
  dest_city: 2,
  pickup_from: '2026-08-03',
  pickup_to: '2026-08-03',
  weight_kg: 8000,
  truck_type_code: null,
  goods_description: 'Dates',
  status: 'in_transit',
  price_baisa: 42500,
  currency: 'OMR',
  created_at: '2026-08-01T06:00:00Z',
  ...over,
});

jest.mock('@/lib/queries', () => ({
  ...jest.requireActual('@/lib/queries'),
  useCities: () => ({
    data: [
      { id: 1, name_en: 'Muscat', name_ar: 'مسقط', lat: 23.6, lng: 58.5 },
      { id: 2, name_en: 'Barka', name_ar: 'بركاء', lat: 23.7, lng: 57.9 },
    ],
  }),
  useTruckTypes: () => ({ data: [] }),
  useMyTrips: () => ({ data: [{ id: 't1', load_id: 'l1', status: 'in_transit' }] }),
  useTripPosition: () => ({ data: null }),
  useMyLoads: () => ({
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: [load(), load({ id: 'l2', status: 'delivered', price_baisa: 30000 })],
  }),
}));

describe('X1 · loads list', () => {
  afterEach(() => initLanguage('en'));

  it('counts each half in the segmented control', () => {
    const { getByLabelText } = render(<LoadsTab />);
    expect(getByLabelText('Moving, 1')).toBeTruthy();
    expect(getByLabelText('Finished, 1')).toBeTruthy();
  });

  it('shows the route and the price on a moving load', () => {
    const { getByText } = render(<LoadsTab />);
    expect(getByText('Muscat')).toBeTruthy();
    expect(getByText('Barka')).toBeTruthy();
    expect(getByText(/42\.500/)).toBeTruthy();
  });

  it('shows no ETA when nothing has reported a position', () => {
    // The rule from P6: a marker — or a time — without a reported fix behind it
    // is a bug, not a placeholder.
    const { queryByTestId } = render(<LoadsTab />);
    expect(queryByTestId('load-eta')).toBeNull();
  });

  it('shows no price on a load that has none', () => {
    jest.spyOn(require('@/lib/queries'), 'useMyLoads').mockReturnValue({
      isPending: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      data: [load({ price_baisa: null, status: 'finding_truck' })],
    });
    const { queryByTestId } = render(<LoadsTab />);
    expect(queryByTestId('load-price')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest tests/components/loads-screen.test.tsx`
Expected: FAIL — the screen still renders the legacy `Segmented` with different labels.

- [ ] **Step 4: Rewrite the screen**

Replace `src/app/(app)/(tabs)/loads.tsx` entirely. Keep the existing file's header comment — its reasoning about why this is a segmented control rather than two tabs, and why finished loads are rows rather than cards, is still correct and was written for this screen.

Structure:

```tsx
const LIVE: LoadStatus[] = [
  'posted', 'finding_truck', 'quoted', 'accepted', 'matched', 'assigned', 'in_transit',
];

/**
 * Which statuses read as live. Exactly one pill on a card, and the accent is
 * spent on it — so there is no pinned accent action on this screen.
 */
const PILL_TONE: Record<LoadStatus, 'accent' | 'neutral'> = {
  posted: 'neutral',
  finding_truck: 'neutral',
  quoted: 'accent',
  accepted: 'accent',
  matched: 'accent',
  assigned: 'accent',
  in_transit: 'accent',
  delivered: 'neutral',
  closed: 'neutral',
  cancelled: 'neutral',
};
```

The moving half maps each load to a `<MovingCard>` defined in the same file:

```tsx
function MovingCard({
  load, tripId, cityName, onPress,
}: {
  load: Load;
  tripId: string | undefined;
  cityName: (id: number) => string;
  onPress: () => void;
}) {
  // One RPC per in-transit load, polling at 60s. The list is short by
  // construction — a shipper with more than a handful of trucks in motion is
  // not the audience this screen was drawn for — and the alternative is an ETA
  // computed on the client, which P6 deleted on purpose.
  const position = useTripPosition(load.status === 'in_transit' ? tripId : undefined);
  const eta = position.data?.eta_at ?? null;
  const price = load.price_baisa;

  return (
    <PressableSurface onPress={onPress} accessibilityLabel={t('route.aria', {
      origin: cityName(load.origin_city),
      destination: cityName(load.dest_city),
    })}>
      <Card>
        <View style={styles.cardHead}>
          <StatusPill label={t(`status.${load.status}` as StringKey)} tone={PILL_TONE[load.status]} />
          {eta ? (
            <Text testID="load-eta" style={...}>{formatDeadline(eta)}</Text>
          ) : (
            <Text style={...}>{formatWindow(load.pickup_from, load.pickup_to)}</Text>
          )}
        </View>
        <View style={styles.cardBody}>
          <RouteRail
            origin={cityName(load.origin_city)}
            destination={cityName(load.dest_city)}
            labelled={false}
          />
          {price != null && (
            <Text testID="load-price" style={...}>
              {formatMoney(price, load.currency as Currency)}
            </Text>
          )}
        </View>
      </Card>
    </PressableSurface>
  );
}
```

Type styling per the handoff: route cities at `font.rowTitle` (16px 700, supplied by `RouteRail` already), price at `font.rowTitle` **vertically centred against the rail** — `alignItems: 'center'` on `cardBody`, with the rail flexed and the price shrink-to-fit. Timestamp and ETA at `font.caption` in `alpha.onInk.tertiary`.

The finished half keeps the row list. It currently uses legacy `RowGroup`/`ListRow`/`Stamp`; replace with `Card` wrapping `DetailRow` (Task 9 builds it) — **or**, if Task 9 has not run yet, keep the rows in a plain `Card` with `PressableSurface` per row and a `StatusPill` trailing. Either is acceptable; do not import from `legacy`.

Loading state: `Skeleton`, not `ActivityIndicator`. The current screen uses a spinner and that is a rule violation the rewrite fixes — `CLAUDE.md`: "skeletons, never spinners".

Error and empty states: keep the existing copy keys, and use `PrimaryButton`/`SecondaryButton` from `@/components/primitives` rather than the legacy `Button`.

- [ ] **Step 5: Delete the transitional card**

```bash
git rm src/components/load-card.tsx
grep -rn "load-card" src/ tests/    # must return nothing
```

- [ ] **Step 6: Run the tests**

Run: `npx jest tests/components/loads-screen.test.tsx && npm run verify`
Expected: PASS, green. `grep -rl "components/legacy" src/app` no longer lists `loads.tsx`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Rebuild the loads list, and retire the card it borrowed (X1)"
```

---

### Task 9: `DetailGroup` and `DetailRow`

X2's `YOUR DETAILS` card. Not `ListRow` — these rows are values, not navigation, and only one of them is tappable.

**Files:**
- Modify: `src/components/ui.tsx`
- Test: `tests/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `Card`, `SectionLabel`, tokens, `Icon`.
- Produces:
  - `DetailGroup({ label, children })` — a `SectionLabel` above a 22px-radius `Card`, with inset hairlines between children.
  - `DetailRow({ label, value, onPress })` — label start, value end, chevron only when `onPress` is given.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/primitives.test.tsx`:

```tsx
import { DetailGroup, DetailRow } from '@/components/ui';

describe('DetailRow', () => {
  it('shows a chevron only when it goes somewhere', () => {
    const { queryByTestId, rerender } = render(<DetailRow label="Mobile" value="+968 …" />);
    expect(queryByTestId('detail-chevron')).toBeNull();
    rerender(<DetailRow label="Language" value="English" onPress={() => {}} />);
    expect(queryByTestId('detail-chevron')).toBeTruthy();
  });

  it('announces label and value together', () => {
    const { getByLabelText } = render(
      <DetailRow label="Language" value="English" onPress={() => {}} />,
    );
    expect(getByLabelText('Language, English')).toBeTruthy();
  });

  it('is not a button when it does not act', () => {
    const { getByText } = render(<DetailRow label="Mobile" value="+968 …" />);
    expect(getByText('Mobile')).toBeTruthy();
  });
});

describe('DetailGroup', () => {
  it('divides rows with a hairline but does not rule the last one', () => {
    const { getAllByTestId } = render(
      <DetailGroup label="YOUR DETAILS">
        <DetailRow label="a" value="1" />
        <DetailRow label="b" value="2" />
        <DetailRow label="c" value="3" />
      </DetailGroup>,
    );
    expect(getAllByTestId('detail-divider')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/components/primitives.test.tsx -t Detail`
Expected: FAIL — neither component is exported.

- [ ] **Step 3: Implement**

Add to `src/components/ui.tsx`:

```tsx
/**
 * A group of values.
 *
 * Not `ListRow`: these rows are facts, and at most one of them navigates. The
 * dividers are inset 18px inside the card — a rule that runs to the card's edge
 * reads as a border and makes one card look like three.
 */
export function DetailGroup({ label, children }: { label: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.detailGroup}>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.detailCard}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {row}
            {i < rows.length - 1 && <View testID="detail-divider" style={styles.detailDivider} />}
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

export function DetailRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.detailRow}>
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.body),
          { color: alpha.onInk.secondary, textAlign: align.start },
        ])}
      >
        {label}
      </Text>
      <View style={styles.detailValue}>
        <Text
          numberOfLines={1}
          style={StyleSheet.flatten([
            arabicIfNeeded(font.value),
            { color: color.lightText, textAlign: align.end },
          ])}
        >
          {value}
        </Text>
        {!!onPress && (
          <View testID="detail-chevron">
            <Icon name="chevron" size={18} tint={color.iconGreyDim} />
          </View>
        )}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <PressableSurface onPress={onPress} accessibilityLabel={`${label}, ${value}`}>
      {body}
    </PressableSurface>
  );
}
```

Styles:

```ts
  detailGroup: { gap: space.md },
  detailCard: { borderRadius: radius.card, paddingVertical: space.xs, paddingHorizontal: 0 },
  detailDivider: { height: 1, backgroundColor: hairline.inner, marginHorizontal: 18 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TARGET,
    paddingHorizontal: 18,
    gap: space.md,
  },
  detailValue: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
```

`flexDirection: 'row'` flips under RTL automatically, and `Icon name="chevron"` mirrors — both are already exercised by `tests/components/icon.test.tsx`. Add `Children`, `Fragment` to the `react` import.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/components/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui.tsx tests/components/primitives.test.tsx
git commit -m "Rows that are values, not destinations"
```

---

### Task 10: X2 · Account, with a language switch that works

**Files:**
- Modify: `src/app/(app)/(tabs)/account.tsx` (full rewrite)
- Modify: `src/i18n/index.ts` (two new keys)
- Create: `tests/components/account-screen.test.tsx`

**Interfaces:**
- Consumes: `DetailGroup`, `DetailRow` (Task 9); `setLanguage` (Task 6); `useSession`, `signOut`, `safeText`, `whatsappLink`.
- Produces: nothing consumed later.
- New keys: `account.language.pick` → `'Language'`, `account.language.reopen` → `'Reopen Truckkoo to finish changing the language.'`

- [ ] **Step 1: Write the failing test**

Create `tests/components/account-screen.test.tsx`:

```tsx
/**
 * X2. One component, two roles — and the rule that this screen may only say what
 * `profiles` actually holds. An account screen is exactly where a plausible
 * invented number goes unchallenged.
 */

import { fireEvent, render } from '@testing-library/react-native';

import AccountTab from '@/app/(app)/(tabs)/account';
import { initLanguage } from '@/i18n';
import * as language from '@/lib/language';

const session = (role: 'shipper' | 'driver', over = {}) => ({
  profile: { full_name: 'Nasser Al Hinai', phone: '+968 9123 4567', role, ...over },
});

jest.mock('@/lib/session', () => ({ useSession: jest.fn() }));
const { useSession } = jest.requireMock('@/lib/session');

describe('X2 · account', () => {
  beforeEach(() => initLanguage('en'));

  it('names the role in the second person', () => {
    useSession.mockReturnValue(session('driver'));
    const { getByText } = render(<AccountTab />);
    expect(getByText('You drive a truck')).toBeTruthy();
  });

  it('shows the initials, not an avatar image', () => {
    useSession.mockReturnValue(session('shipper'));
    const { getByText } = render(<AccountTab />);
    expect(getByText('NA')).toBeTruthy();
  });

  it('shows no truck row for a shipper', () => {
    useSession.mockReturnValue(session('shipper'));
    const { queryByText } = render(<AccountTab />);
    expect(queryByText('Truck')).toBeNull();
  });

  it('invents nothing: no rating, no trip count, no member-since', () => {
    useSession.mockReturnValue(session('driver'));
    const { queryByText } = render(<AccountTab />);
    for (const forbidden of [/member since/i, /\d+ trips/i, /4\.\d/]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });

  it('changes the language through setLanguage, never by mutating i18n directly', () => {
    const spy = jest.spyOn(language, 'setLanguage').mockResolvedValue();
    useSession.mockReturnValue(session('driver'));
    const { getByLabelText, getByText } = render(<AccountTab />);
    fireEvent.press(getByLabelText('Language, English'));
    fireEvent.press(getByText('العربية'));
    expect(spy).toHaveBeenCalledWith('ar');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/components/account-screen.test.tsx`
Expected: FAIL — the screen has no picker and the role line differs.

- [ ] **Step 3: Rewrite the screen**

Replace `src/app/(app)/(tabs)/account.tsx`. **Keep the existing header comment** — its "WHAT THIS SCREEN MAY SAY" section is the constraint this task is most likely to violate, and it was written for this screen.

Structure, per the handoff:

- 64px avatar circle, initials at `font.statement` in `color.accentLight`, on `color.raised`. Write the initials helper in this file (two words max, uppercased) rather than importing `Avatar` from `legacy`.
- Name at `font.statement`, role line at `font.body` in `alpha.onInk.body`.
- `DetailGroup label={t('account.details')}`:
  - `DetailRow` Mobile / `safeText(profile.phone ?? '—')`
  - `DetailRow` Truck / the driver's truck type — **only when `profile.role === 'driver'` and the profile carries one.** No row rather than a placeholder.
  - `DetailRow` Language / `getLanguage() === 'ar' ? 'العربية' : 'English'`, with `onPress` opening the picker.
- `DetailGroup label={t('account.help')}` with one tappable row opening `whatsappLink(t('app.name'))`.
- `SecondaryButton` "Sign out", full width.

The picker is a `Modal` with two `SelectRow`s from `@/components/primitives` — which already give the three-way selection signal (border, fill, filled radio) the design system requires. On pick: `await setLanguage(next)`. If control returns from `setLanguage` and the component is still mounted, the reload did not happen, so render `t('account.language.reopen')` as a `Notice`.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/components/account-screen.test.tsx && npm run verify`
Expected: PASS, green. `grep -rl "components/legacy" src/app` now returns exactly the four auth screens and `post-load.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rebuild account, and make the language row lead somewhere (X2)"
```

---

### Task 11: The Arabic dictionary, completed

The phase's largest body of work, and the only task that is not primarily a coding task. Roughly 207 keys, plus whatever Tasks 3, 4 and 10 added.

**Files:**
- Modify: `src/i18n/index.ts` (the `ar` block)
- Modify: `tests/unit/i18n.test.ts` (the English-fallback test changes meaning)

**Interfaces:**
- Consumes: the finished key set from Tasks 3, 4, 7–10.
- Produces: an `ar` dictionary with a value for every `StringKey`, which Tasks 12 and 13 assert against.

- [ ] **Step 1: Get the current gap**

```bash
node -e "
const s=require('fs').readFileSync('src/i18n/index.ts','utf8');
const en=s.slice(s.indexOf('const en = {'), s.indexOf('export type StringKey'));
const ar=s.slice(s.indexOf('const ar: Partial'));
const keys=b=>new Set([...b.matchAll(/^\s*['\"]([a-zA-Z0-9._]+)['\"]:/gm)].map(m=>m[1]));
const E=keys(en),A=keys(ar);
console.log([...E].filter(k=>!A.has(k)).join('\n'));
"
```

- [ ] **Step 2: Harvest, in this order — do not skip to drafting**

1. **`~/truckkoo`** is the live bilingual site and the source of truth for company facts and copy. Read `index.html`, `about.html`, `contact.html` and `js/main.js` for Arabic the company already publishes: the six public claims ("100% verified drivers", "6 GCC countries", "1–40 ton", "7 days a week", "replies in minutes", "no brokers, no delays"), the 46 city names, the 5 truck types. **Lift verbatim.** Do not re-word.
2. **The handoff's X3 and X4** give finished Arabic for a whole home screen and a whole question screen, quoted in `design_handoff_truckkoo_redesign/README.md` §"Flow 5". That covers the tab labels (`الرئيسية` / `الشحنات` / `حسابي`), the greeting (`صباح الخير، ناصر`), `قيد التنفيذ`, `عرض الكل`, `جاري البحث عن شاحنة`, `نحن نختار الشاحنة`, `متابعة`, and the S5 date copy. Lift these verbatim too.
3. **Assemble from fragments already in the dictionary** wherever a new key merges old ones — the pattern Tasks 3 and 4 used.
4. **Only then draft the remainder.**

- [ ] **Step 3: Mark every draft**

Drafted values go under a clearly delimited block at the end of the `ar` dictionary:

```ts
  /* ─── UNPROOFED DRAFTS ───────────────────────────────────────────────────
   * Not lifted from the website and not assembled from existing fragments.
   * Every string below needs a native Arabic reader before launch.
   * Count and review status are tracked in OPEN_ISSUES.md.
   * ──────────────────────────────────────────────────────────────────────── */
```

**Do not scatter drafts among the harvested strings.** The block is what makes the review finite: a reviewer reads one section, not 378 lines looking for the ones that need attention.

- [ ] **Step 4: Update the fallback test, which now asserts something different**

`tests/unit/i18n.test.ts` currently contains:

```ts
  it('falls back to English for a key Arabic has not translated yet', () => {
    initLanguage('ar');
    expect(t('common.back')).toBe('Back');
  });
```

`common.back` now has Arabic, so this fails. The fallback behaviour is still worth guarding — it is what keeps a future missing key visible rather than blank. Replace with a test that exercises the mechanism without depending on a gap:

```ts
  it('falls back to English rather than rendering blank when Arabic is missing', () => {
    initLanguage('ar');
    // Every key has Arabic as of P7, so the gap is constructed rather than found.
    // The behaviour still matters: the next key someone adds will have no Arabic
    // for a while, and it must look unfinished rather than broken.
    const missing = 'app.name' as StringKey;
    const saved = dictionaries.ar[missing];
    delete dictionaries.ar[missing];
    expect(t(missing)).toBe(dictionaries.en[missing]);
    dictionaries.ar[missing] = saved;
  });
```

- [ ] **Step 5: Add the completeness assertion**

Append to the `dictionary integrity` describe in `tests/unit/i18n.test.ts`:

```ts
  it('every English key has an Arabic value', () => {
    const missing = Object.keys(dictionaries.en).filter(
      (k) => !dictionaries.ar[k as keyof typeof dictionaries.en],
    );
    expect(missing).toEqual([]);
  });
```

- [ ] **Step 6: Run everything**

Run: `npm run verify`
Expected: green, including placeholder parity from Task 2 — which is the assertion most likely to catch a mistake made in this task.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/index.ts tests/unit/i18n.test.ts
git commit -m "Say the other half of it in Arabic, and mark what still needs a reader"
```

---

### Task 12: The forced-RTL regression net

**Files:**
- Create: `tests/components/rtl.test.tsx`

**Interfaces:**
- Consumes: every screen, plus `dictionaries` from Task 1.
- Produces: a standing suite. Nothing later consumes it.

- [ ] **Step 1: Write the test**

Create `tests/components/rtl.test.tsx`:

```tsx
/**
 * What RTL correctness can and cannot be asserted.
 *
 * CAN: that no Latin digit reaches an Arabic string, that directional icons
 * mirror, that the progress bar fills from the leading edge, that no rendered
 * Arabic text carries a Latin unit.
 *
 * CANNOT: that the layout is right on a device. React Native applies RTL
 * natively and the test renderer does not reproduce it. `OPEN_ISSUES` 30 stays
 * open for exactly this reason — this file narrows it, it does not close it.
 */

import { I18nManager } from 'react-native';
import { render } from '@testing-library/react-native';

import { dictionaries, initLanguage } from '@/i18n';
import { ProgressBar } from '@/components/primitives';
import { Icon } from '@/components/icon';

describe('Arabic copy', () => {
  it('contains no Latin digit', () => {
    // A Latin digit in Arabic copy is the single most visible way the app looks
    // half-translated, and it is invisible to anyone reading the English.
    const bad = Object.entries(dictionaries.ar)
      .filter(([, v]) => v && /[0-9]/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('contains no Latin unit', () => {
    const bad = Object.entries(dictionaries.ar)
      .filter(([, v]) => v && /\b(km|kg|OMR)\b/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('under forced RTL', () => {
  let wasRTL: boolean;

  beforeAll(() => {
    wasRTL = I18nManager.isRTL;
    // @ts-expect-error isRTL is a read-only native constant; the renderer reads
    // it as a plain property, which is the only reason this is testable at all.
    I18nManager.isRTL = true;
    initLanguage('ar');
  });

  afterAll(() => {
    // @ts-expect-error see above
    I18nManager.isRTL = wasRTL;
    initLanguage('en');
  });

  it('mirrors the back chevron', () => {
    const ltr = render(<Icon name="back" />).toJSON();
    // @ts-expect-error see above
    I18nManager.isRTL = false;
    const flipped = render(<Icon name="back" />).toJSON();
    // @ts-expect-error see above
    I18nManager.isRTL = true;
    expect(JSON.stringify(ltr)).not.toBe(JSON.stringify(flipped));
  });

  it('fills the progress bar from the leading edge', () => {
    const { getByTestId } = render(<ProgressBar step={3} total={6} />);
    const fill = getByTestId('progress-fill');
    const style = Array.isArray(fill.props.style)
      ? Object.assign({}, ...fill.props.style)
      : fill.props.style;
    // Logical properties only: a `left` here is a bug in Arabic even when the
    // width is right.
    expect(style.left).toBeUndefined();
    expect(style.right).toBeUndefined();
  });
});
```

Read `src/components/primitives.tsx:371` first and match `ProgressBar`'s actual props and the `testID` on its fill; add the `testID` if it is missing.

- [ ] **Step 2: Run it**

Run: `npx jest tests/components/rtl.test.tsx`
Expected: FAIL on whatever is genuinely wrong. Fix each — a Latin digit in an Arabic string means a numeral that should have gone through `formatNumber`; a Latin unit means a key Task 3–5 missed.

- [ ] **Step 3: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "Assert the mechanical half of RTL, and say which half that is"
```

---

### Task 13: `npm run preview:rtl`

The proof-sheet. It exists for the same reason `preview:map` does: only an eye that knows the country can see a pin in the wrong town, and only a reader of Arabic can see a sentence in the wrong order.

**Files:**
- Create: `scripts/rtl-proof.tsx`
- Modify: `package.json`, `jest.config.js`

**Interfaces:**
- Consumes: `dictionaries` from Task 1, the finished dictionary from Task 11.
- Produces: `.superpowers/rtl-proof.md`.

- [ ] **Step 1: Add the script**

In `package.json`:

```json
    "preview:rtl": "npx jest --config jest.config.js --testMatch '<rootDir>/scripts/rtl-proof.tsx' --runTestsByPath scripts/rtl-proof.tsx"
```

- [ ] **Step 2: Write the generator**

Create `scripts/rtl-proof.tsx`:

```tsx
/**
 * Every Arabic string the app can show, in reading order, in one file.
 *
 *   npm run preview:rtl        →  .superpowers/rtl-proof.md
 *
 * WHY THIS EXISTS. `tests/components/rtl.test.tsx` proves no Latin digit and no
 * Latin unit reaches Arabic copy. It cannot prove the Arabic is *right* — that
 * `حوالي ١٢ كم إضافية على مسارك` reads as a sentence rather than four English
 * fragments wearing Arabic. Only a reader can, and a reader needs the strings
 * laid out somewhere that is not a running app on a phone they do not have.
 *
 * It runs through jest rather than plain node because these are React Native
 * components and need the same renderer the tests use. That is the only reason
 * it is a .tsx under scripts/ rather than a .mjs beside render-map-preview.
 *
 * IT SHOWS COPY, NOT LAYOUT. Mirroring is asserted in rtl.test.tsx and settled
 * on a device, never here.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dictionaries, initLanguage } from '@/i18n';

/**
 * The groups mirror the dictionary's own section comments, which are organised
 * by phase and screen. Grouping by prefix keeps the sheet in the order someone
 * walks the app rather than alphabetical order, which is the order nobody uses
 * the product in.
 */
const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: 'Getting in (N)', prefixes: ['auth.', 'error.'] },
  { title: 'Shipper home (S1)', prefixes: ['home.', 'cust.'] },
  { title: 'Booking (S3–S9)', prefixes: ['book.', 'post.', 'step.'] },
  { title: 'Price and tracking (T1–T5)', prefixes: ['price.', 'track.', 'pos.', 'trip.', 'event.'] },
  { title: 'Driver (D1–D7)', prefixes: ['drv.', 'driver.', 'leg.'] },
  { title: 'Loads list (X1)', prefixes: ['loads.', 'status.'] },
  { title: 'Account (X2)', prefixes: ['account.'] },
  { title: 'Shared', prefixes: ['common.', 'tab.', 'label.', 'action.', 'route.', 'date.', 'app.'] },
];

it('writes the Arabic proof-sheet', () => {
  initLanguage('ar');

  const seen = new Set<string>();
  const lines: string[] = [
    '# Arabic proof-sheet',
    '',
    'Generated by `npm run preview:rtl`. Every string the app can show, in Arabic,',
    'grouped by the screen it appears on.',
    '',
    '**What to look for:** a sentence whose words are in English order; a fragment',
    'that reads as a label where it should read as a sentence; a Latin digit; a term',
    'the company does not actually use. Strings under UNPROOFED in `src/i18n/index.ts`',
    'are drafts and are the priority.',
    '',
  ];

  for (const group of GROUPS) {
    const keys = Object.keys(dictionaries.en)
      .filter((k) => group.prefixes.some((p) => k.startsWith(p)) && !seen.has(k))
      .sort();
    keys.forEach((k) => seen.add(k));
    if (!keys.length) continue;

    lines.push(`## ${group.title}`, '');
    lines.push('| key | English | العربية |', '|---|---|---|');
    for (const k of keys) {
      const en = dictionaries.en[k as keyof typeof dictionaries.en];
      const ar = dictionaries.ar[k as keyof typeof dictionaries.en] ?? '—';
      lines.push(`| \`${k}\` | ${en.replace(/\|/g, '\\|')} | ${ar.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }

  const ungrouped = Object.keys(dictionaries.en).filter((k) => !seen.has(k));
  if (ungrouped.length) {
    // A key with no group is a key nobody decided where to review. Loud, not silent.
    lines.push('## Ungrouped — add a prefix to GROUPS in scripts/rtl-proof.tsx', '');
    for (const k of ungrouped) lines.push(`- \`${k}\``);
  }

  mkdirSync(resolve('.superpowers'), { recursive: true });
  writeFileSync(resolve('.superpowers/rtl-proof.md'), lines.join('\n'), 'utf8');

  expect(ungrouped).toEqual([]);
  initLanguage('en');
});
```

- [ ] **Step 3: Keep it out of the normal suite**

`jest.config.js`'s `testMatch` is `<rootDir>/tests/**/*.test.ts(x)`, so `scripts/rtl-proof.tsx` is already excluded. Confirm:

Run: `npx jest --listTests | grep rtl-proof`
Expected: no output.

- [ ] **Step 4: Run it**

Run: `npm run preview:rtl`
Expected: writes `.superpowers/rtl-proof.md`. Open it and confirm every group has rows, no group is empty, and the Ungrouped section is absent.

- [ ] **Step 5: Confirm `.superpowers/` is not committed**

```bash
grep -n "superpowers" .gitignore || echo ".superpowers/" >> .gitignore
```

- [ ] **Step 6: Commit**

```bash
git add scripts/rtl-proof.tsx package.json .gitignore
git commit -m "Lay every Arabic string out for someone who can read it"
```

---

### Task 14: Close the phase

**Files:**
- Modify: `OPEN_ISSUES.md`, `CLAUDE.md`
- Delete: `NEXT.md`

- [ ] **Step 1: Run the full verification**

```bash
npm run verify
npx supabase start && npx supabase db reset && npm run test:db
```

`db reset` before `test:db` is not optional — seeded demo data makes `tenant_isolation` fail on assertions unrelated to the change under test. P7 touches no SQL, so this run is proving the phase did not disturb anything.

- [ ] **Step 2: Confirm every definition of done**

```bash
grep -rl "components/legacy" src/app       # exactly: 4 auth screens + post-load.tsx
test ! -f src/components/load-card.tsx && echo "load-card deleted"
grep -rnE '\}\s*(km|kg|OMR)\b' src/app src/components   # nothing
```

- [ ] **Step 3: Write the P7 section in `OPEN_ISSUES.md`**

Add a section following the house pattern (a `###` heading that states the thing plainly, prose explaining what is unverified and why, a bold **Done when:**). It must record:

- **The count of unproofed Arabic drafts**, and that they are marked in-file under a delimited block. Done when a native Arabic reader has been through `.superpowers/rtl-proof.md`.
- **Issues 30 and 35 are narrowed, not closed.** Update both in place: the Arabic half of 30 now has a proof-sheet and a regression net behind it, but no screen has been *rendered* RTL on a device. Neither issue's **Done when** changes.
- **`legacy.tsx` survives P7** because P2 is deferred, listing the five screens still on it. This is a decision, not an oversight.
- **`expo-updates` was added for `reloadAsync`**, and the language change has never been seen actually relaunching an app.
- **X1 issues one `trip_position` RPC per in-transit load**, polling at 60s. Fine for the short lists this screen was drawn for; worth revisiting if a shipper ever runs many trucks at once.

- [ ] **Step 4: Update `CLAUDE.md`**

Two edits:
- The legacy paragraph currently ends "After P5 that list is the four auth screens, `post-load.tsx`, `loads.tsx` and `account.tsx`". Change to name P7 and drop `loads.tsx` and `account.tsx`.
- Add to the RTL non-negotiable: composed copy goes through `t()` placeholders, units live inside strings, and `tests/unit/no-literals.test.ts` enforces both.

- [ ] **Step 5: Delete the handoff note**

```bash
git rm NEXT.md
```

Its own last line says to. If a next session needs a note, it is written fresh.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Close P7 — what it left undone, written down"
```

---

## Self-Review

**Spec coverage.** §1 X1/X2 → Tasks 8, 10. §2 the 207-key gap → Task 11. P7-1 legacy boundary → Tasks 8, 10, 14 step 4. P7-2 interpolation → Tasks 1–4. P7-3 units inside strings → Tasks 3–5. P7-4 language switch → Tasks 6, 10. P7-5 test suite + proof-sheet, no web route → Tasks 12, 13. P7-6 issues narrowed not closed → Task 14 step 3. §4 no backend → Global Constraints, Task 14 step 1. §5 X3/X4 assertion table → Task 12 (numerals, chevron, progress bar) and Task 11 (tab labels). §6 interpolation design and language bootstrap → Tasks 1, 6. §7 harvest-then-draft order → Task 11 step 2. §8 all three verification layers → Tasks 5, 12, 13. §9 risks → the drafts block (Task 11 step 3), the reload guard (Task 6), the per-card RPC note (Task 14 step 3). §10 all eight DoD items → Task 14 steps 1–3.

**Type consistency.** `t(key, params)` signature is fixed in Task 1 and used unchanged in 3, 4, 7, 8, 10. `dictionaries` exported once in Task 1, consumed in 2, 11, 12, 13. `needsReload`/`loadLanguage`/`setLanguage` defined in Task 6, consumed in 10. `Segmented`'s `options` type is `{ value, label, count }` in Task 7 and Task 8 passes exactly that — note `count` is required here, unlike the legacy component where it was optional. `DetailGroup`/`DetailRow` defined in Task 9, consumed in 10, and offered as an option in Task 8 step 4 with a stated fallback if the tasks run out of order.

**Two things a reviewer should know I deliberately left loose.** Task 8's finished-half markup depends on whether Task 9 has run, and says so with both options spelled out — sequencing them the other way would mean building `DetailRow` before the screen that proves what it needs. And Task 11 cannot be given exact strings in advance: the harvest sources are files on disk that must be read at execution time, and pre-writing the Arabic here would be exactly the machine translation the spec forbids.
