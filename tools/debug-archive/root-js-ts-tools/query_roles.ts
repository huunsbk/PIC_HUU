import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ykckqcykxfhpfqptckxk.supabase.co";
const supabaseKey = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: roles, error } = await supabase.from('roles').select('*');
  console.log("Roles:", roles, error);
}
run();
