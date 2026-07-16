import {
  apiError,
  getActorAccount,
  getAdminClient,
  getBearerToken,
  handleError,
  handleOptions,
  sendJson,
  setCorsHeaders,
} from '../admin/_accountService.js';
import { getPayOSConfig } from './_payos.js';

const PRODUCTION_APP_URL = 'https://picvn.vercel.app';

async function getGoogleProviderState() {
  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const apiKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !apiKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const settings = await response.json();
    return settings?.external?.google === true;
  } catch {
    return false;
  }
}

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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  const action = String(req.query?.action || (String(req.url || '').includes('/readiness') ? 'readiness' : 'bootstrap'));
  if (req.method === 'GET' && action === 'readiness') {
    try {
      const admin = getAdminClient();
      const actor = await getActorAccount(req, admin);
      if (actor.roleName !== 'SUPER_ADMIN') {
        throw apiError('Chỉ SUPER_ADMIN được kiểm tra trạng thái rollout.', 403);
      }

      const payOS = getPayOSConfig();
      const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
      const checks = {
        google_provider_enabled: await getGoogleProviderState(),
        payos_configured: payOS.available,
        public_app_url_valid: publicAppUrl === PRODUCTION_APP_URL,
        server_signup_enabled: process.env.SELF_SERVICE_SIGNUP_ENABLED === 'true',
        frontend_signup_enabled: process.env.VITE_SELF_SERVICE_ENABLED === 'true',
      };

      return sendJson(res, 200, {
        ready: Object.values(checks).every(Boolean),
        checks,
        webhook_url: `${PRODUCTION_APP_URL}/api/webhooks/payos`,
        checked_at: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(res, error);
    }
  }

  if (req.method !== 'POST' || action !== 'bootstrap') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
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
