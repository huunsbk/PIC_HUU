import {
  apiError,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../admin/_accountService.js';
import { getPayOSConfig } from './_payos.js';

function hasGoogleIdentity(user) {
  const providers = new Set([
    user?.app_metadata?.provider,
    ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user?.identities) ? user.identities.map((identity) => identity?.provider) : []),
  ].filter(Boolean));

  return providers.has('google');
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
    const { data, error } = await admin.auth.getUser(token);

    if (error || !data?.user) {
      throw apiError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401);
    }

    if (!hasGoogleIdentity(data.user)) {
      throw apiError('Onboarding self-service chỉ hỗ trợ tài khoản Google.', 403);
    }
    if (process.env.SELF_SERVICE_SIGNUP_ENABLED !== 'true') {
      throw apiError('Đăng ký tự phục vụ chưa được mở.', 503);
    }
    if (!getPayOSConfig().available) {
      throw apiError('Cổng thanh toán tự động chưa sẵn sàng.', 503);
    }

    const { data: bootstrap, error: bootstrapError } = await admin.rpc(
      'bootstrap_self_service_customer_v1',
      { p_auth_user_id: data.user.id },
    );

    if (bootstrapError) {
      const knownError = /ACCOUNT_INACTIVE/i.test(bootstrapError.message || '')
        ? 'Tài khoản đã bị khóa hoặc lưu trữ.'
        : 'Không thể khởi tạo không gian khách hàng lúc này.';
      throw apiError(knownError, /ACCOUNT_INACTIVE/i.test(bootstrapError.message || '') ? 403 : 500);
    }

    return sendJson(res, 200, bootstrap);
  } catch (error) {
    return handleError(res, error);
  }
}
