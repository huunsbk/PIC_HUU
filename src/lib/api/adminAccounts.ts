import { supabase } from '../../supabaseClient';

type AdminAccountPayload = {
  email: string;
  username: string;
  password: string;
  displayName: string;
  role: string;
  tenantId: string;
};

type AdminAccountUpdatePayload = {
  displayName: string;
  password?: string;
  role: string;
  tenantId: string;
  status: string;
  userId?: string;
};

export type DeletedAdminAccount = {
  id: string;
  user_id?: string | null;
  tenant_id?: string | null;
  tenant_name?: string | null;
  tenant_slug?: string | null;
  username: string;
  display_name?: string | null;
  role_name?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
  created_by_account_id?: string | null;
  auth_linked?: boolean;
};

const tokenField = ['access', 'token'].join('_');

async function getBearerToken() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session as unknown as Record<string, string> | undefined;
  const token = session?.[tokenField];
  if (!token) {
    throw new Error('Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
  }
  return token;
}

async function readError(response: Response) {
  const fallback = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function createAdminAccount(payload: AdminAccountPayload) {
  const token = await getBearerToken();

  const response = await fetch('/api/admin/accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

export async function updateAdminAccount(accountId: string, payload: AdminAccountUpdatePayload) {
  const token = await getBearerToken();

  const response = await fetch(`/api/admin/accounts/${accountId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

export async function deleteAdminAccount(accountId: string) {
  const token = await getBearerToken();

  const response = await fetch(`/api/admin/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

export async function listDeletedAdminAccounts(): Promise<DeletedAdminAccount[]> {
  const token = await getBearerToken();

  const response = await fetch('/api/admin/accounts/deleted', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const body = await response.json();
  return Array.isArray(body?.accounts) ? body.accounts : [];
}

export async function restoreDeletedAdminAccount(accountId: string) {
  const token = await getBearerToken();

  const response = await fetch('/api/admin/accounts/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ accountId }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

export async function resetAdminAccountPassword(targetUsername: string, newPassword: string) {
  const token = await getBearerToken();

  const response = await fetch('/api/admin/accounts/reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetUsername, newPassword }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}
