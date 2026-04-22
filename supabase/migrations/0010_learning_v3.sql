-- 0010_learning_v3.sql
-- Multi-day plan + skip-cascade + nullable daily budget.

-- 1. Make daily budget nullable so the user can disable the time cap entirely
--    (only max_items applies in that case).
alter table public.profiles
  alter column daily_plan_budget_min drop not null;

-- 2. Defer a single plan item: bump its date by 1 day, append at end of that day.
create or replace function public.defer_plan_item(p_id uuid)
returns public.learning_plans
language plpgsql security definer set search_path = public as $$
declare
  v_row public.learning_plans;
  v_max int;
begin
  select * into v_row from public.learning_plans where id = p_id and user_id = auth.uid();
  if v_row.id is null then
    raise exception 'plan item not found';
  end if;
  select coalesce(max(order_in_day), -1) + 1 into v_max
    from public.learning_plans
    where user_id = v_row.user_id and date = v_row.date + 1;
  update public.learning_plans
    set date = v_row.date + 1,
        order_in_day = v_max,
        status = 'pending',
        completed_at = null
    where id = p_id
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.defer_plan_item(uuid) from public;
grant execute on function public.defer_plan_item(uuid) to authenticated;

-- 3. Cascade-shift: pull the earliest pending item from any day after p_from_date
--    onto p_from_date, filling the gap left by a skipped item. Returns the
--    moved row (or null if no future item exists).
create or replace function public.shift_plans_up(p_from_date date)
returns public.learning_plans
language plpgsql security definer set search_path = public as $$
declare
  v_row public.learning_plans;
  v_max int;
begin
  select * into v_row from public.learning_plans
    where user_id = auth.uid()
      and date > p_from_date
      and status = 'pending'
    order by date asc, order_in_day asc
    limit 1;
  if v_row.id is null then
    return null;
  end if;
  select coalesce(max(order_in_day), -1) + 1 into v_max
    from public.learning_plans
    where user_id = v_row.user_id and date = p_from_date;
  update public.learning_plans
    set date = p_from_date,
        order_in_day = v_max
    where id = v_row.id
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.shift_plans_up(date) from public;
grant execute on function public.shift_plans_up(date) to authenticated;
