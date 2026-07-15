import {
  apiError,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from './_accountService.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

async function getAuthUser(req, admin) {
  const token = getBearerToken(req);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);
  return data.user;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  try {
    const admin = getAdminClient();
    const user = await getAuthUser(req, admin);
    const requestUrl = String(req.url || '');
    const pathAction = requestUrl.includes('/confirm')
      ? 'confirm'
      : requestUrl.includes('/reject') ? 'reject' : 'list';
    const action = String(req.query?.action || pathAction);

    if (req.method === 'GET' && action === 'list') {
      const { data, error } = await admin.rpc('list_payment_manual_reviews_v1', {
        p_actor_auth_user_id: user.id,
      });
      if (error) {
        if (/SUPER_ADMIN_REQUIRED/.test(String(error.message || ''))) {
          throw apiError('Chỉ SUPER_ADMIN được xem đối soát thanh toán.', 403);
        }
        throw apiError('Không thể tải danh sách đối soát.', 500);
      }
      return sendJson(res, 200, { orders: Array.isArray(data) ? data : [] });
    }

    if (req.method === 'POST' && action === 'confirm') {
      const orderId = String(req.body?.orderId || '').trim();
      const transactionId = String(req.body?.transactionId || '').trim();
      const receivedAmount = Number(req.body?.receivedAmount);
      if (!uuidPattern.test(orderId) || !transactionId
          || !Number.isSafeInteger(receivedAmount) || receivedAmount <= 0) {
        throw apiError('Thiếu mã đơn, mã giao dịch hoặc số tiền hợp lệ.', 400);
      }

      const { data, error } = await admin.rpc('confirm_payment_order_manual_v1', {
        p_actor_auth_user_id: user.id,
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
    }

    if (req.method === 'POST' && action === 'reject') {
      const orderId = String(req.body?.orderId || '').trim();
      const reason = String(req.body?.reason || '').trim();
      if (!uuidPattern.test(orderId) || reason.length < 3) {
        throw apiError('Mã đơn hoặc lý do từ chối không hợp lệ.', 400);
      }

      const { data, error } = await admin.rpc('reject_payment_order_manual_v1', {
        p_actor_auth_user_id: user.id,
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
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleError(res, error);
  }
}
