/**
 * ── TRANSITIONAL. Every export here is scheduled for deletion. ──────────────
 *
 * P0 replaced the design system: new tokens on two grounds, new type scale, new
 * primitives. It deliberately built none of the 32 redesigned screens — that is
 * phases P1–P7.
 *
 * Which left ~20 screens speaking a vocabulary that no longer exists. This file
 * is that vocabulary, reimplemented on the new tokens, so the app compiles and
 * runs while the redesign lands screen by screen. The screens look transitional
 * on purpose: right colours and type, old layouts.
 *
 * WHY A SEPARATE FILE, rather than keeping the old names in `ui.tsx` and
 * `primitives.tsx`: so the debt is visible and countable.
 *
 *     grep -rl "components/legacy" src/app
 *
 * is exactly the list of screens still awaiting their phase. When that returns
 * nothing, delete this file. As each phase rebuilds a screen from the handoff,
 * that screen's import of this module goes with it — and any export left with no
 * importer should be deleted in the same commit, not left to rot.
 *
 * Rules while it exists:
 *   - Nothing new may import from here. New screens use `ui.tsx` / `primitives.tsx`.
 *   - Do not add exports. If a redesigned screen needs a shape, it belongs in the
 *     real vocabulary, not in here.
 *   - These are styled for the CREAM ground, because the old screens were all
 *     light. Redesigned ink screens use the real primitives.
 */

import { forwardRef, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

import { Icon, type IconName } from './icon';
import { PrimaryButton } from './primitives';
import { align } from '@/i18n';
import { face } from '@/theme/faces';
import {
  GUTTER_INK,
  MIN_TARGET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';

/** The old single gutter. New code picks `GUTTER_INK` or `GUTTER_CREAM`. */
export const GUTTER = GUTTER_INK;

/**
 * The old consignment-note vocabulary, reduced to the two values still read.
 * `picker.tsx` is the only consumer left.
 */
export const doc = {
  rule: 1,
  ruleStrong: 2,
  gutter: space.lg,
  fieldLabel: font.groupLabel,
  fieldValue: font.value,
} as const;

export type StampTone = 'pending' | 'active' | 'done' | 'stopped';

/* ─── text ────────────────────────────────────────────────────────────────── */

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[s.body, muted && s.bodyMuted]}>{children}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode; tone?: 'orange' | 'muted' }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}

export function PageTitle({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={s.pageTitleWrap}>
      <Text style={s.pageTitle}>{children}</Text>
      {!!detail && <Text style={s.pageDetail}>{detail}</Text>}
    </View>
  );
}

export function Rule({ strong = false }: { strong?: boolean; tone?: 'light' | 'dark' }) {
  return <View style={[s.rule, strong && s.ruleStrong]} />;
}

/* ─── containers ──────────────────────────────────────────────────────────── */

export function Note({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[s.note, style]} {...rest}>
      {children}
    </View>
  );
}

export function NoteHead({ left, right }: { left: string; right?: ReactNode }) {
  return (
    <View style={s.noteHead}>
      <Text style={s.noteHeadText}>{left}</Text>
      {right}
    </View>
  );
}

export function RowGroup({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[s.rowGroup, style]} {...rest}>
      {children}
    </View>
  );
}

export function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {!!actionLabel && !!onAction && (
          <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
            <Text style={s.sectionAction}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export function TopBar({
  onBack,
  title,
  action,
}: {
  onBack?: () => void;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <View style={s.topBar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" style={s.topBack}>
          <Icon name="back" size={20} tint={color.lightText} />
        </Pressable>
      ) : (
        <View style={s.topBack} />
      )}
      {!!title && (
        <Text style={s.topTitle} numberOfLines={1}>
          {title}
        </Text>
      )}
      <View style={s.topAction}>{action}</View>
    </View>
  );
}

export function ActionBar({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <View style={s.actionBar}>
      {!!note && <Text style={s.actionNote}>{note}</Text>}
      {children}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  explain,
  children,
}: {
  icon: IconName;
  title: string;
  explain: string;
  children?: ReactNode;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={30} tint={color.mutedText} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyExplain}>{explain}</Text>
      {children}
    </View>
  );
}

/* ─── rows ────────────────────────────────────────────────────────────────── */

export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  chevron = false,
  tone = 'neutral',
  last = false,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  tone?: 'neutral' | 'orange';
  /** Suppresses the divider on the final row of a group. */
  last?: boolean;
}) {
  // The accessible name pairs the row's two lines, because a screen reader
  // reading "Muscat → Sohar" without "arriving Friday" loses the half that
  // matters. The integration tests assert on this composed name.
  const label = subtitle ? `${title}. ${subtitle}` : title;

  const body = (
    <View style={[s.listRow, !last && s.listRowDivided]}>
      {!!icon && (
        <View style={[s.listChip, tone === 'orange' && { backgroundColor: color.accentTint }]}>
          <Icon name={icon} size={20} tint={tone === 'orange' ? color.accentLight : color.iconGrey} />
        </View>
      )}
      <View style={s.listText}>
        <Text style={s.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={s.listSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Icon name="chevron" size={18} tint={color.mutedText} />}
    </View>
  );

  if (!onPress) {
    // `accessible` collapses the row's two Texts into one node, so it is
    // announced as a single row rather than two orphaned strings.
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

export function FactChips({ facts }: { facts: { icon: IconName; label: string; value: string }[] }) {
  return (
    <View style={s.chips}>
      {facts.map((f) => (
        <View
          key={f.label}
          style={s.factChip}
          accessible
          accessibilityLabel={`${f.label}: ${f.value}`}
        >
          <Icon name={f.icon} size={16} tint={color.mutedText} />
          <Text style={s.factValue} numberOfLines={1}>
            {f.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function RouteLine({
  from,
  to,
  labelFrom,
  labelTo,
  compact = false,
}: {
  from: string;
  to: string;
  labelFrom?: string;
  labelTo?: string;
  compact?: boolean;
}) {
  return (
    <View style={s.routeLine} accessible accessibilityLabel={`${from} — ${to}`}>
      <View style={s.routeSpine}>
        <View style={s.routeOrigin} />
        <View style={[s.routeStem, { height: compact ? 18 : 28 }]} />
        <View style={s.routeDest} />
      </View>
      <View style={[s.routeLabels, { gap: compact ? 12 : 22 }]}>
        <View>
          {!!labelFrom && <Text style={s.routeKicker}>{labelFrom}</Text>}
          <Text style={s.routeCity}>{from}</Text>
        </View>
        <View>
          {!!labelTo && <Text style={s.routeKicker}>{labelTo}</Text>}
          <Text style={s.routeCity}>{to}</Text>
        </View>
      </View>
    </View>
  );
}

export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <View
      style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[s.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={s.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.count == null ? o.label : `${o.label}, ${o.count}`}
            style={[s.segment, on && s.segmentOn]}
          >
            <Text style={[s.segmentText, on && s.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── controls ────────────────────────────────────────────────────────────── */

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
  full?: boolean;
  icon?: IconName;
};

/**
 * The old four-variant button, mapped onto the new two-ground primary.
 *
 * `quiet` and `danger` collapse onto the same shape here — the redesign has no
 * destructive button, and the screens that used `danger` are all replaced in a
 * later phase.
 */
export function Button({ label, loading = false, disabled, icon, onPress }: ButtonProps) {
  return (
    <PrimaryButton
      label={label}
      onPress={() => onPress?.(null as never)}
      disabled={!!disabled}
      loading={loading}
      ground="cream"
      icon={icon}
    />
  );
}

export function TextButton({
  label,
  onPress,
  align: alignSelf = 'auto',
}: {
  label: string;
  onPress: () => void;
  tone?: 'orange' | 'muted';
  align?: 'auto' | 'center' | 'flex-start' | 'flex-end';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[s.textButton, { alignSelf }]}
    >
      <Text style={s.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  label,
  onPress,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'orange' | 'plain';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={s.iconButton}
    >
      <Icon name={name} size={20} tint={color.lightText} />
    </Pressable>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function FieldValue({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[s.fieldValue, muted && s.bodyMuted]}>{children}</Text>;
}

type InputProps = TextInputProps & { error?: string | null };

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { error, style, ...rest },
  ref,
) {
  return (
    <View>
      <TextInput
        ref={ref}
        placeholderTextColor={color.mutedText}
        style={[s.input, !!error && s.inputError, style]}
        {...rest}
      />
      {!!error && <Text style={s.inputErrorText}>{error}</Text>}
    </View>
  );
});

export function Stamp({ tone, children }: { tone: StampTone; children: string }) {
  const on = tone === 'active';
  return (
    <View style={[s.stamp, on && s.stampOn]}>
      {/* A live job gets a dot — the one piece of motion-free "this is happening
          now" signalling that survives being glanced at. */}
      {on && <View style={s.stampDot} />}
      <Text style={[s.stampText, on && s.stampTextOn]} numberOfLines={1}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

export function Choice({
  title,
  detail,
  selected,
  onPress,
  icon,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      style={[s.choice, selected && s.choiceOn]}
    >
      {!!icon && <Icon name={icon} size={22} tint={selected ? color.accent : color.mutedText} />}
      <View style={s.choiceText}>
        <Text style={s.choiceTitle}>{title}</Text>
        {!!detail && <Text style={s.choiceDetail}>{detail}</Text>}
      </View>
      <View style={[s.choiceRadio, selected && s.choiceRadioOn]}>
        {selected && <View style={s.choiceDot} />}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  title: { ...font.statement, color: color.lightText, textAlign: align.start },
  body: { ...font.body, color: alpha.onInk.body, textAlign: align.start },
  bodyMuted: { color: color.mutedText },
  eyebrow: { ...font.groupLabel, color: color.mutedText, textAlign: align.start },

  pageTitleWrap: { gap: space.xs, marginBottom: space.lg },
  pageTitle: { ...font.statement, color: color.lightText, textAlign: align.start },
  pageDetail: { ...font.bodySmall, color: color.mutedText, textAlign: align.start },

  rule: { height: 1, backgroundColor: hairline.onCream },
  ruleStrong: { height: 2 },

  note: {
    backgroundColor: color.creamCard,
    borderRadius: radius.card,
    padding: space.xl,
    ...elevation.cardCream,
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  noteHeadText: { ...font.groupLabel, color: color.mutedText, textAlign: align.start },

  rowGroup: {
    backgroundColor: color.creamCard,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...elevation.cardCream,
  },

  section: { gap: space.md, marginBottom: space.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...font.title, color: color.lightText, textAlign: align.start },
  sectionAction: { ...font.caption, color: color.accent },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TARGET + space.sm,
  },
  topBack: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...font.rowTitle, color: color.lightText, flex: 1, textAlign: align.start },
  topAction: { minWidth: MIN_TARGET, alignItems: 'flex-end' },

  actionBar: {
    gap: space.sm,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: hairline.onCream,
  },
  actionNote: { ...font.bodySmall, color: color.mutedText, textAlign: 'center' },

  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.huge },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.tile,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...font.title, color: color.lightText, textAlign: 'center' },
  emptyExplain: {
    ...font.bodySmall,
    color: color.mutedText,
    textAlign: 'center',
    maxWidth: 280,
  },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    minHeight: 64,
  },
  listChip: {
    width: 40,
    height: 40,
    borderRadius: radius.tileXs,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRowDivided: { borderBottomWidth: 1, borderBottomColor: hairline.onCream },
  listText: { flex: 1, gap: 2 },
  listTitle: { ...font.rowTitle, color: color.lightText, textAlign: align.start },
  listSubtitle: { ...font.bodySmall, color: color.mutedText, textAlign: align.start },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  factChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    minHeight: 32,
    borderRadius: radius.round,
    backgroundColor: color.cream,
  },
  factValue: { ...font.caption, color: color.lightText },

  routeLine: { flexDirection: 'row', gap: space.md },
  routeSpine: { alignItems: 'center', paddingTop: 5 },
  routeOrigin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: color.lightText,
  },
  routeStem: { width: 1.5, backgroundColor: hairline.onCream },
  routeDest: { width: 9, height: 9, borderRadius: radius.marker, backgroundColor: color.accent },
  routeLabels: { justifyContent: 'space-between' },
  routeKicker: { ...font.groupLabel, color: color.mutedText, textAlign: align.start },
  routeCity: { ...font.rowTitle, color: color.lightText, textAlign: align.start },

  avatar: { backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: face.archivo700, color: color.accent },

  segmented: {
    flexDirection: 'row',
    backgroundColor: color.cream,
    borderRadius: radius.round,
    padding: 5,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TARGET - 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.round,
  },
  segmentOn: { backgroundColor: color.creamCard },
  segmentText: { ...font.caption, color: color.mutedText },
  segmentTextOn: { fontFamily: face.archivo700, color: color.inkText },

  textButton: { minHeight: MIN_TARGET, justifyContent: 'center' },
  textButtonLabel: { ...font.caption, color: color.accent },

  iconButton: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: radius.round,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },

  field: { gap: space.xs },
  fieldLabel: { ...font.groupLabel, color: color.mutedText, textAlign: align.start },
  fieldValue: { ...font.value, color: color.lightText, textAlign: align.start },

  input: {
    minHeight: 56,
    borderRadius: radius.input,
    backgroundColor: color.creamCard,
    paddingHorizontal: space.lg,
    ...font.body,
    color: color.inkText,
    textAlign: align.start,
    ...elevation.inputCream,
  },
  inputError: { borderWidth: 1.5, borderColor: color.danger },
  inputErrorText: {
    ...font.bodySmall,
    color: color.danger,
    marginTop: space.xs,
    textAlign: align.start,
  },

  stamp: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    backgroundColor: color.cream,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
  },
  stampOn: { backgroundColor: color.accentTint },
  stampDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  stampText: { ...font.caption, color: color.mutedText },
  stampTextOn: { color: color.accent },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    minHeight: 64,
    borderRadius: radius.row,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: color.creamCard,
  },
  choiceOn: { backgroundColor: color.accentTint, borderColor: color.accent },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { ...font.rowTitle, color: color.inkText, textAlign: align.start },
  choiceDetail: { ...font.bodySmall, color: color.mutedText, textAlign: align.start },
  choiceRadio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(22,23,26,.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceRadioOn: { borderColor: color.accent },
  choiceDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.accent },
});
