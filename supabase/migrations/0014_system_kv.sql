-- 0014_system_kv.sql — service-role-only key/value table for system runtime config
-- Used by edge functions to look up the current Ollama tunnel URL (which rotates).

create table if not exists public.system_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.system_kv enable row level security;
-- No policies → only service_role can read/write. Edge functions use service role.
