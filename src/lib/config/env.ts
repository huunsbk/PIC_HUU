export function validateEnv() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !anonKey) {
    throw new Error("CRITICAL: Missing required Supabase environment variables for production execution.");
  }
}

// Call during boot sequence
validateEnv();
