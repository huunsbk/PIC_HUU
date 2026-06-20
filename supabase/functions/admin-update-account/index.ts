import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  apiError,
  createAdminClient,
  getActorAccount,
  handleError,
  handleOptions,
  json,
  validateTargetAccount,
} from '../_shared/admin-account.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const actor = await getActorAccount(req, admin);
    const body = await req.json();
    const accountId = String(body.accountId || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = String(body.role || '').trim();
    const tenantId = String(body.tenantId || '').trim();
    const status = String(body.status || 'active').trim();

    if (!accountId || !displayName) {
      throw apiError('Thiếu accountId hoặc tên hiển thị.', 400);
    }

    if (!['active', 'locked', 'inactive'].includes(status)) {
      throw apiError('Trạng thái tài khoản không hợp lệ.', 400);
    }

    const { roleRecord } = await validateTargetAccount(admin, actor, role, tenantId);

    const { data: targetAccount, error: targetError } = await admin
      .from('accounts')
      .select('id, tenant_id, user_id, username')
      .eq('id', accountId)
      .single();

    if (targetError || !targetAccount) {
      throw apiError('Không tìm thấy tài khoản cần cập nhật.', 404);
    }

    if (actor.roleName === 'TENANT_ADMIN' && targetAccount.tenant_id !== actor.tenant_id) {
      throw apiError('TENANT_ADMIN chỉ được cập nhật tài khoản trong tenant của mình.', 403);
    }

    if (targetAccount.user_id) {
      const updateData: {
        user_metadata: Record<string, string>;
        password?: string;
      } = {
        user_metadata: {
          username: targetAccount.username,
          display_name: displayName,
          role,
          tenant_id: tenantId,
        },
      };

      if (password) updateData.password = password;

      const { error: updateAuthError } = await admin.auth.admin.updateUserById(targetAccount.user_id, updateData);
      if (updateAuthError) {
        throw apiError(`Lỗi cập nhật auth: ${updateAuthError.message}`, 400);
      }
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

    if (updateError) {
      throw apiError(`Lỗi cập nhật account: ${updateError.message}`, 500);
    }

    return json(req, { success: true });
  } catch (error) {
    return handleError(req, error);
  }
});
