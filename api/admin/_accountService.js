import { createClient } from '@supabase/supabase-js';

const allowedTargetRoles = new Set(['TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'VIEWER']);
const allowedOrigins = new Set([
  'https://giai-dau-pickleball.vercel.app',
  'https://huunsbk.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
]);

export function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin =
    allowedOrigins.has(origin) || origin.endsWith('.vercel.app') ? origin : 'https://giai-dau-pickleball.vercel.app';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-client-info, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

export function handleOptions(req, res) {
  setCorsHeaders(req, res);
  return res.status(204).end();
}

export function sendJson(res, status, body) {
  res.status(status).json(body);
}

export function apiError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function getAdminClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw apiError('Server chưa cấu hình VITE_SUPABASE_URL/SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.', 500);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw apiError('Thiếu phiên đăng nhập quản trị.', 401);
  return token;
}

export function getRoleName(rolesObj) {
  if (Array.isArray(rolesObj)) return rolesObj[0]?.name || null;
  return rolesObj?.name || null;
}

export async function getActorAccount(req, admin) {
  const token = getBearerToken(req);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
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

  const roleName = getRoleName(actor.roles);
  if (!['SUPER_ADMIN', 'TENANT_ADMIN'].includes(roleName || '')) {
    throw apiError('Thiếu quyền quản lý tài khoản.', 403);
  }

  if (actor.status && actor.status !== 'active') {
    throw apiError('Tài khoản quản trị đang bị khóa.', 403);
  }

  return { ...actor, roleName, authUserId: userData.user.id };
}

export async function validateTargetAccount(admin, actor, role, tenantId, options = {}) {
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
    .select('id, name, status')
    .eq('id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError || !tenant) {
    throw apiError('Tenant được chọn không tồn tại hoặc đã bị lưu trữ.', 400);
  }

  if (tenant.status && tenant.status !== 'active') {
    throw apiError('Tenant đích không ở trạng thái active.', 400);
  }

  const { data: roleRecord, error: roleError } = await admin
    .from('roles')
    .select('id, name')
    .eq('name', role)
    .maybeSingle();

  if (roleError || !roleRecord) {
    throw apiError(`Role ${role} chưa tồn tại trong hệ thống. Không tự tạo role mới.`, 500);
  }

  const { data: subscription, error: subscriptionError } = await admin
    .from('tenant_subscriptions')
    .select('id, status, subscription_plans(max_users, max_events, max_teams)')
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'trial'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError || !subscription) {
    throw apiError('Tenant đích chưa có subscription active/trial.', 400);
  }

  const { data: usage } = await admin
    .from('tenant_usage')
    .select('users_used, users_limit')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  let usersUsed = Number(usage?.users_used ?? 0);
  if (options.excludeAccountId) {
    const { data: existingAccount } = await admin
      .from('accounts')
      .select('id, tenant_id')
      .eq('id', options.excludeAccountId)
      .maybeSingle();

    if (existingAccount?.tenant_id === tenantId) {
      usersUsed = Math.max(0, usersUsed - 1);
    }
  }

  const usersLimit = Number(usage?.users_limit ?? subscription.subscription_plans?.max_users ?? 1);
  if (usersUsed >= usersLimit) {
    throw apiError(`Tenant đã vượt giới hạn tài khoản (${usersUsed}/${usersLimit}).`, 403);
  }

  return { tenant, roleRecord, subscription };
}

export async function audit(admin, tenantId, action, details) {
  await admin.from('audit_logs').insert({
    tenant_id: tenantId || null,
    action,
    details,
    timestamp: new Date().toISOString(),
  });
}

export async function handleError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  sendJson(res, status, { error: error?.message || 'Có lỗi máy chủ.' });
}
