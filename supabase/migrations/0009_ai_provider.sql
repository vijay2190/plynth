-- 0009_ai_provider.sql — open-source AI providers (Groq + Ollama fallback)
-- Stores app-wide settings. Read by the Learning page to render the active provider pill.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Anyone signed in may read settings; only service role may write.
drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read" on public.app_settings
  for select using (auth.role() = 'authenticated');

-- Seed defaults (idempotent).
insert into public.app_settings (key, value) values
  ('ai_provider_chain', 'groq,ollama')
on conflict (key) do nothing;
