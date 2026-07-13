import {
  apiError,
  audit,
  getActorAccount,
  getAdminClient,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../_accountService.js';

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
      .select('id, user_id, tenant_id, username')
      .eq('username', targetUsername)
      .single();
    if (targetError || !targetAccount) {
      throw apiError(`Không tìm thấy tài khoản với username: ${targetUsername}`, 404);
    }

    if (actor.roleName === 'TENANT_ADMIN' && targetAccount.tenant_id !== actor.tenant_id) {
      throw apiError('TENANT_ADMIN chỉ được cấp lại mật khẩu trong tenant của mình.', 403);
    }

    if (!targetAccount.user_id) throw apiError('Tài khoản chưa liên kết Supabase Auth user.', 400);

    const { error: updateError } = await admin.auth.admin.updateUserById(targetAccount.user_id, {
      password: newPassword,
    });
    if (updateError) throw apiError(`Lỗi cập nhật mật khẩu: ${updateError.message}`, 400);

    await audit(admin, targetAccount.tenant_id, 'account.reset_password', {}, {
      actor,
      entityType: 'account',
      entityId: targetAccount.id,
    });
    return sendJson(res, 200, { success: true });
  } catch (error) {
    return handleError(res, error);
  }
}
