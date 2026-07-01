import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || "https://ykckqcykxfhpfqptckxk.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);
async function run() {
  const { data, error } = await supabase.from('login_logs').select('*');
  console.log("ok");
}
run();
