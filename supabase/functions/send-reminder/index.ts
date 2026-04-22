// send-reminder: dispatcher run every 5 minutes by pg_cron.
// For each enabled reminder_settings row whose time_of_day falls inside the
// last 5-minute window, build a digest and dispatch via mail / ntfy.

import { admin, json, corsHeaders } from '../_shared/util.ts';
import { sendMail } from '../_shared/mail.ts';
import { pushNtfy } from '../_shared/ntfy.ts';

function withinWindow(target: string, nowMin: number): boolean {
  const [h, m] = target.split(':').map(Number);
  const t = h * 60 + m;
  // 5-minute window centered on cron tick
  return Math.abs(t - nowMin) <= 4;
}

async function buildDigest(sb: ReturnType<typeof admin>, userId: string, category: string) {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  if (category === 'all' || category === 'tasks') {
    const { data } = await sb.from('tasks').select('title,due_date,priority,status').eq('user_id', userId)
      .or(`due_date.eq.${today},and(due_date.lt.${today},status.neq.completed)`).neq('status', 'completed');
    if ((data ?? []).length) {
      lines.push('<h3>Tasks</h3><ul>');
      for (const t of data!) lines.push(`<li><b>${t.title}</b> — ${t.due_date ?? 'no date'} (${t.priority})</li>`);
      lines.push('</ul>');
    }
  }
  if (category === 'all' || category === 'learning') {
    const { data } = await sb.from('learning_plans').select('title,estimated_minutes,status').eq('user_id', userId)
      .eq('date', today).neq('status', 'completed').order('order_in_day');
    if ((data ?? []).length) {
      lines.push('<h3>Learning today</h3><ul>');
      for (const p of data!) lines.push(`<li>${p.title} <i>(${p.estimated_minutes} min)</i></li>`);
      lines.push('</ul>');
    }
  }
  if (category === 'all' || category === 'finance') {
    const { data } = await sb.from('loans').select('name,emi_amount,emi_due_day,status').eq('user_id', userId).eq('status', 'active');
    const day = new Date().getDate();
    const due = (data ?? []).filter(l => Math.abs(l.emi_due_day - day) <= 3);
    if (due.length) {
      lines.push('<h3>EMIs due soon</h3><ul>');
      for (const l of due) lines.push(`<li><b>${l.name}</b> — ₹${l.emi_amount} on day ${l.emi_due_day}</li>`);
      lines.push('</ul>');
    }
  }
  if (category === 'all' || category === 'jobs') {
    const { data } = await sb.from('job_listings').select('title,company,job_url').eq('user_id', userId).eq('is_new', true).limit(10);
    if ((data ?? []).length) {
      lines.push('<h3>New jobs</h3><ul>');
      for (const j of data!) lines.push(`<li><a href="${j.job_url}">${j.title}</a> — ${j.company}</li>`);
      lines.push('</ul>');
    }
  }

  if (!lines.length) return null;
  return `<div style="font-family:sans-serif;line-height:1.5">${lines.join('\n')}<hr><p style="color:#888;font-size:12px">Plynth digest</p></div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const dow = now.getUTCDay();

  const { data: rules } = await sb.from('reminder_settings').select('*, profiles!inner(email,full_name,timezone)')
    .eq('enabled', true);

  let dispatched = 0;
  for (const r of rules ?? []) {
    // Convert local time_of_day → UTC minute using profile timezone (best-effort: server runs UTC).
    // Simple approach: assume time_of_day is in user's tz Asia/Kolkata-ish; offsets vary, but the
    // 5-minute window centered on UTC works if user keeps reminder times in IST and we offset by -330.
    const tz = (r as any).profiles?.timezone ?? 'Asia/Kolkata';
    const offsetMin = tz === 'Asia/Kolkata' ? -330 : 0; // extend later
    const targetUtcMin = ((nowMinFromTimeOfDay(r.time_of_day) + offsetMin) + 1440) % 1440;
    if (Math.abs(targetUtcMin - nowMin) > 4) continue;
    if (!(r.days_of_week as number[]).includes(dow)) continue;

    const html = await buildDigest(sb, r.user_id, r.category);
    if (!html) continue;

    const subject = `Plynth ${r.category} digest`;
    if (r.channel === 'email' || r.channel === 'both') {
      await sendMail({ to: (r as any).profiles?.email, subject, html, user_id: r.user_id });
    }
    if (r.channel === 'ntfy' || r.channel === 'both') {
      await pushNtfy({ title: subject, message: stripHtml(html).slice(0, 280), priority: 'default', tags: ['bell'] });
    }
    dispatched++;
  }
  return json({ ok: true, dispatched });
});

function nowMinFromTimeOfDay(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
