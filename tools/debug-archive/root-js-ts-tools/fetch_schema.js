import fs from 'fs';

async function fetchSchema() {
  const SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";
  
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_ANON_KEY}`);
    const json = await res.json();
    fs.writeFileSync('schema_openapi.json', JSON.stringify(json, null, 2));
    console.log("Schema downloaded.");
  } catch (err) {
    console.error(err);
  }
}
fetchSchema();
