// ai-learning-plan: builds a study plan from active topics.
//
// Body shapes:
//   { topic_id }                       — regenerate one topic for today (manual click)
//   { scope: 'daily', date? }          — weighted plan across ALL active topics
//                                        for the given date (default: today)
//   { all_users: true }                — cron path: runs daily for every user

import { admin, json, corsHeaders, userFromAuth } from '../_shared/util.ts';
import { aiJSON } from '../_shared/ai-provider.ts';

interface PlanItem {
  title: string;
  description: string;
  estimated_minutes: number;
  resource_links: { label: string; url: string }[];
}

interface DailyPlanItem extends PlanItem {
  topic_id: string;
}

const SCHEMA_HINT = `{ "items": [ { "title": "...", "description": "...", "estimated_minutes": 30, "resource_links": [{ "label":"...", "url":"https://..." }] } ] }`;
const DAILY_SCHEMA_HINT = `{ "items": [ { "topic_id": "<uuid from input>", "title": "...", "description": "...", "estimated_minutes": 20, "resource_links": [{ "label":"...", "url":"https://..." }] } ] }`;

const DEFAULT_BUDGET_MIN = 90;
const DEFAULT_MAX_ITEMS = 8;

async function getCaps(sb: ReturnType<typeof admin>, userId: string) {
  const { data: prof } = await sb.from('profiles')
    .select('daily_plan_max_items, daily_plan_budget_min')
    .eq('user_id', userId).maybeSingle();
  return {
    maxItems: Math.max(1, Math.min(30, prof?.daily_plan_max_items ?? DEFAULT_MAX_ITEMS)),
    budgetMin: Math.max(15, Math.min(480, prof?.daily_plan_budget_min ?? DEFAULT_BUDGET_MIN)),
  };
}

async function recentForTopic(sb: ReturnType<typeof admin>, userId: string, topicId: string) {
  const { data: recent } = await sb.from('learning_plans').select('title,status,date').eq('user_id', userId).eq('topic_id', topicId)
    .gte('date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).order('date', { ascending: false });
  const skipped = (recent ?? []).filter((r) => r.status === 'skipped' || r.status === 'deferred').map((r) => r.title);
  const completed = (recent ?? []).filter((r) => r.status === 'completed').map((r) => r.title);
  return { skipped, completed };
}

async function generateForTopic(sb: ReturnType<typeof admin>, userId: string, topicId: string, date: string) {
  const { data: topic } = await sb.from('learning_topics').select('*').eq('id', topicId).eq('user_id', userId).maybeSingle();
  if (!topic) throw new Error('topic not found');
  const { skipped, completed } = await recentForTopic(sb, userId, topicId);

  const prompt = `You are a learning coach. Build a micro-plan (3-5 short items, total ~60-90 min) for the topic "${topic.topic_name}" at ${topic.level} level. Avoid repeating these recently-skipped items: ${JSON.stringify(skipped)}. Already-completed: ${JSON.stringify(completed)}. Each item must include 1-2 free public resource_links (docs, blog posts, YouTube).`;

  console.log('[ai-learning-plan] single-topic', JSON.stringify({ userId, topic: topic.topic_name }));
  const res = await aiJSON<{ items: PlanItem[] }>(prompt, SCHEMA_HINT);
  const items = (res.items ?? []).slice(0, 5);
  if (!items.length) throw new Error(`AI returned no items for "${topic.topic_name}". Please retry.`);

  // Replace existing AI rows for this topic on this date; preserve manual rows.
  await sb.from('learning_plans').delete()
    .eq('user_id', userId).eq('topic_id', topicId).eq('date', date).eq('source', 'ai');
  await sb.from('learning_plans').insert(items.map((it, i) => ({
    user_id: userId, topic_id: topicId, date,
    title: it.title, description: it.description ?? null,
    estimated_minutes: it.estimated_minutes ?? 30,
    resource_links: it.resource_links ?? [],
    order_in_day: i, status: 'pending', ai_generated: true, source: 'ai',
  })));
  return items;
}

// Allocate per-topic ITEM count (and minute budget) weighted by priority * urgency.
function allocate(topics: any[], date: string, totalMin: number, maxItems: number) {
  const dateMs = new Date(date + 'T00:00:00Z').getTime();
  const weighted = topics.map((t) => {
    const priority = Math.max(1, Math.min(5, t.priority ?? 3));
    let urgency = 1;
    if (t.target_completion_date) {
      const daysLeft = Math.max(1, Math.round((new Date(t.target_completion_date).getTime() - dateMs) / 86400000));
      urgency = Math.max(1, Math.min(5, Math.ceil(30 / Math.max(daysLeft, 3))));
    }
    return { topic: t, weight: priority * urgency };
  });
  const totalW = weighted.reduce((s, x) => s + x.weight, 0) || 1;

  // Largest-remainder method to split maxItems integer-cleanly across topics.
  const exact = weighted.map((w) => ({ ...w, share: (w.weight / totalW) * maxItems }));
  const floors = exact.map((e) => ({ ...e, n: Math.floor(e.share), frac: e.share - Math.floor(e.share) }));
  let remaining = maxItems - floors.reduce((s, f) => s + f.n, 0);
  floors.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < floors.length && remaining > 0; i++, remaining--) floors[i].n += 1;

  return floors
    .filter((f) => f.n >= 1)
    .map((f) => ({
      topic: f.topic,
      items: f.n,
      minutes: Math.round((f.weight / totalW) * totalMin),
    }));
}

async function generateDaily(sb: ReturnType<typeof admin>, userId: string, date: string) {
  const { data: topics } = await sb.from('learning_topics').select('*')
    .eq('user_id', userId).eq('status', 'active').order('priority', { ascending: false });
  if (!topics || topics.length === 0) throw new Error('No active topics. Add a topic first.');

  const { maxItems, budgetMin } = await getCaps(sb, userId);
  const allocations = allocate(topics, date, budgetMin, maxItems);
  if (allocations.length === 0) throw new Error('No topics qualified for today.');

  const topicBlocks = await Promise.all(allocations.map(async (a) => {
    const { skipped, completed } = await recentForTopic(sb, userId, a.topic.id);
    return {
      topic_id: a.topic.id,
      topic_name: a.topic.topic_name,
      level: a.topic.level,
      target_completion_date: a.topic.target_completion_date,
      item_count: a.items,
      minute_budget: a.minutes,
      avoid_recently_skipped: skipped,
      already_completed: completed,
    };
  }));

  const prompt = `You are a learning coach. Build a unified study plan across multiple topics for the same user.\n\nFor each topic below, generate EXACTLY "item_count" micro-items whose total minutes is close to (within +/- 10 of) that topic's "minute_budget". Topics with closer target_completion_date or higher item_count should get denser items. Each item must include 1-2 free public resource_links (docs, blog posts, YouTube). Set "topic_id" on each item to the topic's id from the input.\n\nTopics:\n${JSON.stringify(topicBlocks, null, 2)}\n\nReturn a single "items" array containing items for ALL topics combined.`;

  console.log('[ai-learning-plan] daily', JSON.stringify({ userId, date, topics: topicBlocks.length, maxItems, budgetMin }));
  const res = await aiJSON<{ items: DailyPlanItem[] }>(prompt, DAILY_SCHEMA_HINT);
  const validIds = new Set(topicBlocks.map((t) => t.topic_id));
  let items = (res.items ?? []).filter((it) => validIds.has(it.topic_id));
  if (!items.length) throw new Error('AI returned no items. Please retry.');

  // Server-side hard cap: enforce per-topic item_count even if model overshoots.
  const perTopicCap = new Map(topicBlocks.map((t) => [t.topic_id, t.item_count]));
  const counted = new Map<string, number>();
  items = items.filter((it) => {
    const cap = perTopicCap.get(it.topic_id) ?? 0;
    const used = counted.get(it.topic_id) ?? 0;
    if (used >= cap) return false;
    counted.set(it.topic_id, used + 1);
    return true;
  });

  // Replace today's AI rows for ALL active topics; preserve manual rows.
  const topicIds = topicBlocks.map((t) => t.topic_id);
  await sb.from('learning_plans').delete()
    .eq('user_id', userId).eq('date', date).eq('source', 'ai').in('topic_id', topicIds);

  const byTopic = new Map<string, DailyPlanItem[]>();
  for (const it of items) {
    const arr = byTopic.get(it.topic_id) ?? [];
    arr.push(it);
    byTopic.set(it.topic_id, arr);
  }
  const rows: any[] = [];
  let order = 0;
  for (const tid of topicIds) {
    for (const it of byTopic.get(tid) ?? []) {
      rows.push({
        user_id: userId, topic_id: tid, date,
        title: it.title, description: it.description ?? null,
        estimated_minutes: it.estimated_minutes ?? 20,
        resource_links: it.resource_links ?? [],
        order_in_day: order++, status: 'pending', ai_generated: true, source: 'ai',
      });
    }
  }
  if (rows.length) await sb.from('learning_plans').insert(rows);
  return {
    items,
    allocations: allocations.map((a) => ({
      topic_id: a.topic.id, topic_name: a.topic.topic_name, items: a.items, minutes: a.minutes,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const today = new Date().toISOString().slice(0, 10);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.all_users) {
      const { data: rows } = await sb.from('learning_topics').select('user_id').eq('status', 'active');
      const uniqueUsers = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
      let total = 0;
      for (const uid of uniqueUsers) {
        try { await generateDaily(sb, uid, today); total++; }
        catch (e) { console.warn('[ai-learning-plan] cron user failed', uid, String(e)); }
      }
      return json({ ok: true, generated_for: total });
    }

    const u = await userFromAuth(req);
    if (!u) return json({ error: 'unauthorized' }, 401);

    if (body.scope === 'daily') {
      const date = (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : today;
      const out = await generateDaily(sb, u.id, date);
      return json(out);
    }

    const topicId = body.topic_id;
    if (!topicId) return json({ error: 'topic_id or scope:"daily" required' }, 400);
    const date = (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : today;
    const items = await generateForTopic(sb, u.id, topicId, date);
    return json({ items });
  } catch (e) {
    console.error('[ai-learning-plan] error', String(e));
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
