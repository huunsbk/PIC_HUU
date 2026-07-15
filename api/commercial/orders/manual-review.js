import {
  apiError,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../../admin/_accountService.js';

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
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) throw apiError('Mã đơn không hợp lệ.', 400);

    const { data, error } = await admin.rpc('request_payment_manual_review_v1', {
      p_auth_user_id: userData.user.id,
      p_order_id: orderId,
    });
    if (error) {
      const message = String(error.message || '');
      if (/MANUAL_REVIEW_NOT_AVAILABLE/.test(message)) {
        throw apiError('Chưa đến thời điểm yêu cầu kiểm tra thanh toán.', 409);
      }
      if (/ORDER_NOT_FOUND/.test(message)) throw apiError('Không tìm thấy đơn thuộc tài khoản này.', 404);
      if (/ORDER_NOT_REVIEWABLE/.test(message)) throw apiError('Đơn không còn ở trạng thái có thể kiểm tra.', 409);
      throw apiError('Không thể gửi yêu cầu kiểm tra thanh toán.', 500);
    }

    return sendJson(res, 200, data);
  } catch (error) {
    return handleError(res, error);
  }
}
