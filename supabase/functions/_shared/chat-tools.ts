// _shared/chat-tools.ts — Server-side tools the AI chat can call.
// Every tool is automatically scoped to the caller's user_id.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Tool = {
  name: string;
  description: string;
  args_schema: string;
  run: (sb: SupabaseClient, userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

function ymString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const TOOLS: Tool[] = [
  {
    name: 'get_profile',
    description: "User profile basics: name, timezone, theme.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const { data } = await sb.from('profiles')
        .select('full_name, timezone, theme_preference')
        .eq('user_id', userId).maybeSingle();
      return data ?? {};
    },
  },

  {
    name: 'get_finance_summary',
    description: "Finance snapshot for a month: total budget, planned spend, balance, EMIs, recurring, one-off expenses. Use today's month if not specified.",
    args_schema: '{"year_month?":"YYYY-MM"}',
    run: async (sb, userId, args) => {
      const ym = (args.year_month as string) || ymString(new Date());
      const [budget, monthly, recurring, loans] = await Promise.all([
        sb.from('budget_months').select('total_budget,notes').eq('user_id', userId).eq('year_month', ym).maybeSingle(),
        sb.from('monthly_expenses').select('name,amount,category,paid,recurring_id').eq('user_id', userId).eq('year_month', ym).limit(100),
        sb.from('recurring_expenses').select('name,amount,category,active').eq('user_id', userId).limit(50),
        sb.from('loans').select('name,emi_amount,emi_due_day,status').eq('user_id', userId).eq('status', 'active').limit(50),
      ]);
      const recurringTotal = (recurring.data ?? []).filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0);
      const oneOffTotal = (monthly.data ?? []).filter((e) => !e.recurring_id).reduce((s, e) => s + Number(e.amount), 0);
      const emiTotal = (loans.data ?? []).reduce((s, l) => s + Number(l.emi_amount), 0);
      const total = Number(budget.data?.total_budget ?? 0);
      const planned = recurringTotal + oneOffTotal + emiTotal;
      return {
        year_month: ym,
        total_budget: total,
        planned,
        balance: total - planned,
        breakdown: { emis: emiTotal, recurring: recurringTotal, one_off: oneOffTotal },
        emis: loans.data ?? [],
        recurring: recurring.data ?? [],
        monthly_expenses: monthly.data ?? [],
        notes: budget.data?.notes ?? null,
      };
    },
  },

  {
    name: 'list_loans',
    description: "All loans with EMI, principal, interest, tenure, due day, status.",
    args_schema: '{"status?":"active|closed"}',
    run: async (sb, userId, args) => {
      let q = sb.from('loans').select('id,name,lender,loan_type,principal_amount,interest_rate,emi_amount,tenure_months,start_date,emi_due_day,status').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      const { data } = await q.limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_learning_topics',
    description: "Topics the user is learning. Filter by status or partial name (case-insensitive).",
    args_schema: '{"status?":"active|paused|completed", "name_contains?":"string"}',
    run: async (sb, userId, args) => {
      let q = sb.from('learning_topics').select('id,topic_name,level,priority,status,target_completion_date,created_at').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      if (args.name_contains) q = q.ilike('topic_name', `%${String(args.name_contains)}%`);
      const { data } = await q.order('priority', { ascending: false }).limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_learning_plan_items',
    description: "Daily learning plan items for a date or date-range. Defaults to today and next 7 days. Use range='overdue' for past pending items.",
    args_schema: '{"date?":"YYYY-MM-DD", "range?":"today|upcoming|overdue|week"}',
    run: async (sb, userId, args) => {
      const today = todayISO();
      let from = today, to = shiftDays(today, 7);
      const range = (args.range as string) || (args.date ? '' : 'upcoming');
      if (args.date) { from = String(args.date); to = String(args.date); }
      else if (range === 'today') { from = today; to = today; }
      else if (range === 'overdue') { from = '2000-01-01'; to = shiftDays(today, -1); }
      else if (range === 'week') { from = today; to = shiftDays(today, 6); }
      let q = sb.from('learning_plans')
        .select('id,date,title,description,estimated_minutes,status,topic_id,learning_topics(topic_name)')
        .eq('user_id', userId)
        .gte('date', from).lte('date', to);
      if (range === 'overdue') q = q.in('status', ['pending', 'in_progress']);
      const { data } = await q.order('date').limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_tasks',
    description: "User's todos. Filter by status (pending|in_progress|completed) or due_window (today|overdue|week).",
    args_schema: '{"status?":"pending|in_progress|completed", "due_window?":"today|overdue|week"}',
    run: async (sb, userId, args) => {
      const today = todayISO();
      let q = sb.from('tasks').select('id,title,description,priority,status,due_date,category_id').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      if (args.due_window === 'today') q = q.eq('due_date', today);
      else if (args.due_window === 'overdue') q = q.lt('due_date', today).neq('status', 'completed');
      else if (args.due_window === 'week') q = q.gte('due_date', today).lte('due_date', shiftDays(today, 6));
      const { data } = await q.order('due_date', { ascending: true, nullsFirst: false }).limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_jobs',
    description: "Job applications and recent listings. status filters applications; recent_days=N filters listings by fetched date.",
    args_schema: '{"status?":"applied|screening|interview|offer|rejected|ghosted", "recent_days?":7}',
    run: async (sb, userId, args) => {
      const apps = await (async () => {
        let q = sb.from('job_applications').select('id,company,role,status,applied_date,job_url,follow_up_date').eq('user_id', userId);
        if (args.status) q = q.eq('status', String(args.status));
        const { data } = await q.order('applied_date', { ascending: false }).limit(50);
        return data ?? [];
      })();
      const days = Number(args.recent_days ?? 0);
      const listings = await (async () => {
        let q = sb.from('job_listings').select('id,title,company,location,job_url,fetched_at,is_new').eq('user_id', userId);
        if (days > 0) q = q.gte('fetched_at', new Date(Date.now() - days * 86400000).toISOString());
        const { data } = await q.order('fetched_at', { ascending: false }).limit(20);
        return data ?? [];
      })();
      return { applications: apps, recent_listings: listings };
    },
  },
];

export function toolsCatalogText(): string {
  return TOOLS.map((t) => `- ${t.name}(${t.args_schema}) — ${t.description}`).join('\n');
}

export async function runTool(sb: SupabaseClient, userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return await tool.run(sb, userId, args ?? {});
}
