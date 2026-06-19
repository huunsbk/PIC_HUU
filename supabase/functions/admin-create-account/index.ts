import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedTargetRoles = new Set(['TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'VIEWER']);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getRoleName(rolesObj: unknown) {
  const value = rolesObj as { name?: string } | Array<{ name?: string }> | null;
  return Array.isArray(value) ? value[0]?.name || null : value?.name || null;
}

function apiError(message: string, status = 400) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw apiError('Edge Function chưa cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.', 500);
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw apiError('Thiếu phiên đăng nhập quản trị.', 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);
    }

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

    const { data: actor, error: actorError } = await admin
      .from('accounts')
      .select('id, tenant_id, status, roles(name)')
      .eq('user_id', userData.user.id)
      .single();

    if (actorError || !actor) {
      throw apiError('Không tìm thấy tài khoản quản trị đang đăng nhập.', 403);
    }

    const actorRole = getRoleName(actor.roles);
    if (!['SUPER_ADMIN', 'TENANT_ADMIN'].includes(actorRole || '')) {
      throw apiError('Thiếu quyền tạo tài khoản.', 403);
    }

    if (actor.status && actor.status !== 'active') {
      throw apiError('Tài khoản quản trị đang bị khóa.', 403);
    }

    if (actorRole === 'TENANT_ADMIN') {
      if (role === 'TENANT_ADMIN') {
        throw apiError('TENANT_ADMIN không được tạo thêm TENANT_ADMIN.', 403);
      }
      if (tenantId !== actor.tenant_id) {
        throw apiError('TENANT_ADMIN chỉ được tạo tài khoản trong tenant của mình.', 403);
      }
    }

    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError || !tenant) {
      throw apiError('Tenant được chọn không tồn tại.', 400);
    }

    const { data: roleRecord, error: roleError } = await admin
      .from('roles')
      .select('id')
      .eq('name', role)
      .maybeSingle();
    if (roleError || !roleRecord) {
      throw apiError(`Role ${role} chưa tồn tại trong hệ thống. Không tự tạo role mới.`, 500);
    }

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

    return json({ success: true, user_id: targetAuthUserId });
  } catch (error) {
    const err = error as Error & { status?: number };
    return json({ error: err.message || 'Có lỗi máy chủ.' }, err.status || 500);
  }
});
