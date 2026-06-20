import {
  apiError,
  audit,
  getActorAccount,
  getAdminClient,
  handleError,
  getRoleName,
  sendJson,
  validateTargetAccount,
} from '../_accountService.js';

export default async function handler(req, res) {
  try {
    const admin = getAdminClient();
    const actor = await getActorAccount(req, admin);
    const accountId = String(req.query.id || '').trim();
    if (!accountId) throw apiError('Thiếu accountId.', 400);

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const displayName = String(body.displayName || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || '').trim();
      const tenantId = String(body.tenantId || '').trim();
      const status = String(body.status || 'active').trim();

      if (!displayName) throw apiError('Thiếu tên hiển thị.', 400);
      if (!['active', 'locked', 'inactive'].includes(status)) {
        throw apiError('Trạng thái tài khoản không hợp lệ.', 400);
      }

      const { roleRecord } = await validateTargetAccount(admin, actor, role, tenantId);
      const { data: targetAccount, error: targetError } = await admin
        .from('accounts')
        .select('id, tenant_id, user_id, username')
        .eq('id', accountId)
        .single();

      if (targetError || !targetAccount) throw apiError('Không tìm thấy tài khoản cần cập nhật.', 404);
      if (actor.roleName === 'TENANT_ADMIN' && targetAccount.tenant_id !== actor.tenant_id) {
        throw apiError('TENANT_ADMIN chỉ được cập nhật tài khoản trong tenant của mình.', 403);
      }

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
      if (actor.roleName !== 'SUPER_ADMIN') throw apiError('Chỉ SUPER_ADMIN được xóa vĩnh viễn tài khoản.', 403);

      const { data: targetAccount, error: targetError } = await admin
        .from('accounts')
        .select('id, tenant_id, user_id, username, roles(name)')
        .eq('id', accountId)
        .single();
      if (targetError || !targetAccount) throw apiError('Không tìm thấy tài khoản để xóa.', 404);

      if (getRoleName(targetAccount.roles) === 'SUPER_ADMIN') {
        throw apiError('Không xóa SUPER_ADMIN bằng thao tác này.', 403);
      }

      await admin.from('active_sessions').delete().eq('account_id', accountId);
      await admin.from('login_logs').delete().eq('account_id', accountId);
      await admin.from('account_permissions').delete().eq('account_id', accountId);
      await admin.from('account_event_permissions').delete().eq('account_id', accountId);

      const { error: deleteAccountError } = await admin.from('accounts').delete().eq('id', accountId);
      if (deleteAccountError) throw apiError(`Lỗi khi xóa trong DB accounts: ${deleteAccountError.message}`, 500);

      if (targetAccount.user_id) {
        const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetAccount.user_id);
        if (deleteAuthError) {
          throw apiError(`Đã xóa account DB nhưng lỗi khi xóa Auth user: ${deleteAuthError.message}`, 500);
        }
      }

      await audit(admin, targetAccount.tenant_id, 'account.delete', `Deleted account ${targetAccount.username}`);
      return sendJson(res, 200, { success: true });
    }

    res.setHeader('Allow', 'PUT, DELETE');
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleError(res, error);
  }
}
