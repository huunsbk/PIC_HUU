import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://ykckqcykxfhpfqptckxk.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testLeak() {
    console.log("Starting Data Leak Verification...");
    
    // Login as Tenant A
    const { data: authA, error: errA } = await supabase.auth.signInWithPassword({
        email: "admin_a@pic.com",
        password: "password123" // Replace with actual password
    });
    
    if (errA || !authA.user) {
        console.error("Could not login as Tenant A. Skip or setup first.", errA);
        return;
    }
    
    console.log("Logged in as Tenant A:", authA.user.id);
    
    // Query events (Ensure they only see events from Tenant A)
    const { data: events } = await supabase.from("events").select("tenant_id");
    const leaks = events?.filter(e => e.tenant_id !== "tenant_a");
    
    if (leaks && leaks.length > 0) {
        console.error(`LEAK DETECTED! Found ${leaks.length} events belonging to other tenants.`);
    } else {
        console.log("SUCCESS: Tenant A isolated correctly. No data leaks.");
    }
}

testLeak().catch(console.error);
