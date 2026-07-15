import crypto from 'node:crypto';
import {
  apiError,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../../admin/_accountService.js';
import {
  createPayOSPaymentLink,
  getPayOSConfig,
  resolvePublicAppUrl,
} from '../_payos.js';

function safeOrder(result) {
  return result?.order || result || null;
}

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

    const planCode = String(req.body?.planCode || '').trim().toUpperCase();
    const extraEvents = Number(req.body?.extraEvents || 0);
    const extraReferees = Number(req.body?.extraReferees || 0);
    const clientRequestId = String(req.body?.clientRequestId || crypto.randomUUID()).trim();
    if (!/^SELF_(3D|7D|30D|60D)$/.test(planCode)) throw apiError('Gói mở khóa không hợp lệ.', 400);
    if (!Number.isInteger(extraEvents) || !Number.isInteger(extraReferees)) {
      throw apiError('Số lượng mua thêm phải là số nguyên.', 400);
    }

    const { data: created, error: createError } = await admin.rpc('create_payment_order_v1', {
      p_auth_user_id: userData.user.id,
      p_plan_code: planCode,
      p_extra_event_quantity: extraEvents,
      p_extra_referee_quantity: extraReferees,
      p_client_request_id: clientRequestId,
    });
    if (createError) {
      const code = String(createError.message || '');
      if (/SUBSCRIPTION_ALREADY_ACTIVE/.test(code)) throw apiError('Gói hiện tại vẫn còn hiệu lực.', 409);
      if (/SELF_SERVICE_ACCOUNT_REQUIRED/.test(code)) throw apiError('Tài khoản không thuộc luồng tự phục vụ.', 403);
      throw apiError('Không thể tạo đơn thanh toán lúc này.', 500);
    }

    let order = safeOrder(created);
    const payOS = getPayOSConfig();
    if (payOS.available && order && !order.checkout_url) {
      try {
        const provider = await createPayOSPaymentLink(order, resolvePublicAppUrl(req), payOS);
        const { data: attached, error: attachError } = await admin.rpc('attach_payment_provider_v1', {
          p_order_id: order.id,
          p_provider_order_id: provider.paymentLinkId || provider.id || null,
          p_checkout_url: provider.checkoutUrl || null,
          p_qr_code: provider.qrCode || null,
        });
        if (attachError) throw attachError;
        order = safeOrder(attached);
      } catch {
        return sendJson(res, 503, {
          error: 'Đơn đã được tạo nhưng cổng thanh toán chưa phản hồi. Vui lòng thử lại bằng cùng yêu cầu.',
          order,
          provider_available: true,
        });
      }
    }

    return sendJson(res, 200, {
      success: true,
      created: created?.created === true,
      order,
      provider_available: payOS.available,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
