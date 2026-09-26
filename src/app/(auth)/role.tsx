/**
 * N4 · Which one are you?
 *
 * Permanent, and the copy says so out loud. That promise is kept by the schema,
 * not this screen: `profiles.role` carries an INSERT grant and no UPDATE grant,
 * so the choice made here cannot be changed from any client.
 *
 * Choosing advances on its own after a short beat, so the button is a fallback
 * rather than a second tap — and the button restates the choice, so a user who
 * does tap it knows what they are confirming.
 *
 * Back signs out. By the time anyone is here an account exists, so a back that
 * returned to the password step would offer to redo something already done.
 * Leaving is the honest version — and the way out for someone who signed in with
 * the wrong Google account.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { SelectCard } from '@/components/primitives';
import { t } from '@/i18n';
import { signOut } from '@/lib/auth';
import { getAuthDraft, stepPosition, updateAuthDraft, type Role } from '@/lib/auth-draft';
import { motion, space } from '@/theme/tokens';

export default function RoleFork() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(getAuthDraft().role);
  const { step, total } = stepPosition({ ...getAuthDraft(), role }, 'role');
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (advance.current) clearTimeout(advance.current);
  }, []);

  function next() {
    if (advance.current) clearTimeout(advance.current);
    router.push('/name');
  }

  function choose(value: Role) {
    setRole(value);
    // A different role changes which questions follow, so the truck answer from
    // an earlier pass through here must not ride along.
    updateAuthDraft({ role: value, truckType: null });
    if (advance.current) clearTimeout(advance.current);
    advance.current = setTimeout(next, motion.confirm);
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.role.title')}
      helper={t('auth.role.help')}
      onBack={() => {
        signOut();
      }}
      cta={
        role === 'driver'
          ? t('auth.role.cta.driver')
          : role === 'shipper'
            ? t('auth.role.cta.shipper')
            : t('action.continue')
      }
      ctaDisabled={!role}
      onCta={next}
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('auth.role.title')}
        style={{ gap: space.md }}
      >
        <SelectCard
          title={t('auth.role.shipper.title')}
          body={t('auth.role.shipper.detail')}
          icon="goods"
          selected={role === 'shipper'}
          onPress={() => choose('shipper')}
        />
        <SelectCard
          title={t('auth.role.driver.title')}
          body={t('auth.role.driver.detail')}
          icon="truck"
          selected={role === 'driver'}
          onPress={() => choose('driver')}
        />
      </View>
    </QuestionShell>
  );
}
