-- 0008_learning_v2.sql
-- Learning page v2: distinguish manual vs AI plan items, per-user daily caps,
-- and reuse api_usage for Gemini quota tracking.

-- 1. Source column on plan items.
alter table public.learning_plans
  add column if not exists source text not null default 'ai'
  check (source in ('ai', 'manual'));

-- 2. Per-user daily plan caps live on profiles.
alter table public.profiles
  add column if not exists daily_plan_max_items int not null default 8
  check (daily_plan_max_items between 1 and 30);

alter table public.profiles
  add column if not exists daily_plan_budget_min int not null default 90
  check (daily_plan_budget_min between 15 and 480);

-- 3. Lazy increment helper for shared API counters that should NOT raise on
-- quota exhaustion (we just want a counter for display). Uses upsert pattern
-- and returns the post-increment row. Used by the Gemini tracker.
create or replace function public.api_usage_bump(
  p_api_name text,
  p_limit    int
) returns public.api_usage
language plpgsql security definer as $$
declare
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_row   public.api_usage;
begin
  insert into public.api_usage(api_name, month_year, count, monthly_limit)
    values (p_api_name, v_month, 1, p_limit)
    on conflict (api_name, month_year) do update
      set count = public.api_usage.count + 1,
          updated_at = now()
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.api_usage_bump(text, int) from public;
grant execute on function public.api_usage_bump(text, int) to service_role;
