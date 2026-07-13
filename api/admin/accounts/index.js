import {
  apiError,
  audit,
  getActorAccount,
  getAdminClient,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
  validateTargetAccount,
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
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    const role = String(body.role || '').trim();
    const tenantId = String(body.tenantId || '').trim();

    if (!email || !username || !password || !displayName) {
      throw apiError('Thiếu email, username, họ tên hoặc mật khẩu.', 400);
    }

    const { roleRecord } = await validateTargetAccount(admin, actor, role, tenantId);

    const { data: existingAccount } = await admin
      .from('accounts')
      .select('id')
      .eq('username', username)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingAccount) {
      throw apiError('Username đã tồn tại trong public.accounts.', 409);
    }

    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName, role, tenant_id: tenantId },
    });

    if (createError) {
      throw apiError(
        createError.message.includes('already')
          ? 'Email đã tồn tại trong Supabase Auth.'
          : `Supabase Auth từ chối tạo user: ${createError.message}`,
        createError.message.includes('already') ? 409 : 400,
      );
    }

    const targetAuthUserId = authData?.user?.id;
    if (!targetAuthUserId) {
      throw apiError('Supabase Auth không trả về user id sau khi tạo.', 500);
    }

    const { data: createdAccount, error: insertError } = await admin
      .from('accounts')
      .insert({
        user_id: targetAuthUserId,
        tenant_id: tenantId,
        username,
        display_name: displayName,
        role_id: roleRecord.id,
        status: 'active',
        created_by_account_id: actor.id,
      })
      .select('id')
      .single();

    if (insertError) {
      await admin.auth.admin.deleteUser(targetAuthUserId);
      if (/QUOTA_EXCEEDED|SUBSCRIPTION_INACTIVE|SUBSCRIPTION_PLAN_INACTIVE|TENANT_INACTIVE/i.test(insertError.message || '')) {
        throw apiError('Không thể tạo tài khoản vì đơn vị đã hết hạn hoặc đạt giới hạn tài khoản của gói.', 403);
      }
      throw apiError(`Tạo tài khoản bị lỗi khi đồng bộ dữ liệu: ${insertError.message}`, 500);
    }

    await audit(admin, tenantId, 'account.create', { target_role: role }, {
      actor,
      entityType: 'account',
      entityId: createdAccount?.id || targetAuthUserId,
    });
    return sendJson(res, 200, { success: true, user_id: targetAuthUserId });
  } catch (error) {
    return handleError(res, error);
  }
}
