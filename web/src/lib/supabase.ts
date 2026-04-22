import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn('[plynth] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example → .env');
}

// Loosely typed client for MVP. To generate full types later:
//   supabase gen types typescript --project-id <id> > src/lib/database.types.ts
// then re-add the <Database> generic here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any, 'public', any> = createClient<any, 'public', any>(
  url ?? '',
  anon ?? '',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
