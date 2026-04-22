// send-mail: generic relay used by other functions or admin tooling.

import { json, corsHeaders } from '../_shared/util.ts';
import { sendMail } from '../_shared/mail.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  // Require a shared admin token to prevent abuse.
  const adminToken = Deno.env.get('SEND_MAIL_TOKEN');
  if (adminToken && req.headers.get('X-Admin-Token') !== adminToken) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await req.json().catch(() => ({}));
  if (!body.subject || !(body.html || body.text)) return json({ error: 'subject + html|text required' }, 400);
  const result = await sendMail(body);
  return json(result, result.ok ? 200 : 502);
});
