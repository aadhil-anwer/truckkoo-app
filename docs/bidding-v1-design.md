# Driver bidding, v1 (2026-10-04)

Migration `0045_driver_bidding.sql`; tests `supabase/tests/bidding.sql`
(`npm run test:db:bidding`).

## Product decision

New shipper bookings have no fixed quote and show no price at posting. Drivers
invited to the load bid the amount they want to keep, in integer baisa.
Truckkoo adds a private percentage to that amount; the shipper sees the
resulting total with each bid. Settlement remains offline.

**The fee starts at 0% for the first six months.** It is still configured
deliberately (`ops_set_bid_fee(0, '…')`): an unset fee refuses posting rather
than meaning "free". It is snapshotted when a load is posted, so a change during
the window cannot alter what the shipper sees.

**No dispatcher work is intended.** The machine owns the whole auction; a person
hears about a load only when its collection day ends with no bid.

## The window

Defaults are settings in `private.app_settings`, not constants.

- The window is `bid_window_minutes` (60), never past the end of the collection
  day. The shipper can accept any valid bid immediately, close early, or extend
  by up to 24 hours from posting.
- **Target price (optional).** The shipper may give the total they are willing
  to pay, at posting or while the window is open (`set_bid_target`). It is never
  shown to a driver. When the window closes, the lowest eligible bid is
  **awarded outright** if its total is at or under the target; otherwise it is
  proposed and the shipper decides. A bid is never awarded the moment it arrives.
- Selection is the lowest eligible bid, ties by submission time then bid ID. A
  proposal is not a reservation; acceptance re-checks eligibility.
- **No bids when the window closes:** the window reopens and invitations
  continue, until the collection day is over. Only then does the load become
  `finding_truck` and one alert is raised (CLAUDE.md #6).

## How many drivers

No cap on the number of drivers invited over a load's life, but it cannot flood:

- invitations go out in waves of `bid_invites_per_wave` (3), at most one wave
  every `bid_wave_minutes` (5);
- no wave while the load already holds `bid_enough_bids` (5) live bids;
- no driver is sent a wave invitation while holding
  `auto_dispatch_max_pending_per_driver` (3) pending offers;
- a decline is final; a lapsed invitation may be re-sent.

## Who sees what

- **Drivers see competing bids, semi-anonymised** (`driver_load_bids`): bidder
  number, truck type, the amount that driver keeps, and which row is theirs.
  Never a name, phone, town or the shipper's total — totals minus payouts would
  expose the fee.
- Invited drivers see the cargo, the route, the pins and the notes, but **not**
  the contact's name or phone; the winner gets those once assigned.
- The shipper sees each bid as a total with the driver's name and truck type,
  never the payout.
- `loads.price_baisa` stays empty until award, because invited drivers can read
  the load row.

See `SENSITIVE_FIELDS.md` → *Driver bidding*.

## Compatibility

Existing loads, quotes, offers and trips remain on their current path; a
`pricing_mode` column distinguishes bid loads. The old fixed-quote RPCs remain
for installed clients during rollout, and must be retired once the new app is
adopted. Old clients cannot accept a bid invitation (`respond_to_offer` refuses)
or see one (`driver_offers` hides them), and `accept_quote` refuses a bid load
because it carries no price before award.

The offer sweeps and the stuck-load watch ignore bid loads while the auction
runs; `system_bid_tick` (every minute) owns their lifecycle.

## Security and races

- No browsable load board. The server addresses invitations to available
  drivers with a fitting truck — verified when `require_verified_driver` is on,
  the same switch dispatch uses.
- Every bid RPC is a pinned-search-path definer that checks the actor, the
  invitation, eligibility, the load state and the deadline.
- Closing, extending, accepting and the minute job lock the load row first,
  then the offer. One selected bid and `trips.load_id UNIQUE` are the final
  barriers against two winners.
- A stale bid tapped while the window is open is refused and changes nothing; a
  stale tap must not end the auction for everyone. After the window it is
  replaced by the next valid bid, or the window reopens.

## Known gaps

- **Dispatcher paths are not bid-aware.** `ops_send_offer`/`ops_set_price` on a
  bid load would put it on the fixed path. Harmless while no dispatcher acts;
  guard them if that changes.
- `shipper_load_bids.eligible` tells a shipper whether a named driver is still
  online and free.
- With a collection date far away the window keeps reopening, and waves keep
  inviting new drivers, for as long as it takes.
- Visible bids invite last-second sniping. No anti-sniping extension in v1.

## Release order

1. ~~Schema/RPC migration with isolation and race tests~~ — done, local.
2. Build the booking review, driver bid and shipper bid screens on the new RPCs
   (`post_bid_load`, `driver_bid_invites`, `driver_load_bids`,
   `place_driver_bid`, `shipper_load_bids`, `shipper_bid_status`,
   `accept_driver_bid`, `close_bidding`, `extend_bidding`, `set_bid_target`).
   Keep the legacy screens for existing loads.
3. Verify a complete bid-to-assignment flow against local Supabase, then a
   preview Android build on a phone.
4. Set the fee (`ops_set_bid_fee(0, 'launch: no commission for six months')`)
   and deploy the migration before publishing the app update. Check that the
   installed old app cannot create a fixed-price load by accident during the
   rollout. Remove the fake development rate card from any shared database
   before the fixed path takes a real booking.
