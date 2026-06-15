import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDb() {
  // It is hard to run arbitrary raw SQL directly with anon key without a function.
  // Instead, let's fetch accounts and check duplicates in JS.
  const { data, error } = await supabase.from('accounts').select('user_id');
  if (error) {
    console.error("Error fetching accounts:", error);
    return;
  }
  
  const counts = {};
  const duplicates = [];
  data.forEach(row => {
    if (row.user_id) {
       counts[row.user_id] = (counts[row.user_id] || 0) + 1;
       if (counts[row.user_id] === 2) {
         duplicates.push(row.user_id);
       }
    }
  });

  console.log(`Verification: SELECT user_id, COUNT(*) ... -> Duplicates found: ${duplicates.length}`);
  if (duplicates.length > 0) {
     console.log("Duplicate User IDs:", duplicates);
  }
}
checkDb();
