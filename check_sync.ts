import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || "https://ykckqcykxfhpfqptckxk.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
);

async function check() {
  const { data: users, error: err1 } = await supabaseAdmin.auth.admin.listUsers();
  console.log("Users in auth.users:", users?.map(u => ({ id: u.id, email: u.email, meta: u.user_metadata })));
  
  const { data: accounts, error: err2 } = await supabaseAdmin.from('accounts').select('*');
  console.log("Accounts in public.accounts:", accounts);
}
check();
