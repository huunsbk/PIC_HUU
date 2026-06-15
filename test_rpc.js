import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase.rpc('get_schema');
  console.log('get_schema:', data, error);
  
  const { data: d2, error: e2 } = await supabase.rpc('dump_schema');
  console.log('dump_schema:', d2, e2);

  const { data: d3, error: e3 } = await supabase.rpc('get_policies');
  console.log('get_policies:', d3, e3);
}

test();
