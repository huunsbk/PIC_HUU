import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ykckqcykxfhpfqptckxk.supabase.co";
const supabaseKey = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_current_profile');
  console.log("Profile RPC:", data, error);
}
run();
