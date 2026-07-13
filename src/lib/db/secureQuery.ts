import { supabase } from "../../supabaseClient";
import { getCurrentTenant } from "../auth/tenant";

export async function secureTenantQuery(table: string, selectFields: string = "*") {
  const tenantId = await getCurrentTenant();
  return supabase.from(table).select(selectFields).eq("tenant_id", tenantId);
}

export async function secureTenantDelete(table: string) {
  void table;
  throw new Error('Direct frontend deletes are disabled. Use scoped RPC/API mutations.');
}

export async function secureTenantInsert(table: string, payload: any) {
  void table;
  void payload;
  throw new Error('Direct frontend inserts are disabled. Use scoped RPC/API mutations.');
}

export async function secureTenantUpsert(table: string, payload: any, options?: any) {
  void table;
  void payload;
  void options;
  throw new Error('Direct frontend upserts are disabled. Use scoped RPC/API mutations.');
}

export async function updateMyProfile(displayName: string) {
  void displayName;
  throw new Error('Direct frontend account updates are disabled. Use the account API.');
}

