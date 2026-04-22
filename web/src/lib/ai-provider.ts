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

export interface AIProvider {
  generateLearningPlan(topicId: string, date?: string): Promise<LearningPlanItem[]>;
  generateDailyPlan(date?: string): Promise<DailyPlanResult>;
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
  // Friendlier message for the most common Gemini failure mode.
  if (/\b429\b|exceeded your current quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    msg = 'Gemini quota exceeded — please wait a minute and try again, or check your Google AI Studio quota.';
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
}

export const ai: AIProvider = new EdgeFunctionProvider();
