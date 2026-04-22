// ai-learning-plan: builds today's plan from active topics + recent skip/defer history
// Body (per-user invocation):  { topic_id?: string }   — regenerates one topic for today
// Body (cron, all users):      { all_users: true }     — runs daily for every user

import { admin, json, corsHeaders, userFromAuth } from '../_shared/util.ts';
import { geminiJSON } from '../_shared/gemini.ts';

interface PlanItem {
  title: string;
  description: string;
  estimated_minutes: number;
  resource_links: { label: string; url: string }[];
}

const SCHEMA_HINT = `{ "items": [ { "title": "...", "description": "...", "estimated_minutes": 30, "resource_links": [{ "label":"...", "url":"https://..." }] } ] }`;

async function generateForTopic(sb: ReturnType<typeof admin>, userId: string, topicId: string, today: string) {
  const { data: topic } = await sb.from('learning_topics').select('*').eq('id', topicId).eq('user_id', userId).maybeSingle();
  if (!topic) return;
  const { data: recent } = await sb.from('learning_plans').select('title,status,date').eq('user_id', userId).eq('topic_id', topicId)
    .gte('date', new Date(Date.now() - 7*86400000).toISOString().slice(0,10)).order('date', { ascending: false });
  const skipped = (recent ?? []).filter(r => r.status === 'skipped' || r.status === 'deferred').map(r => r.title);
  const completed = (recent ?? []).filter(r => r.status === 'completed').map(r => r.title);

  const prompt = `You are a learning coach. Build today's micro-plan (3-5 short items, total ~60-90 min) for the topic "${topic.topic_name}" at ${topic.level} level. Avoid repeating these recently-skipped items: ${JSON.stringify(skipped)}. Already-completed: ${JSON.stringify(completed)}. Each item must include 1-2 free public resource_links (docs, blog posts, YouTube).`;

  const res = await geminiJSON<{ items: PlanItem[] }>(prompt, SCHEMA_HINT);
  const items = (res.items ?? []).slice(0, 5);

  // Replace existing today's rows for this topic
  await sb.from('learning_plans').delete().eq('user_id', userId).eq('topic_id', topicId).eq('date', today);
  if (items.length) {
    await sb.from('learning_plans').insert(items.map((it, i) => ({
      user_id: userId, topic_id: topicId, date: today,
      title: it.title, description: it.description ?? null,
      estimated_minutes: it.estimated_minutes ?? 30,
      resource_links: it.resource_links ?? [],
      order_in_day: i, status: 'pending', ai_generated: true,
    })));
  }
  return items;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const today = new Date().toISOString().slice(0, 10);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.all_users) {
      // Cron path — service role
      const { data: users } = await sb.from('learning_topics').select('user_id, id').eq('status', 'active');
      const byUser = new Map<string, string[]>();
      for (const r of users ?? []) {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r.id); byUser.set(r.user_id, arr);
      }
      let total = 0;
      for (const [uid, topicIds] of byUser) {
        for (const tid of topicIds.slice(0, 3)) { // cap 3 topics/user/day to save quota
          await generateForTopic(sb, uid, tid, today);
          total++;
        }
      }
      return json({ ok: true, generated_for: total });
    }

    // Per-user path
    const u = await userFromAuth(req);
    if (!u) return json({ error: 'unauthorized' }, 401);
    const topicId = body.topic_id;
    if (!topicId) return json({ error: 'topic_id required' }, 400);
    const items = await generateForTopic(sb, u.id, topicId, today);
    return json({ items });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
