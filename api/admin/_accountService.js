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
    .select('id, tenant_id, status, roles(name), tenants(tenant_type, status)')
    .eq('user_id', userData.user.id)
    .single();

  if (actorError || !actor) {
    throw apiError('Không tìm thấy tài khoản quản trị đang đăng nhập.', 403);
  }

  const roleName = getRoleName(actor.roles);
  if (!['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'].includes(roleName || '')) {
    throw apiError('Thiếu quyền quản lý tài khoản.', 403);
  }

  if (actor.status && actor.status !== 'active') {
    throw apiError('Tài khoản quản trị đang bị khóa.', 403);
  }

  const tenant = Array.isArray(actor.tenants) ? actor.tenants[0] : actor.tenants;
  if (tenant?.status && tenant.status !== 'active') {
    throw apiError('Đơn vị đang bị khóa.', 403);
  }
  if (tenant?.tenant_type === 'self_service_customer') {
    const now = new Date().toISOString();
    const { data: subscription, error: subscriptionError } = await admin
      .from('tenant_subscriptions')
      .select('id')
      .eq('tenant_id', actor.tenant_id)
      .in('status', ['active', 'trial'])
      .lte('start_date', now)
      .or(`end_date.is.null,end_date.gt.${now}`)
      .limit(1)
      .maybeSingle();
    if (subscriptionError || !subscription) {
      throw apiError('Gói vận hành đã hết hạn hoặc chưa được mở khóa.', 403);
    }
  }

  return { ...actor, roleName, authUserId: userData.user.id };
}

export async function actorCanManageReferees(admin, actor) {
  if (['SUPER_ADMIN', 'TENANT_ADMIN'].includes(actor.roleName || '')) return true;
  if (actor.roleName !== 'EVENT_ADMIN') return false;

  const { count } = await admin
    .from('account_event_permissions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', actor.id)
    .eq('tenant_id', actor.tenant_id)
    .eq('permission', 'manage_referees')
    .is('deleted_at', null);

  return (count || 0) > 0;
}

export async function ensureEventAdminCanManageTargetAccount(admin, actor, accountId) {
  if (actor.roleName !== 'EVENT_ADMIN') return;

  const { data: target, error } = await admin
    .from('accounts')
    .select('id, tenant_id, created_by_account_id, roles(name)')
    .eq('id', accountId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !target) {
    throw apiError('Không tìm thấy tài khoản cần quản lý.', 404);
  }

  const targetRole = getRoleName(target.roles);
  if (targetRole !== 'REFEREE') {
    throw apiError('EVENT_ADMIN chỉ được quản lý tài khoản REFEREE trong phạm vi được cấp.', 403);
  }

  if (target.tenant_id !== actor.tenant_id) {
    throw apiError('EVENT_ADMIN chỉ được quản lý trọng tài trong tenant của mình.', 403);
  }

  if (target.created_by_account_id === actor.id) return;

  const { data: overlap } = await admin
    .from('account_event_permissions')
    .select('event_id')
    .eq('account_id', accountId)
    .eq('tenant_id', actor.tenant_id)
    .is('deleted_at', null);

  const eventIds = (overlap || []).map((row) => row.event_id).filter(Boolean);
  if (eventIds.length === 0) {
    throw apiError('REFEREE này chưa nằm trong phạm vi nội dung bạn quản lý.', 403);
  }

  const { count: manageableCount } = await admin
    .from('account_event_permissions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', actor.id)
    .eq('tenant_id', actor.tenant_id)
    .eq('permission', 'manage_referees')
    .in('event_id', eventIds)
    .is('deleted_at', null);

  if ((manageableCount || 0) === 0) {
    throw apiError('EVENT_ADMIN không có quyền quản lý trọng tài này.', 403);
  }
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

  if (actor.roleName === 'EVENT_ADMIN') {
    if (role !== 'REFEREE') {
      throw apiError('EVENT_ADMIN chỉ được tạo hoặc cập nhật tài khoản REFEREE.', 403);
    }
    if (tenantId !== actor.tenant_id) {
      throw apiError('EVENT_ADMIN chỉ được quản lý REFEREE trong tenant của mình.', 403);
    }
    const canManageReferees = await actorCanManageReferees(admin, actor);
    if (!canManageReferees) {
      throw apiError('EVENT_ADMIN chưa được cấp quyền quản lý trọng tài.', 403);
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
    .lte('start_date', new Date().toISOString())
    .or(`end_date.is.null,end_date.gt.${new Date().toISOString()}`)
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

const sensitiveAuditKeys = new Set([
  'password',
  'newpassword',
  'new_password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'service_role_key',
  'supabase_service_role_key',
  'authorization',
]);

function sanitizeAuditDetails(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveAuditKeys.has(key.toLowerCase()))
      .map(([key, nestedValue]) => [key, sanitizeAuditDetails(nestedValue)]),
  );
}

function getAuditCategory(action) {
  if (/(^|[._])(login|logout|session|permission|grant|revoke|access)/i.test(action)) return 'security';
  if (/(^|[._])account/i.test(action)) return 'identity';
  if (/(score|match|standing|bracket|knockout)/i.test(action)) return 'competition';
  if (/(tenant|tournament|event|team|group|schedule)/i.test(action)) return 'operations';
  return 'business';
}

export async function audit(admin, tenantId, action, details, context = {}) {
  let structuredDetails = details;
  if (typeof details === 'string') {
    try {
      structuredDetails = JSON.parse(details);
    } catch {
      structuredDetails = { message: details };
    }
  }
  structuredDetails = sanitizeAuditDetails(structuredDetails || {});

  const { error } = await admin.from('audit_logs').insert({
    tenant_id: tenantId || null,
    action,
    details: typeof details === 'string' ? details : JSON.stringify(structuredDetails),
    timestamp: new Date().toISOString(),
    actor_account_id: context.actor?.id || null,
    actor_role: context.actor?.roleName || null,
    category: context.category || getAuditCategory(action),
    entity_type: context.entityType || null,
    entity_id: context.entityId || null,
    result: context.result || 'allow',
    reason: context.reason || null,
    details_json: structuredDetails,
  });

  if (error) {
    console.error(`[Audit] Could not record ${action}: ${error.code || 'UNKNOWN'}`);
    return false;
  }
  return true;
}

export async function handleError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  sendJson(res, status, { error: error?.message || 'Có lỗi máy chủ.' });
}
