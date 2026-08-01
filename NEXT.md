# Next session — start here

Say this, or just: **"read NEXT.md and continue"**.

---

## The prompt

> Continue the Truckkoo redesign with **P7 · Shared + Arabic**. Branch is
> `redesign/p0-foundations`; P0–P6 are done and committed. There is no P7 spec or
> plan yet — the P0 spec's phase table says "X1–X4, full RTL mirror audit, no
> backend". Start with brainstorming, then the spec, then the plan, then execute
> inline. Read `OPEN_ISSUES.md` 30 and 35 first: no Arabic screen has ever been
> looked at by a human, and P7 is where that stops being a footnote.

---

## Where things stand (2026-08-01)

**Done:** P0 foundations, P1 map, P2 getting in, P3 shipper booking, P4 price and
track, P5 driver, P6 live GPS. All on `redesign/p0-foundations`, working tree
clean.

**Green at:** 447 JS tests, three SQL suites.

```
npm run verify     # typecheck + lint + tests
npm run test:db    # needs `npx supabase start`, and a FRESH `npx supabase db reset`
```

That reset matters: seeding demo data makes `tenant_isolation` fail on assertions
that have nothing to do with the change under test. The suite's own header says
so and it is easy to forget an hour later.

**Last commit:** `e7d7dfc` — Close P6.

---

## P7 · Shared + Arabic

No spec, no plan. The P0 spec
(`docs/superpowers/specs/2026-07-30-redesign-p0-foundations-design.md`, §3) says:

| Phase | Ships | Backend |
|---|---|---|
| P7 · Shared + Arabic | X1–X4, full RTL mirror audit | none |

So the sequence is **brainstorm → spec → plan → execute**, the same as P5 and P6.
Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.

**The thing P7 exists to fix.** Every screen from P1 onward is verified by tests
only. The strings are in both languages and every screen uses `arabicIfNeeded`
and `align.start`, but **nobody has looked at a driver or tracking screen in
Arabic**. `OPEN_ISSUES` 30 says so plainly. The likeliest breakage is anywhere
copy is composed from fragments — `OfferCard`'s detour line builds four of them
("about", a number, "km", "extra on your route"), which is correct English word
order and merely plausible Arabic.

---

## If you would rather do something else

Two other candidates, either of which is a reasonable "next":

1. **Get it onto a real Android phone.** Nothing in P1–P6 has been seen running
   on hardware. `expo-location` (P6) has never produced a real fix — its tests
   mock the module, so they prove the wiring and the teardown and nothing about
   battery cost or whether fixes arrive in a moving truck. Needs a development
   build, not Expo Go. `OPEN_ISSUES` 30 and 35.
2. **Merge or cut this branch.** `redesign/p0-foundations` carries the entire
   redesign; I have deliberately not merged it, because P7 continues on it.

---

*This file is a handoff note, not documentation. Delete it once P7 is under way.*
