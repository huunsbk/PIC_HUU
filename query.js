import { createClient } from '@supabase/supabase-js';
const supabase = createClient("https://ykckqcykxfhpfqptckxk.supabase.co", "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT");

async function run() {
  const { data, error } = await supabase.rpc('get_current_profile');
  console.log(data);
}
run();
