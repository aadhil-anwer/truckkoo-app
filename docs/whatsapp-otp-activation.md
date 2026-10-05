# WhatsApp OTP activation gate

The app still uses email/password and OAuth. `send-whatsapp-otp` is a dormant
Supabase Auth Send SMS hook; `src/lib/whatsapp-otp.ts` is the client transport.
Phone/code screens are built behind `WHATSAPP_AUTH = false` in `src/lib/features.ts`.
They include a one-minute resend cooldown, change-number and email recovery,
localized digit input, bounded network waits and Gate-owned session routing.
There is no Meta Business number, approved authentication template, or API token
in this repository. Do not enable phone signup until they exist.

The hook verifies Supabase's Standard Webhooks signature before reading an OTP,
posts the code through Meta Cloud API, and returns a non-200 response if delivery
fails. The Meta token and hook secret belong in Supabase Edge Function secrets,
never in `EXPO_PUBLIC_*`, Git, or the ops console.

Activation sequence:

1. Get the WhatsApp Business phone number ID, a server token with messaging
   permission, and an approved **authentication** template. Confirm the exact
   template language and button parameter shape against Meta's approved record;
   the dormant function currently models one body parameter and one button
   parameter. Do a real test send before enabling Auth.
2. Set `SEND_SMS_HOOK_SECRET`, `META_WA_ACCESS_TOKEN`,
   `META_WA_PHONE_NUMBER_ID`, `META_WA_AUTH_TEMPLATE`, and
   `META_WA_GRAPH_VERSION` as Edge Function secrets. Configure the same webhook
   secret in Supabase Auth. Deploy `send-whatsapp-otp` with JWT verification off;
   the signed Auth hook is the authentication for this endpoint.
3. Enable Supabase phone auth with auto-confirmation **off** and wire the HTTP
   Send SMS hook. Increase the existing Auth OTP throttles if the real provider
   requires it; do not lower them. Keep email/OAuth available for accounts that
   have not linked a phone identity. Design and test account linking before
   switching the signup entry screen, or an existing user's phone can create a
   second profile.
4. Test the built phone/code screens with resend, expired code, wrong code, no WhatsApp,
   poor signal, and an existing email/OAuth account on a physical device.
5. Only then enable `WHATSAPP_AUTH`. There is no SMS
   fallback in this plan; Google/Apple/email remain recovery paths.

References: [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook),
[Supabase HTTP hook signature](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-hooks),
[Meta WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).
