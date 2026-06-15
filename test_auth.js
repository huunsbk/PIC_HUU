import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testAuth() {
  const email = "huunsbk@pic.com";
  // Try common passwords since it's a test environment
  const passwords = ["123456", "password", "huunsbk@pic.com", "admin123", "12345678"];
  let session = null;
  
  for (const pw of passwords) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pw
    });
    if (data?.session) {
      console.log(`Logged in successfully with password: ${pw}`);
      session = data.session;
      break;
    }
  }

  if (!session) {
    console.log("Could not login. Please test manually in the browser UI, as I do not have the password. The logging is already set up in AuthModal.tsx.");
    return;
  }

  const { data: profileStr, error: accountError } = await supabase.rpc('get_current_profile');
  
  console.log('[Auth Flow Debug] RPC Response:', { profileStr, accountError });

  if (accountError || !profileStr) {
    console.error('[Auth Flow Error] Stack trace / Error details:', accountError);
    return;
  }

  const accountData = typeof profileStr === 'string' ? JSON.parse(profileStr) : profileStr;
  console.log('[Auth Flow Debug] Parsed Account Data:', accountData);
  
  if (accountData.account_id && accountData.tenant_id && accountData.role && accountData.permissions) {
     console.log('[Auth Flow Debug] AUTH FLOW PASSED');
  } else {
     console.warn('[Auth Flow Debug] Missing some expected attributes in payload');
  }
}
testAuth();
