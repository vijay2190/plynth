// _shared/mail.ts — sends mail via the local mail-bridge (Cloudflare Tunnel),
// falls back to Resend, then logs the outcome to email_log.

import { admin, getSecret } from './util.ts';

export interface SendMailInput {
  to?: string;             // optional override; default = MAIL_DEFAULT_TO
  subject: string;
  html?: string;
  text?: string;
  urgent?: boolean;
  user_id?: string;        // for email_log
}

const BRIDGE_TIMEOUT_MS = 6_000;

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; channel: string; error?: string }> {
  const sb = admin();
  const bridgeUrl = await getSecret('MAIL_BRIDGE_URL');
  const bridgeToken = await getSecret('MAIL_BRIDGE_TOKEN');
  const resendKey = await getSecret('RESEND_API_KEY');
  const defaultTo = await getSecret('MAIL_DEFAULT_TO') ?? 'vijay.devops.bot@gmail.com';
  const fromAddr = await getSecret('RESEND_FROM') ?? 'Plynth <onboarding@resend.dev>';
  const to = input.to ?? defaultTo;

  // Try mail bridge
  if (bridgeUrl && bridgeToken) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
      const r = await fetch(bridgeUrl.replace(/\/$/, '') + '/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
        body: JSON.stringify({
          to, subject: input.subject,
          body: input.html ?? input.text ?? '',
          body_type: input.html ? 'html' : 'plain',
          urgent: !!input.urgent,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        await sb.from('email_log').insert({ user_id: input.user_id ?? null, subject: input.subject, channel_used: 'bridge', status: 'sent' });
        return { ok: true, channel: 'bridge' };
      }
    } catch (_e) { /* fall through */ }
  }

  // Fall back to Resend
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: fromAddr, to: [to],
          subject: input.subject,
          html: input.html, text: input.text,
        }),
      });
      if (r.ok) {
        await sb.from('email_log').insert({ user_id: input.user_id ?? null, subject: input.subject, channel_used: 'resend', status: 'sent' });
        return { ok: true, channel: 'resend' };
      }
      const err = await r.text();
      await sb.from('email_log').insert({ user_id: input.user_id ?? null, subject: input.subject, channel_used: 'resend', status: 'failed', error: err });
      return { ok: false, channel: 'resend', error: err };
    } catch (e) {
      await sb.from('email_log').insert({ user_id: input.user_id ?? null, subject: input.subject, channel_used: 'resend', status: 'failed', error: String(e) });
    }
  }

  await sb.from('email_log').insert({ user_id: input.user_id ?? null, subject: input.subject, channel_used: 'queued', status: 'failed', error: 'no transport available' });
  return { ok: false, channel: 'none', error: 'no transport available' };
}
