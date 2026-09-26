# Truckkoo redesign — P2 · Getting in

**Date:** 2026-07-30
**Status:** RESUMING (2026-09-26) — codes over **WhatsApp**, not SMS. Decisions
below in §0a; the sections after it still say SMS and need rewriting to match
before the build starts.
**Depends on:** P0 (complete), P1 (complete)
**Screens:** N1–N6, plus one the handoff did not draw

---

## 0a. Decisions taken 2026-09-26 (owner)

- **Delivery: WhatsApp via Meta's WhatsApp Cloud API**, directly — not Twilio,
  not Omantel (Omantel's SMS API only reaches Omantel subscribers, and its OTP
  API generates its own codes, which would mean bypassing Supabase sign-in).
- **Mechanism: Supabase's Send SMS hook (HTTP)** → a Supabase Edge Function that
  sends Supabase's code as an approved WhatsApp *Authentication* template (EN and
  AR). Supabase still generates and verifies every code; sessions are unchanged.
  The function verifies the hook's Standard Webhooks signature, and needs only
  the Meta token and the hook secret as function secrets — **no service-role
  key**. Never `EXPO_PUBLIC_`.
- **The GCC allowlist is enforced inside that function**, before anything is
  sent: +968, +971, +966, +974, +965, +973. This replaces the unverified
  `before_user_created` question in §6.
- **No fallback.** Someone without WhatsApp signs in with Google (N1 keeps it).
- **The code is 6 digits, not 4.** The hook payload's `sms.otp` is always
  `^[0-9]{6}$`. N3 draws 6 boxes.
- **Template language** follows the user's app language, carried in
  `user_metadata.language` (set at sign-in and kept in step by `setLanguage`).
- **To verify on the local stack during the build** (the docs do not say):
  whether `[auth.sms.test_otp]` numbers bypass the hook; whether
  `[auth.rate_limit] sms_sent` still applies with a hook; the exact
  `[auth.hook.send_sms]` config keys.
- **Owner's setup, in progress:** verified Meta Business, a WhatsApp Business
  number on the Cloud API, an approved Authentication template (EN + AR), a
  permanent System User token.

## 0. Deferred

**P2 is parked at the owner's direction: SMS is being moved to a later date.**
Nothing was built. The only change made was to `supabase/config.toml`, and it was
reverted — the working tree carries no half-applied state.

**Why the whole phase parks, not just the SMS part.** N4 (role), N4b (name) and
N5 (truck class) look independent, but they run *after* an authenticated session
exists. Today that session comes from the email screens, which decision A1
deletes. So building the back half of P2 while the front half waits would mean
either keeping email auth (contradicting A1) or shipping screens nothing can
reach. Neither is worth the churn.

**What this unblocks instead.** P3 (shipper booking, S1–S10) does **not** depend
on P2 — it needs P0's vocabulary and P1's map, both of which are done. P3 is the
next buildable phase, and it is where the map, the question pattern and the
booking flow all finally become a product someone can use.

**To resume P2**, in order:
1. Point Supabase Auth at the SMS provider (production dashboard).
2. Re-apply the local `[auth.sms.test_otp]` block so the flow is testable without
   spending anything.
3. Settle the open question in §6 — whether `before_user_created` fires *before*
   the SMS is sent. That determines whether the GCC allowlist is enforcement or
   merely advice, and it is the one thing in this spec that was never verified.

---

## 1. What P2 is for

Replace an email + 8-character-password wall with a phone number and a one-time
code: nothing to remember, nothing to lose. For an audience where many have never
installed an app before, this is the single largest usability change in the
redesign.

Role is chosen here and is **permanent**.

---

## 2. The step the handoff did not draw

The gallery numbers its steps: N2 is `1/5`, N3 is `2/5`, N4 is `3/5`, N5 is
`5/5`. **There is no step 4.** But N6 greets the user by name — "You are on,
Salim." — and nothing before it ever asks for one.

So step 4 is a name question that was specified by implication and never drawn.
P2 builds it, in the same cream question pattern as its neighbours:

> **What should we call you?**
> Helper: "It goes on the paperwork, and it is what the driver will see."

That also resolves the `/5`: the total is **role-dependent**, which is why N5 is
`5/5` while N4 is `3/5`.

| Step | Shipper | Driver |
|---|---|---|
| 1 | Phone (N2) | Phone (N2) |
| 2 | Code (N3) | Code (N3) |
| 3 | Role (N4) | Role (N4) |
| 4 | Name | Name |
| 5 | — | Truck class (N5) |
| **Total** | **4** | **5** |

---

## 3. Decisions taken

| # | Decision | Why |
|---|---|---|
| A1 | **Phone OTP is the only path users see.** The email sign-in, sign-up, reset and confirm screens are deleted. | The handoff replaces the flow wholesale; nothing has shipped to real users; and two auth paths mean two sets of edge cases for an audience that struggles with one. |
| A2 | **Google sign-in stays** (N1 offers it) and is unchanged. | It already works, it is a one-tap path, and it sidesteps SMS cost entirely for users who have it. |
| A3 | **Abuse control is a GCC number allowlist plus tightened rate limits**, not CAPTCHA. | Chosen explicitly, accepting that an attacker operating inside GCC ranges still costs money. See §6 — the allowlist is worthless unless it is enforced server-side, and that is the real work here. |
| A4 | **Local development uses `[auth.sms.test_otp]`.** | Supabase's local stack maps a phone number to a fixed code, so the whole flow is buildable and testable with no provider, no key and no spend. Production flips on Twilio and nothing in the app changes. |
| A5 | **`profiles.phone` is derived from the verified identity, never from client input.** | See §6. |
| A6 | **Role stays write-once.** | Already structural: `profiles.role` carries an INSERT grant and no UPDATE grant, so the UI's "it cannot be changed later" is enforced by the schema and not by the screen. Unchanged by P2 — but now the copy says so out loud, so it must stay true. |

---

## 4. Screens

All cream question screens reuse P0's `StepHeader`, `QuestionHeading`,
`SelectRow`/`SelectCard`, `PrimaryButton`. Nothing new is invented.

- **N1 · Welcome** — ink. The P1 map at the regional framing behind the `hero`
  scrim, wordmark, `Continue with my number`, `Continue with Google`, legal line.
  The two decorative pins in the mockup become real `CityPin`s at Muscat and
  Sohar rather than absolute-positioned dots.
- **N2 · Phone** — cream. `+968` dial prefix, the number, a `#F1551F` caret.
  **The drawn custom keypad is not built** — see §5.
- **N3 · Code** — cream. Four digit boxes, resend countdown, disabled primary
  until four digits.
- **N4 · Role** — cream. Two `SelectCard`s. The helper is explicit about
  permanence, and the primary restates the choice ("I drive a truck — continue").
- **N4b · Name** — cream. The undrawn step, above.
- **N5 · Truck class** — cream, driver only. Five `SelectRow`s with
  plain-language subtitles, not specs.
- **N6 · Done** — ink. Accent bloom, check tile, confirmation card, and a primary
  that sets up the next action rather than dead-ending.

**Auto-advance:** selecting on a single-choice screen (N4, N5) advances after a
~180 ms confirmation beat, so the button is a fallback rather than a required
second tap. Text and numeric entry (N2, N3, N4b) still need the button.

---

## 5. The keypad is not built

N2 draws a custom numeric keypad on a `#DDD8D0` tray. P2 uses the **platform
keyboard** with `keyboardType="phone-pad"` instead.

A hand-built keypad means owning key repeat, haptics, accessibility focus order,
paste, hardware keyboards, RTL digit entry and every OS keyboard setting a user
has already configured — including larger text, which is exactly what this
audience turns on. The platform keypad is the same twelve targets, already
correct, already familiar.

The mockup's keypad is preserved as *layout intent* — the field sits high enough
that the keyboard never covers it.

Recorded as a deliberate departure in `OPEN_ISSUES.md`.

---

## 6. Security

This is the part of P2 that is not screens.

**The number allowlist must be enforced server-side.** A prefix check in the app
is UX — it stops a typo, not an attacker, who does not use the app at all and
posts straight to the auth endpoint. P2 must therefore:

1. Validate `+968` and the five other GCC prefixes in the client, for the error
   message.
2. Enforce the same list in Supabase via the `before_user_created` hook, so a
   non-GCC number is rejected **before** an SMS is paid for. If that hook proves
   to fire after the send rather than before, the enforcement point is wrong and
   the residual risk gets recorded rather than papered over.
3. Tighten `[auth.rate_limit]`: lower `sms_sent`, and keep `max_frequency` so one
   number cannot be re-triggered in a loop.

**`profiles.phone` comes from the verified identity, not the client.** The
profile row is inserted by the client, and `phone` carries an INSERT grant — so
nothing currently stops a user writing a number they do not own into their own
profile. That number is what a dispatcher would call. P2 pins it to
`auth.jwt() ->> 'phone'` with a trigger or a check constraint, so the profile
cannot disagree with the identity.

**No new client grant, no loosened policy.** If P2 finds itself needing either,
that is the signal to stop and ask.

---

## 7. Tests

| Test | Protects |
|---|---|
| GCC prefix validation | that `+44` is rejected, and the six GCC prefixes are not |
| Step counter | 4 steps for a shipper, 5 for a driver — the role-dependent total |
| Role immutability | the schema refuses a second role write, so N4's promise holds |
| `profiles.phone` integrity | a profile insert carrying a phone other than the verified one fails |
| Resend countdown | the resend action is unavailable until the timer expires |
| OTP flow | send → verify → profile, using `test_otp`, end to end |

`npm run verify` and `npm run test:db` both green.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| SMS toll fraud | GCC allowlist enforced server-side + tightened caps (A3). **Residual risk accepted:** an attacker using GCC-range numbers still costs money. Recorded in `OPEN_ISSUES.md` with the Turnstile option noted as the fix if it happens. |
| `before_user_created` may not fire before the SMS is sent | Verify empirically. If it does not, the allowlist is advisory and the residual risk grows — say so rather than implying protection that is not there. |
| Deleting email auth strands an existing account | Nothing has shipped; the only accounts are development ones. Verified before deleting, not assumed. |
| Phone numbers are PII and now the primary identifier | They were already stored. No new exposure, but `SENSITIVE_FIELDS.md` gets updated since `phone` changes from incidental to identifying. |
| A user mistypes their number and cannot receive a code | N3 carries a "Wrong number?" link back to N2, as drawn. |

---

## 9. Definition of done

1. `npm run verify` and `npm run test:db` green.
2. The full flow runs against local Supabase with `test_otp`, for both roles.
3. A non-GCC number is rejected **server-side**, demonstrated.
4. `profiles.phone` cannot be set to a number other than the verified one,
   demonstrated.
5. Email auth screens gone; no dangling routes.
6. `SECURITY.md`, `SENSITIVE_FIELDS.md` and `OPEN_ISSUES.md` updated.
