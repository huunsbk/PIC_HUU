export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TENANT_ADMIN: "TENANT_ADMIN",
  EVENT_ADMIN: "EVENT_ADMIN",
  REFEREE: "REFEREE",
  VIEWER: "VIEWER",
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];

export function hasRole(currentRole: RoleType, allowedRoles: RoleType[]): boolean {
  return allowedRoles.includes(currentRole);
}

export function requireRole(currentRole: RoleType, allowedRoles: RoleType[]): void {
  if (!hasRole(currentRole, allowedRoles)) {
    throw new Error("Unauthorized");
  }
}

export function isSuperAdmin(role: RoleType): boolean {
  return role === ROLES.SUPER_ADMIN;
}

export function isTenantAdmin(role: RoleType): boolean {
  return role === ROLES.TENANT_ADMIN;
}
