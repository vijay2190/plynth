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

export interface AIProvider {
  generateLearningPlan(topicId: string): Promise<LearningPlanItem[]>;
}

class EdgeFunctionProvider implements AIProvider {
  async generateLearningPlan(topicId: string): Promise<LearningPlanItem[]> {
    const { data, error } = await supabase.functions.invoke('ai-learning-plan', {
      body: { topic_id: topicId },
    });
    if (error) throw error;
    return (data?.items ?? []) as LearningPlanItem[];
  }
}

export const ai: AIProvider = new EdgeFunctionProvider();
