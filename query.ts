import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase.from('accounts').select('id, tenant_id, role_id, username, display_name, status, created_at, user_id').limit(1);
  console.log('Accounts sample:', data, error);
  const { data: tData, error: tErr } = await supabase.from('tenants').select('*').limit(1);
  console.log('Tenants sample:', tData, tErr);
}
main();
