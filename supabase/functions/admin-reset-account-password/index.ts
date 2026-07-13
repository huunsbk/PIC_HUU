import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  apiError,
  createAdminClient,
  getActorAccount,
  getRoleName,
  handleError,
  handleOptions,
  json,
} from '../_shared/admin-account.ts';

const resettableByTenantAdmin = new Set(['EVENT_ADMIN', 'REFEREE', 'VIEWER']);

async function auditPasswordReset(
  admin: ReturnType<typeof createAdminClient>,
  actor: Record<string, unknown>,
  targetAccount: Record<string, unknown> | null,
  result: 'allow' | 'deny',
  reason: string,
) {
  try {
    await admin.from('audit_logs').insert({
      tenant_id: targetAccount?.tenant_id || actor?.tenant_id || null,
      action: 'account.reset_password',
      details: JSON.stringify({
        actor_account_id: actor?.id || null,
        target_account_id: targetAccount?.id || null,
        target_role: targetAccount ? getRoleName(targetAccount.roles) : null,
        result,
        reason,
      }),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Do not fail the security decision because audit dispatch failed.
  }
}

async function denyPasswordReset(
  admin: ReturnType<typeof createAdminClient>,
  actor: Record<string, unknown>,
  targetAccount: Record<string, unknown> | null,
  reason: string,
  status = 403,
) {
  if (targetAccount) {
    await auditPasswordReset(admin, actor, targetAccount, 'deny', reason);
  }
  throw apiError('Không thể reset mật khẩu cho tài khoản này.', status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const actor = await getActorAccount(req, admin);
    const body = await req.json();
    const targetUsername = String(body.targetUsername || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '');

    if (!targetUsername || !newPassword) {
      throw apiError('Thiếu username hoặc mật khẩu mới.', 400);
    }

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
      if (!resettableByTenantAdmin.has(targetRole)) {
        await denyPasswordReset(admin, actor, targetAccount, 'tenant_admin_target_role_not_allowed');
      }
    }

    if (!targetAccount.user_id) {
      throw apiError('Tài khoản chưa liên kết Supabase Auth user.', 400);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(targetAccount.user_id, {
      password: newPassword,
    });

    if (updateError) {
      throw apiError(`Lỗi cập nhật mật khẩu: ${updateError.message}`, 400);
    }

    await admin.from('active_sessions').delete().eq('account_id', targetAccount.id);
    await auditPasswordReset(admin, actor, targetAccount, 'allow', 'password_reset_success');

    return json(req, { success: true });
  } catch (error) {
    return handleError(req, error);
  }
});
