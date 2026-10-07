/** Phone authentication transport, dormant until the Meta hook is activated. */
import { supabase } from './supabase';

async function bounded(action: PromiseLike<{ error: unknown }>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(action),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 15_000); }),
    ]);
    return result !== null && !result.error;
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}

/** Supabase sends through its signed Send SMS hook; no Meta token enters the app. */
export async function sendWhatsAppCode(phone: string, createAccount = true): Promise<boolean> {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return false;
  return bounded(supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: createAccount } }));
}

export async function verifyWhatsAppCode(phone: string, code: string): Promise<boolean> {
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{4,10}$/.test(code)) return false;
  return bounded(supabase.auth.verifyOtp({ phone, token: code, type: 'sms' }));
}
