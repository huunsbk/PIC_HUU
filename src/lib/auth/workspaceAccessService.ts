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
  accessMode?: 'manage' | 'operate' | 'read_only';
  effectiveScope?: 'system' | 'tenant' | 'self_service_owner' | 'event';
  phase?: 'operational' | 'history';
}

interface WorkspaceGuardResponse {
  allowed?: boolean;
  workspace?: {
    tenant_id?: string | null;
    tenant_name?: string | null;
    tournament_id?: string | null;
    tournament_name?: string | null;
    canonical_slug?: string | null;
    access_mode?: WorkspaceAccessResult['accessMode'];
    effective_scope?: WorkspaceAccessResult['effectiveScope'];
    phase?: WorkspaceAccessResult['phase'];
  } | null;
}

export type PostLoginDestination =
  | {
      kind: 'COMMERCIAL_REQUIRED';
    }
  | {
      kind: 'AUTO_ENTER';
      workspace: {
        tournament_id: string;
        tenant_id: string;
        slug: string;
        name?: string | null;
        status?: string | null;
        effective_scope?: string | null;
      };
    }
  | {
      kind: 'DIRECTORY';
      initial_filter: 'all' | 'operational' | 'history';
    }
  | {
      kind: 'EMPTY';
      reason: 'PROVISIONING_REQUIRED' | 'TENANT_HAS_NO_WORKSPACE' | 'NO_ACTIVE_ASSIGNMENT' | 'NO_ACCESSIBLE_WORKSPACE';
      can_create_tournament: boolean;
    };

export const normalizeTenantIdForRpc = (tenantId?: string | null) =>
  tenantId && tenantId !== 'default' ? tenantId : null;

export async function resolvePostLoginDestination(): Promise<PostLoginDestination> {
  const { data, error } = await supabase.rpc('resolve_post_login_destination_v2');
  if (error) throw error;

  const destination = data as PostLoginDestination | null;
  if (!destination?.kind) {
    throw new Error('POST_LOGIN_DESTINATION_INVALID');
  }

  if (destination.kind === 'AUTO_ENTER') {
    if (!destination.workspace?.tournament_id || !destination.workspace.tenant_id || !destination.workspace.slug) {
      throw new Error('POST_LOGIN_WORKSPACE_INVALID');
    }
  }

  return destination;
}

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

  const { data, error } = await supabase.rpc('resolve_accessible_workspace_by_slug_v2', {
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
        tournamentSlug: guard.workspace.canonical_slug,
      },
      accessibleWorkspaces: [],
      accessMode: guard.workspace.access_mode,
      effectiveScope: guard.workspace.effective_scope,
      phase: guard.workspace.phase,
    };
  }

  return {
    allowed: false,
    reason: 'no_access',
    accessibleWorkspaces: [],
  };
}

export function getWorkspaceDirectoryUrl() {
  const basePath = import.meta.env.BASE_URL || '/';
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${normalizedBase}admin/workspaces`;
}
