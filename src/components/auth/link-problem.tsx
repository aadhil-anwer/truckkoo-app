/**
 * An emailed link that cannot be used — expired, already spent, or missing its
 * code. Shared by the reset and confirm screens.
 *
 * Ink, because the user is reading a state, not answering a question. It says
 * what happened and offers the one action that helps; it is never a dead end.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { QuestionHeading } from '@/components/ui';
import { align, t } from '@/i18n';
import { GUTTER_INK, alpha, color, font, radius, space } from '@/theme/tokens';

export function LinkProblem({ title, explain }: { title: string; explain: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.body}>
        <View style={styles.tile}>
          <Icon name="alert" size={34} stroke={1.7} tint={color.iconGreyDim} />
        </View>
        <QuestionHeading size="question" ground="ink">
          {title}
        </QuestionHeading>
        <Text style={[arabicIfNeeded(font.body), styles.explain]}>{explain}</Text>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label={t('auth.submit.signIn')} onPress={() => router.replace('/welcome')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: GUTTER_INK, gap: space.lg },
  tile: {
    width: 70,
    height: 70,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explain: { color: alpha.onInk.body, textAlign: align.start },
  actions: { paddingHorizontal: GUTTER_INK },
});
