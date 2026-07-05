import {
  apiError,
  audit,
  getActorAccount,
  getAdminClient,
  handleError,
  handleOptions,
  getRoleName,
  ensureEventAdminCanManageTargetAccount,
  sendJson,
  setCorsHeaders,
  validateTargetAccount,
} from '../_accountService.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  try {
    const admin = getAdminClient();
    const actor = await getActorAccount(req, admin);
    const accountId = String(req.query.id || '').trim();
    if (!accountId) throw apiError('Thiếu accountId.', 400);

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const displayName = String(body.displayName || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const status = String(body.status || 'active').trim();

      if (!displayName) throw apiError('Thiếu tên hiển thị.', 400);
      if (!['active', 'inactive', 'banned'].includes(status)) {
        throw apiError('Trạng thái tài khoản không hợp lệ.', 400);
      }

      const { data: targetAccount, error: targetError } = await admin
        .from('accounts')
        .select('id, tenant_id, user_id, username')
        .eq('id', accountId)
        .is('deleted_at', null)
        .single();

      if (targetError || !targetAccount) throw apiError('Không tìm thấy tài khoản cần cập nhật.', 404);
      if (actor.roleName === 'TENANT_ADMIN' && targetAccount.tenant_id !== actor.tenant_id) {
        throw apiError('TENANT_ADMIN chỉ được cập nhật tài khoản trong tenant của mình.', 403);
      }
      await ensureEventAdminCanManageTargetAccount(admin, actor, accountId);

      const { roleRecord } = await validateTargetAccount(admin, actor, role, tenantId, {
        excludeAccountId: accountId,
      });

      if (targetAccount.user_id) {
        const updateData = {
          user_metadata: {
            username: targetAccount.username,
            display_name: displayName,
            role,
            tenant_id: tenantId,
          },
        };
        if (password) updateData.password = password;

        const { error: updateAuthError } = await admin.auth.admin.updateUserById(targetAccount.user_id, updateData);
        if (updateAuthError) throw apiError(`Lỗi cập nhật auth: ${updateAuthError.message}`, 400);
      }

      const { error: updateError } = await admin
        .from('accounts')
        .update({
          display_name: displayName,
          role_id: roleRecord.id,
          tenant_id: tenantId,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId);
      if (updateError) throw apiError(`Lỗi cập nhật account: ${updateError.message}`, 500);

      await audit(admin, tenantId, 'account.update', `Updated account ${targetAccount.username}`);
      return sendJson(res, 200, { success: true });
    }

    if (req.method === 'DELETE') {
      if (!['SUPER_ADMIN', 'EVENT_ADMIN'].includes(actor.roleName || '')) {
        throw apiError('Chỉ SUPER_ADMIN hoặc EVENT_ADMIN có phạm vi phù hợp được xóa hoặc khóa tài khoản.', 403);
      }

      const { data: targetAccount, error: targetError } = await admin
        .from('accounts')
        .select('id, tenant_id, user_id, username, roles(name), created_by_account_id')
        .eq('id', accountId)
        .is('deleted_at', null)
        .single();
      if (targetError || !targetAccount) throw apiError('Không tìm thấy tài khoản để xóa.', 404);

      if (targetAccount.user_id === actor.authUserId) {
        throw apiError('Không thể tự xóa hoặc khóa chính tài khoản đang đăng nhập.', 403);
      }

      const targetRoleName = getRoleName(targetAccount.roles);
      await ensureEventAdminCanManageTargetAccount(admin, actor, accountId);

      if (targetRoleName === 'SUPER_ADMIN') {
        const { count: activeSuperAdminCount, error: countError } = await admin
          .from('accounts')
          .select('id, roles!inner(name)', { count: 'exact', head: true })
          .eq('roles.name', 'SUPER_ADMIN')
          .eq('status', 'active')
          .is('deleted_at', null);

        if (countError) {
          throw apiError(`Không thể kiểm tra số lượng SUPER_ADMIN: ${countError.message}`, 500);
        }

        if ((activeSuperAdminCount || 0) <= 1) {
          throw apiError('Không thể xóa SUPER_ADMIN cuối cùng.', 403);
        }
      }

      await admin.from('active_sessions').delete().eq('account_id', accountId);
      await admin.from('login_logs').delete().eq('account_id', accountId);
      await admin
        .from('account_event_permissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .is('deleted_at', null);

      const { error: softDeleteError } = await admin
        .from('accounts')
        .update({
          status: 'inactive',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId)
        .is('deleted_at', null);
      if (softDeleteError) throw apiError(`Lỗi khi khóa tài khoản: ${softDeleteError.message}`, 500);

      await audit(admin, targetAccount.tenant_id, 'account.archive', `Soft-deleted account ${targetAccount.username}`);
      return sendJson(res, 200, { success: true });
    }

    res.setHeader('Allow', 'PUT, POST, DELETE, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleError(res, error);
  }
}
