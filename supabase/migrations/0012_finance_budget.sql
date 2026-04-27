-- 0012_finance_budget.sql — Monthly budget, recurring expenses, monthly expenses.

-- Per-month total budget cap
create table if not exists public.budget_months (
  user_id    uuid not null references auth.users(id) on delete cascade,
  year_month text not null check (year_month ~ '^\d{4}-\d{2}$'),
  total_budget numeric not null default 0 check (total_budget >= 0),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, year_month)
);

-- Fixed/recurring expenses that apply to every month (e.g. mobile, wifi)
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null check (amount >= 0),
  category text not null default 'other',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.recurring_expenses(user_id, active);

-- One-off expenses for a particular month (recurring_id links materialized recurring rows)
create table if not exists public.monthly_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year_month text not null check (year_month ~ '^\d{4}-\d{2}$'),
  name text not null,
  amount numeric not null check (amount >= 0),
  category text not null default 'other',
  recurring_id uuid references public.recurring_expenses(id) on delete set null,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.monthly_expenses(user_id, year_month);

-- RLS
alter table public.budget_months      enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.monthly_expenses   enable row level security;

do $$ declare t text; begin
  for t in select unnest(array['budget_months','recurring_expenses','monthly_expenses']) loop
    execute format($f$
      drop policy if exists "own rows %1$s" on public.%1$I;
      create policy "own rows %1$s" on public.%1$I
        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;
