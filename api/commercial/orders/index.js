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
  cancelPayOSPaymentLink,
  createPayOSPaymentLink,
  getPayOSPaymentLink,
  getPayOSConfig,
  resolvePublicAppUrl,
} from '../_payos.js';

function safeOrder(result) {
  return result?.order || result || null;
}

async function getAuthUser(req, admin) {
  const token = getBearerToken(req);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);
  return data.user;
}

async function getCurrentOrder(admin, user) {
  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  if (accountError || !account) throw apiError('Tài khoản không hoạt động.', 403);

  const { data: order, error: orderError } = await admin
    .from('payment_orders')
    .select('id, order_code, provider_order_code, order_type, status, base_amount, addon_amount, total_amount, currency, transfer_content, provider_checkout_url, provider_qr_code, manual_review_available_at, manual_review_requested_at, expires_at, paid_at, created_at, metadata')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw apiError('Không thể tải trạng thái thanh toán.', 500);

  return order ? {
    ...order,
    checkout_url: order.provider_checkout_url,
    qr_code: order.provider_qr_code,
    team_capacity_limit: Number(order.metadata?.team_capacity_limit || 0) || null,
    provider_checkout_url: undefined,
    provider_qr_code: undefined,
    metadata: undefined,
  } : null;
}

async function getOwnedOrder(admin, user, orderId) {
  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id, tenant_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  if (accountError || !account) throw apiError('Tài khoản không hoạt động.', 403);

  const { data: order, error: orderError } = await admin
    .from('payment_orders')
    .select('id, account_id, tenant_id, status, provider_order_code, provider_order_id, provider_checkout_url')
    .eq('id', orderId)
    .eq('account_id', account.id)
    .eq('tenant_id', account.tenant_id)
    .maybeSingle();
  if (orderError) throw apiError('Không thể kiểm tra đơn thanh toán.', 500);
  if (!order) throw apiError('Không tìm thấy đơn thuộc tài khoản này.', 404);
  return order;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const user = await getAuthUser(req, admin);
    const pathAction = String(req.url || '').includes('/manual-review') ? 'manual-review' : null;
    const action = String(req.query?.action || pathAction || (req.method === 'GET' ? 'current' : 'create'));

    if (req.method === 'GET' && action === 'current') {
      return sendJson(res, 200, { order: await getCurrentOrder(admin, user) });
    }

    if (req.method === 'POST' && action === 'manual-review') {
      const orderId = String(req.body?.orderId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) throw apiError('Mã đơn không hợp lệ.', 400);
      const { data, error } = await admin.rpc('request_payment_manual_review_v1', {
        p_auth_user_id: user.id,
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
    }

    if (req.method === 'POST' && action === 'cancel') {
      const orderId = String(req.body?.orderId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) throw apiError('Mã đơn không hợp lệ.', 400);

      const order = await getOwnedOrder(admin, user, orderId);
      if (order.status === 'cancelled') {
        return sendJson(res, 200, { success: true, result: 'already_cancelled', order_id: order.id });
      }
      if (order.status !== 'awaiting_payment') {
        throw apiError('Chỉ có thể hủy đơn đang chờ thanh toán.', 409);
      }

      const payOS = getPayOSConfig();
      const providerOrderKey = order.provider_order_id || order.provider_order_code;
      if (order.provider_checkout_url && (!payOS.available || !providerOrderKey)) {
        throw apiError('Chưa thể kết nối payOS để xác nhận hủy đơn. Vui lòng thử lại.', 503);
      }
      if (payOS.available && providerOrderKey) {
        try {
          await cancelPayOSPaymentLink(providerOrderKey, 'Khách hàng yêu cầu hủy đơn', payOS);
        } catch {
          let providerState = null;
          try {
            providerState = await getPayOSPaymentLink(providerOrderKey, payOS);
          } catch {
            if (order.provider_checkout_url) {
              throw apiError('Chưa thể xác nhận hủy với payOS. Vui lòng thử lại.', 503);
            }
          }

          const providerStatus = String(providerState?.status || '').toUpperCase();
          if (providerStatus === 'PAID') {
            throw apiError('Giao dịch đã được payOS ghi nhận, không thể hủy.', 409);
          }
          if (providerStatus && providerStatus !== 'CANCELLED') {
            throw apiError('payOS chưa xác nhận hủy đơn. Vui lòng thử lại.', 503);
          }
        }
      }

      const { data, error } = await admin.rpc('cancel_payment_order_v1', {
        p_auth_user_id: user.id,
        p_order_id: orderId,
      });
      if (error) {
        const code = String(error.message || '');
        if (/ORDER_NOT_FOUND/.test(code)) throw apiError('Không tìm thấy đơn thuộc tài khoản này.', 404);
        if (/ORDER_NOT_CANCELLABLE/.test(code)) throw apiError('Đơn không còn ở trạng thái có thể hủy.', 409);
        throw apiError('Không thể hủy đơn thanh toán.', 500);
      }
      return sendJson(res, 200, data);
    }

    if (req.method !== 'POST' || action !== 'create') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const orderType = String(req.body?.orderType || 'activation').trim().toLowerCase();
    const planCode = String(req.body?.planCode || '').trim().toUpperCase();
    const extraEvents = Number(req.body?.extraEvents || 0);
    const extraReferees = Number(req.body?.extraReferees || 0);
    const teamCapacity = req.body?.teamCapacity === null || req.body?.teamCapacity === undefined
      ? null
      : Number(req.body.teamCapacity);
    const clientRequestId = String(req.body?.clientRequestId || crypto.randomUUID()).trim();
    if (!['activation', 'renewal', 'addon'].includes(orderType)) throw apiError('Loại đơn không hợp lệ.', 400);
    if (orderType !== 'addon' && !/^SELF_(3D|7D|30D|60D)$/.test(planCode)) {
      throw apiError('Gói mở khóa không hợp lệ.', 400);
    }
    if (!Number.isInteger(extraEvents) || !Number.isInteger(extraReferees)) {
      throw apiError('Số lượng mua thêm phải là số nguyên.', 400);
    }
    if (teamCapacity !== null && ![48, 64, 96].includes(teamCapacity)) {
      throw apiError('Sức chứa đội không hợp lệ.', 400);
    }

    const { data: created, error: createError } = await admin.rpc('create_payment_order_v3', {
      p_auth_user_id: user.id,
      p_order_type: orderType,
      p_plan_code: orderType === 'addon' ? null : planCode,
      p_extra_event_quantity: extraEvents,
      p_extra_referee_quantity: extraReferees,
      p_team_capacity_limit: teamCapacity,
      p_client_request_id: clientRequestId,
    });
    if (createError) {
      const code = String(createError.message || '');
      if (/SUBSCRIPTION_ALREADY_ACTIVE/.test(code)) throw apiError('Gói hiện tại vẫn còn hiệu lực.', 409);
      if (/SUBSCRIPTION_NOT_ACTIVE/.test(code)) throw apiError('Không có kỳ sử dụng đang hoạt động.', 409);
      if (/RENEWAL_ALREADY_SCHEDULED/.test(code)) throw apiError('Đã có một kỳ gia hạn đang chờ hiệu lực.', 409);
      if (/ADDON_QUANTITY_REQUIRED/.test(code)) throw apiError('Hãy chọn ít nhất một quota mua thêm.', 400);
      if (/INVALID_TEAM_CAPACITY/.test(code)) throw apiError('Sức chứa đội không hợp lệ.', 400);
      if (/TEAM_CAPACITY_DOWNGRADE_NOT_ALLOWED/.test(code)) throw apiError('Không thể giảm sức chứa thấp hơn mức đang được cấp.', 409);
      if (/TEAM_CAPACITY_BELOW_CURRENT_USAGE/.test(code)) throw apiError('Mức đội đã chọn thấp hơn số đội đang sử dụng. Hãy chọn mức cao hơn hoặc xử lý đội cũ trước.', 409);
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
