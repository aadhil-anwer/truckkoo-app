import { sendWhatsAppCode, verifyWhatsAppCode } from '@/lib/whatsapp-otp';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn() } } }));
const send = supabase.auth.signInWithOtp as jest.Mock;
const verify = supabase.auth.verifyOtp as jest.Mock;
beforeEach(() => { send.mockReset(); verify.mockReset(); });
afterEach(() => jest.useRealTimers());

it('uses the signed Auth hook and prevents sign-in from creating an account', async () => {
  send.mockResolvedValue({ error: null });
  expect(await sendWhatsAppCode('+96891234567', false)).toBe(true);
  expect(send).toHaveBeenCalledWith({ phone: '+96891234567', options: { shouldCreateUser: false } });
});

it('does not send malformed numbers or verify malformed codes', async () => {
  expect(await sendWhatsAppCode('not a number')).toBe(false);
  expect(await verifyWhatsAppCode('+96891234567', '12oops')).toBe(false);
  expect(send).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
});

it('returns control after a network request stalls', async () => {
  jest.useFakeTimers();
  send.mockImplementation(() => new Promise(() => {}));
  const result = sendWhatsAppCode('+96891234567');
  jest.advanceTimersByTime(15_000);
  expect(await result).toBe(false);
});
