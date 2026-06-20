import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';

export const allowedTargetRoles = new Set(['TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'VIEWER']);

const allowedOrigins = [
  'https://huunsbk.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
];

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin =
    allowedOrigins.includes(origin) || origin.endsWith('.vercel.app') ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export function apiError(message: string, status = 400) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

export function getRoleName(rolesObj: unknown) {
  const value = rolesObj as { name?: string } | Array<{ name?: string }> | null;
  return Array.isArray(value) ? value[0]?.name || null : value?.name || null;
}

export function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw apiError('Edge Function chưa cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.', 500);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function getActorAccount(req: Request, admin: ReturnType<typeof createAdminClient>) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw apiError('Thiếu phiên đăng nhập quản trị.', 401);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);
  }

  const { data: actor, error: actorError } = await admin
    .from('accounts')
    .select('id, tenant_id, status, roles(name)')
    .eq('user_id', userData.user.id)
    .single();

  if (actorError || !actor) {
    throw apiError('Không tìm thấy tài khoản quản trị đang đăng nhập.', 403);
  }

  const actorRole = getRoleName(actor.roles);
  if (!['SUPER_ADMIN', 'TENANT_ADMIN'].includes(actorRole || '')) {
    throw apiError('Thiếu quyền quản lý tài khoản.', 403);
  }

  if (actor.status && actor.status !== 'active') {
    throw apiError('Tài khoản quản trị đang bị khóa.', 403);
  }

  return { ...actor, roleName: actorRole, authUserId: userData.user.id };
}

export async function validateTargetAccount(
  admin: ReturnType<typeof createAdminClient>,
  actor: { roleName: string | null; tenant_id: string | null },
  role: string,
  tenantId: string,
) {
  if (!allowedTargetRoles.has(role)) {
    throw apiError('Role không hợp lệ. Chỉ hỗ trợ TENANT_ADMIN, EVENT_ADMIN, REFEREE, VIEWER.', 400);
  }

  if (!tenantId || tenantId === 'default') {
    throw apiError('Thiếu tenant hợp lệ cho tài khoản.', 400);
  }

  if (actor.roleName === 'TENANT_ADMIN') {
    if (role === 'TENANT_ADMIN') {
      throw apiError('TENANT_ADMIN không được tạo hoặc cấp thêm TENANT_ADMIN.', 403);
    }
    if (tenantId !== actor.tenant_id) {
      throw apiError('TENANT_ADMIN chỉ được quản lý tài khoản trong tenant của mình.', 403);
    }
  }

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    throw apiError('Tenant được chọn không tồn tại.', 400);
  }

  const { data: roleRecord, error: roleError } = await admin
    .from('roles')
    .select('id, name')
    .eq('name', role)
    .maybeSingle();

  if (roleError || !roleRecord) {
    throw apiError(`Role ${role} chưa tồn tại trong hệ thống. Không tự tạo role mới.`, 500);
  }

  return { tenant, roleRecord };
}

export function handleOptions(req: Request) {
  return new Response('ok', { headers: corsHeaders(req) });
}

export function handleError(req: Request, error: unknown) {
  const err = error as Error & { status?: number };
  return json(req, { error: err.message || 'Có lỗi máy chủ.' }, err.status || 500);
}
