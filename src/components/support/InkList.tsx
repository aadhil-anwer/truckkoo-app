/**
 * A read-only list screen on the ink ground: a back button, a title, an
 * optional line of help, then the rows. Messages, reports and the driver's
 * record are records to read, not questions — so ink, not cream (DESIGN: a
 * screen is one ground or the other).
 */
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Skeleton } from '@/components/ui';
import { align, t } from '@/i18n';
import { GUTTER_INK, alpha, color, font, radius, space } from '@/theme/tokens';

export function InkList({ title, help, loading, failed, onRetry, refreshing, empty, children }: {
  title: string;
  help?: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  refreshing: boolean;
  empty: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRetry} tintColor={color.lightText} />}
      >
        <BackButton onPress={() => router.back()} />
        <Text accessibilityRole="header" style={StyleSheet.flatten([arabicIfNeeded(font.statement), styles.title])}>
          {title}
        </Text>
        {!!help && <Text style={StyleSheet.flatten([arabicIfNeeded(font.body), styles.help])}>{help}</Text>}
        {loading ? (
          <View style={styles.rows}><Skeleton height={72} round={radius.card} /><Skeleton height={72} round={radius.card} /></View>
        ) : failed ? (
          <Text accessibilityLiveRegion="polite" style={StyleSheet.flatten([arabicIfNeeded(font.body), styles.help])}>
            {t('common.error.title')}
          </Text>
        ) : empty ? (
          <Text style={StyleSheet.flatten([arabicIfNeeded(font.body), styles.help])}>{empty}</Text>
        ) : (
          <View style={styles.rows}>{children}</View>
        )}
      </ScrollView>
    </View>
  );
}

/** One row: a title, a quiet line under it, and an optional trailing node. */
export function InkRow({ title, detail, trailing, children }: {
  title: string; detail?: string | null; trailing?: ReactNode; children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={StyleSheet.flatten([arabicIfNeeded(font.rowTitle), styles.rowTitle])}>{title}</Text>
        {trailing}
      </View>
      {!!detail && <Text style={StyleSheet.flatten([arabicIfNeeded(font.bodySmall), styles.rowDetail])}>{detail}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.md },
  title: { color: color.lightText, textAlign: align.start, marginTop: space.sm },
  help: { color: alpha.onInk.secondary, textAlign: align.start },
  rows: { gap: space.sm },
  row: { backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, gap: space.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { color: color.lightText, textAlign: align.start, flexShrink: 1 },
  rowDetail: { color: alpha.onInk.secondary, textAlign: align.start },
});
