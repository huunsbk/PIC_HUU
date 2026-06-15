import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  const tables = ['tenants', 'accounts', 'roles', 'permissions', 'account_permissions', 'account_event_permissions', 'active_sessions', 'login_logs', 'audit_logs', 'events', 'groups', 'teams', 'matches'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    console.log(t, Object.keys(data?.[0] || {}), error?.message || 'ok');
  }
}
test();
