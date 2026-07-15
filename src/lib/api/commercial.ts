import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../supabaseClient';

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

export interface SelfServicePlan {
  id: string;
  code: 'SELF_3D' | 'SELF_7D' | 'SELF_30D' | 'SELF_60D';
  name: string;
  description: string;
  duration_days: number;
  price_vnd: number;
  max_active_tournaments: number;
  max_events: number;
  max_active_referees: number;
}

export interface CommercialAccessState {
  success: boolean;
  commercial_state: 'not_applicable' | 'locked' | 'active' | 'expired';
  business_access_active: boolean;
  tenant_type?: string;
  tenant?: { id: string; name: string; slug: string; type: string; status: string };
  account?: { id: string; status: string; onboarding_status?: string };
  subscription?: {
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    plan_code: string;
    plan_name: string;
    duration_days: number;
  } | null;
  entitlements?: Array<{ resource_type: string; base_limit: number; addon_limit: number; effective_limit: number }>;
  usage?: Record<string, number> | null;
  server_time?: string;
}

export interface ManualReviewOrder {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  paid_amount?: number | null;
  currency: 'VND';
  transfer_content: string;
  manual_review_requested_at?: string | null;
  expires_at: string;
  created_at: string;
  tenant_id: string;
  tenant_name: string;
  account_id: string;
  account_name: string;
  plan_code?: string | null;
  plan_name?: string | null;
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

export async function listSelfServicePlans(): Promise<SelfServicePlan[]> {
  const { data, error } = await supabase.rpc('list_self_service_plans_v1');
  if (error) throw new Error('Không thể tải bảng giá lúc này.');
  return Array.isArray(data) ? data as SelfServicePlan[] : [];
}

export async function getCommercialAccessState(): Promise<CommercialAccessState> {
  const { data, error } = await supabase.rpc('get_commercial_access_state_v1');
  if (error || !data) throw new Error('Không thể kiểm tra trạng thái mở khóa.');
  return data as CommercialAccessState;
}

export async function listManualReviewOrders(session: Session) {
  return authenticatedJson<{ orders: ManualReviewOrder[] }>(
    session,
    '/api/admin/commercial/manual-reviews',
  );
}

export async function confirmManualReviewOrder(
  session: Session,
  input: { orderId: string; receivedAmount: number; transactionId: string },
) {
  return authenticatedJson<{ success: boolean; result: string; order_id: string }>(
    session,
    '/api/admin/commercial/manual-reviews/confirm',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function rejectManualReviewOrder(
  session: Session,
  input: { orderId: string; reason: string },
) {
  return authenticatedJson<{ success: boolean; result: string; order_id: string }>(
    session,
    '/api/admin/commercial/manual-reviews/reject',
    { method: 'POST', body: JSON.stringify(input) },
  );
}
