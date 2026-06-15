import { supabase } from "../../supabaseClient";
import { getCurrentTenant } from "../auth/tenant";

export async function secureTenantQuery(table: string) {
  const tenantId = await getCurrentTenant();
  return supabase.from(table).select("*").eq("tenant_id", tenantId);
}

export async function secureTenantDelete(table: string) {
  const tenantId = await getCurrentTenant();
  return supabase.from(table).delete().eq("tenant_id", tenantId);
}

export async function secureTenantInsert(table: string, payload: any) {
  const tenantId = await getCurrentTenant();
  if (Array.isArray(payload)) {
    const data = payload.map(item => ({ ...item, tenant_id: tenantId }));
    return supabase.from(table).insert(data);
  } else {
    payload.tenant_id = tenantId;
    return supabase.from(table).insert(payload);
  }
}

export async function secureTenantUpsert(table: string, payload: any, options?: any) {
  const tenantId = await getCurrentTenant();
  if (Array.isArray(payload)) {
    const data = payload.map(item => ({ ...item, tenant_id: tenantId }));
    return supabase.from(table).upsert(data, options);
  } else {
    payload.tenant_id = tenantId;
    return supabase.from(table).upsert(payload, options);
  }
}

export async function updateMyProfile(displayName: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not logged in");
  
  return supabase.from("accounts").update({ display_name: displayName }).eq("user_id", user.id);
}

