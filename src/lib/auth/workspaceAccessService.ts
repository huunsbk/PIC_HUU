import { supabase } from '../../supabaseClient';

export interface AccessibleWorkspace {
  tournament_id: string | null;
  tenant_id?: string | null;
  tenant_name?: string | null;
  name?: string | null;
  slug?: string | null;
  status?: string | null;
}

export interface PendingWorkspaceContext {
  tenantId: string;
  tenantName?: string | null;
  tournamentId: string | null;
  tournamentName?: string | null;
  tournamentSlug?: string | null;
}

export interface WorkspaceAccessResult {
  allowed: boolean;
  reason?: 'guest' | 'not_found' | 'no_access' | 'no_tournament';
  pendingContext?: PendingWorkspaceContext;
  accessibleWorkspaces: AccessibleWorkspace[];
}

interface WorkspaceGuardResponse {
  allowed?: boolean;
  reason?: string;
  access_scope?: string;
  workspace?: {
    tenant_id?: string | null;
    tenant_name?: string | null;
    tournament_id?: string | null;
    tournament_name?: string | null;
    slug?: string | null;
  } | null;
}

export const normalizeTenantIdForRpc = (tenantId?: string | null) =>
  tenantId && tenantId !== 'default' ? tenantId : null;

export async function listAccessibleWorkspacesForUser(role?: string | null, tenantId?: string | null) {
  const tenantParam = role === 'SUPER_ADMIN' ? null : normalizeTenantIdForRpc(tenantId);
  const { data, error } = await supabase.rpc('list_accessible_workspaces_v1', {
    p_tenant_id: tenantParam,
  });

  if (error) throw error;
  return (Array.isArray(data) ? data : []) as AccessibleWorkspace[];
}

export async function resolveWorkspaceAccess(params: {
  routeSlug: string;
  role?: string | null;
  tenantId?: string | null;
}): Promise<WorkspaceAccessResult> {
  if (!params.role || params.role === 'guest') {
    return { allowed: false, reason: 'guest', accessibleWorkspaces: [] };
  }

  const { data, error } = await supabase.rpc('can_access_workspace_v1', {
    p_slug: params.routeSlug,
  });
  if (error) throw error;

  const guard = (data || {}) as WorkspaceGuardResponse;
  if (guard.allowed && guard.workspace?.tenant_id && guard.workspace.tournament_id) {
    return {
      allowed: true,
      pendingContext: {
        tenantId: guard.workspace.tenant_id,
        tenantName: guard.workspace.tenant_name,
        tournamentId: guard.workspace.tournament_id,
        tournamentName: guard.workspace.tournament_name,
        tournamentSlug: guard.workspace.slug,
      },
      accessibleWorkspaces: [],
    };
  }

  const accessibleWorkspaces = await listAccessibleWorkspacesForUser(params.role, params.tenantId);

  return {
    allowed: false,
    reason: 'no_access',
    accessibleWorkspaces,
  };
}

export function getWorkspaceDirectoryUrl() {
  const basePath = import.meta.env.BASE_URL || '/';
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${normalizedBase}admin/workspaces`;
}
