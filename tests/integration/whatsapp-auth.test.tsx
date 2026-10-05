import { mockPush, mockReplace } from './harness';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Phone from '@/app/(auth)/otp-phone';
import Code from '@/app/(auth)/otp-code';
import { initLanguage } from '@/i18n';
import { clearAuthDraft, getAuthDraft, startAuthDraft, updateAuthDraft } from '@/lib/auth-draft';
import * as features from '@/lib/features';
import { sendWhatsAppCode, verifyWhatsAppCode } from '@/lib/whatsapp-otp';

jest.mock('@/lib/whatsapp-otp', () => ({ sendWhatsAppCode: jest.fn(), verifyWhatsAppCode: jest.fn() }));
jest.mock('@/lib/features', () => ({ __esModule: true, WHATSAPP_AUTH: true }));
const send = sendWhatsAppCode as jest.Mock;
const verify = verifyWhatsAppCode as jest.Mock;

beforeEach(() => {
  initLanguage('en');
  startAuthDraft('signUp', true);
  send.mockReset().mockResolvedValue(true);
  verify.mockReset().mockResolvedValue(true);
  mockPush.mockReset(); mockReplace.mockReset();
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); clearAuthDraft(); });

it('keeps phone authentication hidden until provider activation', async () => {
  jest.replaceProperty(features, 'WHATSAPP_AUTH', false);
  await render(<Phone />);
  expect(screen.queryByLabelText('Mobile number')).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('accepts Urdu digits and sends an Oman number through Supabase', async () => {
  await render(<Phone />);
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Mobile number'), '+968 ۹۱۲۳۴۵۶۷'); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Send WhatsApp code')); });
  expect(send).toHaveBeenCalledWith('+96891234567', true);
  expect(mockPush).toHaveBeenCalledWith('/otp-code');
  expect(getAuthDraft().phone).toBe('91234567');
});

it('keeps a failed send retryable and does not open the code screen', async () => {
  send.mockResolvedValue(false);
  await render(<Phone />);
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Mobile number'), '91234567'); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Send WhatsApp code')); });
  expect(screen.getByText(/Could not send the code/)).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

it('confirms a code without routing before the session Gate is ready', async () => {
  updateAuthDraft({ phone: '91234567' });
  await render(<Code />);
  await act(async () => { fireEvent.changeText(screen.getByLabelText('One-time code'), '۱۲۳۴۵۶'); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Confirm code')); });
  expect(verify).toHaveBeenCalledWith('+96891234567', '123456');
  expect(mockPush).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
  expect(getAuthDraft()).not.toHaveProperty('code');
});

it('offers a new code after a one-minute cooldown and lets the number be changed', async () => {
  jest.useFakeTimers();
  updateAuthDraft({ phone: '91234567' });
  await render(<Code />);
  expect(screen.getByLabelText('Send again in 60 seconds')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Send a new code')); });
  expect(send).toHaveBeenCalledWith('+96891234567', true);
  fireEvent.press(screen.getByLabelText('Change number'));
  expect(mockReplace).toHaveBeenCalledWith('/otp-phone');
});
