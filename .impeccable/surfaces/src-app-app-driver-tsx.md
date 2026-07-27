---
version: 1
slug: "src-app-app-driver-tsx"
primary_target: "src/app/(app)/driver.tsx"
related_targets: ["src/app/(app)/customer.tsx","src/components/waybill-book.tsx"]
---

## Scope

The two role home screens — `src/app/(app)/driver.tsx` and
`src/app/(app)/customer.tsx` — and the shared `src/components/waybill-book.tsx`
they are both built from. Visitor mode: **Operate**.

## Audience and job

- **Driver.** One active trip at a time, 2–5 offers queued behind it, a handful
  of declared routes ahead. Used one-handed, in a cab, in sun, on patchy signal.
  Offers arrive by push (planned), so the offer is legitimately time-boxed and
  `offers.expires_at` is shown as "Reply by".
- **Shipper.** One or two loads at a time and a short history. The dominant
  early state is a single load waiting, so the wait is what the screen has to
  handle well.

Both have near-zero tech skills. One decision per screen outranks density.

## Chosen direction

**The waybill book.** Both homes are a bound docket: printed tab strip as the
index, one full-width sheet per page, a 12pt sliver of the next sheet showing at
the trailing margin. Sheets are turned, not scrolled past.

- Each offer is its own sheet, so accepting a load is a decision that filled the
  screen rather than a card someone stopped on.
- Sections with a list (declared routes, finished loads) render as ruled
  `LedgerRow`s inside one sheet — still a document, not a card stack.
- A single-section book hides the tab strip entirely: a first-run shipper meets
  one page and one action.

Memorable moment: the tab's hairline inking to a 2px orange rule as its section
becomes current — the only authored motion; everything else is the platform's
own page snap.

## Constraints carried

- One orange per screen. A sheet declares `hasPrimary`, and the pinned footer
  action steps down to `secondary` when the visible sheet already owns it.
- Shipper load sheets carry no action: there is nothing for a shipper to do
  while a load moves, and a button there would misstate where the work is.
  `finding_truck` is the exception and offers the WhatsApp human backstop.
- Page index comes from `onViewableItemsChanged`, never from `contentOffset`
  arithmetic — pixel maths is what breaks under RTL.

## Unresolved

- The horizontal pager has not been run in Arabic on a device. Recorded in
  OPEN_ISSUES.md.
- Whether a driver with no push permission needs a different offers affordance;
  the count on the tab is the current answer.
