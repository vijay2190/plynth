-- 0001_schema.sql — Plynth core schema with RLS
-- All tables filter by user_id; auth.uid() = user_id.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  timezone text not null default 'Asia/Kolkata',
  theme_preference text not null default 'system',
  created_at timestamptz not null default now()
);

-- ---------- Learning ----------
create table if not exists public.learning_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_name text not null,
  level text not null check (level in ('beginner','intermediate','advanced')),
  priority int not null default 3 check (priority between 1 and 5),
  status text not null default 'active' check (status in ('active','paused','completed')),
  target_completion_date date,
  created_at timestamptz not null default now()
);
create index on public.learning_topics(user_id, status);

create table if not exists public.learning_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.learning_topics(id) on delete cascade,
  date date not null,
  title text not null,
  description text,
  resource_links jsonb not null default '[]'::jsonb,
  estimated_minutes int not null default 30,
  order_in_day int not null default 0,
  status text not null default 'pending' check (status in ('pending','completed','skipped','deferred')),
  completed_at timestamptz,
  ai_generated boolean not null default true
);
create index on public.learning_plans(user_id, date);

create table if not exists public.learning_streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_active_date date
);

-- ---------- Jobs ----------
create table if not exists public.job_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  keywords text[] not null default '{}',
  preferred_roles text[] not null default '{}',
  locations text[] not null default '{}',
  experience_min int,
  experience_max int,
  salary_min int,
  remote_preference text not null default 'any' check (remote_preference in ('remote','hybrid','onsite','any')),
  auto_refresh boolean not null default true
);

create table if not exists public.job_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null,
  company text not null,
  location text,
  salary_range text,
  job_url text not null,
  source text not null,
  description_snippet text,
  posted_date date,
  fetched_at timestamptz not null default now(),
  is_new boolean not null default true,
  unique (user_id, external_id)
);
create index on public.job_listings(user_id, fetched_at desc);

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null,
  role text not null,
  job_url text,
  resume_used text,
  applied_date date not null default current_date,
  status text not null default 'applied' check (status in ('applied','screening','interview','offer','rejected','ghosted')),
  notes text,
  follow_up_date date,
  salary_offered numeric,
  updated_at timestamptz not null default now()
);
create index on public.job_applications(user_id, status);

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  file_url text not null,
  version int not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- To-Do ----------
create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text not null default 'CheckSquare',
  unique (user_id, name)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.task_categories(id) on delete set null,
  title text not null,
  description text,
  due_date date,
  due_time time,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  is_recurring boolean not null default false,
  recurrence_rule text,
  reminder_at timestamptz,
  reminder_sent boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.tasks(user_id, due_date);
create index on public.tasks(user_id, status);

-- ---------- Finance ----------
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  lender text,
  loan_type text not null,
  principal_amount numeric not null,
  interest_rate numeric not null,
  emi_amount numeric not null,
  tenure_months int not null,
  start_date date not null,
  emi_due_day int not null check (emi_due_day between 1 and 28),
  status text not null default 'active' check (status in ('active','closed'))
);
create index on public.loans(user_id, status);

create table if not exists public.emi_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_year text not null,
  due_date date not null,
  amount_paid numeric,
  paid_date date,
  status text not null default 'pending' check (status in ('pending','paid','overdue','skipped')),
  notes text,
  unique (loan_id, month_year)
);
create index on public.emi_payments(user_id, due_date);

-- ---------- Reminders ----------
create table if not exists public.reminder_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  channel text not null default 'both' check (channel in ('email','ntfy','both')),
  time_of_day time not null default '07:00',
  days_of_week int[] not null default '{1,2,3,4,5,6,0}',
  enabled boolean not null default true
);

-- ---------- Email log (observability) ----------
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  subject text not null,
  channel_used text not null,
  status text not null,
  error text,
  sent_at timestamptz not null default now()
);
create index on public.email_log(sent_at desc);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.learning_topics enable row level security;
alter table public.learning_plans enable row level security;
alter table public.learning_streaks enable row level security;
alter table public.job_settings enable row level security;
alter table public.job_listings enable row level security;
alter table public.job_applications enable row level security;
alter table public.resumes enable row level security;
alter table public.task_categories enable row level security;
alter table public.tasks enable row level security;
alter table public.loans enable row level security;
alter table public.emi_payments enable row level security;
alter table public.reminder_settings enable row level security;
alter table public.email_log enable row level security;

-- Generic policy template: each user only sees their own rows.
do $$
declare t text;
begin
  for t in select unnest(array[
    'profiles','learning_topics','learning_plans','learning_streaks',
    'job_settings','job_listings','job_applications','resumes',
    'task_categories','tasks','loans','emi_payments','reminder_settings'
  ]) loop
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);
    execute format('create policy "own_select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own_insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own_update" on public.%I for update using (user_id = auth.uid())', t);
    execute format('create policy "own_delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end$$;

-- email_log: users see their own; service role inserts.
drop policy if exists "own_select" on public.email_log;
create policy "own_select" on public.email_log for select using (user_id = auth.uid());
