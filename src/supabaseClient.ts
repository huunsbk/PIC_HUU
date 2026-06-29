import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'pic-huu-supabase-auth',
  },
});

export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('tournament').select('id').limit(1);
    if (error) {
      console.warn('Supabase service query response code/message:', error.code, error.message);
      // If we receive a message that implies a database table relation or setup error, we still successfully reached Supabase!
      // This includes relation doesn't exist (42P01), unauthorized, or similar Postgres codes.
      if (error.code === '42P01' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
        return true;
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Supabase connection error:', err);
    return false;
  }
}
