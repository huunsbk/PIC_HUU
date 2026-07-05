import {
  apiError,
  getActorAccount,
  getAdminClient,
  getRoleName,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../_accountService.js';

function mapDeletedAccount(row) {
  const roleName = getRoleName(row.roles);
  return {
    id: row.id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenants?.name || null,
    tenant_slug: row.tenants?.slug || null,
    username: row.username,
    display_name: row.display_name,
    role_name: roleName,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    archived_at: row.deleted_at,
    created_by_account_id: row.created_by_account_id,
    auth_linked: Boolean(row.user_id),
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const actor = await getActorAccount(req, admin);

    let query = admin
      .from('accounts')
      .select(`
        id,
        user_id,
        tenant_id,
        username,
        display_name,
        status,
        created_at,
        updated_at,
        deleted_at,
        created_by_account_id,
        roles!inner(name),
        tenants(name, slug)
      `)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (actor.roleName === 'TENANT_ADMIN') {
      query = query.eq('tenant_id', actor.tenant_id);
    } else if (actor.roleName === 'EVENT_ADMIN') {
      query = query
        .eq('tenant_id', actor.tenant_id)
        .eq('created_by_account_id', actor.id)
        .eq('roles.name', 'REFEREE');
    } else if (actor.roleName !== 'SUPER_ADMIN') {
      throw apiError('Thiếu quyền xem tài khoản đã lưu trữ.', 403);
    }

    const { data, error } = await query;
    if (error) throw apiError(`Không tải được danh sách tài khoản đã xóa: ${error.message}`, 500);

    return sendJson(res, 200, {
      success: true,
      accounts: (data || []).map(mapDeletedAccount),
    });
  } catch (error) {
    return handleError(res, error);
  }
}
