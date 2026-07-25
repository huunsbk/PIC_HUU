import assert from 'node:assert/strict';
import {
  canExecuteEventPermission,
  filterEventsForProfile,
  isEventAccessibleToProfile,
} from '../../src/lib/auth/eventAccessPolicy';

const eventA = 'evt_A';
const eventB = 'evt_B';
const scopedProfile = {
  event_ids: [eventA, eventB],
  eventPermissionMap: {
    [eventA]: ['view_event', 'manage_teams', 'manage_schedule'],
    [eventB]: ['view_event', 'enter_scores'],
  },
};

assert.equal(canExecuteEventPermission({
  role: 'EVENT_ADMIN',
  profile: scopedProfile,
  globalPermissions: ['manage_teams'],
  permission: 'manage_teams',
  eventId: eventA,
}), true);

assert.equal(canExecuteEventPermission({
  role: 'EVENT_ADMIN',
  profile: scopedProfile,
  globalPermissions: ['manage_teams'],
  permission: 'manage_teams',
  eventId: eventB,
}), false);

assert.equal(canExecuteEventPermission({
  role: 'EVENT_ADMIN',
  profile: scopedProfile,
  globalPermissions: ['manage_teams'],
  permission: 'manage_teams',
  eventId: null,
}), false);

assert.equal(canExecuteEventPermission({
  role: 'EVENT_ADMIN',
  profile: scopedProfile,
  globalPermissions: [],
  permission: 'manage_matches',
  eventId: eventA,
}), true);

assert.equal(canExecuteEventPermission({
  role: 'REFEREE',
  profile: scopedProfile,
  globalPermissions: ['enter_scores'],
  permission: 'enter_scores',
  eventId: eventB,
}), true);

assert.equal(canExecuteEventPermission({
  role: 'REFEREE',
  profile: scopedProfile,
  globalPermissions: ['enter_scores'],
  permission: 'enter_scores',
  eventId: 'evt_OUTSIDE',
}), false);

assert.equal(canExecuteEventPermission({
  role: 'TENANT_ADMIN',
  profile: null,
  globalPermissions: [],
  permission: 'manage_knockout',
  eventId: eventB,
}), true);

const ownerProfile = {
  tenant_type: 'self_service_customer',
  onboarding_status: 'ready',
  business_access_active: true,
  eventPermissionMap: {},
};
assert.equal(canExecuteEventPermission({
  role: 'EVENT_ADMIN',
  profile: ownerProfile,
  globalPermissions: [],
  permission: 'create_events',
  eventId: null,
}), true);

assert.equal(isEventAccessibleToProfile('EVENT_ADMIN', scopedProfile, eventA), true);
assert.equal(isEventAccessibleToProfile('EVENT_ADMIN', scopedProfile, 'evt_OUTSIDE'), false);
assert.deepEqual(
  filterEventsForProfile(
    [{ id: eventA }, { id: eventB }, { id: 'evt_OUTSIDE' }],
    'EVENT_ADMIN',
    scopedProfile,
  ),
  [{ id: eventA }, { id: eventB }],
);

console.log('eventAccessPolicy: PASS');
