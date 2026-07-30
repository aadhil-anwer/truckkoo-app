# Truckkoo — Design System

Extracted from `css/style.css`. Reference for building the app so it reads as the
same brand as the website.

**The identity in one line:** black-and-white with exactly one orange, heavy
900-weight headlines, hairline borders instead of shadows, generous vertical
section rhythm.

> ### ⚠ The app no longer follows §3 and §4 of this document
>
> **This file describes the website, and the website has not changed.** Read it
> for anything touching `~/truckkoo`, and for the parts the app still inherits:
> the palette (§1), the type weights (§2), motion (§5), and every accessibility
> convention (§6) — all still binding everywhere.
>
> The **app's** shape, depth and spacing were rebuilt in July 2026 onto Uber's
> structural skeleton, at the product owner's direction. What changed, and only
> for `truckkoo-app`:
>
> | This document says | The app now does |
> |---|---|
> | Depth comes from 1px borders, never shadows | Depth comes from soft shadows and `#f2f2f2` fills; hairlines only divide rows *inside* a surface |
> | Radii 10 / 12 / 14–16 | Radii 12 / 16 / 20 / 24 |
> | Spacing scale `6 10 14 18 22 26 34 56` | An 8pt grid: `4 8 12 16 20 24 32 48` |
> | No icon tiles | One icon family (MaterialCommunityIcons) in circular chips, 24px, via `src/components/icon.tsx` |
> | Ruled label-over-value form fields | Filled 56pt inputs and picker rows |
> | — | A bottom tab bar, a pinned CTA per screen, and one 32/900 statement per screen |
>
> **The app's system is `src/theme/tokens.ts`**, which is the authority for
> anything in this repo, and `src/components/{primitives,ui}.tsx`, which are the
> only places those tokens are assembled into shapes. The two design languages
> are deliberately allowed to differ: a marketing page read at desk distance and
> a tool used one-handed in a truck cab are not the same problem. What holds them
> together is the palette, the weights, and the voice.

---

## 1. Color

One accent (orange), everything else black/white. No secondary hues, no
multi-color gradients.

| Token | Hex | Use |
|---|---|---|
| `--orange` | `#f1551f` | The single accent — CTAs, numbers, icons, eyebrows, hover borders |
| `--orange-deep` | `#d9430f` | Pressed / gradient variant |
| `--orange-soft` | `#feeee7` | Faint hero glow wash, callout boxes |
| `--ink` | `#0b0b0b` | Body text, near-black |
| `--ink-soft` | `#6b6b6b` | Secondary text (4.5:1 safe on white and `#f6f6f6`) |
| `--sand` / `--paper` | `#ffffff` | Page + card background |
| `--sand-deep` | `#f6f6f6` | Input fields, alternating section background |
| `--line` | `#e8e8e8` | Every border on light backgrounds |
| `--asphalt` | `#0b0b0b` | Dark section background |
| `--asphalt-2` | `#161616` | Card background *inside* dark sections |
| `--asphalt-line` | `#2c2c2c` | Borders inside dark sections |
| — | `#a3a3a3` | Body text on dark |
| — | `#ff7a4d` | Lightened orange — accent on dark / over photos |
| `--wa` | `#1fa855` | WhatsApp green, functional only |

**Rules**

- Light and dark sections alternate down the page. Each mode has its own
  card / border / muted-text triple — never reuse light-mode borders on dark.
- **`#f1551f` fails contrast on WHITE, not on black — this was stated backwards
  here until 2026-07-26, and the error shipped a WCAG failure.** Measured:
  orange on `#ffffff` is **3.47:1** (fails AA's 4.5:1); orange on `--asphalt`
  `#0b0b0b` is **5.68:1** and on `--asphalt-2` `#161616` is **5.22:1** (both
  pass). The old wording pointed the reader at the safe direction, and the
  primary button — white label on an orange fill, 3.47:1 — passed review for
  months because of it.
  - **Orange text on light surfaces must be large** (≥18.66px bold or ≥24px), or
    it fails. This is why `font.button` is 19/900 and must not drop.
  - **`#ff7a4d` on dark is still the house preference**, but on legibility rather
    than contrast: it reaches 7.63:1 and saturated orange on near-black vibrates.
    Do not describe it as a contrast fix.
  - Ratios are asserted in `tests/unit/contrast.test.ts`. Change a colour or a
    type size and that suite tells you what it did.
- Green is reserved for WhatsApp actions. It is not a general "success" color
  in the marketing UI, though an app may reuse it as one.

### Photo treatment

Photographs always sit under a veil so text stays ≥4.5:1 and the brand colors
read through:

```css
/* desktop — dark on the text side, warm orange wash on the far edge */
linear-gradient(105deg,
  rgba(8,8,8,.94) 0%, rgba(8,8,8,.82) 34%,
  rgba(11,11,11,.42) 72%, rgba(217,67,15,.30) 100%);

/* phone — content is full width, so use a uniform bottom-up wash */
linear-gradient(to top,
  rgba(8,8,8,.95) 0%, rgba(8,8,8,.80) 55%, rgba(8,8,8,.66) 100%);
```

---

## 2. Typography

- **Archivo** — Latin. **Almarai** — Arabic. Weights loaded: 400, 500, 600, 800,
  900, plus italic 800/900.
- Only three weights in practice: **600** (nav, small print), **800** (labels,
  buttons, subheads), **900** (all headings). Body copy is the only 400.
- Headings: weight 900, `letter-spacing: -0.02em`, `line-height: 1.04–1.12`.
  Tight and heavy.

| Role | Size |
|---|---|
| Hero title | `clamp(2rem, 7.4vw, 4.2rem)` |
| Section title | `clamp(1.7rem, 5.6vw, 2.6rem)` |
| Page-hero title | `clamp(1.9rem, 6vw, 3.4rem)` |
| Card heading | `1.05–1.15rem`, weight 800 |
| Body | `1rem / 1.6` |
| Long-form legal | `1rem / 1.75` |
| Small print | `0.8–0.92rem` |

**Signature patterns**

- **Eyebrow label** above every section title: `.75rem`, weight 800,
  `letter-spacing: .24em`, UPPERCASE, orange.
- One italic orange word inside a headline (`.hero-title em`) is the emphasis
  device.
- Arabic resets every `letter-spacing` to `0` — tracking is a Latin-only
  treatment.

---

## 3. Shape & depth

- Radii: **10px** buttons and inputs · **12px** cards (`--radius`) ·
  **14–16px** larger panels · **999px** chips and pills · **50%** numbered
  circles.
- Shadow is nearly invisible:
  `0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)`.
  Depth comes from **1px borders**, not shadows.
- Colored shadows only under filled buttons:
  `0 4px 14px rgba(241,85,31,.4)` orange, `rgba(31,168,85,.25)` WhatsApp.
- Card recipe: white bg + 1px `--line` + the tiny shadow. Hover →
  `border-color: var(--orange)` + `translateY(-3px)`.

---

## 4. Spacing & layout

- Container `max-width: 1080px`, `padding-inline: 22px` (16px below 360px).
- Section padding: **60px** phone → **84px** tablet → **110px** desktop.
- Grid gap is almost always **14px**; form fields 14px; chips 10px.
- Spacing scale in use: `6 10 14 18 22 26 34 56`.
- Breakpoints: **640px** (1 → 2 col, desktop form layout), **900px**
  (2 → 3 col, desktop nav replaces hamburger).
- Mobile-first: every grid starts at `1fr` and widens.

---

## 5. Motion

- Durations: `.18s ease` interactive · `.2s` cards · `.35s` sheets/banners ·
  `.6s` scroll reveal · `.7s cubic-bezier(.2,.7,.2,1)` image zoom.
- Buttons: `:hover { translateY(-2px) }`, `:active { scale(.97) }`.
- Scroll reveal: `opacity 0 → 1` with `translateY(22px) → 0`.
- Ambient loops: marquee strip 28s, driving truck 8s (shortened to 6s/4s on
  narrow screens so perceived px-per-second stays constant), wheel roll 0.9s,
  WhatsApp pulse 2s.
- A full `prefers-reduced-motion: reduce` block disables marquee, pulse,
  wheel-roll, scroll reveal and smooth scrolling.

---

## 6. Accessibility conventions

Worth carrying into the app verbatim.

- `:focus-visible { outline: 3px solid var(--orange); outline-offset: 2px }` —
  switched to white inside dark and orange sections.
- Every tap target ≥ **44px** (`min-height: 44px` on toggles, nav links, phone
  and email links).
- Skip link parked at `top: -64px`, drops to `top: 8px` on focus.
- Input placeholders forced to `#6b6b6b` at `opacity: 1` so they clear 4.5:1 on
  the `#f6f6f6` field background.
- Logical properties throughout (`inset-inline-start`, `padding-inline`,
  `text-align: start`) because the site is RTL-capable. Adopt these from day one
  if the app may ever ship Arabic.

---

## 7. App token export — SUPERSEDED for the app

> **This section, and everything above it, describes the WEBSITE.** The app no
> longer derives from it. Since the July 2026 redesign the app's system is
> `src/theme/tokens.ts` plus `src/theme/faces.ts`, assembled into shapes in
> `src/components/primitives.tsx` (controls) and `src/components/ui.tsx`
> (layout). See `CLAUDE.md` §Design and
> `docs/superpowers/specs/2026-07-30-redesign-p0-foundations-design.md`.
>
> The app differs from what follows in ways that matter, so do not copy from
> here into the app:
>
> - **Two grounds, not one.** Ink `#0B0C0F` for reading state, cream `#F4F0E9`
>   for asking a question. The website's white/`#f6f6f6` pair is neither.
> - **Depth from shadow and filled surfaces**, reversing §3. Hairlines only
>   divide rows inside a surface — a 1px rule at arm's length is invisible and
>   gives a tappable area no bounds.
> - **Three type families**, and every token names a `fontFamily`: Archivo,
>   Instrument Serif (questions and hero numbers only), IBM Plex Sans Arabic.
>   Almarai is gone. A bare `fontWeight` on a custom family is a silent no-op.
> - **The accent is never text.** `#f1551f` on cream is 3.05:1; `#FF7A45` is the
>   on-dark text tone.
> - The app's spacing is an 8pt grid, not `6 10 14 18 22 26 34 56`.
>
> What still holds in both: one accent, specifics over adjectives, WCAG 2.1 AA,
> and every tap target ≥44pt.

For the **website** — React Native / Flutter / Tailwind config:

```
primary        #f1551f    primaryDark   #d9430f    primaryOnDark  #ff7a4d
primarySoft    #feeee7
bg             #ffffff    bgAlt         #f6f6f6    bgDark         #0b0b0b
surfaceDark    #161616    border        #e8e8e8    borderDark     #2c2c2c
text           #0b0b0b    textMuted     #6b6b6b    textOnDark     #a3a3a3
textOnDarkDim  #8a8a8a    success/wa    #1fa855

radius   10 / 12 / 16 / 999
space    6 10 14 18 22 26 34 56
weights  600 / 800 / 900
fonts    Archivo (Latin), Almarai (Arabic)
```

Keep the four load-bearing decisions — single orange accent, 900-weight tight
headlines, hairline borders over shadows, alternating light/dark sections with
their own color pairs — and the **website** will read as the same brand.

The app reaches the same brand by different means, deliberately: a website is
read at desk distance and an app is read one-handed, in sunlight, in a truck cab.
Two of those four decisions were reversed for it (shadows over hairlines, and two
grounds rather than alternating sections). The accent and the voice carried over
unchanged, and those are what make it recognisable.
