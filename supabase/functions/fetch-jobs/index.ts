// fetch-jobs: queries JSearch (RapidAPI), dedupes, inserts new listings.

import { admin, json, corsHeaders, userFromAuth, getSecret } from '../_shared/util.ts';

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_city?: string; job_country?: string;
  job_apply_link: string;
  job_min_salary?: number; job_max_salary?: number; job_salary_currency?: string;
  job_description?: string;
  job_publisher?: string;
  job_posted_at_datetime_utc?: string;
}

async function searchJobs(query: string, location: string | undefined, remote: string): Promise<JSearchJob[]> {
  const key = await getSecret('RAPIDAPI_JSEARCH_KEY');
  if (!key) throw new Error('RAPIDAPI_JSEARCH_KEY not configured');
  const params = new URLSearchParams({
    query: location ? `${query} in ${location}` : query,
    page: '1', num_pages: '1', date_posted: 'week',
  });
  if (remote === 'remote') params.set('remote_jobs_only', 'true');
  const r = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
  });
  if (!r.ok) throw new Error(`JSearch ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data?.data ?? [];
}

async function fetchForUser(sb: ReturnType<typeof admin>, userId: string) {
  const { data: settings } = await sb.from('job_settings').select('*').eq('user_id', userId).maybeSingle();
  if (!settings) return 0;
  const keyword = (settings.keywords ?? [])[0] ?? 'software engineer';
  const location = (settings.locations ?? [])[0];
  const remote = settings.remote_preference ?? 'any';

  const jobs = await searchJobs(keyword, location, remote);
  let inserted = 0;
  for (const j of jobs) {
    const { error } = await sb.from('job_listings').insert({
      user_id: userId,
      external_id: j.job_id,
      title: j.job_title,
      company: j.employer_name,
      location: [j.job_city, j.job_country].filter(Boolean).join(', ') || null,
      salary_range: j.job_min_salary ? `${j.job_min_salary}-${j.job_max_salary} ${j.job_salary_currency}` : null,
      job_url: j.job_apply_link,
      source: (j.job_publisher || 'unknown').toLowerCase(),
      description_snippet: (j.job_description ?? '').slice(0, 400),
      posted_date: j.job_posted_at_datetime_utc ? j.job_posted_at_datetime_utc.slice(0, 10) : null,
      is_new: true,
    });
    if (!error) inserted++;
  }
  return inserted;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.all_users) {
      const { data: settings } = await sb.from('job_settings').select('user_id').eq('auto_refresh', true);
      let total = 0;
      for (const s of settings ?? []) total += await fetchForUser(sb, s.user_id);
      return json({ ok: true, inserted: total });
    }
    const u = await userFromAuth(req);
    if (!u) return json({ error: 'unauthorized' }, 401);
    const inserted = await fetchForUser(sb, u.id);
    return json({ ok: true, inserted });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
