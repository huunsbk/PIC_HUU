import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  allowedTargetRoles,
  apiError,
  createAdminClient,
  getActorAccount,
  handleError,
  handleOptions,
  json,
  validateTargetAccount,
} from '../_shared/admin-account.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleOptions(req);
  }

  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    const role = String(body.role || '').trim();
    const tenantId = String(body.tenantId || '').trim();

    if (!email || !username || !password || !displayName) {
      throw apiError('Thiếu email, username, họ tên hoặc mật khẩu.', 400);
    }

    if (!allowedTargetRoles.has(role)) {
      throw apiError('Role không hợp lệ. Chỉ hỗ trợ TENANT_ADMIN, EVENT_ADMIN, REFEREE, VIEWER.', 400);
    }

    if (!tenantId || tenantId === 'default') {
      throw apiError('Thiếu tenant hợp lệ cho tài khoản cần tạo.', 400);
    }

    const actor = await getActorAccount(req, admin);
    const { roleRecord } = await validateTargetAccount(admin, actor, role, tenantId);

    const { data: existingAccount } = await admin
      .from('accounts')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existingAccount) {
      throw apiError('Username đã tồn tại trong public.accounts.', 409);
    }

    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: displayName,
        role,
        tenant_id: tenantId,
      },
    });

    if (createError) {
      throw apiError(
        createError.message.includes('already')
          ? 'Email đã tồn tại trong Supabase Auth.'
          : `Supabase Auth từ chối tạo user: ${createError.message}`,
        createError.message.includes('already') ? 409 : 400,
      );
    }

    const targetAuthUserId = authData.user?.id;
    if (!targetAuthUserId) {
      throw apiError('Supabase Auth không trả về user id sau khi tạo.', 500);
    }

    const { error: insertError } = await admin.from('accounts').insert({
      user_id: targetAuthUserId,
      tenant_id: tenantId,
      username,
      display_name: displayName,
      role_id: roleRecord.id,
      status: 'active',
    });

    if (insertError) {
      await admin.auth.admin.deleteUser(targetAuthUserId);
      throw apiError(`Tạo tài khoản bị lỗi khi đồng bộ dữ liệu: ${insertError.message}`, 500);
    }

    return json(req, { success: true, user_id: targetAuthUserId });
  } catch (error) {
    return handleError(req, error);
  }
});
