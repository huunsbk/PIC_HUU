import type { Session } from '@supabase/supabase-js';

export interface SelfServiceBootstrapResult {
  success: boolean;
  created: boolean;
  account_id: string;
  tenant_id: string;
  tenant_type: 'self_service_customer' | 'managed_enterprise';
  onboarding_status?: 'pending_subscription' | 'ready' | 'suspended';
}

export async function bootstrapSelfServiceCustomer(
  session: Session,
): Promise<SelfServiceBootstrapResult> {
  const response = await fetch('/api/commercial/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || 'Không thể khởi tạo tài khoản self-service.');
  }

  return body as SelfServiceBootstrapResult;
}

export interface CommercialPaymentOrder {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  currency: 'VND';
  transfer_content: string;
  checkout_url?: string | null;
  qr_code?: string | null;
  manual_review_available_at?: string | null;
  manual_review_requested_at?: string | null;
  expires_at: string;
  paid_at?: string | null;
  created_at: string;
}

async function authenticatedJson<T>(session: Session, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'Không thể xử lý yêu cầu thương mại.');
  return body as T;
}

export async function createCommercialOrder(
  session: Session,
  input: {
    planCode: string;
    extraEvents?: number;
    extraReferees?: number;
    clientRequestId: string;
  },
) {
  return authenticatedJson<{ success: boolean; order: CommercialPaymentOrder; provider_available: boolean }>(
    session,
    '/api/commercial/orders',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function getCurrentCommercialOrder(session: Session) {
  return authenticatedJson<{ order: CommercialPaymentOrder | null }>(
    session,
    '/api/commercial/orders/current',
  );
}

export async function requestCommercialManualReview(session: Session, orderId: string) {
  return authenticatedJson<{ success: boolean; result: string; order_id: string }>(
    session,
    '/api/commercial/orders/manual-review',
    { method: 'POST', body: JSON.stringify({ orderId }) },
  );
}
