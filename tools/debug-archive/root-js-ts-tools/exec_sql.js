import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sql = fs.readFileSync('rpc_record_login.sql', 'utf8');

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql });
  if (error) {
    const { data: d2, error: e2 } = await supabase.rpc('run_sql', { sql_query: sql });
    console.log("run_sql response:", e2 || d2);
  } else {
    console.log("execute_sql response:", data);
  }
}
run();
