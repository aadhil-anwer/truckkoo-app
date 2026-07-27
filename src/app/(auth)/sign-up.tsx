/**
 * Sign up, as three short steps rather than one long form.
 *
 *   1. account   — email + password
 *   2. role      — shipper or driver (insert-only; it cannot be changed later)
 *   3. details   — name, phone, and for drivers, their truck
 *
 * Stepped, not a wizard with chrome: one question per screen is the governing
 * constraint for this audience (PRODUCT.md). It now carries the same furniture
 * as the two posting flows — back chevron, step counter, one big question, one
 * pinned action — so a user who has signed up has already learned how to post a
 * load.
 *
 * A user who already has a session but no profile row lands directly on step 2 —
 * which is exactly what happens after an OAuth signup.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Body, Button, Choice, Field, Input, TextButton } from '@/components/primitives';
import { ActionBar, PageTitle, Screen, TopBar } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { createProfile, createTruck, signUpWithEmail } from '@/lib/auth';
import { useTruckTypes } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { color, font, GUTTER, space } from '@/theme/tokens';

type Step = 'account' | 'role' | 'details';
type Role = 'shipper' | 'driver';

export default function SignUp() {
  const router = useRouter();
  const { session, refreshProfile } = useSession();

  const {
    data: truckTypes,
    isPending: truckTypesPending,
    isFetching: truckTypesFetching,
    refetch: refetchTruckTypes,
  } = useTruckTypes();
  const truckOptions = truckTypes ?? [];

  const [chosenStep, setStep] = useState<Step>('account');

  // Derived, not synchronised. A session means the account step is already done,
  // however it was created — email signup or an OAuth round trip that returns
  // with a session but no profile row yet.
  const step: Step = !session ? 'account' : chosenStep === 'account' ? 'role' : chosenStep;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [role, setRole] = useState<Role | null>(null);

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [truckType, setTruckType] = useState<string | null>(null);
  const [truckError, setTruckError] = useState<string | null>(null);
  const [plate, setPlate] = useState('');

  async function submitAccount() {
    setFormError(null);
    setEmailError(null);
    setPasswordError(null);

    let bad = false;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError(t('error.email.invalid'));
      bad = true;
    }
    if (password.length < 8) {
      setPasswordError(t('error.password.short'));
      bad = true;
    }
    if (bad) return;

    setBusy(true);
    const result = await signUpWithEmail(email.trim(), password);
    setBusy(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    if (result.needsConfirmation) {
      setNotice(t('auth.checkEmail'));
      return;
    }
    setStep('role');
  }

  function submitRole() {
    setFormError(null);
    if (!role) {
      setFormError(t('error.role.required'));
      return;
    }
    setStep('details');
  }

  async function submitDetails() {
    setFormError(null);
    setNameError(null);
    setTruckError(null);

    let bad = false;
    if (name.trim().length === 0) {
      setNameError(t('error.name.required'));
      bad = true;
    }
    if (role === 'driver' && !truckType) {
      setTruckError(t('error.truck.required'));
      bad = true;
    }
    if (bad || !role) return;

    setBusy(true);
    const profileResult = await createProfile({
      role,
      fullName: name.trim(),
      phone: phone.trim() || null,
    });

    if (!profileResult.ok) {
      setBusy(false);
      setFormError(profileResult.message);
      return;
    }

    if (role === 'driver' && truckType) {
      // If this fails the account still exists and works; the driver just will
      // not be matched on capacity until a truck is added. Say so rather than
      // rolling back an account they just created.
      const truckResult = await createTruck({ truckType, plate: plate.trim() || null });
      if (!truckResult.ok) {
        setBusy(false);
        setFormError(truckResult.message);
        await refreshProfile();
        return;
      }
    }

    // The gate in _layout routes to the right home once the profile exists.
    await refreshProfile();
    setBusy(false);
  }

  function back() {
    if (step === 'details') return setStep('role');
    // Step 2 cannot go back to step 1: the account already exists by then, and
    // offering a "back" that cannot undo it would be a lie.
    if (step === 'role') return;
    router.back();
  }

  const stepIndex = step === 'account' ? 1 : step === 'role' ? 2 : 3;
  const title =
    step === 'account'
      ? t('auth.signUp.title')
      : step === 'role'
        ? t('auth.role.title')
        : role === 'driver'
          ? t('auth.truck.title')
          : t('auth.name');

  return (
    <Screen tone="surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TopBar
          onBack={step === 'role' ? undefined : back}
          action={<Text style={styles.stepMark}>{`${stepIndex} ${t('step.of')} 3`}</Text>}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageTitle
            detail={
              step === 'role'
                ? t('auth.role.help')
                : step === 'details' && role === 'driver'
                  ? t('auth.truck.help')
                  : undefined
            }
          >
            {title}
          </PageTitle>

          <View style={styles.form}>
            {step === 'account' && (
              <>
                <Field label={t('auth.email')}>
                  <Input
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('auth.email.placeholder')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    error={emailError}
                  />
                </Field>

                <Field label={t('auth.password')}>
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('auth.password.placeholder')}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    secureTextEntry
                    error={passwordError}
                    onSubmitEditing={submitAccount}
                  />
                </Field>

                {!!notice && (
                  <Text style={styles.notice} accessibilityLiveRegion="polite">
                    {notice}
                  </Text>
                )}

                <View style={styles.switch}>
                  <Body muted>{t('auth.toSignIn')}</Body>
                  <TextButton
                    label={t('auth.submit.signIn')}
                    align="center"
                    onPress={() => router.push('/sign-in')}
                  />
                </View>
              </>
            )}

            {step === 'role' && (
              <View style={styles.choices} accessibilityRole="radiogroup">
                <Choice
                  title={t('auth.role.shipper.title')}
                  detail={t('auth.role.shipper.detail')}
                  icon="loads"
                  selected={role === 'shipper'}
                  onPress={() => setRole('shipper')}
                />
                <Choice
                  title={t('auth.role.driver.title')}
                  detail={t('auth.role.driver.detail')}
                  icon="truck"
                  selected={role === 'driver'}
                  onPress={() => setRole('driver')}
                />
              </View>
            )}

            {step === 'details' && (
              <>
                <Field label={t('auth.name')}>
                  <Input
                    value={name}
                    onChangeText={setName}
                    placeholder={t('auth.name.placeholder')}
                    autoComplete="name"
                    textContentType="name"
                    error={nameError}
                  />
                </Field>

                <Field label={t('auth.phone')}>
                  <Input
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('auth.phone.placeholder')}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                  />
                </Field>
                <Text style={styles.help}>{t('auth.phone.help')}</Text>

                {role === 'driver' && (
                  <>
                    {/* Never render an empty radiogroup next to a rule that
                        demands a choice from it. This step asked for a truck size
                        with nothing to pick for anyone whose reference-data fetch
                        had failed — an unsatisfiable form at the last step of
                        creating an account, which is the worst place in the
                        product to strand someone. */}
                    {truckTypesPending ? (
                      <View style={styles.choicesBusy}>
                        <ActivityIndicator color={color.orange} />
                      </View>
                    ) : truckOptions.length === 0 ? (
                      <View style={styles.choices}>
                        <Body muted>{t('auth.truck.unavailable')}</Body>
                        <Button
                          label={t('common.retry')}
                          variant="secondary"
                          loading={truckTypesFetching}
                          onPress={() => {
                            refetchTruckTypes();
                          }}
                        />
                      </View>
                    ) : (
                      <View style={styles.choices} accessibilityRole="radiogroup">
                        {truckOptions.map((tt) => (
                          <Choice
                            key={tt.code}
                            title={localized({ name_en: tt.name_en, name_ar: tt.name_ar })}
                            detail={tt.description_en ?? undefined}
                            icon="truck"
                            selected={truckType === tt.code}
                            onPress={() => setTruckType(tt.code)}
                          />
                        ))}
                      </View>
                    )}

                    {!!truckError && (
                      <Text style={styles.formError} accessibilityLiveRegion="polite">
                        {truckError}
                      </Text>
                    )}

                    <Field label={t('auth.truck.plate')}>
                      <Input
                        value={plate}
                        onChangeText={setPlate}
                        placeholder={t('auth.truck.plate.placeholder')}
                        autoCapitalize="characters"
                      />
                    </Field>
                  </>
                )}
              </>
            )}

            {!!formError && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {formError}
              </Text>
            )}
          </View>
        </ScrollView>

        <ActionBar>
          <Button
            label={step === 'details' ? t('auth.submit.signUp') : t('common.next')}
            loading={busy}
            onPress={
              step === 'account' ? submitAccount : step === 'role' ? submitRole : submitDetails
            }
          />
        </ActionBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xl },
  form: { paddingHorizontal: GUTTER, gap: space.lg },
  stepMark: { ...font.label, color: color.inkSoft },
  choices: { gap: space.sm },
  // Reserves roughly the height the options would occupy, so the step does not
  // jump under the reader's thumb when they arrive.
  choicesBusy: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  help: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start, marginTop: -space.md },
  notice: { ...font.bodySmall, color: color.ink, textAlign: align.start },
  formError: { ...font.bodySmall, color: color.danger, textAlign: align.start },
  switch: { alignItems: 'center', paddingTop: space.sm },
});
