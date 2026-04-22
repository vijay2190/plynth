# Plynth Deployment Guide

## 1. Supabase project

```bash
# Create project at https://supabase.com (free tier).
# Note the Project URL, anon key, and service-role key.

cd /home/vijay/plynth/supabase
supabase login
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push

# Set vault secrets (used by edge functions)
supabase secrets set GEMINI_API_KEY=<key>
supabase secrets set RAPIDAPI_JSEARCH_KEY=<key>
supabase secrets set RESEND_API_KEY=<key>
supabase secrets set RESEND_FROM='Plynth <onboarding@resend.dev>'
supabase secrets set MAIL_DEFAULT_TO=vijay.devops.bot@gmail.com
supabase secrets set MAIL_BRIDGE_URL=https://<your-cloudflare-tunnel-host>
supabase secrets set MAIL_BRIDGE_TOKEN=<same token as in mail-bridge/.env>
supabase secrets set NTFY_TOPIC=vijay-devbot-7k9x
supabase secrets set ALLOWED_SIGNUP_EMAILS=vijay.devops.bot@gmail.com,geetha@example.com
supabase secrets set PROJECT_URL=https://<ref>.supabase.co
supabase secrets set SERVICE_ROLE_KEY=<service role key>

# Deploy edge functions
supabase functions deploy ai-learning-plan
supabase functions deploy fetch-jobs
supabase functions deploy send-reminder --no-verify-jwt
supabase functions deploy send-mail --no-verify-jwt

# Apply cron migration AFTER functions are deployed
supabase db push   # picks up 0004_cron.sql
```

## 2. Mail bridge (local)

See `mail-bridge/README.md`. Summary:

```bash
cd /home/vijay/plynth/mail-bridge
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env   # set PLYNTH_BRIDGE_TOKEN

sudo cp systemd/plynth-mail-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now plynth-mail-bridge

# Cloudflare Tunnel (no domain required)
cloudflared tunnel --url http://127.0.0.1:5556
# Copy the printed URL → supabase secrets set MAIL_BRIDGE_URL=...
```

## 3. Frontend (Netlify)

```bash
cd /home/vijay/plynth
git remote add origin git@github.com:<you>/plynth.git
git push -u origin main

# In Netlify UI:
#  - New site from Git → pick repo
#  - Build settings come from netlify.toml automatically.
#  - Env vars:
#       VITE_SUPABASE_URL = https://<ref>.supabase.co
#       VITE_SUPABASE_ANON_KEY = <anon key>
#  - Deploy.
```

## 4. Verify

- Open the Netlify URL → sign up with allow-listed email → onboarding → dashboard.
- Add a loan, a task, a learning topic.
- Hit the AI button on a topic → today's plan generates.
- Drag an application card across Kanban.
- Configure a reminder with `time_of_day` 5 minutes from now → email + ntfy push.
- Check `email_log` table for `channel_used`.
- Confirm `/home/vijay/ngrok-remote-manager/state/email_queue.jsonl` did NOT grow.
