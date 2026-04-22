// Pluggable AI provider — swap Gemini → OpenAI by changing only this file.
// Server-side calls happen in Edge Functions; this module is the *client-side*
// invocation contract: it calls the supabase function which holds the API key.

import { supabase } from './supabase';

export interface LearningPlanItem {
  title: string;
  description: string;
  estimated_minutes: number;
  resource_links: { label: string; url: string }[];
}

export interface DailyAllocation {
  topic_id: string;
  topic_name: string;
  items: number;
  minutes: number;
}

export interface DailyPlanResult {
  items: (LearningPlanItem & { topic_id: string })[];
  allocations: DailyAllocation[];
}

export interface MultiDayResult {
  days_planned: number;
  total_items: number;
  horizon_days: number;
}

export interface AIProvider {
  generateLearningPlan(topicId: string, date?: string): Promise<LearningPlanItem[]>;
  generateDailyPlan(date?: string): Promise<DailyPlanResult>;
  generateMultiDayPlan(date?: string): Promise<MultiDayResult>;
  generateReplacementItem(topicId: string, date?: string): Promise<unknown>;
}

// Surface the edge function's JSON error body. supabase-js wraps non-2xx
// responses in a generic "Edge Function returned a non-2xx status code"
// message and stashes the original response on `error.context`.
async function unwrapError(error: any, data: any): Promise<never> {
  let msg = error?.message ?? 'Edge function failed';
  try {
    const body = await error?.context?.json?.();
    if (body?.error) msg = body.error;
  } catch { /* ignore */ }
  if (!error && data?.error) msg = data.error;
  // Friendlier message when every provider in the chain rate-limited.
  if (/rate-limited|RateLimitError|RESOURCE_EXHAUSTED/i.test(msg)) {
    msg = 'AI providers are busy right now. Please retry in a moment.';
  }
  throw new Error(msg);
}

class EdgeFunctionProvider implements AIProvider {
  async generateLearningPlan(topicId: string, date?: string): Promise<LearningPlanItem[]> {
    const { data, error } = await supabase.functions.invoke('ai-learning-plan', {
      body: { topic_id: topicId, date },
    });
    if (error || data?.error) await unwrapError(error, data);
    const items = (data?.items ?? []) as LearningPlanItem[];
    if (!items.length) throw new Error('AI returned no items. Please retry.');
    return items;
  }

  async generateDailyPlan(date?: string): Promise<DailyPlanResult> {
    const { data, error } = await supabase.functions.invoke('ai-learning-plan', {
      body: { scope: 'daily', date },
    });
    if (error || data?.error) await unwrapError(error, data);
    const items = (data?.items ?? []) as DailyPlanResult['items'];
    if (!items.length) throw new Error('AI returned no items. Please retry.');
    return { items, allocations: data?.allocations ?? [] };
  }

  async generateMultiDayPlan(date?: string): Promise<MultiDayResult> {
    const { data, error } = await supabase.functions.invoke('ai-learning-plan', {
      body: { scope: 'multi_day', date },
    });
    if (error || data?.error) await unwrapError(error, data);
    return {
      days_planned: data?.days_planned ?? 0,
      total_items: data?.total_items ?? 0,
      horizon_days: data?.horizon_days ?? 0,
    };
  }

  async generateReplacementItem(topicId: string, date?: string): Promise<unknown> {
    const { data, error } = await supabase.functions.invoke('ai-learning-plan', {
      body: { scope: 'replacement', topic_id: topicId, date },
    });
    if (error || data?.error) await unwrapError(error, data);
    return data?.item;
  }
}

export const ai: AIProvider = new EdgeFunctionProvider();
