/**
 * X2 · Account.
 *
 * One component serves both roles; only the role line and the tab bar differ.
 *
 * Sign-out used to live as a text link in the corner of every masthead. Moving
 * it here is what let the header shrink to a back chevron, and it is also where
 * every phone owner already looks for it.
 *
 * WHAT THIS SCREEN MAY SAY
 *
 * Only what `profiles` actually holds: name, phone, role, language. No tier, no
 * rating, no loads-completed, no member-since. PRODUCT.md and CLAUDE.md §5 forbid
 * fabricating proof, and an account screen is exactly where a plausible-looking
 * invented number would go unchallenged. The one claim it does repeat —
 * "replies in minutes, 7 days a week" — is a commitment the live website already
 * makes in public.
 *
 * NO TRUCK ROW. The handoff draws "Truck / 10-ton" and there is no such field:
 * `profiles` is id, role, full_name, phone, language and nothing else. The value
 * would have to be invented, so the row does not exist. This is a deliberate
 * departure from the handoff, recorded in OPEN_ISSUES.
 *
 * THE LANGUAGE ROW LEADS SOMEWHERE. Before P7 it was read-only, because React
 * Native applies RTL natively and needs a relaunch — so a picker would have
 * promised what a tap could not deliver. `setLanguage` persists the choice,
 * records it on the profile and flips the direction; the flip takes effect on
 * the next launch, so this screen has to say so. The alternative was shipping
 * `expo-updates` purely to call `reloadAsync()`, which means an OTA check at
 * every launch for drivers on patchy signal — a large bill for one tap.
 */

import { useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableSurface, SecondaryButton, SelectRow } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { DetailGroup, DetailRow, Notice } from '@/components/ui';
import { align, getLanguage, t, type Language } from '@/i18n';
import { signOut } from '@/lib/auth';
import { usePush } from '@/lib/push-context';
import { setLanguage } from '@/lib/language';
import { safeText, whatsappLink } from '@/lib/safe-text';
import { useSession } from '@/lib/session';
import {
  GUTTER_INK,
  TABBAR_CLEARANCE_3,
  alpha,
  color,
  font,
  radius,
  space,
} from '@/theme/tokens';

/** Each language names itself, in itself. Nobody looks for "Arabic" in English. */
const LANGUAGE_NAME: Record<Language, string> = { en: 'English', ar: 'العربية' };

/** Two words at most. A third initial is noise at 64px. */
function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase() || 'T'
  );
}

export default function AccountTab() {
  const { profile } = useSession();
  const push = usePush();
  const insets = useSafeAreaInsets();
  const [picking, setPicking] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const name = profile?.full_name?.trim() ?? '';
  const isDriver = profile?.role === 'driver';
  const current = getLanguage();

  /**
   * `forceRTL` lands on the next launch, so the notice is the design rather than
   * an error path. It is shown only after an actual change: telling someone to
   * restart when they re-picked the language they were already reading would be
   * noise.
   */
  async function choose(next: Language) {
    setPicking(false);
    if (next === current) return;
    await setLanguage(next);
    setRestartNeeded(true);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(name)}</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {safeText(name)}
          </Text>
          <Text style={styles.role}>
            {isDriver ? t('account.role.driver') : t('account.role.shipper')}
          </Text>
        </View>

        {restartNeeded && <Notice icon="info">{t('account.language.hint')}</Notice>}

        <DetailGroup label={t('account.details')}>
          <DetailRow label={t('auth.phone')} value={safeText(profile?.phone ?? '—')} />
          <DetailRow
            label={t('push.row')}
            value={t(push.access === 'granted' ? 'push.row.on' : 'push.row.off')}
            onPress={push.access === 'granted' ? undefined : () => void push.request()}
          />
          <DetailRow
            label={t('account.language')}
            value={LANGUAGE_NAME[current]}
            onPress={() => setPicking(true)}
          />
        </DetailGroup>

        <DetailGroup label={t('account.help')}>
          <DetailRow
            label={t('whatsapp.action')}
            value={t('account.help.detail')}
            onPress={() => {
              Linking.openURL(whatsappLink(t('app.name'))).catch(() => {});
            }}
          />
        </DetailGroup>

        <View style={styles.out}>
          <SecondaryButton label={t('auth.signOut')} onPress={signOut} />
        </View>
      </ScrollView>

      {/*
        SelectRow rather than a plain list: it carries the three-way selection
        signal — border, fill, filled radio — which is the rule for a screen
        where someone is answering a question one-handed.
      */}
      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <View style={styles.scrim}>
          {/* Clear of the nav bar — the last language sat half under it. */}
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xxxl }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t('account.language')}</Text>
              <PressableSurface
                onPress={() => setPicking(false)}
                accessibilityLabel={t('common.close')}
              >
                <Icon name="close" size={22} tint={color.iconGrey} />
              </PressableSurface>
            </View>

            <View accessibilityRole="radiogroup" accessibilityLabel={t('account.language')}>
              {(['en', 'ar'] as const).map((lang) => (
                <SelectRow
                  key={lang}
                  title={LANGUAGE_NAME[lang]}
                  selected={lang === current}
                  onPress={() => {
                    void choose(lang);
                  }}
                  ground="ink"
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.xxl },

  identity: { alignItems: 'center', gap: space.xs },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  initials: { ...arabicIfNeeded(font.statement), color: color.accentLight },
  name: { ...arabicIfNeeded(font.statement), color: color.lightText },
  role: { ...arabicIfNeeded(font.body), color: alpha.onInk.body },

  out: { marginTop: space.sm },

  scrim: { flex: 1, backgroundColor: 'rgba(11,12,15,.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
    padding: GUTTER_INK,
    paddingBottom: space.xxxl,
    gap: space.md,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  sheetTitle: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
});
