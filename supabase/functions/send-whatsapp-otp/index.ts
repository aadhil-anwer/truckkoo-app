/** Supabase Auth Send SMS hook. Deploy disabled until Meta approves the template. */
// @ts-expect-error Deno resolves URL imports when the Edge Function is deployed.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

declare const Deno: {
  serve(handler: (request: Request) => Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type SmsEvent = { user?: { phone?: string }; sms?: { otp?: string } };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const secrets = Deno.env.get('SEND_SMS_HOOK_SECRET')?.split('|') ?? [];
  const token = Deno.env.get('META_WA_ACCESS_TOKEN');
  const phoneId = Deno.env.get('META_WA_PHONE_NUMBER_ID');
  const template = Deno.env.get('META_WA_AUTH_TEMPLATE');
  const version = Deno.env.get('META_WA_GRAPH_VERSION');
  if (!secrets.length || !token || !phoneId || !template || !version || !/^v\d+[.]\d+$/.test(version)) {
    return new Response(null, { status: 503 });
  }

  const payload = await request.text();
  let event: SmsEvent | null = null;
  for (const secret of secrets) {
    try {
      event = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(
        payload, Object.fromEntries(request.headers),
      ) as SmsEvent;
      break;
    } catch { /* Rotating secrets: try the next one. */ }
  }
  if (!event) return new Response(null, { status: 401 });
  const phone = event.user?.phone?.replace(/^\+/, '');
  const otp = event.sms?.otp;
  if (!phone || !/^[1-9]\d{7,14}$/.test(phone) || !otp || !/^\d{4,10}$/.test(otp)) {
    return new Response(null, { status: 400 });
  }

  // The approved authentication template must have one body parameter and a
  // copy-code button at index 0. The same OTP fills both slots. Never log it.
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template,
        language: { code: 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: otp }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
        ],
      },
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  // Auth must not issue a usable code when delivery failed. Do not expose the
  // provider's response: it can contain numbers and internal account details.
  if (!response?.ok) return new Response(null, { status: 503 });
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
