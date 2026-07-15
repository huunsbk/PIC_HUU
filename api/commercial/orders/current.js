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
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const token = getBearerToken(req);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);

    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .maybeSingle();
    if (accountError || !account) throw apiError('Tài khoản không hoạt động.', 403);

    const { data: order, error: orderError } = await admin
      .from('payment_orders')
      .select('id, order_code, provider_order_code, order_type, status, total_amount, currency, transfer_content, provider_checkout_url, provider_qr_code, manual_review_available_at, manual_review_requested_at, expires_at, paid_at, created_at')
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) throw apiError('Không thể tải trạng thái thanh toán.', 500);

    return sendJson(res, 200, {
      order: order ? {
        ...order,
        checkout_url: order.provider_checkout_url,
        qr_code: order.provider_qr_code,
        provider_checkout_url: undefined,
        provider_qr_code: undefined,
      } : null,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
