// send-reminder: dispatcher run every 5 minutes by pg_cron.
// For each enabled reminder_settings row, expand `times_of_day[]` and fire
// any time that falls inside the current 5-minute window. Per-fire dedup
// uses public.reminder_log. Manual test via POST {test_reminder_id: uuid}.

import { admin, json, corsHeaders, getSecret } from '../_shared/util.ts';
import { sendMail } from '../_shared/mail.ts';
import { pushNtfy } from '../_shared/ntfy.ts';
import { renderDigestEmail, type MailSection } from '../_shared/mail-template.ts';

const GRACE_MIN = 30; // fire if scheduled time is within the last 30 min AND hasn't fired today (dedup ensures single fire)

interface DigestData {
  sections: MailSection[];
  flatLines: string[];
}

async function buildDigest(sb: ReturnType<typeof admin>, userId: string, category: string): Promise<DigestData> {
  const today = new Date().toISOString().slice(0, 10);
  const sections: MailSection[] = [];
  const flatLines: string[] = [];

  if (category === 'all' || category === 'tasks') {
    const { data } = await sb.from('tasks').select('title,due_date,priority,status').eq('user_id', userId)
      .or(`due_date.eq.${today},and(due_date.lt.${today},status.neq.completed)`).neq('status', 'completed');
    if ((data ?? []).length) {
      sections.push({
        title: 'Tasks',
        emoji: '✅',
        items: data!.map((t) => ({
          html: `<b>${escapeHtml(t.title)}</b>`,
          meta: `${t.due_date ?? 'no date'} · ${t.priority}`,
        })),
      });
      for (const t of data!) flatLines.push(`• ${t.title} (${t.priority})`);
    }
  }
  if (category === 'all' || category === 'learning') {
    const { data } = await sb.from('learning_plans')
      .select('title,estimated_minutes,status,learning_topics(topic_name)').eq('user_id', userId)
      .eq('date', today).neq('status', 'completed').order('order_in_day');
    if ((data ?? []).length) {
      sections.push({
        title: 'Learning today',
        emoji: '📚',
        items: data!.map((p: any) => ({
          html: `<b>${escapeHtml(p.title)}</b>`,
          meta: `${p.learning_topics?.topic_name ?? ''} · ${p.estimated_minutes} min`,
        })),
      });
      for (const p of data!) flatLines.push(`• ${p.title} (${p.estimated_minutes}m)`);
    }
  }
  if (category === 'all' || category === 'finance') {
    const { data } = await sb.from('loans').select('name,emi_amount,emi_due_day,status').eq('user_id', userId).eq('status', 'active');
    const day = new Date().getDate();
    const due = (data ?? []).filter((l) => Math.abs(l.emi_due_day - day) <= 3);
    if (due.length) {
      sections.push({
        title: 'EMIs due soon',
        emoji: '💰',
        items: due.map((l) => ({
          html: `<b>${escapeHtml(l.name)}</b> &mdash; ₹${l.emi_amount}`,
          meta: `Due day ${l.emi_due_day} of the month`,
        })),
      });
      for (const l of due) flatLines.push(`• ${l.name} ₹${l.emi_amount} (day ${l.emi_due_day})`);
    }
  }
  if (category === 'all' || category === 'jobs') {
    const { data } = await sb.from('job_listings').select('title,company,job_url').eq('user_id', userId).eq('is_new', true).limit(10);
    if ((data ?? []).length) {
      sections.push({
        title: 'New jobs',
        emoji: '💼',
        items: data!.map((j) => ({
          html: `<a href="${j.job_url}" style="color:#6366f1;text-decoration:none"><b>${escapeHtml(j.title)}</b></a>`,
          meta: j.company,
        })),
      });
      for (const j of data!) flatLines.push(`• ${j.title} @ ${j.company}`);
    }
  }

  return { sections, flatLines };
}

interface ReminderRow {
  id: string;
  user_id: string;
  category: string;
  channel: 'email' | 'ntfy' | 'both';
  time_of_day: string;
  times_of_day: string[];
  days_of_week: number[];
  enabled: boolean;
  profiles?: { email?: string; full_name?: string; timezone?: string; ntfy_topic?: string };
}

async function dispatchOne(
  sb: ReturnType<typeof admin>,
  r: ReminderRow,
  fireFor: string,
  fireTime: string,
  appUrl: string,
): Promise<{ ok: boolean; channel: string }> {
  const digest = await buildDigest(sb, r.user_id, r.category);
  const greeting = greetingFor();
  const subject = `Plynth · ${prettyCategory(r.category)} · ${fireTime.slice(0, 5)}`;
  const html = renderDigestEmail({
    greeting: `${greeting}${r.profiles?.full_name ? ', ' + r.profiles.full_name.split(' ')[0] : ''} 👋`,
    intro: digest.sections.length
      ? `Here's your ${prettyCategory(r.category).toLowerCase()} digest for today.`
      : `No ${prettyCategory(r.category).toLowerCase()} items right now — you're all clear.`,
    sections: digest.sections,
    appUrl,
    footerNote: `Reminder fired at ${fireTime.slice(0, 5)} (your local time).`,
  });
  const text = digest.flatLines.length
    ? digest.flatLines.join('\n')
    : `No ${prettyCategory(r.category).toLowerCase()} items right now — you're all clear.`;

  let channel = 'none';
  let ok = false;
  if ((r.channel === 'email' || r.channel === 'both') && r.profiles?.email) {
    const m = await sendMail({ to: r.profiles.email, subject, html, user_id: r.user_id });
    channel = m.channel;
    ok = m.ok || ok;
  }
  if (r.channel === 'ntfy' || r.channel === 'both') {
    const sent = await pushNtfy({
      title: subject,
      message: text.slice(0, 280),
      topic: r.profiles?.ntfy_topic,
      priority: 'default',
      tags: ['bell'],
      click: appUrl,
    });
    if (sent) { channel = channel === 'none' ? 'ntfy' : channel + '+ntfy'; ok = ok || sent; }
  }

  // Log the fire (idempotent — primary key prevents duplicates)
  await sb.from('reminder_log').insert({
    reminder_id: r.id, fired_for: fireFor, fired_time: fireTime,
  });

  return { ok, channel };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const appUrl = (await getSecret('APP_URL')) ?? 'https://plynth.netlify.app';

  // Manual test path
  let testId: string | null = null;
  if (req.method === 'POST') {
    try { const body = await req.json(); testId = body?.test_reminder_id ?? null; } catch { /* ignore */ }
  }

  if (testId) {
    const { data: r, error } = await sb.from('reminder_settings').select('*').eq('id', testId).maybeSingle();
    if (error || !r) return json({ ok: false, error: error?.message ?? 'reminder not found' }, 404);
    const { data: prof } = await sb.from('profiles').select('email,full_name,timezone,ntfy_topic').eq('user_id', r.user_id).maybeSingle();
    const row = { ...(r as any), profiles: prof ?? {} } as ReminderRow;
    const now = new Date();
    const fireFor = now.toISOString().slice(0, 10);
    const fireTime = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:00`;
    await sb.from('reminder_log').delete().eq('reminder_id', testId).eq('fired_for', fireFor).eq('fired_time', fireTime);
    try {
      const res = await dispatchOne(sb, row, fireFor, fireTime, appUrl);
      return json({ ok: res.ok, channel: res.channel, test: true });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message, stack: (e as Error).stack }, 500);
    }
  }

  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const dow = now.getUTCDay();
  const today = now.toISOString().slice(0, 10);

  const { data: rules } = await sb.from('reminder_settings').select('*').eq('enabled', true);
  const userIds = Array.from(new Set((rules ?? []).map((r) => r.user_id)));
  const { data: profs } = userIds.length
    ? await sb.from('profiles').select('user_id,email,full_name,timezone,ntfy_topic').in('user_id', userIds)
    : { data: [] };
  const profMap = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));

  let dispatched = 0;
  let skipped = 0;
  for (const raw of rules ?? []) {
    const r = { ...(raw as any), profiles: profMap.get(raw.user_id) ?? {} } as ReminderRow;
    if (!r.days_of_week?.includes(dow)) { skipped++; continue; }
    const tz = r.profiles?.timezone ?? 'Asia/Kolkata';
    const offsetMin = -tzOffsetMinutes(tz, now);

    const times = (r.times_of_day && r.times_of_day.length) ? r.times_of_day : [r.time_of_day];
    for (const t of times) {
      if (!t) continue;
      const localMin = nowMinFromTimeOfDay(t);
      const targetUtcMin = ((localMin + offsetMin) + 1440) % 1440;
      const elapsed = (nowMin - targetUtcMin + 1440) % 1440;
      if (elapsed > GRACE_MIN) continue;

      // Dedup: skip if we already fired for (reminder, today, t)
      const { data: existing } = await sb.from('reminder_log')
        .select('reminder_id').eq('reminder_id', r.id).eq('fired_for', today).eq('fired_time', t).maybeSingle();
      if (existing) continue;

      try {
        const res = await dispatchOne(sb, r, today, t, appUrl);
        if (res.ok) dispatched++;
      } catch (e) {
        console.error('dispatch failed', r.id, t, e);
      }
    }
  }
  return json({ ok: true, dispatched, skipped, scanned: rules?.length ?? 0 });
});

function pad(n: number): string { return n.toString().padStart(2, '0'); }

// Returns the offset (in minutes) of the given IANA timezone from UTC at the given instant.
// Asia/Kolkata → +330. Falls back to 0 on unknown zones.
function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(at);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour) % 24, Number(map.minute), Number(map.second),
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch { return 0; }
}

function nowMinFromTimeOfDay(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function prettyCategory(c: string): string {
  return ({ all: 'Daily', tasks: 'Tasks', learning: 'Learning', finance: 'Finance', jobs: 'Jobs' } as Record<string, string>)[c] ?? c;
}
function greetingFor(): string {
  const h = new Date().getUTCHours() + 5; // crude IST lean
  const ist = (h + 24) % 24;
  if (ist < 12) return 'Good morning';
  if (ist < 17) return 'Good afternoon';
  return 'Good evening';
}
