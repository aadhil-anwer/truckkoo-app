/**
 * The answers a person gives while getting in — N1 to N6.
 *
 * MODULE SCOPE, NOT ASYNCSTORAGE: nothing here is worth the risk of a stale
 * answer surviving to someone else's sitting on a shared phone. The password is
 * NOT in here at all — it lives in the password screen's own state, and goes
 * nowhere but the auth call.
 *
 * INTERIM (2026-09-26). The handoff's N2/N3 are a phone number and a one-time
 * code. Codes go over WhatsApp, and until Meta's side is ready this flow asks for
 * an email and a password in the same one-question shape instead. When the codes
 * land, the email and password steps become `phone` and `code`, N1 loses its second
 * path, and nothing after the account step changes. See the P2 spec, §0b.
 */

export type AuthMode = 'signUp' | 'signIn';
export type Role = 'shipper' | 'driver';
export type AuthStep = 'email' | 'password' | 'otp-phone' | 'otp-code' | 'role' | 'name' | 'phone' | 'truck' | 'capacity' | 'plate';

export type AuthDraft = {
  mode: AuthMode;
  email: string;
  /**
   * Whether this sitting began at the email step. Someone arriving from Google,
   * or reopening the app with an account but no profile, starts at the role —
   * and a counter reading "3 / 6" on the first screen they see is a lie.
   */
  viaEmail: boolean;
  viaWhatsApp: boolean;
  role: Role | null;
  name: string;
  /** The 8 local digits. The +968 is drawn, not typed. */
  phone: string;
  truckType: string | null;
  capacityKg: number | null;
  plate: string;
};

const EMPTY: AuthDraft = {
  mode: 'signUp',
  email: '',
  viaEmail: false,
  viaWhatsApp: false,
  role: null,
  name: '',
  phone: '',
  truckType: null,
  capacityKg: null,
  plate: '',
};

let draft: AuthDraft = { ...EMPTY };

export function getAuthDraft(): AuthDraft {
  return draft;
}

export function updateAuthDraft(patch: Partial<AuthDraft>): AuthDraft {
  draft = { ...draft, ...patch };
  return draft;
}

/** Start a fresh sitting from N1. */
export function startAuthDraft(mode: AuthMode, viaWhatsApp = false): AuthDraft {
  draft = { ...EMPTY, mode, viaEmail: !viaWhatsApp, viaWhatsApp };
  return draft;
}

export function clearAuthDraft(): void {
  draft = { ...EMPTY };
}

/**
 * The steps this sitting will walk, in order.
 *
 * Role-dependent, which is why the handoff's N4 reads `3/5` and N5 reads `5/5`:
 * only drivers are asked for a truck. Before a role is picked the longer path is
 * assumed, so the counter can only get shorter — never longer — under a thumb.
 */
export function stepsFor(d: AuthDraft): AuthStep[] {
  if (d.mode === 'signIn') return d.viaWhatsApp ? ['otp-phone', 'otp-code'] : ['email', 'password'];
  const account: AuthStep[] = d.viaWhatsApp ? ['otp-phone', 'otp-code'] : d.viaEmail ? ['email', 'password'] : [];
  const profile: AuthStep[] = ['role', 'name', 'phone'];
  return d.role === 'shipper' ? [...account, ...profile] : [...account, ...profile, 'truck', 'capacity', 'plate'];
}

export function stepPosition(d: AuthDraft, step: AuthStep): { step: number; total: number } {
  // A screen reached without walking here — a reload, a deep link, or signing
  // in to an account that never finished setup — can hold a draft whose path
  // does not contain it. The account steps then count as a fresh email sitting;
  // the setup steps as setup from its own first question. Never "0 / 4".
  const account = step === 'email' || step === 'password' || step === 'otp-phone' || step === 'otp-code';
  const whatsapp = step === 'otp-phone' || step === 'otp-code';
  const steps = stepsFor(d).includes(step)
    ? stepsFor(d)
    : stepsFor(account ? { ...d, viaEmail: !whatsapp, viaWhatsApp: whatsapp }
      : { ...d, mode: 'signUp', viaEmail: false, viaWhatsApp: false });
  return { step: steps.indexOf(step) + 1, total: steps.length };
}

/**
 * Oman's dial code. A number, not copy — so it is not in the dictionary, where
 * the Arabic would owe it Eastern digits that no dialer reads.
 */
export const OMAN_DIAL = '+968';

/** An Omani mobile number: 8 digits, starting 7 or 9. */
export function isOmaniMobile(digits: string): boolean {
  return /^[79]\d{7}$/.test(digits);
}
