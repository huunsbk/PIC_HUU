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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const token = getBearerToken(req);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);

    const orderId = String(req.body?.orderId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId) || reason.length < 3) {
      throw apiError('Mã đơn hoặc lý do từ chối không hợp lệ.', 400);
    }

    const { data, error } = await admin.rpc('reject_payment_order_manual_v1', {
      p_actor_auth_user_id: userData.user.id,
      p_order_id: orderId,
      p_reason: reason,
    });
    if (error) {
      const message = String(error.message || '');
      if (/SUPER_ADMIN_REQUIRED/.test(message)) throw apiError('Chỉ SUPER_ADMIN được từ chối đối soát.', 403);
      if (/PAID_ORDER_CANNOT_BE_REJECTED|ORDER_NOT_REJECTABLE/.test(message)) {
        throw apiError('Đơn không còn ở trạng thái có thể từ chối.', 409);
      }
      throw apiError('Không thể từ chối đơn.', 500);
    }

    return sendJson(res, 200, data);
  } catch (error) {
    return handleError(res, error);
  }
}
