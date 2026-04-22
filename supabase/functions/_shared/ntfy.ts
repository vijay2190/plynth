// _shared/ntfy.ts — push notification via ntfy.sh

import { getSecret } from './util.ts';

export async function pushNtfy(opts: { title: string; message: string; priority?: 'min' | 'low' | 'default' | 'high' | 'urgent'; tags?: string[] }) {
  const topic = await getSecret('NTFY_TOPIC');
  if (!topic) return false;
  try {
    const r = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        Title: opts.title,
        Priority: opts.priority ?? 'default',
        ...(opts.tags?.length ? { Tags: opts.tags.join(',') } : {}),
      },
      body: opts.message,
    });
    return r.ok;
  } catch { return false; }
}
