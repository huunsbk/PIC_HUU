import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  apiError,
  createAdminClient,
  getActorAccount,
  handleError,
  handleOptions,
  json,
} from '../_shared/admin-account.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const actor = await getActorAccount(req, admin);
    if (actor.roleName !== 'SUPER_ADMIN') {
      throw apiError('Chỉ SUPER_ADMIN được xóa vĩnh viễn tài khoản.', 403);
    }

    const body = await req.json();
    const accountId = String(body.accountId || '').trim();
    if (!accountId) {
      throw apiError('Thiếu accountId cần xóa.', 400);
    }

    const { data: targetAccount, error: fetchError } = await admin
      .from('accounts')
      .select('id, user_id, username, roles(name)')
      .eq('id', accountId)
      .single();

    if (fetchError || !targetAccount) {
      throw apiError('Không tìm thấy tài khoản để xóa.', 404);
    }

    const targetRole = Array.isArray(targetAccount.roles)
      ? targetAccount.roles[0]?.name
      : (targetAccount.roles as { name?: string } | null)?.name;

    if (targetRole === 'SUPER_ADMIN') {
      throw apiError('Không xóa SUPER_ADMIN bằng thao tác này.', 403);
    }

    await admin.from('active_sessions').delete().eq('account_id', accountId);
    await admin.from('login_logs').delete().eq('account_id', accountId);
    await admin.from('account_permissions').delete().eq('account_id', accountId);
    await admin.from('account_event_permissions').delete().eq('account_id', accountId);

    const { error: deleteAccountError } = await admin.from('accounts').delete().eq('id', accountId);
    if (deleteAccountError) {
      throw apiError(`Lỗi khi xóa trong DB accounts: ${deleteAccountError.message}`, 500);
    }

    if (targetAccount.user_id) {
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetAccount.user_id);
      if (deleteAuthError) {
        throw apiError(`Đã xóa account DB nhưng lỗi khi xóa Auth user: ${deleteAuthError.message}`, 500);
      }
    }

    return json(req, { success: true });
  } catch (error) {
    return handleError(req, error);
  }
});
