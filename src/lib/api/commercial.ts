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
