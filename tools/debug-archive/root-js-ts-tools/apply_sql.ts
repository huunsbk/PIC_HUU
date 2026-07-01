import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function run() {
  const sql = fs.readFileSync('fix_rls_login.sql', 'utf8');
  const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });
  if (error) {
     const { data: d2, error: e2 } = await supabase.rpc('execute_sql', { sql: sql });
     console.log("execute_sql:", d2, e2);
  } else {
     console.log("run_sql:", data, error);
  }
}
run();
