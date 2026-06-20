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

function shouldUseSupabaseFunction() {
  const hostname = window.location.hostname;
  return hostname === 'huunsbk.github.io' || hostname.endsWith('.vercel.app');
}

function logEndpoint(functionName: string) {
  if (import.meta.env.DEV) {
    console.info(`[AdminAccounts] endpoint=edge-function:${functionName}`);
  }
}

async function invokeAdminFunction<T>(functionName: string, body: Record<string, unknown>) {
  const token = await getBearerToken();
  logEndpoint(functionName);

  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) {
    throw new Error(error.message || `${functionName} chưa khả dụng.`);
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data as T;
}

export async function createAdminAccount(payload: AdminAccountPayload) {
  const token = await getBearerToken();

  if (shouldUseSupabaseFunction()) {
    return invokeAdminFunction('admin-create-account', payload);
  }

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

  if (shouldUseSupabaseFunction()) {
    return invokeAdminFunction('admin-update-account', { accountId, ...payload });
  }

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

  if (shouldUseSupabaseFunction()) {
    return invokeAdminFunction('admin-delete-account', { accountId });
  }

  const response = await fetch(`/api/admin/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

export async function resetAdminAccountPassword(targetUsername: string, newPassword: string) {
  const token = await getBearerToken();

  if (shouldUseSupabaseFunction()) {
    return invokeAdminFunction('admin-reset-account-password', { targetUsername, newPassword });
  }

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
