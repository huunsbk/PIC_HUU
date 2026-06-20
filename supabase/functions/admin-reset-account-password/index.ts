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
      .select('id, user_id, tenant_id, username')
      .eq('username', targetUsername)
      .single();

    if (targetError || !targetAccount) {
      throw apiError(`Không tìm thấy tài khoản với username: ${targetUsername}`, 404);
    }

    if (actor.roleName === 'TENANT_ADMIN' && targetAccount.tenant_id !== actor.tenant_id) {
      throw apiError('TENANT_ADMIN chỉ được cấp lại mật khẩu trong tenant của mình.', 403);
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

    return json(req, { success: true });
  } catch (error) {
    return handleError(req, error);
  }
});
