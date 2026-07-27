/**
 * Sign up, as three short steps rather than one long form.
 *
 *   1. account   — email + password
 *   2. role      — shipper or driver (insert-only; it cannot be changed later)
 *   3. details   — name, phone, and for drivers, their truck
 *
 * Stepped, not a wizard with chrome: one question per screen is the governing
 * constraint for this audience (PRODUCT.md), and the step counter is a document
 * field, not a progress bar.
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
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Masthead } from '@/components/masthead';
import { Body, Button, Choice, Field, Input, Rule } from '@/components/primitives';
import { align, localized, t } from '@/i18n';
import { createProfile, createTruck, signUpWithEmail } from '@/lib/auth';
import { useTruckTypes } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { color, font, space } from '@/theme/tokens';

type Step = 'account' | 'role' | 'details';
type Role = 'shipper' | 'driver';

export default function SignUp() {
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

  const stepIndex = step === 'account' ? 1 : step === 'role' ? 2 : 3;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Masthead
            title={
              step === 'account'
                ? t('auth.signUp.title')
                : step === 'role'
                  ? t('auth.role.title')
                  : role === 'driver'
                    ? t('auth.truck.title')
                    : t('auth.name')
            }
          />

          <View style={styles.form}>
            <Text style={styles.stepMark}>{`STEP ${stepIndex} / 3`}</Text>

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

                <Button
                  label={t('auth.submit.signUp')}
                  onPress={submitAccount}
                  loading={busy}
                />

                <Link href="/sign-in" style={styles.switch}>
                  <Text style={styles.switchText}>{t('auth.toSignIn')}</Text>
                </Link>
              </>
            )}

            {step === 'role' && (
              <>
                <Body muted>{t('auth.role.help')}</Body>

                <View style={styles.choices} accessibilityRole="radiogroup">
                  <Choice
                    title={t('auth.role.shipper.title')}
                    detail={t('auth.role.shipper.detail')}
                    selected={role === 'shipper'}
                    onPress={() => setRole('shipper')}
                  />
                  <Choice
                    title={t('auth.role.driver.title')}
                    detail={t('auth.role.driver.detail')}
                    selected={role === 'driver'}
                    onPress={() => setRole('driver')}
                  />
                </View>

                <Button label={t('auth.submit.signUp')} onPress={submitRole} />
              </>
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
                    <View style={styles.sectionRule}>
                      <Rule />
                    </View>

                    <Body muted>{t('auth.truck.help')}</Body>

                    {/* Never render an empty radiogroup next to a rule that
                        demands a choice from it. This step asked for a truck size
                        with nothing to pick for anyone whose reference-data fetch
                        had failed — an unsatisfiable form at the last step of
                        creating an account, which is the worst place in the
                        product to strand someone. A driver on a bad connection
                        can still reach these states, so each one says what it is
                        and offers the way out. */}
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

                <Button
                  label={t('auth.submit.signUp')}
                  onPress={submitDetails}
                  loading={busy}
                />
              </>
            )}

            {!!formError && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {formError}
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xxxl },
  form: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  stepMark: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: color.inkSoft,
    textAlign: align.start,
  },
  choices: { gap: space.sm },
  // Reserves roughly the height the options would occupy, so the step does not
  // jump under the reader's thumb when they arrive.
  choicesBusy: { minHeight: 88, alignItems: 'center', justifyContent: 'center' },
  sectionRule: { paddingVertical: space.xs },
  help: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start, marginTop: -space.sm },
  notice: { ...font.bodySmall, color: color.ink, textAlign: align.start },
  formError: { ...font.bodySmall, color: color.danger, textAlign: align.start },
  switch: { paddingVertical: space.md, alignSelf: 'center' },
  switchText: { ...font.label, color: color.orange, textAlign: 'center' },
});
