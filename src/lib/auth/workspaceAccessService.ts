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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const isPrivilegedWorkspaceRole = (role?: string | null) =>
  role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN';

export const isSuperAdmin = (role?: string | null) => role === 'SUPER_ADMIN';

export async function listAccessibleWorkspacesForUser(role?: string | null, tenantId?: string | null) {
  const tenantParam = role === 'SUPER_ADMIN' ? null : tenantId && tenantId !== 'default' ? tenantId : null;
  const { data, error } = await supabase.rpc('list_accessible_workspaces_v1', {
    p_tenant_id: tenantParam,
  });

  if (error) throw error;
  return (Array.isArray(data) ? data : []) as AccessibleWorkspace[];
}

async function resolveWorkspaceContextBySlug(routeSlug: string): Promise<PendingWorkspaceContext | null> {
  const { data: tenantByRouteSlug } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', routeSlug)
    .is('deleted_at', null)
    .maybeSingle();

  let tenantByRouteId = null as null | { id: string; name: string; slug: string };
  if (!tenantByRouteSlug && isUuid(routeSlug)) {
    const { data } = await supabase
      .from('tenants')
      .select('id, name, slug')
      .eq('id', routeSlug)
      .is('deleted_at', null)
      .maybeSingle();
    tenantByRouteId = data;
  }

  const tenantByRoute = tenantByRouteSlug || tenantByRouteId;
  if (tenantByRoute) {
    const { data: latestTournament } = await supabase
      .from('tournament')
      .select('id, tenant_id, slug, name')
      .eq('tenant_id', tenantByRoute.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      tenantId: tenantByRoute.id,
      tenantName: tenantByRoute.name,
      tournamentId: latestTournament?.id || null,
      tournamentName: latestTournament?.name || null,
      tournamentSlug: latestTournament?.slug || null,
    };
  }

  const { data: workspaceContext, error: workspaceContextError } = await supabase.rpc('get_workspace_context_v1', {
    p_slug: routeSlug,
  });

  if (!workspaceContextError && workspaceContext?.tenant_id && workspaceContext?.tournament_id) {
    return {
      tenantId: workspaceContext.tenant_id,
      tenantName: workspaceContext.tenant_name,
      tournamentId: workspaceContext.tournament_id,
      tournamentName: workspaceContext.tournament_name,
      tournamentSlug: workspaceContext.tournament_slug,
    };
  }

  const { data: bySlug } = await supabase
    .from('tournament')
    .select('id, tenant_id, slug, name')
    .eq('slug', routeSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (bySlug) {
    return {
      tenantId: bySlug.tenant_id || bySlug.id,
      tournamentId: bySlug.id,
      tournamentName: bySlug.name,
      tournamentSlug: bySlug.slug,
    };
  }

  if (isUuid(routeSlug)) {
    const { data: byId } = await supabase
      .from('tournament')
      .select('id, tenant_id, slug, name')
      .eq('id', routeSlug)
      .is('deleted_at', null)
      .maybeSingle();

    if (byId) {
      return {
        tenantId: byId.tenant_id || byId.id,
        tournamentId: byId.id,
        tournamentName: byId.name,
        tournamentSlug: byId.slug,
      };
    }
  }

  return null;
}

function accessibleWorkspaceMatches(context: PendingWorkspaceContext, workspace: AccessibleWorkspace) {
  if (!context.tournamentId) return workspace.tenant_id === context.tenantId;
  return (
    workspace.tournament_id === context.tournamentId ||
    (!!context.tournamentSlug && workspace.slug === context.tournamentSlug)
  );
}

export async function resolveWorkspaceAccess(params: {
  routeSlug: string;
  role?: string | null;
  tenantId?: string | null;
}): Promise<WorkspaceAccessResult> {
  const pendingContext = await resolveWorkspaceContextBySlug(params.routeSlug);

  if (!pendingContext) {
    return { allowed: false, reason: 'not_found', accessibleWorkspaces: [] };
  }

  if (!pendingContext.tournamentId) {
    return {
      allowed: isSuperAdmin(params.role) || params.role === 'TENANT_ADMIN',
      reason: 'no_tournament',
      pendingContext,
      accessibleWorkspaces: [],
    };
  }

  if (isSuperAdmin(params.role)) {
    return { allowed: true, pendingContext, accessibleWorkspaces: [] };
  }

  if (!params.role || params.role === 'guest') {
    return { allowed: false, reason: 'guest', pendingContext, accessibleWorkspaces: [] };
  }

  const accessibleWorkspaces = await listAccessibleWorkspacesForUser(params.role, params.tenantId);
  const allowed = accessibleWorkspaces.some((workspace) => accessibleWorkspaceMatches(pendingContext, workspace));

  return {
    allowed,
    reason: allowed ? undefined : 'no_access',
    pendingContext,
    accessibleWorkspaces,
  };
}

export function getWorkspaceDirectoryUrl() {
  const basePath = import.meta.env.BASE_URL || '/';
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${normalizedBase}admin/workspaces`;
}

