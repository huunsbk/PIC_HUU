import {
  getAdminClient,
  sendJson,
} from '../admin/_accountService.js';
import {
  getPayOSConfig,
  hashPayOSPayload,
  sanitizePayOSWebhook,
  verifyPayOSWebhook,
} from '../commercial/_payos.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const payloadHash = hashPayOSPayload(req.body);
  try {
    const admin = getAdminClient();
    const payOS = getPayOSConfig({ required: true });
    if (!verifyPayOSWebhook(req.body, payOS.checksumKey)) {
      await admin.rpc('record_invalid_payos_webhook_v1', { p_payload_hash: payloadHash });
      return sendJson(res, 400, { success: false, error: 'Invalid signature' });
    }

    const data = req.body?.data || {};
    const orderCode = Number(data.orderCode);
    const amount = Number(data.amount);
    const reference = String(data.reference || '').trim();
    const paymentLinkId = String(data.paymentLinkId || '').trim();
    const eventId = reference || `${paymentLinkId}:${orderCode}:${payloadHash.slice(0, 16)}`;
    const transactionId = reference || `payos:${paymentLinkId}:${orderCode}`;
    const successful = req.body?.success === true
      && String(req.body?.code || '') === '00'
      && String(data.code || '') === '00';

    if (!Number.isSafeInteger(orderCode) || !Number.isFinite(amount) || !eventId || !transactionId) {
      return sendJson(res, 200, { success: true });
    }

    const { error } = await admin.rpc('process_payos_webhook_v1', {
      p_provider_event_id: eventId,
      p_payload_hash: payloadHash,
      p_provider_order_code: orderCode,
      p_provider_transaction_id: transactionId,
      p_paid_amount: amount,
      p_payment_success: successful,
      p_sanitized_payload: sanitizePayOSWebhook(req.body),
    });
    if (error) {
      return sendJson(res, 500, { success: false });
    }

    return sendJson(res, 200, { success: true });
  } catch (error) {
    if (error?.message === 'PAYOS_NOT_CONFIGURED') {
      return sendJson(res, 503, { success: false });
    }
    return sendJson(res, 500, { success: false });
  }
}
