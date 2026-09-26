/**
 * N6 · You are on.
 *
 * Ink, on an accent bloom. Not a dead end: the one primary sets up the next real
 * action — a driver's first trip, a shipper's first load — because an account
 * with nothing on it is the moment people close an app and do not come back.
 *
 * The Gate leaves this screen alone (see `_layout.tsx`). The profile already
 * exists, and without the exemption the user would be moved home before reading
 * a word of it. Leaving is this screen's own decision: home first, then the next
 * step pushed on top, so back from that step lands somewhere real.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PrimaryButton, TertiaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Bloom, Card, QuestionHeading } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { OMAN_DIAL, clearAuthDraft, getAuthDraft } from '@/lib/auth-draft';
import { useTruckTypes } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { useSession } from '@/lib/session';
import { GUTTER_INK, alpha, color, font, radius, space } from '@/theme/tokens';

/** `91234567` → `+968 9123 4567`, the way the handoff prints it. */
function formatOmani(digits: string): string {
  return `${OMAN_DIAL} ${digits.slice(0, 4)} ${digits.slice(4)}`;
}

export default function Done() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useSession();
  const { data: types } = useTruckTypes();
  // Read once: the draft is cleared on the way out, and this screen must not
  // re-render into an empty greeting as it leaves.
  const [draft] = useState(getAuthDraft);
  const [leaving, setLeaving] = useState(false);

  const driver = draft.role === 'driver';
  const home = driver ? '/driver' : '/customer';
  const truck = types?.find((type) => type.code === draft.truckType);

  async function leave(next: '/leg/route' | '/book/origin' | null) {
    setLeaving(true);
    await refreshProfile();
    clearAuthDraft();
    router.replace(home);
    if (next) router.push(next);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <Bloom rgb="241,85,31" strength={0.28} size={510} top={-40} start={-60} />

      <View style={styles.body}>
        <View style={styles.tile}>
          <Icon name="check" size={38} stroke={2.2} tint={color.accent} />
        </View>
        <QuestionHeading size="hero" ground="ink">
          {/* The draft is memory only; a reload on this screen empties it. */}
          {draft.name
            ? t('auth.done.title', { name: safeText(draft.name) })
            : t('auth.done.titlePlain')}
        </QuestionHeading>
        <Text style={[arabicIfNeeded(font.body), styles.lede]}>
          {driver ? t('auth.done.body.driver') : t('auth.done.body.shipper')}
        </Text>

        {(!!truck || !!draft.phone) && (
          <Card style={styles.card}>
            <View style={styles.cardTile}>
              <Icon name={driver ? 'truck' : 'phone'} size={22} tint={color.iconGrey} />
            </View>
            <View style={styles.cardText}>
              {!!truck && <Text style={styles.cardTitle}>{localized(truck)}</Text>}
              {!!draft.phone && (
                <Text style={truck ? styles.cardDetail : styles.cardTitle}>
                  {formatOmani(draft.phone)}
                </Text>
              )}
            </View>
          </Card>
        )}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={driver ? t('auth.done.cta.driver') : t('auth.done.cta.shipper')}
          loading={leaving}
          onPress={() => leave(driver ? '/leg/route' : '/book/origin')}
        />
        <TertiaryButton label={t('auth.done.later')} onPress={() => leave(null)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink, overflow: 'hidden' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: GUTTER_INK, gap: space.lg },
  tile: {
    width: 76,
    height: 76,
    borderRadius: radius.review,
    backgroundColor: color.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  lede: { color: alpha.onInk.body, textAlign: align.start, maxWidth: 320 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  cardTile: {
    width: 44,
    height: 44,
    borderRadius: radius.tileSm,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...arabicIfNeeded(font.value), color: color.lightText, textAlign: align.start },
  // A phone number is digits, not prose: it reads left to right in both languages.
  cardDetail: { ...font.bodySmall, color: alpha.onInk.body, textAlign: align.start, writingDirection: 'ltr' },
  actions: { paddingHorizontal: GUTTER_INK, gap: space.xs },
});
