import { useTenant } from "./TenantProvider";
import { ROLES, hasRole } from "./authorization";

// Hook based permission checking combining role cache & logical scopes 
export function usePermission() {
  const { role, loading, account } = useTenant();

  const canManageUsers = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);
  const canManageEvents = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
  const canManageGroups = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
  const canManageTeams = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
  const canManageMatches = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER, ROLES.REFEREE]);
  const canManageKnockout = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
  const canViewAuditLogs = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);

  // Can integrate dynamic account_permissions checks here as well
  // using the account state from useTenant()

  return {
    loading,
    role,
    canManageUsers,
    canManageEvents,
    canManageGroups,
    canManageTeams,
    canManageMatches,
    canManageKnockout,
    canViewAuditLogs
  };
}
