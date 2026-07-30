/**
 * Account.
 *
 * Sign-out used to live as a text link in the corner of every masthead. Moving
 * it here is what let the header shrink to a back chevron, and it is also where
 * every phone owner already looks for it.
 *
 * WHAT THIS SCREEN MAY SAY
 *
 * Only what `profiles` actually holds: name, phone, role. No tier, no rating, no
 * loads-completed, no member-since. PRODUCT.md and CLAUDE.md §5 forbid
 * fabricating proof, and an account screen is exactly where a plausible-looking
 * invented number would go unchallenged. The one claim it does repeat —
 * "replies in minutes, 7 days a week" — is a commitment the live website already
 * makes in public.
 */

import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/ui';
import { getLanguage, t } from '@/i18n';
import { signOut } from '@/lib/auth';
import { safeText, whatsappLink } from '@/lib/safe-text';
import { useSession } from '@/lib/session';
import { GUTTER_INK, space } from '@/theme/tokens';
import { Avatar, Button, ListRow, PageTitle, RowGroup, Section } from '@/components/legacy';

export default function AccountTab() {
  const { profile } = useSession();

  const name = profile?.full_name?.trim() ?? '';
  const isDriver = profile?.role === 'driver';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <PageTitle>{t('account.title')}</PageTitle>

        <View style={styles.identity}>
          <Avatar name={name || 'T'} size={64} />
          <RowGroup style={styles.identityRows}>
            <ListRow
              icon={isDriver ? 'truck' : 'loads'}
              title={safeText(name)}
              subtitle={isDriver ? t('account.role.driver') : t('account.role.shipper')}
              last
            />
          </RowGroup>
        </View>

        <Section title={t('account.details')}>
          <View style={styles.group}>
            <RowGroup>
              <ListRow icon="phone" title={t('auth.phone')} subtitle={safeText(profile?.phone ?? '—')} />
              <ListRow
                icon="language"
                title={t('account.language')}
                // Read-only on purpose: React Native applies RTL at the native
                // level and needs a reload to flip it, so a picker here would
                // promise something a tap cannot deliver (STACK.md §5).
                subtitle={getLanguage() === 'ar' ? 'العربية' : 'English'}
                last
              />
            </RowGroup>
          </View>
        </Section>

        <Section title={t('account.help')}>
          <View style={styles.group}>
            <RowGroup>
              <ListRow
                icon="whatsapp"
                tone="orange"
                title={t('whatsapp.action')}
                subtitle={t('account.help.detail')}
                chevron
                last
                onPress={() => {
                  Linking.openURL(whatsappLink(t('app.name'))).catch(() => {});
                }}
              />
            </RowGroup>
          </View>
        </Section>

        <View style={styles.out}>
          <Button label={t('auth.signOut')} variant="secondary" icon="signOut" onPress={signOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxxl, gap: space.xxl },
  identity: { alignItems: 'center', gap: space.md, paddingHorizontal: GUTTER_INK },
  identityRows: { alignSelf: 'stretch' },
  group: { paddingHorizontal: GUTTER_INK },
  out: { paddingHorizontal: GUTTER_INK, paddingTop: space.sm },
});
