import {
  apiError,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../../_accountService.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const token = getBearerToken(req);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);

    const { data, error } = await admin.rpc('list_payment_manual_reviews_v1', {
      p_actor_auth_user_id: userData.user.id,
    });
    if (error) {
      if (/SUPER_ADMIN_REQUIRED/.test(String(error.message || ''))) {
        throw apiError('Chỉ SUPER_ADMIN được xem đối soát thanh toán.', 403);
      }
      throw apiError('Không thể tải danh sách đối soát.', 500);
    }

    return sendJson(res, 200, { orders: Array.isArray(data) ? data : [] });
  } catch (error) {
    return handleError(res, error);
  }
}
