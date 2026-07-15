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
    const transactionId = String(req.body?.transactionId || '').trim();
    const receivedAmount = Number(req.body?.receivedAmount);
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)
        || !transactionId || !Number.isSafeInteger(receivedAmount) || receivedAmount <= 0) {
      throw apiError('Thiếu mã đơn, mã giao dịch hoặc số tiền hợp lệ.', 400);
    }

    const { data, error } = await admin.rpc('confirm_payment_order_manual_v1', {
      p_actor_auth_user_id: userData.user.id,
      p_order_id: orderId,
      p_received_amount: receivedAmount,
      p_provider_transaction_id: transactionId,
    });
    if (error) {
      const message = String(error.message || '');
      if (/SUPER_ADMIN_REQUIRED/.test(message)) throw apiError('Chỉ SUPER_ADMIN được xác nhận thanh toán.', 403);
      if (/ORDER_NOT_FOUND/.test(message)) throw apiError('Không tìm thấy đơn.', 404);
      if (/ORDER_NOT_CONFIRMABLE|ORDER_TARGET_INACTIVE/.test(message)) {
        throw apiError('Đơn hoặc tài khoản đích không đủ điều kiện mở khóa.', 409);
      }
      if (/PROVIDER_TRANSACTION_ALREADY_USED/.test(message)) {
        throw apiError('Mã giao dịch đã được dùng cho đơn khác.', 409);
      }
      throw apiError('Không thể xác nhận thanh toán.', 500);
    }

    if (data?.result === 'payment_mismatch') {
      return sendJson(res, 409, { error: 'Số tiền nhận không khớp số tiền đơn.', ...data });
    }
    return sendJson(res, 200, data);
  } catch (error) {
    return handleError(res, error);
  }
}
