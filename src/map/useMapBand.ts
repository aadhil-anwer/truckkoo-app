/**
 * Where a map screen's sheet starts, so the map can fit above it.
 *
 * Every map-plus-sheet screen draws its map in a fixed band behind a scroll view
 * whose content — the sheet — sits at the bottom and grows with what it holds.
 * The sheet's top edge therefore moves per screen and per load, and the only
 * honest source for it is layout. This adds the scroll view's offset in the
 * screen to the sheet's offset inside the scroll content.
 *
 * Measured at rest (scroll offset 0). Scrolling the sheet up later covers more
 * of the map, which is the user's choice; re-fitting the projection mid-scroll
 * would make the coastline swim.
 */

import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export function useMapBand() {
  const [scrollY, setScrollY] = useState<number | null>(null);
  const [sheetY, setSheetY] = useState<number | null>(null);

  const onScrollLayout = useCallback((e: LayoutChangeEvent) => {
    setScrollY(e.nativeEvent.layout.y);
  }, []);
  const onSheetLayout = useCallback((e: LayoutChangeEvent) => {
    setSheetY(e.nativeEvent.layout.y);
  }, []);

  return {
    onScrollLayout,
    onSheetLayout,
    /** The sheet's top edge in screen pixels, once both layouts have arrived. */
    sheetTop: scrollY != null && sheetY != null ? scrollY + sheetY : undefined,
  };
}
