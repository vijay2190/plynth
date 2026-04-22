// Minimal hand-written types covering the tables we use.
// Generate full types later with: supabase gen types typescript --project-id <id>

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; user_id: string; full_name: string | null; email: string; timezone: string; theme_preference: string; created_at: string };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { user_id: string; email: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
      };
      learning_topics: {
        Row: { id: string; user_id: string; topic_name: string; level: 'beginner' | 'intermediate' | 'advanced'; priority: number; status: 'active' | 'paused' | 'completed'; target_completion_date: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['learning_topics']['Row'], 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['learning_topics']['Row']>;
      };
      learning_plans: {
        Row: { id: string; user_id: string; topic_id: string; date: string; title: string; description: string | null; resource_links: Json; estimated_minutes: number; order_in_day: number; status: 'pending' | 'completed' | 'skipped' | 'deferred'; completed_at: string | null; ai_generated: boolean };
        Insert: Omit<Database['public']['Tables']['learning_plans']['Row'], 'id'> & { id?: string };
        Update: Partial<Database['public']['Tables']['learning_plans']['Row']>;
      };
      learning_streaks: {
        Row: { id: string; user_id: string; current_streak: number; longest_streak: number; last_active_date: string | null };
        Insert: Partial<Database['public']['Tables']['learning_streaks']['Row']> & { user_id: string };
        Update: Partial<Database['public']['Tables']['learning_streaks']['Row']>;
      };
      job_settings: {
        Row: { id: string; user_id: string; keywords: string[]; preferred_roles: string[]; locations: string[]; experience_min: number | null; experience_max: number | null; salary_min: number | null; remote_preference: 'remote' | 'hybrid' | 'onsite' | 'any'; auto_refresh: boolean };
        Insert: Partial<Database['public']['Tables']['job_settings']['Row']> & { user_id: string };
        Update: Partial<Database['public']['Tables']['job_settings']['Row']>;
      };
      job_listings: {
        Row: { id: string; user_id: string; external_id: string; title: string; company: string; location: string | null; salary_range: string | null; job_url: string; source: string; description_snippet: string | null; posted_date: string | null; fetched_at: string; is_new: boolean };
        Insert: Omit<Database['public']['Tables']['job_listings']['Row'], 'id' | 'fetched_at'> & { id?: string; fetched_at?: string };
        Update: Partial<Database['public']['Tables']['job_listings']['Row']>;
      };
      job_applications: {
        Row: { id: string; user_id: string; company: string; role: string; job_url: string | null; resume_used: string | null; applied_date: string; status: 'applied' | 'screening' | 'interview' | 'offer' | 'rejected' | 'ghosted'; notes: string | null; follow_up_date: string | null; salary_offered: number | null; updated_at: string };
        Insert: Partial<Database['public']['Tables']['job_applications']['Row']> & { user_id: string; company: string; role: string };
        Update: Partial<Database['public']['Tables']['job_applications']['Row']>;
      };
      resumes: {
        Row: { id: string; user_id: string; name: string; file_url: string; version: number; is_default: boolean; created_at: string };
        Insert: Partial<Database['public']['Tables']['resumes']['Row']> & { user_id: string; name: string; file_url: string };
        Update: Partial<Database['public']['Tables']['resumes']['Row']>;
      };
      task_categories: {
        Row: { id: string; user_id: string; name: string; color: string; icon: string };
        Insert: Partial<Database['public']['Tables']['task_categories']['Row']> & { user_id: string; name: string };
        Update: Partial<Database['public']['Tables']['task_categories']['Row']>;
      };
      tasks: {
        Row: { id: string; user_id: string; category_id: string | null; title: string; description: string | null; due_date: string | null; due_time: string | null; priority: 'low' | 'medium' | 'high' | 'urgent'; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; is_recurring: boolean; recurrence_rule: string | null; reminder_at: string | null; reminder_sent: boolean; created_at: string; completed_at: string | null };
        Insert: Partial<Database['public']['Tables']['tasks']['Row']> & { user_id: string; title: string };
        Update: Partial<Database['public']['Tables']['tasks']['Row']>;
      };
      loans: {
        Row: { id: string; user_id: string; name: string; lender: string | null; loan_type: string; principal_amount: number; interest_rate: number; emi_amount: number; tenure_months: number; start_date: string; emi_due_day: number; status: 'active' | 'closed' };
        Insert: Partial<Database['public']['Tables']['loans']['Row']> & { user_id: string; name: string; principal_amount: number; interest_rate: number; emi_amount: number; tenure_months: number; start_date: string; emi_due_day: number; loan_type: string };
        Update: Partial<Database['public']['Tables']['loans']['Row']>;
      };
      emi_payments: {
        Row: { id: string; loan_id: string; user_id: string; month_year: string; due_date: string; amount_paid: number | null; paid_date: string | null; status: 'pending' | 'paid' | 'overdue' | 'skipped'; notes: string | null };
        Insert: Partial<Database['public']['Tables']['emi_payments']['Row']> & { loan_id: string; user_id: string; month_year: string; due_date: string };
        Update: Partial<Database['public']['Tables']['emi_payments']['Row']>;
      };
      reminder_settings: {
        Row: { id: string; user_id: string; category: string; channel: 'email' | 'ntfy' | 'both'; time_of_day: string; days_of_week: number[]; enabled: boolean };
        Insert: Partial<Database['public']['Tables']['reminder_settings']['Row']> & { user_id: string; category: string };
        Update: Partial<Database['public']['Tables']['reminder_settings']['Row']>;
      };
      email_log: {
        Row: { id: string; user_id: string | null; subject: string; channel_used: string; status: string; error: string | null; sent_at: string };
        Insert: Partial<Database['public']['Tables']['email_log']['Row']> & { subject: string; channel_used: string; status: string };
        Update: Partial<Database['public']['Tables']['email_log']['Row']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
