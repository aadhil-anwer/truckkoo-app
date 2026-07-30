/**
 * The client's view of city coordinates.
 *
 * Three layers guard this data and each catches something the others cannot:
 *
 *   - `0020`'s constraints catch NULL, out-of-region, and a transposed lat/lng.
 *   - `supabase/tests/tenant_isolation.sql` catches the same plus duplicates.
 *   - `npm run check:pins` catches a coordinate in the sea, by testing
 *     containment against the outline the app actually draws.
 *
 * This file guards the remaining gap: the **query**. If `lat`/`lng` drop out of
 * the select list, nothing errors — every pin projects from `undefined`, they all
 * land in the same corner, and it reads as a projection bug for an afternoon.
 */

import { CITY_COLUMNS } from '@/lib/queries';

describe('the cities query', () => {
  it('selects the coordinates the map needs', () => {
    expect(CITY_COLUMNS).toContain('lat');
    expect(CITY_COLUMNS).toContain('lng');
  });

  it('still selects both names, so the list can localise', () => {
    // The map labels and the city list both read from this one query.
    expect(CITY_COLUMNS).toContain('name_en');
    expect(CITY_COLUMNS).toContain('name_ar');
  });

  it('selects the id, which every load and leg references', () => {
    expect(CITY_COLUMNS.split(',').map((c) => c.trim())).toContain('id');
  });
});
