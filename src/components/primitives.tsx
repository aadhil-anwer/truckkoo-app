/**
 * THESIS: Truckkoo's app is the consignment note it already runs on — a ruled
 * document you read at arm's length, not a feed of rounded cards. It refuses the
 * shadowed-card-grid dashboard every logistics app ships.
 *
 * OWN-WORLD: White paper, near-black ink, hairline #e8e8e8 rules doing all the
 * structural work; one orange (#f1551f) reserved for the primary action and the
 * live stamp. Tracked caps field labels sit above ruled values. No shadows, no
 * gradients, no icon tiles.
 *
 * STORY: A driver or shipper opens the app and recognises the paperwork of their
 * own trade, finds the one thing that needs them now, and acts on it in one tap.
 *
 * FIRST VIEWPORT: A masthead rule with the document's title, then the single
 * live note at full width — two city names at 22pt with a rule between them — and
 * the primary action pinned inside that note. Everything else is beneath the fold.
 *
 * FORM: Consignment-note document; candidate 3 of 7 on the grounded list; seed
 * key e13c9161 (surface / operate).
 *
 * ── Shared primitives. Every screen composes these so the vocabulary cannot
 * drift: one button shape, one field treatment, one stamp, one rule.
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
  doc,
  font,
  HIT_SLOP,
  MIN_TARGET,
  radius,
  space,
  stamp,
  type StampTone,
} from '@/theme/tokens';

/* ─── rules ──────────────────────────────────────────────────────────────── */

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

/** A printed form's label-over-ruled-value pair. The core document unit. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
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

/* ─── stamp ──────────────────────────────────────────────────────────────── */

/**
 * The status stamp. Blunt on purpose: this audience reads shape and colour
 * before words, so the stamp must survive being glanced at in sunlight.
 */
export function Stamp({ tone, children }: { tone: StampTone; children: string }) {
  const s = stamp[tone];
  return (
    <View style={[styles.stamp, { backgroundColor: s.bg, borderColor: s.border }]}>
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
  variant?: 'primary' | 'secondary' | 'quiet';
  loading?: boolean;
  full?: boolean;
};

export function Button({
  label,
  variant = 'primary',
  loading = false,
  full = true,
  disabled,
  ...rest
}: ButtonProps) {
  const isOff = disabled || loading;

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
        // DESIGN.md §5: :active scales to .97. Translate is web-only; scale reads
        // as a real press on a touch device.
        pressed && !isOff && { transform: [{ scale: 0.97 }] },
        isOff && styles.btnOff,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? color.paper : color.ink}
        />
      ) : (
        <Text
          style={[
            styles.btnText,
            variant === 'primary' && { color: color.paper },
            variant === 'quiet' && { color: color.orange },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A text-only action: sign out, back, switch to sign-up.
 *
 * Exists because `<Text onPress>` looks identical and is an accessibility bug — it
 * has no minimum size, so it ships a ~16pt tall target. Every tap target here
 * clears 44pt (DESIGN.md §6), and drivers wear gloves.
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

/* ─── text input ─────────────────────────────────────────────────────────── */

type InputProps = TextInputProps & { error?: string | null };

/**
 * A written-into field: value on a ruled line, not inside a rounded box. The
 * rule thickens and turns orange on focus, which is the whole focus treatment —
 * plus a real 3px outline for keyboard users via `outline` on web.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { error, style, ...rest },
  ref,
) {
  return (
    <View>
      <TextInput
        ref={ref}
        // DESIGN.md §6: placeholders forced to #6b6b6b so they clear 4.5:1.
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
 * One consignment note. A bordered sheet of paper — never a shadowed card, and
 * never nested inside another note (craft floor: nested cards are always wrong).
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
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
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
        pressed && { backgroundColor: color.paperDeep },
      ]}
    >
      <View style={styles.choiceText}>
        <Text style={[styles.choiceTitle, selected && { color: color.orange }]}>{title}</Text>
        {!!detail && <Text style={styles.choiceDetail}>{detail}</Text>}
      </View>
      {/* A filled bar, not a checkmark glyph: reads at a glance and needs no icon set. */}
      <View style={[styles.choiceMark, selected && styles.choiceMarkOn]} />
    </Pressable>
  );
}

/** The heading strip across the top of a note. */
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

  field: { gap: 4 },
  fieldLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },
  fieldValue: { ...doc.fieldValue, color: color.ink, textAlign: align.start },

  stamp: {
    borderWidth: doc.rule,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  stampText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },

  btn: {
    minHeight: MIN_TARGET,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderWidth: doc.rule,
  },
  btnPrimary: { backgroundColor: color.orange, borderColor: color.orange },
  btnSecondary: { backgroundColor: color.paper, borderColor: color.ink },
  btnQuiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnOff: { opacity: 0.45 },
  btnText: { ...font.button, color: color.ink, textAlign: 'center' },

  input: {
    ...doc.fieldValue,
    color: color.ink,
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
    // The ruled line IS the input. No box.
    borderBottomWidth: doc.ruleStrong,
    borderBottomColor: color.line,
  },
  inputError: { borderBottomColor: color.danger },
  errorText: { ...font.smallPrint, color: color.danger, marginTop: 6, textAlign: align.start },

  note: {
    backgroundColor: color.paper,
    borderWidth: doc.rule,
    borderColor: color.line,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.sm,
    backgroundColor: color.paperDeep,
  },
  noteHeadText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: color.inkSoft,
    flexShrink: 1,
  },

  choice: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.md,
    borderWidth: doc.rule,
    borderColor: color.line,
    borderRadius: radius.control,
    backgroundColor: color.paper,
  },
  // Selected state carries a 2px orange edge, matching DESIGN.md's card-hover rule.
  choiceOn: { borderColor: color.orange, borderWidth: doc.ruleStrong },
  choiceText: { flex: 1, gap: 3 },
  choiceTitle: { ...font.cardTitle, color: color.ink, textAlign: align.start },
  choiceDetail: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
  choiceMark: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: doc.ruleStrong,
    borderColor: color.line,
  },
  choiceMarkOn: { backgroundColor: color.orange, borderColor: color.orange },

  textBtn: {
    minHeight: MIN_TARGET,
    justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  textBtnLabel: { ...font.label, color: color.orange, textAlign: align.start },
});
