-- 0004_cron.sql — Schedule edge functions via pg_cron + pg_net.
-- Run AFTER edge functions are deployed and Vault secrets are set:
--   PROJECT_URL, SERVICE_ROLE_KEY (used to invoke functions internally).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: invoke an edge function via pg_net.
create or replace function public.invoke_edge(name text, payload jsonb default '{}'::jsonb) returns void
language plpgsql security definer as $$
declare
  base_url text;
  service_key text;
begin
  select decrypted_secret into base_url    from vault.decrypted_secrets where name = 'PROJECT_URL'      limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'SERVICE_ROLE_KEY' limit 1;
  if base_url is null or service_key is null then
    raise notice 'PROJECT_URL or SERVICE_ROLE_KEY missing in vault — skipping %', name;
    return;
  end if;
  perform net.http_post(
    url     := base_url || '/functions/v1/' || name,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key),
    body    := payload
  );
end;$$;

-- 06:00 IST = 00:30 UTC daily → AI learning plan
select cron.schedule('plynth-ai-learning-plan', '30 0 * * *', $$select public.invoke_edge('ai-learning-plan', '{"all_users":true}'::jsonb);$$);

-- Every 6 hours → fetch jobs
select cron.schedule('plynth-fetch-jobs', '0 */6 * * *', $$select public.invoke_edge('fetch-jobs', '{"all_users":true}'::jsonb);$$);

-- Every 5 minutes → send-reminder dispatcher (function decides which users/categories to fire)
select cron.schedule('plynth-send-reminder', '*/5 * * * *', $$select public.invoke_edge('send-reminder', '{}'::jsonb);$$);
