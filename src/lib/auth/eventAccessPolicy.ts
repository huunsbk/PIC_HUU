export const EVENT_SCOPED_PERMISSIONS = new Set([
  'view_event',
  'create_events',
  'manage_event_config',
  'manage_events',
  'manage_teams',
  'manage_groups',
  'manage_schedule',
  'manage_matches',
  'enter_scores',
  'manage_standings',
  'manage_knockout',
  'manage_referees',
]);

const SELF_SERVICE_OWNER_PERMISSIONS = new Set([
  'view_public',
  ...EVENT_SCOPED_PERMISSIONS,
]);

const EVENT_PERMISSION_ALIASES: Record<string, string[]> = {
  manage_events: ['manage_event_config'],
  manage_event_config: ['manage_events'],
  manage_matches: ['manage_schedule'],
  manage_schedule: ['manage_matches'],
};

const EVENT_SCOPED_ROLES = new Set(['EVENT_ADMIN', 'REFEREE', 'VIEWER']);

type EnterpriseProfile = {
  tenant_type?: string | null;
  onboarding_status?: string | null;
  business_access_active?: boolean | null;
  eventPermissionMap?: Record<string, string[]>;
  event_ids?: string[];
  permittedEventIds?: string[];
} | null;

export function isActiveSelfServiceOwner(role: string | null | undefined, profile: EnterpriseProfile) {
  return role === 'EVENT_ADMIN'
    && profile?.tenant_type === 'self_service_customer'
    && profile?.onboarding_status === 'ready'
    && profile?.business_access_active === true;
}

export function isEventAccessibleToProfile(
  role: string | null | undefined,
  profile: EnterpriseProfile,
  eventId: string | null | undefined,
) {
  if (!eventId) return false;
  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN' || isActiveSelfServiceOwner(role, profile)) {
    return true;
  }
  if (!EVENT_SCOPED_ROLES.has(role || '')) return false;

  const explicitEventIds = new Set([
    ...(profile?.permittedEventIds || []),
    ...(profile?.event_ids || []),
    ...Object.keys(profile?.eventPermissionMap || {}),
  ]);
  return explicitEventIds.has(eventId);
}

export function canExecuteEventPermission(params: {
  role: string | null | undefined;
  profile: EnterpriseProfile;
  globalPermissions: string[];
  permission: string;
  eventId?: string | null;
}) {
  const {
    role,
    profile,
    globalPermissions,
    permission,
    eventId,
  } = params;

  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN') return true;
  if (isActiveSelfServiceOwner(role, profile) && SELF_SERVICE_OWNER_PERMISSIONS.has(permission)) {
    return true;
  }
  if (EVENT_SCOPED_ROLES.has(role || '') && permission === '*') return false;

  if (EVENT_SCOPED_ROLES.has(role || '') && EVENT_SCOPED_PERMISSIONS.has(permission)) {
    if (!eventId || !isEventAccessibleToProfile(role, profile, eventId)) return false;

    const eventPermissions = new Set(profile?.eventPermissionMap?.[eventId] || []);
    const aliases = EVENT_PERMISSION_ALIASES[permission] || [];
    return eventPermissions.has(permission)
      || aliases.some((alias) => eventPermissions.has(alias));
  }

  return globalPermissions.includes(permission) || globalPermissions.includes('*');
}

export function filterEventsForProfile<T extends { id: string }>(
  events: T[],
  role: string | null | undefined,
  profile: EnterpriseProfile,
) {
  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN' || isActiveSelfServiceOwner(role, profile)) {
    return events;
  }
  if (!EVENT_SCOPED_ROLES.has(role || '')) return [];
  return events.filter((event) => isEventAccessibleToProfile(role, profile, event.id));
}
