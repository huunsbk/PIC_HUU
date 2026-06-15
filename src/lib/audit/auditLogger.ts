import { supabase } from "../../supabaseClient";

export async function auditLog(action: string, details: any) {
  try {
     const payload = {
       timestamp: Date.now().toString(),
       action,
       details: JSON.stringify(details)
     };

     // The database handles tenant_id via RLS and Triggers implicitly now!
     await supabase.from('audit_logs').insert([payload]);
  } catch (e) {
     console.error("Audit log dispatch failed:", e);
  }
}
