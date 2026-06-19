import { useTenant } from "./TenantProvider";
import { ROLES, hasRole } from "./authorization";

// Hook based permission checking combining role cache & logical scopes 
export function usePermission() {
  const { role, loading, account } = useTenant();

  const canManageUsers = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);
  const canManageEvents = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
  const canManageGroups = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
  const canManageTeams = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
  const canManageMatches = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN, ROLES.REFEREE]);
  const canManageKnockout = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
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
