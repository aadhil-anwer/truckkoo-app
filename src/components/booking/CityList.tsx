/**
 * The searchable city list.
 *
 * The complete index of the 46 cities, and the reason a shipper is never blocked
 * by the map: Riyadh and Jeddah cannot be pins (they fall outside the map's
 * framing) but they are always here.
 *
 * Each row carries the ARABIC NAME BENEATH THE ENGLISH even in English, which is
 * from the handoff and is load-bearing for this audience — a driver or clerk
 * reading over a shoulder may only recognise one of the two.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableSurface } from '@/components/primitives';
import { SectionLabel } from '@/components/ui';
import { face } from '@/theme/faces';
import { alpha, color, font, hairline, radius, space } from '@/theme/tokens';
import { align, t } from '@/i18n';
import type { City } from '@/lib/queries';

export function CityList({
  cities,
  selectedId,
  onSelect,
  excludeId,
}: {
  cities: City[];
  selectedId: number | null;
  onSelect: (city: City) => void;
  /** The other endpoint — a load cannot start and end in the same place. */
  excludeId?: number | null;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = cities.filter((c) => {
      if (excludeId != null && c.id === excludeId) return false;
      if (!q) return true;
      // Search both names: a user typing Arabic must find the same row.
      return c.name_en.toLowerCase().includes(q) || c.name_ar.includes(query.trim());
    });

    const byGroup = new Map<string, City[]>();
    for (const c of matches) {
      const key = c.corridor ?? c.country;
      const list = byGroup.get(key);
      if (list) list.push(c);
      else byGroup.set(key, [c]);
    }
    return [...byGroup.entries()];
  }, [cities, query, excludeId, /* query is trimmed above */]);

  return (
    <View style={styles.wrap}>
      <View style={styles.search}>
        <Icon name="search" size={19} tint={alpha.onInk.tertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('book.origin.search')}
          placeholderTextColor={alpha.onInk.tertiary}
          style={styles.searchInput}
        />
      </View>

      {groups.map(([group, list]) => (
        <View key={group} style={styles.group}>
          <SectionLabel accent>{group}</SectionLabel>
          {list.map((city) => {
            const selected = city.id === selectedId;
            return (
              <PressableSurface
                key={city.id}
                onPress={() => onSelect(city)}
                accessibilityLabel={`${city.name_en}. ${city.name_ar}`}
                style={[styles.row, selected && styles.rowOn]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.en}>{city.name_en}</Text>
                  {/* `direction: rtl` with a leading text-align: the Arabic must
                      shape correctly while still sitting under the English. */}
                  <Text style={styles.ar}>{city.name_ar}</Text>
                </View>
                {selected && (
                  <View style={styles.check}>
                    <Icon name="check" size={16} stroke={2.4} tint={color.accent} />
                  </View>
                )}
              </PressableSurface>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.lg,
    borderRadius: radius.round,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderColor: hairline.card,
  },
  searchInput: { flex: 1, ...font.body, color: color.lightText, textAlign: align.start },
  group: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.row,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowOn: { backgroundColor: color.raised, borderColor: color.accent },
  rowText: { flex: 1, gap: 1 },
  en: { ...font.rowTitle, color: color.lightText, textAlign: align.start },
  ar: {
    fontFamily: face.arabic400,
    fontSize: 13.5,
    lineHeight: 23,
    color: alpha.onInk.tertiary,
    writingDirection: 'rtl',
    textAlign: align.start,
  },
  check: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(241,85,31,.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
