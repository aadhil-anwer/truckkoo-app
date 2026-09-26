/**
 * The two shapes every booking step sits in.
 *
 * The handoff draws eight screens; structurally there are two — a cream question
 * and an ink map-with-a-sheet. Building them once means the step header, the
 * back behaviour and the pinned action cannot drift between steps, which is
 * exactly what happens when eight screens each own their own chrome.
 */

import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, StepHeader, TertiaryButton } from '@/components/primitives';
import { QuestionHeading, Sheet } from '@/components/ui';
import { MapCanvas, Scrim, type Framing } from '@/map';
import { GUTTER_CREAM, GUTTER_INK, MIN_TARGET, color, font, space } from '@/theme/tokens';
import { align } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
/**
 * The step counter is a plain `n of total` rather than a booking step name.
 *
 * The driver's route flow (D4/D5) is two steps in the same two shapes, and a
 * shell that could only count the shipper's six would have forced a second
 * implementation of the same chrome — which is the thing this file exists to
 * prevent.
 */

/**
 * A cream question: one question, its helper, the answer, and a pinned action.
 *
 * `KeyboardAvoidingView` matters more here than it looks. The handoff draws a
 * keypad tray under the field on N2/S8; we use the platform keyboard instead, and
 * the field has to stay above it or the user is typing into something they cannot
 * see.
 */
export function QuestionShell({
  step,
  total,
  question,
  helper,
  onBack,
  cta,
  onCta,
  ctaDisabled,
  tertiary,
  onTertiary,
  children,
  above,
}: {
  /** 1-based position in the flow. */
  step: number;
  total: number;
  question: string;
  helper?: string;
  onBack: () => void;
  cta: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  tertiary?: string;
  onTertiary?: () => void;
  children: ReactNode;
  /** Rendered between the header and the question — the OPTIONAL pill on S8. */
  above?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.cream, { paddingTop: insets.top + space.sm }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.creamGutter}>
          <StepHeader step={step} total={total} onBack={onBack} ground="cream" />
        </View>

        <ScrollView
          contentContainerStyle={styles.creamScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {above}
          <QuestionHeading ground="cream">{question}</QuestionHeading>
          {!!helper && (
            <Text
              style={[arabicIfNeeded(font.body), styles.helper]}
            >
              {helper}
            </Text>
          )}
          <View style={styles.answer}>{children}</View>
        </ScrollView>

        <View style={[styles.creamFooter, { paddingBottom: insets.bottom + space.lg }]}>
          <PrimaryButton label={cta} onPress={onCta} disabled={ctaDisabled} ground="cream" />
          {!!tertiary && !!onTertiary && (
            <TertiaryButton label={tertiary} onPress={onTertiary} />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * An ink step: the map is the top of the screen, the sheet holds the question.
 *
 * The sheet is a fixed-height bottom pane rather than a draggable one. The
 * handoff never shows it being dragged, and a gesture-driven sheet on a cheap
 * Android phone is a frame-rate cost paid for an interaction nobody asked for.
 */
export function MapStepShell({
  step,
  total,
  framing,
  onBack,
  children,
  overlay,
}: {
  /** 1-based position in the flow. */
  step: number;
  total: number;
  framing: Framing;
  onBack: () => void;
  /** Sheet contents. */
  children: ReactNode;
  /** Drawn in projected space over the map — corridor, pins. */
  overlay?: (size: { width: number; height: number }) => ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <View style={styles.ink}>
      <View
        style={styles.mapArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize({ width, height });
        }}
      >
        {size.width > 0 && (
          <>
            {/* Fitted below the step header that floats over the map's top. */}
            <MapCanvas
              framing={framing}
              width={size.width}
              height={size.height}
              fit={{ top: insets.top + space.sm + MIN_TARGET }}
            >
              {overlay?.(size)}
            </MapCanvas>
            {/* Keeps the header legible over land without hiding the corridor. */}
            <Scrim variant="topHeavy" width={size.width} height={size.height} />
          </>
        )}

        <View style={[styles.inkHeader, { paddingTop: insets.top + space.sm }]}>
          <StepHeader step={step} total={total} onBack={onBack} ground="ink" />
        </View>
      </View>

      <Sheet style={{ paddingBottom: insets.bottom + space.lg }}>{children}</Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cream: { flex: 1, backgroundColor: color.cream },
  creamGutter: { paddingHorizontal: GUTTER_CREAM },
  creamScroll: {
    paddingHorizontal: GUTTER_CREAM,
    paddingTop: space.xxl,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  helper: { color: color.mutedText, textAlign: align.start },
  answer: { marginTop: space.lg, gap: space.md },
  creamFooter: { paddingHorizontal: GUTTER_CREAM, paddingTop: space.md, gap: space.xs },

  ink: { flex: 1, backgroundColor: color.ink },
  mapArea: { flex: 1 },
  inkHeader: { position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, paddingHorizontal: GUTTER_INK },
});
