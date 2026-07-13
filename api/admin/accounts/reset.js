import {
  apiError,
  audit,
  ensureEventAdminCanManageTargetAccount,
  getActorAccount,
  getAdminClient,
  getRoleName,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../_accountService.js';

const RESETTABLE_BY_TENANT_ADMIN = new Set(['EVENT_ADMIN', 'REFEREE', 'VIEWER']);

async function auditPasswordReset(admin, actor, targetAccount, result, reason) {
  try {
    await audit(
      admin,
      targetAccount?.tenant_id || actor?.tenant_id || null,
      'account.reset_password',
      JSON.stringify({
        actor_account_id: actor?.id || null,
        target_account_id: targetAccount?.id || null,
        target_role: targetAccount ? getRoleName(targetAccount.roles) : null,
        result,
        reason,
      }),
    );
  } catch {
    // Do not fail the security decision because audit dispatch failed.
  }
}

async function denyPasswordReset(admin, actor, targetAccount, reason, status = 403) {
  if (targetAccount) {
    await auditPasswordReset(admin, actor, targetAccount, 'deny', reason);
  }
  throw apiError('Không thể reset mật khẩu cho tài khoản này.', status);
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
    const targetUsername = String(body.targetUsername || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '');

    if (!targetUsername || !newPassword) throw apiError('Thiếu username hoặc mật khẩu mới.', 400);

    const { data: targetAccount, error: targetError } = await admin
      .from('accounts')
      .select('id, user_id, tenant_id, username, status, deleted_at, roles(name)')
      .eq('username', targetUsername)
      .is('deleted_at', null)
      .maybeSingle();
    if (targetError || !targetAccount) {
      throw apiError('Không thể reset mật khẩu cho tài khoản này.', 404);
    }

    const targetRole = getRoleName(targetAccount.roles);
    if (!targetRole || targetAccount.status !== 'active') {
      await denyPasswordReset(admin, actor, targetAccount, 'target_not_active');
    }

    if (targetRole === 'SUPER_ADMIN' && actor.roleName !== 'SUPER_ADMIN') {
      await denyPasswordReset(admin, actor, targetAccount, 'non_super_admin_reset_super_admin');
    }

    if (actor.roleName === 'TENANT_ADMIN') {
      if (targetAccount.tenant_id !== actor.tenant_id) {
        await denyPasswordReset(admin, actor, targetAccount, 'tenant_admin_cross_tenant');
      }
      if (!RESETTABLE_BY_TENANT_ADMIN.has(targetRole)) {
        await denyPasswordReset(admin, actor, targetAccount, 'tenant_admin_target_role_not_allowed');
      }
    }

    if (actor.roleName === 'EVENT_ADMIN') {
      if (targetRole !== 'REFEREE') {
        await denyPasswordReset(admin, actor, targetAccount, 'event_admin_target_role_not_allowed');
      }
      try {
        await ensureEventAdminCanManageTargetAccount(admin, actor, targetAccount.id);
      } catch {
        await denyPasswordReset(admin, actor, targetAccount, 'event_admin_scope_denied');
      }
    }

    if (!targetAccount.user_id) throw apiError('Tài khoản chưa liên kết Supabase Auth user.', 400);

    const { error: updateError } = await admin.auth.admin.updateUserById(targetAccount.user_id, {
      password: newPassword,
    });
    if (updateError) throw apiError(`Lỗi cập nhật mật khẩu: ${updateError.message}`, 400);

    await admin.from('active_sessions').delete().eq('account_id', targetAccount.id);
    await auditPasswordReset(admin, actor, targetAccount, 'allow', 'password_reset_success');
    return sendJson(res, 200, { success: true });
  } catch (error) {
    return handleError(res, error);
  }
}
