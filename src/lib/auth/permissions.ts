import { ROLES, RoleType, hasRole } from "./authorization";

// Define functions according to the TASK 9
export function canManageUsers(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);
}

export function canManageRoles(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN]);
}

export function canManageEvents(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
}

export function canManageMatches(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN, ROLES.REFEREE]);
}

export function canManageTeams(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_ADMIN]);
}

export function canViewAuditLogs(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);
}

export function canManageTenant(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN]);
}

export function canManagePermissions(currentRole: RoleType): boolean {
  return hasRole(currentRole, [ROLES.SUPER_ADMIN]);
}
