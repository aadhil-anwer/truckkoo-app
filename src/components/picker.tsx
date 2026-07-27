/**
 * One picker for cities, truck types, and dates.
 *
 * A full-screen sheet is the deliberate choice here, not laziness: 46 cities will
 * not fit inline, a wheel picker is unreadable in a moving cab, and a native
 * `<select>` has no RN equivalent worth having. One sheet used for every choice
 * means the control vocabulary never drifts between screens (operate.md).
 *
 * The closed state is a ruled row that reads as a form field being filled in —
 * the same label-over-rule pair as a text input, so a filled picker and a filled
 * text field look like the same document.
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
import { color, doc, font, MIN_TARGET, space } from '@/theme/tokens';

import { Rule } from './primitives';

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
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected ? selected.label : placeholder}`}
        style={({ pressed }) => [
          styles.row,
          !!error && styles.rowError,
          pressed && { backgroundColor: color.paperDeep },
        ]}
      >
        <Text
          style={[styles.rowValue, !selected && { color: color.inkSoft }]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        {/* A chevron drawn from type, not an icon dependency. Mirrors in RTL
            because the glyph itself is direction-neutral in this rotation. */}
        <Text style={styles.chevron} accessibilityElementsHidden>
          ▾
        </Text>
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
              {(sheetTitle ?? label).toUpperCase()}
            </Text>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={styles.sheetClose}
              hitSlop={12}
            >
              <Text style={styles.sheetCloseText}>{t('common.close')}</Text>
            </Pressable>
          </View>
          <Rule strong />

          {searchable && (
            <>
              <View style={styles.searchWrap}>
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
              <Rule />
            </>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={Rule}
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
                      pressed && { backgroundColor: color.paperDeep },
                      isSelected && { backgroundColor: color.orangeSoft },
                    ]}
                  >
                    <View style={styles.optionText}>
                      <Text
                        style={[styles.optionLabel, isSelected && { color: color.orangeDeep }]}
                      >
                        {item.label}
                      </Text>
                      {!!item.detail && <Text style={styles.optionDetail}>{item.detail}</Text>}
                    </View>
                    {isSelected && <Text style={styles.tick}>●</Text>}
                  </Pressable>
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
  field: { gap: 4 },
  fieldLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },

  row: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: doc.ruleStrong,
    borderBottomColor: color.line,
  },
  rowError: { borderBottomColor: color.danger },
  rowValue: { ...doc.fieldValue, color: color.ink, flex: 1, textAlign: align.start },
  chevron: { fontSize: 14, color: color.inkSoft },
  errorText: { ...font.smallPrint, color: color.danger, marginTop: 6, textAlign: align.start },

  sheet: { flex: 1, backgroundColor: color.paper },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    minHeight: 52,
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    color: color.ink,
    flexShrink: 1,
  },
  sheetClose: { minHeight: MIN_TARGET, justifyContent: 'center', paddingStart: space.md },
  sheetCloseText: { ...font.label, color: color.orange },

  searchWrap: { paddingHorizontal: space.xl, paddingVertical: space.sm },
  search: { ...doc.fieldValue, color: color.ink, minHeight: MIN_TARGET },

  group: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    backgroundColor: color.paper,
  },
  groupText: { ...doc.fieldLabel, color: color.orange, textAlign: align.start },

  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { ...font.cardTitle, color: color.ink, textAlign: align.start },
  optionDetail: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
  tick: { fontSize: 12, color: color.orange },

  empty: { padding: space.xl },
  emptyText: { ...font.body, color: color.inkSoft, textAlign: align.start },
});
