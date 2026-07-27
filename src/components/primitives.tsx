/**
 * THESIS: Truckkoo is a ride-hailing app for freight, so it is built like one.
 * One enormous entry point per screen, list rows you read by their icon before
 * their words, and exactly one action pinned under the thumb. It refuses both the
 * shadowed-card-grid dashboard every logistics app ships *and* the ruled-document
 * treatment this app used to wear, which read as paperwork rather than software.
 *
 * OWN-WORLD: White surfaces on a near-white page, depth from soft shadow and
 * `#f2f2f2` fills, 16–20px radii, 24px icons in circular chips. One orange
 * (`#f1551f`) on the primary action and the live state, and nowhere else.
 *
 * STORY: A shipper opens the app, taps one big field that says where to, answers
 * three questions, sees a price, and confirms. A driver opens it and the trip
 * they are on fills the screen with one thing to do next.
 *
 * FIRST VIEWPORT: A greeting, then a 64pt-tall entry field carrying the app's one
 * question, then the live load as a card. The tab bar says what else exists.
 *
 * FORM: Uber's skeleton — canvas, sheet, rows, pinned CTA — in Truckkoo's palette.
 *
 * ── Shared primitives. Every screen composes these so the vocabulary cannot
 * drift: one button shape, one field treatment, one status pill, one rule.
 */

import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from 'react-native';

import { align } from '@/i18n';
import {
  color,
  CTA_HEIGHT,
  doc,
  elevation,
  font,
  HIT_SLOP,
  MIN_TARGET,
  radius,
  space,
  stamp,
  type StampTone,
} from '@/theme/tokens';

import { Icon } from './icon';

/* ─── rules ──────────────────────────────────────────────────────────────── */

/**
 * A hairline separator. Demoted in the rewire: it now only divides rows *inside*
 * a surface. Between surfaces, the gap and the shadow do that work.
 */
export function Rule({ strong = false, tone = 'light' }: { strong?: boolean; tone?: 'light' | 'dark' }) {
  return (
    <View
      // A rule is decoration to a screen reader; it must not be announced.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: strong ? doc.ruleStrong : doc.rule,
        backgroundColor: tone === 'dark' ? color.asphaltLine : color.line,
      }}
    />
  );
}

/* ─── type ───────────────────────────────────────────────────────────────── */

export function Eyebrow({ children, tone = 'orange' }: { children: ReactNode; tone?: 'orange' | 'muted' }) {
  return (
    <Text style={[styles.eyebrow, { color: tone === 'orange' ? color.orange : color.inkSoft }]}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: color.inkSoft }]}>{children}</Text>;
}

/**
 * A labelled field. The label is now sentence-case at 14/700 rather than tracked
 * caps — caps above a filled input reads as a form to be endured, and the whole
 * point of the rewire is that filling this in should feel like tapping, not
 * filing.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function FieldValue({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text style={[styles.fieldValue, muted && { color: color.inkSoft }]} numberOfLines={2}>
      {children}
    </Text>
  );
}

/* ─── status ─────────────────────────────────────────────────────────────── */

/**
 * The status pill, formerly a rubber stamp.
 *
 * Still uppercase and still blunt — this audience reads shape and colour before
 * words — but it is now a soft filled pill rather than a bordered stamp, which
 * is what every status indicator in a modern app looks like. The colour pairs
 * are unchanged and still checked against 4.5:1.
 */
export function Stamp({ tone, children }: { tone: StampTone; children: string }) {
  const s = stamp[tone];
  return (
    <View style={[styles.stamp, { backgroundColor: s.bg }]}>
      {/* A live job gets a dot. It is the one piece of motion-free "this is
          happening now" signalling that survives being glanced at. */}
      {tone === 'active' && <View style={[styles.stampDot, { backgroundColor: s.fg }]} />}
      <Text style={[styles.stampText, { color: s.fg }]} numberOfLines={1}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

/* ─── button ─────────────────────────────────────────────────────────────── */

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  /** primary = the one orange action. Never two on a screen. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
  full?: boolean;
  /** Optional leading icon. Use sparingly — a CTA rarely needs one. */
  icon?: Parameters<typeof Icon>[0]['name'];
};

/**
 * One button shape.
 *
 * `secondary` is a grey fill rather than an outlined box. That is the single
 * most Uber-ish change in this file: an outline reads as "disabled or dangerous"
 * next to a filled primary, while a grey fill reads as "the other thing you
 * might do", which is what it always meant.
 */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  full = true,
  disabled,
  icon,
  ...rest
}: ButtonProps) {
  const isOff = disabled || loading;
  const tint =
    variant === 'primary' || variant === 'danger'
      ? color.paper
      : variant === 'quiet'
        ? color.orange
        : color.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isOff, busy: loading }}
      accessibilityLabel={label}
      disabled={isOff}
      style={({ pressed }) => [
        styles.btn,
        full && { alignSelf: 'stretch' },
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'quiet' && styles.btnQuiet,
        variant === 'danger' && styles.btnDanger,
        // A press that scales is the cheapest possible "the app heard you" on a
        // slow phone, where the next screen may be 400ms away.
        pressed && !isOff && { transform: [{ scale: 0.98 }], opacity: 0.92 },
        isOff && styles.btnOff,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {!!icon && <Icon name={icon} size={20} color={tint} />}
          <Text style={[styles.btnText, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * A text-only action: sign out, back, switch to sign-up.
 *
 * Exists because `<Text onPress>` looks identical and is an accessibility bug — it
 * has no minimum size, so it ships a ~16pt tall target. Every tap target here
 * clears 44pt, and drivers wear gloves.
 */
export function TextButton({
  label,
  onPress,
  tone = 'orange',
  align: alignSelf = 'auto',
}: {
  label: string;
  onPress: () => void;
  tone?: 'orange' | 'muted';
  align?: 'auto' | 'center';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [
        styles.textBtn,
        alignSelf === 'center' && { alignSelf: 'center' },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.textBtnLabel, tone === 'muted' && { color: color.inkSoft }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A circular icon button — call, message, close, back.
 *
 * Uber's contact row is three of these. It needs its own accessible label
 * because there is no visible text to borrow one from.
 */
export function IconButton({
  name,
  label,
  onPress,
  tone = 'neutral',
}: {
  name: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'orange' | 'plain';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [
        styles.iconBtn,
        tone === 'neutral' && { backgroundColor: color.fill },
        tone === 'orange' && { backgroundColor: color.orange },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={name} size={22} color={tone === 'orange' ? color.paper : color.ink} />
    </Pressable>
  );
}

/* ─── text input ─────────────────────────────────────────────────────────── */

type InputProps = TextInputProps & { error?: string | null };

/**
 * A filled input, not a ruled line.
 *
 * The ruled line was correct for a document and wrong for a phone: it gave the
 * tappable area no visible bounds, so on a 5" screen you aimed at a 1px rule.
 * The fill is the target, and it is 56pt tall.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { error, style, ...rest },
  ref,
) {
  return (
    <View>
      <TextInput
        ref={ref}
        // Placeholders forced to #6b6b6b so they clear 4.5:1 on the fill.
        placeholderTextColor={color.inkSoft}
        style={[styles.input, { textAlign: align.start }, !!error && styles.inputError, style]}
        aria-invalid={!!error}
        {...rest}
      />
      {!!error && (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
});

/* ─── containers ─────────────────────────────────────────────────────────── */

/**
 * One surface. A white card with a soft shadow — never nested inside another
 * card (craft floor: nested cards are always wrong).
 */
export function Note({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.note, style]} {...rest}>
      {children}
    </View>
  );
}

/**
 * A choose-one row: the whole row is the target, not a small radio dot.
 *
 * Deliberately not a segmented control or a picker wheel. For an audience with
 * near-zero tech literacy, a stack of large labelled rows with a visible selected
 * state is the most legible way to ask a question, and it reads identically in
 * Arabic because nothing depends on horizontal order.
 */
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
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceOn,
        pressed && { backgroundColor: color.fill },
      ]}
    >
      {!!icon && (
        <View style={[styles.choiceIcon, selected && { backgroundColor: color.orangeSoft }]}>
          <Icon name={icon} size={22} color={selected ? color.orangeDeep : color.inkSoft} />
        </View>
      )}
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        {!!detail && <Text style={styles.choiceDetail}>{detail}</Text>}
      </View>
      {/* A filled tick, not an empty ring. Selected must be legible in sunlight
          at a glance, and an outline ring at 22pt is not. */}
      <View style={[styles.choiceMark, selected && styles.choiceMarkOn]}>
        {selected && <Icon name="check" size={16} color={color.paper} />}
      </View>
    </Pressable>
  );
}

/** The heading strip across the top of a note. Kept for the consignment note. */
export function NoteHead({ left, right }: { left: string; right?: ReactNode }) {
  return (
    <>
      <View style={styles.noteHead}>
        <Text style={styles.noteHeadText} numberOfLines={1}>
          {left.toUpperCase()}
        </Text>
        {right}
      </View>
      <Rule />
    </>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...font.eyebrow, textAlign: align.start },
  title: { ...font.title, color: color.ink, textAlign: align.start },
  body: { ...font.body, color: color.ink, textAlign: align.start },

  field: { gap: space.sm },
  fieldLabel: { ...font.label, color: color.ink, textAlign: align.start },
  fieldValue: { ...doc.fieldValue, color: color.ink, textAlign: align.start },

  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  stampDot: { width: 6, height: 6, borderRadius: radius.pill },
  stampText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  btn: {
    minHeight: CTA_HEIGHT,
    flexDirection: 'row',
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  btnPrimary: { backgroundColor: color.orange, ...elevation.orangeButton },
  btnSecondary: { backgroundColor: color.fill },
  btnQuiet: { backgroundColor: 'transparent', minHeight: MIN_TARGET },
  btnDanger: { backgroundColor: color.danger },
  btnOff: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  btnText: { ...font.button, textAlign: 'center' },

  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  input: {
    ...font.body,
    fontWeight: '600',
    color: color.ink,
    minHeight: CTA_HEIGHT,
    backgroundColor: color.fill,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    // Transparent until it errors, so the box does not resize when it does.
    borderWidth: doc.ruleStrong,
    borderColor: 'transparent',
  },
  inputError: { borderColor: color.danger },
  errorText: { ...font.smallPrint, color: color.danger, marginTop: 6, textAlign: align.start },

  note: {
    backgroundColor: color.paper,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...elevation.card,
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.md,
    backgroundColor: color.paperDeep,
  },
  noteHeadText: {
    ...font.micro,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: color.inkSoft,
    flexShrink: 1,
  },

  choice: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    backgroundColor: color.paper,
    borderWidth: doc.ruleStrong,
    borderColor: color.line,
  },
  choiceOn: { borderColor: color.orange, backgroundColor: color.orangeSoft },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { ...font.rowTitle, color: color.ink, textAlign: align.start },
  choiceDetail: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
  choiceMark: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: doc.ruleStrong,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceMarkOn: { backgroundColor: color.orange, borderColor: color.orange },

  textBtn: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  textBtnLabel: { ...font.label, color: color.orange, textAlign: align.start },
});
