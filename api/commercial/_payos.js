import crypto from 'node:crypto';

const PAYOS_API_URL = 'https://api-merchant.payos.vn';

function sortObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = value[key];
      return result;
    }, {});
}

function signatureValue(value) {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') {
    return '';
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => sortObjectKeys(item)));
  }
  return String(value);
}

export function canonicalizePayOSData(data) {
  return Object.keys(data || {})
    .filter((key) => data[key] !== undefined)
    .sort()
    .map((key) => `${key}=${signatureValue(data[key])}`)
    .join('&');
}

export function signPayOSData(data, checksumKey) {
  if (!checksumKey) throw new Error('PAYOS_CHECKSUM_KEY_MISSING');
  return crypto
    .createHmac('sha256', checksumKey)
    .update(canonicalizePayOSData(data))
    .digest('hex');
}

export function verifyPayOSWebhook(body, checksumKey) {
  const supplied = typeof body?.signature === 'string' ? body.signature.trim().toLowerCase() : '';
  if (!supplied || !body?.data || typeof body.data !== 'object') return false;

  const expected = signPayOSData(body.data, checksumKey).toLowerCase();
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function hashPayOSPayload(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

export function getPayOSConfig({ required = false } = {}) {
  const enabled = process.env.PAYOS_ENABLED !== 'false';
  const config = {
    clientId: process.env.PAYOS_CLIENT_ID?.trim(),
    apiKey: process.env.PAYOS_API_KEY?.trim(),
    checksumKey: process.env.PAYOS_CHECKSUM_KEY?.trim(),
  };
  const available = enabled && Boolean(config.clientId && config.apiKey && config.checksumKey);

  if (required && !available) throw new Error('PAYOS_NOT_CONFIGURED');
  return { ...config, available };
}

function payOSHeaders(config) {
  return {
    'Content-Type': 'application/json',
    'x-client-id': config.clientId,
    'x-api-key': config.apiKey,
  };
}

async function parsePayOSResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code !== '00' || !body?.data) {
    const error = new Error(`PAYOS_REQUEST_FAILED:${body?.code || response.status}`);
    error.status = response.status;
    error.payOSCode = body?.code;
    throw error;
  }
  return body.data;
}

export function resolvePublicAppUrl(req) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;

  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!forwardedHost) throw new Error('PUBLIC_APP_URL_MISSING');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'http' && /^(localhost|127\.0\.0\.1)(:|$)/.test(forwardedHost)
    ? 'http'
    : 'https';
  return `${protocol}://${forwardedHost}`;
}

export async function getPayOSPaymentLink(providerOrderCode, config) {
  const response = await fetch(`${PAYOS_API_URL}/v2/payment-requests/${providerOrderCode}`, {
    method: 'GET',
    headers: payOSHeaders(config),
    signal: AbortSignal.timeout(10000),
  });
  return parsePayOSResponse(response);
}

export async function createPayOSPaymentLink(order, appUrl, config) {
  const returnPath = order.order_type === 'activation' ? '/unlock' : '/subscription';
  const signatureData = {
    amount: Number(order.total_amount),
    cancelUrl: `${appUrl}${returnPath}?payment=cancelled`,
    description: order.transfer_content,
    orderCode: Number(order.provider_order_code),
    returnUrl: `${appUrl}${returnPath}?payment=returned`,
  };
  const payload = {
    ...signatureData,
    expiredAt: Math.floor(new Date(order.expires_at).getTime() / 1000),
    signature: signPayOSData(signatureData, config.checksumKey),
  };

  try {
    const response = await fetch(`${PAYOS_API_URL}/v2/payment-requests`, {
      method: 'POST',
      headers: payOSHeaders(config),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return await parsePayOSResponse(response);
  } catch (error) {
    if (error?.payOSCode || error?.status) throw error;
    return getPayOSPaymentLink(order.provider_order_code, config);
  }
}

export function sanitizePayOSWebhook(body) {
  const data = body?.data || {};
  return {
    provider_code: body?.code || null,
    success: body?.success === true,
    order_code: data.orderCode ?? null,
    amount: data.amount ?? null,
    currency: data.currency || null,
    reference: data.reference || null,
    payment_link_id: data.paymentLinkId || null,
    transaction_code: data.code || null,
  };
}
