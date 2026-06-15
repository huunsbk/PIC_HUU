import { supabase } from "../../supabaseClient";

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentTenant() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("accounts")
    .select("tenant_id")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;
  return data.tenant_id;
}

export async function getCurrentRole() {
  const user = await getCurrentUser();
  if (!user) return "VIEWER";

  const { data, error } = await supabase
    .from("accounts")
    .select("roles(name)")
    .eq("user_id", user.id)
    .single();

  if (error || !data || !data.roles) return "VIEWER";
  
  // Depending on whether it returns an array or object
  const roleName = Array.isArray(data.roles) ? data.roles[0].name : (data.roles as any).name;
  return roleName || "VIEWER";
}
