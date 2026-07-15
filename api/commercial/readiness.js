import {
  apiError,
  getActorAccount,
  getAdminClient,
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

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

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
    const ready = Object.values(checks).every(Boolean);

    return sendJson(res, 200, {
      ready,
      checks,
      webhook_url: `${PRODUCTION_APP_URL}/api/webhooks/payos`,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(res, error);
  }
}
