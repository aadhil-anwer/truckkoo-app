import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { TertiaryButton } from '@/components/primitives';
import { Skeleton } from '@/components/ui';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { color, font, space } from '@/theme/tokens';

/** A visible escape while a stored draft loads or a missing place redirects. */
export function BookingPending() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{t('common.loading')}</Text>
      <Skeleton height={140} />
      <TertiaryButton label={t('book.review.home')} onPress={() => router.replace('/customer')} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    backgroundColor: color.ink,
  },
  label: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
});
