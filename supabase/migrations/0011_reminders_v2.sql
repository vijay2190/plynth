-- 0011_reminders_v2.sql — Per-user ntfy topic, multiple times per reminder, dedup log.

create extension if not exists pgcrypto;

-- 1) Per-user ntfy topic on profiles
alter table public.profiles add column if not exists ntfy_topic text;

-- Backfill: stable per-user topic derived from user_id (avoids guessability while staying deterministic on regenerate).
update public.profiles
set ntfy_topic = 'plynth-' || substr(encode(extensions.digest(user_id::text || coalesce(email,''), 'sha256'), 'hex'), 1, 20)
where ntfy_topic is null;

create unique index if not exists profiles_ntfy_topic_idx on public.profiles(ntfy_topic);

-- 2) Multiple times per reminder
alter table public.reminder_settings
  add column if not exists times_of_day time[] not null default array['07:00'::time];

-- Backfill from legacy single time_of_day for existing rows
update public.reminder_settings
set times_of_day = array[time_of_day]
where times_of_day = array['07:00'::time] and time_of_day is not null;

-- 3) Dedup log so a single (reminder, day, time) fires at most once
create table if not exists public.reminder_log (
  reminder_id uuid not null references public.reminder_settings(id) on delete cascade,
  fired_for date not null,
  fired_time time not null,
  fired_at timestamptz not null default now(),
  primary key (reminder_id, fired_for, fired_time)
);
alter table public.reminder_log enable row level security;
create policy "users read own reminder_log" on public.reminder_log
  for select using (
    exists (select 1 from public.reminder_settings rs where rs.id = reminder_id and rs.user_id = auth.uid())
  );

-- 4) Update new-user trigger to seed ntfy_topic + array form of times
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  topic text;
begin
  topic := 'plynth-' || substr(encode(extensions.digest(new.id::text || new.email, 'sha256'), 'hex'), 1, 20);

  insert into public.profiles (user_id, email, full_name, timezone, ntfy_topic)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'Asia/Kolkata', topic)
  on conflict (user_id) do nothing;

  insert into public.task_categories (user_id, name, color, icon) values
    (new.id, 'My Tasks',        '#6366f1', 'CheckSquare'),
    (new.id, 'Geetha''s Tasks', '#ec4899', 'Heart'),
    (new.id, 'Shared',          '#10b981', 'Users'),
    (new.id, 'Work',            '#f59e0b', 'Briefcase')
  on conflict do nothing;

  insert into public.learning_streaks (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.reminder_settings (user_id, category, channel, time_of_day, times_of_day, days_of_week, enabled) values
    (new.id, 'all',     'both',  '07:00', array['07:00'::time], '{0,1,2,3,4,5,6}', true),
    (new.id, 'finance', 'email', '09:00', array['09:00'::time], '{1,2,3,4,5}',     true);

  insert into public.job_settings (user_id) values (new.id) on conflict (user_id) do nothing;

  return new;
end;$$;
