import {
  apiError,
  audit,
  getActorAccount,
  getAdminClient,
  getRoleName,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../_accountService.js';

function ensureCanRestoreAccount(actor, target, targetRoleName) {
  if (actor.roleName === 'SUPER_ADMIN') return;

  if (actor.roleName === 'TENANT_ADMIN') {
    if (target.tenant_id !== actor.tenant_id) {
      throw apiError('TENANT_ADMIN chỉ được khôi phục tài khoản trong tenant của mình.', 403);
    }
    if (targetRoleName === 'SUPER_ADMIN') {
      throw apiError('TENANT_ADMIN không được khôi phục SUPER_ADMIN.', 403);
    }
    return;
  }

  if (actor.roleName === 'EVENT_ADMIN') {
    if (target.tenant_id !== actor.tenant_id) {
      throw apiError('EVENT_ADMIN chỉ được khôi phục trọng tài trong tenant của mình.', 403);
    }
    if (targetRoleName !== 'REFEREE') {
      throw apiError('EVENT_ADMIN chỉ được khôi phục tài khoản REFEREE.', 403);
    }
    if (target.created_by_account_id !== actor.id) {
      throw apiError('EVENT_ADMIN chỉ được khôi phục trọng tài do mình cấp.', 403);
    }
    return;
  }

  throw apiError('Thiếu quyền khôi phục tài khoản.', 403);
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const actor = await getActorAccount(req, admin);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const accountId = String(body.accountId || '').trim();
    if (!accountId) throw apiError('Thiếu accountId.', 400);

    const { data: target, error: targetError } = await admin
      .from('accounts')
      .select('id, user_id, tenant_id, username, status, deleted_at, created_by_account_id, roles(name)')
      .eq('id', accountId)
      .maybeSingle();

    if (targetError) throw apiError(`Không thể kiểm tra tài khoản: ${targetError.message}`, 500);
    if (!target) throw apiError('Không tìm thấy tài khoản.', 404);
    const isAlreadyRestored = !target.deleted_at && target.status === 'active';
    if (!target.deleted_at && !isAlreadyRestored) {
      throw apiError('Tài khoản chưa bị lưu trữ nên không thể khôi phục bằng luồng này.', 400);
    }

    const targetRoleName = getRoleName(target.roles);
    ensureCanRestoreAccount(actor, target, targetRoleName);

    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .select('id, status, deleted_at')
      .eq('id', target.tenant_id)
      .maybeSingle();

    if (tenantError) throw apiError(`Không thể kiểm tra tenant: ${tenantError.message}`, 500);
    if (!tenant || tenant.deleted_at || (tenant.status && tenant.status !== 'active')) {
      throw apiError('Không thể khôi phục tài khoản vì tenant đã bị lưu trữ hoặc không active.', 400);
    }

    if (!target.user_id) {
      throw apiError('Tài khoản không còn liên kết Auth user, chưa thể khôi phục bằng luồng an toàn.', 400);
    }

    const { data: authUser, error: authError } = await admin.auth.admin.getUserById(target.user_id);
    if (authError || !authUser?.user) {
      throw apiError('Auth user của tài khoản không còn tồn tại, chưa thể khôi phục bằng luồng an toàn.', 400);
    }

    const { data: usernameConflict, error: conflictError } = await admin
      .from('accounts')
      .select('id')
      .eq('username', target.username)
      .is('deleted_at', null)
      .neq('id', accountId)
      .maybeSingle();

    if (conflictError) throw apiError(`Không thể kiểm tra username: ${conflictError.message}`, 500);
    if (usernameConflict) {
      throw apiError('Username này đã được dùng bởi tài khoản active khác. Không thể khôi phục.', 409);
    }

    if (!isAlreadyRestored) {
      const now = new Date().toISOString();
      const { error: restoreAccountError } = await admin
        .from('accounts')
        .update({
          status: 'active',
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', accountId)
        .not('deleted_at', 'is', null);

      if (restoreAccountError) {
        throw apiError(`Không thể khôi phục tài khoản: ${restoreAccountError.message}`, 500);
      }
    }

    const { data: deletedEventPermissions, error: deletedPermissionsError } = await admin
      .from('account_event_permissions')
      .select('id, event_id, permission')
      .eq('account_id', accountId)
      .not('deleted_at', 'is', null);

    if (deletedPermissionsError) {
      throw apiError(`Không thể đọc phân quyền event đã lưu trữ: ${deletedPermissionsError.message}`, 500);
    }

    const { data: activeEventPermissions, error: activePermissionsError } = await admin
      .from('account_event_permissions')
      .select('event_id, permission')
      .eq('account_id', accountId)
      .is('deleted_at', null);

    if (activePermissionsError) {
      throw apiError(`Không thể đọc phân quyền event active: ${activePermissionsError.message}`, 500);
    }

    const activePermissionKeys = new Set(
      (activeEventPermissions || []).map((permissionRow) => `${permissionRow.event_id}:${permissionRow.permission}`),
    );
    const permissionsToRestore = (deletedEventPermissions || []).filter(
      (permissionRow) => !activePermissionKeys.has(`${permissionRow.event_id}:${permissionRow.permission}`),
    );

    if (permissionsToRestore.length > 0) {
      const { error: restoreEventPermissionsError } = await admin
        .from('account_event_permissions')
        .update({ deleted_at: null })
        .in('id', permissionsToRestore.map((permissionRow) => permissionRow.id));

      if (restoreEventPermissionsError) {
        throw apiError(`Tài khoản đã khôi phục nhưng phân quyền event chưa khôi phục được: ${restoreEventPermissionsError.message}`, 500);
      }
    }

    await audit(admin, target.tenant_id, 'account.restore', JSON.stringify({
      actor_account_id: actor.id,
      target_account_id: target.id,
      target_role: targetRoleName,
      restored_event_permissions: permissionsToRestore.length,
      skipped_duplicate_event_permissions: (deletedEventPermissions || []).length - permissionsToRestore.length,
      result: 'allow',
    }));

    return sendJson(res, 200, { success: true });
  } catch (error) {
    return handleError(res, error);
  }
}
