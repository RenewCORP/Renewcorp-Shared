// Environment variables required in Supabase Dashboard → Edge Functions → Secrets:
//   RESEND_API_KEY   — your Resend API key
//   FEEDBACK_TO_EMAIL — email address to receive feedback notifications
//   APP_NAME         — app name shown in email subject, e.g. "Outback Explorer"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') ?? '';
const TO_EMAIL        = Deno.env.get('FEEDBACK_TO_EMAIL') ?? '';
const APP_NAME        = Deno.env.get('APP_NAME') ?? 'App';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { category, title, body } = await req.json() as {
    category: string;
    title: string;
    body: string;
  };

  const subject = `[${APP_NAME}] ${capitalize(category)}: ${title}`;
  const emailBody = `Category: ${category}\nTitle: ${title}\n\n${body}`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${APP_NAME} <onboarding@resend.dev>`,
      to: [TO_EMAIL],
      subject,
      text: emailBody,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: err }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

function capitalize(s: string): string {
  if (!s) return '';
  if (s === 'feature') return 'Feature Request';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
