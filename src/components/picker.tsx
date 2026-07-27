/**
 * One picker for cities, truck types, and dates.
 *
 * A full-screen sheet is the deliberate choice here, not laziness: 46 cities will
 * not fit inline, a wheel picker is unreadable in a moving cab, and a native
 * `<select>` has no RN equivalent worth having. One sheet used for every choice
 * means the control vocabulary never drifts between screens.
 *
 * The closed state is now a filled row with a leading icon — the same shape as
 * `ListRow` and the same shape as `Input`, so a form reads as one kind of thing.
 * It used to be a ruled line, which gave a 44pt-tall target no visible bounds:
 * on a phone you were aiming at a 1px rule with a gloved thumb.
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { align, t } from '@/i18n';
import { formatLongDay, isoToday } from '@/lib/format';
import {
  color,
  CTA_HEIGHT,
  doc,
  font,
  GUTTER,
  HIT_SLOP,
  MIN_TARGET,
  radius,
  space,
} from '@/theme/tokens';

import { Icon, type IconName } from './icon';

/**
 * The next N days as picker choices.
 *
 * A calendar grid is the wrong control for this audience and this task: freight
 * is booked days out, not months, and a list of real dates with weekday names
 * needs no explanation and no date-picker dependency.
 *
 * Lives here rather than in each screen because post-load and post-leg both
 * offer a date and must never disagree about what "today" means — the two dates
 * end up on the same match.
 */
export function nextDays(count: number): PickerOption[] {
  const out: PickerOption[] = [];
  for (let i = 0; i < count; i++) {
    // ISO date only — the column is a `date`, and sending a timestamp would let
    // the device's timezone shift the day.
    const iso = isoToday(i);
    out.push({
      value: iso,
      label: formatLongDay(iso),
      detail: i === 0 ? t('date.today') : i === 1 ? t('date.tomorrow') : undefined,
    });
  }
  return out;
}

export type PickerOption = {
  value: string;
  label: string;
  /** Secondary line — a truck's description, a city's country, a date's weekday. */
  detail?: string;
  /** Group heading. Cities use their corridor; dates use nothing. */
  group?: string;
};

type Props = {
  label: string;
  /** Shown in the closed row when nothing is chosen yet. */
  placeholder: string;
  value: string | null;
  options: PickerOption[];
  onChange: (value: string) => void;
  searchable?: boolean;
  error?: string | null;
  /** Title of the open sheet. Defaults to the field label. */
  sheetTitle?: string;
  /** Leading icon on the closed row. What the field is *about*, not decoration. */
  icon?: IconName;
};

export function PickerField({
  label,
  placeholder,
  value,
  options,
  onChange,
  searchable = false,
  error,
  sheetTitle,
  icon,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    // Match label OR detail, so typing an Arabic name finds an English row and
    // vice versa when both are present on the option.
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.detail?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected ? selected.label : placeholder}`}
        style={({ pressed }) => [
          styles.row,
          !!error && styles.rowError,
          pressed && { backgroundColor: color.fillPress },
        ]}
      >
        {!!icon && (
          <View style={styles.rowIcon}>
            <Icon name={icon} size={20} color={selected ? color.ink : color.inkSoft} />
          </View>
        )}
        <Text
          style={[styles.rowValue, !selected && { color: color.inkSoft }]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Icon name="chevron" size={20} color={color.inkFaint} />
      </Pressable>

      {!!error && (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={close}
      >
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {sheetTitle ?? label}
            </Text>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={styles.sheetClose}
              hitSlop={HIT_SLOP}
            >
              <Icon name="close" size={22} color={color.ink} />
            </Pressable>
          </View>

          {searchable && (
            <View style={styles.searchWrap}>
              <Icon name="search" size={20} color={color.inkSoft} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('common.search')}
                placeholderTextColor={color.inkSoft}
                style={[styles.search, { textAlign: align.start }]}
                autoCorrect={false}
                autoFocus
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t('common.noMatches')}</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = filtered[index - 1];
              const showGroup = !!item.group && item.group !== prev?.group;
              const isSelected = item.value === value;

              return (
                <>
                  {showGroup && (
                    <View style={styles.group}>
                      <Text style={styles.groupText}>{item.group!.toUpperCase()}</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={({ pressed }) => [
                      styles.option,
                      pressed && { backgroundColor: color.fill },
                    ]}
                  >
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.detail && (
                        <Text style={styles.optionDetail} numberOfLines={1}>
                          {item.detail}
                        </Text>
                      )}
                    </View>
                    {isSelected && <Icon name="check" size={22} color={color.orange} />}
                  </Pressable>
                  <View style={styles.optionDivider} />
                </>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.sm },
  fieldLabel: { ...font.label, color: color.ink, textAlign: align.start },

  row: {
    minHeight: CTA_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.fill,
    borderRadius: radius.control,
    borderWidth: doc.ruleStrong,
    borderColor: 'transparent',
  },
  rowError: { borderColor: color.danger },
  rowIcon: { width: 24, alignItems: 'center' },
  rowValue: { ...font.body, fontWeight: '600', color: color.ink, flex: 1, textAlign: align.start },
  errorText: { ...font.smallPrint, color: color.danger, textAlign: align.start },

  sheet: { flex: 1, backgroundColor: color.paper },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: GUTTER,
    paddingVertical: space.md,
    minHeight: 56,
  },
  sheetTitle: { ...font.hero, color: color.ink, flexShrink: 1, textAlign: align.start },
  sheetClose: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: radius.pill,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: GUTTER,
    marginBottom: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: color.fill,
    borderRadius: radius.control,
  },
  search: { ...font.body, color: color.ink, minHeight: CTA_HEIGHT, flex: 1 },

  list: { paddingBottom: space.xxl },
  group: {
    paddingHorizontal: GUTTER,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    backgroundColor: color.paper,
  },
  groupText: { ...doc.fieldLabel, color: color.orange, textAlign: align.start },

  option: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: space.md,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { ...font.rowTitle, color: color.ink, textAlign: align.start },
  optionDetail: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
  // Inset both edges, not just the start. `marginStart` alone shifts a
  // full-bleed row without shrinking it, so the rule ran off the screen.
  optionDivider: { height: doc.rule, backgroundColor: color.line, marginHorizontal: GUTTER },

  empty: { padding: space.xl },
  emptyText: { ...font.body, color: color.inkSoft, textAlign: align.start },
});
