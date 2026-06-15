import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const supabaseUrl = "https://ykckqcykxfhpfqptckxk.supabase.co";
const supabaseKey = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_current_profile');
  console.log("Profile RPC exists:", data ? 'yes' : 'no');
  
  // try to fetch from pg_proc via RPC if possible? Usually not possible from client.
  // We can select from information_schema if we had connection string, but we only have Anon Key.
}
run();
