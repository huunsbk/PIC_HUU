async function test() {
  const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
  
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'OPTIONS', headers: { 'apikey': SUPABASE_ANON_KEY } });
    console.log(res.status, res.headers);
    const text = await res.text();
    console.log(text.substring(0, 500));
  } catch (err) {
    console.error(err);
  }
}
test();
