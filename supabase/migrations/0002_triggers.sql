-- 0002_triggers.sql — defaults seeded on new user; signup allowlist

-- Allowlist: only emails configured in app_settings.allowed_emails can sign up.
-- We store the list as a Vault secret named 'ALLOWED_SIGNUP_EMAILS' (comma-separated).
-- For local dev or first run, the trigger allows all if the secret is missing.

create or replace function public.is_signup_allowed(email text) returns boolean
language plpgsql security definer as $$
declare
  allowed text;
begin
  begin
    select decrypted_secret into allowed from vault.decrypted_secrets where name = 'ALLOWED_SIGNUP_EMAILS' limit 1;
  exception when others then
    allowed := null;
  end;
  if allowed is null or trim(allowed) = '' then
    return true;
  end if;
  return position(lower(email) in lower(allowed)) > 0;
end;$$;

create or replace function public.handle_signup_check() returns trigger
language plpgsql security definer as $$
begin
  if not public.is_signup_allowed(new.email) then
    raise exception 'Signup not allowed for this email address';
  end if;
  return new;
end;$$;

drop trigger if exists check_signup_allowlist on auth.users;
create trigger check_signup_allowlist
  before insert on auth.users
  for each row execute function public.handle_signup_check();

-- On new user: seed profile, default categories, streaks, default reminders.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, email, full_name, timezone)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'Asia/Kolkata')
  on conflict (user_id) do nothing;

  insert into public.task_categories (user_id, name, color, icon) values
    (new.id, 'My Tasks',        '#6366f1', 'CheckSquare'),
    (new.id, 'Geetha''s Tasks', '#ec4899', 'Heart'),
    (new.id, 'Shared',          '#10b981', 'Users'),
    (new.id, 'Work',            '#f59e0b', 'Briefcase')
  on conflict do nothing;

  insert into public.learning_streaks (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.reminder_settings (user_id, category, channel, time_of_day, days_of_week, enabled) values
    (new.id, 'all',     'both',  '07:00', '{0,1,2,3,4,5,6}', true),
    (new.id, 'finance', 'email', '09:00', '{1,2,3,4,5}',     true);

  insert into public.job_settings (user_id) values (new.id) on conflict (user_id) do nothing;

  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
