-- 0005_api_usage.sql
-- Tracks shared monthly API quota (e.g. JSearch 200 req/month).
-- One row per (api_name, month_year). Counts are global across all users
-- because the API key is shared.

create table if not exists public.api_usage (
  api_name      text        not null,
  month_year    text        not null,    -- 'YYYY-MM'
  count         int         not null default 0,
  monthly_limit int         not null,
  updated_at    timestamptz not null default now(),
  primary key (api_name, month_year)
);

alter table public.api_usage enable row level security;

-- Any authenticated user can read usage (so the UI can show it).
drop policy if exists api_usage_read on public.api_usage;
create policy api_usage_read on public.api_usage
  for select to authenticated using (true);

-- Atomic increment helper: returns the row AFTER increment.
-- If new count would exceed limit, raises 'quota_exceeded'.
create or replace function public.api_usage_increment(
  p_api_name text,
  p_limit    int
) returns public.api_usage
language plpgsql security definer as $$
declare
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_row   public.api_usage;
begin
  insert into public.api_usage(api_name, month_year, count, monthly_limit)
    values (p_api_name, v_month, 0, p_limit)
    on conflict (api_name, month_year) do nothing;

  update public.api_usage
     set count = count + 1, updated_at = now()
   where api_name = p_api_name and month_year = v_month
     and count < monthly_limit
   returning * into v_row;

  if v_row.api_name is null then
    raise exception 'quota_exceeded';
  end if;
  return v_row;
end $$;

revoke all on function public.api_usage_increment(text, int) from public;
grant execute on function public.api_usage_increment(text, int) to service_role;
