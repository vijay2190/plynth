// _shared/ntfy.ts — push notification via ntfy.sh (per-user topic supported)

import { getSecret } from './util.ts';

export async function pushNtfy(opts: {
  title: string;
  message: string;
  topic?: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent';
  tags?: string[];
  click?: string;
}): Promise<boolean> {
  const topic = opts.topic ?? (await getSecret('NTFY_TOPIC'));
  if (!topic) return false;
  const headers: Record<string, string> = {
    Title: opts.title,
    Priority: opts.priority ?? 'default',
  };
  if (opts.tags?.length) headers.Tags = opts.tags.join(',');
  if (opts.click) headers.Click = opts.click;
  try {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: opts.message,
    });
    return r.ok;
  } catch {
    return false;
  }
}
