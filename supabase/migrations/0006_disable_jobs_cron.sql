-- 0006_disable_jobs_cron.sql
-- JSearch free tier is only 200 req/month — disable the auto-refresh cron.
-- The user manually clicks Refresh in the UI (still quota-guarded by api_usage).

select cron.unschedule('plynth-fetch-jobs');
