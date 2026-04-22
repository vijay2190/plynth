-- 0007_saved_jobs.sql
-- Per-user "Saved / Interested" job listings.
-- Supports the bookmark icon on Browse and the Saved tab.

alter table public.job_listings
  add column if not exists is_saved boolean not null default false;

create index if not exists job_listings_saved_idx
  on public.job_listings (user_id, is_saved) where is_saved = true;
